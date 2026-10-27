import type { PrismaClient } from "@job-radar/db";
import { comparable, htmlToText, normalize } from "@job-radar/job-normalizer";
import { outOfZone } from "@job-radar/shared";
import { FREE_WORK_COMPANY } from "@job-radar/source-connectors";
import { ingestJob } from "./ingest";
import { sameDescription } from "./renormalize";

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
  /** Départements de ta zone (zoneDepartments) : une offre ailleurs, sans télétravail complet, n'est pas lue. */
  zone?: Set<string>;
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
      select: { id: true, source: true, sourceJobId: true, sourceUrl: true, rawData: true, job: { select: { description: true, publishedAt: true, department: true, remoteType: true } } },
      orderBy: { firstSeenAt: "desc" },
    })
  )
    // Hors de ta zone : masquée du flux, inutile de demander sa page (LinkedIn bloque vite l'IP).
    .filter((l) => !opts.zone || !outOfZone(l.job, opts.zone))
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
  let fetched = 0;
  /** Site qui a refusé une page (429, blocage) : on ne lui redemande plus rien de ce passage (insister prolonge le blocage). */
  const refused = new Set<string>();
  for (const link of links) {
    if (refused.has(link.source)) continue;
    // Pas de rafale vers le même site ; LinkedIn bloque l'IP plus vite que les autres.
    if (fetched++ > 0) await sleep(link.source === "jobscraper:linkedin" ? 5000 : 1500);
    const details = await opts.fetchDetails(link);
    // Page illisible, ou sans texte alors qu'il en manque : essai noté, on retentera demain (pas à chaque passage).
    const tried = () =>
      prisma.jobSourceLink.update({ where: { id: link.id }, data: { rawData: { ...(link.rawData as object), [DETAIL_TRIED_AT]: new Date().toISOString() } } });
    if (!details) {
      refused.add(link.source);
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

/**
 * Offres Adzuna réduites à l'extrait de l'API (500 caractères) : annonce entière lue sur leur page adzuna.fr, puis
 * repassée par la normalisation → technologies, expérience, télétravail et score calculés sur tout le texte.
 * Un seul lien par offre (le plus récent). Pas les annonces Free-Work (cf. completeFreeWorkAds, qui trouve aussi
 * l'employeur), ni celles dont le texte vient déjà d'une autre source. Page retirée ou vide : nouvel essai dans 1 jour.
 */
export async function completeAdzunaAds(opts: {
  prisma: PrismaClient;
  /** Page de l'offre (fetchAdzunaAd) : null = refusée ou illisible, on arrête ce passage. */
  fetchAd: (sourceJobId: string) => Promise<{ description: string | null } | null>;
  /** Pages au plus par passage, 3 s d'écart (Adzuna répond 429 en dessous, cf. expireJobs). */
  max?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
  zone?: Set<string>;
}): Promise<{ checked: number; completed: number }> {
  const { prisma, log = () => {} } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const all = await prisma.jobSourceLink.findMany({
    where: { source: "adzuna", job: { fullTextAt: null, status: { in: ["NEW", "SEEN", "SAVED"] } } },
    select: { id: true, jobId: true, sourceJobId: true, rawData: true, firstSeenAt: true, job: { select: { company: true, description: true, department: true, remoteType: true } } },
    orderBy: { firstSeenAt: "desc" },
  });
  const raw = (l: (typeof all)[number]) => (l.rawData ?? {}) as Record<string, unknown>;
  // Offre dont une annonce Adzuna a déjà été lue en entier : rien à refaire pour ses autres liens.
  const done = new Set(all.filter((l) => raw(l)[DETAIL_FETCHED] === true).map((l) => l.jobId));
  const seen = new Set<string>();
  const links = all
    .filter((l) => l.job.company !== FREE_WORK_COMPANY && !done.has(l.jobId))
    .filter((l) => !opts.zone || !outOfZone(l.job, opts.zone))
    .filter((l) => (seen.has(l.jobId) ? false : (seen.add(l.jobId), true)))
    .filter((l) => {
      const tried = raw(l)[DETAIL_TRIED_AT];
      return typeof tried !== "string" || Date.now() - Date.parse(tried) > 86_400_000;
    })
    .slice(0, opts.max ?? 20);
  let completed = 0;
  let checked = 0;
  for (const link of links) {
    const n = normalize({ source: "adzuna", sourceJobId: link.sourceJobId, data: link.rawData, collectedAt: link.firstSeenAt });
    // Texte venu d'une autre source (LinkedIn, Indeed…), plus long que l'extrait : déjà complet.
    if (!n || link.job.description.trim().length > n.description.trim().length + 50) continue;
    if (checked++ > 0) await sleep(3000);
    const ad = await opts.fetchAd(link.sourceJobId);
    const text = ad?.description ? htmlToText(ad.description).trim() : "";
    if (!ad || text.length < 100) {
      await prisma.jobSourceLink.update({ where: { id: link.id }, data: { rawData: { ...raw(link), [DETAIL_TRIED_AT]: new Date().toISOString() } } });
      if (!ad) break; // Adzuna refuse (429) : on arrête ce passage, insister prolonge le blocage.
      continue;
    }
    const next = normalize({ source: "adzuna", sourceJobId: link.sourceJobId, data: { ...raw(link), description: ad.description, [DETAIL_FETCHED]: true }, collectedAt: link.firstSeenAt });
    if (next && (await ingestJob(prisma, next)) === "updated") completed++;
  }
  if (checked) log(`Offres Adzuna complétées (annonce entière lue sur adzuna.fr) : ${completed} sur ${checked}`);
  return { checked, completed };
}

/** Recherche et lecture des annonces Free-Work (cf. searchFreeWork / fetchFreeWorkAd ; remplaçables dans les tests). */
export type FreeWorkClient = {
  search: (query: string) => Promise<string[] | null>;
  ad: (link: string) => Promise<{ description: string | null; company?: string | null; url: string } | null>;
};

/** Titre Adzuna → recherche Free-Work : sans le contrat ajouté par Adzuna (« (CDI) ») ni « H/F ». */
export function freeWorkQuery(title: string): string {
  return title
    .replace(/\((cdi|cdd|freelance|stage|alternance|interim)\)/gi, " ")
    .replace(/\b[hfx]\s*\/\s*[hfx](\s*\/\s*[hfx])?\b/gi, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s\-–|]+$/, "");
}

const textKey = (text: string) => comparable(text).replace(/ /g, "");

/**
 * Offres Adzuna reprises de Free-Work (entreprise « Free-Work », extrait de 500 caractères dont la moitié présente
 * le site) : annonce retrouvée par la recherche de Free-Work, puis remplacée par le texte entier et l'employeur réel.
 * Une annonce n'est prise que si elle contient le début de l'extrait Adzuna : même titre chez un autre client = refusée
 * (testé le 23/10/2026 : 10 annonces retrouvées sur 12, aucune fausse). Pas trouvée : nouvel essai dans 1 jour.
 * Seulement les offres encore utiles, dont la description est encore l'extrait Adzuna (pas un texte venu d'ailleurs).
 */
export async function completeFreeWorkAds(opts: {
  prisma: PrismaClient;
  freeWork: FreeWorkClient;
  /** Offres au plus par passage (jusqu'à 2 recherches et `pages` annonces lues pour chacune). */
  max?: number;
  pages?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
  zone?: Set<string>;
}): Promise<{ checked: number; completed: number }> {
  const { prisma, log = () => {}, pages = 4 } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const links = (
    await prisma.jobSourceLink.findMany({
      where: { source: "adzuna", job: { fullTextAt: null, company: FREE_WORK_COMPANY, status: { in: ["NEW", "SEEN", "SAVED"] } } },
      select: { id: true, source: true, sourceJobId: true, sourceUrl: true, rawData: true, firstSeenAt: true, job: { select: { title: true, description: true, department: true, remoteType: true } } },
      orderBy: { firstSeenAt: "desc" },
    })
  )
    .filter((l) => !opts.zone || !outOfZone(l.job, opts.zone))
    .filter((l) => {
      const raw = (l.rawData ?? {}) as Record<string, unknown>;
      const tried = raw[DETAIL_TRIED_AT];
      return raw[DETAIL_FETCHED] !== true && (typeof tried !== "string" || Date.now() - Date.parse(tried) > 86_400_000);
    })
    .slice(0, opts.max ?? 8);
  let completed = 0;
  let requests = 0;
  const pause = () => (requests++ > 0 ? sleep(1500) : Promise.resolve());
  for (const link of links) {
    const n = normalize({ source: link.source, sourceJobId: link.sourceJobId, data: link.rawData, collectedAt: link.firstSeenAt });
    // Texte venu d'une autre source (LinkedIn, Indeed…) : déjà complet, rien à chercher.
    if (!n || !sameDescription(n.description, link.job.description)) continue;
    const excerpt = textKey(n.description).slice(0, 50);
    let found: { description: string; company?: string | null; url: string } | null = null;
    let refused = false;
    if (excerpt.length >= 40) {
      const core = freeWorkQuery(link.job.title);
      for (const query of [...new Set([core, core.split(" ").slice(0, 5).join(" ")])]) {
        await pause();
        const ads = await opts.freeWork.search(query);
        if (!ads) {
          refused = true;
          break;
        }
        for (const ad of ads.slice(0, pages)) {
          await pause();
          const page = await opts.freeWork.ad(ad);
          if (page?.description && textKey(htmlToText(page.description)).includes(excerpt)) {
            found = { description: page.description, company: page.company ?? null, url: page.url };
            break;
          }
        }
        if (found) break;
      }
    }
    const raw = (link.rawData ?? {}) as Record<string, unknown>;
    if (!found) {
      await prisma.jobSourceLink.update({ where: { id: link.id }, data: { rawData: { ...raw, [DETAIL_TRIED_AT]: new Date().toISOString() } } });
      if (refused) break; // Free-Work refuse : on arrête ce passage (insister prolonge un blocage).
      continue;
    }
    const company = (raw.company ?? {}) as Record<string, unknown>;
    const data = {
      ...raw,
      description: found.description,
      ...(found.company ? { company: { ...company, display_name: found.company } } : {}),
      freeWorkUrl: found.url,
      [DETAIL_FETCHED]: true,
    };
    const next = normalize({ source: link.source, sourceJobId: link.sourceJobId, data, collectedAt: link.firstSeenAt });
    if (next && (await ingestJob(prisma, next)) === "updated") completed++;
  }
  if (links.length) log(`Offres Adzuna / Free-Work complétées (annonce entière, employeur) : ${completed} sur ${links.length}`);
  return { checked: links.length, completed };
}
