import { departmentFromText } from "@job-radar/shared";
import { z } from "zod";
import type { OllamaClient } from "./ollama";

/** Changer ce numéro quand la consigne change. */
export const READING_PROMPT_VERSION = "2026-09-30.2";

/** Ce que l'IA rend quand elle lit une annonce brute (page envoyée par l'extension). */
export const JobReadingSchema = z.object({
  titre: z.string().trim().max(250).nullable(),
  entreprise: z.string().trim().max(200).nullable(),
  ville: z.string().trim().max(120).nullable(),
  adresse: z.string().trim().max(200).nullable(),
  departement: z.string().trim().max(10).nullable(),
  contrat: z.enum(["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE", "inconnu"]),
  teletravail: z.enum(["complet", "hybride", "sur_site", "inconnu"]),
  salaire_min: z.number().nullable(),
  salaire_max: z.number().nullable(),
  salaire_periode: z.enum(["annuel", "mensuel", "journalier", "horaire", "inconnu"]),
  experience_min_ans: z.number().int().min(0).max(40).nullable(),
  competences: z.array(z.string().trim().min(1).max(60)).max(25),
});
export type JobReading = z.infer<typeof JobReadingSchema>;

export const JOB_READING_JSON_SCHEMA = {
  type: "object",
  properties: {
    titre: { type: ["string", "null"] },
    entreprise: { type: ["string", "null"] },
    ville: { type: ["string", "null"] },
    adresse: { type: ["string", "null"] },
    departement: { type: ["string", "null"] },
    contrat: { type: "string", enum: ["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE", "inconnu"] },
    teletravail: { type: "string", enum: ["complet", "hybride", "sur_site", "inconnu"] },
    salaire_min: { type: ["number", "null"] },
    salaire_max: { type: ["number", "null"] },
    salaire_periode: { type: "string", enum: ["annuel", "mensuel", "journalier", "horaire", "inconnu"] },
    experience_min_ans: { type: ["integer", "null"] },
    competences: { type: "array", items: { type: "string" } },
  },
  required: [
    "titre",
    "entreprise",
    "ville",
    "adresse",
    "departement",
    "contrat",
    "teletravail",
    "salaire_min",
    "salaire_max",
    "salaire_periode",
    "experience_min_ans",
    "competences",
  ],
} as const;

const MAX_TEXT = 16_000; // ≈ 5 000 mots : tient dans la mémoire de travail (8k) avec la consigne et la réponse

export const READING_SYSTEM_PROMPT = `Tu lis le texte d'une page d'offre d'emploi (copiée depuis un site : LinkedIn, Indeed, Welcome to the Jungle, HelloWork…).
Le texte peut contenir des menus, des boutons ou d'autres offres : ignore-les, ne lis que L'OFFRE principale.
Une partie « INFOS À CÔTÉ DE L'ANNONCE » peut suivre (entreprise, avantages, lieu de travail) : sers-t'en pour l'adresse, la ville et le télétravail, mais ce ne sont pas des exigences du poste (nombre de salariés, âge moyen… ne sont pas l'expérience demandée).
Tu réponds UNIQUEMENT avec le JSON demandé. N'invente rien : ce qui n'est pas écrit → null, "inconnu" ou liste vide.

- titre : l'intitulé du poste, recopié exactement comme écrit (sans « H/F » ajouté si absent).
- entreprise : l'entreprise qui publie l'offre (un cabinet ou une ESN qui recrute pour un client : le nom du cabinet).
- ville : la ville du lieu de travail (pas le siège d'un groupe, pas une ville citée dans l'histoire de l'entreprise). Paris 16e → « Paris ».
- adresse : l'adresse du lieu de travail si elle est écrite (« 48 Boulevard des Batignolles, 75017 Paris »), sinon null. La rubrique « Le lieu de travail » des INFOS À CÔTÉ DE L'ANNONCE est la source la plus fiable pour l'adresse et la ville.
- departement : son numéro (« 75 », « 92 », « 2A ») s'il est écrit ou évident (code postal, Paris = 75), sinon null.
- contrat : CDI, CDD, INTERIM, ALTERNANCE, STAGE, FREELANCE (freelance / indépendant / portage / mission en TJM), sinon inconnu.
- teletravail : complet (100 % à distance), hybride (quelques jours, « occasionnel », « partiel », « flexible »), sur_site (écrit qu'il n'y en a pas), sinon inconnu.
- salaire_min / salaire_max / salaire_periode : seulement le salaire écrit dans l'annonce, en euros, tel qu'écrit (« 45k€ » → 45000), avec sa période. Une « estimation » du site n'est PAS un salaire : ignore-la. Un seul montant → min = max.
- experience_min_ans : le nombre d'années d'expérience DEMANDÉES AU CANDIDAT (« 1 à 2 ans » → 1, « > 1 an » → 1, « junior / débutant accepté » → 0). JAMAIS l'expérience d'une personne de l'équipe (« notre CTO a 12 ans d'expérience ») ni l'âge de l'entreprise. Rien d'écrit → null.
- competences : les technologies et compétences techniques demandées, noms courts (« React », « Java », « SQL », « Docker »), 20 maximum.`;

export function buildReadingPrompt(text: string, hints?: { title?: string | null; company?: string | null } | null): string {
  const known = [hints?.title ? `- titre donné par la page : ${hints.title}` : "", hints?.company ? `- entreprise donnée par la page : ${hints.company}` : ""]
    .filter(Boolean)
    .join("\n");
  return `${known ? `INDICES FIABLES (lus dans les données de la page)\n${known}\n\n` : ""}TEXTE DE LA PAGE
"""
${text.slice(0, MAX_TEXT)}
"""`;
}

