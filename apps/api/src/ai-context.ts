import { createHash } from "node:crypto";
import { ANALYSIS_PROMPT_VERSION, type AnalysisJobInput, type AnalysisProfileInput } from "@job-radar/ai";
import { isAbridged, letterKitReady, type LetterKit, type Profile } from "@job-radar/shared";
import type { JobRow } from "./stores";

export { ABRIDGED_SOURCES, isAbridged } from "@job-radar/shared";

export function toJobInput(job: JobRow): AnalysisJobInput {
  return {
    title: job.title,
    company: job.company,
    city: job.city,
    department: job.department,
    contractType: job.contractType,
    remoteType: job.remoteType,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    description: job.description,
    abridged: isAbridged(job),
  };
}

export function toProfileInput(p: Profile, kit: LetterKit | null): AnalysisProfileInput {
  return {
    skills: p.skills,
    projectSkills: p.projectSkills,
    experienceMin: p.experienceMin,
    experienceMax: p.experienceMax,
    contracts: p.contracts,
    locations: p.locations.map((l) => [l.label, l.department ? `(${l.department})` : ""].join(" ").trim()),
    // Le CV aide l'IA à voir tes atouts (secteur déjà connu, projets) : utilisé dès qu'il est rempli.
    ...(kit && letterKitReady(kit) ? { cv: kit.cvText } : {}),
  };
}

const sha = (v: unknown, n: number) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, n);
/** Ce que l'IA lit de l'offre, avec sa consigne et son modèle (« i » : jamais le début d'une ancienne empreinte, en hexadécimal). */
const readPart = (job: JobRow, model: string) => `i${sha([toJobInput(job), ANALYSIS_PROMPT_VERSION, model], 11)}`;

/**
 * « <ce que l'IA lit>:<tout> ». Même offre + même profil + même modèle + même consigne = même analyse (pas de nouvel appel).
 * La 1ʳᵉ partie ne dépend pas du profil : cf. analysisFitsJob.
 */
export function analysisHash(job: JobRow, profile: AnalysisProfileInput, model: string): string {
  return `${readPart(job, model)}:${sha([job.contentHash, profile, model, ANALYSIS_PROMPT_VERSION], 32)}`;
}

/**
 * L'avis de l'IA vaut-il encore ? Il se refait (automatiquement pour les meilleures offres) quand ce qu'elle lit de
 * l'offre change (texte, contrat, salaire, lieu… y compris après une règle réappliquée), quand sa consigne change
 * (ANALYSIS_PROMPT_VERSION) ou quand le modèle change. Pas quand le profil ou le CV change (sinon chaque retouche
 * relançait l'IA sur tout le flux : jusqu'à 27 analyses pour une offre) : « Relancer » le fait à la demande.
 */
export function analysisFitsJob(a: { inputHash: string; model: string }, job: JobRow, model: string): boolean {
  // Analyses d'avant ce format (sans « i ») : faites avec une ancienne consigne, donc périmées.
  return a.inputHash.startsWith(`${readPart(job, model)}:`);
}

export type Adequation = "forte" | "moyenne" | "faible";

/** Score maximum selon l'avis de l'IA : elle ne fait que baisser un score trop optimiste, jamais le monter. */
export const AI_SCORE_CAPS: Record<Adequation, number> = { forte: 100, moyenne: 75, faible: 40 };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : []);

/** Lit l'adéquation et l'avis dans une analyse enregistrée (null si illisible). */
export function readVerdict(
  result: unknown,
): { adequation: Adequation; avis: string; experience: number | null; required: string[]; bonus: string[] } | null {
  const r = result as {
    adequation?: unknown;
    avis?: unknown;
    experience_min_ans?: unknown;
    competences_obligatoires?: unknown;
    competences_bonus?: unknown;
  } | null;
  if (!r || typeof r !== "object") return null;
  if (r.adequation !== "forte" && r.adequation !== "moyenne" && r.adequation !== "faible") return null;
  const e = r.experience_min_ans;
  return {
    adequation: r.adequation,
    avis: typeof r.avis === "string" ? r.avis : "",
    experience: typeof e === "number" && Number.isInteger(e) && e >= 0 && e <= 30 ? e : null,
    required: strings(r.competences_obligatoires),
    bonus: strings(r.competences_bonus),
  };
}
