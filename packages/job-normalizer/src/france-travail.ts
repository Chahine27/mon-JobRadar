import { detectRemote, normalizeContract, parseExperienceYears } from "@job-radar/scoring";
import { extractSkills, getSkill } from "@job-radar/skills";
import { FT_SOURCE, FtOfferSchema, type RawJob, ftOfferUrl } from "@job-radar/source-connectors";
import { parseFtSalary } from "./salary";
import { comparable, fingerprintOf, sha, titleCase } from "./text";
import type { NormalizedJob } from "./types";

function department(postalCode: string | undefined, libelle: string | undefined): string | null {
  const fromLabel = libelle?.match(/^\s*(\d{2,3}|2A|2B)\s*-/)?.[1];
  if (fromLabel) return fromLabel;
  if (postalCode && /^\d{5}$/.test(postalCode)) {
    return postalCode.startsWith("97") ? postalCode.slice(0, 3) : postalCode.slice(0, 2);
  }
  return null;
}

function city(libelle: string | undefined): string | null {
  const name = libelle?.split(" - ").slice(1).join(" - ").trim();
  return name ? titleCase(name) : null;
}

function experience(code: string | undefined, label: string | undefined) {
  if (code === "D") return { min: 0, max: null };
  if (!label) return null;
  const months = label.match(/(\d+)\s*mois/i);
  if (months && !/an\(s\)|ans?\b/i.test(label)) return { min: Math.floor(Number(months[1]) / 12), max: null };
  // Le libellé FT ne contient pas le mot « expérience » : on l'ajoute pour le détecteur.
  return parseExperienceYears(`${label} d'expérience`);
}

/** Offre brute France Travail → offre normalisée. Renvoie null si l'offre est inexploitable. */
export function normalizeFranceTravail(raw: RawJob): NormalizedJob | null {
  const parsed = FtOfferSchema.safeParse(raw.data);
  if (!parsed.success) return null;
  const o = parsed.data;
  const title = o.intitule?.trim();
  if (!title) return null;

  const description = o.description?.trim() ?? "";
  const company = o.entreprise?.nom?.trim() ? titleCase(o.entreprise.nom.trim()) : null;
  const lieu = o.lieuTravail;
  const salary = parseFtSalary(o.salaire?.libelle);
  const exp = experience(o.experienceExige, o.experienceLibelle);
  const contract = o.alternance ? "ALTERNANCE" : (normalizeContract(o.typeContrat) ?? normalizeContract(o.typeContratLibelle));
  const partnerUrl = o.origineOffre?.partenaires?.find((p) => p.url)?.url ?? null;
  const sourceUrl = o.origineOffre?.urlOrigine || ftOfferUrl(o.id);
  const hasCoords = typeof lieu?.latitude === "number" && typeof lieu?.longitude === "number";
  const cityName = city(lieu?.libelle);

  const text = `${title}\n${description}`;
  const technologies = extractSkills(text).map((id) => getSkill(id)?.label ?? id);

  const job: Omit<NormalizedJob, "contentHash" | "fingerprint"> = {
    source: FT_SOURCE,
    sourceJobId: o.id,
    sourceUrl,
    canonicalUrl: partnerUrl,
    title,
    company,
    description,
    contractType: contract ?? o.typeContrat ?? null,
    experienceText: o.experienceLibelle ?? null,
    experienceMinYrs: exp?.min ?? null,
    experienceMaxYrs: exp?.max ?? null,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryPeriod: salary ? "year" : null,
    salaryText: o.salaire?.libelle ?? o.salaire?.commentaire ?? null,
    city: cityName,
    postalCode: lieu?.codePostal ?? null,
    department: department(lieu?.codePostal, lieu?.libelle),
    address: null, // France Travail ne donne pas l'adresse exacte
    latitude: hasCoords ? lieu!.latitude! : null,
    longitude: hasCoords ? lieu!.longitude! : null,
    locationPrecision: hasCoords ? "city_centroid" : "unknown",
    remoteType: detectRemote(description),
    technologies,
    publishedAt: o.dateCreation ? new Date(o.dateCreation) : null,
    rawData: raw.data,
  };

  return {
    ...job,
    fingerprint: fingerprintOf({ source: FT_SOURCE, sourceJobId: o.id, company, title, city: cityName }),
    contentHash: sha([
      comparable(title),
      comparable(description),
      job.contractType,
      job.salaryMin,
      job.salaryMax,
      job.experienceMinYrs,
      job.department,
      job.city,
    ]),
  };
}
