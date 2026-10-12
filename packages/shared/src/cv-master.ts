import { cvSkillLabel, extractCvSkills, getCvSkill } from "@job-radar/skills";
import { z } from "zod";

/**
 * CV complet découpé en morceaux (consignes CV_ADAPTE §2). Écrit et validé par Chahine ;
 * le CV adapté à une offre n'en reprend que des phrases validées, mot pour mot.
 */

export const TEMPLATE_IDS = ["une-colonne", "deux-colonnes"] as const;
export const TemplateIdSchema = z.enum(TEMPLATE_IDS);
export type TemplateId = z.infer<typeof TemplateIdSchema>;

export const JOB_TYPES = ["frontend", "backend", "fullstack", "mobile", "other"] as const;
export const JobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobTypeSchema>;

/** pro = fait en entreprise ; projet = fait soi-même en projet ; cours = vu en cours ou fait par l'équipe. */
export const LevelSchema = z.enum(["pro", "projet", "cours"]);
export type Level = z.infer<typeof LevelSchema>;

/** verbe : « Développé… » (une colonne) ; nom : « Développement… » (deux colonnes). */
export const StyleSchema = z.enum(["verbe", "nom"]);
export type Style = z.infer<typeof StyleSchema>;

const id = z.string().trim().min(1).max(60);
const text = z.string().trim().min(1).max(600);
const skillIds = z.array(z.string().trim().min(1).max(60)).max(30).default([]);
/** 'AAAA-MM' ou 'AAAA' : affiché avec exactement cette précision. */
const date = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "Date au format AAAA-MM ou AAAA");

export const TextVariantSchema = z.object({ id, style: StyleSchema, text, toValidate: z.boolean().default(false) });
export type TextVariant = z.infer<typeof TextVariantSchema>;

export const BulletSchema = z.object({
  id,
  variants: z.array(TextVariantSchema).min(1).max(6),
  skills: skillIds,
  level: LevelSchema.default("pro"),
  rule: z.enum(["always", "ifRelevant"]),
});
export type Bullet = z.infer<typeof BulletSchema>;

export const ExperienceSchema = z.object({
  id,
  role: text,
  company: text,
  contract: z.string().trim().max(60).default(""),
  start: date,
  end: date,
  rule: z.literal("always").default("always"),
  bullets: z.array(BulletSchema).max(20),
  maxBullets: z.number().int().min(0).max(20),
  minBullets: z.number().int().min(0).max(20),
});
export type Experience = z.infer<typeof ExperienceSchema>;

export const ProjectSchema = z.object({
  id,
  name: text,
  context: z.string().trim().max(200).default(""),
  team: z.string().trim().max(100).default(""),
  roleNote: z.string().trim().max(200).optional(),
  descriptions: z.array(TextVariantSchema).min(1).max(6),
  /** Libellés affichés dans « Technologies du projet », dans l'ordre voulu. */
  technologies: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  /** Fait par Chahine lui-même : compte pour la notation. */
  ownSkills: skillIds,
  /** Fait par l'équipe : affiché, mais ne compte pas comme compétence. */
  teamOnlySkills: skillIds,
  rule: z.literal("ifRelevant").default("ifRelevant"),
});
export type Project = z.infer<typeof ProjectSchema>;

export const SkillItemSchema = z.object({ skillId: id, label: z.string().trim().min(1).max(80), level: LevelSchema });
export const SkillGroupSchema = z.object({ id, label: z.string().trim().min(1).max(60), items: z.array(SkillItemSchema).max(30) });
export type SkillItem = z.infer<typeof SkillItemSchema>;
export type SkillGroup = z.infer<typeof SkillGroupSchema>;

export const CvRulesSchema = z.object({
  forbiddenSkills: skillIds,
  strongWordsAllowedFor: skillIds,
  strongWords: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  maxProjects: z.number().int().min(0).max(10),
  minProjects: z.number().int().min(0).max(10),
  maxSkillsPerGroup: z.number().int().min(1).max(30),
  titleTechSuffix: z.object({ enabled: z.boolean(), max: z.number().int().min(0).max(5) }),
  /** Libellé de compétence écrit comme dans l'offre (« VueJS ») si c'est un synonyme du dictionnaire. */
  allowLabelSubstitution: z.boolean().default(true),
});
export type CvRules = z.infer<typeof CvRulesSchema>;

export const CvTitleSchema = z.object({
  id,
  text: z.string().trim().min(1).max(120),
  skills: skillIds,
  jobTypes: z.array(JobTypeSchema).min(1),
  toValidate: z.boolean().default(false),
  isDefault: z.boolean().optional(),
});
export type CvTitle = z.infer<typeof CvTitleSchema>;

