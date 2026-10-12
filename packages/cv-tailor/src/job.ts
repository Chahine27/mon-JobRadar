import type { JobType } from "@job-radar/shared";
import { extractCvSkills, findSkillForm, getCvSkill, normalizeText, resolveCvSkills } from "@job-radar/skills";
import type { JobForCv } from "./types";

export const FRONT = new Set(["vue", "react", "angular", "svelte", "nuxt", "nextjs", "html", "css", "tailwind", "vuetify", "pinia", "redux", "vuex", "vite", "jquery"]);
export const BACK = new Set(["java", "spring", "node", "express", "nestjs", "csharp", "dotnet", "python", "django", "flask", "fastapi", "php", "symfony", "laravel", "go", "ruby", "rust", "sql", "postgresql", "mysql"]);
const MOBILE = new Set(["flutter", "dart", "swift", "react-native", "kotlin", "android"]);

/** Type de poste : d'abord le titre, sinon les compétences de l'annonce. */
export function jobTypeOf(title: string, skills: string[]): JobType {
  const t = title.toLowerCase();
  if (/full[\s-]?stack/.test(t)) return "fullstack";
  if (/mobile|android|\bios\b|flutter/.test(t)) return "mobile";
  if (/front/.test(t)) return "frontend";
  if (/back/.test(t)) return "backend";
  const front = skills.some((s) => FRONT.has(s));
  const back = skills.some((s) => BACK.has(s));
  const mobile = skills.filter((s) => MOBILE.has(s)).length;
  if (mobile >= 2 || (mobile && !front && !back)) return "mobile";
  if (front && back) return "fullstack";
  if (front) return "frontend";
  if (back) return "backend";
  return "other";
}

const uniq = (xs: string[]) => [...new Set(xs)];

/**
 * Offre → ce que lit le choix. `analysis` = compétences de l'analyse IA si elle est à jour (noms libres,
 * ramenés aux identifiants du dictionnaire). Sans analyse : tout ce que le dictionnaire trouve est « exigé ».
 */
export function buildJobForCv(input: {
  title: string;
  description: string;
  abridged: boolean;
  analysis: { required: string[]; bonus: string[] } | null;
  /** Compétences de ton profil Job Radar (noms libres). */
  profileSkills?: string[];
}): JobForCv {
  const text = `${input.title}\n${input.description}`;
  const mentioned = extractCvSkills(text);
  const required = input.analysis ? uniq(input.analysis.required.flatMap(resolveCvSkills)) : mentioned;
  const niceToHave = input.analysis ? uniq(input.analysis.bonus.flatMap(resolveCvSkills)).filter((s) => !required.includes(s)) : [];
  const forms: Record<string, string> = {};
  for (const id of uniq([...mentioned, ...required, ...niceToHave])) {
    const skill = getCvSkill(id);
    const form = skill && findSkillForm(text, skill);
    if (form) forms[id] = form;
  }
  return {
    title: input.title,
    required,
    niceToHave,
    mentioned,
    jobType: jobTypeOf(input.title, uniq([...required, ...mentioned])),
    isAbridged: input.abridged,
    skillsSource: input.analysis ? "ai" : "dictionary",
    forms,
    profileSkills: uniq((input.profileSkills ?? []).flatMap(resolveCvSkills)),
  };
}

/** Intitulé de poste (développeur, engineer, ingénieur…). */
const ROLE = /\b(developpeu(r|se)|developer|dev|engineer|ingenieur(e)?|software)\b/;
/** Jamais repris : niveau au-dessus de junior, encadrement, ou contrat qui n'est pas un emploi. */
const NOT_ME =
  /\b(senior|sr|lead|principal|staff|confirme(e)?s?|confirmed|experimente(e)?|experienced|expert|architecte?|manager|head|chef|responsable|directeu?r|director|cto|founding|stage|stagiaire|intern(ship)?|alternance|alternant(e)?|apprenti(e)?)\b/;

/**
 * Intitulé de l'offre nettoyé (sans H/F, CDI, lieu ni entreprise), pour le reprendre comme titre du CV :
 * les recruteurs cherchent par intitulé. null s'il ne peut pas servir (pas un poste de développeur,
 * niveau au-dessus du tien, trop long). Les compétences citées sont vérifiées par l'appelant.
 */
export function cleanOfferTitle(title: string): string | null {
  let t = title
    .replace(/^\s*(cdi|cdd)\s*[-–—:]\s*/i, "")
    .replace(/\(?\b[hfx]\s*\/\s*[hfx](\s*\/\s*[hfx])?\b\)?/gi, " ")
    .split(/\s[-–—|]\s|[(,:]/)[0]!
    .replace(/\b(cdi|cdd)\b/gi, " ");
  // « Ingénieur logiciel/Ingénieure logiciel » : une seule fois.
  const halves = t.split("/");
  if (halves.length === 2 && halves.every((h) => ROLE.test(normalizeText(h)))) t = halves[0]!;
  t = t.replace(/\s+/g, " ").replace(/[\s\-–—/]+$/, "").trim();
  const n = normalizeText(t);
  if (t.length < 8 || t.length > 60 || !ROLE.test(n) || NOT_ME.test(n)) return null;
  return t;
}
