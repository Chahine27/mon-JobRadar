import { hash } from "@node-rs/argon2";
import { DEFAULT_PROFILE, type LetterKit, type Profile } from "@job-radar/shared";
import type { Mailer, Notifier, OutgoingMail } from "@job-radar/notifications";
import { buildManualJob } from "@job-radar/pipeline";
import { type AppOptions, buildApp } from "./app";
import { applyEdits } from "./stores";
import type {
  CvMasterRecord,
  TailoredCvRow,
  HomeLocation,
  LeadRow,
  JobRow,
  NotificationSettingsRecord,
  ProfileRecord,
  PushSubscriptionInput,
  Stores,
  StoredApplication,
  ApplicationMailRow,
  StoredLetter,
  UserRecord,
} from "./stores";

export function job(partial: Partial<JobRow> & Pick<JobRow, "id" | "title" | "description">): JobRow {
  return {
    contentHash: partial.id,
    company: "Entreprise test",
    contractType: "CDI",
    experienceText: null,
    experienceMinYrs: 2,
    salaryMin: 40000,
    salaryMax: 45000,
    salaryText: null,
    city: "Compiègne",
    postalCode: "60200",
    department: "60",
    latitude: null,
    longitude: null,
    address: null,
    remoteType: "hybrid",
    technologies: [],
    publishedAt: new Date("2026-09-27T10:00:00Z"),
    firstSeenAt: new Date("2026-09-27T10:05:00Z"),
    status: "NEW",
    travelMinutes: 30,
    travelMode: null,
    sources: [{ source: "demo", url: `https://example.com/${partial.id}` }],
    fullTextAt: null,
    ...partial,
  };
}

export const TEST_JOBS: JobRow[] = [
  job({ id: "j-vue", title: "Développeur Vue.js", description: "Vue 3, TypeScript, Node.js" }),
  job({ id: "j-ruby", title: "Développeur Ruby", description: "Ruby on Rails, Kubernetes" }),
  job({ id: "j-cdd", title: "Développeur Vue.js CDD", description: "Vue 3", contractType: "CDD" }),
  job({
    id: "j-java",
    title: "Développeur Java",
    description: "Java, Spring Boot, Angular",
    publishedAt: new Date("2026-09-28T08:00:00Z"),
  }),
];

export const TEST_EMAIL = "test@example.com";
export const TEST_PASSWORD = "un-mot-de-passe-solide";
export const APP_URL = "http://localhost:5173";

