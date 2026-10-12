import type { CvMaster, CvOverrides } from "@job-radar/shared";
import { EMPTY_OVERRIDES } from "@job-radar/shared";
import { runChecks } from "./checks";
import { matchOf } from "./tailor";
import { cvSkillLabel } from "@job-radar/skills";
import type { PickedItem, TailoredCvDraft } from "./types";

const SPACE = "manque de place";

/**
 * Retire UN élément pour gagner de la place, dans l'ordre fixe du §6.3 :
 * loisirs → projet le moins bien noté → ligne « ifRelevant » la moins bien notée → compétences « cours » à 0 point
 * → (une colonne) description courte d'un projet. Ce qui a été remis à la main n'est jamais retiré.
 * null = plus rien à retirer. Ne touche jamais à la police ni aux marges.
 */
export function shrinkOnce(draft: TailoredCvDraft, master: CvMaster, overrides: CvOverrides = EMPTY_OVERRIDES): TailoredCvDraft | null {
  const s = structuredClone(draft.sections);
  const picked = [...draft.picked];
  const manual = new Set(overrides.add);
  const scoreOf = (kind: PickedItem["kind"], id: string) => picked.find((p) => p.kind === kind && p.id === id)?.score ?? 0;
  const done = (removed: PickedItem[]): TailoredCvDraft => ({
    ...draft,
    sections: s,
    picked: picked.filter((p) => !removed.includes(p)),
    dropped: [...draft.dropped, ...removed.map((r) => ({ ...r, why: SPACE }))],
    match: matchOf(s, draft.match.offer, master),
    checks: runChecks(s, master, draft.substitutions, draft.offerTitle, (draft.fromProfile ?? []).map(cvSkillLabel)),
  });
  /** Le moins bien noté ; à égalité, le dernier affiché. */
  const lowest = <T>(xs: T[], score: (x: T) => number): T | undefined => xs.reduce<T | undefined>((min, x) => (min === undefined || score(x) <= score(min) ? x : min), undefined);

  // 1. Loisirs
  if (s.hobbies.length) {
    s.hobbies = [];
    return done(picked.filter((p) => p.kind === "hobbies"));
  }

  // 2. Projet le moins bien noté (sans descendre sous minProjects)
  if (s.projects.length > master.rules.minProjects) {
    const p = lowest(s.projects.filter((x) => !manual.has(x.id)), (x) => scoreOf("project", x.id));
    if (p) {
      s.projects = s.projects.filter((x) => x !== p);
      return done(picked.filter((x) => x.kind === "project" && x.id === p.id));
    }
  }

  // 3. Ligne « ifRelevant » la moins bien notée, toutes expériences confondues (sans descendre sous minBullets)
  const candidates = s.experiences.flatMap((e) => {
    const min = master.experiences.find((m) => m.id === e.id)?.minBullets ?? 0;
    if (e.bullets.length <= min) return [];
    return e.bullets
      .map((b) => picked.find((p) => p.kind === "bullet" && p.id === b.id))
      .filter((p): p is PickedItem => !!p && p.rule === "ifRelevant" && !manual.has(p.id))
      .map((p) => ({ e, p }));
  });
  const line = lowest(candidates, (x) => x.p.score);
  if (line) {
    line.e.bullets = line.e.bullets.filter((b) => b.id !== line.p.id);
    return done([line.p]);
  }

  // 4. Compétences de niveau « cours » à 0 point
  const zeroCourse = picked.filter((p) => p.kind === "skill" && p.level === "cours" && p.score === 0);
  if (zeroCourse.length) {
    for (const g of s.skillGroups) g.items = g.items.filter((i) => !zeroCourse.some((p) => p.id === i.skillId && p.parent === g.id));
    s.skillGroups = s.skillGroups.filter((g) => g.items.length);
    return done(zeroCourse);
  }

  // 5. Modèle une colonne : description courte d'un projet (le moins bien noté d'abord)
  const long = lowest(s.projects.filter((p) => p.shortDescription), (x) => scoreOf("project", x.id));
  if (long) {
    long.description = long.shortDescription!;
    delete long.shortDescription;
    return done([]);
  }
  return null;
}

const NOT_REFILLABLE = /à la main|validée/;

/**
 * Prochains éléments à remettre quand il reste de la place sur la page (avant d'exporter) :
 * projets d'abord, puis lignes, par note puis ordre du CV complet, sans dépasser les maximums
 * ni remettre ce qui a été retiré à la main.
 */
export function fillCandidates(draft: TailoredCvDraft, master: CvMaster): string[] {
  const s = draft.sections;
  const byScore = (a: PickedItem, b: PickedItem, order: string[]) => b.score - a.score || order.indexOf(a.id) - order.indexOf(b.id);
  const refillable = draft.dropped.filter((d) => !NOT_REFILLABLE.test(d.why ?? ""));
  const projectOrder = master.projects.map((p) => p.id);
  const projects =
    s.projects.length < master.rules.maxProjects
      ? refillable.filter((d) => d.kind === "project").sort((a, b) => byScore(a, b, projectOrder))
      : [];
  const bulletOrder = master.experiences.flatMap((e) => e.bullets.map((b) => b.id));
  const bullets = refillable
    .filter((d) => {
      if (d.kind !== "bullet") return false;
      const shown = s.experiences.find((e) => e.id === d.parent)?.bullets.length ?? 0;
      return shown < (master.experiences.find((e) => e.id === d.parent)?.maxBullets ?? 0);
    })
    .sort((a, b) => byScore(a, b, bulletOrder));
  return [...projects, ...bullets].map((d) => d.id);
}
