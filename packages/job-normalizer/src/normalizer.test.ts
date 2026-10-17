import { FT_SAMPLE_OFFER, type RawJob } from "@job-radar/source-connectors";
import { describe, expect, it } from "vitest";
import { comparable, fingerprintOf, normalize, parseFtSalary, repairApostrophes, titleCase } from "./index";

const raw = (data: object): RawJob => ({
  source: "france-travail",
  sourceJobId: (data as { id: string }).id,
  data,
  collectedAt: new Date("2026-09-28T10:00:00Z"),
});

describe("parseFtSalary", () => {
  it.each([
    ["Annuel de 38000.00 Euros à 42000.00 Euros sur 12 mois", { min: 38000, max: 42000 }],
    ["Annuel de 40000,0 Euros sur 12.0 mois", { min: 40000, max: 40000 }],
    ["Mensuel de 2500.00 Euros à 3000.00 Euros sur 12 mois", { min: 30000, max: 36000 }],
    ["Mensuel de 2 800,00 Euros sur 13 mois", { min: 36400, max: 36400 }],
    ["Horaire de 12.00 Euros sur 12 mois", { min: 21840, max: 21840 }],
  ] as const)("%s", (label, expected) => {
    expect(parseFtSalary(label)).toEqual(expected);
  });

  it("jamais deviné : absent, sans période ou incohérent → null", () => {
    expect(parseFtSalary(undefined)).toBeNull();
    expect(parseFtSalary("Selon profil")).toBeNull();
    expect(parseFtSalary("Annuel de 3000.00 Euros")).toBeNull();
  });
});

describe("normalize (France Travail)", () => {
  it("convertit une offre complète", () => {
    const job = normalize(raw(FT_SAMPLE_OFFER))!;
    expect(job).toMatchObject({
      source: "france-travail",
      sourceJobId: "199XYZT",
      sourceUrl: "https://candidat.francetravail.fr/offres/recherche/detail/199XYZT",
      title: "Développeur Full Stack Vue.js / Node.js (H/F)",
      company: "Atelier Numerique",
      contractType: "CDI",
      experienceText: "2 An(s)",
      experienceMinYrs: 2,
      salaryMin: 38000,
      salaryMax: 42000,
      salaryPeriod: "year",
      city: "Compiegne",
      postalCode: "60200",
      department: "60",
      address: null,
      latitude: 49.4179,
      longitude: 2.8261,
      locationPrecision: "city_centroid",
      remoteType: "hybrid",
    });
    expect(job.technologies).toEqual(["TypeScript", "Vue.js", "Node.js", "PostgreSQL", "Docker"]);
    expect(job.publishedAt?.toISOString()).toBe("2026-09-27T09:12:44.000Z");
    expect(job.rawData).toBe(FT_SAMPLE_OFFER);
  });

  it("champs absents → null / unknown, jamais inventés", () => {
    const job = normalize(raw({ id: "min-1", intitule: "Développeur" }))!;
    expect(job).toMatchObject({
      company: null,
      contractType: null,
      experienceMinYrs: null,
      salaryMin: null,
      salaryMax: null,
      city: null,
      department: null,
      latitude: null,
      locationPrecision: "unknown",
      remoteType: "unknown",
      publishedAt: null,
      sourceUrl: "https://candidat.francetravail.fr/offres/recherche/detail/min-1",
    });
    expect(job.fingerprint).toBe("src:france-travail:min-1");
  });

  it("débutant accepté, durée en mois, alternance, intérim, Paris", () => {
    const d = normalize(raw({ ...FT_SAMPLE_OFFER, experienceExige: "D", experienceLibelle: "Débutant accepté" }))!;
    expect(d.experienceMinYrs).toBe(0);
    const m = normalize(raw({ ...FT_SAMPLE_OFFER, experienceExige: "E", experienceLibelle: "6 Mois" }))!;
    expect(m.experienceMinYrs).toBe(0);
    const e = normalize(raw({ ...FT_SAMPLE_OFFER, experienceLibelle: "Expérience exigée de 5 An(s)" }))!;
    expect(e.experienceMinYrs).toBe(5);
    // Champ laissé à « Débutant accepté » mais texte exigeant 7 ans : le texte l'emporte.
    const t = normalize(raw({ ...FT_SAMPLE_OFFER, experienceExige: "D", experienceLibelle: "Débutant accepté", description: "Vous justifiez de plus de 7 ans d'expérience en développement." }))!;
    expect(t.experienceMinYrs).toBe(7);
    expect(t.experienceText).toBe("7 ans minimum");
    expect(normalize(raw({ ...FT_SAMPLE_OFFER, alternance: true }))!.contractType).toBe("ALTERNANCE");
    expect(normalize(raw({ ...FT_SAMPLE_OFFER, typeContrat: "MIS" }))!.contractType).toBe("INTERIM");
    const paris = normalize(raw({ ...FT_SAMPLE_OFFER, lieuTravail: { libelle: "75 - PARIS 09", codePostal: "75009" } }))!;
    expect(paris.department).toBe("75");
    expect(paris.city).toBe("Paris 09");
    expect(paris.locationPrecision).toBe("unknown");
  });

  it("garde l'URL du partenaire quand l'offre vient d'un autre site", () => {
    const job = normalize(
      raw({
        ...FT_SAMPLE_OFFER,
        origineOffre: { origine: "2", urlOrigine: "https://ft/x", partenaires: [{ nom: "HELLOWORK", url: "https://www.hellowork.com/offre/1" }] },
      }),
    )!;
    expect(job.canonicalUrl).toBe("https://www.hellowork.com/offre/1");
    expect(job.sourceUrl).toBe("https://ft/x");
  });

  it("offre inexploitable ou source inconnue → null", () => {
    expect(normalize(raw({ id: "x" }))).toBeNull();
    expect(normalize({ ...raw(FT_SAMPLE_OFFER), source: "inconnue" })).toBeNull();
  });

  it("l'empreinte de contenu change si l'offre change, pas si seule la date d'actualisation change", () => {
    const a = normalize(raw(FT_SAMPLE_OFFER))!;
    const b = normalize(raw({ ...FT_SAMPLE_OFFER, dateActualisation: "2026-10-01T00:00:00Z" }))!;
    const c = normalize(raw({ ...FT_SAMPLE_OFFER, salaire: { libelle: "Annuel de 45000 Euros" } }))!;
    expect(b.contentHash).toBe(a.contentHash);
    expect(c.contentHash).not.toBe(a.contentHash);
  });
});

