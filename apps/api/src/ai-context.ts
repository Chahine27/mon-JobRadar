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
    experienceMin: p.experienceMin,
    experienceMax: p.experienceMax,
    contracts: p.contracts,
    locations: p.locations.map((l) => [l.label, l.department ? `(${l.department})` : ""].join(" ").trim()),
    // Le CV aide l'IA à voir tes atouts (secteur déjà connu, projets) : utilisé dès qu'il est rempli.
    ...(kit && letterKitReady(kit) ? { cv: kit.cvText } : {}),
  };
}

/** Même offre + même profil + même modèle + même consigne = même analyse (pas de nouvel appel). */
export function analysisHash(job: Pick<JobRow, "contentHash">, profile: AnalysisProfileInput, model: string): string {
  return createHash("sha256")
    .update(JSON.stringify([job.contentHash, profile, model, ANALYSIS_PROMPT_VERSION]))
    .digest("hex")
    .slice(0, 32);
}

export type Adequation = "forte" | "moyenne" | "faible";

/** Score maximum selon l'avis de l'IA : elle ne fait que baisser un score trop optimiste, jamais le monter. */
export const AI_SCORE_CAPS: Record<Adequation, number> = { forte: 100, moyenne: 75, faible: 50 };

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
