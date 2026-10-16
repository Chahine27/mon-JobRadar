/** Ce qu'un mail reçu dit d'une candidature. */
export const MAIL_KINDS = ["ACK", "INTERVIEW", "OFFER", "REJECTION", "CAREER_SITE"] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** Étape d'une candidature, de l'envoi à la réponse finale. */
export const APPLICATION_STAGES = ["SENT", "ACK", "INTERVIEW", "OFFER", "REJECTED", "CAREER_SITE"] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

/** Avancement : une étape ne recule jamais (un accusé arrivé après l'entretien ne fait pas revenir en arrière). */
const RANK: Record<Exclude<MailKind, "REJECTION" | "CAREER_SITE">, number> = { ACK: 1, INTERVIEW: 2, OFFER: 3 };

/**
 * Étape d'une candidature d'après ses mails (ceux que tu n'as pas écartés).
 * Un refus l'emporte, sauf si un entretien ou une proposition arrive APRÈS lui (le recruteur est revenu vers toi).
 * Un renvoi vers le site carrière (« postule sur notre site ») met la candidature en attente de ton action, jusqu'à ce
 * que tu y aies postulé (`appliedOnSite`) : le suivi reprend alors normalement.
 */
export function applicationStage(
  mails: Array<{ kind: string; receivedAt: Date | string; dismissed?: boolean }>,
  rejected = false,
  appliedOnSite = false,
): ApplicationStage {
  const kept = mails.filter((m) => !m.dismissed);
  const time = (d: Date | string) => new Date(d).getTime();
  const last = (kind: MailKind) => Math.max(-Infinity, ...kept.filter((m) => m.kind === kind).map((m) => time(m.receivedAt)));
  const lastRejection = last("REJECTION");
  const lastCareer = last("CAREER_SITE");
  const best = kept
    .filter((m): m is typeof m & { kind: keyof typeof RANK } => m.kind in RANK)
    .reduce<{ kind: keyof typeof RANK; at: number } | null>(
      (acc, m) => (!acc || RANK[m.kind] > RANK[acc.kind] ? { kind: m.kind, at: time(m.receivedAt) } : acc),
      null,
    );
  if (lastRejection > -Infinity && !(best && best.kind !== "ACK" && best.at > lastRejection)) return "REJECTED";
  if (rejected && !best) return "REJECTED";
  if (!appliedOnSite && lastCareer > -Infinity && !(best && best.kind !== "ACK" && best.at > lastCareer)) return "CAREER_SITE";
  return best?.kind ?? "SENT";
}

/** Candidature sur une offre restée sans nouvelles : considérée comme refusée au-delà de ce délai. */
export const NO_ANSWER_DAYS = 14;

/**
 * Offre sans entretien ni proposition, et sans aucune nouvelle (ni mail, ni candidature) depuis 14 jours : refus de fait,
 * affiché « Refusée (sans réponse) ». Une réponse qui arrive ensuite rend son vrai statut à la candidature.
 */
export function noAnswer(
  stage: ApplicationStage,
  appliedAt: Date | string | null,
  mails: Array<{ receivedAt: Date | string; dismissed?: boolean }>,
  now: Date = new Date(),
): boolean {
  if (stage !== "SENT" && stage !== "ACK") return false;
  const times = [appliedAt, ...mails.filter((m) => !m.dismissed).map((m) => m.receivedAt)].filter((d): d is Date | string => d != null).map((d) => new Date(d).getTime());
  return times.length > 0 && now.getTime() - Math.max(...times) >= NO_ANSWER_DAYS * 86_400_000;
}
