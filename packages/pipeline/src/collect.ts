import type { PrismaClient } from "@job-radar/db";
import { normalize } from "@job-radar/job-normalizer";
import type { Profile } from "@job-radar/shared";
import { FT_SOURCE, type JobSource, type RawJob, type SearchParams, SourceUnavailableError } from "@job-radar/source-connectors";
import { ingestJob } from "./ingest";
import { JOOBLE_CHECK_MINUTES, minIntervalFor } from "./quota";
import { computeNextRunAt } from "./schedule";

export type CollectOptions = {
  prisma: PrismaClient;
  sources: JobSource[];
  profile: Profile;
  trigger: "manual" | "scheduler" | "scraper" | "cli";
  /** Collecte déjà créée par l'appelant (bouton Actualiser) ; sinon elle est créée ici. */
  runId?: string;
  /** Intervalle par défaut d'une source inconnue de SourceState. */
  defaultIntervalMinutes?: number;
  publishedSinceDays?: SearchParams["publishedSinceDays"];
  maxResultsPerSearch?: number;
  /** Relance à la main d'une source (page Réglages) : le rythme des collectes automatiques n'est pas touché. */
  keepSchedule?: boolean;
  log?: (line: string) => void;
  /** Appelé au début de chaque source (affichage « en cours : … »). */
  onSource?: (name: string) => void;
  /** Progression de la source en cours : recherches faites / à faire, offres reçues jusque-là. */
  onProgress?: (name: string, p: { done: number; total: number; found: number }) => void;
  /** Source terminée (offres enregistrées), avec son résultat. */
  onSourceDone?: (report: SourceReport) => void;
};

export type SourceReport = {
  source: string;
  status: "OK" | "ERROR" | "SOURCE_UNAVAILABLE";
  fetched: number;
  errors: string[];
  durationMs: number;
};

export type CollectReport = {
  runId: string;
  status: "done" | "partial" | "failed";
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  rejected: number;
  sources: SourceReport[];
};

/** Recherches à lancer : chaque recherche du profil × chaque zone. */
export function buildQueries(profile: Profile, publishedSinceDays: SearchParams["publishedSinceDays"], maxResults: number): SearchParams[] {
  const queries: SearchParams[] = [];
  for (const keywords of profile.searches) {
    for (const loc of profile.locations) {
      queries.push({
        keywords,
        department: loc.department,
        locationLabel: loc.label,
        maxResults,
        ...(publishedSinceDays ? { publishedSinceDays } : {}),
      });
    }
  }
  return queries;
}

/** France Travail, en plus : « Développeur » limité aux offres « débutant accepté » (filtre officiel), sur chaque zone. */
export function beginnerQueries(profile: Profile, publishedSinceDays: SearchParams["publishedSinceDays"], maxResults: number): SearchParams[] {
  return buildQueries({ ...profile, searches: ["Développeur"] }, publishedSinceDays, maxResults).map((q) => ({ ...q, beginnersOnly: true }));
}

/** Source « catalogue » (sites carrières : une seule récupération) ou « à quota serré » (elle regroupe elle-même les recherches). */
async function gatherBatch(
  name: string,
  fetch: () => Promise<{ jobs: RawJob[]; errors: string[]; skipped?: string }>,
  raws: Map<string, RawJob>,
  sr: SourceReport,
  log: (line: string) => void,
) {
  try {
    const { jobs, errors, skipped } = await fetch();
    for (const r of jobs) raws.set(r.sourceJobId, r);
    sr.errors.push(...errors);
    log(`  ${name} : ${skipped ? `ignorée (${skipped})` : `${jobs.length} offre(s)`}${errors.length ? `, ${errors.length} erreur(s)` : ""}`);
    if (errors.length && jobs.length === 0) sr.status = "ERROR";
  } catch (err) {
    sr.status = err instanceof SourceUnavailableError ? "SOURCE_UNAVAILABLE" : "ERROR";
    sr.errors.push(err instanceof Error ? err.message : String(err));
  }
}

/** Une recherche par mot-clé et par zone ; une source indisponible arrête les suivantes, une recherche en erreur non. */
async function gatherPerQuery(opts: CollectOptions, source: JobSource, perQuery: SearchParams[], raws: Map<string, RawJob>, sr: SourceReport) {
  const log = opts.log ?? (() => {});
  opts.onProgress?.(source.name, { done: 0, total: perQuery.length, found: raws.size });
  for (const [i, q] of perQuery.entries()) {
    try {
      const found = await source.search(q);
      for (const r of found) raws.set(r.sourceJobId, r);
      log(`  ${source.name} « ${q.keywords} »${q.beginnersOnly ? " débutants acceptés" : ""} (${q.department ?? "toute la France"}) : ${found.length} offre(s)`);
    } catch (err) {
      if (err instanceof SourceUnavailableError) {
        sr.status = "SOURCE_UNAVAILABLE";
        sr.errors.push(err.message);
        break;
      }
      const msg = err instanceof Error ? err.message : String(err);
      sr.errors.push(`« ${q.keywords} » ${q.department ?? ""} : ${msg}`);
      log(`  ${source.name} « ${q.keywords} » : ERREUR ${msg}`);
    } finally {
      opts.onProgress?.(source.name, { done: i + 1, total: perQuery.length, found: raws.size });
    }
  }
}

