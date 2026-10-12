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
import { FtOfferSchema, FtSearchResponseSchema, FtTokenSchema } from "./schema";

export const FT_SOURCE = "france-travail";

export const FT_DEFAULTS = {
  tokenUrl: "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire",
  searchUrl: "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search",
  scope: "api_offresdemploiv2 o2dsoffre",
  /** Limite documentée : 10 appels/s. On reste prudent à 4/s. */
  minDelayMs: 250,
  /** L'API renvoie au plus 150 offres par page. */
  pageSize: 150,
  /** Position de départ maximale autorisée par l'API. */
  maxStart: 1000,
  maxRetries: 3,
};

export type FranceTravailOptions = {
  clientId: string | undefined;
  clientSecret: string | undefined;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
} & Partial<typeof FT_DEFAULTS>;

export class FranceTravailSource implements JobSource {
  readonly name = FT_SOURCE;
  private readonly cfg: typeof FT_DEFAULTS;
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limiter: RateLimiter;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly opts: FranceTravailOptions) {
    const { clientId: _i, clientSecret: _s, fetch, now, sleep, ...overrides } = opts;
    this.cfg = { ...FT_DEFAULTS, ...overrides };
    this.fetch = fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = now ?? Date.now;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.limiter = new RateLimiter(this.cfg.minDelayMs, this.now, this.sleep);
  }

  private credentials() {
    const { clientId, clientSecret } = this.opts;
    if (!clientId || !clientSecret) {
      throw new SourceUnavailableError(
        "Identifiants France Travail absents (FRANCE_TRAVAIL_CLIENT_ID / FRANCE_TRAVAIL_CLIENT_SECRET dans .env)",
      );
    }
    return { clientId, clientSecret };
  }

  /** Jeton OAuth2 « client credentials », réutilisé jusqu'à 1 min avant expiration. */
  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const { clientId, clientSecret } = this.credentials();
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: this.cfg.scope,
    });
    const res = await this.limiter.schedule(() =>
      this.fetch(this.cfg.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
      }),
    );
    if (!res.ok) {
      // Ne jamais inclure le corps de la requête (il contient le secret).
      const detail = await res.text().catch(() => "");
      throw new SourceHttpError(
        `Authentification France Travail refusée (HTTP ${res.status}) ${detail.slice(0, 200)}`.trim(),
        res.status,
      );
    }
    const parsed = FtTokenSchema.parse(await res.json());
    this.token = { value: parsed.access_token, expiresAt: this.now() + parsed.expires_in * 1000 };
    return this.token.value;
  }

  /** Appel GET avec jeton, limite de débit et réessais sur 429 / 5xx. */
  private async get(url: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();
      const res = await this.limiter.schedule(() =>
        this.fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }),
      );
      if (res.status === 401 && attempt === 0) {
        this.token = null; // jeton expiré côté serveur : on en redemande un
        continue;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.cfg.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      return res;
    }
  }

  async search(params: SearchParams): Promise<RawJob[]> {
    const maxResults = params.maxResults ?? 300;
    const results: RawJob[] = [];
    for (let start = 0; start <= this.cfg.maxStart && results.length < maxResults; start += this.cfg.pageSize) {
      const end = Math.min(start + this.cfg.pageSize, start + (maxResults - results.length)) - 1;
      const q = new URLSearchParams({ motsCles: params.keywords, range: `${start}-${end}`, sort: "1" });
      if (params.department) q.set("departement", params.department);
      if (params.publishedSinceDays) q.set("publieeDepuis", String(params.publishedSinceDays));

      const res = await this.get(`${this.cfg.searchUrl}?${q}`);
      if (res.status === 204) break; // 204 = aucun résultat, pas une erreur
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new SourceHttpError(`Recherche France Travail en erreur (HTTP ${res.status}) ${detail.slice(0, 200)}`.trim(), res.status);
      }
      const page = FtSearchResponseSchema.parse(await res.json());
      const collectedAt = new Date(this.now());
      for (const item of page.resultats ?? []) {
        const offer = FtOfferSchema.safeParse(item);
        if (!offer.success) continue; // offre illisible : ignorée plutôt que de bloquer la collecte
        results.push({ source: FT_SOURCE, sourceJobId: offer.data.id, data: item, collectedAt });
      }

      // En-tête « Content-Range: offres 0-149/1234 » : on s'arrête quand tout est récupéré.
      const total = Number(res.headers.get("content-range")?.split("/")[1]);
      const received = page.resultats?.length ?? 0;
      if (received < end - start + 1 || (Number.isFinite(total) && end + 1 >= total)) break;
    }
    return results;
  }

  /**
   * L'offre est-elle toujours en ligne ? true / false, ou null si on ne sait pas (erreur réseau…).
   * France Travail répond 204 ou 404 pour une offre retirée.
   */
  async isStillOnline(id: string): Promise<boolean | null> {
    try {
      const url = this.cfg.searchUrl.replace(/\/search$/, `/${encodeURIComponent(id)}`);
      const res = await this.get(url);
      if (res.status === 204 || res.status === 404 || res.status === 410) return false;
      if (res.ok) return true;
      return null;
    } catch {
      return null;
    }
  }

  async healthCheck(): Promise<SourceHealth> {
    try {
      await this.getToken();
      return { status: "OK" };
    } catch (err) {
      if (err instanceof SourceUnavailableError) return { status: "SOURCE_UNAVAILABLE", message: err.message };
      return { status: "ERROR", message: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** URL publique d'une offre France Travail (lien « Voir l'offre »). */
export function ftOfferUrl(id: string): string {
  return `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(id)}`;
}
