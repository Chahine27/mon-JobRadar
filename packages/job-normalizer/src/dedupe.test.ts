import { describe, expect, it } from "vitest";
import { dedupeKeyOf, sameAdText, sameOffer, sameSalary, similarOffer } from "./dedupe";

const offer = (title: string, city: string | null = "Paris", department: string | null = "75") => ({ title, city, department });

describe("dedupeKeyOf : même offre, écritures différentes", () => {
  const key = dedupeKeyOf("Collective.work", "Développeur Backend Node.js / TypeScript Senior - Freelance (H/F)");
  it("suffixe de contrat, (H/F), tirets, « Full‑Stack » et raison sociale n'y changent rien", () => {
    expect(dedupeKeyOf("Collective.work", "Développeur Backend Node.js / TypeScript Senior - Freelance")).toBe(key);
    expect(dedupeKeyOf("COLLECTIVE.WORK SAS", "développeur  backend node.js / typescript senior – freelance (f/h)")).toBe(key);
    expect(dedupeKeyOf("Acme", "Développeur Full‑Stack")).toBe(dedupeKeyOf("Acme", "Développeur Fullstack H/F"));
    expect(dedupeKeyOf("Acme", "Développeur·se Front-end")).toBe(dedupeKeyOf("Acme", "Développeur Frontend"));
  });
  it("un autre intitulé ou une autre entreprise donne une autre clé", () => {
    expect(dedupeKeyOf("Collective.work", "Développeur Full Stack Java Angular - Freelance")).not.toBe(dedupeKeyOf("Collective.work", "Senior Développeur Full Stack Java Angular Quarkus - Freelance"));
    expect(dedupeKeyOf("Autre", "Développeur Backend Node.js / TypeScript Senior")).not.toBe(key);
  });
  it("sans entreprise : pas de clé (on ne fusionne pas à l'aveugle)", () => {
    expect(dedupeKeyOf(null, "Développeur")).toBeNull();
  });
});

describe("sameOffer : titre, contrat, lieu", () => {
  it("Paris = 8ème Arrondissement = lieu inconnu, tant que le département ne dit pas le contraire", () => {
    expect(sameOffer(offer("Dev Node.js - CDI", "Paris", "75"), offer("Dev Node.js - CDI", "8ème Arrondissement", "75"))).toBe(true);
    expect(sameOffer(offer("Dev Node.js", "Paris", "75"), offer("Dev Node.js", null, null))).toBe(true);
    expect(sameOffer(offer("Dev Node.js", "Paris", null), offer("Dev Node.js", "8ème Arrondissement", null))).toBe(true);
  });
  it("villes précises différentes, même voisines : deux offres (le trajet n'est pas le même)", () => {
    expect(sameOffer(offer("Tech Lead Cloud", "Beauvais", "60"), offer("Tech Lead Cloud", "Tillé", "60"))).toBe(false);
    expect(sameOffer(offer("Dev Java", "Lyon", "69"), offer("Dev Java", "Paris", "75"))).toBe(false);
    expect(sameOffer(offer("Dev Java", "Lyon", null), offer("Dev Java", "Paris", null))).toBe(false);
  });
  it("lieu vague (« France », arrondissement seul) : compatible sauf si les départements diffèrent", () => {
    expect(sameOffer(offer("Dev Java", "La Défense", "92"), offer("Dev Java", "France", null))).toBe(true);
    expect(sameOffer(offer("Dev Java", "Paris 5e Arrondissement", "75"), offer("Dev Java", "Paris", "75"))).toBe(true);
    expect(sameOffer(offer("Dev Java", "8ème Arrondissement", "75"), offer("Dev Java", "Lyon", "69"))).toBe(false);
  });
  it("CDI et Freelance écrits dans les deux titres : deux offres ; contrat absent d'un titre : on ne conclut rien", () => {
    expect(sameOffer(offer("Concepteur .NET - CDI"), offer("Concepteur .NET - Freelance"))).toBe(false);
    expect(sameOffer(offer("Concepteur .NET - Freelance (H/F)"), offer("Concepteur .NET - Freelance"))).toBe(true);
    expect(sameOffer(offer("Développeur c# .net confirmé (CDI)"), offer("Développeur C# .NET Confirmé"))).toBe(true);
  });
});

