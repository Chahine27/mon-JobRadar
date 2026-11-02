import type { LetterReview, LetterOptions, AiStatus, AnalysisJobInput, AnalysisProfileInput, JobAnalysisResult, ReadFields } from "@job-radar/ai";
import type { Mailer } from "@job-radar/notifications";
import type { LetterKit } from "@job-radar/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { JobService } from "../jobs/service";
import type { Stores } from "../stores";

/** IA branchée par server.ts (Ollama). Absente → routes qui répondent « IA non configurée ». */
export type AiService = {
  model: string;
  status(): Promise<AiStatus>;
  analyze(job: AnalysisJobInput, profile: AnalysisProfileInput): Promise<{ result: JobAnalysisResult; model: string; durationMs: number }>;
  writeLetter(job: AnalysisJobInput, kit: LetterKit, opts?: LetterOptions): Promise<{ content: string; model: string; durationMs: number }>;
  readJob(text: string, hints: { title?: string | null; company?: string | null } | null): Promise<{ fields: ReadFields; model: string; durationMs: number }>;
  /** Relecture avant envoi (LanguageTool + IA gratuite). Absente → la lettre devra être validée à la main. */
  reviewLetter?(text: string, ctx: ReviewContext): Promise<LetterReview>;
};
export type ReviewContext = { cvText: string; jobText: string; jobTitle?: string; spontaneous?: boolean; facts?: Pick<LetterKit, "blocks" | "rules" | "cvText">; aiCoding?: boolean };

export const LetterBody = z.object({ content: z.string().trim().min(1).max(20_000) });
export const IdParams = z.object({ id: z.string().min(1).max(64) });

export const NO_DESCRIPTION_MESSAGE =
  "La source n'a donné aucune description : l'IA n'a rien à lire. Colle l'annonce complète (bouton « Compléter l'annonce »).";

export const errorReply = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code;
  if (code === "NO_DESCRIPTION") return { status: 422, body: { error: code, message } };
  const unavailable = code === "AI_UNAVAILABLE";
  return { status: unavailable ? 503 : 502, body: { error: unavailable ? "AI_UNAVAILABLE" : "AI_FAILED", message } };
};

export type AutoFeed = {
  /** Vérification IA du flux ; la promesse se termine quand la file est vide. */
  run?: (userId: string) => Promise<unknown>;
  /** Score affiché (corrigé par l'IA) des offres dont l'analyse IA est à jour. */
  scores?: (userId: string) => Promise<Map<string, number>>;
};


export type AiRouteOptions = {
  stores: Stores;
  jobs: JobService;
  ai?: AiService;
  mailer?: Mailer;
  /** Lettre terminée : prévient l'utilisateur (notification). Une erreur ici ne fait jamais échouer la lettre. */
  onLetterReady?: (n: { title: string; body: string; path: string; tag: string }) => Promise<unknown>;
  /** Rempli ici : permet au serveur de lancer la vérification IA du flux (fin de collecte). */
  autoFeed?: AutoFeed;
  /** Pause entre deux relances d'un envoi groupé (4 s ; 0 dans les tests). */
  followUpPauseMs?: number;
};

/** Ce que chaque groupe de routes reçoit : l'application, les options, et les fonctions partagées. */
export type AiDeps = {
  app: FastifyInstance;
  opts: AiRouteOptions;
  stores: Stores;
  ai: AiService | undefined;
  /** La carte graphique fait une chose à la fois : chaque appel à l'IA passe par cette file. */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>;
  notifyLetter: (reply: FastifyReply, userId: string, n: { title: string; body: string; path: string; tag: string }) => void;
  runReview: (text: string, ctx: ReviewContext) => Promise<LetterReview>;
};

export const reviewPending = (reply: FastifyReply, message: string) => reply.code(409).send({ error: "REVIEW_PENDING", message });
export const NOT_SAVED = "Enregistre d'abord la lettre : elle sera relue automatiquement.";

/** Ce qui change le texte d'une lettre (le nom du PDF n'en fait pas partie) : sert à savoir si une lettre est à jour. */
export const writingKit = ({ pdfName: _, ...kit }: LetterKit) => kit;
