import type { ApplyInfo, CvMaster, CvMasterState, CvOverrides, CvPdfResult, CvState, CvTemplateInfo, TemplateId, SpontaneousApplicationState, SpontaneousBatchState, AiReadResult, Application, ApplicationMail, MailTracking, SpontaneousItem, AiStatus, AutoCheckStatus, LetterKit, LetterState, StoredAiAnalysis, JobTextAnalysis, ManualJobForm, CollectionStatus, Company, Lead, LeadStatus, SpontaneousSettings, NotificationSettings, SourceItem, JobDetail, JobEdits, JobStatus, JobSummary, Profile, SkillStats, HomeLocation, ProfileRecord } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public issues: Array<{ path: string; message: string }> = [],
  ) {
    super(code);
  }
}

/** Message d'erreur lisible : celui du serveur, sinon le texte par défaut. */
export const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith("/auth/login")) onUnauthorized();
    const err = new ApiError(res.status, data.error ?? "ERREUR", data.issues ?? []);
    if (typeof data.message === "string") err.message = data.message;
    throw err;
  }
  return data as T;
}

/** Fait télécharger un fichier par le navigateur (dossier Téléchargements). */
export function downloadFile(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Nom du fichier donné par le serveur (Content-Disposition: …; filename*=UTF-8''…). */
const fileNameOf = (res: Response, fallback: string) => {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get("content-disposition") ?? "");
  return m ? decodeURIComponent(m[1]!) : fallback;
};

/** Requête dont la réponse est un fichier : téléchargé par le navigateur, renvoie son nom. */
async function download(method: string, url: string, body: unknown, fallback: string): Promise<string> {
  const res = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) onUnauthorized();
    const err = new ApiError(res.status, data.error ?? "ERREUR");
    if (typeof data.message === "string") err.message = data.message;
    throw err;
  }
  const name = fileNameOf(res, fallback);
  downloadFile(await res.blob(), name);
  return name;
}

/** CV PDF envoyé tel quel (corps binaire), gardé par le serveur pour les candidatures spontanées. */
async function uploadPdf(url: string, file: File): Promise<{ cvPdfName: string }> {
  const res = await fetch(`${url}?name=${encodeURIComponent(file.name)}`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/pdf" }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    const err = new ApiError(res.status, data.error ?? "ERREUR");
    err.message = typeof data.message === "string" ? data.message : res.status === 413 ? "PDF trop lourd (5 Mo au plus)." : "Envoi du PDF impossible.";
    throw err;
  }
  return data;
}

export type JobQuery = {
  minScore?: number;
  status?: JobStatus | "active" | "all" | "try";
  includeHidden?: boolean;
  q?: string;
  sort?: "score" | "date" | "chances";
  /** Une seule source (vide = toutes). */
  source?: string;
  /** Rubrique du flux : dans ta zone, full remote, lieu non précisé. */
  zone?: "" | "local" | "remote" | "unknown"; // "" = toutes les rubriques
  /** Un seul type de contrat (CDI, CDD…, « unknown » = non précisé ; vide = tous). */
  contract?: string;
  limit?: number;
  offset?: number;
};

/** Relance groupée en cours : une étape par entreprise. */
export type FollowUpBatch = {
  running: boolean;
  total: number;
  done: number;
  remaining: number;
  steps: Array<{ leadId: string; name: string; status: "waiting" | "sending" | "sent" | "failed"; message: string | null }>;
};

