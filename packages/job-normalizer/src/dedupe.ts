import { comparable, sha } from "./text";

/**
 * Doublons « de contenu » : la même offre publiée par plusieurs sources avec un titre ou un lieu écrit autrement
 * (« … - Freelance (H/F) » / « … - Freelance », « Paris » / « 8ème Arrondissement » / aucun lieu).
 * Comparaison stricte, pas floue : « Full Stack Java Angular » et « Senior … Quarkus » restent deux offres.
 */

const LEGAL = /\b(sas|sasu|sarl|eurl|sa|sca|snc|groupe|group|france|esn|ltd|gmbh|inc)\b/g;
const CONTRACT = /\b(cdi|cdd|stage|stagiaire|alternance|apprentissage|freelance|interim)\b/g;

const companyCore = (company: string | null | undefined) => comparable(company).replace(LEGAL, " ").replace(/\s+/g, " ").trim();

/** Titre réduit à l'essentiel : sans (H/F), sans contrat, « full-stack » = « fullstack », « développeur·se » = « développeur ». */
export function titleCore(title: string): string {
  return comparable(title)
    .replace(CONTRACT, " ")
    .replace(/\bfull stack\b/g, "fullstack")
    .replace(/\b(developpeur|ingenieur|concepteur|consultant|architecte|analyste|technicien)(?:e|se|euse|s)\b/g, "$1") // « développeur·se » (le point médian disparaît)
    .replace(/\bfront end\b/g, "frontend")
    .replace(/\bback end\b/g, "backend")
    .replace(/\b(e|se|euse|ne)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Contrats écrits dans le titre (« - Freelance », « (CDI) »). */
function contractsIn(title: string): Set<string> {
  return new Set((comparable(title).match(CONTRACT) ?? []).map((c) => (c === "stagiaire" ? "stage" : c)));
}

/** Ville sans arrondissement ni code postal ; « France » seul ne dit rien. */
function placeCore(city: string | null | undefined): string {
  const c = comparable(city)
    .replace(/\b\d{1,2}\s?(er|e|eme)?\s*arrondissement\b/g, " ")
    .replace(/\b\d{5}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return c === "france" ? "" : c;
}

/** Clé de rapprochement (entreprise + titre nettoyé). null sans entreprise : on ne fusionne pas à l'aveugle. */
export function dedupeKeyOf(company: string | null | undefined, title: string): string | null {
  const c = companyCore(company);
  const t = titleCore(title);
  return c && t ? `ded:${sha([c, t])}` : null;
}

export type OfferPlace = { title: string; city: string | null; department: string | null };

/**
 * Deux offres de même clé sont-elles la même ?
 *  - contrats écrits dans les deux titres : identiques (CDI ≠ Freelance) ; absent d'un titre : on ne conclut rien ;
 *  - lieu : deux villes précises doivent être la même (arrondissements compris : Paris = Paris 5e) ; deux villes voisines
 *    (Beauvais / Tillé) restent deux offres, le trajet n'est pas le même ; lieu inconnu d'un côté (« 8ème Arrondissement »,
 *    « France », rien) : compatible, sauf si les deux départements sont connus et différents.
 */
export function sameOffer(a: OfferPlace, b: OfferPlace): boolean {
  if (titleCore(a.title) !== titleCore(b.title)) return false;
  const ca = contractsIn(a.title);
  const cb = contractsIn(b.title);
  if (ca.size && cb.size && (ca.size !== cb.size || [...ca].some((c) => !cb.has(c)))) return false;
  const pa = placeCore(a.city);
  const pb = placeCore(b.city);
  if (pa && pb) return pa === pb;
  return !(a.department && b.department && a.department !== b.department);
}
