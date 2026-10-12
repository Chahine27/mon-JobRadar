import { normalizeText } from "@job-radar/skills";

/** Salaire brut annuel en euros. */
export type AnnualSalary = { min: number; max: number };

/** Mois payés par défaut (« sur 13 mois » le remplace). */
const MONTHS = 12;
// ponytail: net → brut avec un taux moyen de cadre (~22 % de charges) ; à affiner si l'écart gêne.
const NET_TO_GROSS = 1 / 0.78;

// Nombre : « 45 000 », « 45.000 », « 60,000 », « 38 000,00 », « 45000 », « 3,5 ».
const NUM = String.raw`\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?`;
const CUR = String.raw`€|eur(?:os?)?\b|\$|£|chf|usd|gbp`;
// Devise avant ou après, « k » des milliers, « M » des millions (chiffre d'affaires, levée : jamais un salaire).
const TOKEN = new RegExp(String.raw`(${CUR})?\s?(${NUM})\s?(k(?![a-z])|m(?:illions?)?\b|mds?\b|milliards?\b)?\s?(${CUR})?`, "g");
const OTHER_CURRENCY = /\$|£|\bchf\b|\busd\b|\bgbp\b|dollars?|livres? sterling/;
/** Ce qui suit un nombre et dit que ce n'est pas un montant (« 20 % », « 3 ans », « 2 jours », « 13 mois »). */
const NOT_AMOUNT =
  /^\s?(%|pourcent|ans?\b|annees?|years?|mois\b|months?|jours?|days?|semaines?|weeks?|h\b|heures?|hours?|personnes|salaries|collaborateurs|employes|people|employees|clients|pays|countries|sites|agences)/;
