import { describe, expect, it } from "vitest";
import { isAbridged, trimLinkedinCompany } from "./job";

describe("isAbridged", () => {
  const job = (sources: string[], description: string) => ({ sources: sources.map((source) => ({ source })), fullTextAt: null, description });
  it("extrait Adzuna, même si l'offre est aussi vue sur une source complète", () => {
    expect(isAbridged(job(["adzuna"], "Texte complet."))).toBe(true);
    expect(isAbridged(job(["adzuna", "jobscraper:indeed"], "… et obtenir des..."))).toBe(true);
    expect(isAbridged(job(["adzuna", "jobscraper:indeed"], "Texte complet repris d'Indeed."))).toBe(false);
    expect(isAbridged(job(["france-travail"], "Une phrase qui finit par..."))).toBe(false);
    expect(isAbridged({ ...job(["adzuna"], "x..."), fullTextAt: new Date() })).toBe(false);
  });
  it("annonce Adzuna relue sur Free-Work (texte entier, plus long qu'un extrait) : complète", () => {
    expect(isAbridged(job(["adzuna"], "Contexte de la mission. ".repeat(30)))).toBe(false);
    expect(isAbridged(job(["adzuna"], `${"Contexte de la mission. ".repeat(30)}…`))).toBe(true);
  });
});

describe("trimLinkedinCompany", () => {
  it("bloc « À propos de l'entreprise » de l'extension : nom, secteur, taille seulement (VISIAN via Free-Work)", () => {
    const text = "Annonce.\n\nINFOS À CÔTÉ DE L'ANNONCE\nÀ propos de l’entreprise\n\nFree-Work\n\n101 192 abonnés\n\nSuivre\n\nServices de ressources humaines\n\n •\n\n11-50 employés\n\n •\n\n1 952 sur LinkedIn\n\nBienvenue chez Free-Work… freelance, stage ou alternance.";
    expect(trimLinkedinCompany(text)).toBe("Annonce.\n\nINFOS À CÔTÉ DE L'ANNONCE\nÀ propos de l’entreprise\nFree-Work\nServices de ressources humaines\n11-50 employés");
    expect(trimLinkedinCompany(trimLinkedinCompany(text))).toBe(trimLinkedinCompany(text));
    // Welcome to the Jungle : colonne utile (adresse, télétravail), laissée telle quelle.
    const wttj = "Annonce.\n\nINFOS À CÔTÉ DE L'ANNONCE\nLe lieu de travail\n48 Boulevard des Batignolles, 75017 Paris";
    expect(trimLinkedinCompany(wttj)).toBe(wttj);
  });
});
