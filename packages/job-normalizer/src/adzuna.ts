import { detectRemote, parseExperienceYears } from "@job-radar/scoring";
import { departmentFromText } from "@job-radar/shared";
import { extractSkills, getSkill } from "@job-radar/skills";
import { ADZUNA_SOURCE, AdzunaJobSchema, type RawJob } from "@job-radar/source-connectors";
import { contractFromLabel } from "./contract";
import { htmlToText } from "./html";
import { comparable, fingerprintOf, sha, titleCase } from "./text";
import type { NormalizedJob } from "./types";

export function normalizeAdzuna(raw: RawJob): NormalizedJob | null {
  const parsed = AdzunaJobSchema.safeParse(raw.data);
  if (!parsed.success) return null;
  const a = parsed.data;
  const title = a.title ? htmlToText(a.title) : "";
  if (!title || !a.redirect_url) return null;

  const description = htmlToText(a.description ?? "");
  const company = a.company?.display_name?.trim() || null;
  const area = a.location?.area ?? [];
  const city = area.length > 2 ? titleCase(area[area.length - 1]!) : null;
  const department = departmentFromText(area.slice(2).join(", ")) ?? departmentFromText(a.location?.display_name);
  // Salaire estimé par Adzuna (salary_is_predicted = 1) : ce n'est pas l'annonce → ignoré.
  const predicted = String(a.salary_is_predicted ?? "0") === "1";
  // Moins de 8 000 € : taux journalier / horaire, pas un salaire annuel → ignoré.
  const annual = (n: number | undefined) => (!predicted && n && n >= 8000 ? Math.round(n) : null);
  const salaryMin = annual(a.salary_min);
  const salaryMax = annual(a.salary_max);
  const hasCoords = typeof a.latitude === "number" && typeof a.longitude === "number";
  const exp = parseExperienceYears(description);

  const job: Omit<NormalizedJob, "fingerprint" | "contentHash"> = {
    source: ADZUNA_SOURCE,
    sourceJobId: a.id,
    sourceUrl: a.redirect_url,
    canonicalUrl: null,
    title,
    company,
    description,
    contractType: contractFromLabel(a.contract_type),
    experienceText: null,
    experienceMinYrs: exp?.min ?? null,
    experienceMaxYrs: exp?.max ?? null,
    salaryMin: salaryMin ?? salaryMax,
    salaryMax: salaryMax ?? salaryMin,
    salaryPeriod: salaryMin || salaryMax ? "year" : null,
    salaryText: null,
    city,
    postalCode: null,
    department,
    address: null,
    latitude: hasCoords ? a.latitude! : null,
    longitude: hasCoords ? a.longitude! : null,
    locationPrecision: hasCoords ? "city_centroid" : "unknown",
    remoteType: detectRemote(`${title}\n${description}`),
    technologies: extractSkills(`${title}\n${description}`).map((id) => getSkill(id)?.label ?? id),
    publishedAt: a.created ? new Date(a.created) : null,
    rawData: raw.data,
  };
  return {
    ...job,
    fingerprint: fingerprintOf({ source: ADZUNA_SOURCE, sourceJobId: a.id, company, title, city }),
    contentHash: sha([comparable(title), comparable(description), job.contractType, job.salaryMin, job.salaryMax, department, city]),
  };
}
