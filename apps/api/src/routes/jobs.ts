import { analyzeJobText, cleanFullText } from "@job-radar/pipeline";
import { APPLY_CHANNELS, APPLY_CVS, JOB_STATUSES, MANUAL_CONTRACTS, ManualJobSchema } from "@job-radar/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import { UrlReadError, readJobFromUrl } from "../job-from-url";
import type { JobService } from "../jobs/service";
import { skillStats } from "../jobs/stats";
import type { Stores } from "../stores";

/** Temps max d'attente du trajet avant d'afficher l'offre (au-delà, il arrive en différé). */
const TRAVEL_WAIT_MS = 400;

const ListQuery = z.object({
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  status: z.enum([...JOB_STATUSES, "active", "all", "try"]).default("active"),
  includeHidden: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  q: z.string().max(200).optional(),
  sort: z.enum(["score", "date", "chances"]).default("score"),
  /** Rubrique du flux : « local » (dans ta zone), « remote » (full remote), « unknown » (lieu non précisé). */
  zone: z.enum(["local", "remote", "unknown"]).optional(),
  /** Seulement les offres de cette source (« france-travail », « manual »…) ; absent = toutes. */
  source: z.string().trim().max(40).regex(/^[a-z0-9:-]*$/).optional(),
  /** Seulement ce type de contrat (« unknown » = non précisé) ; absent = tous. */
  contract: z.enum([...MANUAL_CONTRACTS, "unknown"]).optional(),
  /** Pagination : 20 offres par page par défaut. */
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const IdParams = z.object({ id: z.string().min(1).max(64) });
const StatusBody = z.object({ status: z.enum(JOB_STATUSES) });
/** Infos obligatoires d'une candidature : canal d'envoi, CV utilisé, et contrat si l'offre ne le dit pas. */
const ApplyInfo = z.object({ channel: z.enum(APPLY_CHANNELS), cv: z.enum(APPLY_CVS), contractType: z.enum(MANUAL_CONTRACTS).optional() });
const FullTextBody = z.object({
  text: z.string().max(60_000),
  /** Expérience demandée lue par l'IA (sinon lue dans le texte). */
  experienceYears: z.number().int().min(0).max(30).nullish(),
  /** Autres infos lues par l'IA (complètent ce que la source ne donne pas). */
  info: z
    .object({
      contractType: z.enum(["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE"]).nullish(),
      remoteType: z.enum(["remote", "hybrid", "onsite", "unknown"]).nullish(),
      salaryMin: z.number().int().min(8000).max(500_000).nullish(),
      salaryMax: z.number().int().min(8000).max(500_000).nullish(),
    })
    .nullish(),
});
/** Corrections saisies à la main : un champ absent garde la valeur de la source. */
const EditsBody = z
  .object({
    title: z.string().trim().min(1).max(300),
    company: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(120),
    department: z.string().trim().regex(/^(\d{2,3}|2[AB])$/i, "Département : numéro (ex. 60)").transform((d) => d.toUpperCase()),
    contractType: z.enum(["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE"]),
    remoteType: z.enum(["remote", "hybrid", "onsite", "unknown"]),
    salaryMin: z.number().int().min(8000).max(500_000),
    salaryMax: z.number().int().min(8000).max(500_000),
    experienceMinYrs: z.number().int().min(0).max(30),
  })
  .partial()
  .strict()
  .refine((e) => !e.salaryMin || !e.salaryMax || e.salaryMin <= e.salaryMax, "Salaire minimum supérieur au maximum");
const FindBody = z.object({
  url: z.string().max(2000).optional(),
  title: z.string().max(300).optional(),
  company: z.string().max(200).optional(),
});

export async function jobRoutes(
  app: FastifyInstance,
  opts: {
    jobs: JobService;
    stores: Stores;
    ensureTravel?: (jobId: string) => Promise<string | null>;
    /** Annonce complète collée : score recalculé (mail « à postuler » s'il reste bon). */
  },
) {
  const { jobs } = opts;
  app.addHook("preHandler", requireAuth);

  // ───── Offres ajoutées à la main ─────
  app.get("/api/jobs/manual", async (request) => ({ items: await jobs.listManual(request.userId!) }));

  // Lecture de l'annonce collée (sans IA) : pré-remplit le formulaire, rien n'est enregistré.
  app.post("/api/jobs/manual/analyze", async (request, reply) => {
    const body = z.object({ text: z.string().max(30_000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_TEXT" });
    return analyzeJobText(body.data.text);
  });

  // Lien d'une offre : le serveur lit la page et renvoie le même paquet que l'extension (rien n'est enregistré).
  app.post("/api/jobs/manual/from-url", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = z.object({ url: z.string().trim().min(8).max(2000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_URL", message: "Colle le lien complet de l'offre (https://…)." });
    try {
      return await readJobFromUrl(body.data.url);
    } catch (e) {
      if (e instanceof UrlReadError) return reply.code(422).send({ error: "URL_UNREADABLE", message: e.message });
      throw e;
    }
  });

  app.post("/api/jobs/manual", async (request, reply) => {
    const body = ManualJobSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "INVALID_JOB",
        issues: body.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const saved = await opts.stores.jobs.addManual(request.body);
    if (!saved) return reply.code(400).send({ error: "INVALID_JOB" });
    const job = await jobs.get(request.userId!, saved.jobId);
    return reply.code(201).send({ job, duplicate: saved.duplicate, otherSources: saved.otherSources });
  });

  app.delete("/api/jobs/manual/:id", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const r = await opts.stores.jobs.removeManual(params.data.id);
    if (r === "not_found") return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    if (r === "not_manual") return reply.code(400).send({ error: "NOT_MANUAL", message: "Cette offre n'a pas été ajoutée à la main." });
    return { result: r };
  });

  app.get("/api/jobs", async (request, reply) => {
    const query = ListQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    const { limit, offset, ...filters } = query.data;
    const all = await jobs.list(request.userId!, filters);
    return { items: all.slice(offset, offset + limit), total: all.length, offset, limit };
  });

  // Toutes les offres, expirées comprises : l'évolution a besoin de l'historique.
  app.get("/api/jobs/stats", async (request) => {
    const [items, rec] = await Promise.all([
      jobs.list(request.userId!, { status: "all", includeHidden: true, minScore: 0, sort: "date" }),
      opts.stores.profiles.get(request.userId!),
    ]);
    const p = rec!.profile; // jobs.list a déjà vérifié que le profil existe
    return skillStats(items, { experienceMax: p.experienceMax, threshold: p.minScoreForNotification });
  });

  app.get("/api/jobs/:id", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    // Trajet calculé à l'ouverture, sans faire attendre la page : au-delà de TRAVEL_WAIT_MS, l'offre s'affiche
    // avec « travelPending » et la page redemande un peu plus tard. Une erreur (quota, réseau) n'empêche rien.
    let travelIssue: string | null = null;
    let travelPending = false;
    if (opts.ensureTravel) {
      const r = await Promise.race([travelOf(params.data.id, request.log), new Promise<"pending">((ok) => setTimeout(() => ok("pending"), TRAVEL_WAIT_MS))]);
      if (r === "pending") travelPending = true;
      else travelIssue = r;
    }
    const job = await jobs.get(request.userId!, params.data.id);
    if (!job) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    return { ...job, travelIssue, travelPending };
  });

  /** Un seul calcul en cours par offre : la page qui redemande attend le même, sans second appel au calculateur. */
  const inflight = new Map<string, Promise<string | null>>();
  function travelOf(id: string, log: import("fastify").FastifyBaseLogger): Promise<string | null> {
    let p = inflight.get(id);
    if (!p) {
      p = opts
        .ensureTravel!(id)
        .catch((err) => {
          log.warn({ err }, "calcul du trajet impossible");
          return err instanceof Error ? err.message.split("\n")[0]!.slice(0, 200) : "erreur inconnue";
        })
        .finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    return p;
  }

  /**
   * Vérifie et enregistre canal, CV (et contrat s'il manque à l'offre). Renvoie un message d'erreur si quelque chose
   * manque, sinon null. `save: false` : vérifie seulement.
   */
  async function applyInfo(id: string, body: unknown, save: boolean): Promise<{ status: number; error: string; message: string } | null> {
    const row = await opts.stores.jobs.get(id);
    if (!row) return { status: 404, error: "JOB_NOT_FOUND", message: "Offre introuvable." };
    const b = ApplyInfo.partial().catch({}).parse(body ?? {}); // une valeur inconnue compte comme absente
    const missing = [
      !b.channel && "le canal d'envoi",
      !b.cv && "le CV utilisé",
      !row.contractType && !b.contractType && "le type de contrat",
    ].filter(Boolean);
    const info = ApplyInfo.safeParse(b);
    if (missing.length || !info.success) {
      return { status: 400, error: "APPLY_INFO_MISSING", message: `Pour enregistrer la candidature, indique ${missing.join(", ")}.` };
    }
    if (!save) return null;
    await opts.stores.jobs.setApplyInfo(id, info.data);
    // Contrat inconnu de l'offre : enregistré comme une correction à la main (il compte aussi pour le score).
    if (!row.contractType && info.data.contractType) await opts.stores.jobs.setEdits(id, { ...(row.userEdits ?? {}), contractType: info.data.contractType });
    return null;
  }

  const setStatus = (status?: (typeof JOB_STATUSES)[number]) =>
    async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
      let target = status;
      if (!target) {
        const body = StatusBody.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: "INVALID_STATUS" });
        target = body.data.status;
      }
      // « Postulé » une première fois : déjà postulé à la même offre vue sur un autre site ? On demande confirmation.
      // (Une offre déjà postulée, remise en attente après un refus, ne redemande rien.)
      const confirmed = z.object({ confirmDuplicate: z.literal(true) }).safeParse(request.body).success;
      const firstApply = target === "APPLIED" && !(await jobs.wasApplied(params.data.id));
      if (firstApply) {
        const bad = await applyInfo(params.data.id, request.body, false);
        if (bad) return reply.code(bad.status).send({ error: bad.error, message: bad.message });
      }
      if (firstApply && !confirmed) {
        const twins = await jobs.appliedTwins(params.data.id);
        if (twins.length) {
          const t = twins[0]!;
          return reply.code(409).send({
            error: "ALREADY_APPLIED",
            message: `Tu as déjà postulé à cette offre le ${t.appliedAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} (vue sur ${t.sources.join(", ")}) : « ${t.title} ». Confirme si c'est bien une autre candidature.`,
            twins,
          });
        }
      }
      const job = await jobs.setStatus(request.userId!, params.data.id, target);
      if (!job) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
      // « Postulé » : on mémorise quel CV exporté a été envoyé (modèle + date).
      if (target === "APPLIED") await opts.stores.tailoredCvs.markSent(params.data.id, new Date());
      if (firstApply) {
        await applyInfo(params.data.id, request.body, true);
        return jobs.get(request.userId!, params.data.id);
      }
      return job;
    };

  // ───── Annonce complète collée (quand la source ne donne qu'un extrait) ─────
  app.put("/api/jobs/:id/full-text", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const body = FullTextBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_TEXT", message: "Texte trop long." });
    const text = cleanFullText(body.data.text);
    if (text.length < 300) {
      return reply.code(400).send({ error: "TEXT_TOO_SHORT", message: "Texte trop court : colle toute la page de l'annonce (Ctrl + A, Ctrl + C)." });
    }
    const row = await opts.stores.jobs.setFullText(params.data.id, {
      text,
      experienceYears: body.data.experienceYears ?? analyzeJobText(text).experienceYears,
      info: body.data.info ?? null,
    });
    if (!row) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const detail = await jobs.get(request.userId!, params.data.id);
    return detail;
  });

  // ───── Infos corrigées à la main (entreprise, lieu, contrat, salaire… manquants ou faux) ─────
  app.put("/api/jobs/:id/edits", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const body = EditsBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_EDITS", message: body.error.issues[0]?.message ?? "Infos invalides." });
    const empty = Object.keys(body.data).length === 0;
    const row = await opts.stores.jobs.setEdits(params.data.id, empty ? null : body.data);
    if (!row) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    return jobs.get(request.userId!, params.data.id);
  });

  // Page envoyée par l'extension (ou collée) : est-ce une offre déjà connue par un simple extrait ?
  app.post("/api/jobs/find-abridged", async (request, reply) => {
    const body = FindBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    const job = await jobs.findAbridged(body.data);
    return { job: job ? { id: job.id, title: job.title, company: job.company, sources: job.sources.map((s) => s.source) } : null };
  });

  // Page envoyée par l'extension : offre déjà en base avec le même lien ? (on l'ouvre au lieu de la relire)
  app.post("/api/jobs/find-by-url", async (request, reply) => {
    const body = z.object({ url: z.string().max(2000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    const job = await jobs.findByUrl(body.data.url);
    // descriptionLength : annonce trop courte (JobScraper ne donne parfois qu'un résumé) → l'extension la complète.
    return { job: job ? { id: job.id, title: job.title, company: job.company, descriptionLength: job.description.trim().length } : null };
  });

  app.delete("/api/jobs/:id/full-text", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const row = await opts.stores.jobs.setFullText(params.data.id, null);
    if (!row) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    return jobs.get(request.userId!, params.data.id);
  });

  // Candidature déjà envoyée sans canal / CV / contrat : on les complète.
  app.put("/api/jobs/:id/application-info", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const bad = await applyInfo(params.data.id, request.body, true);
    if (bad) return reply.code(bad.status).send({ error: bad.error, message: bad.message });
    return jobs.get(request.userId!, params.data.id);
  });

  app.post("/api/jobs/:id/status", setStatus());
  app.post("/api/jobs/:id/save", setStatus("SAVED"));
  app.post("/api/jobs/:id/apply", setStatus("APPLIED"));
  app.post("/api/jobs/:id/ignore", setStatus("IGNORED"));
}
