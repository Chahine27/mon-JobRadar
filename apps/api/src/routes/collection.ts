import type { CollectionStatus, StartResult } from "@job-radar/pipeline";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth";
import type { createJobService } from "../jobs/service";

/** Ce dont les routes ont besoin du CollectionRunner (interface → testable). */
export interface Collector {
  start(trigger: "manual"): Promise<StartResult | null>;
  status(): Promise<CollectionStatus>;
  /** Relance une source (page Réglages) ; « jobscraper » = tous les sites JobScraper actifs. null → source inconnue ou inactive. */
  startSource(source: string): Promise<StartResult | null>;
}

export async function collectionRoutes(app: FastifyInstance, opts: { collector: Collector; jobs?: Pick<ReturnType<typeof createJobService>, "list"> }) {
  app.addHook("preHandler", requireAuth);

  // README §13 : empêche les refresh simultanés, lance la collecte en arrière-plan.
  app.post(
    "/api/jobs/refresh",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (_request, reply) => {
      const res = await opts.collector.start("manual");
      if (!res) return reply.code(409).send({ error: "NO_ENABLED_SOURCE" });
      return reply.code(202).send(res);
    },
  );

  app.post(
    "/api/sources/:source/refresh",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { source } = request.params as { source: string };
      const res = await opts.collector.startSource(source);
      if (!res) return reply.code(409).send({ error: "SOURCE_DISABLED", message: "Source inactive (page Sources) ou non configurée." });
      return reply.code(202).send(res);
    },
  );

  // Compteur gardé 30 s : l'état est lu toutes les 2 s pendant une collecte, et recalculer tout le flux à chaque fois
  // (offres neuves = scores pas encore en cache) saturait le serveur (réponses en 2 min, toutes les pages ralenties).
  let newJobs: { userId: string; at: number; count: Promise<number> } | null = null;
  app.get("/api/collection/status", async (request) => {
    const status = await opts.collector.status();
    const jobs = opts.jobs;
    if (!jobs) return status;
    const userId = request.userId!;
    if (!newJobs || newJobs.userId !== userId || Date.now() - newJobs.at > 30_000) {
      // Nouvelles offres de ton flux, pas toutes celles en base (hors zone, senior… masquées : 1 498 au lieu de ~100).
      const count = jobs.list(userId, { status: "NEW", includeHidden: false, minScore: 0, sort: "score" }).then((f) => f.length);
      newJobs = { userId, at: Date.now(), count };
      count.catch(() => (newJobs = null));
    }
    return { ...status, newJobs: await newJobs.count };
  });
}
