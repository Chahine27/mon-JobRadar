import { departmentName } from "@job-radar/shared";
import { z } from "zod";
import { RateLimiter } from "./rate-limiter";
import {
  type FetchLike,
  type JobSource,
  type RawJob,
  type SearchParams,
  type SourceHealth,
  SourceHttpError,
  SourceUnavailableError,
} from "./types";

export const JOOBLE_SOURCE = "jooble";

/**
 * Jooble (moteur qui regroupe les offres de nombreux sites d'emploi).
 * Clé gratuite, propre à chaque pays : celle de fr.jooble.org ne sert que pour la France.
 * ⚠️ Offre gratuite : 500 appels AU TOTAL par clé (pas par jour ni par mois). Tout est fait pour économiser :
 *  - une seule recherche par zone, qui regroupe toutes les recherches du profil ;
 *  - au plus une collecte toutes les 20 h, même avec le bouton « Actualiser » ;
 *  - arrêt à 480 appels (réserve pour les tests).
 */
export const JOOBLE_DEFAULTS = {
  baseUrl: "https://fr.jooble.org/api",
  lifetimeLimit: 500,
  stopAt: 480,
  minHoursBetweenRuns: 20,
  resultsPerPage: 50,
  minDelayMs: 1500,
};

export const JoobleJobSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  title: z.string().optional(),
  location: z.string().optional(),
  snippet: z.string().optional(),
  salary: z.string().optional(),
  source: z.string().optional(),
  type: z.string().optional(),
  link: z.string().optional(),
  company: z.string().optional(),
  updated: z.string().optional(),
  /** Ajouté par Job Radar : zone de la recherche (sert si le lieu de l'offre est illisible). */
  _searchDepartment: z.string().optional(),
});
export type JoobleJob = z.infer<typeof JoobleJobSchema>;

/**
 * Identifiant stable : pris dans le lien (…/jdp/1234567890123456789) plutôt que dans `id`,
 * car les grands nombres perdent leurs derniers chiffres une fois lus en JavaScript.
 */
export function joobleJobId(job: JoobleJob): string | null {
  // Le lien contient l'identifiant complet (…/desc/-7394620418537293123, …/jdp/123…, …/away/123…).
  const path = job.link?.split("?")[0] ?? "";
  const fromLink = path.match(/\/(-?\d{6,})(?:\/|$)/)?.[1];
  if (fromLink) return fromLink;
  if (typeof job.id === "string" && job.id.trim()) return job.id.trim();
  if (typeof job.id === "number" && Number.isSafeInteger(job.id)) return String(job.id);
  // Dernier recours : le lien lui-même (stable d'une collecte à l'autre).
  if (path) return `url:${path.replace(/^https?:\/\/[^/]+/, "")}`;
  if (typeof job.id === "number" && Number.isFinite(job.id)) return String(job.id);
  return null;
}

/** Compteur d'appels, gardé en base par l'appelant (la clé gratuite a un total à vie). */
export interface JoobleQuotaStore {
  get(): Promise<{ used: number; lastCallAt: Date | null }>;
  /** `at` = null : appel de test, compté mais sans bloquer la prochaine collecte. */
  record(calls: number, at: Date | null): Promise<void>;
}

export class JoobleSource implements JobSource {
  readonly name = JOOBLE_SOURCE;
  private readonly fetch: FetchLike;
  private readonly limiter: RateLimiter;
  private readonly now: () => number;

  constructor(
    private readonly opts: {
      apiKey: string | undefined;
      quota: JoobleQuotaStore;
      fetch?: FetchLike;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      baseUrl?: string;
    },
  ) {
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.now = opts.now ?? Date.now;
    this.limiter = new RateLimiter(JOOBLE_DEFAULTS.minDelayMs, this.now, opts.sleep);
  }

  private key(): string {
    const k = this.opts.apiKey?.trim();
    if (!k) throw new SourceUnavailableError("Clé Jooble absente (JOOBLE_API_KEY dans .env)");
    if (!/^[A-Za-z0-9-]{8,100}$/.test(k)) throw new SourceUnavailableError("Clé Jooble invalide (JOOBLE_API_KEY)");
    return k;
  }

