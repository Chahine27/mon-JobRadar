import { DEFAULT_PROFILE } from "@job-radar/shared";
import { FT_SOURCE, type JobSource, type RawJob, SourceUnavailableError } from "@job-radar/source-connectors";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../../db/test/helpers";
import { collectOnce } from "./collect";

const prisma = testPrisma();
beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

/** Annonce Adzuna lisible par le normaliseur (la source simulée ne fait que la transmettre). */
const adz = (id: string): RawJob => ({
  source: "adzuna",
  sourceJobId: id,
  data: { id, title: `Dev ${id}`, redirect_url: `https://www.adzuna.fr/details/${id}`, description: "Développeur Node.js pour une banque.", company: { display_name: `Boîte ${id}` }, location: { display_name: "Paris", area: ["France", "Ile-de-France", "Paris"] }, created: new Date().toISOString() },
  collectedAt: new Date(),
});
const source = (name: string, extra: Partial<JobSource> = {}): JobSource & { asked: string[] } => {
  const asked: string[] = [];
  return { name, asked, search: async (q) => (asked.push(`${q.keywords}${q.beginnersOnly ? " (débutants)" : ""}`), []), healthCheck: async () => ({ status: "OK" }), ...extra };
};
const run = (sources: JobSource[], extra: object = {}) => collectOnce({ prisma, sources, profile: DEFAULT_PROFILE, trigger: "manual", ...extra });

