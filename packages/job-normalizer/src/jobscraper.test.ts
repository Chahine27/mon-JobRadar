import { describe, expect, it } from "vitest";
import { normalize } from "./index";

describe("JobScraper normalization", () => {
  it("keeps unknown salary and publication date separate from collection time", () => {
    const collectedAt = new Date("2026-10-05T12:00:00Z");
    const raw = {
      source: "jobscraper:linkedin", sourceJobId: "li-42", collectedAt,
      data: {
        id: "li-42", source: "linkedin", url: "https://example.test/jobs/42", title: "Développeur Vue.js",
        company: "Acme", location: "Paris, France", description: "Vue.js et TypeScript", salary_min: null,
        salary_max: null, salary_currency: "EUR", contract_type: null, experience_level: null,
        remote: null, posted_at: "2026-10-04T09:30:00+02:00", scraped_at: "2026-10-05T12:00:00",
        skills: ["Vue.js"], benefits: [],
      },
    };
    const job = normalize(raw);
    expect(job).toMatchObject({
      source: "jobscraper:linkedin", sourceJobId: "li-42", sourceUrl: "https://example.test/jobs/42",
      salaryMin: null, salaryMax: null, salaryPeriod: null, remoteType: "unknown",
      publishedAt: new Date("2026-10-04T07:30:00Z"),
    });
    expect(job?.technologies).toContain("Vue.js");
  });

  it("garde une offre dont l'entreprise et le lieu sont vides", () => {
    const job = normalize({
      source: "jobscraper:linkedin", sourceJobId: "li-43", collectedAt: new Date(),
      data: { id: "li-43", source: "linkedin", url: "https://example.test/jobs/43", title: "Développeur Vue.js", company: "", location: null },
    });
    expect(job).toMatchObject({ company: null, city: null, department: null });
  });

  it("LinkedIn : « cdi » de JobScraper vient de « Temps plein » → contrat inconnu (lu ensuite dans le titre)", () => {
    const base = { id: "li-7", url: "https://example.test/jobs/7", title: "STAGE Backend", company: "Winamax", location: "Paris", contract_type: "cdi" };
    const li = normalize({ source: "jobscraper:linkedin", sourceJobId: "li-7", collectedAt: new Date(), data: { ...base, source: "linkedin" } });
    expect(li?.contractType).toBeNull();
    // WTTJ, lui, donne le vrai type de contrat.
    const wttj = normalize({ source: "jobscraper:wttj", sourceJobId: "w-7", collectedAt: new Date(), data: { ...base, id: "w-7", source: "wttj" } });
    expect(wttj?.contractType).toBe("CDI");
  });
});

describe("HelloWork : lieu « ville - département »", () => {
  it.each([
    ["Beauvais - 60", "Beauvais", "60"],
    ["Saint-Just-en-Chaussée - 60", "Saint-Just-En-Chaussée", "60"],
  ])("%s", (location, city, department) => {
    const job = normalize({ source: "jobscraper:hellowork", sourceJobId: "1", collectedAt: new Date(), data: { id: "1", source: "hellowork", url: "https://x.test/1", title: "Dev", location } });
    expect([job?.city, job?.department]).toEqual([city, department]);
  });
});
