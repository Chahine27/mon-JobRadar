import { detectRemote, parseExperienceYears } from "@job-radar/scoring";
import { DEPARTMENTS, departmentFromText } from "@job-radar/shared";
import { extractSkills, getSkill } from "@job-radar/skills";
import { JOOBLE_SOURCE, JoobleJobSchema, type RawJob, joobleJobId } from "@job-radar/source-connectors";
import { contractFromLabel } from "./contract";
import { htmlToText } from "./html";
import { parseLooseSalary } from "./salary";
import { comparable, fingerprintOf, parseParisDate, sha } from "./text";
import type { NormalizedJob } from "./types";

/** Offre Jooble : seulement un extrait de l'annonce, l'annonce complète est sur le site d'origine. */
export function normalizeJooble(raw: RawJob): NormalizedJob | null {
  const parsed = JoobleJobSchema.safeParse(raw.data);
  if (!parsed.success) return null;
  const j = parsed.data;
  const id = joobleJobId(j);
  const title = j.title ? htmlToText(j.title) : "";
  if (!id || !title || !j.link || !/^https:\/\//i.test(j.link)) return null;

  const description = htmlToText(j.snippet ?? "");
  const company = j.company?.trim() || null;
  const location = j.location?.trim() || null;
  // « Creil », « Paris (75) », « Compiègne, Hauts-de-France »… : la ville est la première partie.
  // « Oise (60) » : c'est un département, pas une ville → ville inconnue.
  const first = location ? location.split(/,|\(/)[0]!.trim() || null : null;
  const isDepartment = (t: string) => Object.values(DEPARTMENTS).some((d) => comparable(d) === comparable(t));
  const city = first && !isDepartment(first) ? first : null;
  const department = departmentFromText(location) ?? j._searchDepartment ?? null;
  const salary = parseLooseSalary(j.salary);
  const exp = parseExperienceYears(description);
  const published = parseParisDate(j.updated);

  const job: Omit<NormalizedJob, "fingerprint" | "contentHash"> = {
    source: JOOBLE_SOURCE,
    sourceJobId: id,
    sourceUrl: j.link,
    canonicalUrl: null,
    title,
    company,
    description,
    contractType: contractFromLabel(j.type),
    experienceText: null,
    experienceMinYrs: exp?.min ?? null,
    experienceMaxYrs: exp?.max ?? null,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryPeriod: salary ? "year" : null,
    salaryText: j.salary?.trim() || null,
    city,
    postalCode: null,
    department,
    address: null,
    latitude: null,
    longitude: null,
    locationPrecision: "unknown",
    remoteType: detectRemote(`${title}\n${description}\n${location ?? ""}`),
    technologies: extractSkills(`${title}\n${description}`).map((s) => getSkill(s)?.label ?? s),
    publishedAt: published,
    rawData: raw.data,
  };
  return {
    ...job,
    fingerprint: fingerprintOf({ source: JOOBLE_SOURCE, sourceJobId: id, company, title, city }),
    contentHash: sha([comparable(title), comparable(description), job.contractType, job.salaryMin, job.salaryMax, department, city]),
  };
}
