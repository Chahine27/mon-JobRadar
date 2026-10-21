import { courseSkillsIn, type CvMaster } from "@job-radar/shared";
import { cvSkillLabel, extractCvSkills, getCvSkill, mentionsSkill, normalizeText } from "@job-radar/skills";
import { type CheckResult, type RenderModel, SKILL_LINES, type Substitution } from "./types";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Toutes les phrases affichées, avec leur place (pour les messages). */
export function displayedTexts(m: RenderModel): Array<{ where: string; text: string; kind: "variant" | "fixed" | "label" | "title" }> {
  const out: ReturnType<typeof displayedTexts> = [];
  const fixed = (where: string, text: string | undefined) => text && out.push({ where, text, kind: "fixed" });
  fixed("nom", m.identity.fullName);
  fixed("téléphone", m.identity.phone);
  fixed("e-mail", m.identity.email);
  fixed("LinkedIn", m.identity.linkedin);
  fixed("GitHub", m.identity.github);
  fixed("ville", m.identity.city);
  if (m.headline) out.push({ where: "en-tête", text: m.headline, kind: "variant" });
  out.push({ where: "titre", text: m.title, kind: "title" });
  if (m.summary) out.push({ where: "profil", text: m.summary, kind: "variant" });
  for (const e of m.experiences) {
    fixed(`${e.id} (poste)`, e.role);
    fixed(`${e.id} (entreprise)`, e.company);
    fixed(`${e.id} (contrat)`, e.contract);
    for (const b of e.bullets) out.push({ where: b.id, text: b.text, kind: "variant" });
  }
  for (const p of m.projects) {
    fixed(`${p.id} (nom)`, p.name);
    fixed(`${p.id} (contexte)`, p.context);
    fixed(`${p.id} (équipe)`, p.team);
    fixed(`${p.id} (rôle)`, p.roleNote);
    fixed(`${p.id} (lien)`, p.link);
    out.push({ where: p.id, text: p.description, kind: "variant" });
    for (const t of p.technologies) out.push({ where: `${p.id} (technologies)`, text: t, kind: "label" });
  }
  for (const g of m.skillGroups) {
    fixed(`groupe ${g.id}`, g.label);
    for (const i of g.items) out.push({ where: `compétence ${i.skillId}`, text: i.label, kind: "label" });
  }
  for (const e of m.education) for (const l of e.lines) out.push({ where: e.id, text: l, kind: "variant" });
  for (const l of m.languages) fixed("langues", l);
  for (const h of m.hobbies) fixed("loisirs", h);
  return out;
}

function masterTexts(master: CvMaster) {
  const validated = new Set<string>();
  const pending = new Set<string>();
  const add = (v: { text: string; toValidate: boolean }) => (v.toValidate ? pending : validated).add(norm(v.text));
  master.headline.forEach(add);
  master.summaries.forEach(add);
  master.experiences.forEach((e) => e.bullets.forEach((b) => b.variants.forEach(add)));
  master.projects.forEach((p) => p.descriptions.forEach(add));
  master.education.forEach((e) => e.lines.forEach(add));
  const titles = new Set(master.titles.filter((t) => !t.toValidate).map((t) => norm(t.text)));
  master.titles.filter((t) => t.toValidate).forEach((t) => pending.add(norm(t.text)));
  const labels = new Set<string>();
  master.skillGroups.forEach((g) => g.items.forEach((i) => labels.add(norm(i.label))));
  master.projects.forEach((p) => p.technologies.forEach((t) => labels.add(norm(t))));
  const fixed = new Set<string>(
    [
      ...Object.values(master.identity),
      ...master.experiences.flatMap((e) => [e.role, e.company, e.contract]),
      ...master.projects.flatMap((p) => [p.name, p.context, p.team, p.roleNote ?? "", p.link]),
      ...master.skillGroups.map((g) => g.label),
      ...Object.values(SKILL_LINES),
      ...master.languages,
      ...master.hobbies,
    ].map(norm),
  );
  for (const v of validated) pending.delete(v);
  for (const t of titles) pending.delete(t);
  return { validated, pending, titles, labels, fixed };
}

/** Technos faites en entreprise : celles des lignes d'expérience de niveau « pro ». */
export function proSkills(master: CvMaster): Set<string> {
  return new Set(master.experiences.flatMap((e) => e.bullets.filter((b) => b.level === "pro").flatMap((b) => b.skills)));
}

/**
 * Technos du titre que les expériences ne prouvent pas : absentes des lignes « pro » (« Docker », « Angular »),
 * ou écrites autrement que le CV (« Java EE » quand seul « Java » est prouvé).
 */
export function unprovenTitleSkills(master: CvMaster, title: string): string[] {
  const pro = proSkills(master);
  return extractCvSkills(title).flatMap((id) => {
    const skill = getCvSkill(id)!;
    if (!pro.has(id) || master.rules.forbiddenSkills.includes(id)) return [cvSkillLabel(id)];
    const labels = [skill.label, ...master.skillGroups.flatMap((g) => g.items.filter((i) => i.skillId === id).map((i) => i.label))].map(normalizeText);
    const other = [...skill.aliases, ...(skill.caseSensitiveAliases ?? [])].find(
      (a) => !labels.some((l) => l.includes(normalizeText(a))) && mentionsSkill(title, { ...skill, label: a, aliases: [a], caseSensitiveAliases: [] }),
    );
    return other ? [other] : [];
  });
}

