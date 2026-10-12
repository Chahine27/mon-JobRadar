export type Channel = "email" | "webpush";

/**
 * complete = bon score provisoire sur une annonce incomplète : à compléter avant de juger.
 * apply = annonce complète et bon score : à postuler.
 */
export type AlertKind = "apply" | "complete";

/** Ce qu'on annonce pour une offre compatible. */
export type JobAlert = {
  kind: AlertKind;
  jobId: string;
  title: string;
  company: string | null;
  place: string | null;
  score: number;
  contract: string | null;
  salary: string | null;
  remote: string | null;
  skills: string[];
  missing: string[];
  /** Lien vers la page détail dans Job Radar. */
  url: string;
};

/** Information ponctuelle (hors offre compatible) : titre, texte et lien absolu. */
export type Notice = { title: string; body: string; url: string; tag: string };

export interface Notifier {
  readonly channel: Channel;
  /** false = identifiants absents du .env → canal ignoré sans erreur. */
  isConfigured(): boolean;
  sendAlerts(alerts: JobAlert[]): Promise<void>;
  /** Information ponctuelle : seulement les canaux qui savent l'afficher (notification du navigateur). */
  sendNotice?(notice: Notice): Promise<void>;
  sendTest(): Promise<void>;
}
