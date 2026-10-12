import { z } from "zod";
import { RateLimiter } from "./rate-limiter";
import { FT_DEFAULTS } from "./france-travail/source";
import { type FetchLike, SourceHttpError, SourceUnavailableError } from "./types";

/**
 * La Bonne Boîte v2 (France Travail) : entreprises qui devraient recruter dans les 6 prochains mois.
 * Accès libre (licence Etalab, citer la source). Droits : « api_labonneboitev2 search ». 2 appels/s.
 * Adresse et droits vérifiés sur le compte de Chahine le 29/09/2026 (pnpm lbb:test).
 */
export const LBB = {
  baseUrl: "https://api.francetravail.io/partenaire/labonneboite/v2",
  scope: "api_labonneboitev2 search",
  minDelayMs: 600,
};

const num = z.union([z.number(), z.string()]).transform((v) => (v === "" ? null : Number(v))).nullable().optional();

export const LbbCompanySchema = z.looseObject({
  siret: z.string().min(9),
  company_name: z.string().nullable().optional(),
  office_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  rome: z.string().nullable().optional(),
  naf: z.string().nullable().optional(),
  naf_label: z.string().nullable().optional(),
  headcount_min: num,
  headcount_max: num,
  location: z.looseObject({ lat: z.number(), lon: z.number() }).nullable().optional(),
  city: z.string().nullable().optional(),
  citycode: z.string().nullable().optional(),
  postcode: z.string().nullable().optional(),
  department_number: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
  hiring_potential: z.number().nullable().optional(),
  is_high_potential: z.boolean().nullable().optional(),
});
export type LbbCompany = z.infer<typeof LbbCompanySchema>;

export type LbbSearch = {
  romes: string[];
  /** Autour d'un point (domicile)… */
  point?: { lat: number; lng: number; distanceKm: number };
  /** …ou dans des départements. */
  departments?: string[];
  maxResults?: number;
};

export class LaBonneBoiteClient {
  private readonly fetch: FetchLike;
  private readonly limiter: RateLimiter;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly opts: {
      clientId: string | undefined;
      clientSecret: string | undefined;
      fetch?: FetchLike;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.limiter = new RateLimiter(LBB.minDelayMs, opts.now, opts.sleep);
  }

  isConfigured() {
    return Boolean(this.opts.clientId && this.opts.clientSecret);
  }

  private async getToken(): Promise<string> {
    const now = this.opts.now?.() ?? Date.now();
    if (this.token && this.token.expiresAt - 60_000 > now) return this.token.value;
    if (!this.isConfigured()) throw new SourceUnavailableError("Identifiants France Travail absents de .env");
    const res = await this.limiter.schedule(() =>
      this.fetch(FT_DEFAULTS.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.opts.clientId!,
          client_secret: this.opts.clientSecret!,
          scope: LBB.scope,
        }),
      }),
    );
    if (!res.ok) throw new SourceHttpError(`Authentification La Bonne Boîte refusée (HTTP ${res.status})`, res.status);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return this.token.value;
  }

  async search(params: LbbSearch): Promise<LbbCompany[]> {
    const max = params.maxResults ?? 100;
    const pageSize = Math.min(max, 50);
    const out: LbbCompany[] = [];
    for (let page = 1; out.length < max && page <= 5; page++) {
      const q = new URLSearchParams({ page: String(page), page_size: String(pageSize), sort_by: "hiring_potential", sort_direction: "desc" });
      for (const r of params.romes) q.append("rome", r);
      if (params.point) {
        q.set("latitude", String(params.point.lat));
        q.set("longitude", String(params.point.lng));
        q.set("distance", String(params.point.distanceKm));
      } else {
        for (const d of params.departments ?? []) q.append("department_number", d);
      }
      const token = await this.getToken();
      const res = await this.limiter.schedule(() =>
        this.fetch(`${LBB.baseUrl}/recherche?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }),
      );
      if (res.status === 204) break;
      if (!res.ok) throw new SourceHttpError(`Recherche La Bonne Boîte en erreur (HTTP ${res.status})`, res.status);
      const body = (await res.json()) as { hits?: number; items?: unknown[] };
      const items = body.items ?? [];
      for (const it of items) {
        const c = LbbCompanySchema.safeParse(it);
        if (c.success) out.push(c.data);
      }
      if (items.length < pageSize || (body.hits !== undefined && page * pageSize >= body.hits)) break;
    }
    return out.slice(0, max);
  }
}

/** Fiche publique de l'entreprise sur le site La Bonne Boîte. */
export function lbbCompanyUrl(siret: string): string {
  return `https://labonneboite.francetravail.fr/entreprise/${encodeURIComponent(siret)}`;
}
