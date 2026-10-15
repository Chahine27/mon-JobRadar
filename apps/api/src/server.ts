import { writeFileSync } from "node:fs";
import { aiChain, analyzeJobWithAi, readApplicationMailWithAi, readJobWithAi, writeCoverLetter } from "@job-radar/ai";
import { createPrismaClient } from "@job-radar/db";
import {
  createEmailNotifier,
  createImapInbox,
  createMailer,
  imapHostFrom,
  createPrismaNotifyRepo,
  createWebPushNotifier,
  notifyNewMatches,
  notifyNotice,
} from "@job-radar/notifications";
import { type CollectReport, CollectionRunner, type RunnerOptions, completeJobScraperDescriptions, renormalizeJobs, trackApplicationMails, createPrismaRunRepo, expireJobs, prismaCollect, prismaJoobleQuota } from "@job-radar/pipeline";
import { OsrmRoutingService, PrimRoutingService, ensureTravelTimes, fillDepartments, geocode } from "@job-radar/routing";
import { scoreJob, scoringInputFromJob } from "@job-radar/scoring";
import { parseProfile, zoneDepartments } from "@job-radar/shared";
import {
  type AtsKind,
  AdzunaSource,
  CompanyCareersSource,
  FranceTravailSource,
  createJobScraperSources,
  JOOBLE_DEFAULTS,
  JoobleSource,
  JOBSCRAPER_SOURCE_NAMES,
  fetchJobScraperDetails,
  linkedinJobIsOpen,
  LaBonneBoiteClient,
} from "@job-radar/source-connectors";
import { buildApp } from "./app";
import { spawn } from "node:child_process";
import { createBrowserEngine } from "@job-radar/cv-render";
import type { AutoFeed } from "./routes/ai";
import type { MailTracker } from "./routes/applications";
import { loadEnv } from "./env";
import { createPrismaStores } from "./prisma-stores";

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);

let log: (msg: string) => void = (msg) => console.log(msg);
const e = process.env;

const notifiers = [
  createEmailNotifier({
    host: e.SMTP_HOST?.trim(),
    port: e.SMTP_PORT ? Number(e.SMTP_PORT) : undefined,
    user: e.SMTP_USER?.trim(),
    password: e.SMTP_PASSWORD?.replace(/\s/g, ""), // mot de passe d'application Gmail souvent collé avec des espaces
    from: e.SMTP_FROM?.trim(),
    to: async () => {
      const s = await prisma.notificationSettings.findUnique({ where: { id: "singleton" } });
      return s?.emailTo || e.NOTIFY_EMAIL_TO?.trim() || null;
    },
  }),
  createWebPushNotifier({
    publicKey: e.VAPID_PUBLIC_KEY?.trim(),
    privateKey: e.VAPID_PRIVATE_KEY?.trim(),
    subject: e.VAPID_SUBJECT?.trim() || (e.NOTIFY_EMAIL_TO ? `mailto:${e.NOTIFY_EMAIL_TO.trim()}` : undefined),
    subscriptions: {
      list: async () =>
        (await prisma.pushSubscription.findMany()).map((p) => ({
          endpoint: p.endpoint,
          keys: p.keys as { p256dh: string; auth: string },
        })),
      remove: async (endpoint) => void (await prisma.pushSubscription.deleteMany({ where: { endpoint } })),
    },
  }),
];
// Candidatures spontanées : envoyées depuis le même compte SMTP (Gmail), seulement après ton clic « Envoyer ».
const mailer = createMailer({
  host: e.SMTP_HOST?.trim(),
  port: e.SMTP_PORT ? Number(e.SMTP_PORT) : undefined,
  user: e.SMTP_USER?.trim(),
  password: e.SMTP_PASSWORD?.replace(/\s/g, ""),
});
const notifyRepo = createPrismaNotifyRepo(prisma);
// Trajets : transports (PRIM) pour l'Île-de-France, voiture (OSRM) ailleurs.
const routing = { transit: new PrimRoutingService({ apiKey: e.PRIM_API_KEY?.trim() }), car: new OsrmRoutingService(e.OSRM_URL?.trim() ? { baseUrl: e.OSRM_URL.trim() } : {}) };

