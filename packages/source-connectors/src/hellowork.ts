import { BROWSER_HEADERS } from "./jobscraper";

/**
 * HelloWork : Jooble reprend ses annonces avec un extrait de 300 caractères, et ses pages refusent les robots (Cloudflare,
 * 403). La recherche publique de HelloWork, elle, donne le lien de l'annonce, et sa page le texte entier (bloc schema.org
 * « JobPosting », lu par fetchJobScraperDetails). Testé le 28/10/2026 : 4 annonces retrouvées sur 6 avec le titre seul.
 */
const BASE = "https://www.hellowork.com";

/** Liens des annonces d'une page de résultats, dans l'ordre, sans doublon. */
export function helloWorkAdLinks(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(\/fr-fr\/emplois\/\d+\.html)/g)].map((m) => `${BASE}${m[1]}`))];
}

/** Liens des annonces pour une recherche ; null si HelloWork refuse (blocage, erreur) : inutile d'insister. */
export async function searchHelloWork(query: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${BASE}/fr-fr/emploi/recherche.html?k=${encodeURIComponent(query)}`, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? helloWorkAdLinks(await res.text()) : null;
  } catch {
    return null;
  }
}