/** Stockage en mémoire, même comportement que la version Prisma. */
export async function createMemoryStores() {
  const user: UserRecord = { id: "u1", email: TEST_EMAIL, passwordHash: await hash(TEST_PASSWORD) };
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  const profiles = new Map<string, ProfileRecord>([
    ["u1", { profile: structuredClone(DEFAULT_PROFILE), home: null, updatedAt: new Date() }],
  ]);

  const jobs = new Map(TEST_JOBS.map((j) => [j.id, structuredClone(j)]));
  const events: Array<{ jobId: string; from: string; to: string; at: Date }> = [];

  let notifSettings: NotificationSettingsRecord = { emailEnabled: true, pushEnabled: true, emailTo: null };
  const pushSubs = new Map<string, PushSubscriptionInput>();

  const sourceRows = new Map(
    ["france-travail", "adzuna", "company-careers"].map((source) => [
      source,
      { source, enabled: source === "france-travail", intervalMinutes: 5, failures: 0, lastSuccessAt: null, nextRunAt: new Date(), lastStatus: null, lastError: null, lastRunAt: null },
    ]),
  );
  const companyRows = new Map<string, { id: string; name: string; ats: string; boardKey: string; enabled: boolean }>();

  const leadRows = new Map<string, LeadRow>();
  const analysisRows = new Map<string, { inputHash: string; model: string; result: unknown; createdAt: Date }>();
  const kitRows = new Map<string, LetterKit>();
  const beforeEdits = new Map<string, JobRow>();
  const originals = new Map<string, Pick<JobRow, "description" | "contentHash" | "experienceMinYrs" | "contractType">>();
  const letterRows = new Map<string, StoredLetter>();
  const appRows = new Map<string, StoredApplication>();
  const onSite = new Map<string, { appliedOnSiteAt: Date | null; noOpeningAt: Date | null }>();
  const mailRows: ApplicationMailRow[] = [];
  const cvRows = new Map<string, CvMasterRecord>();
  const tailoredRows = new Map<string, TailoredCvRow>();
  const tkey = (jobId: string, template: string) => `${jobId}|${template}`;
  const stores: Stores = {
    cvMasters: {
      get: async (userId) => cvRows.get(userId) ?? null,
      save: async (userId, master, contentHash) => {
        const rec = { master: structuredClone(master), contentHash, updatedAt: new Date() };
        cvRows.set(userId, rec);
        return rec;
      },
    },
    tailoredCvs: {
      get: async (jobId, template) => tailoredRows.get(tkey(jobId, template)) ?? null,
      save: async (row) => {
        const prev = tailoredRows.get(tkey(row.jobId, row.template));
        const next: TailoredCvRow = { pdfPath: null, exportedAt: null, sentAt: null, ...prev, ...structuredClone(row), updatedAt: new Date() };
        tailoredRows.set(tkey(row.jobId, row.template), next);
        return next;
      },
      markExported: async (jobId, template, pdfPath, at) => {
        const r = tailoredRows.get(tkey(jobId, template));
        if (r) Object.assign(r, { pdfPath, exportedAt: at, status: "EXPORTED" });
      },
      markSent: async (jobId, at) => {
        for (const r of tailoredRows.values()) if (r.jobId === jobId && r.status === "EXPORTED") r.sentAt = at;
      },
      exported: async () => [...tailoredRows.values()].filter((r) => r.exportedAt),
    },
    applications: {
      get: async (leadId) => appRows.get(leadId) ?? null,
      save: async (leadId, a) => {
        const now = new Date();
        const prev = appRows.get(leadId);
        const row = { ...a, edited: false, sentAt: prev?.sentAt ?? null, sentTo: prev?.sentTo ?? null, createdAt: now, updatedAt: now };
        appRows.set(leadId, row);
        return row;
      },
      edit: async (leadId, letter) => {
        const row = appRows.get(leadId);
        if (!row) return null;
        const next = { ...row, letter, edited: true, updatedAt: new Date() };
        appRows.set(leadId, next);
        return next;
      },
      markSent: async (leadId, to, at) => {
        const row = appRows.get(leadId);
        if (row) appRows.set(leadId, { ...row, sentAt: at, sentTo: to });
      },
      listSent: async () =>
        [...appRows]
          .filter(([, a]) => a.sentAt)
          .map(([leadId, a]) => ({ id: `sp-${leadId}`, leadId, sentAt: a.sentAt!, sentTo: a.sentTo, ...(onSite.get(`sp-${leadId}`) ?? { appliedOnSiteAt: null, noOpeningAt: null }) })),
      setSiteOutcome: async (id, outcome, at) => {
        if (!appRows.get(id.replace(/^sp-/, ""))?.sentAt) return false;
        onSite.set(id, { appliedOnSiteAt: outcome === "applied" ? at : null, noOpeningAt: outcome === "none" ? at : null });
        return true;
      },
    },
    applicationMails: {
      list: async () => mailRows,
      dismiss: async (id) => {
        const row = mailRows.find((m) => m.id === id);
        if (row) row.dismissed = true;
        return row ?? null;
      },
    },
    letterKits: {
      get: async (userId) => kitRows.get(userId) ?? null,
      save: async (userId, kit) => (kitRows.set(userId, kit), kit),
    },
    letters: {
      get: async (jobId) => letterRows.get(jobId) ?? null,
      save: async (jobId, l) => {
        const now = new Date();
        const row = { ...l, edited: false, createdAt: now, updatedAt: now };
        letterRows.set(jobId, row);
        return row;
      },
      edit: async (jobId, content) => {
        const row = letterRows.get(jobId);
        if (!row) return null;
        const next = { ...row, content, edited: true, updatedAt: new Date() };
        letterRows.set(jobId, next);
        return next;
      },
    },
    analyses: {
      latest: async (jobId) => analysisRows.get(jobId) ?? null,
      latestAll: async () => new Map(analysisRows),
      save: async (jobId, a) => {
        const row = { inputHash: a.inputHash, model: a.model, result: a.result, createdAt: new Date() };
        analysisRows.set(jobId, row);
        return row;
      },
    },
    leads: {
      list: async () => [...leadRows.values()].sort((a, b) => (b.hiringPotential ?? 0) - (a.hiringPotential ?? 0)),
      upsertMany: async (leads, now) => {
        let created = 0;
        let updated = 0;
        for (const l of leads) {
          const existing = [...leadRows.values()].find((r) => r.siret === l.siret);
          if (existing) {
            Object.assign(existing, l, { lastSeenAt: now });
            updated++;
          } else {
            const id = `l${leadRows.size + 1}`;
            leadRows.set(id, { ...l, id, status: "TO_CONTACT", notes: null, contactEmail: null, contactedAt: null, travelMinutes: null, travelOriginKey: null, firstSeenAt: now, lastSeenAt: now });
            created++;
          }
        }
        return { created, updated };
      },
      update: async (id, data) => {
        const r = leadRows.get(id);
        if (!r) return null;
        Object.assign(r, data);
        return r;
      },
      get: async (id) => leadRows.get(id) ?? null,
      setTravel: async (id, minutes, originKey) => {
        const r = leadRows.get(id);
        if (r) Object.assign(r, { travelMinutes: minutes, travelOriginKey: originKey });
      },
      lastRefreshAt: async () => [...leadRows.values()].reduce<Date | null>((a, r) => (!a || r.lastSeenAt > a ? r.lastSeenAt : a), null),
    },
    sources: {
      list: async () => [...sourceRows.values()],
      update: async (source, data) => {
        const row = sourceRows.get(source);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      },
    },
    companies: {
      list: async () => [...companyRows.values()],
      add: async (data) => {
        if ([...companyRows.values()].some((c) => c.ats === data.ats && c.boardKey === data.boardKey)) return null;
        const row = { id: `c${companyRows.size + 1}`, enabled: true, ...data };
        companyRows.set(row.id, row);
        return row;
      },
      setEnabled: async (id, enabled) => {
        const row = companyRows.get(id);
        if (!row) return null;
        row.enabled = enabled;
        return row;
      },
      remove: async (id) => companyRows.delete(id),
    },
    notifications: {
      getSettings: async () => notifSettings,
      saveSettings: async (s) => (notifSettings = s),
      subscribe: async (_userId, sub) => void pushSubs.set(sub.endpoint, sub),
      unsubscribe: async (endpoint) => void pushSubs.delete(endpoint),
      countSubscriptions: async () => pushSubs.size,
      recent: async () => [],
    },
    jobs: {
      list: async (statuses) => [...jobs.values()].filter((j) => !statuses || statuses.includes(j.status)),
      get: async (id) => jobs.get(id) ?? null,
      appliedDates: async () => new Map(events.filter((e) => e.to === "APPLIED").reverse().map((e) => [e.jobId, e.at])),
      setStatus: async (id, status) => {
        const j = jobs.get(id);
        if (!j) return null;
        if (j.status !== status) events.push({ jobId: id, from: j.status, to: status, at: new Date() });
        j.status = status;
        return j;
      },
      addManual: async (input) => {
        const n = buildManualJob(input, `m-${jobs.size + 1}`);
        if (!n) return null;
        // Même entreprise + titre + ville qu'une offre existante → rattachée (comme la vraie base).
        const same = [...jobs.values()].find(
          (j) => n.company && j.company === n.company && j.title === n.title && (j.city ?? null) === n.city,
        );
        const target: JobRow =
          same ??
          {
            id: `job-${n.sourceJobId}`,
            contentHash: n.contentHash,
            title: n.title,
            company: n.company,
            description: n.description,
            contractType: n.contractType,
            experienceText: n.experienceText,
            experienceMinYrs: n.experienceMinYrs,
            salaryMin: n.salaryMin,
            salaryMax: n.salaryMax,
            salaryText: n.salaryText,
            city: n.city,
            postalCode: n.postalCode,
            department: n.department,
            latitude: n.latitude,
            longitude: n.longitude,
            address: n.address,
            remoteType: n.remoteType,
            technologies: n.technologies,
            publishedAt: n.publishedAt,
            firstSeenAt: new Date(),
            status: "NEW",
            travelMinutes: null,
            travelMode: null,
            sources: [],
            fullTextAt: null,
          };
        const others = target.sources.map((s) => s.source).filter((s) => s !== "manual");
        target.sources.push({ source: "manual", url: n.sourceUrl });
        if (target.status === "NEW" || target.status === "SEEN") target.status = "SAVED";
        jobs.set(target.id, target);
        return { jobId: target.id, duplicate: Boolean(same), otherSources: [...new Set(others)] };
      },
      removeManual: async (id) => {
        const j = jobs.get(id);
        if (!j) return "not_found";
        if (!j.sources.some((s) => s.source === "manual")) return "not_manual";
        if (j.sources.every((s) => s.source === "manual")) {
          jobs.delete(id);
          return "deleted";
        }
        j.sources = j.sources.filter((s) => s.source !== "manual");
        return "unlinked";
      },
      setFullText: async (id, full) => {
        const j = jobs.get(id);
        if (!j) return null;
        const original = originals.get(id) ?? { description: j.description, contentHash: j.contentHash, experienceMinYrs: j.experienceMinYrs, contractType: j.contractType };
        originals.set(id, original);
        if (full) {
          const at = new Date();
          Object.assign(j, {
            description: full.text,
            contentHash: `${original.contentHash}:full${at.getTime()}`,
            experienceMinYrs: full.experienceYears ?? original.experienceMinYrs,
            contractType: original.contractType ?? full.info?.contractType ?? null,
            fullTextAt: at,
          });
        } else {
          Object.assign(j, { ...original, fullTextAt: null });
        }
        return j;
      },
      setEdits: async (id, edits) => {
        const j = jobs.get(id);
        if (!j) return null;
        const before = beforeEdits.get(id) ?? structuredClone(j);
        beforeEdits.set(id, before);
        Object.assign(j, structuredClone(before), { userEdits: null, userEditsAt: null });
        if (edits) applyEdits(j, edits, new Date());
        return j;
      },
    },
    users: {
      findByEmail: async (email) => (email === user.email ? user : null),
      findById: async (id) => (id === user.id ? user : null),
    },
    sessions: {
      create: async ({ id, ...rest }) => void sessions.set(id, rest),
      find: async (id) => sessions.get(id) ?? null,
      delete: async (id) => void sessions.delete(id),
    },
    profiles: {
      get: async (userId) => profiles.get(userId) ?? null,
      save: async (userId, profile: Profile, home: HomeLocation | null | undefined) => {
        const prev = profiles.get(userId);
        const rec: ProfileRecord = {
          profile,
          home: home === undefined ? (prev?.home ?? null) : home,
          updatedAt: new Date(),
        };
        profiles.set(userId, rec);
        return rec;
      },
    },
  };
  return { stores, sessions, profiles, jobs, events, pushSubs, leadRows, mailRows, appRows, cvRows, tailoredRows, kitRows, analysisRows };
}

