import { describe, expect, it } from "vitest";
import { skillStats } from "./jobs/stats";
import { createTestApp, login } from "./test-helpers";

const now = new Date("2026-10-10T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const job = (matched: string[], missing: string[], age: number, o: { exp?: number; source?: string; score?: number; hidden?: boolean } = {}) => ({
  matchedSkills: matched,
  missingSkills: missing,
  publishedAt: daysAgo(age),
  firstSeenAt: daysAgo(age),
  experienceMinYrs: o.exp ?? null,
  sources: [{ source: o.source ?? "france-travail", url: "https://example.com" }],
  score: { final: o.score ?? 50, hidden: o.hidden ?? false },
});
const opts = { experienceMax: 2, threshold: 70 };

describe("skillStats", () => {
  it("compte les compétences, ta couverture et ce qui débloquerait le plus d'offres", () => {
    const s = skillStats(
      [
        job(["Vue.js", "TypeScript"], [], 1),
        job(["Java"], ["Angular", "Docker"], 2),
        job(["Java"], ["Angular"], 3),
        job(["Vue.js"], ["React", "Angular"], 4),
        job([], [], 5), // pas un poste de développeur
      ],
      opts,
      now,
    );
    expect(s.offers).toBe(4);
    expect(s.fullMatch).toBe(25);
    expect(s.skills[0]).toMatchObject({ label: "Angular", offers: 3, share: 75, owned: false, core: true, trend: null });
    expect(s.skills.find((k) => k.label === "Docker")).toMatchObject({ core: false });
    // Docker est un outil : seul Angular manque vraiment dans les offres Java.
    expect(s.unlock).toEqual([{ label: "Angular", offers: 2 }]);
  });

  it("évolution : 30 derniers jours contre les 30 d'avant, seulement avec assez d'offres", () => {
    const recent = Array.from({ length: 100 }, (_, i) => job(["Vue.js"], i < 50 ? ["React"] : [], 5));
    const previous = Array.from({ length: 100 }, (_, i) => job(["Vue.js"], i < 20 ? ["React"] : [], 40));
    const s = skillStats([...recent, ...previous, job(["Vue.js"], ["React"], 90)], opts, now);
    expect(s.recentOffers).toBe(100);
    expect(s.previousOffers).toBe(100);
    expect(s.skills.find((k) => k.label === "React")!.trend).toBe(30);
    expect(skillStats(recent, opts, now).skills[0]!.trend).toBeNull();
  });

  it("expérience demandée, compétences associées et sources", () => {
    const jobs = [
      job(["Vue.js", "TypeScript"], [], 1, { exp: 0, source: "adzuna", score: 90 }),
      job(["Vue.js"], ["React"], 1, { exp: 1, source: "adzuna", score: 80, hidden: true }),
      job(["Vue.js", "TypeScript"], [], 1, { exp: 2 }),
      job(["Vue.js"], [], 1, { exp: 3 }),
      job(["Vue.js"], [], 1, { exp: 6, score: 75 }),
      job([], [], 1, { source: "jooble" }),
    ];
    const s = skillStats(jobs, opts, now);
    expect(s.experience).toEqual({
      max: 2,
      known: 5,
      accessible: 60,
      ranges: [
        { label: "0 à 2 ans", offers: 3, share: 60 },
        { label: "3 à 4 ans", offers: 1, share: 20 },
        { label: "5 ans et plus", offers: 1, share: 20 },
      ],
    });
    expect(s.skills.find((k) => k.label === "Vue.js")!.accessible).toBe(60);
    expect(s.skills.find((k) => k.label === "TypeScript")!.accessible).toBeNull(); // moins de 5 offres
    expect(s.together[0]).toEqual({
      label: "Vue.js",
      offers: 5,
      with: [{ label: "React", share: 20 }],
    });
    // Une offre masquée ne compte pas comme bonne ; les offres sans compétence comptent pour leur source.
    expect(s.sources).toEqual([
      { source: "france-travail", offers: 3, good: 1 },
      { source: "adzuna", offers: 2, good: 1 },
      { source: "jooble", offers: 1, good: 0 },
    ]);
  });
});

describe("GET /api/jobs/stats", () => {
  it("renvoie les statistiques des offres", async () => {
    const t = await createTestApp();
    const cookies = await login(t.app);
    const res = await t.app.inject({ method: "GET", url: "/api/jobs/stats", cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().offers).toBe(4);
    expect((await t.app.inject({ method: "GET", url: "/api/jobs/stats" })).statusCode).toBe(401);
  });
});