/** Taux journalier / horaire : pas un salaire annuel, on ne convertit pas. */
const RATE_AFTER = /^\s?(?:brut|net|ht|hors taxes?)?\s?(?:\/|par|per|de l'|a l')\s?(?:jour|j\b|day|heure|h\b|hour)/;
const RATE_LINE = /\btjm\b|taux journalier|taux horaire|daily rate|day rate|hourly|\bpar jour\b|\bper day\b|\bde l'heure\b|\bpar heure\b|\bper hour\b/;
const MONTHLY = /mensuel|par mois|\/\s?mois|\bmonth(ly)?\b|per month|\/\s?m\b/;
const NET = /(?<![.\w])nets?\b|(?<![.\w])nettes?\b/;
const GROSS = /\bbrute?s?\b|\bgross\b/;
const RANGE = /^\s?(?:€|eur(?:os?)?)?\s?(?:-|a|to|et|\/|~|jusqu'a)\s?$/;
/** Ligne qui parle du salaire. */
const SALARY_WORD = /salaire|remuneration|retribution|salary|package|compensation|\bpay\b|fourchette|\bbrut|\bgross\b|\d\s?k\b/;
/** Au-delà de ces mots, la ligne parle d'autre chose (« 45 k€ + prime de 3 000 € », « Tickets restaurant 9 € »). */
const CUT =
  /ticket|restaurant|mutuelle|\bprimes?\b|bonus|variable|interessement|participation|enveloppe|budget|rembourse|indemnite|cheque|swile|chiffre d'affaires|levee|leve |valorisation|capital|bspce|stock|equity|transport|velo|formation|\bcse\b|avantages? en nature/;
/** Estimation d'un site (HelloWork, Glassdoor…), pas le salaire de l'annonce. */
const ESTIMATE = /estimation|estime|salaire moyen|moyenne|median|glassdoor|selon le marche|market average/;

type Token = { value: number; k: boolean; eur: boolean; other: boolean; at: number; end: number };

function parseNumber(raw: string): number {
  if (/^\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?$/.test(raw)) return Number(raw.replace(/[.,]\d{1,2}$/, "").replace(/\D/g, ""));
  return Number(raw.replace(",", "."));
}

/**
 * Salaire écrit en texte libre, converti en brut annuel :
 *   « 35 000 € - 45 000 € par an », « 38k€ - 42k€ », « 45-55 K€ », « €50K to €90K », « Entre 40 et 45 KE »,
 *   « 2 800 € brut mensuel », « 3 000 €/mois sur 13 mois », « 2 500 € x 13 », « 30 000 € net », « à partir de 42k ».
 * Taux journalier / horaire, autre devise seule, ou rien de sûr → null (jamais deviné).
 * `strict` (ligne sans mot « salaire ») : seulement un montant marqué (€ ou k).
 */
export function parseSalaryText(label: string | null | undefined, strict = false): AnnualSalary | null {
  if (!label) return null;
  let text = normalizeText(label).replace(/[   ]/g, " ").replace(/[–—−]/g, "-");
  // « 45 KE », « 45 keuros », « 45 k eur » → « 45 k € ».
  text = text.replace(/(\d)\s?k\s?(?:e(?![a-z])|euros?\b|eur\b)/g, "$1 k €");
  if (ESTIMATE.test(text)) return null;
  const cut = text.search(CUT);
  if (cut === 0) return null;
  if (cut > 0) text = text.slice(0, cut);
  if (RATE_LINE.test(text)) return null;

  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const [, before, num, unit, after] = m;
    const at = m.index! + m[0].indexOf(num!);
    const end = m.index! + m[0].length;
    if (unit && unit !== "k") continue; // millions
    if (!unit && !after && NOT_AMOUNT.test(text.slice(at + num!.length))) continue;
    if (RATE_AFTER.test(text.slice(end))) return null;
    // Nombre collé à des lettres (« bac+5 », « es2015 ») : pas un montant.
    if (!before && /[a-z+]$/.test(text.slice(0, at))) continue;
    const cur = `${before ?? ""}${after ?? ""}`;
    const eur = /€|eur/.test(cur);
    tokens.push({ value: parseNumber(num!), k: unit === "k", eur, other: cur !== "" && !eur, at, end });
  }

  // Montants marqués (€ ou k) : eux seuls, plus le nombre nu de l'autre bout d'une fourchette
  // (« 40 000 - 45 000 € », « 45-55k », « €2,000-3,500/month »).
  // L'euro l'emporte sur une autre devise écrite à côté (« €50K to €90K / CHF70k ») ; une autre devise seule → null.
  const marked = (t: Token | undefined) => !!t && !t.other && (t.eur || t.k);
  const rangeWith = (a: Token | undefined, b: Token | undefined) => !!a && !!b && RANGE.test(text.slice(a.end, b.at));
  let money: Token[];
  if (tokens.some(marked)) {
    money = tokens.filter(
      (t, i) =>
        marked(t) ||
        (!t.other && ((marked(tokens[i + 1]) && rangeWith(t, tokens[i + 1])) || (marked(tokens[i - 1]) && rangeWith(tokens[i - 1], t)))),
    );
  } else if (strict || tokens.some((t) => t.other) || OTHER_CURRENCY.test(text)) return null;
  else money = tokens.filter((t) => t.value >= 1000);
  const anyK = money.some((t) => t.k);
  // « 45-55k » : le premier nombre est aussi en milliers.
  const values = money
    .map((t) => (t.k || (anyK && t.value < 1000) ? t.value * 1000 : t.value))
    .filter((n) => n >= 500)
    .slice(0, 2);
  if (!values.length) return null;

  const monthsMatch = text.match(/(?:\bsur|\bx|×|\*)\s?(1[2-6](?:[.,]5)?)\s?(?:mois|months?)?\b/);
  const months = monthsMatch ? Number(monthsMatch[1]!.replace(",", ".")) : MONTHS;
  const monthly = MONTHLY.test(text) || monthsMatch !== null;
  let annual: number[];
  if (values.every((n) => n >= 15_000)) annual = values;
  else if (values.every((n) => n >= 800 && n < 15_000) && (monthly || values.every((n) => n >= 1_200 && n <= 8_000))) {
    // Mensuel écrit (« par mois », « x 13 »), ou montant de salaire mensuel sur une ligne « Salaire : 2 800 € brut ».
    annual = values.map((n) => n * months);
  } else return null;

  if (NET.test(text) && !GROSS.test(text)) annual = annual.map((n) => n * NET_TO_GROSS);
  const min = Math.round(Math.min(...annual));
  const max = Math.round(Math.max(...annual));
  if (min < 12_000 || max > 400_000 || max > min * 3) return null;
  return { min, max };
}

/**
 * Salaire trouvé dans un texte d'annonce : la première phrase qui en parle et qui se lit sans doute.
 * Coupé en lignes, puces et phrases (« Avantages : tickets restaurant. Salaire : 45k »).
 */
export function salaryFromText(text: string | null | undefined): AnnualSalary | null {
  if (!text) return null;
  const parts = text
    .split(/\r?\n|\s[•·|]\s|(?<=[\p{L})€])\.\s+|;\s+/u)
    .map((p) => p.replace(/^[\s*•·-]+/, "").trim())
    .filter((p) => /\d/.test(p));
  let loose: AnnualSalary | null = null;
  for (const part of parts) {
    const hasWord = SALARY_WORD.test(normalizeText(part));
    const s = parseSalaryText(part, !hasWord);
    if (s && hasWord) return s;
    loose ??= s;
  }
  return loose;
}

/** Salaire d'une offre, la même règle partout (score, pastille) : celui de la source, sinon lu dans l'annonce. */
export function salaryOfJob(job: { salaryMin: number | null; salaryMax: number | null; description: string }) {
  if (job.salaryMin !== null || job.salaryMax !== null) return { salaryMin: job.salaryMin, salaryMax: job.salaryMax };
  const s = salaryFromText(job.description);
  return { salaryMin: s?.min ?? null, salaryMax: s?.max ?? null };
}
