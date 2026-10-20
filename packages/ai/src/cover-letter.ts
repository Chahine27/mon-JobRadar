import type { LetterBlock, LetterKit } from "@job-radar/shared";
import { extractSkills, getSkill } from "@job-radar/skills";
import type { AnalysisJobInput } from "./job-analysis";
import type { AiClient } from "./cloud";
import type { ChatTurn } from "./ollama";

/** Changer ce numéro quand la consigne change : les lettres existantes seront signalées « à refaire ». */
export const LETTER_PROMPT_VERSION = "2026-10-20.2";

/** Une lettre : l'objet (écrit par le code) et les paragraphes du corps (écrits par l'IA). */
export type LetterBody = { objet: string; paragraphes: string[] };

const MAX_JOB = 4_000;
const MAX_CV = 5_000;
const MAX_RULES = 6_000;

// ───── Options : candidature spontanée, Job Radar ─────

export type LetterOptions = {
  spontaneous?: boolean;
  /** L'analyse IA de l'offre parle de développer avec des agents IA : Job Radar (projet perso) peut être cité. */
  aiCoding?: boolean;
};

const JOB_RADAR = /job\s?radar/i;
/** Compétences « développer avec l'IA » du dictionnaire. */
const AI_CODING = new Set(["agents-ia", "multi-agents", "llm-api"]);

/** L'analyse IA de l'offre (compétences exigées, bonus, missions) parle-t-elle de développer avec des agents IA ? */
export function analysisWantsAiCoding(result: unknown): boolean {
  const r = (result ?? {}) as Record<string, unknown>;
  const text = ["competences_obligatoires", "competences_bonus", "missions"]
    .flatMap((k) => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((x): x is string => typeof x === "string") : []))
    .join("\n");
  return extractSkills(text).some((id) => AI_CODING.has(id));
}

const JOB_RADAR_BLOCK: LetterBlock = {
  title: "Job Radar, projet perso fait avec des agents IA",
  useFor: "développement avec des agents IA, Claude Code, IA générative",
  text:
    "J'ai construit Job Radar, une application perso qui récupère les offres d'emploi et m'aide à postuler. " +
    "Elle est en TypeScript avec Vue 3 et PostgreSQL et son code est public sur GitHub. " +
    "Je l'ai développée avec Claude Code en fixant chaque objectif et en vérifiant chaque fonctionnalité.",
};

/** Entreprise visée par une candidature spontanée (La Bonne Boîte). */
export type SpontaneousCompany = {
  name: string;
  sector: string | null;
  city: string | null;
  department: string | null;
  headcountMin: number | null;
  headcountMax: number | null;
};

/**
 * Une candidature spontanée n'a pas d'annonce : on décrit seulement ce qu'on sait de l'entreprise
 * (nom, secteur, ville, taille), pour que l'IA n'invente ni produit, ni client, ni projet.
 */
export function spontaneousJobInput(c: SpontaneousCompany, title: string): AnalysisJobInput {
  const size =
    c.headcountMin != null && c.headcountMax != null
      ? `${c.headcountMin} à ${c.headcountMax} salariés`
      : c.headcountMin != null
        ? `au moins ${c.headcountMin} salariés`
        : "non indiqué";
  return {
    title,
    company: c.name,
    city: c.city,
    department: c.department,
    contractType: "CDI",
    remoteType: "unknown",
    salaryMin: null,
    salaryMax: null,
    description: [
      "CANDIDATURE SPONTANÉE : l'entreprise n'a publié AUCUNE offre.",
      `Entreprise : ${c.name}`,
      `Secteur d'activité : ${c.sector ?? "non indiqué"}`,
      `Ville : ${c.city ?? "non indiquée"}`,
      `Taille : ${size}`,
      `Poste proposé par le candidat : ${title} (CDI).`,
      "Ce sont les SEULES informations connues sur l'entreprise.",
    ].join("\n"),
  };
}

// ───── Étape 1 : choisir l'angle et les blocs ─────

export type LetterPlan = { angle: string; blocs: number[]; accroche: string };

const PLAN_SYSTEM = `Tu prépares une lettre de motivation pour un développeur junior qui sort d'alternance. Tu ne l'écris pas encore. Tu réponds UNIQUEMENT avec le JSON demandé.
- angle : une phrase qui dit ce que l'employeur cherche le plus et ce que le candidat a de plus proche.
- blocs : les numéros des 2 ou 3 blocs qui le prouvent le mieux, du plus fort au moins fort. Un bloc ne sert que si sa ligne « Sert pour » ou son texte répond vraiment à l'annonce. Ne prends pas un bloc juste pour remplir.
- accroche : un fait concret de l'annonce (produit, clients, secteur, projet) à citer dans l'ouverture. Vide si l'annonce n'en donne aucun. Candidature spontanée : vide.`;
const PLAN_SCHEMA = {
  type: "object",
  properties: { angle: { type: "string" }, blocs: { type: "array", items: { type: "integer" } }, accroche: { type: "string" } },
  required: ["angle", "blocs", "accroche"],
} as const;

/** Les blocs du candidat (+ Job Radar si autorisé). Sans bloc, le CV sert de seule source. */
export function letterBlocks(kit: Pick<LetterKit, "blocks" | "cvText">, opts: LetterOptions = {}): LetterBlock[] {
  const own = (kit.blocks ?? []).filter((b) => b.text.trim());
  const blocks = own.length ? own : [{ title: "CV", text: kit.cvText.slice(0, MAX_CV), useFor: "" }];
  return opts.aiCoding ? [...blocks, JOB_RADAR_BLOCK] : blocks;
}

function jobSection(job: AnalysisJobInput): string {
  const place = [job.city, job.department ? `(${job.department})` : null].filter(Boolean).join(" ") || "non indiqué";
  return `ANNONCE
Titre : ${job.title}
Entreprise : ${job.company ?? "non indiquée"}
Lieu : ${place}
Contrat : ${job.contractType ?? "non indiqué"}
"""
${job.description.slice(0, MAX_JOB)}
"""`;
}