/**
 * Préchauffe le feed en arrière-plan (au démarrage, après chaque collecte) : calcule les notes (sinon ~4 s au premier
 * affichage) et les trajets des offres affichées (sinon ~1 s à l'ouverture d'une offre). 60 itinéraires au plus par passage.
 */
let jobService: Parameters<NonNullable<Parameters<typeof buildApp>[0]["onJobService"]>>[0] | null = null;
let warming = false;
async function warmFeed() {
  if (!jobService || warming) return;
  warming = true;
  try {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) return;
    const feed = await jobService.list(user.id, { status: "active", includeHidden: false, minScore: 0, sort: "score" });
    await ensureTravelTimes({ prisma, ...routing, jobIds: feed.map((j) => j.id), maxRoutes: 60, log: (m) => log(m) });
  } catch (err) {
    log(`Préchargement du feed : ${String(err)}`);
  } finally {
    warming = false;
  }
}
const franceTravail = new FranceTravailSource({
  clientId: e.FRANCE_TRAVAIL_CLIENT_ID?.trim(),
  clientSecret: e.FRANCE_TRAVAIL_CLIENT_SECRET?.trim(),
});
/** Départements de ta zone : les offres ailleurs (masquées) ne déclenchent aucune requête vers les sites. */
async function currentZone() {
  const row = await prisma.profile.findFirst({ select: { data: true } });
  return row ? zoneDepartments(parseProfile(row.data)) : undefined;
}

/** Vérification des offres expirées : au plus toutes les 6 heures. */
let lastExpiryAt = 0;
// IA : Claude Haiku (ANTHROPIC_API_KEY) → Groq → Mistral (secours gratuits) → Ollama sur ce PC. Sans clé : Ollama seul.
const generalAi = aiChain(e, "general", (m) => log(m));
// Lettre de motivation : Claude Sonnet, mêmes secours (Ollama : OLLAMA_LETTER_MODEL s'il est réglé).
const letterAi = aiChain(e, "letter", (m) => log(m));
const joobleKey = e.JOOBLE_API_KEY?.trim();
const joobleQuota = prismaJoobleQuota(prisma, joobleKey);
const lbb = new LaBonneBoiteClient({ clientId: e.FRANCE_TRAVAIL_CLIENT_ID?.trim(), clientSecret: e.FRANCE_TRAVAIL_CLIENT_SECRET?.trim() });

const autoFeed: AutoFeed = {};
/** Dernier passage complet après une collecte (trajets, IA, notifications, préchauffage). */
let lastAfterCollectAt = 0;

