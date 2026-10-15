import type { Application, ApplicationMail, ApplicationStage, SpontaneousItem } from "./types";

/** Une candidature, sur une offre ou spontanée. */
export type AnyApplication = Application | SpontaneousItem;

/** Au-delà, pas de nouvelles : un petit rappel pour relancer. */
export const FOLLOW_UP_DAYS = 10;

/** Étapes affichées dans la frise (le refus est à part). */
export const STEPS: Array<{ stage: Exclude<ApplicationStage, "REJECTED" | "CAREER_SITE">; label: string }> = [
  { stage: "SENT", label: "Envoyée" },
  { stage: "ACK", label: "Reçue" },
  { stage: "INTERVIEW", label: "Entretien" },
  { stage: "OFFER", label: "Proposition" },
];

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  SENT: "Envoyée",
  ACK: "Réponse reçue",
  INTERVIEW: "Entretien / test",
  OFFER: "Proposition",
  REJECTED: "Refusée",
  CAREER_SITE: "À faire sur leur site",
};

const MAIL_LABEL: Record<ApplicationMail["kind"], string> = {
  ACK: "Accusé de réception",
  INTERVIEW: "Entretien",
  OFFER: "Proposition",
  REJECTION: "Refus",
  CAREER_SITE: "Candidature sur leur site",
};
export const mailLabel = (m: ApplicationMail) => (m.kind === "INTERVIEW" && m.detail ? m.detail : MAIL_LABEL[m.kind]);

export const isJob = (a: AnyApplication): a is Application => "title" in a;
export const companyOf = (a: AnyApplication) => (isJob(a) ? (a.company ?? "Entreprise non précisée") : a.company);
export const sentAt = (a: AnyApplication) => (isJob(a) ? a.appliedAt : a.sentAt);
export const activeMails = (a: AnyApplication) => a.mails.filter((m) => !m.dismissed);
export const lastMail = (a: AnyApplication) => activeMails(a).at(-1) ?? null;
export const toReview = (a: AnyApplication) => activeMails(a).filter((m) => m.needsReview);
export const daysSince = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null);
/** Dernière nouvelle : le dernier mail reçu, sinon l'envoi. */
export const lastActivity = (a: AnyApplication) => lastMail(a)?.receivedAt ?? sentAt(a);
/** Pas de nouvelle depuis longtemps (ni refus ni entretien) : relancer. */
export const needsFollowUp = (a: AnyApplication) => (a.stage === "SENT" || a.stage === "ACK") && (daysSince(lastActivity(a)) ?? 0) >= FOLLOW_UP_DAYS;
export const careerUrl = (a: AnyApplication) => activeMails(a).findLast((m) => m.kind === "CAREER_SITE")?.detail ?? null;