export const api = {
  login: (email: string, password: string) =>
    request<{ user: { email: string } }>("POST", "/api/auth/login", { email, password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  me: () => request<{ user: { email: string } }>("GET", "/api/auth/me"),

  getProfile: () => request<ProfileRecord>("GET", "/api/profile"),
  saveProfile: (profile: Profile, home?: HomeLocation | null) =>
    request<ProfileRecord>("PUT", "/api/profile", home === undefined ? { profile } : { profile, home }),

  listJobs(query: JobQuery = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    return request<{ items: JobSummary[]; total: number; offset: number; limit: number }>("GET", `/api/jobs?${params}`);
  },
  jobStats: (days: number | null) => request<SkillStats>("GET", `/api/jobs/stats${days ? `?days=${days}` : ""}`),
  getJob: (id: string) => request<JobDetail>("GET", `/api/jobs/${encodeURIComponent(id)}`),
  refresh: () => request<{ status: "started" | "already_running"; runId: string }>("POST", "/api/jobs/refresh"),
  collectionStatus: () => request<CollectionStatus>("GET", "/api/collection/status"),
  geocode: (q: string) =>
    request<{ items: Array<{ label: string; lat: number; lng: number; precision: string }> }>(
      "GET",
      `/api/geocode?q=${encodeURIComponent(q)}`,
    ),
  listLeads: (status: LeadStatus | "active" | "all", sort: "potential" | "distance", offset = 0, limit = 20, email: "any" | "hint" | "missing" | "noted" | "set" = "any", q = "") =>
    request<{ items: Lead[]; total: number; lastRefreshAt: string | null; configured: boolean }>(
      "GET",
      `/api/leads?status=${status}&sort=${sort}&email=${email}&q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`,
    ),
  getLeadSettings: () => request<SpontaneousSettings>("GET", "/api/leads/settings"),
  /** Signale la page ouverte et visible : pas de notification pour une lettre terminée ici. */
  presence: (path: string) => request<void>("POST", "/api/presence", { path }),
  saveLeadFilters: (f: SpontaneousSettings["filters"]) => request<SpontaneousSettings["filters"]>("PUT", "/api/leads/filters", f),
  saveLeadSettings: (s: SpontaneousSettings) => request<SpontaneousSettings>("PUT", "/api/leads/settings", s),
  refreshLeads: () =>
    request<{ found: number; created: number; updated: number; around: string }>("POST", "/api/leads/refresh"),
  updateLead: (id: string, data: { status?: LeadStatus; notes?: string | null; contactEmail?: string | null }) =>
    request<Lead>("PATCH", `/api/leads/${encodeURIComponent(id)}`, data),
  importLeadEmails: (items: Array<{ siret: string; email: string | null; source: string | null; site: string | null; contactUrl: string | null }>, overwrite: boolean) =>
    request<{ updated: number; notFound: number; unknown: number; invalid: number; kept: number; linksOnly: number; leads: Lead[] }>("POST", "/api/leads/emails", { items, overwrite }),
  getApplication: (id: string, title?: string) =>
    request<SpontaneousApplicationState>(
      "GET",
      `/api/leads/${encodeURIComponent(id)}/application${title ? `?title=${encodeURIComponent(title)}` : ""}`,
    ),
  writeApplicationLetter: (id: string, title: string) =>
    request<SpontaneousApplicationState>("POST", `/api/leads/${encodeURIComponent(id)}/application/letter`, { title }),
  editApplicationLetter: (id: string, content: string) =>
    request<SpontaneousApplicationState>("PUT", `/api/leads/${encodeURIComponent(id)}/application`, { content }),
  reviewApplicationLetter: (id: string) => request<SpontaneousApplicationState>("POST", `/api/leads/${encodeURIComponent(id)}/application/review`),
  validateApplicationReview: (id: string) =>
    request<SpontaneousApplicationState>("POST", `/api/leads/${encodeURIComponent(id)}/application/review/validate`),
  getApplicationBatch: () => request<SpontaneousBatchState>("GET", "/api/leads/applications/batch"),
  prepareApplicationBatch: () => request<Pick<SpontaneousBatchState, "batch">>("POST", "/api/leads/applications/batch"),
  sendApplication: (id: string, data: { to: string; subject: string; message: string; letter: string; force?: boolean }) =>
    request<SpontaneousApplicationState>("POST", `/api/leads/${encodeURIComponent(id)}/application/send`, data),
  listSources: () => request<{ items: SourceItem[] }>("GET", "/api/sources"),
  updateSource: (source: string, data: { enabled: boolean; intervalMinutes: number }) =>
    request<unknown>("PUT", `/api/sources/${encodeURIComponent(source)}`, data),
  refreshSource: (source: string) =>
    request<{ status: "started" | "already_running"; runId: string }>("POST", `/api/sources/${encodeURIComponent(source)}/refresh`),
  listCompanies: () => request<{ items: Company[] }>("GET", "/api/companies"),
  addCompany: (name: string, url: string) => request<Company>("POST", "/api/companies", { name, url }),
  setCompanyEnabled: (id: string, enabled: boolean) =>
    request<Company>("PATCH", `/api/companies/${encodeURIComponent(id)}`, { enabled }),
  removeCompany: (id: string) => request<{ ok: true }>("DELETE", `/api/companies/${encodeURIComponent(id)}`),
  getNotificationSettings: () => request<NotificationSettings>("GET", "/api/notifications/settings"),
  saveNotificationSettings: (s: Pick<NotificationSettings, "emailEnabled" | "pushEnabled" | "emailTo">) =>
    request<unknown>("PUT", "/api/notifications/settings", s),
  subscribePush: (sub: PushSubscriptionJSON) => request<{ ok: true }>("POST", "/api/notifications/subscribe", sub),
  unsubscribePush: (endpoint: string) => request<{ ok: true }>("POST", "/api/notifications/unsubscribe", { endpoint }),
  testNotification: (channel: "email" | "webpush") =>
    request<{ ok: true }>("POST", "/api/notifications/test", { channel }),
  aiReadJob: (text: string, hints?: { title?: string | null; company?: string | null }) =>
    request<AiReadResult>("POST", "/api/jobs/manual/ai-read", { text, hints: hints ?? null }),
  analyzeJobText: (text: string) => request<JobTextAnalysis>("POST", "/api/jobs/manual/analyze", { text }),
  listApplications: () =>
    request<{ jobs: Application[]; spontaneous: SpontaneousItem[]; tracking: MailTracking }>("GET", "/api/applications"),
  checkApplicationMails: () => request<MailTracking>("POST", "/api/applications/check"),
  setSiteOutcome: (id: string, outcome: "applied" | "none" | null) =>
    request<{ ok: true }>("POST", `/api/applications/spontaneous/${encodeURIComponent(id)}/site-outcome`, { outcome }),
  dismissApplicationMail: (id: string) => request<ApplicationMail>("POST", `/api/applications/mails/${encodeURIComponent(id)}/dismiss`),
  getFollowUp: (leadId: string) =>
    request<{ to: string; subject: string; message: string; followedUpAt: string | null }>("GET", `/api/leads/${encodeURIComponent(leadId)}/application/follow-up`),
  sendFollowUp: (leadId: string, mail: { subject: string; message: string }) =>
    request<{ ok: true; followedUpAt: string }>("POST", `/api/leads/${encodeURIComponent(leadId)}/application/follow-up`, mail),
  followUpBatch: (limit = 10) => request<FollowUpBatch>("POST", "/api/applications/follow-up/batch", { limit }),
  followUpBatchStatus: () => request<FollowUpBatch>("GET", "/api/applications/follow-up/batch"),
  confirmApplicationMail: (id: string) => request<ApplicationMail>("POST", `/api/applications/mails/${encodeURIComponent(id)}/confirm`),
  listManualJobs: () => request<{ items: JobSummary[] }>("GET", "/api/jobs/manual"),
  addManualJob: (form: ManualJobForm) =>
    request<{ job: JobDetail; duplicate: boolean; otherSources: string[] }>("POST", "/api/jobs/manual", form),
  removeManualJob: (id: string) =>
    request<{ result: "deleted" | "unlinked" }>("DELETE", `/api/jobs/manual/${encodeURIComponent(id)}`),
  autoCheck: (jobIds: string[]) => request<AutoCheckStatus>("POST", "/api/ai/auto", { jobIds }),
  autoCheckStatus: () => request<AutoCheckStatus>("GET", "/api/ai/auto"),
  /** Toutes les meilleures offres du flux pas encore vérifiées par l'IA (pas seulement celles affichées). */
  autoCheckFeed: (retry = false) => request<AutoCheckStatus & { queued: number }>("POST", "/api/ai/auto/feed", { retry }),
  aiStatus: () => request<AiStatus>("GET", "/api/ai/status"),
  getJobAnalysis: (id: string) =>
    request<{ analysis: StoredAiAnalysis | null; upToDate: boolean }>("GET", `/api/jobs/${encodeURIComponent(id)}/analysis`),
  analyzeJob: (id: string, force = false) =>
    request<{ analysis: StoredAiAnalysis; upToDate: boolean; cached: boolean; durationMs?: number }>(
      "POST",
      `/api/jobs/${encodeURIComponent(id)}/analysis${force ? "?force=true" : ""}`,
    ),
  // CV complet et CV adapté à une offre
  getCvMaster: () => request<CvMasterState>("GET", "/api/cv-master"),
  saveCvMaster: (master: CvMaster) => request<CvMasterState>("PUT", "/api/cv-master", { master }),
  importCvSeed: () => request<CvMasterState>("POST", "/api/cv-master/import-seed"),
  validateCvVariant: (ref: string) => request<CvMasterState>("POST", `/api/cv-master/variants/${encodeURIComponent(ref)}/validate`),
  cvTemplates: () => request<{ templates: CvTemplateInfo[] }>("GET", "/api/cv/templates"),
  cvSkills: () => request<{ skills: Array<{ id: string; label: string }> }>("GET", "/api/cv/skills"),
  getJobCv: (id: string, template: TemplateId) => request<CvState>("GET", `/api/jobs/${encodeURIComponent(id)}/cv?template=${template}`),
  makeJobCv: (id: string, template: TemplateId) => request<CvState>("POST", `/api/jobs/${encodeURIComponent(id)}/cv`, { template }),
  saveJobCv: (id: string, template: TemplateId, overrides: CvOverrides, validated = false) =>
    request<CvState>("PUT", `/api/jobs/${encodeURIComponent(id)}/cv`, { template, overrides, validated }),
  jobCvPreviewUrl: (id: string, template: TemplateId) => `/api/jobs/${encodeURIComponent(id)}/cv/preview?template=${template}`,
  exportJobCv: (id: string, templates: TemplateId[]) => request<CvPdfResult>("POST", `/api/jobs/${encodeURIComponent(id)}/cv/pdf`, { templates }),

  getLetterKit: () => request<{ kit: LetterKit; ready: boolean; cvPdfName: string | null }>("GET", "/api/letter-kit"),
  uploadCvPdf: (file: File) => uploadPdf("/api/letter-kit/cv-pdf", file),
  deleteCvPdf: () => request<{ cvPdfName: null }>("DELETE", "/api/letter-kit/cv-pdf"),
  cvPdfUrl: "/api/letter-kit/cv-pdf",
  saveLetterKit: (kit: LetterKit) => request<{ kit: LetterKit; ready: boolean }>("PUT", "/api/letter-kit", kit),
  getLetter: (id: string) => request<LetterState>("GET", `/api/jobs/${encodeURIComponent(id)}/letter`),
  writeLetter: (id: string, force = false) =>
    request<LetterState>("POST", `/api/jobs/${encodeURIComponent(id)}/letter${force ? "?force=true" : ""}`),
  downloadLetterPdf: (id: string, content: string) => download("POST", `/api/jobs/${encodeURIComponent(id)}/letter/pdf`, { content }, "Lettre_de_motivation.pdf"),
  editLetter: (id: string, content: string) =>
    request<LetterState>("PUT", `/api/jobs/${encodeURIComponent(id)}/letter`, { content }),
  reviewLetter: (id: string) => request<LetterState>("POST", `/api/jobs/${encodeURIComponent(id)}/letter/review`),
  validateLetterReview: (id: string) => request<LetterState>("POST", `/api/jobs/${encodeURIComponent(id)}/letter/review/validate`),
  findAbridged: (page: { url?: string; title?: string; company?: string }) =>
    request<{ job: { id: string; title: string; company: string | null; sources: string[] } | null }>("POST", "/api/jobs/find-abridged", page),
  /** Le serveur télécharge la page de l'offre et renvoie le même paquet que l'extension. */
  readJobUrl: (url: string) =>
    request<{ url: string; source: string | null; text: string; hints: Record<string, unknown> }>("POST", "/api/jobs/manual/from-url", { url }),
  findByUrl: (url: string) =>
    request<{ job: { id: string; title: string; company: string | null; descriptionLength: number } | null }>("POST", "/api/jobs/find-by-url", { url }),
  completeJob: (
    id: string,
    text: string,
    experienceYears?: number | null,
    info?: { contractType?: string | null; remoteType?: string | null; salaryMin?: number | null; salaryMax?: number | null } | null,
  ) =>
    request<JobDetail>("PUT", `/api/jobs/${encodeURIComponent(id)}/full-text`, {
      text,
      experienceYears: experienceYears ?? null,
      info: info ?? null,
    }),
  /** Corrections à la main ({} = revenir aux infos de la source). */
  editJob: (id: string, edits: JobEdits) => request<JobDetail>("PUT", `/api/jobs/${encodeURIComponent(id)}/edits`, edits),
  resetFullText: (id: string) => request<JobDetail>("DELETE", `/api/jobs/${encodeURIComponent(id)}/full-text`),
  /**
   * « Postulé » : canal et CV (et contrat s'il manque) obligatoires. confirmDuplicate : « oui, je postule quand même »
   * alors que la même offre a déjà reçu une candidature.
   */
  setJobStatus: (id: string, status: JobStatus, extra: Partial<ApplyInfo> & { confirmDuplicate?: boolean } = {}) =>
    request<JobDetail>("POST", `/api/jobs/${encodeURIComponent(id)}/status`, { status, ...extra }),
  /** Complète une candidature d'avant la règle (canal, CV, contrat). */
  setApplyInfo: (id: string, info: ApplyInfo) => request<JobDetail>("PUT", `/api/jobs/${encodeURIComponent(id)}/application-info`, info),
};
