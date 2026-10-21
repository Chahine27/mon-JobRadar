/** Ce qu'un mail reçu dit d'une candidature. */
/** AWAY : message d'absence (« je suis absent jusqu'au… ») ; ce n'est pas une réponse, la relance attend le retour. */
export const MAIL_KINDS = ["ACK", "INTERVIEW", "OFFER", "REJECTION", "CAREER_SITE", "AWAY"] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** Étape d'une candidature, de l'envoi à la réponse finale. */
/** Comment la candidature à une offre est partie (obligatoire à « Postulé »). */
export const APPLY_CHANNELS = ["mail", "formulaire", "linkedin", "autre"] as const;
export type ApplyChannel = (typeof APPLY_CHANNELS)[number];
/** CV envoyé : le classique (e-mail) ou celui fait pour les logiciels de tri (ATS). */
export const APPLY_CVS = ["classique", "ats"] as const;
export type ApplyCv = (typeof APPLY_CVS)[number];

export const APPLICATION_STAGES = ["SENT", "ACK", "INTERVIEW", "OFFER", "REJECTED", "CAREER_SITE"] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

/** Avancement : une étape ne recule jamais (un accusé arrivé après l'entretien ne fait pas revenir en arrière). */
const RANK: Record<Exclude<MailKind, "REJECTION" | "CAREER_SITE" | "AWAY">, number> = { ACK: 1, INTERVIEW: 2, OFFER: 3 };

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

/** Candidature sur une offre restée sans nouvelles : considérée comme refusée au-delà de ce délai (pas de relance). */
export const NO_ANSWER_DAYS = 21;

/**
 * Offre sans entretien ni proposition, et sans aucune nouvelle (ni mail, ni candidature) depuis 21 jours : refus de fait,
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

/**
 * Spontanée à relancer ? Envoyée il y a 7 jours ou plus, sans réponse (un message d'absence n'en est pas une), et pas
 * encore relancée, sauf si la relance est tombée pendant une absence. Après une absence, on attend la date de retour
 * (`detail` du message d'absence, au format AAAA-MM-JJ).
 */
export function followUpDue(
  a: { sentAt: Date | string; sentTo: string | null; followedUpAt: Date | string | null },
  mails: Array<{ kind: string; detail: string | null; receivedAt: Date | string; dismissed?: boolean }>,
  now: Date = new Date(),
): boolean {
  if (!a.sentTo) return false;
  const kept = mails.filter((m) => !m.dismissed);
  if (kept.some((m) => m.kind !== "AWAY")) return false;
  const time = (d: Date | string) => new Date(d).getTime();
  const away = kept.filter((m) => m.kind === "AWAY").sort((x, y) => time(y.receivedAt) - time(x.receivedAt))[0];
  if (a.followedUpAt && !(away && time(away.receivedAt) >= time(a.followedUpAt))) return false;
  const back = away?.detail && /^\d{4}-\d{2}-\d{2}$/.test(away.detail) ? time(away.detail) : away ? time(away.receivedAt) + 7 * 86_400_000 : 0;
  return now.getTime() >= Math.max(time(a.sentAt) + 7 * 86_400_000, back);
}