export const CvSummarySchema = z.object({
  id,
  template: z.union([TemplateIdSchema, z.literal("any")]),
  jobTypes: z.union([z.array(JobTypeSchema).min(1), z.literal("any")]),
  text: z.string().trim().min(1).max(1200),
  toValidate: z.boolean().default(false),
});
export type CvSummary = z.infer<typeof CvSummarySchema>;

export const EducationSchema = z.object({
  id,
  lines: z.array(TextVariantSchema).min(1).max(4),
  start: date,
  end: date,
  rule: z.literal("always").default("always"),
});
export type Education = z.infer<typeof EducationSchema>;

const CvMasterObject = z.object({
  identity: z.object({
    fullName: z.string().trim().min(1).max(80),
    phone: z.string().trim().min(1).max(40),
    email: z.email(),
    linkedin: z.string().trim().max(120).default(""),
    city: z.string().trim().max(120).default(""),
  }),
  headline: z.array(TextVariantSchema).min(1).max(4),
  titles: z.array(CvTitleSchema).min(1).max(20),
  summaries: z.array(CvSummarySchema).min(1).max(20),
  experiences: z.array(ExperienceSchema).max(10),
  projects: z.array(ProjectSchema).max(20),
  skillGroups: z.array(SkillGroupSchema).max(15),
  education: z.array(EducationSchema).max(10),
  languages: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  hobbies: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  rules: CvRulesSchema,
  /** Modèle envoyé aux logiciels de tri (ATS) ; l'autre sert pour les e-mails. */
  atsTemplate: TemplateIdSchema.default("une-colonne"),
  /** Points à trancher (liste à cocher de la page /cv). */
  todo: z.array(z.object({ id, text: z.string().trim().min(1).max(300), done: z.boolean().default(false) })).max(30).default([]),
});

/** Compétences dont le meilleur niveau dans le CV complet est « cours ». */
export function courseOnlySkills(m: z.infer<typeof CvMasterObject>): Set<string> {
  const rank = { cours: 0, projet: 1, pro: 2 } as const;
  const best = new Map<string, number>();
  const see = (s: string, l: Level) => best.set(s, Math.max(best.get(s) ?? -1, rank[l]));
  for (const e of m.experiences) for (const b of e.bullets) for (const s of b.skills) see(s, b.level);
  for (const p of m.projects) for (const s of p.ownSkills) see(s, "projet");
  for (const g of m.skillGroups) for (const i of g.items) see(i.skillId, i.level);
  return new Set([...best].filter(([, r]) => r === 0).map(([s]) => s));
}

/** Nom des diplômes (« Mastère Architecture Logicielle ») : citer son diplôme n'est pas revendiquer une compétence. */
export function withoutDiplomaNames(m: Pick<CvMaster, "education">, s: string): string {
  let out = s;
  for (const e of m.education) for (const l of e.lines) {
    const name = l.text.split(" — ")[0]!.trim();
    if (name.length >= 6) out = out.split(name).join(" ");
  }
  return out;
}

/** Compétences de niveau « cours » citées dans un texte (titre, résumé, ligne d'expérience). */
export function courseSkillsIn(m: CvMaster, s: string, tags: string[] = []): string[] {
  const cours = courseOnlySkills(m);
  return [...new Set([...tags, ...extractCvSkills(withoutDiplomaNames(m, s))])].filter((x) => cours.has(x));
}

