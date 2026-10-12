import { describe, expect, it } from "vitest";
import { isAbridged } from "./job";

describe("isAbridged", () => {
  const job = (sources: string[], description: string) => ({ sources: sources.map((source) => ({ source })), fullTextAt: null, description });
  it("extrait Adzuna, même si l'offre est aussi vue sur une source complète", () => {
    expect(isAbridged(job(["adzuna"], "Texte complet."))).toBe(true);
    expect(isAbridged(job(["adzuna", "jobscraper:indeed"], "… et obtenir des..."))).toBe(true);
    expect(isAbridged(job(["adzuna", "jobscraper:indeed"], "Texte complet repris d'Indeed."))).toBe(false);
    expect(isAbridged(job(["france-travail"], "Une phrase qui finit par..."))).toBe(false);
    expect(isAbridged({ ...job(["adzuna"], "x..."), fullTextAt: new Date() })).toBe(false);
  });
});