export function buildPlanPrompt(job: AnalysisJobInput, blocks: LetterBlock[]): string {
  const list = blocks.map((b, i) => `${i + 1}. ${b.title}\nSert pour : ${b.useFor || "non précisé"}\n${b.text}`).join("\n\n");
  return `BLOCS DU CANDIDAT\n${list}\n\n${jobSection(job)}`;
}

/** Plan validé : 1 à 3 blocs existants ; à défaut, les blocs dont les technos recoupent l'annonce. */
export function cleanPlan(raw: unknown, blocks: LetterBlock[], job: AnalysisJobInput): LetterPlan {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 400) : "");
  let ids = (Array.isArray(r.blocs) ? r.blocs : [])
    .map((n) => Number(n) - 1)
    .filter((i, k, a) => Number.isInteger(i) && i >= 0 && i < blocks.length && a.indexOf(i) === k)
    .slice(0, 3);
  if (!ids.length) {
    const wanted = new Set(extractSkills(`${job.title}\n${job.description}`));
    const score = (b: LetterBlock) => extractSkills(`${b.useFor}\n${b.text}`).filter((id) => wanted.has(id)).length;
    ids = blocks
      .map((b, i) => ({ i, s: score(b) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, Math.min(3, blocks.length))
      .map((x) => x.i);
  }
  return { angle: str(r.angle), blocs: ids.map((i) => i + 1), accroche: str(r.accroche) };
}

// ───── Étape 2 : écrire ─────

const WRITE_SYSTEM = `Tu écris le corps d'une lettre de motivation en français, à la première personne, pour un développeur junior qui sort d'alternance. Tu réponds UNIQUEMENT avec le JSON demandé : toute la lettre dans « lettre », les paragraphes séparés par une ligne vide.

VÉRITÉ
- Utilise seulement les faits des BLOCS CHOISIS et des RÈGLES D'HONNÊTETÉ. N'invente rien : aucun chiffre, aucune technologie, rien sur l'entreprise qui ne soit pas dans l'annonce.
- Jamais « je maîtrise », « expert » ni « parfaitement », sauf pour les technos maîtrisées listées.
- Ne parle pas de ce qui lui manque, sauf une techno écrite dans l'intitulé du poste, en une phrase.
- Nomme l'entreprise d'alternance quand tu parles de son expérience.

FORME
- 3 ou 4 paragraphes, 220 à 300 mots. Pas de « Madame, Monsieur », pas de formule de politesse, pas de signature.
- Ouverture : l'angle, relié à l'accroche. Pas de phrase de présentation toute faite du genre diplôme plus années d'expérience.
- Ensuite les blocs choisis, dans l'ordre donné. Reprends-les au plus près de leur texte et garde leur simplicité. Relie-les par une courte transition.
- Fin : une seule phrase qui propose un échange, avec le nom de l'entreprise s'il est connu.

PONCTUATION (vérifiée par le code)
- Seulement des virgules et des points. Aucun deux-points, point-virgule, tiret, parenthèse, guillemet, point d'exclamation, point d'interrogation ni points de suspension.
- Une virgule au plus par phrase. Pour une énumération, écris « A et B ».

STYLE
- Phrases simples, comme on parle à un recruteur. Varie leur longueur.
- Ce qu'il a fait se dit à la première personne, jamais au passif. Pas trois phrases de suite qui commencent par « J'ai ».
- Pas de formules creuses ni de qualités sans preuve.`;
const WRITE_SCHEMA = { type: "object", properties: { lettre: { type: "string" } }, required: ["lettre"] } as const;

const SPONTANEOUS_RULES = `CANDIDATURE SPONTANÉE
- Il n'y a PAS d'offre : n'écris jamais « votre offre » ni « votre annonce ».
- N'invente RIEN sur l'entreprise : seuls le nom, le secteur, la ville et la taille sont connus.
- Ouvre sur ce que le candidat apporte à une entreprise de ce secteur.
`;

export function buildWritePrompt(job: AnalysisJobInput, kit: LetterKit, plan: LetterPlan, blocks: LetterBlock[], opts: LetterOptions = {}): string {
  const chosen = plan.blocs.map((n) => blocks[n - 1]).filter((b): b is LetterBlock => !!b);
  const rules = kit.rules?.trim() ? `RÈGLES D'HONNÊTETÉ (vraies, à respecter)\n"""\n${kit.rules.trim().slice(0, MAX_RULES)}\n"""\n` : "";
  const mastered = masteredSkills(kit).size ? `TECHNOS MAÎTRISÉES (les seules où « maîtrise » est permis) : ${kit.mastered}\n` : "";
  const banned = `MOTS INTERDITS (refusés par la relecture) : ${[...FORBIDDEN, ...ownBanned(kit)].map(([, name]) => name).join(", ")}\n`;
  return `${opts.spontaneous ? SPONTANEOUS_RULES : ""}ANGLE : ${plan.angle || "ce qui, dans les blocs, répond le mieux à l'annonce"}
ACCROCHE : ${plan.accroche || "aucune"}

BLOCS CHOISIS
${chosen.map((b) => `[${b.title}]\n${b.text}`).join("\n\n")}

${rules}${mastered}${banned}
${jobSection(job)}`;
}

// ───── Mise en forme ─────

const OPENING = /^(madame|monsieur|bonjour)\b[^.]{0,40},?$/i;
const SIGN_OFF = /je vous prie d.agr|veuillez agr|salutations distingu|^(bien |tr[eè]s )?cordialement[.,!]?$|^bien à vous[.,!]?$/i;

export const cleanTitle = (title: string) =>
  title
    .replace(/\s*[(\[]?\b[HF]\s*\/\s*[HF]\b[)\]]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/** Le texte de l'IA en paragraphes, sans « Madame, Monsieur », politesse, signature ni numéros. */
export function toParagraphs(text: string, signature: string): string[] {
  const sig = signature.trim().toLowerCase();
  const blocks = /\n\s*\n/.test(text) ? text.split(/\n\s*\n/) : text.split(/\n/);
  return blocks
    .map((p) =>
      p
        .replace(/^\s*\d+[.)]\s+/, "")
        .split("\n")
        .filter((line) => !sig || line.trim().toLowerCase() !== sig)
        .join(" ")
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !SIGN_OFF.test(s.trim()))
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter((p) => p && !OPENING.test(p));
}

export function formatLetterDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/** Lettre complète, prête à copier : en-tête, lieu et date, objet, corps, politesse, signature. */
export function assembleLetter(kit: Pick<LetterKit, "header" | "city" | "signature">, draft: LetterBody, date: Date): string {
  const parts: string[] = [];
  // En-tête recopié d'une ancienne lettre : on retire son « Objet » et sa date, ajoutés plus bas pour CETTE offre.
  const header = kit.header
    .split("\n")
    .filter((l) => !/^\s*objet\s*:/i.test(l) && !/^\s*(à .+, )?le \d{1,2}[/.]\d{1,2}[/.]\d{2,4}\s*$/i.test(l))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (header) parts.push(header);
  const d = formatLetterDate(date);
  parts.push(kit.city.trim() ? `À ${kit.city.trim()}, le ${d}` : `Le ${d}`);
  parts.push(`Objet : ${draft.objet}`);
  parts.push("Madame, Monsieur,");
  parts.push(...toParagraphs(draft.paragraphes.join("\n\n"), kit.signature));
  parts.push("Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.");
  if (kit.signature.trim()) parts.push(kit.signature.trim());
  return parts.join("\n\n");
}

/** Fautes de frappe fréquentes dans les titres d'annonces, corrigées dans la lettre. */
const TYPOS: Array<[RegExp, string]> = [
  [/\bVu\.js\b/g, "Vue.js"],
  [/\bVue\.JS\b/g, "Vue.js"],
  [/\bRect\.js\b/g, "React.js"],
  [/\bNode\.JS\b/g, "Node.js"],
  [/\bJava\s?script\b/g, "JavaScript"],
  [/\bType\s?script\b/g, "TypeScript"],
];
export function fixTypos(text: string): string {
  return TYPOS.reduce((t, [re, good]) => t.replace(re, good), text);
}

// ───── Ponctuation : seulement des virgules et des points ─────

/**
 * Ponctuation qui trahit un texte généré : deux-points, point-virgule, tirets, parenthèses, guillemets, « ! », « ? »,
 * points de suspension, « / » ou « + » entre deux mots. Collés dans un nom de techno (CI/CD, C#, C++), ils restent.
 */
const BAD_PUNCT = /[:;!?…()[\]«»"“”—–]|\.{3}|\s[-/+&]\s/;
export const badPunctuation = (sentence: string) => BAD_PUNCT.test(sentence);
export const tooManyCommas = (sentence: string) => (sentence.match(/,(?!\d)/g)?.length ?? 0) > 1;

const capitalizeAfterDot = (t: string) => t.replace(/([.]\s+)(\p{Ll})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** Dernier recours : remplace la ponctuation interdite qui a résisté à la réécriture. */
export function fixPunctuation(text: string): string {
  return capitalizeAfterDot(
    text
      .replace(/\s*(\.{3}|…)/g, ".")
      .replace(/\s*[;:!?]\s*/g, ". ")
      .replace(/\s[—–-]\s/g, ". ")
      .replace(/[—–]/g, " ")
      .replace(/\s[/+&]\s/g, " et ")
      .replace(/[«»"“”()[\]]/g, "")
      // Espace avant un point ou une virgule de fin (pas « .NET »).
      .replace(/\s+([.,])(?=\s|$)/g, "$1")
      .replace(/\.(\s*\.)+/g, ".")
      .replace(/ {2,}/g, " ")
      .trim(),
  );
}

// ───── Relecture : vérité et style ─────

// Bornes de mots compatibles avec les accents (\b ne connaît pas « é »).
const word = (src: string) => new RegExp(`(?<![\\p{L}])(?:${src})(?![\\p{L}])`, "iu");
const FORBIDDEN: Array<[RegExp, string]> = [
  [word("passionn[ée]e?s?"), "« passionné »"],
  [word("dynamiques?"), "« dynamique »"],
  [word("challenges?"), "« challenge »"],
  [word("valeur ajout[ée]e"), "« valeur ajoutée »"],
  [word("opportunit[ée]s?"), "« opportunité »"],
  [word("je me permets"), "« je me permets »"],
  [word("n['’]h[ée]sitez pas"), "« n'hésitez pas »"],
  [word("je suis pr[êe]te? à"), "« je suis prêt à »"],
  [word("v[ée]ritables?"), "« véritable »"],
  [word("parfaite ad[ée]quation"), "« parfaite adéquation »"],
  [word("comme en t[ée]moigne"), "« comme en témoigne » (faux lien de cause)"],
  [word("ce qui m['’]a permis"), "« ce qui m'a permis » (faux lien de cause)"],
  [word("m['’]ont expos[ée]|m['’]a expos[ée]"), "« m'ont exposé » (dis ce que tu as pratiqué)"],
  [word("bases? solides?"), "« bases solides » (cliché)"],
  [word("je vise"), "« je vise » (dis simplement que tu candidates)"],
  [word("correspond(?:ent)? à mon parcours"), "« correspond à mon parcours » (dis ce qui est transférable)"],
  [word("je serais int[ée]ress[ée]e?"), "« je serais intéressé » (trop faible)"],
  [word("mettre à profit"), "« mettre à profit » (cliché)"],
  [word("au sein de votre structure"), "« au sein de votre structure » (cliché)"],
  [word("environnement stimulant"), "« environnement stimulant » (cliché)"],
  [word("je suis convaincu"), "« je suis convaincu » (cliché)"],
  [word("applications? m[ée]tiers? complexes?"), "« applications métier complexes » (trop vague : cite l'application)"],
  [word("ce qui me permet(?:tra)?"), "« ce qui me permet » (faux lien de cause)"],
  [word("d[ée]marche structur[ée]e"), "« démarche structurée » (qualité sans preuve)"],
  [word("syst[èe]mes complexes"), "« systèmes complexes » (trop vague : cite le logiciel)"],
  [word("joue(?:nt)? un r[ôo]le (?:cl[ée]|essentiel|central|majeur)"), "« joue un rôle clé » (importance annoncée sans preuve)"],
  [word("ce qui souligne|ce qui t[ée]moigne"), "« ce qui souligne / témoigne » (importance annoncée sans preuve)"],
  [word("plus qu['’]un (?:simple )?(?:poste|emploi|m[ée]tier)"), "« plus qu'un poste, c'est… » (formule toute faite)"],
  [word("ma capacit[ée] (?:à|de)"), "« ma capacité à » (importance annoncée sans preuve : dis ce que tu as fait)"],
  [word("(?:confirme|d[ée]montre|prouve)(?:nt)? (?:ma|mon|mes|la|l['’]|que)"), "« confirme / démontre ma… » (dis le fait, sans le commenter)"],
  [word("ce qui me (?:donne|familiarise|rend|place)"), "« ce qui me donne / familiarise » (faux lien de cause)"],
  [word("m['’](?:a|ont) permis de"), "« m'a permis de » (faux lien de cause : décris ce qu'il a fait)"],
  [word("rigoureux,? curieux"), "« rigoureux, curieux… » (qualités sans preuve)"],
];
/** Mots utiles une fois, mais qui sonnent « robot » quand ils reviennent. */
const ONCE = ["particulièrement", "notamment", "également", "aussi"];

/** Mots interdits choisis par le candidat (virgules, points-virgules ou un par ligne). */
function ownBanned(kit: Pick<LetterKit, "bannedWords">): Array<[RegExp, string]> {
  return (kit.bannedWords ?? "")
    .split(/[,;\n]+/)
    .map((w) => w.trim().replace(/^[«"“]\s*|\s*[»"”]$/g, ""))
    .filter((w) => w.length >= 2)
    .map((w) => [word(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]")), `« ${w} » (dans tes mots interdits)`]);
}

/** Technos que le candidat dit maîtriser (champ « mastered »). */
export function masteredSkills(kit: Pick<LetterKit, "mastered">): Set<string> {
  return new Set(extractSkills(kit.mastered ?? ""));
}

/**
 * Projets et entreprises du CV, avec les technologies écrites pour chacun :
 * « - CodeNShare — … React, Node JS » (projet) et « … · LUSIS » suivi de ses lignes « - … » (entreprise).
 */
export function cvEntities(cvText: string): Array<{ name: string; kind: "projet" | "entreprise"; skills: Set<string> }> {
  const out: Array<{ name: string; kind: "projet" | "entreprise"; skills: Set<string> }> = [];
  let employer: { name: string; kind: "entreprise"; skills: Set<string> } | null = null;
  for (const raw of cvText.split(/\n/)) {
    const line = raw.trim();
    const emp = line.match(/·\s*([\p{Lu}][\p{L}0-9&'’ .-]{1,40})$/u);
    if (emp && /\d{4}/.test(line)) {
      const name = emp[1]!.trim();
      employer = out.find((e) => e.kind === "entreprise" && e.name.toLowerCase() === name.toLowerCase()) as typeof employer;
      if (!employer) out.push((employer = { name, kind: "entreprise", skills: new Set() }));
      continue;
    }
    const proj = line.match(/^[-•]\s*([^—–:]{2,40}?)\s+[—–]\s+/);
    if (proj) {
      employer = null;
      out.push({ name: proj[1]!.trim(), kind: "projet", skills: new Set(extractSkills(line)) });
      continue;
    }
    if (employer && /^[-•]/.test(line)) for (const id of extractSkills(line)) employer.skills.add(id);
    else if (!line.startsWith("-")) employer = null;
  }
  return out;
}
const MASTERY = word("je ma[îi]trise|ma ma[îi]trise|ma[îi]triser|ma[îi]trise (?:de|du|des|d['’])|expert(?:e|ise)?|parfaitement");
const KNOWS = /(approfondi|consolid|renforc|ma connaissance d|connaissances? (en|de|sur)|exp[ée]rience (avec|en|sur|de)|j['’]ai (utilis|pratiqu|travaill|d[ée]velopp|con[çc]u)|ma[îi]tris)/i;

const normWords = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Passage d'au moins 6 mots recopié de l'annonce (hors intitulé du poste). */
export function copiedFromJob(body: string, jobText: string, jobTitle = ""): string[] {
  const job = normWords(jobText);
  const title = normWords(jobTitle).join(" ");
  const grams = new Set<string>();
  for (let i = 0; i + 6 <= job.length; i++) grams.add(job.slice(i, i + 6).join(" "));
  const found: string[] = [];
  for (const s of body.split(/(?<=[.!?])\s+|\n+/)) {
    const w = normWords(s);
    for (let i = 0; i + 6 <= w.length; i++) {
      const g = w.slice(i, i + 6).join(" ");
      if (grams.has(g) && !(title && title.includes(g))) {
        found.push(s.trim().slice(0, 90));
        break;
      }
    }
  }
  return found;
}

/** Erreur de vérité (faux, inventé, mal attribué) : plus grave qu'une question de style. */
const isFactIssue = (i: string) => /n'est pas (écrit pour|dans le CV|dans l'annonce)|maîtrise|Nomme l'entreprise|chiffre|manques|Job Radar/.test(i);

const NEED = /(?:besoins?|attentes?|exigences?|recherchez|cherchez|d[ée]crivez|mentionnez)\s+(?:de |d['’]|en |en mati[èe]re de )?([^.;:\n]{3,70})/gi;
const FILLER_WORDS = new Set(["vous", "votre", "vos", "nous", "notre", "quipe", "projet", "projets", "produit", "produits", "entreprise", "poste", "mission", "missions", "avec", "pour", "dans", "cette", "leurs"]);
const stem = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().slice(0, 5);

/**
 * « … répond au besoin de sécurisation que vous décrivez » : si aucun mot de ce besoin n'est dans l'annonce, la lettre
 * invente ce que l'entreprise cherche.
 */
export function inventedNeeds(body: string, jobText: string): string[] {
  const job = new Set(jobText.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map(stem));
  const out: string[] = [];
  for (const m of body.matchAll(NEED)) {
    const words = m[1]!.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 6 && !FILLER_WORDS.has(w.toLowerCase()));
    if (words.length && !words.some((w) => job.has(stem(w)))) out.push(m[1]!.trim().slice(0, 60));
  }
  return out;
}

/** Tout ce qui est vrai sur le candidat : CV, blocs, règles d'honnêteté. */
const truthText = (kit: Pick<LetterKit, "cvText" | "blocks" | "rules">) =>
  [kit.cvText, ...(kit.blocks ?? []).map((b) => b.text), kit.rules ?? ""].join("\n");

/** Technos que le candidat a vraiment pratiquées (CV, blocs, et agents IA si Job Radar est autorisé). */
function knownSkills(kit: Pick<LetterKit, "cvText" | "blocks" | "rules">, opts: LetterOptions): Set<string> {
  const ids = new Set(extractSkills(`${kit.cvText}\n${(kit.blocks ?? []).map((b) => b.text).join("\n")}`));
  if (opts.aiCoding) for (const id of AI_CODING) ids.add(id);
  return ids;
}

/**
 * Problèmes précis d'une lettre, rédigés comme des consignes de correction pour l'IA. Vide = rien à corriger.
 * `body` = objet + paragraphes ; la ponctuation n'est vérifiée que dans les paragraphes (lignes après la première).
 */
export function findLetterIssues(body: string, kit: LetterKit, jobText: string, opts: LetterOptions = {}): string[] {
  const issues: string[] = [];
  const inCv = knownSkills(kit, opts);
  const inJob = new Set(extractSkills(jobText));
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const label = (id: string) => getSkill(id)?.label ?? id;

  for (const [re, name] of [...FORBIDDEN, ...ownBanned(kit)]) if (re.test(body)) issues.push(`Supprime ${name}.`);
  const mastered = masteredSkills(kit);
  for (const s of sentences) {
    // « maîtrise » accepté seulement si ce qui suit le mot (jusqu'à la virgule ou « en m'appuyant ») ne parle que de technos maîtrisées.
    const m = MASTERY.exec(s);
    const after = m ? s.slice(m.index + m[0].length).split(/[,;.:]|\s(?:en m['’]appuyant|grâce|gr[aâ]ce à|avec|et j['’]ai|car)\s/i)[0] ?? "" : "";
    const claimed = extractSkills(after);
    const masteryOk = mastered.size > 0 && claimed.length > 0 && claimed.every((id) => mastered.has(id));
    if (MASTERY.test(s) && !masteryOk) issues.push(`Pas de « maîtrise » ni « expert » (candidat junior) : « ${s.slice(0, 90)}… » → « j'ai utilisé / j'ai développé ».`);
    const absent = extractSkills(s).filter((id) => !inCv.has(id));
    // « je souhaite approfondir X en m'appuyant sur Y » : la seule façon permise de parler d'un manque.
    if (absent.length && KNOWS.test(s) && !/pas encore|jamais (?:utilis|travaill|pratiqu)|n['’]ai pas|approfondir [^.]{2,80} en m['’]appuyant sur/i.test(s)) {
      issues.push(`${absent.map(label).join(", ")} n'est pas dans le CV : ne prétends pas le connaître (« ${s.slice(0, 90)}… »).`);
    }
    const words = s.split(/\s+/).length;
    if (words > 38) issues.push(`Phrase trop longue (${words} mots) à couper : « ${s.slice(0, 70)}… ».`);
  }
  // Ponctuation et virgules : seulement dans le corps (l'objet est écrit par le code).
  const bodySentences = body.split("\n").slice(1).join("\n").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const punct = bodySentences.filter(badPunctuation);
  if (punct.length) issues.push(`Ponctuation : seulement des virgules et des points, pas de deux-points, point-virgule, tiret, parenthèse ni guillemet (« ${punct[0]!.slice(0, 80)}… »).`);
  const commas = bodySentences.filter(tooManyCommas);
  if (commas.length) issues.push(`Trop de virgules : une au plus par phrase, coupe ou écris « A et B » (« ${commas[0]!.slice(0, 80)}… »).`);
  for (const m of body.matchAll(/(?:apprendre|découvrir|me former (?:à|sur))\s+(?:le |la |l'|les )?([^.,;\n]{2,60})/gi)) {
    for (const id of extractSkills(m[1]!)) if (inCv.has(id)) issues.push(`${label(id)} est dans le CV : ne dis pas vouloir l'apprendre, dis qu'il l'a pratiqué.`);
  }
  // Débuts de phrase répétitifs (« J'ai … J'ai … J'ai … »).
  let run = 0;
  for (const s of sentences) {
    run = /^j['’]ai\b/i.test(s) ? run + 1 : 0;
    if (run === 3) {
      issues.push("Trois phrases de suite commencent par « J'ai » : varie les débuts (« Chez LUSIS, … », « Sur ce projet, … »), sans passer au passif.");
      break;
    }
  }
  // Même technologie citée plus de deux fois.
  const counts = new Map<string, number>();
  for (const s of sentences) for (const id of extractSkills(s)) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) if (n > 2 && !inJob.has(id)) issues.push(`${label(id)} est cité ${n} fois : une ou deux suffisent.`);
  // Technologie du CV attribuée au mauvais projet / à la mauvaise entreprise (ex. « microservices … projet parking »).
  const entities = cvEntities(kit.cvText);
  // Découpage en propositions (« …PostgreSQL et j'ai utilisé SQL sur Doc Chez Vous » = deux faits distincts).
  const clauses = sentences.flatMap((x) => x.split(/;|\s(?:et|puis|mais)\s+(?=j['’]|je\s|nous\s)/i));
  for (const s of clauses) {
    const named = entities.filter((e) => s.toLowerCase().includes(e.name.toLowerCase()));
    if (!named.length) continue;
    const wrong = extractSkills(s).filter((id) => inCv.has(id) && !named.some((e) => e.skills.has(id)));
    // Une techno écrite dans un bloc à côté du nom du projet est vraie, même si le CV ne la range pas sous ce projet.
    const inBlock = (id: string) => (kit.blocks ?? []).some((b) => named.some((e) => b.text.toLowerCase().includes(e.name.toLowerCase())) && extractSkills(b.text).includes(id));
    const reallyWrong = wrong.filter((id) => !inBlock(id));
    if (reallyWrong.length) {
      issues.push(`${reallyWrong.map(label).join(", ")} n'est pas écrit pour ${named.map((e) => e.name).join(" / ")} dans le CV : ne l'y associe pas (« ${s.slice(0, 90)}… »).`);
    }
  }
  if (opts.spontaneous && /votre (offre|annonce)|l['’](offre|annonce)|le poste que vous (proposez|recherchez)/i.test(body)) {
    issues.push("Candidature spontanée : il n'y a pas d'offre, n'écris pas « votre offre » ; parle de l'envie de rejoindre l'entreprise.");
  }
  // Manques : on n'en parle que pour une techno de l'intitulé du poste.
  const title = jobText.split("\n")[0] ?? "";
  const inTitle = new Set(extractSkills(title));
  const gapsCited = [...new Set(extractSkills(body))].filter((id) => !inCv.has(id) && inJob.has(id) && !inTitle.has(id));
  if (gapsCited.length) issues.push(`Ne liste pas tes manques (${gapsCited.map(label).join(", ")}) : n'en parle pas, ce n'est pas dans l'intitulé du poste.`);
  if (!opts.aiCoding && JOB_RADAR.test(body)) issues.push("Supprime Job Radar : l'analyse de l'offre ne parle pas de développement avec des agents IA.");
  // Chiffres inventés (on ignore les versions « Vue 3 », « .NET 8 », « OAuth2 » et les dates).
  const sources = `${truthText(kit)}\n${jobText}\n${kit.header}${opts.aiCoding ? `\n${JOB_RADAR_BLOCK.text}` : ""}`;
  const numbersText = body.replace(/\p{Lu}[\p{L}.#+]*\s?\d+(?:\.\d+)*/gu, " ").replace(/[\p{L}]\d+/gu, " ").replace(/\d+(?:[/.]\d+)+/g, " ");
  for (const n of new Set(numbersText.match(/\d+/g) ?? [])) {
    if (!new RegExp(`(^|\\D)${n}(\\D|$)`).test(sources)) issues.push(`Le chiffre « ${n} » n'est ni dans le CV ni dans l'annonce : supprime-le.`);
  }
  for (const need of inventedNeeds(body, jobText).slice(0, 2)) {
    issues.push(`« ${need} » n'est pas dans l'annonce : ne prête pas à l'entreprise un besoin qu'elle n'a pas écrit.`);
  }
  // Phrases recopiées de l'annonce (en spontané, la « annonce » n'est que la fiche entreprise).
  if (!opts.spontaneous) for (const s of copiedFromJob(body.split("\n").slice(1).join("\n"), jobText.split("\n").slice(1).join("\n"), title).slice(0, 2)) {
    issues.push(`Phrase recopiée de l'annonce : dis-le avec tes mots (« ${s}… »).`);
  }
  // L'entreprise d'alternance doit être nommée.
  const employers = entities.filter((e) => e.kind === "entreprise");
  if (employers.length && !employers.some((e) => body.toLowerCase().includes(e.name.toLowerCase()))) {
    issues.push(`Nomme l'entreprise d'alternance (${employers.map((e) => e.name).join(", ")}) : « une expérience en alternance » seule ne dit rien.`);
  }
  for (const w of ONCE) {
    const n = body.match(new RegExp(word(w).source, "giu"))?.length ?? 0;
    if (n > 1) issues.push(`Supprime un « ${w} » : ${n} fois, une seule suffit.`);
  }
  const connectors = body.match(/\b(De plus|Parall[èe]lement|En outre|Par ailleurs)\b/g) ?? [];
  if (connectors.length > 1) issues.push("Trop de connecteurs (« De plus », « Parallèlement »…) : un seul maximum.");
  // Les erreurs de vérité d'abord (la liste est coupée à 10).
  return [...new Set(issues)].sort((x, y) => Number(isFactIssue(y)) - Number(isFactIssue(x))).slice(0, 10);
}

/**
 * Relecture affichée à côté d'une lettre (y compris retouchée à la main) : ce qui mérite un coup d'œil avant d'envoyer.
 */
export function checkLetter(letter: string, kit: LetterKit, jobText: string, jobTitle = "", opts: LetterOptions = {}): string[] {
  const warnings: string[] = [];
  const inCv = knownSkills(kit, opts);
  // Le titre du poste recopié (objet, 1re phrase) n'est pas une affirmation de maîtrise.
  const title = cleanTitle(jobTitle);
  const claims = title ? letter.split(title).join(" ") : letter;
  for (const id of extractSkills(claims)) {
    if (inCv.has(id)) continue;
    warnings.push(`« ${getSkill(id)?.label ?? id} » n'est pas dans ton CV : vérifie que la lettre ne dit pas que tu le maîtrises.`);
  }
  // « je souhaite apprendre Python » alors que Python est dans le CV : la lettre se sous-vend.
  for (const m of letter.matchAll(/(?:apprendre|découvrir|me former (?:à|sur)|monter en compétences? (?:sur|en))\s+(?!m['’]appuy)(?:le |la |l'|les )?([^.,;\n]{2,60})/gi)) {
    for (const id of extractSkills(m[1]!)) {
      if (!inCv.has(id)) continue;
      warnings.push(`La lettre dit que tu veux apprendre « ${getSkill(id)?.label ?? id} », alors que c'est dans ton CV : dis plutôt que tu l'as déjà pratiqué.`);
    }
  }
  if (/\bVu\.js\b/.test(letter)) warnings.push("« Vu.js » : faute de frappe (Vue.js).");
  // Le corps seul (sans en-tête, date, objet, politesse) pour la ponctuation et les autres règles.
  const blocks = letter.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const start = blocks.findIndex((b) => /^(Madame|Monsieur)/i.test(b.trim()));
  const end = blocks.findIndex((b) => /^Je vous prie d['’]agréer/i.test(b.trim()));
  const objet = blocks.find((b) => /^\s*Objet\s*:/i.test(b)) ?? "Objet";
  const body = `${objet}\n${blocks.slice(start < 0 ? 0 : start + 1, end < 0 ? blocks.length : end).join("\n")}`;
  for (const issue of findLetterIssues(body, kit, jobText, opts)) {
    if (/^(Supprime|Pas de « maîtrise »|Phrase trop longue|Ne liste pas tes manques|Le chiffre|Phrase recopiée|Candidature spontanée|Ponctuation|Trop de virgules)/.test(issue)) warnings.push(issue);
  }
  return [...new Set(warnings)];
}

// ───── Corrections ─────

const REWRITE_SYSTEM = `Tu corriges UNE phrase d'une lettre de motivation en français. Tu réponds UNIQUEMENT avec le JSON demandé.
- Réécris seulement la PHRASE pour retirer le défaut indiqué, en gardant son sens et ses faits. Tu peux la couper en deux phrases.
- N'ajoute aucun fait, aucune technologie, aucun chiffre. Première personne pour ce que le candidat a fait (pas de passif).
- Seulement des virgules et des points, une virgule au plus par phrase.
- Elle doit s'enchaîner naturellement avec la phrase d'avant et celle d'après (ne commence pas par un pronom qui ne renvoie à rien).
- Si la phrase n'apporte aucun fait, renvoie une phrase vide.`;
const REWRITE_SCHEMA = { type: "object", properties: { phrase: { type: "string" } }, required: ["phrase"] } as const;
const MAX_REWRITES = 6;

const splitSentences = (p: string) => p.split(/(?<=[.!?])\s+/).filter(Boolean);

/** Défaut d'une phrase que la réécriture ciblée sait corriger (null = phrase correcte). */
function sentenceDefect(s: string, banned: Array<[RegExp, string]>): { reason: string; bannedWord: boolean } | null {
  const hit = banned.find(([re]) => re.test(s));
  if (hit) return { reason: hit[1], bannedWord: true };
  if (badPunctuation(s)) return { reason: "ponctuation interdite : seulement des virgules et des points", bannedWord: false };
  if (tooManyCommas(s)) return { reason: "trop de virgules : une au plus par phrase", bannedWord: false };
  return null;
}

/**
 * Une phrase qui contient un mot interdit, une ponctuation interdite ou trop de virgules est réécrite seule (avec ses
 * voisines pour le contexte) au lieu d'être supprimée. Une réécriture qui ajoute une techno ou un chiffre est refusée.
 * Ce qui résiste : mot interdit → phrase retirée ; ponctuation → remplacée par le code.
 */
export async function rewriteFlaggedSentences(client: Pick<AiClient, "chatJson">, draft: LetterBody, kit: Pick<LetterKit, "bannedWords">): Promise<LetterBody> {
  const banned = [...FORBIDDEN, ...ownBanned(kit)];
  const all = draft.paragraphes.flatMap(splitSentences);
  let budget = MAX_REWRITES;
  const numbers = (t: string): string[] => t.match(/\d+/g) ?? [];
  const paragraphes: string[] = [];
  for (const p of draft.paragraphes) {
    const out: string[] = [];
    for (const s of splitSentences(p)) {
      const defect = sentenceDefect(s, banned);
      if (!defect || budget <= 0) {
        if (!(defect?.bannedWord)) out.push(s);
        continue;
      }
      budget--;
      const i = all.indexOf(s);
      const user = `PHRASE D'AVANT : ${all[i - 1] ?? "(début)"}\nPHRASE : ${s}\nPHRASE D'APRÈS : ${all[i + 1] ?? "(fin)"}\nDÉFAUT : ${defect.reason}`;
      const raw = (await client.chatJson(REWRITE_SYSTEM, user, REWRITE_SCHEMA, { temperature: 0.3 }).catch(() => null)) as { phrase?: unknown } | null;
      const fixed = typeof raw?.phrase === "string" ? raw.phrase.trim() : "";
      const before = new Set(extractSkills(s));
      const safe =
        fixed &&
        !sentenceDefect(fixed, banned) &&
        !splitSentences(fixed).some((x) => sentenceDefect(x, banned)) &&
        extractSkills(fixed).every((id) => before.has(id)) &&
        numbers(fixed).every((n) => numbers(s).includes(n));
      if (safe) out.push(fixed);
      // Réponse vide = phrase sans fait : retirée. Réécriture douteuse : on garde l'original, sauf mot interdit.
      else if ((typeof raw?.phrase !== "string" || fixed) && !defect.bannedWord) out.push(s);
    }
    if (out.length) paragraphes.push(out.join(" "));
  }
  // Une lettre vidée par les retraits garde sa version d'origine (rare : la relecture la signalera).
  const kept = paragraphes.length >= 2 ? paragraphes : draft.paragraphes;
  return { ...draft, paragraphes: kept.map(fixPunctuation) };
}

// ───── Écriture complète ─────

/** Mémoire de travail pour la lettre : consignes, blocs, règles et annonce tiennent largement. */
const LETTER_CONTEXT = 16_384;
/** Durée maximale de recherche de la meilleure lettre ; on s'arrête avant si une lettre n'a plus aucun défaut. */
const LETTER_BUDGET_MS = 150_000;
const MIN_WORDS = 180;
const MAX_WORDS = 320;
const MAX_DRAFTS = 3;
const MAX_FIXES = 2;

type Candidate = { draft: LetterBody; raw: string; issues: string[] };
/** Note d'une lettre (plus bas = mieux) : une erreur de vérité pèse trois fois un défaut de style. */
const penalty = (c: Candidate) => c.issues.reduce((n, i) => n + (isFactIssue(i) ? 3 : 1), 0);

/** Correction en conversation : la même demande (cache), la lettre telle que l'IA l'a écrite, puis les problèmes. */
function fixTurns(prompt: string, raw: string, issues: string[]): ChatTurn[] {
  return [
    { role: "user", content: prompt },
    { role: "assistant", content: JSON.stringify({ lettre: raw }) },
    {
      role: "user",
      content: `PROBLÈMES À CORRIGER (réécris toute la lettre en les corrigeant, sans en créer d'autres) :
${issues.map((i) => `- ${i}`).join("\n")}

Garde les faits vrais et la simplicité des blocs. Seulement des virgules et des points, une virgule au plus par phrase. Une vraie personne dirait-elle chaque phrase à voix haute à un recruteur ? Sinon, simplifie-la.`,
    },
  ];
}

export async function writeCoverLetter(
  client: Pick<AiClient, "chatJson" | "model" | "paid">,
  job: AnalysisJobInput,
  kit: LetterKit,
  now: Date = new Date(),
  opts: LetterOptions = {},
): Promise<{ content: string; model: string; durationMs: number }> {
  const started = Date.now();
  const jobText = `${job.title}\n${job.description}`;
  const objet = opts.spontaneous ? `Candidature spontanée – ${cleanTitle(job.title)}` : `Candidature au poste de ${cleanTitle(job.title)}`;
  const blocks = letterBlocks(kit, opts);

  // Étape 1 : l'angle et les blocs (inutile avec un seul bloc, par exemple le CV seul).
  const rawPlan = blocks.length > 1 ? await client.chatJson(PLAN_SYSTEM, buildPlanPrompt(job, blocks), PLAN_SCHEMA, { temperature: 0.3, contextTokens: LETTER_CONTEXT }) : null;
  const plan = cleanPlan(rawPlan, blocks, job);
  const prompt = buildWritePrompt(job, kit, plan, blocks, opts);
  let lastError = "";

  /** Une version de la lettre, découpée et relue (null = réponse hors format ou trop courte). */
  const generate = async (user: string | ChatTurn[], temperature: number): Promise<Candidate | null> => {
    const out = (await client.chatJson(WRITE_SYSTEM, user, WRITE_SCHEMA, { temperature, contextTokens: LETTER_CONTEXT, cache: true })) as { lettre?: unknown } | null;
    const raw = typeof out?.lettre === "string" ? out.lettre.trim() : "";
    const paragraphes = toParagraphs(raw, kit.signature);
    if (paragraphes.length < 2) {
      lastError = raw ? "lettre trop courte" : "champ « lettre » absent";
      return null;
    }
    const draft = { objet, paragraphes };
    const issues = findLetterIssues(`${objet}\n${paragraphes.join("\n")}`, kit, jobText, opts);
    const words = paragraphes.join(" ").split(/\s+/).length;
    if (words < MIN_WORDS) issues.push(`Lettre trop courte (${words} mots) : écris ${MIN_WORDS} à ${MAX_WORDS} mots en développant les blocs.`);
    if (words > MAX_WORDS + 40) issues.push(`Lettre trop longue (${words} mots) : ${MIN_WORDS} à ${MAX_WORDS} mots.`);
    return { draft, raw, issues };
  };

  // Plusieurs brouillons ; chacun est corrigé tant qu'il s'améliore ; on garde la meilleure lettre.
  // IA payante (Claude) : une version et une correction au plus.
  const [maxDrafts, maxFixes] = client.paid ? [1, 1] : [MAX_DRAFTS, MAX_FIXES];
  let best: Candidate | null = null;
  for (let d = 0; d < maxDrafts && Date.now() - started < LETTER_BUDGET_MS && best?.issues.length !== 0; d++) {
    let first: Candidate | null;
    try {
      first = await generate(prompt, d === 0 ? 0.6 : 0.85);
    } catch (e) {
      if (!best) throw e; // IA injoignable dès le début : on le dit ; sinon on garde ce qu'on a
      break;
    }
    if (!first) continue;
    let cur: Candidate = first;
    for (let f = 0; f < maxFixes && cur.issues.length && Date.now() - started < LETTER_BUDGET_MS; f++) {
      const fixed: Candidate | null = await generate(fixTurns(prompt, cur.raw, cur.issues), 0.4).catch(() => null);
      if (!fixed || penalty(fixed) >= penalty(cur)) break; // plus d'amélioration : on s'arrête
      cur = fixed;
    }
    if (!best || penalty(cur) < penalty(best)) best = cur;
  }
  if (!best) throw new Error(`Réponse de l'IA hors format : ${lastError}`);

  const draft = await rewriteFlaggedSentences(client, best.draft, kit);
  return { content: fixTypos(assembleLetter(kit, draft, now)), model: client.model, durationMs: Date.now() - started };
}
