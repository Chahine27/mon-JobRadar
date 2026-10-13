import { describe, expect, it } from "vitest";
import { formatSalary, safeUrl, scoreTone, sourceBadge, timeAgo } from "./format";

describe("format", () => {
  it("formatSalary", () => {
    expect(formatSalary(40000, 45000)).toBe("40k–45k €");
    expect(formatSalary(null, 42000)).toBe("42k €");
    expect(formatSalary(38000, 38000)).toBe("38k €");
    expect(formatSalary(null, null)).toBeNull();
  });

  it("timeAgo", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    expect(timeAgo("2026-09-28T11:57:00Z", now)).toBe("il y a 3 min");
    expect(timeAgo("2026-09-28T09:00:00Z", now)).toBe("il y a 3 h");
    expect(timeAgo("2026-09-27T12:00:00Z", now)).toBe("hier");
    expect(timeAgo("2026-09-24T12:00:00Z", now)).toBe("il y a 4 j");
    expect(timeAgo(null, now)).toBe("date inconnue");
  });

  it("scoreTone", () => {
    expect(scoreTone(85)).toBe("good");
    expect(scoreTone(60)).toBe("mid");
    expect(scoreTone(30)).toBe("low");
  });

  it("safeUrl refuse les liens dangereux", () => {
    expect(safeUrl("https://candidat.francetravail.fr/offres/123")).toBe("https://candidat.francetravail.fr/offres/123");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("pas une url")).toBeNull();
  });
});

describe("pastille d'une source", () => {
  const last = { lastStatus: "OK", lastError: null };
  const p = (extra: object) => ({ source: "adzuna", state: "running" as const, done: 0, total: 0, found: 0, status: null, ...extra });
  it("pendant la collecte : attente, recherches, enregistrement, terminée", () => {
    expect(sourceBadge(last, p({ state: "pending" }))).toMatchObject({ text: "en attente", busy: true });
    expect(sourceBadge(last, p({ done: 3, total: 12, found: 1 }))).toEqual({ tone: "", text: "3/12 recherches · 1 offre", busy: true, pct: 25 });
    expect(sourceBadge(last, p({ done: 12, total: 12, found: 40 }))).toMatchObject({ text: "enregistrement de 40 offres…", pct: 100 });
    expect(sourceBadge(last, p({ total: 0 }))).toMatchObject({ text: "collecte…", pct: null });
    expect(sourceBadge(last, p({ state: "done", status: "OK", found: 2 }))).toMatchObject({ tone: "good", text: "terminée · 2 offres", busy: false });
  });
  it("hors collecte : IP bloquée ≠ non configurée", () => {
    const blocked = { lastStatus: "SOURCE_UNAVAILABLE", lastError: "IP bloquée — LinkedIn limite tes requêtes (HTTP 429)" };
    expect(sourceBadge(blocked).text).toBe("bloquée");
    expect(sourceBadge({ lastStatus: "SOURCE_UNAVAILABLE", lastError: "JobScraper est désactivé." }).text).toBe("non configurée");
    expect(sourceBadge({ lastStatus: null, lastError: null }).text).toBe("jamais lancée");
    expect(sourceBadge({ lastStatus: "ERROR", lastError: "x" })).toMatchObject({ tone: "bad", text: "erreur" });
  });
});
