import { DEFAULT_PROFILE } from "@job-radar/shared";
import type { JobSource } from "@job-radar/source-connectors";
import { describe, expect, it } from "vitest";
import type { CollectReport } from "./collect";
import { type Collect, CollectionRunner, type RunRepo, type SourceStatus } from "./runner";
import { adzunaMinIntervalMinutes, minIntervalFor } from "./quota";
import { computeNextRunAt, daysToFetch, dueSources } from "./schedule";

const NOW = new Date("2026-09-28T12:00:00Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

describe("quotas", () => {
  it("Adzuna : 12 appels par collecte → toutes les 90 min (≤ 200 appels/jour)", () => {
    expect(adzunaMinIntervalMinutes(12)).toBe(90);
    expect((1440 / adzunaMinIntervalMinutes(12)) * 12).toBeLessThanOrEqual(200);
    expect(adzunaMinIntervalMinutes(30)).toBe(240);
    expect(minIntervalFor("france-travail", 12)).toBe(5);
    expect(minIntervalFor("company-careers", 12)).toBe(30);
    expect(minIntervalFor("jobscraper:linkedin", 12)).toBe(15);
  });
});

describe("planification", () => {
  it("daysToFetch couvre le temps écoulé", () => {
    expect(daysToFetch(null, NOW)).toBe(31);
    expect(daysToFetch(min(-5), NOW)).toBe(1);
    expect(daysToFetch(min(-60 * 30), NOW)).toBe(3);
    expect(daysToFetch(min(-60 * 24 * 5), NOW)).toBe(7);
    expect(daysToFetch(min(-60 * 24 * 60), NOW)).toBe(31);
  });

  it("backoff : 5, 10, 20, 40 min puis plafonné", () => {
    expect([0, 1, 2, 3, 6].map((f) => (computeNextRunAt(NOW, 5, f).getTime() - NOW.getTime()) / 60_000)).toEqual([
      5, 10, 20, 40, 40,
    ]);
  });

  it("dueSources : actives et dont l'heure est venue", () => {
    expect(
      dueSources(
        [
          { source: "a", enabled: true, nextRunAt: min(-1) },
          { source: "b", enabled: true, nextRunAt: min(3) },
          { source: "c", enabled: false, nextRunAt: min(-10) },
        ],
        NOW,
      ),
    ).toEqual(["a"]);
  });
});

function state(source: string, extra: Partial<SourceStatus> = {}): SourceStatus {
  return {
    source,
    enabled: true,
    intervalMinutes: 5,
    failures: 0,
    lastSuccessAt: min(-10),
    nextRunAt: min(-1),
    lastStatus: null,
    lastError: null,
    ...extra,
  };
}

function setup(opts: { states?: SourceStatus[]; activeInDb?: string | null; collect?: Collect } = {}) {
  const runs: Array<{ id: string; trigger: string; status: string }> = [];
  const repo: RunRepo = {
    createRun: async (trigger) => {
      const id = `run-${runs.length + 1}`;
      runs.push({ id, trigger, status: "running" });
      return id;
    },
    failRun: async (id) => {
      runs.find((r) => r.id === id)!.status = "failed";
    },
    findActiveRun: async () => opts.activeInDb ?? null,
    markStaleRunsFailed: async () => 0,
    sourceStates: async () => opts.states ?? [state("france-travail")],
    status: async () => ({ lastRun: null, sources: [], newJobs: 0 }),
    loadProfile: async () => DEFAULT_PROFILE,
  };
  const calls: Array<Parameters<Collect>[0]> = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const collect: Collect =
    opts.collect ??
    (async (args) => {
      calls.push(args);
      await gate;
      return { runId: args.runId, status: "done", fetched: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, rejected: 0, sources: [] } as CollectReport;
    });
  const sources: JobSource[] = [
    { name: "france-travail", search: async () => [], healthCheck: async () => ({ status: "OK" }) },
    { name: "adzuna", search: async () => [], healthCheck: async () => ({ status: "OK" }) },
  ];
  const runner = new CollectionRunner({ repo, sources, collect, now: () => NOW });
  return { runner, runs, calls, release };
}

describe("CollectionRunner", () => {
  it("lance une collecte et refuse d'en lancer une 2ᵉ en même temps", async () => {
    const { runner, calls, release } = setup();
    const a = await runner.start("manual");
    const b = await runner.start("manual");
    expect(a).toEqual({ status: "started", runId: "run-1" });
    expect(b).toEqual({ status: "already_running", runId: "run-1" });
    release();
    await runner.idle();
    expect(calls).toHaveLength(1);
    expect(runner.isRunning).toBe(false);
    expect((await runner.start("manual"))?.status).toBe("started");
  });

  it("respecte une collecte déjà en cours ailleurs (ex. pnpm collect)", async () => {
    const { runner } = setup({ activeInDb: "run-cli" });
    expect(await runner.start("manual")).toEqual({ status: "already_running", runId: "run-cli" });
  });

  it("n'utilise que les sources actives connues", async () => {
    const { runner, calls, release } = setup({
      states: [state("france-travail"), state("adzuna", { enabled: false }), state("inconnue")],
    });
    await runner.start("manual");
    release();
    await runner.idle();
    expect(calls[0]!.sources.map((s) => s.name)).toEqual(["france-travail"]);
  });

  it("planificateur : ne lance rien si aucune source n'est due", async () => {
    const { runner, calls } = setup({ states: [state("france-travail", { nextRunAt: min(3) })] });
    expect(await runner.tick()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("choisit la période selon la dernière collecte réussie", async () => {
    const { runner, calls, release } = setup({ states: [state("france-travail", { lastSuccessAt: null })] });
    await runner.tick();
    release();
    await runner.idle();
    expect(calls[0]!.publishedSinceDays).toBe(31);
    expect(calls[0]!.trigger).toBe("scheduler");
  });

  it("une collecte qui plante est marquée en échec et libère le verrou", async () => {
    const { runner, runs } = setup({
      collect: async () => {
        throw new Error("base injoignable");
      },
    });
    await runner.start("manual");
    await runner.idle();
    expect(runs[0]!.status).toBe("failed");
    expect(runner.isRunning).toBe(false);
  });
});

describe("file JobScraper séparée", () => {
  it("tourne en parallèle d'« Actualiser », qui ne la lance jamais", async () => {
    const runs: Array<{ id: string; trigger: string; status: string }> = [];
    const repo: RunRepo = {
      createRun: async (trigger) => {
        runs.push({ id: `run-${runs.length + 1}`, trigger, status: "running" });
        return runs.at(-1)!.id;
      },
      failRun: async () => {},
      // Comme la base : chaque file ne voit que ses propres collectes en cours.
      findActiveRun: async (_since, scraper) =>
        runs.find((r) => r.status === "running" && (r.trigger === "scraper") === scraper)?.id ?? null,
      markStaleRunsFailed: async () => 0,
      sourceStates: async () => [state("france-travail"), state("jobscraper:linkedin")],
      status: async () => ({ lastRun: null, sources: [], newJobs: 0 }),
      loadProfile: async () => DEFAULT_PROFILE,
    };
    const used: string[][] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const collect: Collect = async (args) => {
      used.push(args.sources.map((s) => s.name));
      await gate;
      return { runId: args.runId, status: "done", fetched: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, rejected: 0, sources: [] };
    };
    const source = (name: string): JobSource => ({ name, search: async () => [], healthCheck: async () => ({ status: "OK" }) });
    const main = new CollectionRunner({ repo, sources: [source("france-travail")], collect, now: () => NOW });
    const scraper = new CollectionRunner({ repo, sources: [source("jobscraper:linkedin")], collect, now: () => NOW, schedulerTrigger: "scraper" });

    expect((await scraper.tick())?.status).toBe("started");
    expect((await main.start("manual"))?.status).toBe("started");
    release();
    await Promise.all([main.idle(), scraper.idle()]);
    expect(runs.map((r) => r.trigger)).toEqual(["scraper", "manual"]);
    expect(used).toEqual([["jobscraper:linkedin"], ["france-travail"]]);
  });
});

describe("redémarrage de l'API", () => {
  it("file JobScraper : une collecte restée « en cours » est morte, elle ne bloque pas la file 90 min", async () => {
    const cutoffs: Array<[Date, boolean]> = [];
    const repo: RunRepo = {
      createRun: async () => "run-1",
      failRun: async () => {},
      findActiveRun: async () => null,
      markStaleRunsFailed: async (before, scraper) => {
        cutoffs.push([before, scraper]);
        return 1;
      },
      sourceStates: async () => [],
      status: async () => ({ lastRun: null, sources: [], newJobs: 0 }),
      loadProfile: async () => DEFAULT_PROFILE,
    };
    const collect: Collect = async (args) => ({ runId: args.runId, status: "done", fetched: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, rejected: 0, sources: [] });
    const scraper = new CollectionRunner({ repo, sources: [], collect, now: () => NOW, schedulerTrigger: "scraper", staleMs: 90 * 60_000 });
    const main = new CollectionRunner({ repo, sources: [], collect, now: () => NOW });
    await scraper.startScheduler(3_600_000);
    await main.startScheduler(3_600_000);
    await Promise.all([scraper.stop(), main.stop()]);
    expect(cutoffs).toEqual([
      [NOW, true], // tout de suite
      [new Date(NOW.getTime() - 15 * 60_000), false], // file principale : `pnpm collect` peut tourner à côté
    ]);
  });
});
