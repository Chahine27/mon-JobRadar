import { detectRemote, parseExperienceYears } from "@job-radar/scoring";
import { DEPARTMENTS, departmentFromText, ManualJobSchema, manualOrigin } from "@job-radar/shared";
import { extractSkills, getSkill } from "@job-radar/skills";
import type { RawJob } from "@job-radar/source-connectors";
import { cleanPastedText } from "./manual-analyze";
import { comparable, fingerprintOf, sha } from "./text";
import type { NormalizedJob } from "./types";

export const MANUAL_SOURCE = "manual";

/** « CDI » ou « CDD » écrit dans l'annonce, seulement s'il n'y a pas d'ambiguïté (un seul des deux). */
function contractFromText(text: string): string | null {
  const t = comparable(text);
  const cdi = /\bcdi\b|duree indeterminee/.test(t);
  const cdd = /\bcdd\b|duree determinee/.test(t);
  if (cdi && !cdd) return "CDI";
  if (cdd && !cdi) return "CDD";
  return null;
}

/** Offre ajoutée à la main : `raw.data` = champs du formulaire (validés ici encore). */
export function normalizeManual(raw: RawJob): NormalizedJob | null {
  const parsed = ManualJobSchema.safeParse(raw.data);
  if (!parsed.success) return null;
  // Texte collé tel quel : liens LinkedIn « [texte](https://…) » et lignes d'interface retirés.
  const m = { ...parsed.data, description: cleanPastedText(parsed.data.description) };

  const location = m.location;
  const department = departmentFromText(location) ?? departmentFromText(m.address);
  const first = location ? location.split(/,|\(/)[0]!.trim() || null : null;
  const isDepartment = (t: string) => Object.values(DEPARTMENTS).some((d) => comparable(d) === comparable(t));
  // « Paris » est à la fois une ville et un département : c'est une ville.
  const city = first && !/^\d+$/.test(first) && (/^paris\b/i.test(first) || !isDepartment(first)) ? first : null;

  const exp = m.experienceYears !== null ? { min: m.experienceYears, max: null } : parseExperienceYears(m.description);
  const text = `${m.title}\n${m.description}`;
  const salaryMin = m.salaryMin ?? m.salaryMax;
  const salaryMax = m.salaryMax ?? m.salaryMin;
  const annual = salaryMin !== null && salaryMin >= 8000;

  const job: Omit<NormalizedJob, "fingerprint" | "contentHash"> = {
    source: MANUAL_SOURCE,
    sourceJobId: raw.sourceJobId,
    sourceUrl: m.url ?? "",
    canonicalUrl: m.url,
    title: m.title,
    company: m.company,
    description: m.description,
    contractType: m.contractType ?? contractFromText(m.description),
    experienceText: null,
    experienceMinYrs: exp?.min ?? null,
    experienceMaxYrs: exp?.max ?? null,
    salaryMin: annual ? salaryMin : null,
    salaryMax: annual ? salaryMax : null,
    salaryPeriod: annual ? "year" : null,
    salaryText: null,
    city,
    postalCode: m.address?.match(/\b\d{5}\b/)?.[0] ?? null,
    department,
    address: m.address,
    latitude: null,
    longitude: null,
    locationPrecision: "unknown",
    remoteType: m.remoteType !== "unknown" ? m.remoteType : detectRemote(text),
    technologies: extractSkills(text).map((id) => getSkill(id)?.label ?? id),
    publishedAt: null,
    rawData: { ...m, origin: manualOrigin(m.url) },
  };
  return {
    ...job,
    fingerprint: fingerprintOf({ source: MANUAL_SOURCE, sourceJobId: raw.sourceJobId, company: m.company, title: m.title, city }),
    contentHash: sha([comparable(m.title), comparable(m.description), job.contractType, job.salaryMin, job.salaryMax, department, city, job.remoteType, job.experienceMinYrs]),
  };
}