/** Après une collecte : expiration, puis trajets → vérification IA → notifications des nouvelles offres compatibles. */
async function afterCollect(report: CollectReport, changed: boolean) {
  if (Date.now() - lastExpiryAt > 6 * 3600_000) {
    lastExpiryAt = Date.now();
    const zone = await currentZone();
    await expireJobs({
      prisma,
      ...(zone ? { zone } : {}),
      ftIsOnline: (id) => franceTravail.isStillOnline(id),
      // Offre LinkedIn close (« candidatures plus acceptées ») → expirée, retirée du flux.
      ...(env.JOBSCRAPER_ENABLED ? { linkedinIsOpen: (id: string) => linkedinJobIsOpen(id) } : {}),
      log: (m) => log(m),
    }).catch((err) =>
      log(`Expiration : ${String(err)}`),
    );
  }
  // Rien de nouveau ni de modifié : tout est déjà fait (France Travail passait toutes les 5 min pour ~1 offre par jour,
  // et chaque passage recalculait le flux 3 fois). Un passage par heure quand même : IA rallumée, avis en attente.
  if (!changed && Date.now() - lastAfterCollectAt < 3600_000) return;
  lastAfterCollectAt = Date.now();
  // Ville sans département (LinkedIn) : complété d'abord, le lieu, le score et le mode de trajet en dépendent.
  await fillDepartments({ prisma, log: (m) => log(m) }).catch((err) => log(`Départements : ${String(err)}`));
  const run = await prisma.collectionRun.findUnique({ where: { id: report.runId }, select: { startedAt: true } });
  const row = await prisma.profile.findFirst();
  if (!run || !row) return;
  const profile = parseProfile(row.data);
  // Offres pas encore annoncées des dernières 24 h : celle qui attendait l'avis de l'IA (Ollama éteint) a une nouvelle chance.
  const since = new Date(Math.min(run.startedAt.getTime(), Date.now() - 24 * 3600_000));
  // 1) temps de trajet des seules nouvelles offres qui peuvent être notifiées (≥ seuil − 5, car un bon
  //    trajet peut faire monter le score), 2) vérification IA, 3) notifications. Les autres : calcul à l'ouverture de l'offre.
  const candidates = await notifyRepo.candidates(since);
  const likely = candidates
    .filter((j) => {
      const s = scoreJob(scoringInputFromJob(j), profile);
      return !s.hidden && s.final >= profile.minScoreForNotification - 5;
    })
    .map((j) => j.id);
  await ensureTravelTimes({ prisma, ...routing, jobIds: likely, maxRoutes: 30, log: (m) => log(m) }).catch((err) =>
    log(`Trajets : ${String(err)}`),
  );
  // L'IA vérifie les meilleures offres du flux, même sans onglet ouvert (Ollama éteint : réessai à la collecte suivante).
  // Les notifications attendent son avis : jamais de mail pour une offre que l'IA aurait déclassée.
  await autoFeed.run?.(row.userId).catch((err) => log(`Vérification IA : ${String(err)}`));
  const aiScores = await autoFeed.scores?.(row.userId);
  await notifyNewMatches({
    repo: notifyRepo,
    notifiers,
    profile,
    since,
    appUrl: env.APP_URL,
    ...(aiScores ? { aiScores } : {}),
    log: (m) => log(m),
  });
  void warmFeed();
}

const runnerBase = {
  log: (msg) => log(msg),
  repo: createPrismaRunRepo(prisma),
  collect: prismaCollect(prisma, env.CRON_INTERVAL_MINUTES),
  onFinished: (report) => afterCollect(report, report.created + report.updated > 0),
} satisfies Omit<RunnerOptions, "sources">;

// Bouton « Actualiser » + planificateur : sources API (rapides).
const runner = new CollectionRunner({
  ...runnerBase,
  sources: [
    franceTravail,
    new AdzunaSource({ appId: e.ADZUNA_APP_ID?.trim(), appKey: e.ADZUNA_APP_KEY?.trim() }),
    new JoobleSource({ apiKey: joobleKey, quota: joobleQuota }),
    new CompanyCareersSource({
      companies: async () =>
        (await prisma.companyTarget.findMany()).map((c) => ({ ...c, ats: c.ats as AtsKind })),
    }),
  ],
});

// File JobScraper à part : planifiée seule (jamais par « Actualiser »), elle ne bloque pas les sources API
// pendant ses longues collectes, et un clic sur « Actualiser » ne repousse plus son prochain passage.
const scraperRunner = new CollectionRunner({
  ...runnerBase,
  sources: createJobScraperSources({
    enabled: env.JOBSCRAPER_ENABLED,
    path: env.JOBSCRAPER_PATH,
    ...(env.JOBSCRAPER_PYTHON ? { python: env.JOBSCRAPER_PYTHON } : {}),
    timeoutMs: env.JOBSCRAPER_TIMEOUT_MS,
  }),
  schedulerTrigger: "scraper",
  // D'abord : offres arrivées sans description ni date (LinkedIn, HelloWork) complétées depuis leur page publique.
  // Ensuite seulement trajets, IA et notifications : ils travaillent une seule fois, sur l'annonce entière.
  onFinished: async (report) => {
    const zone = await currentZone();
    const completed = await completeJobScraperDescriptions({ prisma, fetchDetails: (l) => fetchJobScraperDetails(l), ...(zone ? { zone } : {}), log: (m) => log(m) })
      .then((r) => r.completed)
      .catch((err) => (log(`Descriptions JobScraper : ${String(err)}`), 0));
    await afterCollect(report, report.created + report.updated + completed > 0);
  },
  // Un processus Python par recherche : une collecte peut durer bien plus de 15 min.
  staleMs: 90 * 60_000,
});

