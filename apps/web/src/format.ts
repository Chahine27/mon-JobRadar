import type { JobStatus, RemoteType, SourceProgress } from "./types";

const k = (n: number) => `${Math.round(n / 1000)}k`;

export function formatSalary(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  // Moins de 8 000 € : pas un salaire annuel (souvent un taux journalier) → non affiché.
  if ((max ?? min)! < 8000) return null;
  if (min !== null && max !== null && min !== max) return `${k(min)}–${k(max)} €`;
  return `${k((max ?? min)!)} €`;
}

export function timeAgo(date: string | Date | null, now: Date = new Date()): string {
  if (!date) return "date inconnue";
  const diff = now.getTime() - new Date(date).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hier" : `il y a ${d} j`;
}

export const REMOTE_LABELS: Record<RemoteType, string | null> = {
  remote: "Télétravail complet",
  hybrid: "Hybride",
  onsite: "Sur site",
  unknown: null,
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  NEW: "Nouvelle",
  SEEN: "Vue",
  SAVED: "Sauvegardée",
  APPLIED: "Postulé",
  REJECTED: "Refusée",
  EXPIRED: "Expirée",
  IGNORED: "Ignorée",
};

export type Tone = "good" | "mid" | "low";

export function scoreTone(score: number, notifyThreshold = 70): Tone {
  if (score >= notifyThreshold) return "good";
  if (score >= 50) return "mid";
  return "low";
}

/** N'autorise que les liens http(s) (évite javascript:, data:...). */
export function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** « dans 3 min » / « maintenant » pour une date future. */
export function timeUntil(date: string | Date, now: Date = new Date()): string {
  const min = Math.round((new Date(date).getTime() - now.getTime()) / 60_000);
  if (min <= 0) return "maintenant";
  if (min < 60) return `dans ${min} min`;
  return `dans ${Math.round(min / 60)} h`;
}

export const SOURCE_LABELS: Record<string, string> = {
  "france-travail": "France Travail",
  adzuna: "Adzuna",
  "company-careers": "Site carrières",
  jooble: "Jooble",
  "jobscraper:linkedin": "LinkedIn (JobScraper)",
  "jobscraper:hellowork": "HelloWork (JobScraper)",
  "jobscraper:francetravail": "France Travail (JobScraper)",
  "jobscraper:wttj": "Welcome to the Jungle (JobScraper)",
  "jobscraper:adzuna": "Adzuna (JobScraper)",
  "jobscraper:indeed": "Indeed (JobSpy)",
  manual: "Ajoutée par toi",
  demo: "Démo",
};

/** Site d'où vient un lien (offre ajoutée à la main) : « LinkedIn », « Indeed »… ou le nom de domaine. */
export function originLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const known: Array<[string, string]> = [
    ["linkedin.", "LinkedIn"],
    ["indeed.", "Indeed"],
    ["welcometothejungle.", "Welcome to the Jungle"],
    ["hellowork.", "HelloWork"],
    ["apec.fr", "APEC"],
    ["francetravail.fr", "France Travail"],
    ["glassdoor.", "Glassdoor"],
    ["monster.", "Monster"],
    ["meteojob.", "Meteojob"],
    ["jobteaser.", "JobTeaser"],
    ["free-work.", "Free-Work"],
    ["jooble.", "Jooble"],
  ];
  return known.find(([k]) => host.includes(k))?.[1] ?? host;
}

/** Libellé du bouton « Voir l'offre sur … » d'une source. */
export function linkLabel(source: string, url: string): string {
  if (source === "manual") return originLabel(url) ?? "le site d'origine";
  return SOURCE_LABELS[source] ?? source;
}

/** Recherche Google Maps : adresse précise ou simple ville, Maps fait au mieux. */
export function mapsUrl(...parts: Array<string | null | undefined>): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.filter(Boolean).join(" "))}`;
}

export type SourceBadge = {
  tone: "good" | "bad" | "";
  text: string;
  /** Collecte de cette source en cours (ou en attente de son tour). */
  busy: boolean;
  /** Avancement 0–100 pendant la collecte ; null si inconnu (une seule récupération). */
  pct: number | null;
};

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/**
 * Pastille d'état d'une source : pendant une collecte, son avancement (en attente → recherches faites → enregistrement →
 * terminée) ; sinon le résultat de sa dernière collecte. Une IP bloquée n'est pas une source « non configurée ».
 */
export function sourceBadge(s: { lastStatus: string | null; lastError: string | null }, p?: SourceProgress | null): SourceBadge {
  if (p?.state === "pending") return { tone: "", text: "en attente", busy: true, pct: 0 };
  if (p?.state === "running") {
    if (!p.total) return { tone: "", text: "collecte…", busy: true, pct: null };
    if (p.done >= p.total) return { tone: "", text: `enregistrement de ${plural(p.found, "offre")}…`, busy: true, pct: 100 };
    return { tone: "", text: `${p.done}/${p.total} recherches · ${plural(p.found, "offre")}`, busy: true, pct: Math.round((p.done / p.total) * 100) };
  }
  if (p?.state === "done" && p.status === "OK") return { tone: "good", text: `terminée · ${plural(p.found, "offre")}`, busy: false, pct: null };
  const status = p?.status ?? s.lastStatus;
  if (status === "OK") return { tone: "good", text: "OK", busy: false, pct: null };
  if (s.lastError?.startsWith("IP bloquée")) return { tone: "bad", text: "bloquée", busy: false, pct: null };
  if (status === "SOURCE_UNAVAILABLE") return { tone: "", text: "non configurée", busy: false, pct: null };
  if (status) return { tone: "bad", text: "erreur", busy: false, pct: null };
  return { tone: "", text: "jamais lancée", busy: false, pct: null };
}

const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * « Pas pour moi » → techno que tu ne maîtrises pas : règle sur le titre si elle y est (la stack principale),
 * sinon sur l'annonce entière. Toujours « dans le titre » ne touchait ni l'offre (« Ingénieur en IA générative »
 * avec NLP dans le texte seulement) ni les suivantes : le score ne bougeait pas.
 */
export function skillRuleKind(title: string, skill: string): "title" | "text" {
  return plain(title).includes(plain(skill)) ? "title" : "text";
}
