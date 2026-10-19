import { createHash } from "node:crypto";
import {
  courseOnlySkills,
  type CvMaster,
  type CvOverrides,
  EMPTY_OVERRIDES,
  type Level,
  type Style,
  type TemplateId,
  type TextVariant,
} from "@job-radar/shared";
import { cvSkillLabel, getCvSkill, isPlainSkillLabel, extractCvSkills, normalizeText } from "@job-radar/skills";
import { displayedTexts, runChecks } from "./checks";
import { BACK, cleanOfferTitle, FRONT } from "./job";
import { CV_RULES_VERSION, type CvMatch, type JobForCv, type PickedItem, type Reason, type RenderModel, type Substitution, type TailoredCvDraft } from "./types";

export const STYLE_OF: Record<TemplateId, Style> = { "une-colonne": "verbe", "deux-colonnes": "nom" };

export function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

const LEVEL_RANK: Record<Level, number> = { pro: 0, projet: 1, cours: 2 };

/** Meilleur niveau de chaque compétence dans le CV complet (ce qui a été fait, pas l'équipe). */
export function bestLevels(m: CvMaster): Map<string, Level> {
  const best = new Map<string, Level>();
  const see = (s: string, l: Level) => {
    const cur = best.get(s);
    if (!cur || LEVEL_RANK[l] < LEVEL_RANK[cur]) best.set(s, l);
  };
  for (const e of m.experiences) for (const b of e.bullets) for (const s of b.skills) see(s, b.level);
  for (const p of m.projects) for (const s of p.ownSkills) see(s, "projet");
  for (const g of m.skillGroups) for (const i of g.items) see(i.skillId, i.level);
  return best;
}

/** Premier libellé de la compétence dans les groupes du CV complet. */
function masterLabel(m: CvMaster, skillId: string): string | null {
  for (const g of m.skillGroups) for (const i of g.items) if (i.skillId === skillId) return i.label;
  return null;
}

const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * CV adapté à une offre (§4). Pur et déterministe : mêmes données, mêmes règles → même résultat.
 * Toutes les phrases viennent mot pour mot de variantes validées du CV complet.
 */