  /** Un appel = une page de résultats. Ne compte PAS dans le quota (voir searchAll). */
  private async call(keywords: string, location: string): Promise<JoobleJob[]> {
    const url = `${this.opts.baseUrl ?? JOOBLE_DEFAULTS.baseUrl}/${encodeURIComponent(this.key())}`;
    const body = JSON.stringify({ keywords, location, page: "1", ResultOnPage: String(JOOBLE_DEFAULTS.resultsPerPage) });
    const res = await this.limiter.schedule(() =>
      this.fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body }),
    );
    if (res.status === 403) throw new SourceUnavailableError("Jooble refuse la clé (HTTP 403) : clé fausse, ou clé d'un autre pays que la France");
    // Ne jamais afficher l'URL (elle contient la clé).
    if (!res.ok) throw new SourceHttpError(`Recherche Jooble en erreur (HTTP ${res.status})`, res.status);
    const parsed = z.looseObject({ jobs: z.array(z.unknown()).optional() }).parse(await res.json());
    return (parsed.jobs ?? []).flatMap((j) => {
      const r = JoobleJobSchema.safeParse(j);
      return r.success ? [r.data] : [];
    });
  }

  /**
   * Toutes les recherches du profil en un minimum d'appels : une par zone,
   * avec les mots-clés regroupés (« Développeur Vue.js, Développeur frontend »).
   */
  async searchAll(queries: SearchParams[]): Promise<{ jobs: RawJob[]; errors: string[]; skipped?: string }> {
    this.key();
    const byZone = new Map<string, string[]>();
    for (const q of queries) {
      const zone = q.department ?? "";
      const list = byZone.get(zone) ?? [];
      if (!list.includes(q.keywords)) list.push(q.keywords);
      byZone.set(zone, list);
    }

    const { used, lastCallAt } = await this.opts.quota.get();
    const now = this.now();
    if (lastCallAt && now - lastCallAt.getTime() < JOOBLE_DEFAULTS.minHoursBetweenRuns * 3_600_000) {
      return { jobs: [], errors: [], skipped: "déjà interrogé il y a moins de 20 h (quota limité)" };
    }
    if (used + byZone.size > JOOBLE_DEFAULTS.stopAt) {
      throw new SourceUnavailableError(
        `Quota Jooble épuisé : ${used} appels utilisés sur ${JOOBLE_DEFAULTS.lifetimeLimit}. Demande une nouvelle clé sur fr.jooble.org/api/about.`,
      );
    }

    const jobs: RawJob[] = [];
    const errors: string[] = [];
    let calls = 0;
    try {
      for (const [zone, keywords] of byZone) {
        const location = zone ? (departmentName(zone) ?? zone) : "France";
        try {
          calls++;
          const found = await this.call(keywords.join(", "), location);
          const collectedAt = new Date(this.now());
          let dropped = 0;
          for (const j of found) {
            const id = joobleJobId(j);
            if (!id) {
              dropped++;
              continue;
            }
            jobs.push({ source: JOOBLE_SOURCE, sourceJobId: id, data: { ...j, ...(zone ? { _searchDepartment: zone } : {}) }, collectedAt });
          }
          if (dropped) errors.push(`${location} : ${dropped} offre(s) sans identifiant ignorée(s)`);
        } catch (err) {
          if (err instanceof SourceUnavailableError) throw err;
          errors.push(`${location} : ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      if (calls > 0) await this.opts.quota.record(calls, new Date(this.now()));
    }
    return { jobs, errors };
  }

  /** Test de la clé : UN appel réel (compté dans le quota), sans retarder la prochaine collecte. */
  async testCall(keywords: string, department: string): Promise<{ count: number; sample: JoobleJob | null }> {
    const { used } = await this.opts.quota.get();
    if (used >= JOOBLE_DEFAULTS.stopAt) throw new SourceUnavailableError(`Quota Jooble épuisé (${used}/${JOOBLE_DEFAULTS.lifetimeLimit})`);
    try {
      const found = await this.call(keywords, departmentName(department) ?? department);
      return { count: found.length, sample: found[0] ?? null };
    } finally {
      await this.opts.quota.record(1, null);
    }
  }

  async search(params: SearchParams): Promise<RawJob[]> {
    const r = await this.searchAll([params]);
    return r.jobs;
  }

  /** Ne fait AUCUN appel (chaque appel compte dans le quota à vie) : vérifie seulement la clé et le compteur. */
  async healthCheck(): Promise<SourceHealth> {
    try {
      this.key();
      const { used } = await this.opts.quota.get();
      if (used >= JOOBLE_DEFAULTS.stopAt) return { status: "ERROR", message: `Quota Jooble épuisé (${used}/${JOOBLE_DEFAULTS.lifetimeLimit})` };
      return { status: "OK" };
    } catch (err) {
      if (err instanceof SourceUnavailableError) return { status: "SOURCE_UNAVAILABLE", message: err.message };
      return { status: "ERROR", message: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Compteur en mémoire (tests, script de test sans base). */
export function memoryJoobleQuota(initial = 0): JoobleQuotaStore & { used: number } {
  const state = { used: initial, lastCallAt: null as Date | null };
  return {
    get used() {
      return state.used;
    },
    async get() {
      return { used: state.used, lastCallAt: state.lastCallAt };
    },
    async record(calls, at) {
      state.used += calls;
      if (at) state.lastCallAt = at;
    },
  };
}
