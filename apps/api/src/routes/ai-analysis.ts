import { cleanPastedText } from "@job-radar/pipeline";
import { DEFAULT_PROFILE } from "@job-radar/shared";
import { z } from "zod";
import { analysisHash, toJobInput, toProfileInput } from "../ai-context";
import type { StoredAnalysis } from "../stores";
import { type AiDeps, IdParams, NO_DESCRIPTION_MESSAGE, errorReply } from "./ai-shared";

const ReadBody = z.object({
  text: z.string().max(40_000),
  hints: z.object({ title: z.string().max(250).nullish(), company: z.string().max(200).nullish() }).nullish(),
});
const AutoBody = z.object({ jobIds: z.array(z.string().min(1).max(64)).max(30) });
const FeedBody = z.object({ limit: z.number().int().min(1).max(50).default(30), retry: z.boolean().default(false) });

/** IA : état, analyse d'une offre, lecture d'une annonce collée, et vérification automatique des meilleures offres. */
export function registerAnalysisRoutes(deps: AiDeps) {
  const { app, opts, stores, ai, withLock } = deps;
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
}