export function tailorCv(
  master: CvMaster,
  job: JobForCv,
  template: TemplateId,
  overrides: CvOverrides = EMPTY_OVERRIDES,
  /** Lignes ou projets remis pour remplir la page (ajustement, §6.3) : placés comme les autres, par note. */
  fill: string[] = [],
): TailoredCvDraft {
  const style = STYLE_OF[template];
  const req = new Set(job.required);
  const nice = new Set(job.niceToHave);
  const men = new Set(job.mentioned);
  const forbidden = new Set(master.rules.forbiddenSkills);
  const removed = new Set(overrides.remove);
  const filled = new Set(fill);
  const added = new Set([...overrides.add, ...fill]);
  const warnings: string[] = [];
  const picked: PickedItem[] = [];
  const dropped: PickedItem[] = [];
  const substitutions: Substitution[] = [];

  const pointsOf = (s: string) => (req.has(s) ? 10 : nice.has(s) ? 4 : men.has(s) ? 2 : 0);
  const scoreOf = (skills: string[], level: Level): { score: number; reasons: Reason[] } => {
    const factor = level === "cours" ? 0.5 : 1;
    const reasons = [...new Set(skills)].map((s) => ({ skillId: s, points: pointsOf(s) * factor })).filter((r) => r.points > 0);
    return { score: reasons.reduce((a, r) => a + r.points, 0), reasons };
  };

  /** Variante validée du style du modèle ; sinon l'autre style (style mélangé). Jamais une variante à valider. */
  const pickVariant = (vs: TextVariant[], blockId: string): { v: TextVariant; mixed: boolean } | null => {
    const ok = vs.filter((v) => !v.toValidate);
    const forced = overrides.variants[blockId] && ok.find((v) => v.id === overrides.variants[blockId]);
    if (forced) return { v: forced, mixed: false };
    const same = ok.find((v) => v.style === style);
    if (same) return { v: same, mixed: false };
    return ok[0] ? { v: ok[0], mixed: true } : null;
  };
  const mixedWarning = (what: string) => warnings.push(`Style mélangé : « ${what} » n'a pas de phrase validée au style « ${style} ».`);

  /** Ordre voulu à la main d'abord, puis le reste dans l'ordre calculé. */
  const applyOrder = <T extends { id: string }>(items: T[], key: string): T[] => {
    const wanted = overrides.order[key] ?? [];
    const first = wanted.map((id) => items.find((x) => x.id === id)).filter((x): x is T => !!x);
    return [...first, ...items.filter((x) => !first.includes(x))];
  };

  // ── Expériences : toutes, de la plus récente à la plus ancienne (jamais réordonnées par note).
  const experiences = [...master.experiences]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.start.localeCompare(a.e.start) || a.i - b.i)
    .map(({ e }) => {
      const scored = e.bullets.map((b, i) => ({ id: b.id, b, i, ...scoreOf(b.skills, b.level), pick: pickVariant(b.variants, b.id) }));
      const item = (x: (typeof scored)[number], why?: string): PickedItem => ({
        kind: "bullet",
        id: x.id,
        label: short(x.pick?.v.text ?? x.b.variants[0]!.text),
        score: x.score,
        reasons: x.reasons,
        parent: e.id,
        rule: x.b.rule,
        ...(why ? { why } : filled.has(x.id) && !overrides.add.includes(x.id) ? { fill: true } : {}),
      });
      const usable = scored.filter((x) => {
        if (x.pick) return true;
        dropped.push(item(x, "aucune phrase validée"));
        return false;
      });
      const byScore = (a: (typeof scored)[number], b: (typeof scored)[number]) => b.score - a.score || a.i - b.i;
      const kept = usable.filter((x) => x.b.rule === "always" && !removed.has(x.id));
      const relevant = usable.filter((x) => x.b.rule === "ifRelevant" && !removed.has(x.id)).sort(byScore);
      for (const x of relevant) if (kept.length < e.maxBullets && x.score > 0) kept.push(x);
      for (const x of relevant) if (kept.length < e.minBullets && !kept.includes(x)) kept.push(x);
      for (const x of usable) if (added.has(x.id) && !kept.includes(x)) kept.push(x);
      kept.sort((a, b) => (a.b.rule === "always" ? 0 : 1) - (b.b.rule === "always" ? 0 : 1) || byScore(a, b));
      const ordered = applyOrder(kept, e.id);
      for (const x of ordered) {
        picked.push(item(x));
        if (x.pick!.mixed) mixedWarning(x.id);
      }
      for (const x of usable) if (!kept.includes(x)) dropped.push(item(x, removed.has(x.id) ? "retirée à la main" : x.score > 0 ? "limite de lignes atteinte" : "rien en commun avec l'offre"));
      return {
        id: e.id,
        role: e.role,
        company: e.company,
        contract: e.contract,
        start: e.start,
        end: e.end,
        bullets: ordered.map((x) => ({ id: x.id, text: x.pick!.v.text })),
      };
    });

  // ── Projets : par note, entre minProjects et maxProjects.
  const { minProjects, maxProjects } = master.rules;
  const projScored = master.projects.map((p, i) => ({ id: p.id, p, i, ...scoreOf(p.ownSkills, "projet"), pick: pickVariant(p.descriptions, p.id) }));
  const projItem = (x: (typeof projScored)[number], why?: string): PickedItem => ({
    kind: "project",
    id: x.id,
    label: x.p.name,
    score: x.score,
    reasons: x.reasons,
    ...(why ? { why } : filled.has(x.id) && !overrides.add.includes(x.id) ? { fill: true } : {}),
  });
  const projUsable = projScored.filter((x) => {
    if (x.pick) return true;
    dropped.push(projItem(x, "aucune description validée"));
    return false;
  });
  const projByScore = (a: (typeof projScored)[number], b: (typeof projScored)[number]) => b.score - a.score || a.i - b.i;
  const projCandidates = projUsable.filter((x) => !removed.has(x.id)).sort(projByScore);
  const projKept: typeof projScored = [];
  for (const x of projCandidates) if (projKept.length < maxProjects && x.score > 0) projKept.push(x);
  for (const x of projCandidates) if (projKept.length < minProjects && !projKept.includes(x)) projKept.push(x);
  for (const x of projUsable) if (added.has(x.id) && !projKept.includes(x)) projKept.push(x);
  projKept.sort(projByScore);
  const projOrdered = applyOrder(projKept, "projects");
  for (const x of projOrdered) {
    picked.push(projItem(x));
    if (x.pick!.mixed) mixedWarning(x.id);
  }
  for (const x of projUsable) if (!projKept.includes(x)) dropped.push(projItem(x, removed.has(x.id) ? "retiré à la main" : x.score > 0 ? "limite de projets atteinte" : "rien en commun avec l'offre"));

  /** Libellé écrit comme dans l'offre si c'est un synonyme du dictionnaire (§4.6). */
  const substitute = (label: string, skillId: string | undefined, blockId: string): string => {
    if (!master.rules.allowLabelSubstitution || !skillId) return label;
    const form = job.forms[skillId];
    if (!form || !/\p{Lu}/u.test(form) || !isPlainSkillLabel(label, skillId)) return label;
    // Jamais une forme plus courte déjà contenue dans le libellé (« Docker Compose » reste tel quel si l'offre écrit « Docker »).
    if (normalizeText(label).includes(normalizeText(form))) return label;
    substitutions.push({ blockId, from: label, to: form });
    return form;
  };

  const projects = projOrdered.map(({ p, pick }) => {
    const other = pick!.v.style !== "nom" ? p.descriptions.find((d) => !d.toValidate && d.style === "nom" && d.text !== pick!.v.text) : undefined;
    return {
      id: p.id,
      name: p.name,
      context: p.context,
      team: p.team,
      ...(p.roleNote ? { roleNote: p.roleNote } : {}),
      description: pick!.v.text,
      ...(template === "une-colonne" && other ? { shortDescription: other.text } : {}),
      technologies: p.technologies.map((t) => {
        const ids = extractCvSkills(t);
        return substitute(t, ids.length === 1 ? ids[0] : undefined, `${p.id}:technologies`);
      }),
    };
  });

  // ── Compétences de ton profil citées par l'offre mais absentes des groupes du CV complet : ajoutées au groupe
  // qui leur ressemble le plus (côté serveur / interface, sinon même famille). Jamais dans une phrase.
  // Déjà quelque part dans le CV complet (groupe, ligne, technologies d'un projet : « Auth0 / JWT ») : rien à ajouter.
  const masterText = [
    ...master.skillGroups.flatMap((g) => g.items.map((i) => i.label)),
    ...master.projects.flatMap((p) => p.technologies),
    ...master.experiences.flatMap((e) => e.bullets.flatMap((b) => b.variants.map((v) => v.text))),
  ].join("\n");
  const inMaster = new Set([...bestLevels(master).keys(), ...extractCvSkills(masterText)]);
  const fromProfile = (job.profileSkills ?? []).filter((s) => (req.has(s) || nice.has(s) || men.has(s)) && !forbidden.has(s) && !inMaster.has(s));
  const profileGroup = new Map<string, string>();
  for (const s of fromProfile) {
    const like = BACK.has(s) ? (x: string) => BACK.has(x) : FRONT.has(s) ? (x: string) => FRONT.has(x) : (x: string) => getCvSkill(x)?.family === getCvSkill(s)?.family;
    const best = master.skillGroups
      .map((g) => ({ g, n: g.items.filter((i) => like(i.skillId)).length }))
      .sort((a, b) => b.n - a.n)[0];
    if (best && best.n > 0) profileGroup.set(s, best.g.id);
  }

  // ── Compétences : groupes les plus utiles d'abord ; dans un groupe : exigées, « plus », puis par niveau.
  const groups = master.skillGroups
    .map((g, gi) => {
      const extra = [...profileGroup].filter(([, gid]) => gid === g.id).map(([s]) => ({ skillId: s, label: cvSkillLabel(s), level: "projet" as Level }));
      const items = [...g.items, ...extra]
        .filter((it) => !forbidden.has(it.skillId))
        .map((it, ii) => ({ it, ii, pts: pointsOf(it.skillId) * (it.level === "cours" ? 0.5 : 1) }));
      const rank = (x: (typeof items)[number]) => (req.has(x.it.skillId) ? 0 : nice.has(x.it.skillId) ? 1 : 2 + LEVEL_RANK[x.it.level]);
      const sorted = [...items].sort((a, b) => rank(a) - rank(b) || a.ii - b.ii);
      const kept = sorted.slice(0, master.rules.maxSkillsPerGroup);
      const skillItem = (x: (typeof items)[number], why?: string): PickedItem => ({
        kind: "skill",
        id: x.it.skillId,
        label: x.it.label,
        score: x.pts,
        reasons: x.pts > 0 ? [{ skillId: x.it.skillId, points: x.pts }] : [],
        parent: g.id,
        level: x.it.level,
        ...(why ? { why } : {}),
      });
      for (const x of kept) picked.push(skillItem(x));
      for (const x of sorted.slice(master.rules.maxSkillsPerGroup)) dropped.push(skillItem(x, "limite du groupe atteinte"));
      return { g, gi, sum: items.reduce((a, x) => a + x.pts, 0), kept };
    })
    .filter((x) => x.kept.length > 0)
    .sort((a, b) => (b.sum > 0 ? 1 : 0) - (a.sum > 0 ? 1 : 0) || b.sum - a.sum || a.gi - b.gi);
  // Même compétence plusieurs fois dans un groupe (« Claude Code » et « Cursor », tous deux « agents-ia ») : libellés
  // voulus, jamais remplacés par le mot de l'offre (sinon « Claude Code · Claude Code »).
  const skillGroups = groups.map(({ g, kept }) => ({
    id: g.id,
    label: g.label,
    items: kept.map(({ it }) => ({
      skillId: it.skillId,
      label: kept.filter((k) => k.it.skillId === it.skillId).length > 1 ? it.label : substitute(it.label, it.skillId, `skill:${it.skillId}`),
    })),
  }));

  // ── Titre : celui du type de poste qui partage le plus de compétences exigées ; sinon le titre par défaut.
  const titles = master.titles.filter((t) => !t.toValidate);
  const forcedTitle = overrides.titleId ? titles.find((t) => t.id === overrides.titleId) : undefined;
  const matching = titles
    .map((t, i) => ({ t, i, n: t.skills.filter((s) => req.has(s)).length }))
    .filter((x) => x.t.jobTypes.includes(job.jobType))
    .sort((a, b) => b.n - a.n || a.i - b.i);
  const title = forcedTitle ?? matching[0]?.t ?? titles.find((t) => t.isDefault) ?? titles[0]!;
  const levels = bestLevels(master);
  // Intitulé de l'offre repris tel quel (les recruteurs cherchent par intitulé), sauf titre choisi à la main,
  // poste hors de tes types, ou compétence citée que ton CV n'a pas (ou seulement vue en cours, ou interdite).
  const cleaned = forcedTitle || job.jobType === "other" ? null : cleanOfferTitle(job.title);
  const offerTitle =
    cleaned && extractCvSkills(cleaned).every((s) => !forbidden.has(s) && ((levels.has(s) && levels.get(s) !== "cours") || profileGroup.has(s))) ? cleaned : null;
  const titleSkills = offerTitle ? extractCvSkills(offerTitle) : title.skills;
  const baseTitle = offerTitle ?? title.text;
  let titleText = baseTitle;
  if (master.rules.titleTechSuffix.enabled && master.rules.titleTechSuffix.max > 0) {
    const inTitle = normalizeText(baseTitle);
    // Toutes exigées (mêmes points) : ce qui a été fait en entreprise d'abord, puis l'ordre du CV complet.
    const labels: Array<{ label: string; rank: number }> = [];
    for (const g of master.skillGroups)
      for (const it of g.items) {
        const s = it.skillId;
        const lvl = levels.get(s);
        if (!req.has(s) || forbidden.has(s) || !lvl || lvl === "cours" || titleSkills.includes(s)) continue;
        const label = masterLabel(master, s)!;
        if (labels.some((l) => l.label === label) || inTitle.includes(normalizeText(label))) continue;
        labels.push({ label, rank: LEVEL_RANK[lvl] });
      }
    const suffix = labels
      .sort((a, b) => a.rank - b.rank)
      .slice(0, master.rules.titleTechSuffix.max)
      .map((l) => l.label);
    if (suffix.length) titleText = `${baseTitle} | ${suffix.join(", ")}`;
  }
  picked.push({ kind: "title", id: offerTitle ? OFFER_TITLE_ID : title.id, label: titleText, ...scoreOf(titleSkills, "pro") });

  // ── Résumé : celui du modèle et du type de poste ; sinon celui du modèle pour tous les postes.
  const summaries = master.summaries.filter((s) => !s.toValidate);
  const fitsTpl = (s: (typeof summaries)[number]) => s.template === template || s.template === "any";
  const summary =
    summaries.find((s) => s.template === template && s.jobTypes !== "any" && s.jobTypes.includes(job.jobType)) ??
    summaries.find((s) => fitsTpl(s) && s.jobTypes !== "any" && s.jobTypes.includes(job.jobType)) ??
    summaries.find((s) => s.template === template && s.jobTypes === "any") ??
    summaries.find((s) => fitsTpl(s) && s.jobTypes === "any");
  if (summary) picked.push({ kind: "summary", id: summary.id, label: short(summary.text), score: 0, reasons: [] });
  else warnings.push(`Aucun résumé validé pour le modèle « ${template} ».`);

  const headline = pickVariant(master.headline, "headline");
  const education = master.education.map((e) => {
    const ok = e.lines.filter((l) => !l.toValidate);
    const same = ok.filter((l) => l.style === style);
    return { id: e.id, start: e.start, end: e.end, lines: (same.length ? same : ok).map((l) => l.text) };
  });
  if (master.hobbies.length) picked.push({ kind: "hobbies", id: "hobbies", label: master.hobbies.join(" · "), score: 0, reasons: [] });

  const sections: RenderModel = {
    template,
    identity: master.identity,
    headline: headline?.v.text ?? "",
    title: titleText,
    summary: summary?.text ?? "",
    experiences,
    projects,
    skillGroups,
    education,
    languages: master.languages,
    hobbies: master.hobbies,
  };

  // ── Ce que l'offre demande et que le CV n'a pas.
  const courseOnly = courseOnlySkills(master);
  const missing = {
    absent: job.required.filter((s) => !forbidden.has(s) && !levels.has(s) && !profileGroup.has(s)),
    onlyCourse: job.required.filter((s) => courseOnly.has(s)),
    forbidden: job.required.filter((s) => forbidden.has(s)),
  };
  if (job.isAbridged) warnings.unshift("Annonce incomplète (extrait) : complète-la d'abord pour un CV fiable.");
  if (job.skillsSource === "dictionary") warnings.push("Analyse IA absente ou périmée : compétences lues par le dictionnaire seul (toutes traitées comme exigées).");
  const covered = job.required.filter((s) => levels.has(s) && !courseOnly.has(s) && !forbidden.has(s));
  if (job.required.length && covered.length < 2) warnings.push(`Seulement ${covered.length} compétence(s) exigée(s) couverte(s) par ton CV.`);
  if (missing.absent.length) warnings.push(`Exigé dans l'offre mais absent de ton CV complet : ${missing.absent.map(cvSkillLabel).join(", ")}.`);

  const offerSkills = [...new Set(job.required.length + job.niceToHave.length ? [...job.required, ...job.niceToHave] : job.mentioned)];
  return {
    rulesVersion: CV_RULES_VERSION,
    masterHash: hashOf(master),
    jobHash: hashOf(job),
    overridesHash: hashOf(overrides),
    template,
    sections,
    picked,
    dropped,
    substitutions,
    missing,
    offerTitle,
    fromProfile: [...profileGroup.keys()],
    match: matchOf(sections, offerSkills, master),
    warnings: [...new Set(warnings)],
    checks: runChecks(sections, master, substitutions, offerTitle, [...profileGroup.keys()].map(cvSkillLabel)),
  };
}

/** Le titre repris de l'offre n'est pas un titre du CV complet. */
export const OFFER_TITLE_ID = "offre";

/**
 * Compétences de l'offre retrouvées dans le texte affiché du CV : ce que trouve un logiciel de tri
 * ou un recruteur qui cherche par mot-clé. Recalculé après chaque retrait pour tenir sur une page.
 */
export function matchOf(sections: RenderModel, offer: string[], master: CvMaster): CvMatch {
  const shown = new Set(extractCvSkills(displayedTexts(sections).map((s) => s.text).join("\n")));
  const levels = bestLevels(master);
  const found = offer.filter((s) => shown.has(s));
  const missing = offer.filter((s) => !shown.has(s));
  return {
    offer,
    found,
    missing,
    notShown: missing.filter((s) => levels.has(s) && !master.rules.forbiddenSkills.includes(s)),
    percent: offer.length ? Math.round((found.length / offer.length) * 100) : 0,
  };
}
