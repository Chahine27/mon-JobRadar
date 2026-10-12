import type { PrismaClient } from "@job-radar/db";
import { parseProfile, type Profile } from "@job-radar/shared";
import type { JobSource } from "@job-radar/source-connectors";
import { type CollectReport, collectOnce } from "./collect";
import { type PublishedDays, daysToFetch, dueSources } from "./schedule";

/** Une collecte « en cours » depuis plus longtemps est considérée comme plantée. */
export const STALE_RUN_MS = 15 * 60_000;

/** scraper = file JobScraper, indépendante du bouton « Actualiser » (sites lents, scrapés). */
export type RunTrigger = "manual" | "scheduler" | "scraper";

export type SourceStatus = {
  source: string;
  enabled: boolean;
  intervalMinutes: number;
  failures: number;
  lastSuccessAt: Date | null;
  nextRunAt: Date;
  lastStatus: string | null;
  lastError: string | null;
};

export type CollectionStatus = {
  running: boolean;
  lastRun: {
    id: string;
    trigger: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    fetched: number;
    created: number;
    duplicates: number;
  } | null;
  sources: SourceStatus[];
  newJobs: number;
};

/** Accès base dont le runner a besoin (interface → testable sans PostgreSQL). */
export interface RunRepo {
  createRun(trigger: RunTrigger): Promise<string>;
  failRun(runId: string, error: string): Promise<void>;
  /** `scraper` : ne regarde que les collectes de la file JobScraper (sinon : toutes les autres). */
  findActiveRun(since: Date, scraper: boolean): Promise<string | null>;
  markStaleRunsFailed(before: Date, scraper: boolean): Promise<number>;
  sourceStates(): Promise<SourceStatus[]>;
  status(scraper: boolean): Promise<Omit<CollectionStatus, "running">>;
  loadProfile(): Promise<Profile>;
}

export type Collect = (args: {
  runId: string;
  trigger: RunTrigger;
  sources: JobSource[];
  profile: Profile;
  publishedSinceDays: PublishedDays;
  keepSchedule?: boolean;
}) => Promise<CollectReport>;