// ───── Garde-fous : on ne garde que ce qu'on retrouve dans le texte ─────

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[’`]/g, "'");

/** Le libellé figure-t-il (à peu près) dans le texte ? Au moins 70 % de ses mots significatifs. */
export function appearsIn(value: string, text: string): boolean {
  const words = fold(value)
    .replace(/\b[hf]\s*\/\s*[hf]\b/g, " ")
    .split(/[^\p{L}\p{N}+#.]+/u)
    .filter((w) => w.length >= 2);
  if (words.length === 0) return false;
  const t = fold(text);
  return words.filter((w) => t.includes(w)).length / words.length >= 0.7;
}

/** Un montant (45000) est-il écrit dans le texte ? « 45 000 », « 45000 », « 45k », « 45 K€ ». */
export function amountIn(n: number, text: string): boolean {
  const t = fold(text).replace(/[  ]/g, " ");
  const int = Math.round(n);
  const spaced = int.toLocaleString("fr-FR").replace(/[  ]/g, " ");
  if (t.includes(String(int)) || t.includes(spaced) || t.includes(spaced.replace(/ /g, "."))) return true;
  if (int >= 1000 && int % 1000 === 0 && new RegExp(`\\b${int / 1000}\\s*k`).test(t)) return true;
  if (int >= 1000 && int % 100 === 0 && new RegExp(`\\b${int / 1000}`.replace(".", "[.,]") + `\\s*k`).test(t)) return true;
  return false;
}

const CONTRACTS = ["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE"] as const;
export type ReadFields = {
  title: string | null;
  company: string | null;
  location: string | null;
  address: string | null;
  contractType: (typeof CONTRACTS)[number] | null;
  remoteType: "remote" | "hybrid" | "onsite" | "unknown";
  salaryMin: number | null;
  salaryMax: number | null;
  experienceYears: number | null;
  skills: string[];
};

/** Réponse de l'IA → champs du formulaire, en jetant ce qui n'est pas dans le texte (anti-invention). */
export function toFields(r: JobReading, text: string): ReadFields {
  const title = r.titre && appearsIn(r.titre, text) ? r.titre.replace(/\s+/g, " ").trim() : null;
  const company = r.entreprise && appearsIn(r.entreprise, text) ? r.entreprise.trim() : null;

  const address = r.adresse && /\d/.test(r.adresse) && appearsIn(r.adresse, text) ? r.adresse.replace(/\s+/g, " ").trim() : null;
  let location: string | null = null;
  if (r.ville && appearsIn(r.ville, text)) {
    const dep =
      r.departement && /^(\d{2}|2A|2B|97\d)$/i.test(r.departement)
        ? r.departement.toUpperCase()
        : departmentFromText(address) ?? departmentFromText(r.ville);
    const city = /^paris\b/i.test(r.ville) ? "Paris" : r.ville.trim();
    location = dep ? `${city} (${dep})` : city;
  }

  // Salaire : les chiffres doivent être dans l'annonce ; seuls l'annuel et le mensuel (× 12) sont gardés.
  let salaryMin: number | null = null;
  let salaryMax: number | null = null;
  const lo = r.salaire_min ?? r.salaire_max;
  const hi = r.salaire_max ?? r.salaire_min;
  const factor = r.salaire_periode === "annuel" ? 1 : r.salaire_periode === "mensuel" ? 12 : null;
  if (factor && lo !== null && hi !== null && amountIn(lo, text) && amountIn(hi, text)) {
    const a = Math.round(Math.min(lo, hi) * factor);
    const b = Math.round(Math.max(lo, hi) * factor);
    if (a >= 15_000 && b <= 500_000) {
      salaryMin = a;
      salaryMax = b;
    }
  }

  // Expérience : le nombre doit être écrit près de « an(s) » / « year(s) » ; 0 accepté si « junior / débutant ».
  let experienceYears: number | null = null;
  const e = r.experience_min_ans;
  if (e !== null) {
    const t = fold(text);
    if (e === 0 ? /junior|debutant|jeune diplome|sans experience/.test(t) : new RegExp(`\\b${e}\\b[^\\n]{0,25}\\b(an|ans|annee|annees|year|years)\\b`).test(t)) {
      experienceYears = e;
    }
  }

  const remote = { complet: "remote", hybride: "hybrid", sur_site: "onsite", inconnu: "unknown" } as const;
  const skills = [...new Set(r.competences.filter((s) => appearsIn(s, text)).map((s) => s.trim()))].slice(0, 20);

  return {
    title,
    company,
    location,
    address,
    contractType: r.contrat === "inconnu" ? null : r.contrat,
    remoteType: remote[r.teletravail],
    salaryMin,
    salaryMax,
    experienceYears,
    skills,
  };
}

/** Lit une page d'offre avec l'IA. Une réponse hors format est redemandée une fois. */
export async function readJobWithAi(
  client: Pick<OllamaClient, "chatJson" | "model">,
  text: string,
  hints?: { title?: string | null; company?: string | null } | null,
): Promise<{ fields: ReadFields; model: string; durationMs: number }> {
  const started = Date.now();
  const prompt = buildReadingPrompt(text, hints);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await client.chatJson(READING_SYSTEM_PROMPT, prompt, JOB_READING_JSON_SCHEMA, { temperature: 0 });
    const parsed = JobReadingSchema.safeParse(raw);
    if (parsed.success) {
      const fields = toFields(parsed.data, text.slice(0, MAX_TEXT));
      // Titre / entreprise donnés par les données de la page : utilisés si l'IA n'a rien trouvé de fiable.
      if (!fields.title && hints?.title) fields.title = hints.title;
      if (!fields.company && hints?.company) fields.company = hints.company;
      return { fields, model: client.model, durationMs: Date.now() - started };
    }
    lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ; ");
  }
  throw new Error(`Réponse de l'IA hors format : ${lastError}`);
}
