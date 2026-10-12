import { z } from "zod";

/**
 * Forme d'une offre de l'API « Offres d'emploi v2 ».
 * Volontairement permissive : tout est optionnel sauf l'id, et les champs inconnus sont conservés.
 */
export const FtOfferSchema = z.looseObject({
  id: z.string(),
  intitule: z.string().optional(),
  description: z.string().optional(),
  dateCreation: z.string().optional(),
  dateActualisation: z.string().optional(),
  lieuTravail: z
    .looseObject({
      libelle: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      codePostal: z.string().optional(),
      commune: z.string().optional(),
    })
    .optional(),
  entreprise: z.looseObject({ nom: z.string().optional(), url: z.string().optional() }).optional(),
  typeContrat: z.string().optional(),
  typeContratLibelle: z.string().optional(),
  natureContrat: z.string().optional(),
  experienceExige: z.string().optional(),
  experienceLibelle: z.string().optional(),
  competences: z.array(z.looseObject({ libelle: z.string().optional() })).optional(),
  salaire: z
    .looseObject({ libelle: z.string().optional(), commentaire: z.string().optional() })
    .optional(),
  alternance: z.boolean().optional(),
  origineOffre: z
    .looseObject({
      origine: z.string().optional(),
      urlOrigine: z.string().optional(),
      partenaires: z.array(z.looseObject({ nom: z.string().optional(), url: z.string().optional() })).optional(),
    })
    .optional(),
});
export type FtOffer = z.infer<typeof FtOfferSchema>;

export const FtSearchResponseSchema = z.looseObject({
  resultats: z.array(z.unknown()).optional(),
});

export const FtTokenSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});
