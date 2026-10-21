import type { CvMaster, CvOverrides, JobStatus, Profile, RemoteType, TemplateId } from "@job-radar/shared";

export type { CvMaster, CvOverrides, TemplateId };

export type { JobStatus, Profile, RemoteType };

/** Infos corrigées à la main : un champ absent garde la valeur de la source. */
export type JobEdits = Partial<{
  title: string;
  company: string;
  city: string;
  department: string;
  contractType: string;
  remoteType: RemoteType;
  salaryMin: number;
  salaryMax: number;
  experienceMinYrs: number;
}>;

export type Breakdown = {
  technical: number;
  experience: number;
  contract: number;
  salary: number;
  location: number;
  transport: number;
};

export type JobSummary = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  department: string | null;
  zone: "local" | "remote" | "unknown";
  contractType: string | null;
  /** années d'expérience minimum demandées (null = non précisé) */
  experienceMinYrs: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryText: string | null;
  remoteType: RemoteType;
  publishedAt: string | null;
  firstSeenAt: string;
  status: JobStatus;
  sources: Array<{ source: string; url: string }>;
  score: { final: number; breakdown: Breakdown; hidden: boolean; hiddenReason: string | null };
  matchedSkills: string[];
  missingSkills: string[];
  preferredSkills: string[];
  /** La source ne donne qu'un extrait (Adzuna, Jooble) : score approximatif, pas vérifié par l'IA. */
  abridged: boolean;
  /** Avis de l'IA locale ; `before` = score avant correction quand l'IA l'a baissé. */
  ai: { adequation: "forte" | "moyenne" | "faible"; avis: string; before: number | null } | null;
};

/** Vérification automatique des meilleures offres affichées. */
export type AutoCheckStatus = { enabled: boolean; threshold: number; pending: string[]; offline: boolean; message: string | null };

export type JobDetail = JobSummary & {
  description: string;
  experienceText: string | null;
  /** Adresse du lieu de travail (trajet calculé jusqu'à elle). */
  address: string | null;
  travelMinutes: number | null;
  /** « car » (voiture depuis le domicile) ou « transit » (transports depuis la gare d'arrivée). */
  travelMode: "car" | "transit" | null;
  reasons: string[];
  warnings: string[];
  rulesVersion: string;
  /** Pourquoi le trajet n'a pas pu être calculé (null si calculé ou sans objet). */
  travelIssue?: string | null;
  /** Trajet encore en calcul à l'ouverture : la page le redemande un peu plus tard. */
  travelPending?: boolean;
  /** Date où l'annonce complète a été collée. */
  fullTextAt: string | null;
  /** Corrections saisies à la main (priment sur la source). */
  userEditsAt: string | null;
  userEdits: JobEdits | null;
  /** Comment le score final est obtenu (moyenne, puis plafonds). */
  /** base : note technique ; adjust : bonus/malus en points ; cap : plafond ; total : score final. */
  scoreSteps: Array<{ kind: "base" | "adjust" | "cap" | "total"; label: string; value: number }>;
  /** Critère Technique calculé sur les compétences lues par l'IA. */
  aiSkills: boolean;
  /** Candidatures déjà envoyées pour la même offre vue sur un autre site. */
  appliedTwins: Array<{ id: string; title: string; company: string | null; city: string | null; appliedAt: string; sources: string[] }>;
} & ApplyInfoFields;

export type HomeLocation = { label: string; lat: number; lng: number };

export type ProfileRecord = { profile: Profile; home: HomeLocation | null; updatedAt: string };

export type SourceStatus = {
  source: string;
  enabled: boolean;
  intervalMinutes: number;
  failures: number;
  lastSuccessAt: string | null;
  nextRunAt: string;
  lastStatus: string | null;
  lastError: string | null;
};

/** Avancement d'une source dans la collecte en cours. */
export type SourceProgress = {
  source: string;
  state: "pending" | "running" | "done";
  done: number;
  total: number;
  found: number;
  status: string | null;
};