export type RunnerOptions = {
  repo: RunRepo;
  sources: JobSource[];
  collect: Collect;
  now?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Appelé à la fin de chaque collecte (notifications à l'étape 10). */
  onFinished?: (report: CollectReport) => Promise<void> | void;
  /** Déclencheur des collectes planifiées ; "scraper" = file séparée (ses collectes ne bloquent pas l'autre file). */
  schedulerTrigger?: "scheduler" | "scraper";
  /** Au-delà, une collecte « en cours » est considérée comme plantée (défaut STALE_RUN_MS). */
  staleMs?: number;
};

export type StartResult = { status: "started" | "already_running"; runId: string };

/**
 * Lance les collectes : jamais deux en même temps, sources dues uniquement pour le planificateur,
 * toutes les sources actives pour le bouton « Actualiser ».
 */
export class CollectionRunner {
  private current: { runId: string; done: Promise<void> } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;

  private readonly scraper: boolean;
  private readonly staleMs: number;

  constructor(private readonly opts: RunnerOptions) {
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? (() => {});
    this.scraper = opts.schedulerTrigger === "scraper";
    this.staleMs = opts.staleMs ?? STALE_RUN_MS;
  }

  get isRunning() {
    return this.current !== null;
  }

  /** Attend la fin de la collecte en cours (utile pour les tests et l'arrêt propre). */
  async idle() {
    await this.current?.done;
  }

  /** `keepSchedule` : relance à la main d'une source (page Réglages), sans toucher au rythme des collectes automatiques. */
  async start(trigger: RunTrigger, only?: string[], keepSchedule = false): Promise<StartResult | null> {
    if (this.current) return { status: "already_running", runId: this.current.runId };
    const other = await this.opts.repo.findActiveRun(new Date(this.now().getTime() - this.staleMs), this.scraper);
    if (other) return { status: "already_running", runId: other };

    const states = await this.opts.repo.sourceStates();
    const enabled = new Set(states.filter((s) => s.enabled).map((s) => s.source));
    const wanted = this.opts.sources.filter((s) => enabled.has(s.name) && (!only || only.includes(s.name)));
    if (wanted.length === 0) return null;

    const oldest = states
      .filter((s) => wanted.some((w) => w.name === s.source))
      .map((s) => s.lastSuccessAt)
      .reduce<Date | null>((a, b) => (a === null || b === null ? null : a < b ? a : b), new Date(8.64e15));
    const days = daysToFetch(oldest, this.now());

    const runId = await this.opts.repo.createRun(trigger);
    const done = (async () => {
      try {
        const profile = await this.opts.repo.loadProfile();
        this.log(`Collecte ${trigger} : ${wanted.map((s) => s.name).join(", ")} (${days} j)`);
        const report = await this.opts.collect({ runId, trigger, sources: wanted, profile, publishedSinceDays: days, keepSchedule });
        this.log(`Collecte terminée : ${report.status}, ${report.created} nouvelle(s)`, report);
        await this.opts.onFinished?.(report);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`Collecte en échec : ${message}`);
        await this.opts.repo.failRun(runId, message).catch(() => {});
      } finally {
        this.current = null;
      }
    })();
    this.current = { runId, done };
    return { status: "started", runId };
  }

  /** Un tour du planificateur : ne lance que les sources dont l'heure est venue. */
  async tick(): Promise<StartResult | null> {
    if (this.current) return null;
    const due = dueSources(await this.opts.repo.sourceStates(), this.now());
    if (due.length === 0) return null;
    return this.start(this.opts.schedulerTrigger ?? "scheduler", due);
  }

  /** Démarre le planificateur (vérification toutes les `everyMs`). */
  async startScheduler(everyMs = 60_000) {
    try {
      // File JobScraper : seule cette API en lance, donc au démarrage une collecte « en cours » est forcément morte
      // (API arrêtée pendant la collecte) ; sans ça, la file attendrait staleMs (90 min) avant de repartir.
      const before = this.scraper ? this.now() : new Date(this.now().getTime() - this.staleMs);
      const cleaned = await this.opts.repo.markStaleRunsFailed(before, this.scraper);
      if (cleaned) this.log(`${cleaned} collecte(s) interrompue(s) marquée(s) en échec`);
    } catch (err) {
      this.log(`Planificateur : nettoyage impossible (${String(err)})`);
    }
    const safeTick = () => void this.tick().catch((err) => this.log(`Planificateur : ${String(err)}`));
    safeTick();
    this.timer = setInterval(safeTick, everyMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.idle();
  }

  async status(): Promise<CollectionStatus> {
    const s = await this.opts.repo.status(this.scraper);
    return { ...s, running: this.current !== null || s.lastRun?.status === "running" };
  }
}

const lane = (scraper: boolean) => (scraper ? "scraper" : { not: "scraper" });

/** Implémentation PostgreSQL du RunRepo. */
export function createPrismaRunRepo(prisma: PrismaClient): RunRepo {
  return {
    async createRun(trigger) {
      return (await prisma.collectionRun.create({ data: { trigger, status: "running" } })).id;
    },
    async failRun(runId, error) {
      await prisma.collectionRun.update({ where: { id: runId }, data: { status: "failed", finishedAt: new Date() } });
      await prisma.sourceRun.create({ data: { runId, source: "pipeline", status: "ERROR", error: error.slice(0, 4000) } });
    },
    async findActiveRun(since, scraper) {
      const run = await prisma.collectionRun.findFirst({
        where: { status: "running", startedAt: { gte: since }, trigger: lane(scraper) },
        select: { id: true },
      });
      return run?.id ?? null;
    },
    async markStaleRunsFailed(before, scraper) {
      const r = await prisma.collectionRun.updateMany({
        where: { status: "running", startedAt: { lt: before }, trigger: lane(scraper) },
        data: { status: "failed", finishedAt: new Date() },
      });
      return r.count;
    },
    async sourceStates() {
      const states = await prisma.sourceState.findMany({ orderBy: { source: "asc" } });
      const lastRuns = await Promise.all(
        states.map((s) =>
          prisma.sourceRun.findFirst({ where: { source: s.source }, orderBy: { createdAt: "desc" }, select: { status: true, error: true } }),
        ),
      );
      return states.map((s, i) => ({
        source: s.source,
        enabled: s.enabled,
        intervalMinutes: s.intervalMinutes,
        failures: s.failures,
        lastSuccessAt: s.lastSuccessAt,
        nextRunAt: s.nextRunAt,
        lastStatus: lastRuns[i]?.status ?? null,
        lastError: lastRuns[i]?.error ?? null,
      }));
    },
    async status(scraper) {
      const [lastRun, sources, newJobs] = await Promise.all([
        prisma.collectionRun.findFirst({
          where: { trigger: lane(scraper) },
          orderBy: { startedAt: "desc" },
          select: { id: true, trigger: true, status: true, startedAt: true, finishedAt: true, fetched: true, created: true, duplicates: true },
        }),
        this.sourceStates(),
        prisma.job.count({ where: { status: "NEW" } }),
      ]);
      return { lastRun, sources, newJobs };
    },
    async loadProfile() {
      const row = await prisma.profile.findFirst();
      if (!row) throw new Error("Aucun profil en base : lance « pnpm db:seed »");
      return parseProfile(row.data);
    },
  };
}

/** Fonction de collecte réelle (PostgreSQL). */
export function prismaCollect(prisma: PrismaClient, defaultIntervalMinutes = 5, log?: (l: string) => void): Collect {
  return ({ runId, trigger, sources, profile, publishedSinceDays, keepSchedule }) =>
    collectOnce({ prisma, runId, trigger, sources, profile, publishedSinceDays, defaultIntervalMinutes, keepSchedule, ...(log ? { log } : {}) });
}
