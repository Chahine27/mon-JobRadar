import { describe, expect, it } from "vitest";
import { normalize } from "./index";
import { parseLooseSalary } from "./salary";

const raw = (data: Record<string, unknown>) => ({ source: "jooble", sourceJobId: "x", data, collectedAt: new Date() });
const base = {
  id: 1,
  title: "Développeur <b>Vue.js</b> H/F",
  location: "Compiègne, Hauts-de-France",
  snippet: "Stack Vue.js, TypeScript et Node.js. 2 ans d&#39;expérience minimum.",
  salary: "38 000 € - 42 000 € par an",
  type: "CDI",
  link: "https://fr.jooble.org/desc/-1234567890123456789?ckey=dev",
  company: "ACME",
  updated: "2026-09-28T10:00:00.0000000",
  _searchDepartment: "60",
};

describe("normalisation Jooble", () => {
  it("offre complète", () => {
    const n = normalize(raw(base))!;
    expect(n).toMatchObject({
      source: "jooble",
      sourceJobId: "-1234567890123456789",
      title: "Développeur Vue.js H/F",
      company: "ACME",
      city: "Compiègne",
      department: "60",
      contractType: "CDI",
      salaryMin: 38000,
      salaryMax: 42000,
      sourceUrl: base.link,
    });
    expect(n.technologies).toEqual(expect.arrayContaining(["Vue.js", "TypeScript", "Node.js"]));
    // Heure sans fuseau = heure de Paris (été : UTC+2), quel que soit le fuseau du PC.
    expect(n.publishedAt?.toISOString()).toBe("2026-09-28T08:00:00.000Z");
  });

  it("lieu illisible → zone de la recherche ; sans lien sûr → ignorée", () => {
    expect(normalize(raw({ ...base, location: "Hauts-de-France" }))!.department).toBe("60");
    const dep = normalize(raw({ ...base, location: "Oise (60)" }))!;
    expect(dep).toMatchObject({ city: null, department: "60" });
    expect(normalize(raw({ ...base, link: "javascript:alert(1)" }))).toBeNull();
    expect(normalize(raw({ ...base, title: "" }))).toBeNull();
  });

  it("salaires en texte libre", () => {
    expect(parseLooseSalary("35 000 € - 45 000 €")).toEqual({ min: 35000, max: 45000 });
    expect(parseLooseSalary("38k € - 42k €")).toEqual({ min: 38000, max: 42000 });
    expect(parseLooseSalary("2 800 € par mois")).toEqual({ min: 33600, max: 33600 });
    expect(parseLooseSalary("450 € par jour")).toBeNull();
    expect(parseLooseSalary("12 € de l'heure")).toBeNull();
    expect(parseLooseSalary("$120,000")).toBeNull();
    expect(parseLooseSalary("")).toBeNull();
  });
});

describe("dates sans fuseau = heure de Paris", () => {
  it("été, hiver, fuseau explicite, invalide", async () => {
    const { parseParisDate } = await import("./text");
    expect(parseParisDate("2026-09-28T10:00:00.0000000")?.toISOString()).toBe("2026-09-28T08:00:00.000Z");
    expect(parseParisDate("2026-12-01T10:00:00")?.toISOString()).toBe("2026-12-01T09:00:00.000Z");
    expect(parseParisDate("2026-09-28T10:00:00Z")?.toISOString()).toBe("2026-09-28T10:00:00.000Z");
    expect(parseParisDate("n'importe quoi")).toBeNull();
    expect(parseParisDate(undefined)).toBeNull();
  });
});
