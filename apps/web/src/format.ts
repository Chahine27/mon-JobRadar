import type { JobStatus, RemoteType } from "./types";

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