// Suivi des candidatures : réponses lues dans ta boîte (lecture seule), statuts mis à jour tout seuls.
const inbox = createImapInbox({
  host: env.IMAP_HOST.trim() || imapHostFrom(e.SMTP_HOST?.trim()),
  port: env.IMAP_PORT,
  user: e.SMTP_USER?.trim(),
  password: e.SMTP_PASSWORD?.replace(/\s/g, ""),
});
const tracking = { running: false, lastCheckAt: null as Date | null, lastError: null as string | null };
const mailTracker: MailTracker = {
  status: () => ({ configured: env.MAIL_TRACKING_ENABLED && inbox.isConfigured(), ...tracking }),
  async run({ full = false } = {}) {
    if (tracking.running || !mailTracker.status().configured) return;
    tracking.running = true;
    try {
      await trackApplicationMails({
        prisma,
        inbox,
        full,
        // Tes envois et les mails de Job Radar viennent de ces adresses : jamais des réponses.
        self: [e.SMTP_USER, e.NOTIFY_EMAIL_TO].map((a) => a?.trim()).filter((a): a is string => !!a),
        // Chaque mail qui peut répondre à une candidature est lu par l'IA (en panne : les règles suffisent).
        classify: (m, candidates) => readApplicationMailWithAi(generalAi, m, candidates),
        log: (m) => log(m),
      });
      tracking.lastCheckAt = new Date();
      tracking.lastError = null;
    } catch (err) {
      tracking.lastError = err instanceof Error ? err.message : String(err);
      log(`Suivi des mails : ${tracking.lastError}`);
    } finally {
      tracking.running = false;
    }
  },
};
let mailTimer: ReturnType<typeof setInterval> | null = null;

const app = await buildApp({
  onJobService: (s) => (jobService = s),
  mailTracker,
  autoFeed,
  stores: createPrismaStores(prisma),
  collector: {
    start: (trigger) => runner.start(trigger),
    // « running » : la file d'« Actualiser » seulement (le bouton) ; avancement source par source : les deux files.
    status: async () => {
      const [api, scraper] = await Promise.all([runner.status(), scraperRunner.status()]);
      return { ...api, progress: [...api.progress, ...scraper.progress] };
    },
    // Chaque source dans sa file : JobScraper ne bloque pas les sources API, et inversement.
    // « jobscraper » : tous ses sites actifs d'un coup (une seule file, ils passeraient de toute façon l'un après l'autre).
    startSource: (source) =>
      source === "jobscraper" ? scraperRunner.start("scraper", undefined, true) : runner.start("manual", [source], true),
  },
  notifiers,
  // Lettre de motivation terminée (offre ou candidature spontanée) : notification sur les canaux actifs.
  onLetterReady: ({ path, ...n }) => notifyNotice({ repo: notifyRepo, notifiers, notice: { ...n, url: new URL(path, env.APP_URL).href }, log: (m) => log(m) }),
  vapidPublicKey: e.VAPID_PUBLIC_KEY?.trim() || null,
  geocoder: (q) => geocode(q, { limit: 5 }),
  ...(lbb.isConfigured() ? { searchCompanies: (p: Parameters<LaBonneBoiteClient["search"]>[0]) => lbb.search(p) } : {}),
  // Trajet calculé à l'ouverture d'une offre (1 appel au plus, puis mis en cache).
  // Renvoie la raison si le trajet n'a pas pu être calculé (affichée sur la page de l'offre).
  ensureTravel: async (jobId) => {
    const report = await ensureTravelTimes({ prisma, ...routing, jobIds: [jobId], maxRoutes: 1, log: (m) => log(m) });
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { remoteType: true, travel: { select: { minutes: true, mode: true } } } });
    if (!job || job.remoteType === "remote") return null;
    if (job.travel?.minutes != null) return null;
    if (job.travel?.mode === "transit") return "aucun itinéraire en transports trouvé depuis ta gare d'arrivée";
    if (job.travel?.mode === "car") return "aucun itinéraire en voiture trouvé depuis ton domicile";
    return report.skipped ?? "lieu de l'offre inconnu ou hors zone";
  },
  sourcesConfigured: {
    "france-travail": Boolean(e.FRANCE_TRAVAIL_CLIENT_ID?.trim() && e.FRANCE_TRAVAIL_CLIENT_SECRET?.trim()),
    adzuna: Boolean(e.ADZUNA_APP_ID?.trim() && e.ADZUNA_APP_KEY?.trim()),
    jooble: Boolean(joobleKey),
    ...Object.fromEntries(JOBSCRAPER_SOURCE_NAMES.map((name) => [name, env.JOBSCRAPER_ENABLED])),
  },
  // Compteur Jooble affiché sur la page Sources (500 appels à vie par clé gratuite).
  sourceQuotas: async () => ({ jooble: { used: (await joobleQuota.get()).used, limit: JOOBLE_DEFAULTS.lifetimeLimit } }),
  ai: {
    model: generalAi.model,
    status: () => generalAi.status(),
    analyze: (job, profile) => analyzeJobWithAi(generalAi, job, profile),
    writeLetter: (job, kit, opts) => writeCoverLetter(letterAi, job, kit, new Date(), opts),
    readJob: (text, hints) => readJobWithAi(generalAi, text, hints),
  },
  mailer,
  // CV adapté : Edge (ou Chrome) sans fenêtre pour mesurer la page et créer le PDF, lancé à la première demande.
  cvEngine: createBrowserEngine(),
  openFolder: (dir) => void spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" }).unref(),
  appUrl: env.APP_URL,
  // Lancé par « Lancer Job Radar.cmd » : ce fichier demande au lanceur (qui surveille) de tout arrêter.
  ...(e.JOB_RADAR_STOP_FILE ? { stopApp: () => writeFileSync(e.JOB_RADAR_STOP_FILE!, "") } : {}),
  secureCookie: env.NODE_ENV === "production",
  logger:
    env.NODE_ENV === "development"
      ? { level: "info", transport: { target: "pino-pretty", options: { ignore: "pid,hostname" } } }
      : { level: "info" },
});