/** Faux collecteur : enregistre les demandes, simule « déjà en cours » au 2ᵉ appel. */
export function createFakeCollector() {
  const starts: string[] = [];
  const collector = {
    starts,
    async start(trigger: "manual") {
      starts.push(trigger);
      return { status: starts.length === 1 ? ("started" as const) : ("already_running" as const), runId: "run-1" };
    },
    async startSource(source: string) {
      if (source === "off") return null;
      starts.push(source);
      return { status: "started" as const, runId: "run-2" };
    },
    async status() {
      return {
        running: starts.length > 0,
        step: null,
        progress: [],
        finishing: false,
        lastRun: null,
        sources: [],
        newJobs: 3,
      };
    },
  };
  return collector;
}

export async function createTestApp(extra: Partial<AppOptions> = {}) {
  const mem = await createMemoryStores();
  const collector = createFakeCollector();
  const tests: string[] = [];
  const travelRequests: string[] = [];
  /** Durée simulée du calcul de trajet (ms). */
  const travelDelay = { ms: 0 };
  const lbbSearches: unknown[] = [];
  /** Fausse IA : compte les appels, peut simuler Ollama éteint. */
  const aiCalls: Array<{ title: string; skills: string[] }> = [];
  const aiState: { online: boolean; adequation: "forte" | "moyenne" | "faible"; badFormat?: boolean } = { online: true, adequation: "forte" };
  const notifiers: Notifier[] = [
    { channel: "email", isConfigured: () => true, sendAlerts: async () => {}, sendTest: async () => void tests.push("email") },
    {
      channel: "webpush",
      isConfigured: () => false,
      sendAlerts: async () => {},
      sendTest: async () => void tests.push("webpush"),
    },
  ];
  /** Faux envoi d'email : garde les messages « envoyés ». */
  const sentMails: OutgoingMail[] = [];
  /** Pages des notifications « lettre terminée » envoyées. */
  const letterNotices: string[] = [];
  const mailer: Mailer = { isConfigured: () => true, address: () => "alex.martin@example.com", send: async (m) => void sentMails.push(m) };
  const app = await buildApp({
    ...extra,
    mailer,
    stores: mem.stores,
    appUrl: APP_URL,
    secureCookie: false,
    collector,
    notifiers,
    onLetterReady: async (n) => void letterNotices.push(n.path),
    vapidPublicKey: "BTestPublicKey",
    ai: {
      model: "fake-model",
      status: async () =>
        aiState.online ? { available: true, model: "fake-model", installed: true } : { available: false, model: "fake-model", message: "Ollama ne répond pas" },
      readJob: async (text, hints) => {
        if (!aiState.online) throw Object.assign(new Error("Ollama ne répond pas : lance l'appli Ollama sur ce PC."), { code: "AI_UNAVAILABLE" });
        aiCalls.push({ title: `lecture:${text.slice(0, 20)}`, skills: [] });
        return {
          model: "fake-model",
          durationMs: 4,
          fields: {
            title: hints?.title ?? "Développeur Vue.js",
            company: hints?.company ?? "Acme",
            location: "Paris (75)",
            address: null,
            contractType: "CDI",
            remoteType: "hybrid",
            salaryMin: null,
            salaryMax: null,
            experienceYears: 1,
            skills: ["Vue.js"],
          },
        };
      },
      writeLetter: async (job, kit, opts) => {
        if (!aiState.online) throw Object.assign(new Error("Ollama ne répond pas : lance l'appli Ollama sur ce PC."), { code: "AI_UNAVAILABLE" });
        aiCalls.push({ title: `lettre:${job.title}`, skills: [] });
        if (opts?.spontaneous) {
          return { model: "fake-model", durationMs: 7, content: `${kit.header}\n\nObjet : Candidature spontanée – ${job.title}\n\nChez Banquo, j'ai développé des écrans en Vue.js pour ${job.company}.` };
        }
        return { model: "fake-model", durationMs: 7, content: `${kit.header}\n\nObjet : Candidature au poste de ${job.title}\n\nJe maîtrise Kafka.` };
      },
      analyze: async (job, profile) => {
        if (!aiState.online) throw Object.assign(new Error("Ollama ne répond pas : lance l'appli Ollama sur ce PC."), { code: "AI_UNAVAILABLE" });
        aiCalls.push({ title: job.title, skills: profile.skills });
        if (aiState.badFormat) throw new Error("Réponse de l'IA hors format : competences_obligatoires");
        return {
          model: "fake-model",
          durationMs: 5,
          result: {
            resume: `Résumé de ${job.title}`,
            missions: ["Développer"],
            competences_obligatoires: ["Vue.js"],
            competences_bonus: ["Docker"],
            niveau: "junior",
            experience_min_ans: 2,
            employeur: "direct",
            points_attention: [],
            adequation: aiState.adequation,
            avis: "Ça colle.",
          },
        };
      },
    },
    sourcesConfigured: { "france-travail": true, adzuna: false },
    searchCompanies: async (p) => {
      lbbSearches.push(p);
      return [
        { siret: "11111111100011", company_name: "ALPHA LOGICIELS", office_name: "", email: "yes", naf: "6201Z", naf_label: "Programmation informatique",
          headcount_min: 10, headcount_max: 19, location: { lat: 49.26, lon: 2.47 }, city: "Creil", postcode: "60100", department_number: "60",
          hiring_potential: 61.23, is_high_potential: true },
        { siret: "22222222200022", company_name: "BETA SERVICES", office_name: "", email: "no", naf: "6202B", naf_label: "Tierce maintenance",
          headcount_min: 0, headcount_max: 0, location: { lat: 49.3, lon: 2.3 }, city: "Chambly", postcode: "60230", department_number: "60",
          hiring_potential: 7.9, is_high_potential: false },
      ];
    },
    ensureTravel: async (jobId: string) => {
      travelRequests.push(jobId);
      if (travelDelay.ms) await new Promise((ok) => setTimeout(ok, travelDelay.ms));
      if (jobId === "j-java") throw new Error("quota PRIM atteint");
      const j = mem.jobs.get(jobId);
      if (j) j.travelMinutes = 42;
      return null;
    },
    geocoder: async (q: string) =>
      q.includes("introuvable") ? [] : [{ label: "Place de la Gare 60200 Compiègne", lat: 49.4214, lng: 2.8267, precision: "address" }],
  });
  return { app, collector, tests, travelRequests, travelDelay, lbbSearches, aiCalls, aiState, sentMails, letterNotices, ...mem };
}

export async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  const cookie = res.cookies.find((c) => c.name === "jr_session");
  if (!cookie) throw new Error(`login échoué : ${res.statusCode} ${res.body}`);
  return { jr_session: cookie.value };
}
