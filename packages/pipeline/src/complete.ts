import type { PrismaClient } from "@job-radar/db";
import { htmlToText, normalize } from "@job-radar/job-normalizer";
import { ingestJob } from "./ingest";

/** Description (HTML) et date de publication lues sur la page publique d'une offre (null : page illisible). */
export type DetailsFetcher = (link: { source: string; sourceJobId: string; sourceUrl: string }) => Promise<{
  description: string | null;
  postedAt: Date | null;
} | null>;

/** Marque, dans les données brutes, une annonce complétée depuis sa page : la collecte suivante ne l'écrase plus. */
export const DETAIL_FETCHED = "detailFetched";
/** Marque une offre dont la date de publication a été cherchée sur sa page (trouvée ou non). */
export const DATE_CHECKED = "dateChecked";
/** Dernier essai de lecture de la page resté sans résultat (page illisible, offre retirée) : pas de nouvel essai avant 1 jour. */
export const DETAIL_TRIED_AT = "detailTriedAt";

/** WTTJ via JobScraper : seulement le résumé de l'index de recherche, jamais l'annonce. */
const SUMMARY_ONLY = ["jobscraper:wttj"];

/**
 * Offres JobScraper incomplètes : sans description (LinkedIn sans détail, HelloWork), avec un simple résumé (WTTJ),
 * ou sans date de publication (LinkedIn, HelloWork : elles passaient pour « publiées il y a 5 min »).
 * On lit leur page publique et on les repasse par la normalisation → description, date, contrat, technologies
 * et score à jour. Seulement les offres encore utiles (nouvelles, vues, sauvegardées) et pas complétées à la main.
 */
export async function completeJobScraperDescriptions(opts: {
  prisma: PrismaClient;
  fetchDetails: DetailsFetcher;
  /** Requêtes au plus par passage (une par offre). */
  max?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
}): Promise<{ checked: number; completed: number }> {
  const { prisma, log = () => {} } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const active = { fullTextAt: null, status: { in: ["NEW" as const, "SEEN" as const, "SAVED" as const] } };
  const flag = (raw: unknown, key: string) => (raw as Record<string, unknown> | null)?.[key] === true;
  const links = (
    await prisma.jobSourceLink.findMany({
      where: {
        source: { startsWith: "jobscraper:" },
        OR: [{ job: { ...active, description: "" } }, { job: { ...active, publishedAt: null } }, { source: { in: SUMMARY_ONLY }, job: active }],
      },
      select: { id: true, source: true, sourceJobId: true, sourceUrl: true, rawData: true, job: { select: { description: true, publishedAt: true } } },
      orderBy: { firstSeenAt: "desc" },
    })
  )
    // Filtres en JS : en SQL, « clé JSON absente » ne se teste pas proprement avec NOT.
    .filter((l) => {
      const tried = (l.rawData as Record<string, unknown> | null)?.[DETAIL_TRIED_AT];
      return typeof tried !== "string" || Date.now() - Date.parse(tried) > 86_400_000;
    })
    .filter(
      (l) =>
        (!flag(l.rawData, DETAIL_FETCHED) && (!l.job.description.trim() || SUMMARY_ONLY.includes(l.source))) ||
        (!l.job.publishedAt && !flag(l.rawData, DATE_CHECKED)),
    )
    .slice(0, opts.max ?? 30);
  let completed = 0;
  for (const [i, link] of links.entries()) {
    if (i > 0) await sleep(1500); // pas de rafale vers le même site
    const details = await opts.fetchDetails(link);
    // Page illisible, ou sans texte alors qu'il en manque : essai noté, on retentera demain (pas à chaque passage).
    const tried = () =>
      prisma.jobSourceLink.update({ where: { id: link.id }, data: { rawData: { ...(link.rawData as object), [DETAIL_TRIED_AT]: new Date().toISOString() } } });
    if (!details) {
      await tried();
      continue;
    }
    const text = details.description ? htmlToText(details.description).trim() : "";
    const raw = link.rawData as Record<string, unknown>;
    // Un texte de page trop court (page vide, offre retirée) ne remplace rien ; sans description du tout, on retentera.
    const description = text.length >= 100 ? text : null;
    if (!description && !link.job.description.trim()) {
      await tried();
      continue;
    }
    const data = {
      ...raw,
      ...(description ? { description, [DETAIL_FETCHED]: true } : {}),
      ...(details.postedAt && !raw.posted_at ? { posted_at: details.postedAt.toISOString() } : {}),
      [DATE_CHECKED]: true,
    };
    const n = normalize({ source: link.source, sourceJobId: link.sourceJobId, data, collectedAt: new Date() });
    if (n && (await ingestJob(prisma, n)) === "updated") completed++;
  }
  if (links.length) log(`Offres JobScraper complétées (description, date) : ${completed} sur ${links.length}`);
  return { checked: links.length, completed };
}
