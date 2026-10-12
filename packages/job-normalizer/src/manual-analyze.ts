import { contractFromText, contractFromTitle, detectRemote, parseExperienceYears, salaryFromText } from "@job-radar/scoring";
import type { RemoteType } from "@job-radar/shared";
import { departmentFromText, departmentName } from "@job-radar/shared";
import { extractSkills, getSkill, normalizeText } from "@job-radar/skills";
import { comparable } from "./text";

/**
 * Lecture d'une annonce collée telle quelle (LinkedIn, Indeed, site carrières…), SANS IA :
 * uniquement des règles simples. Ce qui n'est pas trouvé avec assez de certitude reste null
 * (l'écran demande alors de le compléter) — jamais inventé.
 */
export type JobTextAnalysis = {
  /** Texte nettoyé (liens LinkedIn « [texte](https://…) » → « texte », en-têtes de page retirés). */
  text: string;
  title: string | null;
  company: string | null;
  location: string | null;
  contractType: "CDI" | "CDD" | "INTERIM" | "ALTERNANCE" | "STAGE" | "FREELANCE" | null;
  remoteType: RemoteType;
  salaryMin: number | null;
  salaryMax: number | null;
  experienceYears: number | null;
  skills: string[];
};

/** Lignes d'interface copiées avec l'annonce, sans valeur (LinkedIn, Indeed, WTTJ). */
const UI_LINES = [
  /^a propos de l'offre d'emploi$/,
  /^a propos de l'emploi$/,
  /^description (du poste|de l'offre)$/,
  /^(postuler|candidature simplifiee|enregistrer|sauvegarder|partager|signaler cette offre)$/,
  /^voir (plus|moins)$/,
  /^\.\.\. ?(plus|voir plus)$/,
  /^super recruteur$/,
  /^a noter sur ce job$/,
  /^vous avez ces competences ?\?/,
  /^coche ou decoche cette competence/,
  /^analyser mon cv/,
  /^(voir l'offre|voir l’offre)$/,
  /^postuler maintenant$/,
  /^postuler a ce poste$/,
  /^nouveau$/,
  /^cette offre vous tente/,
  /^questions et reponses sur l'offre$/,
  /^le teletravail est-il possible pour ce poste/,
  /^quel est le type de contrat pour ce poste/,
  /^il y a \d+ (minutes?|heures?|jours?|semaines?|mois)$/,
  /^(resume du poste|competences & expertises|details du poste)$/,
  /^[•·|*-]$/,
];

/** Début du bas de page (formulaire de candidature, offres similaires…) : tout ce qui suit est retiré. */
const FOOTER =
  /^(envoyez votre candidature|d'autres offres vous correspondent|envie d'en savoir plus|ces offres pourraient aussi|recherches similaires|offres similaires|voir plus d'offres|offres d'emploi similaires|stats pour cet emploi|postes similaires|recevez des offres d'emploi similaires|recherches populaires)/;

export function cleanPastedText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍﻿]/g, "")
    // « Titre H/F[Entreprise](https://…) » (HelloWork) : le lien collé au texte passe à la ligne.
    .replace(/([^\s[\n])\[([^\]\n]+)\]\((https?:\/\/[^)\s]*)\)/g, (_m, before: string, label: string) => `${before}\n${label.trim()}`)
    .replace(/\[([^\]\n]*)\]\((https?:\/\/[^)\s]*)\)/g, (_m, label: string) => label.trim()) // liens Markdown
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trimEnd());
  const bare = (l: string) => normalizeText(l.trim().replace(/^[*•·-]\s*/, ""));
  const cut = lines.findIndex((l, i) => i >= 3 && FOOTER.test(bare(l)));
  return (cut >= 0 ? lines.slice(0, cut) : lines)
    .filter((l) => !UI_LINES.some((re) => re.test(bare(l))))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Bouton « Postuler » en haut de page : tout ce qui est au-dessus (menus, recherche, titre, lieu) est retiré. */
