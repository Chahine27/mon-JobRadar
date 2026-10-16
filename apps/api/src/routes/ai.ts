import {
  LETTER_PROMPT_VERSION,
  checkLetter,
  spontaneousJobInput,
  type LetterOptions,
  type AiStatus,
  type AnalysisJobInput,
  type AnalysisProfileInput,
  type JobAnalysisResult,
  type ReadFields,
} from "@job-radar/ai";
import { cleanPastedText } from "@job-radar/pipeline";
import type { Mailer } from "@job-radar/notifications";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { DEFAULT_PROFILE, EMPTY_LETTER_KIT, LetterKitSchema, letterKitReady, type LetterKit, followUpDue } from "@job-radar/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { analysisHash, isAbridged, toJobInput, toProfileInput } from "../ai-context";
import { requireAuth } from "../auth";
import { DEFAULT_PDF_NAME, renderLetterPdf, safeName, saveLetterPdf } from "../letter-pdf";
import { DEFAULT_SPONTANEOUS_TITLE, defaultMail, followUpMail } from "../spontaneous-mail";
import type { JobService } from "../jobs/service";
import type { JobRow, LeadRow, StoredAnalysis, StoredApplication, StoredLetter, Stores } from "../stores";

/** IA branchée par server.ts (Ollama). Absente → routes qui répondent « IA non configurée ». */
export type AiService = {
  model: string;
  status(): Promise<AiStatus>;
  analyze(job: AnalysisJobInput, profile: AnalysisProfileInput): Promise<{ result: JobAnalysisResult; model: string; durationMs: number }>;
  writeLetter(job: AnalysisJobInput, kit: LetterKit, opts?: LetterOptions): Promise<{ content: string; model: string; durationMs: number }>;
  readJob(text: string, hints: { title?: string | null; company?: string | null } | null): Promise<{ fields: ReadFields; model: string; durationMs: number }>;
};

const LetterBody = z.object({ content: z.string().trim().min(1).max(20_000) });
const IdParams = z.object({ id: z.string().min(1).max(64) });
const ReadBody = z.object({
  text: z.string().max(40_000),
  hints: z.object({ title: z.string().max(250).nullish(), company: z.string().max(200).nullish() }).nullish(),
});
const AutoBody = z.object({ jobIds: z.array(z.string().min(1).max(64)).max(30) });
const FeedBody = z.object({ limit: z.number().int().min(1).max(50).default(30), retry: z.boolean().default(false) });

const NO_DESCRIPTION_MESSAGE =
  "La source n'a donné aucune description : l'IA n'a rien à lire. Colle l'annonce complète (bouton « Compléter l'annonce »).";

const errorReply = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code;
  if (code === "NO_DESCRIPTION") return { status: 422, body: { error: code, message } };
  const unavailable = code === "AI_UNAVAILABLE";
  return { status: unavailable ? 503 : 502, body: { error: unavailable ? "AI_UNAVAILABLE" : "AI_FAILED", message } };
};

export type AutoFeed = {
  /** Vérification IA du flux ; la promesse se termine quand la file est vide. */
  run?: (userId: string) => Promise<unknown>;
  /** Score affiché (corrigé par l'IA) des offres dont l'analyse IA est à jour. */
  scores?: (userId: string) => Promise<Map<string, number>>;
};

