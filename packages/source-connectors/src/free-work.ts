import { BROWSER_HEADERS, type PageDetails, detailsFromPage } from "./jobscraper";

/**
 * Free-Work : Adzuna reprend ses annonces avec « Free-Work » pour entreprise et un extrait qui commence par la
 * présentation du site, et son lien de sortie refuse les robots (403). La recherche publique de Free-Work, elle, donne
 * le lien de l'annonce, et sa page le texte entier, l'employeur réel et la date (bloc schema.org « JobPosting »).
 */
export const FREE_WORK_COMPANY = "Free-Work";
const BASE = "https://www.free-work.com";

/** Liens des annonces d'une page de résultats, dans l'ordre (chaque carte répète son lien). */
export function freeWorkAdLinks(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(\/fr\/tech-it\/job-mission\/[^"?#]+)[^"]*"/g)].map((m) => m[1]!))];
}

/** Liens des annonces pour une recherche ; null si Free-Work refuse (blocage, erreur) : inutile d'insister. */
export async function searchFreeWork(query: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${BASE}/fr/tech-it/jobs?query=${encodeURIComponent(query)}`, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? freeWorkAdLinks(await res.text()) : null;
  } catch {
    return null;
  }
}

/** Annonce Free-Work (texte HTML, date, employeur) ; null si la page est illisible. */
export async function fetchFreeWorkAd(link: string, fetchImpl: typeof fetch = fetch): Promise<(PageDetails & { url: string }) | null> {
  const url = link.startsWith("http") ? link : `${BASE}${link}`;
  try {
    const res = await fetchImpl(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15_000) });
    return res.ok ? { ...detailsFromPage(await res.text()), url } : null;
  } catch {
    return null;
  }
}
