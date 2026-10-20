import { z } from "zod";

/** Une petite histoire vraie, écrite par le candidat : l'IA en choisit 2 ou 3 par lettre. */
export const LetterBlockSchema = z.object({
  title: z.string().trim().max(80).default(""),
  text: z.string().trim().max(1_500).default(""),
  /** Pour quelles offres ce bloc compte (frontend, banque, autonomie…). */
  useFor: z.string().trim().max(300).default(""),
});
export type LetterBlock = z.infer<typeof LetterBlockSchema>;

/**
 * Ce qu'il faut pour écrire une lettre de motivation : ton CV (en texte), tes blocs (histoires vraies) et l'en-tête
 * de tes lettres. Données privées : restent dans la base.
 */
export const LetterKitSchema = z.object({
  /** Bloc en haut à gauche : nom, adresse, téléphone, email (une info par ligne). */
  header: z.string().trim().max(600).default(""),
  /** Ville pour « À …, le 29/09/2026 ». */
  city: z.string().trim().max(80).default(""),
  /** Nom en bas de la lettre. */
  signature: z.string().trim().max(80).default(""),
  cvText: z.string().trim().max(15_000).default(""),
  /** Tes histoires vraies : la matière de la lettre (vide = l'IA part du CV). */
  blocks: z.array(LetterBlockSchema).max(20).default([]),
  /** Règles d'honnêteté (ce qu'on ne doit jamais dire ou mélanger) : vraies au même titre que le CV. */
  rules: z.string().trim().max(15_000).default(""),
  /** Technos que tu maîtrises vraiment (séparées par des virgules) : les seules où « maîtrise » est accepté. */
  mastered: z.string().trim().max(400).default(""),
  /** Mots ou expressions à ne jamais écrire (séparés par des virgules ou un par ligne). */
  bannedWords: z.string().trim().max(1_500).default(""),
  /** Nom du PDF de la lettre (téléchargement et pièce jointe des candidatures spontanées). */
  pdfName: z.string().trim().max(120).default("Lettre_de_motivation.pdf"),
});
export type LetterKit = z.infer<typeof LetterKitSchema>;

export const EMPTY_LETTER_KIT: LetterKit = { header: "", city: "", signature: "", cvText: "", blocks: [], rules: "", mastered: "", bannedWords: "", pdfName: "Lettre_de_motivation.pdf" };

/** Le CV suffit pour écrire une lettre ; les blocs la rendent plus naturelle. */
export function letterKitReady(kit: LetterKit | null): boolean {
  return !!kit && kit.cvText.length >= 200;
}