export async function aiRoutes(
  app: FastifyInstance,
  opts: {
    stores: Stores;
    jobs: JobService;
    ai?: AiService;
    savePdf?: typeof saveLetterPdf;
    mailer?: Mailer;
    /** Lettre terminée : prévient l'utilisateur (notification). Une erreur ici ne fait jamais échouer la lettre. */
    onLetterReady?: (n: { title: string; body: string; path: string; tag: string }) => Promise<unknown>;
    /** Rempli ici : permet au serveur de lancer la vérification IA du flux (fin de collecte). */
    autoFeed?: AutoFeed;
    /** Pause entre deux relances d'un envoi groupé (4 s ; 0 dans les tests). */
    followUpPauseMs?: number;
  },
) {
  const { stores, ai } = opts;
  const savePdf = opts.savePdf ?? saveLetterPdf;
  app.addHook("preHandler", requireAuth);

  /**
   * Pages ouvertes et visibles : le navigateur le signale toutes les 10 s (POST /api/presence).
   * Une lettre terminée sur la page où tu es déjà n'envoie pas de notification.
   */
  const watching = new Map<string, number>();
  const WATCH_TTL_MS = 25_000;
  const watchKey = (userId: string, path: string) => `${userId}|${decodeURIComponent(path)}`;
  // Envoyée une fois la réponse partie : la page affiche déjà la lettre quand la notification arrive.
  function notifyLetter(reply: FastifyReply, userId: string, n: { title: string; body: string; path: string; tag: string }) {
    reply.raw.once("finish", () => {
      if (Date.now() - (watching.get(watchKey(userId, n.path)) ?? 0) < WATCH_TTL_MS) return;
      void opts.onLetterReady?.(n)?.catch(() => {});
    });
  }

  app.post("/api/presence", async (request, reply) => {
    const body = z.object({ path: z.string().min(1).max(300) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    try {
      watching.set(watchKey(request.userId!, body.data.path), Date.now());
    } catch {
      return reply.code(400).send({ error: "INVALID_BODY" });
    }
    return reply.code(204).send();
  });

  /**
   * La carte graphique fait une chose à la fois : chaque appel à l'IA passe par cette file.
   * Une demande faite à la main attend au plus la fin de l'analyse automatique en cours.
   */
  let chain: Promise<unknown> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  }

  app.get("/api/ai/status", async () =>
    ai ? ai.status() : { available: false, model: null, message: "IA non configurée." },
  );

  async function context(userId: string, jobId: string) {
    const [job, rec, kit] = await Promise.all([stores.jobs.get(jobId), stores.profiles.get(userId), stores.letterKits.get(userId)]);
    if (!job || !rec) return null;
    const profile = toProfileInput(rec.profile, kit);
    return { input: toJobInput(job), profile, inputHash: analysisHash(job, profile, ai?.model ?? "") };
  }

  /** Analyse une offre (ou renvoie l'analyse à jour déjà faite). null si l'offre n'existe pas. */
  async function analyzeJob(userId: string, jobId: string, force: boolean) {
    if (!ai) throw Object.assign(new Error("IA non configurée."), { code: "AI_UNAVAILABLE" });
    return withLock(async () => {
      const ctx = await context(userId, jobId);
      if (!ctx) return null;
      // Sans description, l'IA inventerait les missions à partir du titre.
      if (!ctx.input.description.trim()) throw Object.assign(new Error(NO_DESCRIPTION_MESSAGE), { code: "NO_DESCRIPTION" });
      const latest = await stores.analyses.latest(jobId);
      if (latest && latest.inputHash === ctx.inputHash && !force) return { analysis: latest, cached: true as const };
      const { result, model, durationMs } = await ai.analyze(ctx.input, ctx.profile);
      const saved: StoredAnalysis = await stores.analyses.save(jobId, {
        inputHash: ctx.inputHash,
        model,
        result,
        lists: {
          required: result.competences_obligatoires,
          bonus: result.competences_bonus,
          risks: result.points_attention,
          summary: result.resume,
        },
      });
      app.log.info({ jobId, durationMs, model }, "analyse IA faite");
      return { analysis: saved, cached: false as const, durationMs };
    });
  }

  app.get("/api/jobs/:id/analysis", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const ctx = await context(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    // Annonce sans description : une ancienne analyse (faite sur le titre seul) n'est pas montrée.
    if (!ctx.input.description.trim()) return { analysis: null, upToDate: false, noDescription: true };
    const latest = await stores.analyses.latest(params.data.id);
    return { analysis: latest, upToDate: latest?.inputHash === ctx.inputHash };
  });

  app.post("/api/jobs/:id/analysis", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    if (!ai) return reply.code(503).send({ error: "AI_UNAVAILABLE", message: "IA non configurée." });
    const force = (request.query as { force?: string }).force === "true";
    try {
      const res = await analyzeJob(request.userId!, params.data.id, force);
      if (!res) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
      return { ...res, upToDate: true };
    } catch (err) {
      const e = errorReply(err);
      return reply.code(e.status).send(e.body);
    }
  });

  // ───────────── Lecture d'une annonce par l'IA (page envoyée par l'extension) ─────────────

  app.post("/api/jobs/manual/ai-read", async (request, reply) => {
    const body = ReadBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_TEXT", message: "Texte trop long." });
    if (!ai) return reply.code(503).send({ error: "AI_UNAVAILABLE", message: "IA non configurée." });
    const text = cleanPastedText(body.data.text);
    if (text.length < 60) return reply.code(400).send({ error: "TEXT_TOO_SHORT", message: "Texte trop court pour être lu." });
    try {
      const res = await withLock(() => ai.readJob(text, body.data.hints ?? null));
      request.log.info({ durationMs: res.durationMs, model: res.model }, "annonce lue par l'IA");
      return { ...res, text };
    } catch (err) {
      const e = errorReply(err);
      return reply.code(e.status).send(e.body);
    }
  });

  // ───────────── Vérification automatique des meilleures offres affichées ─────────────

  const queue: Array<{ userId: string; jobId: string }> = [];
  let current: string | null = null;
  let pumping = false;
  /** En attente de la fin de la file (fin de collecte : les notifications attendent l'avis de l'IA). */
  const idleWaiters: Array<() => void> = [];
  const idle = () => new Promise<void>((resolve) => (pumping ? idleWaiters.push(resolve) : resolve()));
  /** Ollama éteint : on ne réessaie pas avant cette date (pas de file bloquée pour rien). */
  let offlineUntil = 0;
  let offlineMessage: string | null = null;
  /** Offre dont l'analyse a échoué (réponse inutilisable) : pas de nouvel essai automatique avant 6 h (sinon à chaque collecte). */
  const failedAt = new Map<string, number>();
  const recentlyFailed = (jobId: string) => Date.now() - (failedAt.get(jobId) ?? 0) < 6 * 3600_000;
  const enqueue = (userId: string, ids: string[]) => {
    let n = 0;
    for (const jobId of ids) {
      if (jobId === current || recentlyFailed(jobId) || queue.some((q) => q.jobId === jobId)) continue;
      queue.push({ userId, jobId });
      n++;
    }
    return n;
  };

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const item = queue.shift()!;
        current = item.jobId;
        try {
          await analyzeJob(item.userId, item.jobId, false);
        } catch (err) {
          const e = errorReply(err);
          if (e.status === 503) {
            offlineUntil = Date.now() + 60_000;
            offlineMessage = e.body.message;
            queue.length = 0;
          } else {
            failedAt.set(item.jobId, Date.now());
            app.log.warn({ jobId: item.jobId, err: e.body.message }, "vérification IA impossible");
          }
        } finally {
          current = null;
        }
      }
    } finally {
      pumping = false;
      for (const resolve of idleWaiters.splice(0)) resolve();
    }
  }

  /** Seuil du profil (« Analyse IA à partir de »). */
  const thresholdOf = async (userId: string) => (await stores.profiles.get(userId))?.profile.minScoreForAnalysis ?? DEFAULT_PROFILE.minScoreForAnalysis;

  const autoStatus = (threshold: number) => ({
    enabled: !!ai,
    threshold,
    pending: [...(current ? [current] : []), ...queue.map((q) => q.jobId)],
    offline: Date.now() < offlineUntil,
    message: Date.now() < offlineUntil ? offlineMessage : null,
  });

  app.get("/api/ai/auto", async (request) => autoStatus(await thresholdOf(request.userId!)));

  app.post("/api/ai/auto", async (request, reply) => {
    const body = AutoBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    const threshold = await thresholdOf(request.userId!);
    if (!ai || Date.now() < offlineUntil) return autoStatus(threshold);
    enqueue(request.userId!, await opts.jobs.autoCandidates(request.userId!, body.data.jobIds, threshold));
    void pump();
    return autoStatus(threshold);
  });

  /**
   * Tout le flux (pas seulement les offres affichées) : les meilleures offres (≥ seuil) jamais vérifiées,
   * ou dont l'analyse est dépassée (annonce, profil, CV ou modèle changé), de la meilleure à la moins bonne.
   * `retry` : demandé par un clic → on réessaie même si Ollama était éteint il y a moins d'une minute.
   */
  async function feed(userId: string, retry: boolean, limit: number) {
    const threshold = await thresholdOf(userId);
    if (!ai) return { ...autoStatus(threshold), queued: 0 };
    if (retry) offlineUntil = 0;
    if (Date.now() < offlineUntil) return { ...autoStatus(threshold), queued: 0 };
    const list = await opts.jobs.list(userId, {
      minScore: threshold,
      status: "active",
      includeHidden: false,
      sort: "score",
    });
    const wanted = (await opts.jobs.autoCandidates(userId, list.map((j) => j.id), threshold)).filter((id) => !recentlyFailed(id)).slice(0, limit);
    const queued = enqueue(userId, wanted);
    void pump();
    return { ...autoStatus(threshold), queued };
  }

  // Fin de collecte côté serveur : l'IA vérifie les nouvelles offres même si aucun onglet n'est ouvert.
  if (opts.autoFeed && ai) {
    opts.autoFeed.run = async (userId) => {
      await feed(userId, false, FeedBody.parse({}).limit);
      await idle();
    };
    opts.autoFeed.scores = async (userId) =>
      new Map(
        (await opts.jobs.list(userId, { minScore: 0, status: "all", includeHidden: true, sort: "date" }))
          .filter((j) => j.ai)
          .map((j) => [j.id, j.score.final]),
      );
  }

  app.post("/api/ai/auto/feed", async (request, reply) => {
    const body = FeedBody.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    return feed(request.userId!, body.data.retry, body.data.limit);
  });

  // ───────────── Lettre de motivation ─────────────

  app.get("/api/letter-kit", async (request) => {
    const kit = (await stores.letterKits.get(request.userId!)) ?? EMPTY_LETTER_KIT;
    return { kit, ready: letterKitReady(kit) };
  });

  app.put("/api/letter-kit", async (request, reply) => {
    const body = LetterKitSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "INVALID_LETTER_KIT",
        issues: body.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const kit = await stores.letterKits.save(request.userId!, body.data);
    return { kit, ready: letterKitReady(kit) };
  });

  async function letterContext(userId: string, jobId: string) {
    const [job, kit] = await Promise.all([stores.jobs.get(jobId), stores.letterKits.get(userId)]);
    if (!job) return null;
    const inputHash = kit
      ? createHash("sha256")
          .update(JSON.stringify([job.contentHash, kit, ai?.model ?? "", LETTER_PROMPT_VERSION]))
          .digest("hex")
          .slice(0, 32)
      : "";
    const jobText = [job.title, job.company ?? "", job.description].join("\n");
    return { job, kit, inputHash, jobText, abridged: isAbridged(job) };
  }

  function letterReply(letter: StoredLetter | null, ctx: { job: JobRow; kit: LetterKit | null; inputHash: string; jobText: string; abridged: boolean }) {
    const warnings = letter && ctx.kit ? checkLetter(letter.content, ctx.kit, ctx.jobText, ctx.job.title) : [];
    if (letter && ctx.abridged) {
      warnings.unshift("L'annonce n'est qu'un extrait : colle l'annonce complète (bouton « Compléter l'annonce ») puis réécris la lettre, elle sera plus précise.");
    }
    return { letter, upToDate: !!letter && letter.inputHash === ctx.inputHash, kitReady: letterKitReady(ctx.kit), warnings };
  }

  app.get("/api/jobs/:id/letter", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const ctx = await letterContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    return letterReply(await stores.letters.get(params.data.id), ctx);
  });

  app.post("/api/jobs/:id/letter", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    if (!ai) return reply.code(503).send({ error: "AI_UNAVAILABLE", message: "IA non configurée." });
    const ctx = await letterContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    if (!ctx.kit || !letterKitReady(ctx.kit)) {
      return reply.code(400).send({ error: "LETTER_KIT_MISSING", message: "Colle d'abord ton CV dans « CV & lettre »." });
    }

    const existing = await stores.letters.get(params.data.id);
    const force = (request.query as { force?: string }).force === "true";
    if (existing && existing.inputHash === ctx.inputHash && !force) return { ...letterReply(existing, ctx), cached: true };

    try {
      const { content, model, durationMs } = await withLock(() => ai.writeLetter(toJobInput(ctx.job), ctx.kit!));
      const saved = await stores.letters.save(params.data.id, { inputHash: ctx.inputHash, model, content });
      request.log.info({ jobId: params.data.id, durationMs, model }, "lettre IA écrite");
      notifyLetter(reply, request.userId!, {
        title: "Lettre de motivation terminée",
        body: `${ctx.job.title}${ctx.job.company ? ` — ${ctx.job.company}` : ""}`,
        path: `/offres/${encodeURIComponent(params.data.id)}`,
        tag: `letter-${params.data.id}`,
      });
      return { ...letterReply(saved, ctx), cached: false, durationMs };
    } catch (err) {
      const e = errorReply(err);
      return reply.code(e.status).send(e.body);
    }
  });

  /** Enregistre la lettre (le texte affiché, même non enregistré) en PDF dans le dossier choisi, en remplaçant l'ancien. */
  app.post("/api/jobs/:id/letter/pdf", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const body = LetterBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_LETTER" });
    const ctx = await letterContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const folder = ctx.kit?.pdfFolder?.trim();
    if (!folder) return reply.code(400).send({ error: "PDF_FOLDER_MISSING", message: "Choisis d'abord le dossier dans « CV & lettre »." });
    try {
      const title = `Lettre de motivation - ${ctx.job.company ?? ctx.job.title}`;
      const file = await savePdf(body.data.content, folder, ctx.kit?.pdfName || DEFAULT_PDF_NAME, title);
      return { file };
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message =
        code === "EBUSY" || code === "EPERM" || code === "EACCES"
          ? "Le PDF est ouvert dans un autre logiciel (ou le dossier est protégé) : ferme-le puis réessaie."
          : `Enregistrement du PDF impossible : ${err instanceof Error ? err.message : String(err)}`;
      return reply.code(500).send({ error: "PDF_FAILED", message });
    }
  });

  app.put("/api/jobs/:id/letter", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const body = LetterBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_LETTER" });
    const ctx = await letterContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const saved = await stores.letters.edit(params.data.id, body.data.content);
    if (!saved) return reply.code(404).send({ error: "LETTER_NOT_FOUND" });
    return letterReply(saved, ctx);
  });

  // ───── Candidatures spontanées (entreprises La Bonne Boîte) : lettre IA + envoi par email après relecture ─────

  const cleanPath = (p: string) => p.trim().replace(/^"+|"+$/g, "");
  const TitleBody = z.object({ title: z.string().trim().min(3).max(120).optional() });
  const SendBody = z.object({
    to: z.email().max(200),
    subject: z.string().trim().min(3).max(250),
    message: z.string().trim().min(10).max(5_000),
    letter: z.string().trim().min(50).max(20_000),
    force: z.boolean().optional(),
  });

  async function applicationContext(userId: string, leadId: string, title = DEFAULT_SPONTANEOUS_TITLE) {
    const [lead, kit, application] = await Promise.all([stores.leads.get(leadId), stores.letterKits.get(userId), stores.applications.get(leadId)]);
    if (!lead) return null;
    const job = spontaneousJobInput(
      { name: lead.name, sector: lead.nafLabel, city: lead.city, department: lead.department, headcountMin: lead.headcountMin, headcountMax: lead.headcountMax },
      title,
    );
    const inputHash = kit
      ? createHash("sha256").update(JSON.stringify(["spontanee", job, kit, ai?.model ?? "", LETTER_PROMPT_VERSION])).digest("hex").slice(0, 32)
      : "";
    return { lead, kit, application, job, inputHash, title };
  }

  function applicationReply(ctx: { lead: LeadRow; kit: LetterKit | null; application: StoredApplication | null; job: AnalysisJobInput; inputHash: string; title: string }) {
    const kit = ctx.kit ?? EMPTY_LETTER_KIT;
    const cvPath = cleanPath(kit.cvPdfPath ?? "");
    const letter = ctx.application?.letter ?? "";
    return {
      lead: ctx.lead,
      title: ctx.title,
      application: ctx.application,
      upToDate: !!ctx.application && ctx.application.inputHash === ctx.inputHash,
      kitReady: letterKitReady(ctx.kit),
      warnings: letter ? checkLetter(letter, kit, ctx.job.description, ctx.title, { spontaneous: true }) : [],
      mail: { configured: !!opts.mailer?.isConfigured(), from: opts.mailer?.address() ?? null },
      cvPdf: { path: cvPath, found: !!cvPath && /\.pdf$/i.test(cvPath) && existsSync(cvPath) },
      letterPdfName: safeName(kit.pdfName || DEFAULT_PDF_NAME),
      defaults: defaultMail(kit, ctx.lead.name, ctx.title),
    };
  }

  app.get("/api/leads/:id/application", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const title = TitleBody.safeParse(request.query).data?.title;
    const ctx = await applicationContext(request.userId!, params.data.id, title);
    if (!ctx) return reply.code(404).send({ error: "LEAD_NOT_FOUND" });
    return applicationReply(ctx);
  });

  app.post("/api/leads/:id/application/letter", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = TitleBody.safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    if (!ai) return reply.code(503).send({ error: "AI_UNAVAILABLE", message: "IA non configurée." });
    const ctx = await applicationContext(request.userId!, params.data.id, body.data.title);
    if (!ctx) return reply.code(404).send({ error: "LEAD_NOT_FOUND" });
    if (!ctx.kit || !letterKitReady(ctx.kit)) {
      return reply.code(400).send({ error: "LETTER_KIT_MISSING", message: "Colle d'abord ton CV dans « CV & lettre »." });
    }
    try {
      const { content, model, durationMs } = await withLock(() => ai.writeLetter(ctx.job, ctx.kit!, { spontaneous: true }));
      const saved = await stores.applications.save(params.data.id, { inputHash: ctx.inputHash, model, letter: content });
      request.log.info({ leadId: params.data.id, durationMs, model }, "lettre spontanée écrite");
      notifyLetter(reply, request.userId!, {
        title: "Lettre de motivation terminée",
        body: `Candidature spontanée — ${ctx.lead.name}`,
        path: `/entreprises/${encodeURIComponent(params.data.id)}/candidature`,
        tag: `letter-${params.data.id}`,
      });
      return { ...applicationReply({ ...ctx, application: saved }), durationMs };
    } catch (err) {
      const e = errorReply(err);
      return reply.code(e.status).send(e.body);
    }
  });

  app.put("/api/leads/:id/application", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = LetterBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_LETTER" });
    const ctx = await applicationContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "LEAD_NOT_FOUND" });
    const saved = await stores.applications.edit(params.data.id, body.data.content);
    if (!saved) return reply.code(404).send({ error: "APPLICATION_NOT_FOUND" });
    return applicationReply({ ...ctx, application: saved });
  });

  /** Envoi après relecture : lettre en PDF + CV PDF en pièces jointes, depuis ton adresse Gmail. Rien ne part sans ce clic. */
  app.post("/api/leads/:id/application/send", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = SendBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY", message: "Adresse email, objet, message ou lettre manquant." });
    const ctx = await applicationContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "LEAD_NOT_FOUND" });
    if (!opts.mailer?.isConfigured()) {
      return reply.code(503).send({ error: "MAIL_NOT_CONFIGURED", message: "Envoi d'email non configuré : remplis SMTP_HOST, SMTP_USER et SMTP_PASSWORD dans .env." });
    }
    const kit = ctx.kit ?? EMPTY_LETTER_KIT;
    const cvPath = cleanPath(kit.cvPdfPath ?? "");
    if (!cvPath || !/\.pdf$/i.test(cvPath) || !existsSync(cvPath)) {
      return reply.code(400).send({ error: "CV_PDF_MISSING", message: "CV PDF introuvable : indique son chemin dans « CV & lettre »." });
    }
    if (ctx.application?.sentAt && !body.data.force) {
      return reply.code(409).send({ error: "ALREADY_SENT", message: `Déjà envoyée le ${ctx.application.sentAt.toLocaleDateString("fr-FR")} à ${ctx.application.sentTo}.` });
    }
    let messageId: string | null = null;
    try {
      const title = `Lettre de motivation - ${ctx.lead.name}`;
      messageId = (await opts.mailer.send({
        fromName: kit.signature,
        to: body.data.to,
        subject: body.data.subject,
        text: body.data.message,
        attachments: [
          { filename: safeName(kit.pdfName || DEFAULT_PDF_NAME), content: await renderLetterPdf(body.data.letter, title) },
          { filename: basename(cvPath.replace(/\\/g, "/")), content: await readFile(cvPath) },
        ],
      })) || null;
    } catch (err) {
      request.log.error({ err, leadId: params.data.id }, "envoi de candidature spontanée impossible");
      return reply.code(502).send({ error: "MAIL_FAILED", message: `L'email n'est pas parti : ${err instanceof Error ? err.message : String(err)}` });
    }
    const now = new Date();
    if (ctx.application) {
      if (ctx.application.letter !== body.data.letter) await stores.applications.edit(params.data.id, body.data.letter);
    } else {
      await stores.applications.save(params.data.id, { inputHash: "", model: "manuel", letter: body.data.letter });
    }
    await stores.applications.markSent(params.data.id, body.data.to, now, messageId);
    await stores.leads.update(params.data.id, { status: "CONTACTED", contactEmail: body.data.to.toLowerCase() });
    request.log.info({ leadId: params.data.id }, "candidature spontanée envoyée");
    const fresh = await applicationContext(request.userId!, params.data.id, ctx.title);
    return { ...applicationReply(fresh!), sentAt: now };
  });

  // ───── Relance d'une spontanée sans réponse : même adresse, même fil, même lettre et ton CV actuel ─────

  /** Aperçu de la relance (modifiable avant l'envoi). */
  app.get("/api/leads/:id/application/follow-up", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const ctx = await applicationContext(request.userId!, params.data.id);
    if (!ctx?.application?.sentAt || !ctx.application.sentTo) return reply.code(404).send({ error: "NOT_SENT", message: "Cette candidature n'a pas été envoyée par Job Radar." });
    return { to: ctx.application.sentTo, ...followUpMail(ctx.kit ?? EMPTY_LETTER_KIT, ctx.lead.name, ctx.title, ctx.application.sentAt), followedUpAt: ctx.application.followedUpAt };
  });

  const FollowUpBody = z.object({ subject: z.string().trim().min(3).max(250), message: z.string().trim().min(10).max(5_000) });
  type FollowUpFail = { status: number; error: string; message: string };

  /**
   * Envoie la relance d'une spontanée : même adresse, en réponse au premier mail (même fil), même lettre, CV actuel.
   * Sans objet ni message : ceux écrits par le code (followUpMail).
   */
  async function sendFollowUp(userId: string, leadId: string, mail?: { subject: string; message: string }): Promise<{ followedUpAt: Date } | FollowUpFail> {
    const ctx = await applicationContext(userId, leadId);
    const sent = ctx?.application;
    if (!ctx || !sent?.sentAt || !sent.sentTo) return { status: 404, error: "NOT_SENT", message: "Cette candidature n'a pas été envoyée par Job Radar." };
    if (sent.followedUpAt) {
      // Une seule relance, sauf si elle est tombée pendant une absence (message d'absence reçu après elle).
      const spId = (await stores.applications.listSent()).find((s) => s.leadId === leadId)?.id;
      const awayAfter = (await stores.applicationMails.list()).some(
        (m) => m.spontaneousId === spId && m.kind === "AWAY" && !m.dismissed && m.receivedAt.getTime() >= sent.followedUpAt!.getTime(),
      );
      if (!awayAfter) return { status: 409, error: "ALREADY_FOLLOWED_UP", message: `Déjà relancée le ${sent.followedUpAt.toLocaleDateString("fr-FR")}.` };
    }
    if (!opts.mailer?.isConfigured()) {
      return { status: 503, error: "MAIL_NOT_CONFIGURED", message: "Envoi d'email non configuré : remplis SMTP_HOST, SMTP_USER et SMTP_PASSWORD dans .env." };
    }
    const kit = ctx.kit ?? EMPTY_LETTER_KIT;
    const cvPath = cleanPath(kit.cvPdfPath ?? "");
    if (!cvPath || !/\.pdf$/i.test(cvPath) || !existsSync(cvPath)) {
      return { status: 400, error: "CV_PDF_MISSING", message: "CV PDF introuvable : indique son chemin dans « CV & lettre »." };
    }
    const { subject, message } = mail ?? followUpMail(kit, ctx.lead.name, ctx.title, sent.sentAt);
    try {
      await opts.mailer.send({
        fromName: kit.signature,
        to: sent.sentTo,
        subject,
        text: message,
        inReplyTo: sent.messageId,
        attachments: [
          { filename: safeName(kit.pdfName || DEFAULT_PDF_NAME), content: await renderLetterPdf(sent.letter, `Lettre de motivation - ${ctx.lead.name}`) },
          { filename: basename(cvPath.replace(/\\/g, "/")), content: await readFile(cvPath) },
        ],
      });
    } catch (err) {
      app.log.error({ err, leadId }, "relance de candidature spontanée impossible");
      return { status: 502, error: "MAIL_FAILED", message: `L'email n'est pas parti : ${err instanceof Error ? err.message : String(err)}` };
    }
    const now = new Date();
    await stores.applications.markFollowedUp(leadId, now);
    app.log.info({ leadId }, "candidature spontanée relancée");
    return { followedUpAt: now };
  }

  app.post("/api/leads/:id/application/follow-up", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = FollowUpBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY", message: "Objet ou message manquant." });
    const r = await sendFollowUp(request.userId!, params.data.id, body.data);
    if ("error" in r) return reply.code(r.status).send({ error: r.error, message: r.message });
    return { ok: true, followedUpAt: r.followedUpAt };
  });

  /** Spontanées à relancer (followUpDue : 7 jours sans réponse, après le retour d'une absence) ; les plus anciennes d'abord. */
  async function followUpQueue(now = new Date()) {
    const [sent, mails] = await Promise.all([stores.applications.listSent(), stores.applicationMails.list()]);
    return sent
      .filter((s) => !s.noOpeningAt && !s.appliedOnSiteAt && followUpDue(s, mails.filter((m) => m.spontaneousId === s.id), now))
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  }

  /**
   * Relance groupée (bouton « Relancer les 10 plus anciennes ») : en arrière-plan, une à la fois, avec une pause entre
   * deux envois (Gmail se méfie des rafales) ; la page suit l'avancement (GET). S'arrête sur une erreur de configuration.
   */
  type FollowStep = { leadId: string; name: string; status: "waiting" | "sending" | "sent" | "failed"; message: string | null };
  const followBatch = { running: false, total: 0, done: 0, remaining: 0, steps: [] as FollowStep[] };
  const BatchFollowUpBody = z.object({ limit: z.number().int().min(1).max(20).default(10) });

  app.get("/api/applications/follow-up/batch", async () => followBatch);

  app.post("/api/applications/follow-up/batch", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = BatchFollowUpBody.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    if (followBatch.running) return followBatch;
    const userId = request.userId!;
    const queue = (await followUpQueue()).slice(0, body.data.limit);
    const leads = new Map((await stores.leads.list()).map((l) => [l.id, l.name]));
    Object.assign(followBatch, {
      running: queue.length > 0,
      total: queue.length,
      done: 0,
      steps: queue.map((s): FollowStep => ({ leadId: s.leadId, name: leads.get(s.leadId) ?? "?", status: "waiting", message: null })),
    });
    void (async () => {
      try {
        for (const [i, step] of followBatch.steps.entries()) {
          if (i > 0 && opts.followUpPauseMs !== 0) await new Promise((r) => setTimeout(r, opts.followUpPauseMs ?? 4_000));
          step.status = "sending";
          const r = await sendFollowUp(userId, step.leadId);
          step.status = "error" in r ? "failed" : "sent";
          step.message = "error" in r ? r.message : null;
          followBatch.done++;
          if ("error" in r && ["MAIL_NOT_CONFIGURED", "CV_PDF_MISSING"].includes(r.error)) break;
        }
      } finally {
        followBatch.remaining = (await followUpQueue().catch(() => [])).length;
        followBatch.running = false;
      }
    })();
    return followBatch;
  });

  // ───── Préparation en lot : l'IA écrit les lettres des entreprises « À contacter » qui ont un email ; l'envoi reste un clic ─────

  /** Suivi affiché entreprise par entreprise, dans l'ordre d'écriture. */
  type BatchStep = { leadId: string; name: string; status: "waiting" | "writing" | "done" | "failed" | "stopped"; error: string | null };
  const batch = { running: false, total: 0, done: 0, current: null as string | null, error: null as string | null, steps: [] as BatchStep[] };

  /** Entreprises « À contacter », avec email, jamais contactées par Job Radar. */
  async function batchContexts(userId: string) {
    const out = [];
    for (const lead of await stores.leads.list()) {
      if (lead.status !== "TO_CONTACT" || !lead.contactEmail) continue;
      const ctx = await applicationContext(userId, lead.id);
      if (ctx && !ctx.application?.sentAt) out.push(ctx);
    }
    return out;
  }

  app.get("/api/leads/applications/batch", async (request) => {
    const all = await batchContexts(request.userId!);
    const ready = all.filter((c) => c.application?.letter);
    const kit = all[0]?.kit ?? (await stores.letterKits.get(request.userId!));
    const cvPath = cleanPath(kit?.cvPdfPath ?? "");
    return {
      batch,
      enabled: !!ai,
      kitReady: letterKitReady(kit),
      mail: { configured: !!opts.mailer?.isConfigured(), from: opts.mailer?.address() ?? null },
      cvPdf: { path: cvPath, found: !!cvPath && /\.pdf$/i.test(cvPath) && existsSync(cvPath) },
      toWrite: all.length - ready.length,
      items: ready.map(applicationReply),
    };
  });

  /** Lance l'écriture des lettres manquantes, une par une, en arrière-plan (une lettre déjà écrite n'est jamais réécrite). */
  app.post("/api/leads/applications/batch", async (request, reply) => {
    if (!ai) return reply.code(503).send({ error: "AI_UNAVAILABLE", message: "IA non configurée." });
    if (batch.running) return { batch };
    const userId = request.userId!;
    const todo = (await batchContexts(userId)).filter((c) => !c.application?.letter);
    if (!todo.length) return { batch };
    if (!todo[0]!.kit || !letterKitReady(todo[0]!.kit)) {
      return reply.code(400).send({ error: "LETTER_KIT_MISSING", message: "Colle d'abord ton CV dans « CV & lettre »." });
    }
    const steps: BatchStep[] = todo.map(({ lead }) => ({ leadId: lead.id, name: lead.name, status: "waiting", error: null }));
    Object.assign(batch, { running: true, total: todo.length, done: 0, current: null, error: null, steps });
    void (async () => {
      try {
        for (const step of steps) {
          batch.current = step.name;
          step.status = "writing";
          const ctx = await applicationContext(userId, step.leadId); // relu : une lettre écrite à la main entre-temps est gardée
          try {
            if (ctx?.kit && !ctx.application?.letter) {
              const { content, model } = await withLock(() => ai.writeLetter(ctx.job, ctx.kit!, { spontaneous: true }));
              await stores.applications.save(step.leadId, { inputHash: ctx.inputHash, model, letter: content });
            }
            step.status = "done";
            batch.done++;
          } catch (err) {
            const e = errorReply(err);
            step.status = "failed";
            step.error = e.body.message;
            if (e.status === 503) {
              batch.error = e.body.message; // Ollama éteint : inutile de continuer
              for (const s of steps) if (s.status === "waiting") s.status = "stopped";
              break;
            }
            app.log.warn({ leadId: step.leadId, err: e.body.message }, "lettre spontanée (lot) impossible");
          }
        }
      } finally {
        batch.running = false;
        batch.current = null;
      }
      if (batch.done > 0) {
        await opts.onLetterReady?.({
          title: "Candidatures spontanées prêtes",
          body: `${batch.done} lettre(s) écrite(s) : relis-les puis envoie`,
          path: "/entreprises/pretes",
          tag: "letters-batch",
        })?.catch(() => {});
      }
    })();
    return { batch };
  });

}
