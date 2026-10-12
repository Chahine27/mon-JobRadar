import { jobScraperFromEnv } from "./env";
import type { JobScraperOffer } from "@job-radar/source-connectors";

const sources = jobScraperFromEnv(true);
let failed = false;
for (const source of sources) {
  const checkedAt = Date.now();
  const health = await source.healthCheck();
  if (health.status !== "OK") {
    failed = true;
    console.log(JSON.stringify({ source: source.name, status: health.status, durationMs: Date.now() - checkedAt, error: health.message }));
    continue;
  }
  const started = Date.now();
  try {
    const jobs = await source.search({ keywords: "développeur", locationLabel: "Paris", publishedSinceDays: 1, maxResults: 10 });
    const fields = ["title", "company", "location", "url", "description", "posted_at", "salary_min", "contract_type", "experience_level", "remote", "skills", "benefits"];
    const counts = Object.fromEntries(fields.map((field) => [field, jobs.filter((job) => {
      const value = (job.data as JobScraperOffer)[field as keyof JobScraperOffer];
      return value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);
    }).length]));
    console.log(JSON.stringify({ source: source.name, status: "OK", count: jobs.length, durationMs: Date.now() - started, fields: counts }));
  } catch (error) {
    failed = true;
    console.log(JSON.stringify({ source: source.name, status: "ERROR", durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }));
  }
}
if (failed) process.exitCode = 1;
