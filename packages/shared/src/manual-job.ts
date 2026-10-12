import { z } from "zod";
import { REMOTE_TYPES } from "./job";

/** Contrats proposés dans le formulaire « Ajouter une offre ». */
export const MANUAL_CONTRACTS = ["CDI", "CDD", "INTERIM", "ALTERNANCE", "STAGE", "FREELANCE"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const salary = z.number().int().min(0).max(500_000).nullable().optional().transform((v) => v ?? null);

/**
 * Offre ajoutée à la main (vue sur LinkedIn, Indeed…). Seuls le titre et le texte sont obligatoires :
 * compétences, expérience et télétravail sont détectés dans le texte, comme pour les autres sources.
 */
export const ManualJobSchema = z
  .object({
    url: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), "Adresse invalide : elle doit commencer par https://"),
    title: z.string().trim().min(2, "Titre obligatoire").max(200),
    company: optionalText(150),
    location: optionalText(150),
    /** Adresse du lieu de travail (« 48 Boulevard des Batignolles, 75017 Paris ») : trajet plus précis. */
    address: optionalText(200),
    contractType: z.enum(MANUAL_CONTRACTS).nullable().optional().transform((v) => v ?? null),
    salaryMin: salary,
    salaryMax: salary,
    remoteType: z.enum(REMOTE_TYPES).default("unknown"),
    /** Années d'expérience demandées (lues par l'IA ou saisies) ; absent → lues dans le texte. */
    experienceYears: z.number().int().min(0).max(30).nullable().optional().transform((v) => v ?? null),
    description: z.string().trim().min(20, "Colle le texte de l'annonce (20 caractères minimum)").max(30_000),
  })
  .refine((j) => j.salaryMin === null || j.salaryMax === null || j.salaryMin <= j.salaryMax, {
    message: "Le salaire minimum dépasse le maximum",
    path: ["salaryMax"],
  });

export type ManualJobInput = z.input<typeof ManualJobSchema>;
export type ManualJob = z.output<typeof ManualJobSchema>;

/** Site d'origine reconnu à partir de l'adresse (affichage seulement). */
export function manualOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const known: Array<[RegExp, string]> = [
    [/linkedin\./, "LinkedIn"],
    [/indeed\./, "Indeed"],
    [/welcometothejungle\./, "Welcome to the Jungle"],
    [/hellowork\./, "HelloWork"],
    [/apec\.fr$/, "APEC"],
    [/francetravail\.fr$/, "France Travail"],
    [/glassdoor\./, "Glassdoor"],
    [/monster\./, "Monster"],
    [/meteojob\./, "Meteojob"],
    [/jobteaser\./, "JobTeaser"],
    [/free-work\./, "Free-Work"],
    [/lesjeudis\./, "LesJeudis"],
    [/jooble\./, "Jooble"],
    [/adzuna\./, "Adzuna"],
  ];
  for (const [re, label] of known) if (re.test(host)) return label;
  return host;
}
