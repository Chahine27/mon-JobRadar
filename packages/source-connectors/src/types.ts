/** Contrat commun à toutes les sources (README §8). */

export type SearchParams = {
  keywords: string;
  /** Code département, ex. "60". */
  department?: string;
  /** Libellé lisible de la zone, utile aux sources qui ne filtrent pas par département. */
  locationLabel?: string;
  /** Ne garder que les offres publiées depuis N jours. */
  publishedSinceDays?: 1 | 3 | 7 | 14 | 31;
  /** Nombre max d'offres à récupérer pour cette recherche. */
  maxResults?: number;
};

/** Offre brute, telle que renvoyée par la source (jamais modifiée). */
export type RawJob = {
  source: string;
  sourceJobId: string;
  data: unknown;
  collectedAt: Date;
};

export type SourceHealth =
  | { status: "OK" }
  | { status: "ERROR"; message: string }
  | { status: "SOURCE_UNAVAILABLE"; message: string };

export interface JobSource {
  readonly name: string;
  search(params: SearchParams): Promise<RawJob[]>;
  healthCheck(): Promise<SourceHealth>;
  /**
   * Sources « catalogue » (sites carrières) : tout récupérer en une fois au lieu d'une recherche par mot-clé.
   * Les erreurs par entreprise sont renvoyées sans bloquer les autres.
   */
  fetchAll?(): Promise<{ jobs: RawJob[]; errors: string[] }>;
  /**
   * Sources à quota serré (Jooble) : reçoivent toutes les recherches d'un coup pour les regrouper.
   * `skipped` : rien demandé cette fois (ex. trop tôt depuis la dernière fois).
   */
  searchAll?(queries: SearchParams[]): Promise<{ jobs: RawJob[]; errors: string[]; skipped?: string }>;
  /** false = rien à collecter (ex. aucune entreprise suivie) : la source n'est pas lancée. Absent = toujours. */
  hasWork?(): Promise<boolean>;
}

/** Source non configurée ou sans accès autorisé : ne doit jamais bloquer les autres. */
export class SourceUnavailableError extends Error {
  readonly code = "SOURCE_UNAVAILABLE";
}

export class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
