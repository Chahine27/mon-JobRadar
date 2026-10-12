import type { LocationPrecision, RemoteType } from "@job-radar/shared";

/** Offre prête à être enregistrée. Inconnu = null, jamais deviné. Salaires en brut annuel (€). */
export type NormalizedJob = {
  source: string;
  sourceJobId: string;
  sourceUrl: string;
  canonicalUrl: string | null;
  fingerprint: string;
  contentHash: string;

  title: string;
  company: string | null;
  description: string;
  contractType: string | null;
  experienceText: string | null;
  experienceMinYrs: number | null;
  experienceMaxYrs: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: "year" | null;
  salaryText: string | null;
  city: string | null;
  postalCode: string | null;
  department: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision: LocationPrecision;
  remoteType: RemoteType;
  technologies: string[];
  publishedAt: Date | null;
  rawData: unknown;
};
