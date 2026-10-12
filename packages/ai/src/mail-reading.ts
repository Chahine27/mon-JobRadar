import { z } from "zod";
import type { OllamaClient } from "./ollama";

/** Ce que l'IA doit dire d'un mail reçu après une candidature. */
const MailReadingSchema = z.object({
  type: z.enum(["accuse_reception", "entretien", "test_technique", "demande_informations", "proposition", "refus", "autre"]),
});

const MAIL_READING_JSON_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["accuse_reception", "entretien", "test_technique", "demande_informations", "proposition", "refus", "autre"] },
  },
  required: ["type"],
};

const SYSTEM = `Tu tries les mails reçus par un candidat après une candidature. Tu réponds UNIQUEMENT avec le JSON demandé.
Types :
- accuse_reception : la candidature est bien reçue / en cours d'étude, sans décision ni rendez-vous.
- entretien : on propose un entretien, un appel, une rencontre, ou on demande ses disponibilités pour se voir.
- test_technique : on envoie un test, un exercice, un cas pratique à faire.
- demande_informations : on demande des informations (prétentions salariales, date de disponibilité, CV à jour…).
- proposition : proposition d'embauche, promesse d'embauche, offre de contrat.
- refus : la candidature n'est pas retenue (même avec « nous gardons votre CV »), ou l'entreprise n'a pas de poste à pourvoir.
- autre : newsletter, publicité, autre poste proposé par un cabinet, ou rien à voir avec cette candidature.
Une phrase au conditionnel (« si votre profil correspond, nous vous proposerons un entretien ») n'est PAS une invitation.`;

export type MailReading = { kind: "ACK" | "INTERVIEW" | "OFFER" | "REJECTION"; detail: string | null } | null;

const MAP: Record<z.infer<typeof MailReadingSchema>["type"], MailReading> = {
  accuse_reception: { kind: "ACK", detail: null },
  entretien: { kind: "INTERVIEW", detail: "Entretien" },
  test_technique: { kind: "INTERVIEW", detail: "Test technique" },
  demande_informations: { kind: "INTERVIEW", detail: "Demande d'informations" },
  proposition: { kind: "OFFER", detail: null },
  refus: { kind: "REJECTION", detail: null },
  autre: null,
};

/** Mail ambigu → étape de la candidature (null = pas une réponse à cette candidature). */
export async function readApplicationMailWithAi(
  client: Pick<OllamaClient, "chatJson">,
  mail: { subject: string; text: string; company: string; title: string | null },
): Promise<MailReading> {
  const prompt = `CANDIDATURE : ${mail.title ? `« ${mail.title} » chez ` : "candidature spontanée chez "}${mail.company}

MAIL
Sujet : ${mail.subject}
${mail.text.slice(0, 4000)}`;
  const parsed = MailReadingSchema.safeParse(await client.chatJson(SYSTEM, prompt, MAIL_READING_JSON_SCHEMA, { temperature: 0 }));
  if (!parsed.success) throw new Error("Réponse de l'IA hors format");
  return MAP[parsed.data.type];
}