const shutdown = async () => {
  if (mailTimer) clearInterval(mailTimer);
  await Promise.all([runner.stop(), scraperRunner.stop()]);
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log = (msg) => app.log.info(msg);

// 127.0.0.1 : accessible uniquement depuis ton PC.
await app.listen({ host: env.API_HOST, port: env.API_PORT });
// Règles de normalisation changées depuis (contrat, expérience, compétences, salaire) : réappliquées aux offres déjà
// en base avant de préchauffer le flux, pour que les scores affichés suivent les règles du code. ~1 s, rien si à jour.
void renormalizeJobs({ prisma, log: (m) => log(m) })
  .catch((err) => log(`Réapplication des règles : ${String(err)}`))
  .then(() => warmFeed());

const on = notifiers.filter((n) => n.isConfigured()).map((n) => n.channel);
app.log.info(`Temps de trajet : voiture OSRM ; transports ${routing.transit.isConfigured() ? "PRIM configuré" : "non configuré (PRIM_API_KEY dans .env)"}`);
app.log.info(`Notifications configurées : ${on.length ? on.join(", ") : "aucune (voir .env)"}`);

if (env.SCHEDULER_ENABLED) {
  await runner.startScheduler(60_000);
  // Désactivé dans .env : pas de file JobScraper (sinon chaque passage compte un échec et repousse le suivant).
  if (env.JOBSCRAPER_ENABLED) await scraperRunner.startScheduler(60_000);
  app.log.info(`Collecte automatique active (vérification chaque minute, France Travail toutes les ${env.CRON_INTERVAL_MINUTES} min)`);
} else {
  app.log.info("Collecte automatique désactivée (SCHEDULER_ENABLED=false)");
}
if (mailTracker.status().configured) {
  void mailTracker.run();
  mailTimer = setInterval(() => void mailTracker.run(), 15 * 60_000);
  app.log.info("Suivi des candidatures par mail actif (toutes les 15 min, boîte lue en lecture seule)");
}
