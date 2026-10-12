import { createHash } from "node:crypto";
import { normalizeText } from "@job-radar/skills";

/** Texte comparable : minuscules, sans accents, sans ponctuation ni mentions (H/F). */
export function comparable(text: string | null | undefined): string {
  return normalizeText(text ?? "")
    .replace(/\((h\/f|f\/h|h\/f\/x|f\/h\/x)\)|\b(h\/f|f\/h)\b/g, " ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

/**
 * Empreinte de dédoublonnage (README §10, niveau 3 : entreprise + titre + lieu).
 * Sans nom d'entreprise, on ne peut pas affirmer que deux offres sont identiques :
 * on se rabat sur l'identifiant source (pas de fusion hasardeuse).
 */
export function fingerprintOf(input: {
  source: string;
  sourceJobId: string;
  company: string | null;
  title: string;
  city: string | null;
}): string {
  const company = comparable(input.company);
  if (!company) return `src:${input.source}:${input.sourceJobId}`;
  return `job:${sha([company, comparable(input.title), comparable(input.city)])}`;
}

/** « COMPIEGNE » → « Compiègne » n'est pas possible sans dictionnaire : on met juste une casse lisible. */
export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s\-'])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Décalage de l'heure de Paris par rapport à UTC à un instant donné (été +2 h, hiver +1 h). */
function parisOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

/**
 * Date d'une source. Sans fuseau (« 2026-09-28T10:00:00.0000000 ») = heure de Paris,
 * quel que soit le fuseau de l'ordinateur (sinon le résultat change d'un PC à l'autre).
 */
export function parseParisDate(value: string | null | undefined): Date | null {
  const s = value?.trim();
  if (!s) return null;
  if (/(z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  return new Date(asUtc - parisOffsetMs(asUtc));
}

/** Paramètres de suivi (même offre, lien différent) : retirés de la clé. */
const TRACKING_PARAMS = /^(utm_.*|refid|trackingid|trk|position|pagenum|ref|fbclid|gclid|originalsubdomain|src|from)$/i;

/**
 * Clé d'URL d'une offre, pour reconnaître la même annonce trouvée par deux chemins (collecte, ajout manuel…).
 * LinkedIn : l'identifiant suffit (fr./www., titre dans le lien, paramètres de suivi n'y changent rien).
 * Ailleurs : domaine sans « www. » + chemin + paramètres utiles (triés) + route « #/… ». null si ce n'est pas une URL.
 */
export function urlKey(url: string | null | undefined): string | null {
  let u: URL;
  try {
    u = new URL(url ?? "");
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    const id = u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/)?.[1] ?? u.searchParams.get("currentJobId");
    if (id && /^\d{6,}$/.test(id)) return `linkedin.com/jobs/view/${id}`;
  }
  const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  // Applications d'une seule page : l'offre est dans le fragment (« #/apply/job/so1tfzjse98/… »).
  const route = /^#!?\//.test(u.hash) ? u.hash : "";
  return `${host}${decodeURIComponent(u.pathname).replace(/\/+$/, "")}${query}${route}`;
}
