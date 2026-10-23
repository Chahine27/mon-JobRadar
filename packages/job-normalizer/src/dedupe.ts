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

/**
 * Deux annonces d'une même source (identifiants différents) ne sont la même offre republiée que si leur texte commence
 * pareil : une agence (asap.work…) publie « Développeur .Net (H/F) » à Paris pour plusieurs clients, avec le même
 * titre et la même ville, et une ESN la même mission à 430 € puis 470 € par jour. Texte absent ou trop court d'un côté : rien à conclure, on les rapproche comme avant.
 */
export function sameAdText(a: string, b: string): boolean {
  // Sans espaces (« role what » / « rolewhat » selon la collecte) ; le début de l'une peut venir après une intro
  // dans l'autre (« Descriptif du poste : … »).
  const ca = comparable(a).replace(/ /g, "");
  const cb = comparable(b).replace(/ /g, "");
  if (ca.length < 40 || cb.length < 40) return true;
  return cb.slice(0, 400).includes(ca.slice(0, 60)) || ca.slice(0, 400).includes(cb.slice(0, 60));
}

export type OfferSalary = { salaryMin: number | null; salaryMax: number | null; salaryPeriod: string | null };

/**
 * Deux annonces d'une même source au même texte sont deux offres si leurs salaires ne se recoupent pas : Talan publie
 * « Développeur Junior Java / Angular » avec la même description à 36 k€ puis à 70–100 k€. Salaire inconnu d'un côté
 * ou période différente : rien à conclure.
 */
export function sameSalary(a: OfferSalary, b: OfferSalary): boolean {
  const amin = a.salaryMin ?? a.salaryMax;
  const bmin = b.salaryMin ?? b.salaryMax;
  if (amin == null || bmin == null || a.salaryPeriod !== b.salaryPeriod) return true;
  return amin <= (b.salaryMax ?? bmin) && bmin <= (a.salaryMax ?? amin);
}

export type OfferPlace ={ title: string; city: string | null; department: string | null };

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

/** Mots qui ne distinguent pas deux offres (liaisons, (H/F) éclaté, catégorie ajoutée par Adzuna : « (IT) »). */
const FILLER = new Set(["de", "des", "du", "la", "le", "les", "et", "en", "a", "au", "aux", "pour", "sur", "h", "f", "x", "it"]);
const titleWords = (title: string) => new Set(titleCore(title).split(" ").filter((w) => w && !FILLER.has(w)));

/**
 * Même offre « ou presque », vue sur un autre site (avant de postuler, pour ne pas envoyer deux fois) :
 * même entreprise, intitulé quasi identique (80 % des mots en commun, ex. « … BDD Cucumber - F/H » et
 * « … BDD Cucumber - F/H (IT) »), lieu compatible. Plus souple que sameOffer : sert à PRÉVENIR, jamais à fusionner.
 * Deux postes différents chez la même entreprise (« C++/C# - Finance de marché » / « … (Deal Capture) ») restent distincts.
 */
export function similarOffer(a: OfferPlace & { company: string | null }, b: OfferPlace & { company: string | null }): boolean {
  const ca = companyCore(a.company);
  if (!ca || ca !== companyCore(b.company)) return false;
  const wa = titleWords(a.title);
  const wb = titleWords(b.title);
  const common = [...wa].filter((w) => wb.has(w)).length;
  if (!wa.size || common / new Set([...wa, ...wb]).size < 0.8) return false;
  const pa = placeCore(a.city);
  const pb = placeCore(b.city);
  if (pa && pb) return pa === pb;
  return !(a.department && b.department && a.department !== b.department);
}
