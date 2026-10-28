import { parseExperienceYears, parseSalaryText } from "@job-radar/scoring";
import { departmentFromText } from "@job-radar/shared";
import { extractSkills, getSkill } from "@job-radar/skills";
import { JOBSCRAPER_PROVIDERS, JobScraperOfferSchema, type JobScraperOffer, type RawJob } from "@job-radar/source-connectors";
import { contractFromLabel } from "./contract";
import { comparable, fingerprintOf, parseParisDate, sha, titleCase } from "./text";
import type { NormalizedJob } from "./types";

/** Mappe les champs réellement reçus. */
export function normalizeJobScraper(raw: RawJob): NormalizedJob | null {
  const provider = raw.source.slice("jobscraper:".length);
  if (!JOBSCRAPER_PROVIDERS.includes(provider as (typeof JOBSCRAPER_PROVIDERS)[number])) return null;
  const parsed = JobScraperOfferSchema.safeParse(raw.data);
  if (!parsed.success || parsed.data.source !== provider) return null;
  const job = parsed.data as JobScraperOffer;

  const title = job.title.trim();
  const company = typeof job.company === "string" && job.company.trim() ? job.company.trim() : null;
  const location = typeof job.location === "string" ? job.location.trim() : "";
  const description = typeof job.description === "string" ? job.description : "";
  if (!title || !/^https?:\/\//i.test(job.url)) return null;

  // HelloWork : « Beauvais - 60 » (ville - département).
  const dash = location.match(/^(.+?)\s+-\s+(\d{2}|2A|2B|97\d)$/);
  const cityText = (dash ? dash[1] : location.split(/[,·]/)[0])?.trim() || null;
  const city = cityText ? titleCase(cityText) : null;
  const postalCode = location.match(/\b\d{5}\b/)?.[0] ?? null;
  const department = dash ? dash[2]! : departmentFromText(location);
  const exp = parseExperienceYears(description);
  const text = `${title}\n${description}\n${(job.skills ?? []).join(" ")}`;
  const skillLabels = extractSkills(text).map((id) => getSkill(id)?.label ?? id);
  const technologies = [...new Set([...(job.skills ?? []).filter((s) => typeof s === "string" && s.trim()), ...skillLabels])];
  // WTTJ « partial » : hybride (avant, compté comme télétravail complet).
  const remoteType = job.workplace === "hybrid" ? "hybrid" : job.remote == null ? "unknown" : job.remote ? "remote" : "onsite";
  // LinkedIn n'a pas de type « CDI » : JobScraper traduit « Temps plein » (le temps de travail) en « cdi ».
  // Un stage à temps plein serait donc un CDI → inconnu ; le contrat est lu dans le titre ou la description.
  // WTTJ « CDD / Temporaire » était collecté en « interim » avant 2026-10-28 : c'est un CDD.
  const contractType =
    provider === "linkedin" && job.contract_type === "cdi" ? null
    : provider === "wttj" && job.contract_type === "interim" ? "CDD"
    : contractFromLabel(job.contract_type);
  const publishedAt = job.posted_at ? parseParisDate(job.posted_at) : null;
  // LinkedIn « Mid-Senior level » / « Confirmé » (mis sur presque toutes les annonces) arrive en « senior » : ne dit rien.
  const level = provider === "linkedin" && job.experience_level === "senior" ? null : job.experience_level;
  const experienceText = level ? `Niveau ${level}` : null;
  const salaryText = [job.salary_min, job.salary_max].some((n) => typeof n === "number")
    ? `${job.salary_min ?? job.salary_max}–${job.salary_max ?? job.salary_min} ${job.salary_currency ?? ""}`.trim()
    : null;
  // Période non donnée : lue comme un libellé (« 50000–90000 EUR » → annuel ; « 2500–3000 EUR » → mensuel ; autre devise → rien).
  const salary = parseSalaryText(salaryText);
  const normalized: Omit<NormalizedJob, "fingerprint" | "contentHash"> = {
    source: raw.source,
    sourceJobId: job.id,
    sourceUrl: job.url,
    canonicalUrl: null,
    title,
    company,
    description,
    contractType,
    experienceText,
    experienceMinYrs: exp?.min ?? null,
    experienceMaxYrs: exp?.max ?? null,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryPeriod: salary ? "year" : null,
    salaryText,
    city,
    postalCode,
    department,
    address: null,
    latitude: null,
    longitude: null,
    locationPrecision: "unknown",
    remoteType,
    technologies,
    publishedAt,
    rawData: raw.data,
  };
  return {
    ...normalized,
    fingerprint: fingerprintOf({ source: raw.source, sourceJobId: job.id, company, title, city }),
    contentHash: sha([comparable(title), comparable(description), contractType, experienceText, salaryText, city, remoteType, technologies]),
  };
}