export const CvMasterSchema = CvMasterObject.superRefine((m, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const forbidden = new Set(m.rules.forbiddenSkills);
  const known = (s: string, path: (string | number)[]) => {
    if (!getCvSkill(s)) issue(path, `Compétence inconnue du dictionnaire : « ${s} »`);
    else if (forbidden.has(s) && path[0] !== "rules") issue(path, `« ${cvSkillLabel(s)} » est dans les compétences interdites`);
  };
  const validated = (vs: TextVariant[], path: (string | number)[]) => {
    if (!vs.some((v) => !v.toValidate)) issue(path, "Au moins une phrase doit être validée");
  };
  const ids = new Set<string>();
  const unique = (x: string, path: (string | number)[]) => {
    if (ids.has(x)) issue(path, `Identifiant en double : « ${x} »`);
    ids.add(x);
  };

  m.rules.forbiddenSkills.forEach((s, i) => known(s, ["rules", "forbiddenSkills", i]));
  m.rules.strongWordsAllowedFor.forEach((s, i) => known(s, ["rules", "strongWordsAllowedFor", i]));
  if (m.rules.minProjects > m.rules.maxProjects) issue(["rules", "minProjects"], "minProjects doit être ≤ maxProjects");
  validated(m.headline, ["headline"]);
  m.experiences.forEach((e, ei) => {
    unique(e.id, ["experiences", ei, "id"]);
    if (e.minBullets > e.maxBullets) issue(["experiences", ei, "minBullets"], "minBullets doit être ≤ maxBullets");
    e.bullets.forEach((b, bi) => {
      unique(b.id, ["experiences", ei, "bullets", bi, "id"]);
      validated(b.variants, ["experiences", ei, "bullets", bi, "variants"]);
      b.skills.forEach((s, si) => known(s, ["experiences", ei, "bullets", bi, "skills", si]));
    });
  });
  m.projects.forEach((p, pi) => {
    unique(p.id, ["projects", pi, "id"]);
    validated(p.descriptions, ["projects", pi, "descriptions"]);
    p.ownSkills.forEach((s, si) => known(s, ["projects", pi, "ownSkills", si]));
    p.teamOnlySkills.forEach((s, si) => {
      if (!getCvSkill(s)) issue(["projects", pi, "teamOnlySkills", si], `Compétence inconnue du dictionnaire : « ${s} »`);
    });
  });
  m.skillGroups.forEach((g, gi) => g.items.forEach((it, ii) => known(it.skillId, ["skillGroups", gi, "items", ii, "skillId"])));
  m.education.forEach((e, ei) => validated(e.lines, ["education", ei, "lines"]));
  m.titles.forEach((t, ti) => t.skills.forEach((s, si) => known(s, ["titles", ti, "skills", si])));
  if (!m.titles.some((t) => t.isDefault && !t.toValidate)) issue(["titles"], "Il faut un titre par défaut validé");

  const cm = m as CvMaster;
  m.titles.forEach((t, ti) => {
    const c = courseSkillsIn(cm, t.text, t.skills);
    if (c.length) issue(["titles", ti], `Titre avec une compétence vue seulement en cours : ${c.map(cvSkillLabel).join(", ")}`);
  });
  m.summaries.forEach((s, si) => {
    const c = courseSkillsIn(cm, s.text);
    if (c.length) issue(["summaries", si], `Résumé avec une compétence vue seulement en cours : ${c.map(cvSkillLabel).join(", ")}`);
  });
});
export type CvMaster = z.infer<typeof CvMasterObject>;

/**
 * Choix manuels sur un CV adapté (écran de validation). Jamais de texte libre : seulement des identifiants
 * du CV complet. Un identifiant qui n'existe plus est ignoré.
 */
export const CvOverridesSchema = z.object({
  /** Lignes ou projets remis à la main. */
  add: z.array(id).max(60).default([]),
  /** Lignes ou projets retirés à la main. */
  remove: z.array(id).max(60).default([]),
  /** Variante choisie, par ligne / projet / « headline ». */
  variants: z.record(z.string().max(60), id).default({}),
  titleId: id.nullable().default(null),
  /** Ordre voulu, par expérience (id) ou « projects ». */
  order: z.record(z.string().max(60), z.array(id).max(30)).default({}),
});
export type CvOverrides = z.infer<typeof CvOverridesSchema>;
export const EMPTY_OVERRIDES: CvOverrides = { add: [], remove: [], variants: {}, titleId: null, order: {} };

/** Phrases proposées mais pas encore validées (jamais utilisées dans un CV). */
export function countToValidate(m: CvMaster): number {
  const vs = [
    ...m.headline,
    ...m.titles,
    ...m.summaries,
    ...m.experiences.flatMap((e) => e.bullets.flatMap((b) => b.variants)),
    ...m.projects.flatMap((p) => p.descriptions),
    ...m.education.flatMap((e) => e.lines),
  ];
  return vs.filter((v) => v.toValidate).length;
}

/**
 * Valide une phrase. Référence : « titre » / « résumé » par leur id, sinon « propriétaire:variante »
 * (ex. « f-fraude:v2 », « doc-chez-vous:d1 », « headline:h1 », « mastere:l1 »). false si introuvable.
 */
export function validateVariant(m: CvMaster, ref: string): boolean {
  const [owner, vid] = ref.includes(":") ? ref.split(":", 2) : [ref, undefined];
  const hit = (v: { id: string; toValidate: boolean }) => (v.toValidate = false, true);
  if (!vid) {
    const t = m.titles.find((x) => x.id === owner) ?? m.summaries.find((x) => x.id === owner);
    return t ? hit(t) : false;
  }
  const lists: TextVariant[][] = [
    ...(owner === "headline" ? [m.headline] : []),
    ...m.experiences.flatMap((e) => e.bullets.filter((b) => b.id === owner).map((b) => b.variants)),
    ...m.projects.filter((p) => p.id === owner).map((p) => p.descriptions),
    ...m.education.filter((e) => e.id === owner).map((e) => e.lines),
  ];
  const v = lists.flat().find((x) => x.id === vid);
  return v ? hit(v) : false;
}
