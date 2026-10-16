import { followUpDue } from "@job-radar/shared";
import type { Application, ApplicationMail, ApplicationStage, SpontaneousItem } from "./types";

/** Une candidature, sur une offre ou spontanée. */
export type AnyApplication = Application | SpontaneousItem;


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
  AWAY: "Absent (réponse automatique)",
};
export const mailLabel = (m: ApplicationMail) => (m.kind === "INTERVIEW" && m.detail ? m.detail : MAIL_LABEL[m.kind]);

export const isJob = (a: AnyApplication): a is Application => "title" in a;
export const companyOf = (a: AnyApplication) => (isJob(a) ? (a.company ?? "Entreprise non précisée") : a.company);
export const sentAt = (a: AnyApplication) => (isJob(a) ? a.appliedAt : a.sentAt);
export const activeMails = (a: AnyApplication) => a.mails.filter((m) => !m.dismissed);
export const lastMail = (a: AnyApplication) => activeMails(a).at(-1) ?? null;
export const toReview = (a: AnyApplication) => activeMails(a).filter((m) => m.needsReview);
export const daysSince = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null);
/** Dernière nouvelle : le plus récent entre l'envoi, la relance et le dernier mail reçu. */
export const lastActivity = (a: AnyApplication) =>
  [sentAt(a), isJob(a) ? null : a.followedUpAt, lastMail(a)?.receivedAt ?? null]
    .filter((d): d is string => !!d)
    .reduce<string | null>((x, d) => (!x || new Date(d) > new Date(x) ? d : x), null);
/** Absent (message d'absence) et pas encore rentré : jour du retour, sinon null. */
export const awayUntil = (a: AnyApplication): string | null => {
  if (a.stage !== "SENT") return null;
  const m = activeMails(a).findLast((x) => x.kind === "AWAY");
  return m?.detail && new Date(m.detail).getTime() > Date.now() ? m.detail : null;
};
/** Spontanée relancée et toujours sans réponse : statut à part (« Relancée »). */
export const isFollowedUp = (a: AnyApplication) => !isJob(a) && a.stage === "SENT" && !!a.followedUpAt;
const shortDay = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
export const stageLabel = (a: AnyApplication) =>
  awayUntil(a) ? `Absent → ${shortDay(awayUntil(a)!)}` : isFollowedUp(a) ? "Relancée" : isJob(a) && a.noAnswer ? "Sans réponse" : STAGE_LABEL[a.stage];
export const stageClass = (a: AnyApplication) =>
  awayUntil(a) ? "s-AWAY" : isFollowedUp(a) ? "s-FOLLOWED" : isJob(a) && a.noAnswer ? "s-NOANSWER" : `s-${a.stage}`;
/** Spontanée envoyée il y a 7 jours ou plus, sans aucune réponse, jamais relancée : onglet « À relancer ». */
// Même règle que le serveur (followUpDue) : 7 jours sans réponse, et après le retour d'une absence.
export const toFollowUp = (a: AnyApplication) => !isJob(a) && a.stage === "SENT" && !a.noOpeningAt && !a.appliedOnSiteAt && followUpDue(a, a.mails);
export const careerUrl = (a: AnyApplication) => activeMails(a).findLast((m) => m.kind === "CAREER_SITE")?.detail ?? null;