const APPLY_TOP = /^(postuler a ce poste|postuler maintenant|postuler|candidature simplifiee)$/;

/**
 * Annonce complète collée pour compléter une offre déjà connue (Adzuna, Jooble ne donnent qu'un extrait) :
 * même nettoyage que l'ajout à la main, et le haut de page jusqu'au bouton « Postuler » est retiré.
 */
export function cleanFullText(raw: string): string {
  const bare = (l: string) => normalizeText(l.trim().replace(/^[*•·-]\s*/, ""));
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const top = lines.slice(0, 40).findIndex((l) => APPLY_TOP.test(bare(l)));
  const body = top >= 0 ? lines.slice(top + 1) : lines;
  const end = body.findIndex((l, i) => i >= 1 && FOOTER.test(bare(l)));
  return cleanPastedText((end >= 0 ? body.slice(0, end) : body).join("\n"));
}

/** « Paris - 75 · CDI » → ["Paris - 75", "CDI"] (puces HelloWork / Indeed / WTTJ sur une même ligne). */
function segments(line: string): string[] {
  return line
    .replace(/^[*•·]\s*/, "")
    .split(/\s+[·•|]\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const ROLE =
  /\b(developpeu(r|se)|developer|dev|engineer|ingenieur|programmeu(r|se)|full ?stack|front ?end|back ?end|frontend|backend|devops|integrat(eur|rice)|architecte|tech ?lead|data|web|mobile|logiciel|software|stagiaire|stage|alternance|alternant)\b|\b[hf] ?\/ ?[hf]\b/;
const SECTION = /^(qui sommes[- ]nous|notre|nos|votre|vos|pourquoi|ce que|le poste|la mission|les missions|missions|profil|avantages|process|a propos|description|about)\b/;

/** Première ligne courte qui ressemble à un intitulé de poste (souvent la 1ʳᵉ ligne d'un copier-coller). */
function findTitle(lines: string[]): string | null {
  for (const line of lines.slice(0, 8)) {
    const t = normalizeText(line);
    const words = line.split(/\s+/).length;
    if (line.length < 5 || line.length > 120 || words > 14) continue;
    if (/[?:.!]$/.test(line.trim()) || /^[-*•·]/.test(line.trim()) || line.includes(":")) continue;
    if (SECTION.test(t)) continue;
    if (ROLE.test(t)) return line.trim();
  }
  // Formules explicites dans le texte.
  const text = lines.join("\n");
  const art = "(?:un|une|un\\(e\\)|un·e|un\\.e)";
  const roleWord =
    "(?:[Dd][ée]veloppeu(?:r|se)|[Ii]ng[ée]nieur(?:e)?|[Dd]ev(?:eloper)?\\b|[Aa]rchitecte|[Ii]nt[ée]grat(?:eur|rice)|[Ff]ull ?[Ss]tack|[Tt]ech ?[Ll]ead|[Ll]ead [Dd]ev)";
  const hf = "\\(\\s*[hf]\\s*\\/\\s*[hf]\\s*\\)";
  const m =
    text.match(/(?:intitul[ée] du poste|titre du poste|poste)\s*:\s*([^\n]{5,100})/i) ??
    text.match(new RegExp(`(?:nous recrutons|recrute|recherche|recherchons) ${art}\\s+([^\\n]{3,80}?${hf})`, "i")) ??
    text.match(new RegExp(`nous recrutons ${art}\\s+([^\\n,;]{3,80}?)(?= pour | afin |[,;\\n]|\\. |\\.$|$)`, "i")) ??
    text.match(new RegExp(`en tant que (${roleWord}[^\\n,;(]{0,60}?)(?= et | pour | afin | au sein |[,;(\\n]|\\. |\\.$|$)`)) ??
    text.match(new RegExp(`(?:[Nn]ous recherchons|[Rr]echerchons|[Nn]ous recrutons|recrute|recherche) ${art}\\s+(${roleWord}[^\\n,;(]{0,60}?)(?= pour | afin | qui | et | souhaitant |[,;(\\n]|\\. |\\.$|$)`));
  return m ? m[1]!.trim() : null;
}

const NOT_A_COMPANY = new Set(
  ["nous", "notre", "nos", "vous", "votre", "la", "le", "les", "un", "une", "cette", "ce", "france", "paris", "linkedin", "indeed", "l'equipe", "equipe"].map(comparable),
);

/** Entreprise : le nom le plus cité dans les tournures « chez X », « X est une … », « rejoindre X », « X recrute ». */
function findCompany(text: string, lines: string[], title: string | null): string | null {
  const name = "([A-ZÀ-Ý0-9][\\p{L}0-9&'’.-]*(?: [A-ZÀ-Ý0-9][\\p{L}0-9&'’.-]*){0,2})";
  const patterns = [
    new RegExp(`\\b[Cc]hez ${name}`, "gu"),
    new RegExp(`\\b[Rr]ejoindre ${name}`, "gu"),
    new RegExp(`(?:^|\\n|\\. )${name},? (?:est|c'est|c’est) (?:une?|le|la|l['’])`, "gu"),
    new RegExp(`(?:^|\\n|\\. )${name} recrute\\b`, "gu"),
    new RegExp(`(?:entreprise|société|societe|client)\\s*:\\s*${name}`, "gu"),
  ];
  const count = new Map<string, number>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const c = m[1]!.replace(/[.,;:!?’']+$/, "").trim();
      if (!c || NOT_A_COMPANY.has(comparable(c)) || c.length > 60) continue;
      count.set(c, (count.get(c) ?? 0) + 1);
    }
  }
  // Copier-coller depuis le haut d'une page LinkedIn : le nom de l'entreprise est la ligne juste avant le titre.
  const i = title ? lines.indexOf(title) : -1;
  const before = i > 0 ? lines[i - 1]! : null;
  if (before && before.split(/\s+/).length <= 5 && !ROLE.test(normalizeText(before)) && !/[:.?!]/.test(before)) {
    count.set(before, (count.get(before) ?? 0) + 2);
  }
  // HelloWork : le nom de l'entreprise est la ligne juste APRÈS le titre.
  const after = i >= 0 ? lines[i + 1] : undefined;
  if (after && after.split(/\s+/).length <= 5 && /^[A-ZÀ-Ý0-9]/.test(after) && !ROLE.test(normalizeText(after)) && !/[:.?!]/.test(after)) {
    count.set(after, (count.get(after) ?? 0) + 2);
  }
  // « PROTECTLINE » (en-tête) et « Protectline » (texte) = même entreprise : on garde l'écriture la plus lisible.
  const groups = new Map<string, { total: number; forms: Map<string, number> }>();
  for (const [name, n] of count) {
    const key = comparable(name);
    const g = groups.get(key) ?? { total: 0, forms: new Map<string, number>() };
    g.total += n;
    g.forms.set(name, (g.forms.get(name) ?? 0) + n);
    groups.set(key, g);
  }
  const best = [...groups.values()].sort((a, b) => b.total - a.total)[0];
  if (!best) return null;
  const forms = [...best.forms.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  return forms.find((f) => f !== f.toUpperCase() || f.length <= 4) ?? forms[0]!;
}

/** Lieu : « Localisation : … », « basé(e)s à … », « situés à … (Paris 8e) », ligne LinkedIn « Ville, Région, France · … ». */
function findLocation(lines: string[], text: string): string | null {
  const candidates: string[] = [];
  for (const seg of lines.slice(0, 20).flatMap(segments)) {
    const hw = seg.match(/^([A-ZÀ-Ý][\p{L}' -]*?) - (\d{2}|2A|2B|97\d)$/u);
    if (hw) candidates.push(`${hw[1]} (${hw[2]})`);
    // Indeed : « Paris (75) », « Boulogne-Billancourt (92) », « Télétravail partiel à Nanterre (92) »
    const indeed = seg.match(/^(?:.*\bà\s+)?([A-ZÀ-Ý][\p{L}'’ -]*?) \((\d{2}|2A|2B|97\d)\)$/u);
    if (indeed) candidates.push(`${indeed[1]} (${indeed[2]})`);
  }
  // « 93160 Noisy-le-Grand » (Indeed, adresses)
  const CITY = "([A-ZÀ-Ý][\\p{L}'’]*(?:-[\\p{L}'’]+)*(?: (?:[Ss]ur|[Ee]n|[Ll]es?|[Ll]a|[Dd]e|[Dd]u) [A-ZÀ-Ý][\\p{L}'’-]*| [A-ZÀ-Ý][\\p{L}'’-]*)*)";
  for (const m of text.matchAll(new RegExp(`\\b(\\d{5})\\s+${CITY}`, "gu"))) {
    const dep = departmentFromText(m[1]!);
    if (dep && dep !== "99") candidates.push(`${m[2]} (${dep})`);
  }
  // Welcome to the Jungle : la ville est la ligne sous le contrat (« CDI » / « Levallois-Perret »).
  for (let i = 0; i < Math.min(lines.length - 1, 15); i++) {
    if (/^(cdi|cdd|stage|alternance|interim|freelance)$/.test(normalizeText(lines[i]!.replace(/^[*•·]\s*/, "")))) {
      const next = lines[i + 1]!;
      if (next.split(/\s+/).length <= 4 && !/\d/.test(next)) candidates.push(next);
    }
  }
  for (const line of lines.slice(0, 10)) {
    const m = line.match(/^([^·•|]{3,80}?),\s*[^·•|]*(?:France|Île-de-France|Ile-de-France)[^·•|]*\s*[·•|]/);
    if (m) candidates.push(m[1]!);
  }
  const re =
    /(?:localisation|lieu(?: de travail)?|adresse|ville)\s*:\s*([^\n]{3,80})|\b(?:bas[ée]e?s?|situ[ée]e?s?|localis[ée]e?s?|implant[ée]e?s?)\s+(?:a|à|au|sur)\s+([^\n.;]{3,80})|\b(?:bureaux?|mission|poste bas[ée]) (?:a|à|au|sur)\s+([^\n.;]{3,80})/giu;
  for (const m of text.matchAll(re)) candidates.push((m[1] ?? m[2] ?? m[3])!);

  for (const c of candidates) {
    const t = comparable(c);
    const dep = departmentFromText(c);
    if (!dep || dep === "99") continue;
    if (/\bparis\b/.test(t)) return "Paris (75)";
    const city = c.split(/[,(]/)[0]!.replace(/^(la|le|les)\s+/i, "").trim();
    const depName = departmentName(dep);
    if (city && depName && comparable(city) === comparable(depName)) return `${depName} (${dep})`;
    return city ? `${city} (${dep})` : depName ? `${depName} (${dep})` : null;
  }
  return null;
}

function findContract(title: string | null, text: string): JobTextAnalysis["contractType"] {
  return contractFromTitle(title ?? "") ?? contractFromText(text);
}

export function analyzeJobText(raw: string): JobTextAnalysis {
  const text = cleanPastedText(raw);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = findTitle(lines);
  const salary = salaryFromText(text);
  const exp = parseExperienceYears(text);
  return {
    text,
    title,
    company: findCompany(text, lines, title),
    location: findLocation(lines, text),
    contractType: findContract(title, text),
    remoteType: detectRemote(text),
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    experienceYears: exp?.min ?? null,
    skills: extractSkills(`${title ?? ""}\n${text}`).map((id) => getSkill(id)?.label ?? id),
  };
}
