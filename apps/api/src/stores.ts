import type { TailoredCvDraft } from "@job-radar/cv-tailor";
import type { CvMaster, CvOverrides, JobStatus, LetterKit, Profile, RemoteType, TemplateId } from "@job-radar/shared";

/**
 * Accès aux données dont l'API a besoin.
 * Interfaces séparées de Prisma → tests rapides sans base (voir test-helpers.ts).
 */

export type UserRecord = { id: string; email: string; passwordHash: string };

export type HomeLocation = { label: string; lat: number; lng: number };

export type ProfileRecord = {
  profile: Profile;
  home: HomeLocation | null;
  updatedAt: Date;
};

export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

export interface SessionStore {
  create(input: { id: string; userId: string; expiresAt: Date }): Promise<void>;
  find(id: string): Promise<{ userId: string; expiresAt: Date } | null>;
  delete(id: string): Promise<void>;
}

export interface ProfileStore {
  get(userId: string): Promise<ProfileRecord | null>;
  save(userId: string, profile: Profile, home: HomeLocation | null | undefined): Promise<ProfileRecord>;
}

/** Offre telle que lue en base. Salaires = annuel brut en euros (convention de la normalisation). */
export type JobRow = {
  id: string;
  contentHash: string;
  title: string;
  company: string | null;
  description: string;
  contractType: string | null;
  experienceText: string | null;
  experienceMinYrs: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryText: string | null;
  city: string | null;
  postalCode: string | null;
  department: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Adresse du lieu de travail, si connue (trajet calculé jusqu'à elle). */
  address: string | null;
  remoteType: RemoteType;
  technologies: string[];
  publishedAt: Date | null;
  firstSeenAt: Date;
  status: JobStatus;
  travelMinutes: number | null;
  /** « car » : voiture depuis le domicile ; « transit » : transports depuis la gare d'arrivée. */
  travelMode: string | null;
  sources: Array<{ source: string; url: string }>;
  /** Date où l'annonce complète a été collée (la description est alors l'annonce complète). */
  fullTextAt: Date | null;
  /** Corrections saisies à la main (déjà appliquées aux champs ci-dessus). */
  userEdits?: JobEdits | null;
  userEditsAt?: Date | null;
};

export interface JobStore {
  /** `statuses` : seulement ces statuts, filtrés en base (le flux ne relit plus les expirées, ignorées…). */
  list(statuses?: JobStatus[]): Promise<JobRow[]>;
  get(id: string): Promise<JobRow | null>;
  /** Change le statut et garde une trace dans l'historique. null si l'offre n'existe pas. */
  setStatus(id: string, status: JobStatus): Promise<JobRow | null>;
  /** Date de candidature de chaque offre (premier passage au statut « Postulé »). */
  appliedDates(): Promise<Map<string, Date>>;
  /** Offre ajoutée à la main (formulaire déjà validé). null si le formulaire est illisible. */
  addManual(input: unknown): Promise<ManualSaveResult | null>;
  removeManual(id: string): Promise<"deleted" | "unlinked" | "not_found" | "not_manual">;
  /** Annonce complète collée à la main (null = on revient à l'extrait de la source). null si l'offre n'existe pas. */
  setFullText(id: string, full: { text: string; experienceYears: number | null; info?: FullTextInfo | null } | null): Promise<JobRow | null>;
  /** Corrections saisies à la main (null = on revient aux infos de la source). null si l'offre n'existe pas. */
  setEdits(id: string, edits: JobEdits | null): Promise<JobRow | null>;
}

/** Infos corrigées à la main : un champ absent garde la valeur de la source. */
export type JobEdits = {
  title?: string;
  company?: string;
  city?: string;
  department?: string;
  contractType?: string;
  remoteType?: RemoteType;
  salaryMin?: number;
  salaryMax?: number;
  experienceMinYrs?: number;
};

/** « 3 ans minimum », « débutant accepté ». */
export const yearsText = (n: number) => (n === 0 ? "débutant accepté" : `${n} an${n > 1 ? "s" : ""} minimum`);

/** Applique les corrections à la main sur l'offre lue (score et IA recalculés grâce au contentHash). */
export function applyEdits(row: JobRow, edits: JobEdits, at: Date) {
  Object.assign(row, edits);
  if (edits.salaryMin !== undefined && edits.salaryMax === undefined) row.salaryMax = edits.salaryMin;
  if (edits.experienceMinYrs !== undefined) {
    row.experienceText = yearsText(edits.experienceMinYrs);
  }
  row.contentHash = `${row.contentHash}:edit${at.getTime()}`;
  row.userEdits = edits;
  row.userEditsAt = at;
}

/** Infos lues par l'IA dans l'annonce complète : complètent ce que la source ne donne pas. */
export type FullTextInfo = {
  contractType?: string | null;
  remoteType?: RemoteType | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
};

export type ManualSaveResult = { jobId: string; duplicate: boolean; otherSources: string[] };

export type NotificationSettingsRecord = { emailEnabled: boolean; pushEnabled: boolean; emailTo: string | null };

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export type NotificationLogRow = {
  id: string;
  jobId: string;
  jobTitle: string | null;
  channel: string;
  status: string;
  error: string | null;
  createdAt: Date;
};

export interface NotificationStore {
  getSettings(): Promise<NotificationSettingsRecord>;
  saveSettings(s: NotificationSettingsRecord): Promise<NotificationSettingsRecord>;
  subscribe(userId: string, sub: PushSubscriptionInput): Promise<void>;
  unsubscribe(endpoint: string): Promise<void>;
  countSubscriptions(): Promise<number>;
  recent(limit: number): Promise<NotificationLogRow[]>;
}

export type SourceRow = {
  source: string;
  enabled: boolean;
  intervalMinutes: number;
  failures: number;
  lastSuccessAt: Date | null;
  nextRunAt: Date;
  lastStatus: string | null;
  lastError: string | null;
  /** Fin de la dernière collecte de la source, réussie ou non (page Réglages : relance terminée ?). */
  lastRunAt: Date | null;
};

export interface SourceStore {
  list(): Promise<SourceRow[]>;
  update(source: string, data: { enabled: boolean; intervalMinutes: number }): Promise<SourceRow | null>;
}

export type CompanyRow = { id: string; name: string; ats: string; boardKey: string; enabled: boolean };

export interface CompanyStore {
  list(): Promise<CompanyRow[]>;
  /** null si (outil, identifiant) existe déjà. */
  add(data: Omit<CompanyRow, "id" | "enabled">): Promise<CompanyRow | null>;
  setEnabled(id: string, enabled: boolean): Promise<CompanyRow | null>;
  remove(id: string): Promise<boolean>;
}

export const LEAD_STATUSES = ["TO_CONTACT", "CONTACTED", "FOLLOWED_UP", "INTERVIEW", "NOT_INTERESTED", "IGNORED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type LeadRow = {
  id: string;
  siret: string;
  name: string;
  officeName: string | null;
  naf: string | null;
  nafLabel: string | null;
  headcountMin: number | null;
  headcountMax: number | null;
  city: string | null;
  postcode: string | null;
  department: string | null;
  latitude: number | null;
  longitude: number | null;
  hiringPotential: number | null;
  isHighPotential: boolean;
  hasEmail: boolean;
  /** Email de contact collé à la main. */
  contactEmail: string | null;
  status: LeadStatus;
  notes: string | null;
  contactedAt: Date | null;
  travelMinutes: number | null;
  travelOriginKey: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type LeadInput = Omit<LeadRow, "id" | "status" | "notes" | "contactEmail" | "contactedAt" | "travelMinutes" | "travelOriginKey" | "firstSeenAt" | "lastSeenAt">;

export interface LeadStore {
  list(): Promise<LeadRow[]>;
  /** Ajoute ou met à jour (sans toucher au suivi : statut, notes). Renvoie le nombre de nouvelles entreprises. */
  upsertMany(leads: LeadInput[], now: Date): Promise<{ created: number; updated: number }>;
  update(id: string, data: { status?: LeadStatus; notes?: string | null; contactEmail?: string | null }): Promise<LeadRow | null>;
  get(id: string): Promise<LeadRow | null>;
  setTravel(id: string, minutes: number | null, originKey: string): Promise<void>;
  lastRefreshAt(): Promise<Date | null>;
}

/** Analyse IA d'une offre, gardée en base (table JobAnalysis). */
export type StoredAnalysis = { inputHash: string; model: string; result: unknown; createdAt: Date };

export interface AnalysisStore {
  latest(jobId: string): Promise<StoredAnalysis | null>;
  /** Dernière analyse de chaque offre (pour corriger les scores de la liste). */
  latestAll(): Promise<Map<string, StoredAnalysis>>;
  save(jobId: string, a: { inputHash: string; model: string; result: unknown; lists: { required: string[]; bonus: string[]; risks: string[]; summary: string } }): Promise<StoredAnalysis>;
}

export interface LetterKitStore {
  get(userId: string): Promise<LetterKit | null>;
  save(userId: string, kit: LetterKit): Promise<LetterKit>;
}

export type StoredLetter = { inputHash: string; model: string; content: string; edited: boolean; createdAt: Date; updatedAt: Date };

export interface CoverLetterStore {
  get(jobId: string): Promise<StoredLetter | null>;
  /** Nouvelle lettre de l'IA (remplace l'ancienne). */
  save(jobId: string, l: { inputHash: string; model: string; content: string }): Promise<StoredLetter>;
  /** Modification à la main. null si pas de lettre pour cette offre. */
  edit(jobId: string, content: string): Promise<StoredLetter | null>;
}

/** Candidature spontanée préparée pour une entreprise. */
export type StoredApplication = {
  inputHash: string;
  model: string;
  letter: string;
  edited: boolean;
  sentAt: Date | null;
  sentTo: string | null;
  /** Message-ID du mail envoyé (la relance répond dans ce fil) */
  messageId: string | null;
  followedUpAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ApplicationStore {
  get(leadId: string): Promise<StoredApplication | null>;
  /** Nouvelle lettre de l'IA (remplace l'ancienne, garde la trace d'un envoi). */
  save(leadId: string, a: { inputHash: string; model: string; letter: string }): Promise<StoredApplication>;
  edit(leadId: string, letter: string): Promise<StoredApplication | null>;
  markSent(leadId: string, to: string, at: Date, messageId?: string | null): Promise<void>;
  /** Candidatures spontanées envoyées (onglet « Spontanées » de la page Candidatures). */
  listSent(): Promise<SentApplication[]>;
  /**
   * Après un renvoi vers leur site : « applied » (j'y ai postulé), « none » (rien à y postuler : close), null = annuler.
   * false si la candidature n'existe pas.
   */
  setSiteOutcome(id: string, outcome: SiteOutcome | null, at: Date): Promise<boolean>;
  /** Relance envoyée. */
  markFollowedUp(leadId: string, at: Date): Promise<void>;
}

export type SiteOutcome = "applied" | "none";
export type SentApplication = {
  id: string;
  leadId: string;
  sentAt: Date;
  sentTo: string | null;
  appliedOnSiteAt: Date | null;
  noOpeningAt: Date | null;
  /** relance envoyée */
  followedUpAt: Date | null;
};

export type ApplicationMailRow = {
  id: string;
  jobId: string | null;
  spontaneousId: string | null;
  kind: string;
  detail: string | null;
  /** ce que dit le mail, en une phrase (IA) */
  summary: string | null;
  /** l'IA a hésité : à confirmer */
  needsReview: boolean;
  subject: string;
  fromAddress: string;
  messageId: string;
  receivedAt: Date;
  dismissed: boolean;
};

/** Mails reconnus comme étapes de candidature (écrits par le suivi des mails, lus par la page Candidatures). */
export interface ApplicationMailStore {
  list(): Promise<ApplicationMailRow[]>;
  /** « Ce mail ne concerne pas cette candidature » : il ne compte plus. */
  dismiss(id: string): Promise<ApplicationMailRow | null>;
  /** « Oui, c'est bien ça » : le mail n'est plus à vérifier. */
  confirm(id: string): Promise<ApplicationMailRow | null>;
}

/** CV complet (table CvMaster). */
export type CvMasterRecord = { master: CvMaster; contentHash: string; updatedAt: Date };

export interface CvMasterStore {
  get(userId: string): Promise<CvMasterRecord | null>;
  /** Le CV est déjà validé (CvMasterSchema) ; l'empreinte est calculée par l'appelant. */
  save(userId: string, master: CvMaster, contentHash: string): Promise<CvMasterRecord>;
}

export type TailoredCvStatus = "DRAFT" | "VALIDATED" | "EXPORTED";

/** CV adapté à une offre, un par modèle (table TailoredCv). */
export type TailoredCvRow = {
  jobId: string;
  template: TemplateId;
  draft: TailoredCvDraft;
  overrides: CvOverrides;
  rulesVersion: string;
  masterHash: string;
  jobHash: string;
  status: TailoredCvStatus;
  pdfPath: string | null;
  exportedAt: Date | null;
  sentAt: Date | null;
  updatedAt: Date;
};

export interface TailoredCvStore {
  get(jobId: string, template: TemplateId): Promise<TailoredCvRow | null>;
  /** Nouveau brouillon (ou brouillon recalculé) : remplace le précédent, garde le PDF déjà exporté. */
  save(row: Pick<TailoredCvRow, "jobId" | "template" | "draft" | "overrides" | "rulesVersion" | "masterHash" | "jobHash" | "status">): Promise<TailoredCvRow>;
  markExported(jobId: string, template: TemplateId, pdfPath: string, at: Date): Promise<void>;
  /** Offre marquée « Postulé » : les CV exportés de l'offre sont ceux envoyés. */
  markSent(jobId: string, at: Date): Promise<void>;
  /** CV exportés, par offre (page Candidatures). */
  exported(): Promise<Array<Pick<TailoredCvRow, "jobId" | "template" | "exportedAt" | "sentAt">>>;
}

export type Stores = {
  cvMasters: CvMasterStore;
  tailoredCvs: TailoredCvStore;
  applications: ApplicationStore;
  applicationMails: ApplicationMailStore;
  analyses: AnalysisStore;
  letterKits: LetterKitStore;
  letters: CoverLetterStore;
  leads: LeadStore;
  sources: SourceStore;
  companies: CompanyStore;
  notifications: NotificationStore;
  users: UserStore;
  sessions: SessionStore;
  profiles: ProfileStore;
  jobs: JobStore;
};
