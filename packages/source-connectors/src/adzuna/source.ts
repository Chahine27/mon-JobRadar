import { departmentName } from "@job-radar/shared";
import { z } from "zod";
import { RateLimiter } from "../rate-limiter";
import {
  type FetchLike,
  type JobSource,
  type RawJob,
  type SearchParams,
  type SourceHealth,
  SourceHttpError,
  SourceUnavailableError,
} from "../types";

export const ADZUNA_SOURCE = "adzuna";

/**
 * Adzuna — usage « recherche personnelle » autorisé (conditions d'utilisation).
 * Limites par défaut : 25 appels/min, 250/jour, 1 000/semaine, 2 500/mois.
 */
export const ADZUNA_DEFAULTS = {
  baseUrl: "https://api.adzuna.com/v1/api/jobs/fr/search",
  minDelayMs: 2600, // ≤ 25 appels / minute
  resultsPerPage: 50,
};

export const AdzunaJobSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().optional(),
  description: z.string().optional(),
  created: z.string().optional(),
  redirect_url: z.string().optional(),
  company: z.looseObject({ display_name: z.string().optional() }).optional(),
  location: z.looseObject({ display_name: z.string().optional(), area: z.array(z.string()).optional() }).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  salary_min: z.number().optional(),
  salary_max: z.number().optional(),
  salary_is_predicted: z.union([z.string(), z.number()]).optional(),
  contract_type: z.string().optional(),
  contract_time: z.string().optional(),
});
export type AdzunaJob = z.infer<typeof AdzunaJobSchema>;

export class AdzunaSource implements JobSource {
  readonly name = ADZUNA_SOURCE;
  private readonly limiter: RateLimiter;
  private readonly fetch: FetchLike;

  constructor(
    private readonly opts: {
      appId: string | undefined;
      appKey: string | undefined;
      fetch?: FetchLike;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.limiter = new RateLimiter(ADZUNA_DEFAULTS.minDelayMs, opts.now, opts.sleep);
  }

  private creds() {
    if (!this.opts.appId || !this.opts.appKey) {
      throw new SourceUnavailableError("Clé Adzuna absente (ADZUNA_APP_ID / ADZUNA_APP_KEY dans .env)");
    }
    return { appId: this.opts.appId, appKey: this.opts.appKey };
  }

  /** Une seule page par recherche : le quota quotidien est faible. */
  async search(params: SearchParams): Promise<RawJob[]> {
    const { appId, appKey } = this.creds();
    const q = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      what: params.keywords,
      results_per_page: String(Math.min(params.maxResults ?? ADZUNA_DEFAULTS.resultsPerPage, ADZUNA_DEFAULTS.resultsPerPage)),
      sort_by: "date",
      "content-type": "application/json",
    });
    const where = params.department ? departmentName(params.department) : null;
    if (where) q.set("where", where);
    if (params.publishedSinceDays) q.set("max_days_old", String(params.publishedSinceDays));

    const res = await this.limiter.schedule(() => this.fetch(`${ADZUNA_DEFAULTS.baseUrl}/1?${q}`, { headers: { Accept: "application/json" } }));
    if (!res.ok) {
      // Ne jamais afficher l'URL (elle contient la clé).
      throw new SourceHttpError(`Recherche Adzuna en erreur (HTTP ${res.status})`, res.status);
    }
    const body = z.looseObject({ results: z.array(z.unknown()).optional() }).parse(await res.json());
    const collectedAt = new Date(this.opts.now?.() ?? Date.now());
    const out: RawJob[] = [];
    for (const item of body.results ?? []) {
      const job = AdzunaJobSchema.safeParse(item);
      if (job.success) out.push({ source: ADZUNA_SOURCE, sourceJobId: job.data.id, data: item, collectedAt });
    }
    return out;
  }

  async healthCheck(): Promise<SourceHealth> {
    try {
      await this.search({ keywords: "développeur", maxResults: 1 });
      return { status: "OK" };
    } catch (err) {
      if (err instanceof SourceUnavailableError) return { status: "SOURCE_UNAVAILABLE", message: err.message };
      return { status: "ERROR", message: err instanceof Error ? err.message : String(err) };
    }
  }
}
