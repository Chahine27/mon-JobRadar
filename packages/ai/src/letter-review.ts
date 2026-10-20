import { createHash } from "node:crypto";
import { z } from "zod";
import type { AiClient } from "./cloud";
import { copiedFromJob } from "./cover-letter";

/**
 * Relecture d'une lettre déjà écrite, avant envoi : ce qu'un recruteur verrait tout de suite.
 * - sujet : phrase dont le sujet (« Elle », « Cela »…) ne renvoie à rien dans la phrase d'avant ;
 * - fragment : morceau de phrase incomplet, ou bout de l'annonce recopié tel quel ;
 * - repetition : même idée ou même mot redit ;
 * - faute : orthographe, accord, grammaire.
 * Trois relecteurs : le code (bouts de l'annonce), LanguageTool (fautes) et une IA gratuite (le reste).
 */
export type ReviewKind = "sujet" | "fragment" | "repetition" | "faute";
export type ReviewProblem = { kind: ReviewKind; excerpt: string; detail: string };
export type LetterReview = {
  /** empreinte du texte relu : une autre version de la lettre n'est pas couverte par cette relecture */
  hash: string;
  problems: ReviewProblem[];
  /** relecteur injoignable (la relecture est alors incomplète, donc à valider à la main) */
  errors: string[];
  /** tu as lu les problèmes et choisi d'envoyer quand même */
  validated: boolean;
  at: string;
};

export const letterHash = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n").trim()).digest("hex").slice(0, 32);

/** La relecture bloque-t-elle l'envoi de ce texte ? null = non, sinon la raison à afficher. */
export function reviewBlock(review: LetterReview | null | undefined, text: string): string | null {
  if (!review || review.hash !== letterHash(text)) return "La relecture automatique n'a pas encore été faite sur cette version de la lettre : enregistre-la d'abord.";
  if (review.validated || (!review.problems.length && !review.errors.length)) return null;
  return review.problems.length
    ? `La relecture a trouvé ${review.problems.length} problème(s) dans la lettre : corrige-les ou valide-les avant d'envoyer.`
    : "La relecture automatique n'a pas pu se faire en entier : relis la lettre et valide-la avant d'envoyer.";
}

// ───── LanguageTool (orthographe, grammaire) ─────

const LT_URL = "https://api.languagetool.org/v2/check";
type LtMatch = { message: string; offset: number; length: number; rule: { id: string; issueType: string; category: { id: string } } };

/**
 * Fautes vues par LanguageTool (service gratuit, le texte lui est envoyé). Une « faute de frappe » sur un mot avec
 * majuscule ou chiffre (LUSIS, Auth0, REST) ou présent dans le CV / l'annonce est un nom propre : ignorée.
 * Seules l'orthographe et la grammaire comptent (pas la typographie ni le style, trop bavards).
 */
export async function languageToolProblems(text: string, known: string, fetchFn: typeof fetch = fetch): Promise<ReviewProblem[]> {
  const res = await fetchFn(LT_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ text, language: "fr-FR" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`LanguageTool : erreur ${res.status}`);
  const { matches } = (await res.json()) as { matches: LtMatch[] };
  const knownLower = known.toLowerCase();
  const out: ReviewProblem[] = [];
  for (const m of matches) {
    const bad = text.slice(m.offset, m.offset + m.length);
    // « … est ce que je peux vous apporter. » : phrase affirmative, pas de trait d'union (LanguageTool croit à une question).
    if (/^est ce$/i.test(bad) && !sentenceAround(text, m.offset, m.length).includes("?")) continue;
    if (m.rule.issueType === "misspelling") {
      if (/[\p{Lu}\d]/u.test(bad) || knownLower.includes(bad.toLowerCase())) continue;
    } else if (!/GRAMMAIRE|GRAMMAR|AGREEMENT|CONFUSED|TYPOS/i.test(m.rule.category.id)) continue;
    out.push({ kind: "faute", excerpt: sentenceAround(text, m.offset, m.length), detail: `« ${bad} » : ${m.message}` });
  }
  return out;
}

/** La phrase qui contient le passage (pour situer la faute). */
function sentenceAround(text: string, offset: number, length: number): string {
  const start = Math.max(text.lastIndexOf(".", offset - 1), text.lastIndexOf("\n", offset - 1)) + 1;
  const ends = [text.indexOf(".", offset + length), text.indexOf("\n", offset + length)].filter((i) => i >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) + 1 : text.length).trim().slice(0, 160);
}

// ───── IA gratuite (sujets sans référent, fragments, répétitions) ─────

const AiReviewSchema = z.object({
  problemes: z.array(z.object({ type: z.enum(["sujet", "fragment", "repetition", "faute"]), extrait: z.string(), explication: z.string() })),
});
const AI_REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    problemes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["sujet", "fragment", "repetition", "faute"] },
          extrait: { type: "string" },
          explication: { type: "string" },
        },
        required: ["type", "extrait", "explication"],
      },
    },
  },
  required: ["problemes"],
};

