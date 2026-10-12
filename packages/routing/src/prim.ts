import { RateLimiter, type FetchLike } from "@job-radar/source-connectors";
import type { Point, RoutingService, TravelEstimate } from "./types";

/**
 * Calculateur Île-de-France Mobilités (PRIM, moteur Navitia).
 * Nouveaux comptes : 5 appels/s, 1 000 appels/jour. Couvre les réseaux d'Île-de-France :
 * certains trajets depuis l'Oise peuvent ne pas être trouvés → null.
 */
export const PRIM_DEFAULTS = {
  baseUrl: "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia",
  minDelayMs: 300,
};

const coord = (p: Point) => `${p.lng.toFixed(6)};${p.lat.toFixed(6)}`;

/** Prochain jour ouvré à 8 h 00 : un trajet domicile-travail représentatif. */
export function nextWeekdayMorning(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T080000`;
}

export class PrimRoutingService implements RoutingService {
  /** « -gare » : depuis la station (v2) ; les trajets calculés avant depuis le parvis sont refaits. */
  readonly name = "prim-idfm-gare";
  private readonly limiter: RateLimiter;
  private readonly fetch: FetchLike;

  constructor(
    private readonly opts: {
      apiKey: string | undefined;
      baseUrl?: string;
      fetch?: FetchLike;
      now?: () => Date;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.limiter = new RateLimiter(PRIM_DEFAULTS.minDelayMs, undefined, opts.sleep);
  }

  isConfigured() {
    return Boolean(this.opts.apiKey);
  }

  /**
   * Départ DEPUIS la station la plus proche (à 300 m près) plutôt que depuis le point : on descend du train dans la gare,
   * pas sur le parvis (sinon ~4 min de marche en trop). Pas de station proche → le point lui-même.
   */
  private async originOf(origin: Point): Promise<string> {
    const key = coord(origin);
    let id = this.stations.get(key);
    if (id === undefined) {
      const q = new URLSearchParams({ "type[]": "stop_area", distance: "300", count: "1" });
      const res = await this.limiter.schedule(() =>
        this.fetch(`${this.opts.baseUrl ?? PRIM_DEFAULTS.baseUrl}/coord/${key}/places_nearby?${q}`, {
          headers: { apiKey: this.opts.apiKey!, Accept: "application/json" },
        }),
      );
      const body = (await res.json().catch(() => ({}))) as { places_nearby?: Array<{ id?: string; embedded_type?: string }> };
      id = res.ok ? (body.places_nearby?.find((p) => p.embedded_type === "stop_area")?.id ?? null) : null;
      this.stations.set(key, id);
    }
    return id ?? key;
  }
  private readonly stations = new Map<string, string | null>();

  async estimateTravelTime(origin: Point, destination: Point): Promise<TravelEstimate> {
    if (!this.opts.apiKey) throw new Error("Clé PRIM absente (PRIM_API_KEY dans .env)");
    const q = new URLSearchParams({
      from: await this.originOf(origin),
      to: coord(destination),
      datetime: nextWeekdayMorning(this.opts.now?.() ?? new Date()),
      datetime_represents: "departure",
      count: "5",
    });
    const res = await this.limiter.schedule(() =>
      this.fetch(`${this.opts.baseUrl ?? PRIM_DEFAULTS.baseUrl}/journeys?${q}`, {
        headers: { apiKey: this.opts.apiKey!, Accept: "application/json" },
      }),
    );
    const body = (await res.json().catch(() => ({}))) as {
      journeys?: Array<{ duration?: number }>;
      error?: { id?: string; message?: string };
    };
    // Navitia répond 404 + error.id quand il n'y a pas d'itinéraire (départ/arrivée hors zone, etc.).
    // Un autre 404 (mauvaise adresse d'API) est une vraie erreur : on ne la cache pas.
    const noRoute = ["no_solution", "no_origin", "no_destination", "no_origin_nor_destination", "unknown_object"];
    if (body.error?.id && noRoute.includes(body.error.id)) return { minutes: null, provider: this.name, reason: body.error.id };
    if (!res.ok) {
      throw new Error(`Calcul d'itinéraire PRIM en erreur (HTTP ${res.status}${body.error?.message ? ` : ${body.error.message}` : ""})`);
    }
    const durations = (body.journeys ?? []).map((j) => j.duration).filter((d): d is number => typeof d === "number" && d > 0);
    if (durations.length === 0) return { minutes: null, provider: this.name };
    return { minutes: Math.round(Math.min(...durations) / 60), provider: this.name };
  }
}
