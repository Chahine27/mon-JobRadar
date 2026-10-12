import { RateLimiter, type FetchLike } from "@job-radar/source-connectors";
import type { Point, RoutingService, TravelEstimate } from "./types";

/**
 * Trajet en voiture avec OSRM (open source, données OpenStreetMap). Par défaut le serveur public de démonstration :
 * gratuit, sans clé, usage raisonnable (1 requête/s au plus, identifié par un User-Agent). Durée sans trafic.
 * Pour s'en passer : un OSRM local (Docker) et OSRM_URL dans .env.
 */
export const OSRM_DEFAULTS = {
  baseUrl: "https://router.project-osrm.org",
  minDelayMs: 1100,
};

export class OsrmRoutingService implements RoutingService {
  readonly name = "osrm-car";
  private readonly limiter: RateLimiter;
  private readonly fetch: FetchLike;

  constructor(private readonly opts: { baseUrl?: string; fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}) {
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.limiter = new RateLimiter(OSRM_DEFAULTS.minDelayMs, undefined, opts.sleep);
  }

  isConfigured() {
    return true;
  }

  async estimateTravelTime(origin: Point, destination: Point): Promise<TravelEstimate> {
    const coords = [origin, destination].map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const res = await this.limiter.schedule(() =>
      this.fetch(`${this.opts.baseUrl ?? OSRM_DEFAULTS.baseUrl}/route/v1/driving/${coords}?overview=false`, {
        headers: { Accept: "application/json", "User-Agent": "JobRadar/1.0 (usage personnel)" },
      }),
    );
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; routes?: Array<{ duration?: number }> };
    // Pas de route (point dans la mer, île...) : réponse normale, pas une panne.
    if (body.code === "NoRoute" || body.code === "NoSegment") return { minutes: null, provider: this.name, reason: body.code };
    if (!res.ok || body.code !== "Ok") throw new Error(`Calcul d'itinéraire OSRM en erreur (HTTP ${res.status}${body.message ? ` : ${body.message}` : ""})`);
    const seconds = body.routes?.[0]?.duration;
    return { minutes: typeof seconds === "number" ? Math.round(seconds / 60) : null, provider: this.name };
  }
}