/** Récupère les offres d'une source (par catalogue, par lot ou recherche par recherche) et fixe son état : OK, ERROR ou SOURCE_UNAVAILABLE. */
async function gatherJobs(opts: CollectOptions, source: JobSource, queries: SearchParams[], sr: SourceReport): Promise<Map<string, RawJob>> {
  const raws = new Map<string, RawJob>();
  const log = opts.log ?? (() => {});
  // Source « catalogue » (sites carrières) : une seule récupération, pas de recherche par mot-clé.
  if (source.fetchAll) await gatherBatch(source.name, source.fetchAll.bind(source), raws, sr, log);
  // Source à quota serré : elle reçoit toutes les recherches et les regroupe elle-même.
  if (source.searchAll) await gatherBatch(source.name, () => source.searchAll!(queries), raws, sr, log);

  const perQuery =
    source.fetchAll || source.searchAll
      ? []
      : source.name === FT_SOURCE
        ? [...queries, ...beginnerQueries(opts.profile, opts.publishedSinceDays ?? 7, opts.maxResultsPerSearch ?? 300)]
        : queries;
  await gatherPerQuery(opts, source, perQuery, raws, sr);
  if (!source.fetchAll && !source.searchAll && sr.status === "OK" && sr.errors.length > 0 && sr.errors.length >= queries.length) {
    sr.status = "ERROR";
  }
  return raws;
}

/** Normalise et enregistre les offres reçues (une offre illisible est comptée « rejetée »). */
async function ingestAll(prisma: PrismaClient, raws: Map<string, RawJob>, report: CollectReport) {
  for (const raw of raws.values()) {
    const n = normalize(raw);
    if (!n) {
      report.rejected++;
      continue;
    }
    const outcome = await ingestJob(prisma, n);
    if (outcome === "created") report.created++;
    else if (outcome === "updated") report.updated++;
    else if (outcome === "unchanged") report.unchanged++;
    else report.duplicates++;
  }
}

/** Prochaine collecte de la source : plus tard après un échec, et jamais plus vite que son intervalle minimum. */
async function scheduleNext(opts: CollectOptions, source: JobSource, queryCount: number, ok: boolean) {
  const { prisma } = opts;
  const now = new Date();
  const state = await prisma.sourceState.findUnique({ where: { source: source.name } });
  // Jooble : intervalle fixe (l'ancien 1440 min en base ferait manquer deux créneaux sur trois).
  const interval =
    source.name === "jooble"
      ? JOOBLE_CHECK_MINUTES
      : Math.max(state?.intervalMinutes ?? opts.defaultIntervalMinutes ?? 5, minIntervalFor(source.name, queryCount));
  const failures = ok ? 0 : (state?.failures ?? 0) + 1;
  let next = computeNextRunAt(now, interval, failures);
  // Relance à la main : un échec ne ralentit pas les collectes automatiques (rien ne change) ; une réussite efface
  // seulement le ralentissement dû aux échecs, sans repousser la prochaine collecte prévue.
  if (opts.keepSchedule && state) {
    if (!ok) return;
    if (state.nextRunAt < next) next = state.nextRunAt;
  }
  await prisma.sourceState.upsert({
    where: { source: source.name },
    create: { source: source.name, intervalMinutes: interval, failures, nextRunAt: next, lastSuccessAt: ok ? now : null },
    update: { failures, nextRunAt: next, ...(ok ? { lastSuccessAt: now } : {}) },
  });
}

/** Collecte une source : récupération, enregistrement des offres, trace de la collecte, calendrier de la suivante. */
async function collectSource(opts: CollectOptions, source: JobSource, runId: string, queries: SearchParams[], report: CollectReport) {
  const { prisma } = opts;
  opts.onSource?.(source.name);
  const started = Date.now();
  const sr: SourceReport = { source: source.name, status: "OK", fetched: 0, errors: [], durationMs: 0 };
  const raws = await gatherJobs(opts, source, queries, sr);

  sr.fetched = raws.size;
  report.fetched += raws.size;
  await ingestAll(prisma, raws, report);

  sr.durationMs = Date.now() - started;
  report.sources.push(sr);
  opts.onSourceDone?.(sr);
  await prisma.sourceRun.create({
    data: {
      runId,
      source: source.name,
      status: sr.status,
      error: sr.errors.length ? sr.errors.join("\n").slice(0, 4000) : null,
      durationMs: sr.durationMs,
      fetched: sr.fetched,
    },
  });
  await scheduleNext(opts, source, queries.length, sr.status === "OK");
}

/**
 * Une collecte complète : chaque source est indépendante (une source en erreur n'arrête pas les autres),
 * chaque recherche aussi. Tout est tracé dans CollectionRun / SourceRun.
 */
export async function collectOnce(opts: CollectOptions): Promise<CollectReport> {
  const { prisma, profile } = opts;
  const run = opts.runId
    ? { id: opts.runId }
    : await prisma.collectionRun.create({ data: { trigger: opts.trigger, status: "running" } });
  const queries = buildQueries(profile, opts.publishedSinceDays ?? 7, opts.maxResultsPerSearch ?? 300);
  const report: CollectReport = {
    runId: run.id,
    status: "done",
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    duplicates: 0,
    rejected: 0,
    sources: [],
  };

  for (const source of opts.sources) await collectSource(opts, source, run.id, queries, report);

  const statuses = report.sources.map((s) => s.status);
  report.status = statuses.every((s) => s === "OK") ? "done" : statuses.some((s) => s === "OK") ? "partial" : "failed";
  await prisma.collectionRun.update({
    where: { id: run.id },
    data: {
      status: report.status,
      finishedAt: new Date(),
      fetched: report.fetched,
      created: report.created,
      duplicates: report.duplicates,
    },
  });
  return report;
}
