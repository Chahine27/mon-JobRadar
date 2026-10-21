import { SKILLS, SKILLS_BY_ID, type Skill } from "./dictionary";

/**
 * Mémoire des derniers textes traités : le score relit la même description des dizaines de fois (une par règle) ;
 * la normaliser à chaque fois prenait ~60 % du calcul du flux (5 s à froid pour 1 800 offres).
 * ponytail: vidée d'un coup à 2 000 entrées (pas de LRU) : un flux entier y tient, au-delà on repart de zéro.
 */
function memo(fn: (s: string) => string): (s: string) => string {
  const cache = new Map<string, string>();
  return (s) => {
    let v = cache.get(s);
    if (v === undefined) {
      v = fn(s);
      if (cache.size >= 2000) cache.clear();
      cache.set(s, v);
    }
    return v;
  };
}

const stripAccents = memo((text) => text.normalize("NFD").replace(/\p{Diacritic}/gu, ""));

/** Minuscules + sans accents + apostrophes unifiées. */
export const normalizeText = memo((text) => stripAccents(text).toLowerCase().replace(/[’`]/g, "'"));

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

/** Écriture + son premier mot, qui doit figurer tel quel dans le texte pour qu'elle puisse y être (test très rapide). */
type Alias = { re: RegExp; needle: string };
type Matcher = { skill: Skill; regexes: Alias[]; csRegexes: Alias[] };

const alias = (a: string, caseSensitive: boolean): Alias => ({ re: aliasRegex(a, caseSensitive), needle: a.split(/[\s/]+/).find(Boolean) ?? a });
/** Pré-filtre : la plupart des ~95 compétences sont absentes d'une offre, leur expression régulière n'est même pas lancée. */
const hit = (text: string, a: Alias) => text.includes(a.needle) && a.re.test(text);

function buildMatchers(skills: Skill[]): Matcher[] {
  return skills.map((skill) => ({
    skill,
    regexes: skill.aliases.map((a) => alias(normalizeText(a), false)),
    csRegexes: (skill.caseSensitiveAliases ?? []).map((a) => alias(stripAccents(a), true)),
  }));
}

const DEFAULT_MATCHERS = buildMatchers(SKILLS);

/**
 * Mémoire des résultats pour les petits textes : le score extrait des dizaines de bouts par offre (« Angular ou React »…),
 * souvent les mêmes d'une offre à l'autre ; tout relire prenait ~45 % du calcul à froid. Les descriptions entières ne
 * reviennent pas (score déjà en cache) : pas gardées, le serveur a peu de mémoire.
 * ponytail: vidée d'un coup à 20 000 entrées, comme le cache des scores.
 */
const SHORT_TEXT = 300;
const extractCache = new Map<string, string[]>();
const matchersCache = new Map<string, Matcher[]>();

/** Renvoie les identifiants des compétences trouvées dans le texte, sans doublon, dans l'ordre du dictionnaire. */
export function extractSkills(text: string, extraSkills: Skill[] = []): string[] {
  const extraKey = extraSkills.map((s) => `${s.id}=${s.aliases.join("|")}`).join(";");
  const key = `${extraKey}\u0000${text}`;
  const cached = extractCache.get(key);
  if (cached) return [...cached];
  if (extractCache.size >= 20_000) extractCache.clear();
  let extra = matchersCache.get(extraKey);
  if (!extra) {
    extra = buildMatchers(extraSkills);
    if (matchersCache.size >= 100) matchersCache.clear();
    matchersCache.set(extraKey, extra);
  }
  const ids = extractUncached(text, extra);
  if (text.length <= SHORT_TEXT) extractCache.set(key, ids);
  return [...ids];
}

function extractUncached(text: string, extra: Matcher[]): string[] {
  const lower = normalizeText(text);
  const original = stripAccents(text);
  const matchers = extra.length ? [...DEFAULT_MATCHERS, ...extra] : DEFAULT_MATCHERS;
  const found: Matcher[] = [];
  for (const m of matchers) {
    if (found.some((f) => f.skill.id === m.skill.id)) continue;
    if (m.regexes.some((a) => hit(lower, a)) || m.csRegexes.some((a) => hit(original, a))) {
      found.push(m);
    }
  }
  // « React Native » n'est pas React, « React Query » non plus : une compétence trouvée seulement à l'intérieur de
  // l'écriture plus longue d'une autre (« react » + « native ») est retirée.
  return found
    .filter((m) => {
      const longer = found
        .filter((o) => o !== m)
        .flatMap((o) => o.skill.aliases.map(normalizeText))
        .filter((b) => m.skill.aliases.some((a) => b.startsWith(`${normalizeText(a)} `)));
      if (!longer.length) return true;
      const rest = longer.reduce((t, b) => t.replace(new RegExp(aliasRegex(b, false).source, "giu"), " "), lower);
      return m.regexes.some((a) => hit(rest, a));
    })
    .map((m) => m.skill.id);
}

/**
 * Même compétence écrite autrement (par l'IA surtout) → nom du profil. Seulement pour resolveSkill :
 * rien de plus n'est détecté dans le texte des annonces.
 */
const SYNONYMS = new Map(
  Object.entries({
    fullstack: "Développement Fullstack",
    "full stack": "Développement Fullstack",
    "full-stack": "Développement Fullstack",
    "développeur fullstack": "Développement Fullstack",
    "architecture technique": "Architecture logicielle",
    "architecture applicative": "Architecture logicielle",
    "tests automatisés": "Tests unitaires",
    "test automatisé": "Tests unitaires",
    "tests automatiques": "Tests unitaires",
    // Libellés de l'IA : même compétence que le dictionnaire.
    "bases de données": "sql",
    "base de données": "sql",
    bdd: "sql",
    "bases relationnelles": "sql",
    api: "api rest",
    apis: "api rest",
    rest: "api rest",
    webservices: "api rest",
    "web services": "api rest",
    js: "javascript",
    next: "next.js",
    net: ".net",
    lambda: "aws",
    s3: "aws",
    sqs: "aws",
    sns: "aws",
    rds: "aws",
    cloudwatch: "aws",
    "api gateway": "aws",
    supabase: "postgresql",
  }).map(([k, v]) => [normalizeText(k), normalizeText(v)]),
);

/**
 * Retrouve une compétence à partir d'un nom saisi dans le profil (« Spring Boot », « vue », « C# »).
 * Nom inconnu → compétence personnalisée (famille inconnue), pour que tout ajout du profil soit détectable.
 */
export function resolveSkill(name: string): Skill {
  const raw = normalizeText(name.trim());
  const n = SYNONYMS.get(raw) ?? raw;
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
