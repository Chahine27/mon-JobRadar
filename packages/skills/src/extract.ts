import { SKILLS, SKILLS_BY_ID, type Skill } from "./dictionary";

/** Minuscules + sans accents + apostrophes unifiées. */
export function normalizeText(text: string): string {
  return stripAccents(text).toLowerCase().replace(/[’`]/g, "'");
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Une écriture doit être un mot entier : « java » ne doit pas matcher « javascript »,
 * « sql » ne doit pas matcher « postgresql », « .net » ne doit pas matcher « internet ».
 */
function aliasRegex(alias: string, caseSensitive: boolean): RegExp {
  const body = escapeRegExp(alias)
    .replace(/\\? /g, "[\\s-]+")
    // « CI / CD », « Java / J2EE » : espaces autour de la barre acceptés.
    .replace(/\\\//g, "\\s*\\/\\s*");
  return new RegExp(`(?<![\\p{L}\\p{N}+#.])${body}(?![\\p{L}\\p{N}+#])`, caseSensitive ? "u" : "iu");
}

type Matcher = { skill: Skill; regexes: RegExp[]; csRegexes: RegExp[] };

function buildMatchers(skills: Skill[]): Matcher[] {
  return skills.map((skill) => ({
    skill,
    regexes: skill.aliases.map((a) => aliasRegex(normalizeText(a), false)),
    csRegexes: (skill.caseSensitiveAliases ?? []).map((a) => aliasRegex(stripAccents(a), true)),
  }));
}

const DEFAULT_MATCHERS = buildMatchers(SKILLS);

/** Renvoie les identifiants des compétences trouvées dans le texte, sans doublon, dans l'ordre du dictionnaire. */
export function extractSkills(text: string, extraSkills: Skill[] = []): string[] {
  const lower = normalizeText(text);
  const original = stripAccents(text);
  const matchers = extraSkills.length ? [...DEFAULT_MATCHERS, ...buildMatchers(extraSkills)] : DEFAULT_MATCHERS;
  const found: string[] = [];
  for (const m of matchers) {
    if (found.includes(m.skill.id)) continue;
    if (m.regexes.some((r) => r.test(lower)) || m.csRegexes.some((r) => r.test(original))) {
      found.push(m.skill.id);
    }
  }
  return found;
}

/**
 * Retrouve une compétence à partir d'un nom saisi dans le profil (« Spring Boot », « vue », « C# »).
 * Nom inconnu → compétence personnalisée (famille inconnue), pour que tout ajout du profil soit détectable.
 */
export function resolveSkill(name: string): Skill {
  const n = normalizeText(name.trim());
  for (const s of SKILLS) {
    if (normalizeText(s.label) === n || s.id === n || s.aliases.some((a) => normalizeText(a) === n)) return s;
    if (s.caseSensitiveAliases?.some((a) => normalizeText(a) === n)) return s;
  }
  return {
    id: `custom:${n}`,
    label: name.trim(),
    family: "other", // famille inconnue : pas de crédit « techno proche »
    core: true,
    aliases: [n],
  };
}

export function getSkill(id: string): Skill | undefined {
  return SKILLS_BY_ID.get(id);
}

function earliest(text: string, regexes: RegExp[]): RegExpExecArray | null {
  let best: RegExpExecArray | null = null;
  for (const r of regexes) {
    const m = r.exec(text);
    if (m && (!best || m.index < best.index)) best = m;
  }
  return best;
}

/** Première écriture de la compétence dans le texte, telle qu'elle est écrite (« VueJS », « Node JS »). null si absente. */
export function findSkillForm(text: string, skill: Skill): string | null {
  const original = stripAccents(text).replace(/[’`]/g, "'");
  const m = earliest(original, [
    ...skill.aliases.map((a) => aliasRegex(normalizeText(a), false)),
    ...(skill.caseSensitiveAliases ?? []).map((a) => aliasRegex(stripAccents(a), true)),
  ]);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

/** Positions de la compétence dans `normalizeText(text)` (pour lire ce qui l'entoure : « 3 ans d'Angular »). */
export function skillIndexes(text: string, skill: Skill): number[] {
  const lower = normalizeText(text);
  const indexes = [skill.label, ...skill.aliases].flatMap((a) =>
    [...lower.matchAll(new RegExp(aliasRegex(normalizeText(a), false).source, "giu"))].map((m) => m.index!),
  );
  return [...new Set(indexes)].sort((a, b) => a - b);
}

/** Compétence citée dans le texte (mot entier), sans tenir compte des majuscules ni des accents, libellé compris. */
export function mentionsSkill(text: string, skill: Skill): boolean {
  const lower = normalizeText(text);
  return [skill.label, ...skill.aliases, ...(skill.caseSensitiveAliases ?? [])].some((a) => aliasRegex(normalizeText(a), false).test(lower));
}
