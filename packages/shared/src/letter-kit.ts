import { z } from "zod";

/**
 * Ce qu'il faut pour écrire une lettre de motivation : ton CV (en texte), une lettre que tu as déjà écrite
 * (pour le style) et l'en-tête de tes lettres. Données privées : restent dans la base locale.
 */
export const LetterKitSchema = z.object({
  /** Bloc en haut à gauche : nom, adresse, téléphone, email (une info par ligne). */
  header: z.string().trim().max(600).default(""),
  /** Ville pour « À …, le 29/09/2026 ». */
  city: z.string().trim().max(80).default(""),
  /** Nom en bas de la lettre. */
  signature: z.string().trim().max(80).default(""),
  cvText: z.string().trim().max(15_000).default(""),
  letterExample: z.string().trim().max(10_000).default(""),
  /** Tes propres règles d'écriture (structure, phrases types, faits à mettre en avant) : priorité sur les règles générales. */
  rules: z.string().trim().max(15_000).default(""),
  /** Technos que tu maîtrises vraiment (séparées par des virgules) : les seules où « maîtrise » est accepté. */
  mastered: z.string().trim().max(400).default(""),
  /** Dernier paragraphe, toujours le même ({entreprise} est remplacé par le nom de l'entreprise). */
  closing: z.string().trim().max(500).default(""),
  /** Mots ou expressions à ne jamais écrire (séparés par des virgules ou un par ligne). */
  bannedWords: z.string().trim().max(1_500).default(""),
  /** Dossier du PC où « Enregistrer en PDF » range la lettre (vide = fenêtre d'impression du navigateur). */
  pdfFolder: z.string().trim().max(300).default(""),
  /** Nom du fichier PDF (toujours le même : le nouveau remplace l'ancien). */
  pdfName: z.string().trim().max(120).default("Lettre_de_motivation.pdf"),
  /** Chemin complet de ton CV en PDF sur le PC : joint aux candidatures spontanées envoyées par email. */
  cvPdfPath: z.string().trim().max(400).default(""),
  /** CV adapté à une offre : dossier des PDF (vide = même dossier que les lettres). */
  cvFolder: z.string().trim().max(300).default(""),
  /** Un sous-dossier « Entreprise_AAAA-MM-JJ » par candidature. */
  cvSubfolder: z.boolean().default(true),
  /** true = un nouvel export remplace le fichier existant ; false = garde l'ancien (nouveau fichier « _2 », « _3 »…). */
  cvReplace: z.boolean().default(true),
});
export type LetterKit = z.infer<typeof LetterKitSchema>;

export const EMPTY_LETTER_KIT: LetterKit = { header: "", city: "", signature: "", cvText: "", letterExample: "", rules: "", mastered: "", closing: "", bannedWords: "", pdfFolder: "", pdfName: "Lettre_de_motivation.pdf", cvPdfPath: "", cvFolder: "", cvSubfolder: true, cvReplace: true };

/** Le CV suffit pour écrire une lettre ; la lettre exemple améliore le style. */
export function letterKitReady(kit: LetterKit | null): boolean {
  return !!kit && kit.cvText.length >= 200;
}
