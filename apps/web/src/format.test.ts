import { describe, expect, it } from "vitest";
import { formatSalary, safeUrl, scoreTone, timeAgo } from "./format";

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