describe("collecte d'une ou plusieurs sources (base réelle, sources simulées)", () => {
  it("recherche par recherche : offres enregistrées, doublons d'une recherche à l'autre regroupés, trace de la collecte", async () => {
    const queries = DEFAULT_PROFILE.searches.length * DEFAULT_PROFILE.locations.length;
    const src = source("adzuna", { search: async (q) => (q.keywords === DEFAULT_PROFILE.searches[0] ? [adz("1"), adz("2")] : [adz("2")]) });
    const progress: Array<{ done: number; total: number; found: number }> = [];
    const events: string[] = [];
    const r = await run([src], { onSource: (n: string) => events.push(`début ${n}`), onProgress: (_: string, p: (typeof progress)[number]) => progress.push(p), onSourceDone: (s: { source: string }) => events.push(`fin ${s.source}`) });
    expect(r).toMatchObject({ status: "done", fetched: 2, created: 2, updated: 0, duplicates: 0, rejected: 0 });
    expect(r.sources).toMatchObject([{ source: "adzuna", status: "OK", fetched: 2, errors: [] }]);
    expect(events).toEqual(["début adzuna", "fin adzuna"]);
    expect(progress[0]).toEqual({ done: 0, total: queries, found: 0 });
    expect(progress.at(-1)).toEqual({ done: queries, total: queries, found: 2 });
    expect(await prisma.job.count()).toBe(2);
    expect(await prisma.sourceRun.findFirstOrThrow()).toMatchObject({ source: "adzuna", status: "OK", fetched: 2, error: null });
    expect(await prisma.collectionRun.findFirstOrThrow()).toMatchObject({ status: "done", fetched: 2, created: 2 });
    // Relancée : rien de nouveau.
    expect(await run([src])).toMatchObject({ created: 0, unchanged: 2 });
  });

  it("annonce illisible : comptée « rejetée », les autres sont enregistrées", async () => {
    const bad: RawJob = { source: "adzuna", sourceJobId: "bad", data: { id: "bad" }, collectedAt: new Date() };
    const r = await run([source("adzuna", { search: async () => [adz("1"), bad] })]);
    expect(r).toMatchObject({ fetched: 2, created: 1, rejected: 1 });
  });

  it("France Travail : les recherches « débutants acceptés » s'ajoutent aux autres", async () => {
    const ft = source(FT_SOURCE);
    await run([ft]);
    expect(ft.asked.filter((q) => q.endsWith("(débutants)"))).toHaveLength(DEFAULT_PROFILE.locations.length);
    expect(ft.asked.length).toBe(DEFAULT_PROFILE.searches.length * DEFAULT_PROFILE.locations.length + DEFAULT_PROFILE.locations.length);
    // Les autres sources n'ont pas ces recherches en plus.
    const other = source("adzuna");
    await run([other]);
    expect(other.asked.some((q) => q.endsWith("(débutants)"))).toBe(false);
  });

  it("source « catalogue » (sites carrières) : une récupération, pas de recherche ; erreurs gardées", async () => {
    const careers = source("company-careers", { fetchAll: async () => ({ jobs: [adz("c1")], errors: ["Acme : page illisible"] }) });
    const r = await run([careers]);
    expect(careers.asked).toEqual([]);
    expect(r.sources[0]).toMatchObject({ status: "OK", fetched: 1, errors: ["Acme : page illisible"] });
    expect(await prisma.sourceRun.findFirstOrThrow()).toMatchObject({ error: "Acme : page illisible" });
    // Que des erreurs et aucune offre : la source est en erreur.
    const broken = source("company-careers", { fetchAll: async () => ({ jobs: [], errors: ["tout est cassé"] }) });
    expect((await run([broken])).sources[0]).toMatchObject({ status: "ERROR", fetched: 0 });
  });

  it("source à quota serré : reçoit toutes les recherches d'un coup, peut ne rien demander (ignorée)", async () => {
    let received = 0;
    const jooble = source("jooble", { searchAll: async (qs) => ((received = qs.length), { jobs: [adz("j1")], errors: [] }) });
    const r = await run([jooble]);
    expect(received).toBe(DEFAULT_PROFILE.searches.length * DEFAULT_PROFILE.locations.length);
    expect(jooble.asked).toEqual([]);
    expect(r).toMatchObject({ created: 1 });
    const logs: string[] = [];
    const skipped = source("jooble", { searchAll: async () => ({ jobs: [], errors: [], skipped: "trop tôt" }) });
    expect((await run([skipped], { log: (l: string) => logs.push(l) })).sources[0]).toMatchObject({ status: "OK", fetched: 0 });
    expect(logs).toContain("  jooble : ignorée (trop tôt)");
  });

  it("source indisponible : on s'arrête à la première recherche, les autres sources continuent", async () => {
    const down = source("adzuna", { search: async () => { throw new SourceUnavailableError("clé absente"); } });
    const ok = source("jobscraper:wttj", { search: async () => [adz("w1")] });
    const r = await run([down, ok]);
    expect(r.sources[0]).toMatchObject({ source: "adzuna", status: "SOURCE_UNAVAILABLE", errors: ["clé absente"] });
    expect(r.sources[1]).toMatchObject({ status: "OK", fetched: 1 });
    expect(r.status).toBe("partial");
    expect(await prisma.collectionRun.findFirstOrThrow()).toMatchObject({ status: "partial" });
  });

  it("recherches en erreur : une erreur n'arrête pas les suivantes ; toutes en erreur = source en erreur ; aucune source OK = échec", async () => {
    let n = 0;
    const flaky = source("adzuna", { search: async () => { if (n++ === 0) throw new Error("429"); return [adz("1")]; } });
    const logs: string[] = [];
    const r = await run([flaky], { log: (l: string) => logs.push(l) });
    expect(r.sources[0]).toMatchObject({ status: "OK", fetched: 1 });
    expect(r.sources[0]!.errors).toHaveLength(1);
    expect(r.sources[0]!.errors[0]).toMatch(/^« .+ » \d+ : 429$/);
    expect(logs.some((l) => l.includes("ERREUR 429"))).toBe(true);

    const dead = source("adzuna", { search: async () => { throw new Error("hors ligne"); } });
    const failed = await run([dead]);
    expect(failed.sources[0]).toMatchObject({ status: "ERROR", fetched: 0 });
    expect(failed.status).toBe("failed");
  });

  it("calendrier de la source : intervalle gardé, plus tard après un échec, remis à zéro après un succès", async () => {
    const ok = source("adzuna");
    await run([ok], { defaultIntervalMinutes: 90 });
    const first = await prisma.sourceState.findUniqueOrThrow({ where: { source: "adzuna" } });
    expect(first).toMatchObject({ failures: 0 });
    expect(first.lastSuccessAt).not.toBeNull();
    expect(first.intervalMinutes).toBeGreaterThanOrEqual(90);

    const dead = source("adzuna", { search: async () => { throw new SourceUnavailableError("non"); } });
    await run([dead]);
    const after = await prisma.sourceState.findUniqueOrThrow({ where: { source: "adzuna" } });
    expect(after.failures).toBe(1);
    expect(after.nextRunAt.getTime()).toBeGreaterThan(first.nextRunAt.getTime());
    await run([ok]);
    expect((await prisma.sourceState.findUniqueOrThrow({ where: { source: "adzuna" } })).failures).toBe(0);
  });

  it("collecte déjà créée par l'appelant : elle est réutilisée et mise à jour", async () => {
    const created = await prisma.collectionRun.create({ data: { trigger: "manual", status: "running" } });
    const r = await run([source("adzuna", { search: async () => [adz("1")] })], { runId: created.id });
    expect(r.runId).toBe(created.id);
    expect(await prisma.collectionRun.count()).toBe(1);
    expect(await prisma.collectionRun.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ status: "done", fetched: 1 });
    expect((await prisma.collectionRun.findUniqueOrThrow({ where: { id: created.id } })).finishedAt).not.toBeNull();
  });
});
