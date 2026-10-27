import { describe, expect, it } from "vitest";
import { linkVerdict } from "./expire";

const NOW = new Date("2026-09-29T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const job = (published: number | null, firstSeen = 1) => ({ publishedAt: published === null ? null : daysAgo(published), firstSeenAt: daysAgo(firstSeen) });

describe("expiration des offres", () => {
  it("France Travail : revue récemment → en ligne, sinon on se fie à la réponse de l'API", () => {
    const link = (d: number) => ({ source: "france-travail", sourceJobId: "1", lastSeenAt: daysAgo(d) });
    expect(linkVerdict(link(3), job(10), NOW)).toBe("online");
    expect(linkVerdict(link(8), job(10), NOW, false)).toBe("gone");
    expect(linkVerdict(link(8), job(10), NOW, true)).toBe("online");
    expect(linkVerdict(link(8), job(10), NOW, null)).toBe("unknown"); // erreur réseau : on ne conclut rien
    expect(linkVerdict(link(8), job(10), NOW)).toBe("unknown");
  });

  it("sites carrières : absente de la page carrières depuis 2 jours → retirée", () => {
    const link = (d: number) => ({ source: "company-careers", sourceJobId: "x", lastSeenAt: daysAgo(d) });
    expect(linkVerdict(link(1), job(5), NOW)).toBe("online");
    expect(linkVerdict(link(2), job(5), NOW)).toBe("gone");
  });

  it("Adzuna : publiée il y a plus de 45 jours → considérée retirée", () => {
    const link = { source: "adzuna", sourceJobId: "a", lastSeenAt: daysAgo(3) };
    expect(linkVerdict(link, job(30), NOW)).toBe("online");
    expect(linkVerdict(link, job(50), NOW)).toBe("gone");
    expect(linkVerdict(link, job(null, 50), NOW)).toBe("gone");
  });

  it("Adzuna : la réponse de sa page l'emporte sur l'âge ; sans réponse, règle des 45 jours", () => {
    const link = { source: "adzuna", sourceJobId: "5922296683", lastSeenAt: daysAgo(3) };
    expect(linkVerdict(link, job(10), NOW, false)).toBe("gone"); // page en 410 : retirée même si récente
    expect(linkVerdict(link, job(50), NOW, true)).toBe("online"); // vieille mais encore en ligne
    expect(linkVerdict(link, job(50), NOW, null)).toBe("gone"); // bloqué : on retombe sur l'âge
  });

  it("démo et sources inconnues : jamais expirées", () => {
    expect(linkVerdict({ source: "demo", sourceJobId: "d", lastSeenAt: daysAgo(100) }, job(100), NOW)).toBe("online");
  });
});

describe("LinkedIn (JobScraper)", () => {
  const li = { source: "jobscraper:linkedin", sourceJobId: "linkedin_4474244898", lastSeenAt: NOW };
  it("close seulement si LinkedIn le dit (candidatures plus acceptées ou offre supprimée)", () => {
    expect(linkVerdict(li, { publishedAt: null, firstSeenAt: NOW }, NOW, false)).toBe("gone");
    expect(linkVerdict(li, { publishedAt: null, firstSeenAt: NOW }, NOW, true)).toBe("online");
    expect(linkVerdict(li, { publishedAt: null, firstSeenAt: NOW }, NOW, null)).toBe("online"); // bloqué / réseau : on ne conclut rien
    expect(linkVerdict(li, { publishedAt: null, firstSeenAt: NOW }, NOW)).toBe("online");
  });
});

describe("HelloWork, WTTJ, Indeed (sites scrapés sur 24 h)", () => {
  it.each(["jobscraper:hellowork", "jobscraper:wttj", "jobscraper:indeed"])("%s : publiée il y a plus de 45 jours → retirée", (source) => {
    const link = { source, sourceJobId: "x", lastSeenAt: daysAgo(3) };
    expect(linkVerdict(link, job(30), NOW)).toBe("online");
    expect(linkVerdict(link, job(50), NOW)).toBe("gone");
  });
});
