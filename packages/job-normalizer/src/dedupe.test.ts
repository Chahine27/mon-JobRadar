import { describe, expect, it } from "vitest";
import { dedupeKeyOf, sameOffer } from "./dedupe";

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
