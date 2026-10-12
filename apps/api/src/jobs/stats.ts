import { resolveSkill } from "@job-radar/skills";
import type { JobSummary } from "./service";

const DAY = 86_400_000;
/** Évolution : 30 derniers jours comparés aux 30 jours d'avant. */
const PERIOD_DAYS = 30;
/** En dessous, la part d'une compétence varie au hasard : pas d'évolution affichée. */
export const MIN_OFFERS_FOR_TREND = 100;
/** En dessous, la part d'offres accessibles d'une compétence ne veut rien dire. */
const MIN_KNOWN_EXPERIENCE = 5;

export type SkillStat = {
  label: string;
  /** Nombre d'offres qui la demandent. */
  offers: number;
  /** Part des offres (%). */
  share: number;
  /** Dans ton profil. */
  owned: boolean;
  /** Langage ou framework principal (pèse dans le score), sinon outil. */
  core: boolean;
  /** Écart de part en points : 30 derniers jours − 30 jours d'avant ; null si trop peu d'offres. */
  trend: number | null;
  /** Part (%) des offres à expérience précisée qui demandent au plus ton maximum ; null si trop peu. */
  accessible: number | null;
};

export type SkillStats = {
  /** Offres où au moins une compétence est lue (les autres ne sont pas des postes de développeur). */
  offers: number;
  since: Date | null;
  recentOffers: number;
  previousOffers: number;
  /** Part des offres (%) où tu as tous les langages et frameworks demandés. */
  fullMatch: number;
  skills: SkillStat[];
  /** Compétences absentes de ton profil, seule techno principale manquante d'une offre : ce qui en débloquerait le plus. */
  unlock: Array<{ label: string; offers: number }>;
  /** Expérience minimum demandée : tranches, et part accessible avec ton maximum (`experienceMax` du profil). */
  experience: {
    max: number;
    known: number;
    accessible: number;
    ranges: Array<{ label: string; offers: number; share: number }>;
  };
  /** Pour tes langages et frameworks les plus demandés : ce qui t'en manque le plus souvent dans leurs offres. */
  together: Array<{ label: string; offers: number; with: Array<{ label: string; share: number }> }>;
  /** Toutes les offres de chaque source, et celles au-dessus de ton seuil de notification (non masquées). */
  sources: Array<{ source: string; offers: number; good: number }>;
};

type Input = Pick<JobSummary, "matchedSkills" | "missingSkills" | "publishedAt" | "firstSeenAt" | "experienceMinYrs" | "sources"> & {
  score: Pick<JobSummary["score"], "final" | "hidden">;
};

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
const RANGES = [
  { label: "0 à 2 ans", test: (y: number) => y <= 2 },
  { label: "3 à 4 ans", test: (y: number) => y >= 3 && y <= 4 },
  { label: "5 ans et plus", test: (y: number) => y >= 5 },
];

/**
 * Compétences demandées dans les offres, avec ta place : mêmes compétences que le score
 * (lues par l'IA si l'analyse est à jour). `experienceMax` et `threshold` viennent du profil.
 */
export function skillStats(jobs: Input[], opts: { experienceMax: number; threshold: number }, now = new Date()): SkillStats {
  const items = jobs.filter((j) => j.matchedSkills.length + j.missingSkills.length > 0);
  const ageDays = (j: Input) => (now.getTime() - (j.publishedAt ?? j.firstSeenAt).getTime()) / DAY;
  const isCore = (label: string) => resolveSkill(label).core;
  const accessible = (j: Input) => j.experienceMinYrs !== null && j.experienceMinYrs <= opts.experienceMax;

  const by = new Map<string, { offers: number; owned: boolean; recent: number; previous: number; known: number; accessible: number }>();
  const unlock = new Map<string, number>();
  let recentOffers = 0;
  let previousOffers = 0;
  let fullMatch = 0;
  for (const j of items) {
    const age = ageDays(j);
    const recent = age < PERIOD_DAYS;
    const previous = !recent && age < 2 * PERIOD_DAYS;
    if (recent) recentOffers++;
    if (previous) previousOffers++;
    for (const [labels, owned] of [[j.matchedSkills, true], [j.missingSkills, false]] as const) {
      for (const label of new Set(labels)) {
        const s = by.get(label) ?? { offers: 0, owned, recent: 0, previous: 0, known: 0, accessible: 0 };
        s.offers++;
        if (recent) s.recent++;
        if (previous) s.previous++;
        if (j.experienceMinYrs !== null) s.known++;
        if (accessible(j)) s.accessible++;
        by.set(label, s);
      }
    }
    const missingCore = [...new Set(j.missingSkills.filter(isCore))];
    if (missingCore.length === 0) fullMatch++;
    else if (missingCore.length === 1 && j.matchedSkills.some(isCore)) unlock.set(missingCore[0]!, (unlock.get(missingCore[0]!) ?? 0) + 1);
  }

  const trendOk = recentOffers >= MIN_OFFERS_FOR_TREND && previousOffers >= MIN_OFFERS_FOR_TREND;
  const skills = [...by]
    .map(([label, s]) => ({
      label,
      offers: s.offers,
      share: pct(s.offers, items.length),
      owned: s.owned,
      core: isCore(label),
      trend: trendOk ? pct(s.recent, recentOffers) - pct(s.previous, previousOffers) : null,
      accessible: s.known >= MIN_KNOWN_EXPERIENCE ? pct(s.accessible, s.known) : null,
    }))
    .sort((a, b) => b.offers - a.offers || a.label.localeCompare(b.label));

  const years = items.map((j) => j.experienceMinYrs).filter((y): y is number => y !== null);

  const together = skills
    .filter((s) => s.owned && s.core)
    .slice(0, 3)
    .map((s) => {
      const withIt = items.filter((j) => j.matchedSkills.includes(s.label));
      const counts = new Map<string, number>();
      for (const j of withIt) for (const l of new Set(j.missingSkills)) counts.set(l, (counts.get(l) ?? 0) + 1);
      return {
        label: s.label,
        offers: withIt.length,
        with: [...counts]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([label, n]) => ({ label, share: pct(n, withIt.length) })),
      };
    });

  // Sources : toutes les offres (une offre vue sur 2 sources compte pour les 2).
  const sources = new Map<string, { offers: number; good: number }>();
  for (const j of jobs) {
    const good = !j.score.hidden && j.score.final >= opts.threshold;
    for (const source of new Set(j.sources.map((s) => s.source))) {
      const s = sources.get(source) ?? { offers: 0, good: 0 };
      s.offers++;
      if (good) s.good++;
      sources.set(source, s);
    }
  }

  const dates = items.map((j) => (j.publishedAt ?? j.firstSeenAt).getTime());
  return {
    offers: items.length,
    since: dates.length ? new Date(Math.min(...dates)) : null,
    recentOffers,
    previousOffers,
    fullMatch: pct(fullMatch, items.length),
    skills,
    unlock: [...unlock]
      .map(([label, offers]) => ({ label, offers }))
      .sort((a, b) => b.offers - a.offers)
      .slice(0, 5),
    experience: {
      max: opts.experienceMax,
      known: years.length,
      accessible: pct(years.filter((y) => y <= opts.experienceMax).length, years.length),
      ranges: RANGES.map((r) => {
        const n = years.filter(r.test).length;
        return { label: r.label, offers: n, share: pct(n, years.length) };
      }),
    },
    together,
    sources: [...sources].map(([source, s]) => ({ source, ...s })).sort((a, b) => b.good - a.good || b.offers - a.offers),
  };
}