export type CollectionStatus = {
  running: boolean;
  step: string | null;
  /** Sources des collectes en cours (bouton « Actualiser » et file JobScraper), vide sinon. */
  progress: SourceProgress[];
  /** Toutes les sources sont passées : descriptions, IA et notifications en cours. */
  finishing: boolean;
  lastRun: {
    id: string;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    fetched: number;
    created: number;
    duplicates: number;
  } | null;
  sources: SourceStatus[];
  newJobs: number;
};

export type NotificationSettings = {
  emailEnabled: boolean;
  pushEnabled: boolean;
  emailTo: string | null;
  emailConfigured: boolean;
  pushConfigured: boolean;
  vapidPublicKey: string | null;
  subscriptions: number;
};

export type SourceItem = {
  source: string;
  label: string;
  /** Sources à quota limité (Jooble) : appels utilisés / limite. */
  quota?: { used: number; limit: number } | null;
  enabled: boolean;
  intervalMinutes: number;
  minIntervalMinutes: number;
  configured: boolean;
  failures: number;
  lastSuccessAt: string | null;
  nextRunAt: string;
  lastStatus: string | null;
  lastError: string | null;
  lastRunAt: string | null;
};

export type Company = { id: string; name: string; ats: string; boardKey: string; enabled: boolean };

export type LeadStatus = "TO_CONTACT" | "CONTACTED" | "FOLLOWED_UP" | "INTERVIEW" | "NOT_INTERESTED" | "IGNORED";

export type Lead = {
  id: string;
  siret: string;
  name: string;
  officeName: string | null;
  nafLabel: string | null;
  headcountMin: number | null;
  headcountMax: number | null;
  city: string | null;
  postcode: string | null;
  department: string | null;
  hiringPotential: number | null;
  isHighPotential: boolean;
  hasEmail: boolean;
  contactEmail: string | null;
  status: LeadStatus;
  notes: string | null;
  contactedAt: string | null;
  /** Distance à vol d'oiseau depuis le lieu de recherche (null en mode départements). */
  distanceKm: number | null;
  firstSeenAt: string;
};

export type SpontaneousSettings = Profile["spontaneous"];

