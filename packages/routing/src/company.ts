import type { FetchLike } from "@job-radar/source-connectors";
import type { Point } from "./types";

/** API Recherche d'entreprises (État) : gratuite, sans clé, ~7 requêtes/s. Adresse et coordonnées des établissements. */
export const COMPANY_SEARCH_URL = "https://recherche-entreprises.api.gouv.fr/search";

type Etablissement = {
  adresse?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  libelle_commune?: string | null;
  departement?: string | null;
  etat_administratif?: string | null;
};
type Result = {
  nom_raison_sociale?: string | null;
  nom_complet?: string | null;
  sigle?: string | null;
  siege?: Etablissement & { nom_commercial?: string | null; liste_enseignes?: string[] | null };
  matching_etablissements?: Etablissement[] | null;
};

/** « ISAGRI SAS », « Isagri » → « isagri » ; formes juridiques et ponctuation retirées. */
export function companyKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(sas|sasu|sa|sarl|eurl|sci|scop|group|groupe|france|holding|societe)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** « PARIS 11 », « Paris 11e Arrondissement », « COMPIEGNE CEDEX » → même commune. */
const cityKey = (c: string) =>
  companyKey(c)
    .replace(/\b(cedex|arrondissement|\d+(e|er|eme)?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? NaN : Number(v));

/**
 * Lieu de travail exact d'une offre : l'établissement de l'entreprise dans la ville de l'offre.
 * Prudent (un mauvais point fausserait le trajet) : nom identique à l'entreprise (pas d'homonyme approchant),
 * établissement ouvert, dans la ville de l'offre — ou seul établissement du département si la ville est inconnue.
 * Plusieurs adresses possibles → null (on garde le centre de la ville).
 */
export async function findCompanySite(
  company: string,
  where: { city: string | null; department: string | null },
  opts: { fetch?: FetchLike } = {},
): Promise<(Point & { label: string }) | null> {
  const key = companyKey(company);
  if (key.length < 2 || (!where.city && !where.department)) return null;
  const fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
  const params = new URLSearchParams({ q: company.slice(0, 100), per_page: "10" });
  if (where.department) params.set("departement", where.department);
  const res = await fetch(`${COMPANY_SEARCH_URL}?${params}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Recherche d'entreprise en erreur (HTTP ${res.status})`);
  const results = ((await res.json()) as { results?: Result[] }).results ?? [];

  // Raison sociale ou sigle identique d'abord ; l'enseigne seulement à défaut (une cantine peut porter l'enseigne du client).
  const named = (names: Array<string | null | undefined>) => names.some((n) => !!n && companyKey(n) === key);
  const byLegalName = results.filter((r) => named([r.nom_raison_sociale, r.nom_complet, r.sigle]));
  const sameName = byLegalName.length
    ? byLegalName
    : results.filter((r) => named([r.siege?.nom_commercial, ...(r.siege?.liste_enseignes ?? [])]));
  const sites = sameName
    .flatMap((r) => [...(r.matching_etablissements ?? []), ...(r.siege ? [r.siege] : [])])
    .filter((e) => e.etat_administratif !== "F" && Number.isFinite(num(e.latitude)) && Number.isFinite(num(e.longitude)))
    .filter((e) => !where.department || !e.departement || e.departement === where.department)
    .filter((e) => !where.city || (!!e.libelle_commune && cityKey(e.libelle_commune) === cityKey(where.city)));

  // Un seul lieu : tous les établissements à moins de 500 m du premier (siège = établissement, bâtiments voisins).
  const e = sites[0];
  if (!e) return null;
  const p = { lat: num(e.latitude), lng: num(e.longitude) };
  if (sites.some((s) => kmBetween(p, { lat: num(s.latitude), lng: num(s.longitude) }) > 0.5)) return null;
  return { ...p, label: e.adresse ?? `${company} ${e.libelle_commune ?? ""}`.trim() };
}

/** Distance à vol d'oiseau (km). */
function kmBetween(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
