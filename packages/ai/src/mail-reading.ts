import { z } from "zod";
import type { AiClient } from "./cloud";

/** Ce que l'IA dit d'un mail reçu : à quelle candidature il répond, quel genre de réponse, et en une phrase. */
const MailReadingSchema = z.object({
  candidature: z.number().int().min(0),
  type: z.enum(["accuse_reception", "entretien", "test_technique", "demande_informations", "proposition", "refus", "autre"]),
  resume: z.string().max(400),
  certain: z.boolean(),
});

const MAIL_READING_JSON_SCHEMA = {
  type: "object",
  properties: {
    candidature: { type: "integer" },
    type: { type: "string", enum: ["accuse_reception", "entretien", "test_technique", "demande_informations", "proposition", "refus", "autre"] },
    resume: { type: "string" },
    certain: { type: "boolean" },
  },
  required: ["candidature", "type", "resume", "certain"],
};

const SYSTEM = `Tu lis un mail reçu par un candidat et tu dis s'il répond à l'une de ses candidatures. Tu réponds UNIQUEMENT avec le JSON demandé.
- candidature : le numéro de la candidature à laquelle ce mail répond (entreprise ET poste), ou 0 s'il ne répond à aucune. Un mail pour un AUTRE poste que ceux listés, ou d'une autre entreprise, c'est 0. Un outil de recrutement (Welcome to the Jungle, Teamtailor, Lever…) envoie pour beaucoup d'entreprises : fie-toi au nom de l'entreprise et au poste écrits dans le mail.
- type :
  - accuse_reception : candidature bien reçue / en cours d'étude, sans décision ni rendez-vous.
  - entretien : on propose un entretien, un appel, une rencontre, ou on demande ses disponibilités pour se voir.
  - test_technique : on envoie un test, un exercice, un cas pratique à faire.
  - demande_informations : on demande des informations (prétentions salariales, date de disponibilité, CV à jour…).
  - proposition : proposition ou promesse d'embauche, offre de contrat.
  - refus : la candidature n'est pas retenue (même avec « nous gardons votre CV »), ou pas de poste à pourvoir.
  - autre : newsletter, alerte emploi, publicité, autre poste proposé, demande de garder ses données, ou rien à voir.
  Une phrase au conditionnel (« si votre profil correspond, nous vous proposerons un entretien », « sans réponse sous 3 semaines… ») ne compte pas.
- resume : une phrase courte en français, au présent, qui dit ce que le mail apprend au candidat et ce qu'il doit faire (ex. : « Entretien proposé : choisir un créneau sur Calendly avant vendredi. »). Pas de formule de politesse.
- certain : false si tu hésites sur la candidature ou sur le type.`;

export type MailReading = {
  /** Index dans la liste des candidatures proposées, null = le mail ne répond à aucune. */
  index: number | null;
  verdict: { kind: "ACK" | "INTERVIEW" | "OFFER" | "REJECTION"; detail: string | null } | null;
  summary: string;
  certain: boolean;
};

const MAP: Record<z.infer<typeof MailReadingSchema>["type"], MailReading["verdict"]> = {
  accuse_reception: { kind: "ACK", detail: null },
  entretien: { kind: "INTERVIEW", detail: "Entretien" },
  test_technique: { kind: "INTERVIEW", detail: "Test technique" },
  demande_informations: { kind: "INTERVIEW", detail: "Demande d'informations" },
  proposition: { kind: "OFFER", detail: null },
  refus: { kind: "REJECTION", detail: null },
  autre: null,
};

/** Chaque mail qui peut répondre à une candidature est lu en entier : laquelle, quel genre de réponse, résumé. */
export async function readApplicationMailWithAi(
  client: Pick<AiClient, "chatJson">,
  mail: { subject: string; from: string; text: string },
  candidates: Array<{ company: string; title: string | null; since: Date }>,
): Promise<MailReading> {
  const list = candidates
    .map((c, i) => `${i + 1}. ${c.title ? `« ${c.title} »` : "candidature spontanée"} chez ${c.company} (envoyée le ${c.since.toLocaleDateString("fr-FR")})`)
    .join("\n");
  const prompt = `CANDIDATURES POSSIBLES
${list}

MAIL
De : ${mail.from}
Sujet : ${mail.subject}
${mail.text.slice(0, 4000)}`;
  const parsed = MailReadingSchema.safeParse(await client.chatJson(SYSTEM, prompt, MAIL_READING_JSON_SCHEMA, { temperature: 0 }));
  if (!parsed.success) throw new Error("Réponse de l'IA hors format");
  const n = parsed.data.candidature;
  const verdict = MAP[parsed.data.type];
  return {
    index: n >= 1 && n <= candidates.length && verdict ? n - 1 : null,
    verdict,
    summary: parsed.data.resume.trim().slice(0, 300),
    certain: parsed.data.certain,
  };
}