describe("dédoublonnage : empreinte", () => {
  it("même entreprise + titre + ville → même empreinte, malgré casse / accents / (H/F)", () => {
    const a = fingerprintOf({ source: "france-travail", sourceJobId: "1", company: "Atelier Numérique", title: "Développeur Vue.js (H/F)", city: "Compiègne" });
    const b = fingerprintOf({ source: "adzuna", sourceJobId: "99", company: "ATELIER NUMERIQUE", title: "developpeur vue.js", city: "COMPIEGNE" });
    expect(a).toBe(b);
  });

  it("titre différent → empreinte différente", () => {
    const a = fingerprintOf({ source: "s", sourceJobId: "1", company: "X", title: "Dev Vue", city: "Paris" });
    const b = fingerprintOf({ source: "s", sourceJobId: "2", company: "X", title: "Dev Java", city: "Paris" });
    expect(a).not.toBe(b);
  });

  it("helpers", () => {
    expect(comparable("Développeur Vue.js (H/F) !")).toBe("developpeur vue js");
    expect(titleCase("SAINT-MAXIMIN")).toBe("Saint-Maximin");
  });
});

describe("apostrophes perdues par la source", () => {
  it("répare les élisions et « œuvre », sans toucher aux adresses ni aux vraies questions", () => {
    expect(repairApostrophes("La mission s?inscrit dans l?évolution d?une app, jusqu?à la mise en ?uvre. Qu?en dis-tu ?")).toBe(
      "La mission s’inscrit dans l’évolution d’une app, jusqu’à la mise en œuvre. Qu’en dis-tu ?",
    );
    expect(repairApostrophes("Voir https://site.fr/jobs?id=4 et watch?v=abc, tuteur?trice, Pourquoi?alors")).toBe(
      "Voir https://site.fr/jobs?id=4 et watch?v=abc, tuteur?trice, Pourquoi?alors",
    );
    expect(repairApostrophes("d�expérience")).toBe("d’expérience");
  });
});