/** Candidature spontanée préparée pour une entreprise (lettre IA + email). */
export type SpontaneousApplicationState = {
  lead: Lead;
  title: string;
  application: {
    letter: string;
    model: string;
    edited: boolean;
    review: LetterReview | null;
    sentAt: string | null;
    sentTo: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  upToDate: boolean;
  kitReady: boolean;
  warnings: string[];
  /** raison du blocage de l'envoi (null = la lettre peut partir) */
  blocked: string | null;
  mail: { configured: boolean; from: string | null };
  cvPdf: { name: string; found: boolean };
  letterPdfName: string;
  defaults: { subject: string; message: string };
  sentAt?: string;
};

/** Candidatures spontanées préparées en lot (lettres écrites par l'IA, envoi au clic). */
export type SpontaneousBatchState = {
  batch: {
    running: boolean;
    total: number;
    done: number;
    current: string | null;
    error: string | null;
    steps: Array<{ leadId: string; name: string; status: "waiting" | "writing" | "done" | "failed" | "stopped"; error: string | null }>;
  };
  enabled: boolean;
  kitReady: boolean;
  mail: { configured: boolean; from: string | null };
  cvPdf: { name: string; found: boolean };
  toWrite: number;
  items: SpontaneousApplicationState[];
};

/** Formulaire « Ajouter une offre » (champs vides = non envoyés). */
export type ManualJobForm = {
  url?: string;
  title: string;
  company?: string;
  location?: string;
  address?: string;
  contractType?: "CDI" | "CDD" | "INTERIM" | "ALTERNANCE" | "STAGE" | "FREELANCE" | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  remoteType?: RemoteType;
  experienceYears?: number | null;
  description: string;
};

/** Annonce lue par l'IA locale : champs rangés + texte nettoyé. */
export type AiReadResult = { fields: Omit<JobTextAnalysis, "text"> & { address: string | null }; text: string; model: string; durationMs: number };

/** Ce que l'appli a lu dans une annonce collée (sans IA). null = pas trouvé avec certitude. */
export type JobTextAnalysis = {
  text: string;
  title: string | null;
  company: string | null;
  location: string | null;
  contractType: ManualJobForm["contractType"];
  remoteType: RemoteType;
  salaryMin: number | null;
  salaryMax: number | null;
  experienceYears: number | null;
  skills: string[];
};

/** Analyse d'une offre par l'IA locale (Ollama). */
export type AiAnalysis = {
  resume: string;
  missions: string[];
  competences_obligatoires: string[];
  competences_bonus: string[];
  niveau: "junior" | "confirme" | "senior" | "inconnu";
  experience_min_ans: number | null;
  employeur: "direct" | "esn_ou_cabinet" | "inconnu";
  points_attention: string[];
  /** Absents des analyses d'avant le 13/10/2026. */
  exigees_en_entreprise?: string[];
  exigees_en_projets?: string[];
  exigees_manquantes?: string[];
  adequation: "forte" | "moyenne" | "faible";
  avis: string;
};
export type StoredAiAnalysis = { inputHash: string; model: string; result: AiAnalysis; createdAt: string };
export type AiStatus = { available: boolean; model: string | null; installed?: boolean; message?: string };

/** Une petite histoire vraie : l'IA en choisit 2 ou 3 par lettre. */
export type LetterBlock = { title: string; text: string; useFor: string };
/** CV, blocs et en-tête des lettres de motivation (privé). */
export type LetterKit = {
  header: string;
  city: string;
  signature: string;
  cvText: string;
  blocks: LetterBlock[];
  rules: string;
  mastered: string;
  bannedWords: string;
  pdfName: string;
};
/** Relecture automatique d'une lettre avant envoi (null = pas encore relue). */
export type LetterReview = {
  hash: string;
  problems: Array<{ kind: "sujet" | "fragment" | "repetition" | "faute" | "fait"; excerpt: string; detail: string }>;
  errors: string[];
  validated: boolean;
  at: string;
};
export type StoredLetter = { inputHash: string; model: string; content: string; edited: boolean; review: LetterReview | null; createdAt: string; updatedAt: string };
export type LetterState = {
  letter: StoredLetter | null;
  upToDate: boolean;
  kitReady: boolean;
  warnings: string[];
  /** raison du blocage du PDF (null = la lettre peut partir) */
  blocked: string | null;
  cached?: boolean;
  durationMs?: number;
};

/** Offre où tu as postulé (page « Candidatures »). */
export type ApplicationStage = "SENT" | "ACK" | "INTERVIEW" | "OFFER" | "REJECTED" | "CAREER_SITE";

/** Mail reçu reconnu comme une étape de candidature. */
export type ApplicationMail = {
  id: string;
  /** AWAY : message d'absence (pas une réponse) ; `detail` = jour où relancer (AAAA-MM-JJ) */
  kind: "ACK" | "INTERVIEW" | "OFFER" | "REJECTION" | "CAREER_SITE" | "AWAY";
  detail: string | null;
  /** ce que dit le mail, en une phrase (IA) */
  summary: string | null;
  /** l'IA a hésité : à confirmer */
  needsReview: boolean;
  subject: string;
  from: string;
  /** ouvre le mail dans Gmail */
  url: string;
  receivedAt: string;
  dismissed: boolean;
};

/** Infos obligatoires d'une candidature (contractType : seulement si l'offre ne le dit pas). */
export type ApplyInfo = {
  channel: "mail" | "formulaire" | "linkedin" | "autre";
  cv: "classique" | "ats";
  contractType?: "CDI" | "CDD" | "INTERIM" | "ALTERNANCE" | "STAGE" | "FREELANCE";
};
/** Canal et CV enregistrés (null = pas encore renseigné, candidature d'avant la règle). */
export type ApplyInfoFields = { applyChannel: ApplyInfo["channel"] | null; applyCv: ApplyInfo["cv"] | null };

/** Candidature sur une offre. */
export type Application = JobSummary & ApplyInfoFields & {
  appliedAt: string | null;
  stage: ApplicationStage;
  /** aucune nouvelle depuis 21 jours : considérée refusée */
  noAnswer?: boolean;
  mails: ApplicationMail[];
  /** CV adaptés exportés (ceux envoyés si l'offre a été marquée « Postulé » après l'export). */
  cvs?: Array<{ template: TemplateId; exportedAt: string | null; sentAt: string | null }>;
};

/** Candidature spontanée envoyée depuis « Entreprises ». */
export type SpontaneousItem = {
  id: string;
  leadId: string;
  company: string;
  city: string | null;
  department: string | null;
  sentAt: string;
  sentTo: string | null;
  /** « J'ai postulé sur leur site » (après un renvoi vers leur site carrière). */
  appliedOnSiteAt: string | null;
  /** « Rien à postuler sur leur site » : candidature close. */
  noOpeningAt: string | null;
  /** relance envoyée (dans le même fil) */
  followedUpAt: string | null;
  stage: ApplicationStage;
  mails: ApplicationMail[];
};

export type MailTracking = { configured: boolean; running: boolean; lastCheckAt: string | null; lastError: string | null };

// ───── CV adapté à l'offre ─────

export type CvMasterState = { master: CvMaster | null; updatedAt: string | null; toValidate: number; issues: Array<{ path: string; message: string }> };
export type CvTemplateInfo = { id: TemplateId; label: string; role: "ats" | "email" };
export type CvReason = { skillId: string; points: number };
export type CvPicked = {
  kind: "bullet" | "project" | "skill" | "title" | "summary" | "hobbies";
  id: string;
  label: string;
  score: number;
  reasons: CvReason[];
  parent?: string;
  rule?: "always" | "ifRelevant";
  level?: "pro" | "projet" | "cours";
  fill?: boolean;
  why?: string;
};
export type CvCheck = { id: number; label: string; ok: boolean | null; details: string[] };
export type TailoredCvDraft = {
  rulesVersion: string;
  template: TemplateId;
  picked: CvPicked[];
  dropped: CvPicked[];
  substitutions: Array<{ blockId: string; from: string; to: string }>;
  missing: { absent: string[]; onlyCourse: string[]; forbidden: string[] };
  /** Intitulé de l'offre repris comme titre (absent des CV adaptés avant cette règle). */
  offerTitle?: string | null;
  /** Compétences de ton profil ajoutées à la liste du CV (citées par l'offre, absentes du CV complet). */
  fromProfile?: string[];
  /** Compétences de l'offre retrouvées dans le texte du CV. */
  match?: { offer: string[]; found: string[]; missing: string[]; notShown: string[]; percent: number };
  warnings: string[];
  checks: CvCheck[];
  sections: { experiences: Array<{ id: string; role: string; bullets: Array<{ id: string; text: string }> }>; projects: Array<{ id: string; name: string }> };
};
export type TailoredCv = {
  jobId: string;
  template: TemplateId;
  draft: TailoredCvDraft;
  overrides: CvOverrides;
  status: "DRAFT" | "VALIDATED" | "EXPORTED";
  pdfPath: string | null;
  exportedAt: string | null;
  sentAt: string | null;
  updatedAt: string;
};
export type CvState = { cv: TailoredCv | null; stale: boolean; staleReasons: string[]; rulesVersion: string; pdfAvailable: boolean };
export type CvPdfResult = {
  /** pdf : contenu en base64, téléchargé par le navigateur. */
  results: Array<{ template: TemplateId; ok: boolean; fileName: string | null; pdf: string | null; checks: CvCheck[]; warnings: string[] }>;
};

/** Compétences demandées dans toutes les offres collectées (page Statistiques). */
export type SkillStats = {
  offers: number;
  since: string | null;
  recentOffers: number;
  previousOffers: number;
  /** Part des offres (%) où tu as tous les langages et frameworks demandés. */
  fullMatch: number;
  skills: Array<{ label: string; offers: number; share: number; owned: boolean; core: boolean; trend: number | null; accessible: number | null }>;
  unlock: Array<{ label: string; offers: number }>;
  experience: { max: number; known: number; accessible: number; ranges: Array<{ label: string; offers: number; share: number }> };
  together: Array<{ label: string; offers: number; with: Array<{ label: string; share: number }> }>;
  sources: Array<{ source: string; offers: number; good: number }>;
};