const AI_REVIEW_SYSTEM = `Tu relis une lettre de motivation en français, comme un recruteur exigeant qui la lit pour la première fois. Tu ne réécris rien : tu signales seulement les vrais problèmes. Tu réponds UNIQUEMENT avec le JSON demandé.
Types de problèmes :
- sujet : une phrase commence par un pronom ou un sujet (« Elle », « Il », « Cela », « Ce poste », « Cette approche »…) qui ne renvoie à rien de clair dans la phrase juste avant, ou qui renvoie au mauvais mot. Exemple : « Titulaire d'un Mastère obtenu en 2026, je souhaite rejoindre Acme. Elle demande de comprendre le besoin métier » : « Elle » semble désigner Acme ou le Mastère, alors que la phrase parle du poste.
- fragment : phrase incomplète, sans verbe, coupée, ou bout de l'annonce collé tel quel qui ne s'enchaîne pas avec le reste (on sent le copier-coller).
- repetition : la même idée dite deux fois, ou le même mot ou verbe répété de près (« j'ai développé … j'ai développé »).
- faute : orthographe, accord, conjugaison, mot manquant.
Règles :
- extrait : recopie EXACTEMENT le passage fautif de la lettre (quelques mots à une phrase), sans rien changer.
- explication : une phrase courte qui dit ce qui ne va pas et comment le corriger.
- Ne signale pas le style, les choix de contenu, la longueur, les formules de politesse, ni les noms propres et technologies.
- Si la lettre n'a aucun problème, renvoie une liste vide. N'invente pas de problème pour en trouver.`;

export async function aiReviewProblems(client: Pick<AiClient, "chatJson">, text: string): Promise<ReviewProblem[]> {
  const raw = await client.chatJson(AI_REVIEW_SYSTEM, `LETTRE :\n${text}`, AI_REVIEW_JSON_SCHEMA, { temperature: 0 });
  const parsed = AiReviewSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Réponse de l'IA hors format");
  const flat = (s: string) => s.replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  const letter = flat(text);
  // Un extrait qui n'est pas dans la lettre est inventé par l'IA : ignoré. Pour une faute, la casse compte
  // (l'IA recopie « avec » en minuscule puis signale une majuscule manquante qui n'existe pas).
  const inLetter = (p: { type: string; extrait: string }) =>
    p.type === "faute" ? letter.includes(flat(p.extrait)) : letter.toLowerCase().includes(flat(p.extrait).toLowerCase());
  return parsed.data.problemes
    .filter((p) => p.extrait.trim() && inLetter(p))
    .map((p) => ({ kind: p.type, excerpt: p.extrait.trim(), detail: p.explication.trim() }));
}

// ───── Relecture complète ─────

export type ReviewDeps = { ai?: Pick<AiClient, "chatJson"> | null; fetch?: typeof fetch };

/**
 * Relit la lettre avec les trois relecteurs. Un relecteur en panne n'empêche pas les autres : son absence est notée
 * dans `errors` (la lettre devra alors être validée à la main).
 */
export async function reviewLetter(
  text: string,
  ctx: { cvText: string; jobText: string; jobTitle?: string; spontaneous?: boolean },
  deps: ReviewDeps,
): Promise<LetterReview> {
  const errors: string[] = [];
  const body = letterBody(text);
  // L'objet (« Candidature au poste de » + intitulé) est écrit par le code : ce n'est pas un passage recopié.
  const fromCode: ReviewProblem[] = ctx.spontaneous
    ? []
    : copiedFromJob(body.replace(/^Objet\s*:.*$/im, ""), ctx.jobText, ctx.jobTitle ?? "").map((s) => ({ kind: "fragment" as const, excerpt: s, detail: "Passage recopié de l'annonce : dis-le avec tes mots." }));
  const [lt, ai] = await Promise.all([
    languageToolProblems(body, `${ctx.cvText}\n${ctx.jobText}`, deps.fetch).catch((e: unknown) => {
      errors.push(`Fautes non vérifiées (LanguageTool injoignable : ${e instanceof Error ? e.message : String(e)}).`);
      return [];
    }),
    deps.ai
      ? aiReviewProblems(deps.ai, body).catch((e: unknown) => {
          errors.push(`Sens des phrases non vérifié (IA injoignable : ${e instanceof Error ? e.message : String(e)}).`);
          return [];
        })
      : (errors.push("Sens des phrases non vérifié (aucune IA gratuite configurée)."), []),
  ]);
  // Un même passage signalé deux fois pour la même raison (LanguageTool et l'IA) : gardé une fois.
  const flat = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  const problems: ReviewProblem[] = [];
  for (const p of [...fromCode, ...lt, ...ai]) {
    const same = (q: ReviewProblem) => q.kind === p.kind && (flat(q.excerpt).includes(flat(p.excerpt)) || flat(p.excerpt).includes(flat(q.excerpt)));
    if (!problems.some(same)) problems.push(p);
  }
  return { hash: letterHash(text), problems, errors, validated: false, at: new Date().toISOString() };
}

/** Le corps de la lettre : sans l'en-tête (coordonnées, date) ni la formule de politesse ni la signature. */
export function letterBody(text: string): string {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const start = blocks.findIndex((b) => /^(Objet\s*:|Madame|Monsieur)/i.test(b));
  const end = blocks.findIndex((b) => /^Je vous prie d['’]agréer/i.test(b));
  return blocks.slice(start < 0 ? 0 : start, end < 0 ? blocks.length : end).join("\n\n");
}