describe("sameAdText : deux annonces d'une même source", () => {
  it("même annonce collectée deux fois (espaces, intro en plus) → même texte", () => {
    expect(sameAdText("About The Role What if the code you write could directly power the AI systems", "About The RoleWhat if the code you write could directly power the AI systems")).toBe(true);
    expect(sameAdText("Le groupe La Centrale recherche un(e) développeur(se) fullstack pour son équipe", "Descriptif du poste : Le groupe La Centrale recherche un(e) développeur(se) fullstack pour son équipe")).toBe(true);
  });

  it("agence ou ESN : autre client, autre tarif → textes différents", () => {
    expect(sameAdText(
      "Nous recherchons un Développeur .NET (H/F) sur Paris. Vous assurerez la conception et le développement d'applications.",
      "Nous recherchons un Développeur .Net (H/F) sur Paris, France. Vous assurerez le développement et la maintenance.",
    )).toBe(false);
    expect(sameAdText("Taux journalier (TJM): 470 Mission Freelance - Développeur Fullstack .NET / Angular", "Taux journalier (TJM): 430 Mission Freelance - Développeur Fullstack .NET / Angular")).toBe(false);
  });

  it("texte absent ou trop court : rien à conclure", () => {
    expect(sameAdText("", "Nous recherchons un Développeur .NET (H/F) sur Paris.")).toBe(true);
  });
});

describe("même offre ou presque (avant de postuler)", () => {
  const at = (title: string, company: string | null, city: string | null = "Paris", department: string | null = null) => ({ title, company, city, department });
  // Cas réel : envoyée le 15/10 via Free-Work puis le 16/10 via Adzuna (qui ajoute « (IT) »).
  const freeWork = at("Développeur Java Junior Spring Boot / BDD Cucumber - F/H", "INGENIANCE");
  const adzuna = at("Développeur Java Junior Spring Boot / BDD Cucumber - F/H (IT)", "Ingeniance");

  it("reconnaît la même offre sur un autre site (casse, « (IT) », lieu absent d'un côté)", () => {
    expect(similarOffer(freeWork, adzuna)).toBe(true);
    expect(similarOffer(freeWork, { ...adzuna, city: null })).toBe(true);
  });

  it("ne confond pas des postes différents chez la même entreprise", () => {
    for (const other of [
      "Développeur / Architecte Java Big Data - Finance de marché - F/H",
      "Développeur Java Full Stack — Produits Dérivés Actions - F/H",
      "Développeur C++/C# - Finance de marché (Deal Capture) - F/H",
    ]) expect(similarOffer(freeWork, at(other, "Ingeniance"))).toBe(false);
    expect(similarOffer(at("Développeur C++/C# - Finance de marché - F/H", "Ingeniance"), at("Développeur C++/C# - Finance de marché (Deal Capture) - F/H", "Ingeniance"))).toBe(false);
  });

  it("autre entreprise, entreprise inconnue ou autre ville : pas la même offre", () => {
    expect(similarOffer(freeWork, { ...adzuna, company: "Acme" })).toBe(false);
    expect(similarOffer({ ...freeWork, company: null }, { ...adzuna, company: null })).toBe(false);
    expect(similarOffer(freeWork, { ...adzuna, city: "Lyon" })).toBe(false);
  });
});

describe("sameSalary : même texte, autre salaire", () => {
  const s = (salaryMin: number | null, salaryMax: number | null, salaryPeriod: string | null = "year") => ({ salaryMin, salaryMax, salaryPeriod });
  it("salaires qui ne se recoupent pas → deux offres (Talan 36 k€ / 70–100 k€)", () => {
    expect(sameSalary(s(36000, 36000), s(70000, 100000))).toBe(false);
  });
  it("fourchettes qui se recoupent, salaire inconnu ou autre période → rien à conclure", () => {
    expect(sameSalary(s(40000, 45000), s(45000, 50000))).toBe(true);
    expect(sameSalary(s(null, null, null), s(70000, 100000))).toBe(true);
    expect(sameSalary(s(450, 450, "day"), s(70000, 100000))).toBe(true);
  });
});
