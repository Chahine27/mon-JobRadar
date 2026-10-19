import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyServerOptions, LogController } from "fastify";
import { SESSION_COOKIE, resolveSession } from "./auth";
import { createJobService } from "./jobs/service";
import { type AiService, type AutoFeed, aiRoutes } from "./routes/ai";
import { authRoutes } from "./routes/auth";
import { cvRoutes } from "./routes/cv";
import type { CvEngine } from "@job-radar/cv-render";
import path from "node:path";
import { type Collector, collectionRoutes } from "./routes/collection";
import { type LeadsOptions, leadRoutes } from "./routes/leads";
import { notificationRoutes } from "./routes/notifications";
import { sourceRoutes } from "./routes/sources";
import type { Mailer, Notifier } from "@job-radar/notifications";
import { jobRoutes } from "./routes/jobs";
import { type MailTracker, applicationRoutes } from "./routes/applications";
import { type Geocoder, profileRoutes } from "./routes/profile";
import type { Stores } from "./stores";

export type AppOptions = {
  stores: Stores;
  /** Pause entre deux relances d'un envoi groupé (0 dans les tests). */
  followUpPauseMs?: number;
  /** Origine du front autorisée à appeler l'API (ex. http://localhost:5173). */
  appUrl: string;
  /** Cookie `Secure` (HTTPS) — true en production. */
  secureCookie: boolean;
  logger?: FastifyServerOptions["logger"];
  /** Collecte (bouton Actualiser + état). Absent → routes non exposées. */
  collector?: Collector;
  notifiers?: Notifier[];
  /** Lettre de motivation IA terminée : notification (le chemin est relatif à APP_URL). */
  onLetterReady?: (n: { title: string; body: string; path: string; tag: string }) => Promise<unknown>;
  /** Suivi des candidatures par les mails reçus (boîte lue en lecture seule). */
  mailTracker?: MailTracker;
  /** Annonce complète collée sur une offre : envoie le mail « à postuler » si le score reste bon. */
  vapidPublicKey?: string | null;
  /** Identifiants présents dans .env, par source (affichage page Sources). */
  sourcesConfigured?: Record<string, boolean>;
  /** Appels utilisés / limite, pour les sources à quota (Jooble). */
  sourceQuotas?: () => Promise<Record<string, { used: number; limit: number }>>;
  geocoder?: Geocoder;
  /** Service des offres créé : le serveur s'en sert pour préchauffer le feed (notes, trajets) en arrière-plan. */
  onJobService?: (jobs: ReturnType<typeof createJobService>) => void;
  /** Calcule le trajet d'une offre si besoin (à son ouverture). */
  ensureTravel?: (jobId: string) => Promise<string | null>;
  searchCompanies?: LeadsOptions["searchCompanies"];
  /** IA locale (Ollama) : résumé et analyse des offres. */
  ai?: AiService;
  /** Vérification IA du flux lançable par le serveur (fin de collecte), remplie par les routes IA. */
  autoFeed?: AutoFeed;
  /** Envoi des candidatures spontanées par email (compte SMTP de .env). */
  mailer?: Mailer;
  /** CV adapté : navigateur pour l'ajustement à une page et le PDF (absent → pas de PDF). */
  cvEngine?: CvEngine;
  /** Fichier de départ du CV complet (défaut : data/cv/cv-master.seed.yaml à la racine). */
  cvSeedPath?: string;
};

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function buildApp(opts: AppOptions) {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 256 * 1024,
    // Pas une ligne par requête (le site interroge l'état de la collecte régulièrement) ; les erreurs restent journalisées.
    logController: new LogController({ disableRequestLogging: true }),
  });
  // + le site ouvert sur ce PC par le tunnel SSH (secours quand APP_URL est l'adresse Tailscale du serveur).
  const allowedOrigins = new Set([new URL(opts.appUrl).origin, "http://localhost:5173"]);

  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest("userId", null);

  // Erreur interne : on la journalise, mais on ne renvoie aucun détail (chemins, requêtes SQL...).
  app.setErrorHandler((error: { statusCode?: number; message: string }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error(error);
      return reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
    return reply.code(status).send({ error: error.message });
  });

  // Protection CSRF : un navigateur envoie toujours l'en-tête Origin sur un POST/PUT.
  // S'il vient d'un autre site → refusé. (En plus du cookie SameSite=Strict.)
  app.addHook("onRequest", async (request, reply) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return reply.code(403).send({ error: "FORBIDDEN_ORIGIN" });
    }
  });

  app.addHook("onRequest", async (request) => {
    request.userId = await resolveSession(opts.stores.sessions, request.cookies[SESSION_COOKIE]);
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(authRoutes, { stores: opts.stores, secureCookie: opts.secureCookie });
  await app.register(profileRoutes, { stores: opts.stores, ...(opts.geocoder ? { geocoder: opts.geocoder } : {}) });
  // Un seul service : le cache des scores est partagé, et l'avis de l'IA corrige les scores trop optimistes.
  const jobService = createJobService(opts.stores, undefined, opts.ai ? { aiModel: opts.ai.model } : {});
  opts.onJobService?.(jobService);
  await app.register(jobRoutes, {
    jobs: jobService,
    stores: opts.stores,
    ...(opts.ensureTravel ? { ensureTravel: opts.ensureTravel } : {}),
  });
  await app.register(applicationRoutes, { stores: opts.stores, jobs: jobService, ...(opts.mailTracker ? { mailTracker: opts.mailTracker } : {}) });
  await app.register(aiRoutes, { stores: opts.stores, jobs: jobService, ...(opts.ai ? { ai: opts.ai } : {}), ...(opts.mailer ? { mailer: opts.mailer } : {}), ...(opts.onLetterReady ? { onLetterReady: opts.onLetterReady } : {}), ...(opts.autoFeed ? { autoFeed: opts.autoFeed } : {}), ...(opts.followUpPauseMs !== undefined ? { followUpPauseMs: opts.followUpPauseMs } : {}) });
  await app.register(cvRoutes, {
    stores: opts.stores,
    seedPath: opts.cvSeedPath ?? path.resolve(import.meta.dirname, "../../../data/cv/cv-master.seed.yaml"),
    aiModel: opts.ai?.model,
    engine: opts.cvEngine,
  });
  if (opts.cvEngine) {
    const engine = opts.cvEngine;
    app.addHook("onClose", () => engine.close());
  }
  if (opts.collector) await app.register(collectionRoutes, { collector: opts.collector, jobs: jobService });
  await app.register(leadRoutes, {
    stores: opts.stores,
    ...(opts.searchCompanies ? { searchCompanies: opts.searchCompanies } : {}),
  });
  await app.register(sourceRoutes, { stores: opts.stores, configured: opts.sourcesConfigured ?? {}, quotas: opts.sourceQuotas });
  await app.register(notificationRoutes, {
    stores: opts.stores,
    notifiers: opts.notifiers ?? [],
    vapidPublicKey: opts.vapidPublicKey ?? null,
  });

  return app;
}
