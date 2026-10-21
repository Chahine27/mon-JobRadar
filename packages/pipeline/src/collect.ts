import type { PrismaClient } from "@job-radar/db";
import { normalize } from "@job-radar/job-normalizer";
import type { Profile } from "@job-radar/shared";
import { FT_SOURCE, type JobSource, type RawJob, type SearchParams, SourceUnavailableError } from "@job-radar/source-connectors";
import { ingestJob } from "./ingest";
import { minIntervalFor } from "./quota";
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

/**
 * Une collecte complète : chaque source est indépendante (une source en erreur n'arrête pas les autres),
 * chaque recherche aussi. Tout est tracé dans CollectionRun / SourceRun.
 */
export async function collectOnce(opts: CollectOptions): Promise<CollectReport> {
  const { prisma, profile, log = () => {} } = opts;
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

  for (const source of opts.sources) {
    opts.onSource?.(source.name);
    const started = Date.now();
    const sr: SourceReport = { source: source.name, status: "OK", fetched: 0, errors: [], durationMs: 0 };
    const raws = new Map<string, RawJob>();

    if (source.fetchAll) {
      // Source « catalogue » (sites carrières) : une seule récupération, pas de recherche par mot-clé.
      try {
        const { jobs, errors } = await source.fetchAll();
        for (const r of jobs) raws.set(r.sourceJobId, r);
        sr.errors.push(...errors);
        log(`  ${source.name} : ${jobs.length} offre(s)${errors.length ? `, ${errors.length} erreur(s)` : ""}`);
        if (errors.length && jobs.length === 0) sr.status = "ERROR";
      } catch (err) {
        sr.status = err instanceof SourceUnavailableError ? "SOURCE_UNAVAILABLE" : "ERROR";
        sr.errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (source.searchAll) {
      // Source à quota serré : elle reçoit toutes les recherches et les regroupe elle-même.
      try {
        const { jobs, errors, skipped } = await source.searchAll(queries);
        for (const r of jobs) raws.set(r.sourceJobId, r);
        sr.errors.push(...errors);
        log(`  ${source.name} : ${skipped ? `ignorée (${skipped})` : `${jobs.length} offre(s)`}${errors.length ? `, ${errors.length} erreur(s)` : ""}`);
        if (errors.length && jobs.length === 0) sr.status = "ERROR";
      } catch (err) {
        sr.status = err instanceof SourceUnavailableError ? "SOURCE_UNAVAILABLE" : "ERROR";
        sr.errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const perQuery = source.fetchAll || source.searchAll ? [] : source.name === FT_SOURCE ? [...queries, ...beginnerQueries(profile, opts.publishedSinceDays ?? 7, opts.maxResultsPerSearch ?? 300)] : queries;
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
    if (!source.fetchAll && !source.searchAll && sr.status === "OK" && sr.errors.length > 0 && sr.errors.length >= queries.length) {
      sr.status = "ERROR";
    }

    sr.fetched = raws.size;
    report.fetched += raws.size;
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

    sr.durationMs = Date.now() - started;
    report.sources.push(sr);
    opts.onSourceDone?.(sr);
    await prisma.sourceRun.create({
      data: {
        runId: run.id,
        source: source.name,
        status: sr.status,
        error: sr.errors.length ? sr.errors.join("\n").slice(0, 4000) : null,
        durationMs: sr.durationMs,
        fetched: sr.fetched,
      },
    });
    const ok = sr.status === "OK";
    const now = new Date();
    const state = await prisma.sourceState.findUnique({ where: { source: source.name } });
    const interval = Math.max(
      state?.intervalMinutes ?? opts.defaultIntervalMinutes ?? 5,
      minIntervalFor(source.name, queries.length),
    );
    const failures = ok ? 0 : (state?.failures ?? 0) + 1;
    let next = computeNextRunAt(now, interval, failures);
    // Relance à la main : un échec ne ralentit pas les collectes automatiques (rien ne change) ; une réussite efface
    // seulement le ralentissement dû aux échecs, sans repousser la prochaine collecte prévue.
    if (opts.keepSchedule && state) {
      if (!ok) continue;
      if (state.nextRunAt < next) next = state.nextRunAt;
    }
    await prisma.sourceState.upsert({
      where: { source: source.name },
      create: { source: source.name, intervalMinutes: interval, failures, nextRunAt: next, lastSuccessAt: ok ? now : null },
      update: { failures, nextRunAt: next, ...(ok ? { lastSuccessAt: now } : {}) },
    });
  }

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
