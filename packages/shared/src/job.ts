/**
 * Modèle d'offre normalisée (README §9).
 * Règle : une donnée inconnue vaut `undefined`/`null`, jamais une valeur devinée.
 */

export const REMOTE_TYPES = ["remote", "hybrid", "onsite", "unknown"] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

export const JOB_STATUSES = [
  "NEW",
  "SEEN",
  "SAVED",
  "APPLIED",
  "REJECTED",
  "EXPIRED",
  "IGNORED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const LOCATION_PRECISIONS = ["address", "city_centroid", "unknown"] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

export type Job = {
  id: string;
  source: string;
  sourceJobId?: string;

  title: string;
  company?: string;
  description: string;

  contractType?: string;
  experienceLevel?: string;
  experienceMinYears?: number;
  experienceMaxYears?: number;

  salaryMin?: number;
  salaryMax?: number;
  salaryPeriod?: string;
  salaryText?: string;

  city?: string;
  postalCode?: string;
  department?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  locationPrecision: LocationPrecision;

  remoteType: RemoteType;

  /** Technologies telles qu'écrites dans l'annonce. */
  technologies: string[];

  sourceUrl: string;

  publishedAt?: Date;
  collectedAt: Date;

  rawData?: unknown;
};

/** Offre brute renvoyée par un connecteur, avant normalisation. */
export type RawJob = {
  source: string;
  sourceJobId: string;
  sourceUrl: string;
  data: unknown;
  collectedAt: Date;
};

/** Sources dont l'API ne donne qu'un extrait de l'annonce. */
export const ABRIDGED_SOURCES = ["adzuna", "jooble"];

/** La source n'a donné aucune description (ex. LinkedIn sans le détail) : il n'y a rien à lire. */
export const hasNoDescription = (j: { description: string }) => j.description.trim() === "";

/** Texte coupé par la source (« … obtenir des... ») : la marque des extraits Adzuna / Jooble. */
const looksCut = (description: string) => /(…|\.\.\.)\s*$/.test(description.trim());

/**
 * Annonce incomplète (source à extraits, ou aucune description), annonce complète pas encore collée :
 * son score n'est que provisoire. Vue aussi sur une autre source mais texte coupé : c'est encore l'extrait.
 */
export const isAbridged = (j: { sources: Array<{ source: string }>; fullTextAt: Date | null; description: string }) =>
  !j.fullTextAt &&
  j.sources.length > 0 &&
  (j.sources.every((s) => ABRIDGED_SOURCES.includes(s.source)) ||
    hasNoDescription(j) ||
    (j.sources.some((s) => ABRIDGED_SOURCES.includes(s.source)) && looksCut(j.description)));