const wordRegex = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${normalizeText(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");

/** Contrôles bloquants 1 à 6 et 9 (§5), sur ce qui sera affiché. Les contrôles 7 et 8 sont faits sur le PDF. */
export function runChecks(
  m: RenderModel,
  master: CvMaster,
  substitutions: Substitution[],
  /** Titre construit (métier + technos d'entreprise), à la place d'un titre du CV complet. */
  builtTitle: string | null = null,
  /** Libellés des compétences ajoutées depuis ton profil. */
  profileLabels: string[] = [],
): CheckResult[] {
  const shown = displayedTexts(m);
  const t = masterTexts(master);
  const subs = new Set([...substitutions.map((s) => norm(s.to)), ...profileLabels.map(norm)]);

  // 1. Origine
  const origin: string[] = [];
  for (const s of shown) {
    const x = norm(s.text);
    const ok =
      s.kind === "variant" ? t.validated.has(x)
      : s.kind === "fixed" ? t.fixed.has(x)
      : s.kind === "label" ? t.labels.has(x) || subs.has(x)
      : t.titles.has(x) || x === builtTitle;
    if (!ok) origin.push(`${s.where} : « ${x.slice(0, 80)} » ne vient pas du CV complet`);
  }

  // 2. Compétences interdites (tous les synonymes, mot entier, sans majuscules ni accents)
  const all = shown.map((s) => s.text).join("\n");
  const forbiddenHits = master.rules.forbiddenSkills.filter((id) => {
    const skill = getCvSkill(id);
    return skill ? mentionsSkill(all, skill) : wordRegex(id).test(normalizeText(all));
  });

  // 3. Mots forts seulement à côté d'une compétence autorisée, dans la même phrase
  const strong = master.rules.strongWords.map(wordRegex);
  const allowed = master.rules.strongWordsAllowedFor.map(getCvSkill).filter((s) => !!s);
  const strongHits: string[] = [];
  for (const s of shown)
    for (const sentence of s.text.split(/(?<=[.!?;])\s+/)) {
      if (!strong.some((r) => r.test(normalizeText(sentence)))) continue;
      if (!allowed.some((sk) => mentionsSkill(sentence, sk))) strongHits.push(`${s.where} : « ${norm(sentence).slice(0, 80)} »`);
    }

  // 4. Obligatoires présents
  const mandatory: string[] = [];
  if (!m.identity.fullName) mandatory.push("nom");
  if (!m.identity.phone) mandatory.push("téléphone");
  if (!m.identity.email) mandatory.push("e-mail");
  if (!m.headline) mandatory.push("ligne d'en-tête (Bac+5…)");
  for (const e of master.experiences) if (!m.experiences.some((x) => x.id === e.id)) mandatory.push(`expérience ${e.role} (${e.company})`);
  for (const e of master.education) if (!m.education.some((x) => x.id === e.id && x.lines.length)) mandatory.push(`formation ${e.id}`);
  for (const p of master.projects)
    if (p.rule === "always" && p.descriptions.some((d) => !d.toValidate) && !m.projects.some((x) => x.id === p.id)) mandatory.push(`projet ${p.name}`);

  // 5. Rien de « vu en cours » dans le titre, le résumé ou les lignes d'expérience
  const course: string[] = [];
  const bulletTags = new Map(master.experiences.flatMap((e) => e.bullets.map((b) => [b.id, b.skills] as const)));
  const titleTags = master.titles.find((x) => norm(x.text) === norm(m.title))?.skills ?? [];
  const check5 = (where: string, text: string, tags: string[] = []) => {
    const c = courseSkillsIn(master, text, tags);
    if (c.length) course.push(`${where} : ${c.map(cvSkillLabel).join(", ")}`);
  };
  check5("titre", m.title, titleTags);
  check5("profil", m.summary);
  for (const e of m.experiences) for (const b of e.bullets) check5(b.id, b.text, bulletTags.get(b.id) ?? []);

  // 6. Aucune phrase « à valider »
  // L'intitulé repris de l'offre vient de l'offre, pas d'une phrase à valider du CV complet.
  const pending = shown
    .filter((s) => s.text !== builtTitle && t.pending.has(norm(s.text)))
    .map((s) => `${s.where} : phrase pas encore validée`);

  const unproven = unprovenTitleSkills(master, m.title);

  return [
    { id: 1, label: "Toutes les phrases viennent du CV complet", ok: origin.length === 0, details: origin },
    { id: 2, label: "Aucune compétence interdite", ok: forbiddenHits.length === 0, details: forbiddenHits.map(cvSkillLabel) },
    { id: 3, label: "Mots forts seulement à côté d'une compétence autorisée", ok: strongHits.length === 0, details: strongHits },
    { id: 4, label: "Éléments obligatoires présents", ok: mandatory.length === 0, details: mandatory.map((x) => `manque : ${x}`) },
    { id: 5, label: "Rien de « vu en cours » dans le titre, le profil ou l'expérience", ok: course.length === 0, details: course },
    { id: 6, label: "Aucune phrase à valider", ok: pending.length === 0, details: pending },
    { id: 7, label: "Tient sur une page", ok: null, details: [] },
    { id: 8, label: "PDF lisible par les logiciels de tri (nom, e-mail, titre)", ok: null, details: [] },
    { id: 9, label: "Titre : seulement des technos faites en entreprise", ok: unproven.length === 0, details: unproven.map((x) => `« ${x} » n'est pas prouvé par une expérience`) },
  ];
}

/** Un contrôle en échec bloque l'export PDF. */
export function blockingFailures(checks: CheckResult[]): CheckResult[] {
  return checks.filter((c) => c.ok === false);
}
