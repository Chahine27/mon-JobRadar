import { detectRemote, parseExperienceYears } from "@job-radar/scoring";
import { departmentFromPostalCode, departmentFromText } from "@job-radar/shared";
import { extractSkills, getSkill } from "@job-radar/skills";
import { type AtsPosting, CAREERS_SOURCE, type RawJob } from "@job-radar/source-connectors";
import { annualEuros, contractFromLabel } from "./contract";
import { htmlToText } from "./html";
import { comparable, fingerprintOf, sha, titleCase } from "./text";
import type { NormalizedJob } from "./types";

function department(p: AtsPosting): string | null {
  const byPostal = departmentFromPostalCode(p.postalCode);
  if (byPostal) return byPostal;
  if (p.country && !/^(fr|fra|france)$/i.test(p.country.trim())) return "99"; // étranger
  return departmentFromText(p.location);
}

export function normalizeCareers(raw: RawJob): NormalizedJob | null {
  const p = raw.data as AtsPosting | undefined;
  if (!p || typeof p !== "object" || !p.id || !p.title || !/^https?:\/\//.test(p.url ?? "")) return null;

  const title = p.title.trim();
  const description = p.descriptionIsHtml ? htmlToText(p.description) : p.description.trim();
  const city = p.location ? titleCase(p.location.split(",")[0]!.trim()) : null;
  const salary = annualEuros(p.salary);
  const exp = parseExperienceYears(description);
  const text = `${title}\n${description}`;

  const job: Omit<NormalizedJob, "fingerprint" | "contentHash"> = {
    source: CAREERS_SOURCE,
    sourceJobId: raw.sourceJobId,
    sourceUrl: p.url,
    canonicalUrl: null,
    title,
    company: p.companyName,
    description,
    contractType: contractFromLabel(p.employmentType),
    experienceText: null,
    experienceMinYrs: exp?.min ?? null,
    experienceMaxYrs: exp?.max ?? null,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryPeriod: salary ? "year" : null,
    salaryText: null,
    city,
    postalCode: p.postalCode,
    department: department(p),
    address: null,
    latitude: null,
    longitude: null,
    locationPrecision: "unknown",
    remoteType: p.remote ?? detectRemote(text),
    technologies: extractSkills(text).map((id) => getSkill(id)?.label ?? id),
    publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
    rawData: raw.data,
  };
  return {
    ...job,
    fingerprint: fingerprintOf({ source: CAREERS_SOURCE, sourceJobId: raw.sourceJobId, company: p.companyName, title, city }),
    contentHash: sha([comparable(title), comparable(description), job.contractType, job.salaryMin, job.department, city]),
  };
}
