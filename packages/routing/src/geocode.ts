import type { FetchLike } from "@job-radar/source-connectors";
import type { GeocodeResult } from "./types";

/** Géoplateforme (IGN) : gratuit, sans clé, 50 requêtes/s par adresse IP. */
export const GEOCODE_URL = "https://data.geopf.fr/geocodage/search";

type Feature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    label?: string;
    score?: number;
    type?: string;
    name?: string | string[];
    toponym?: string;
    city?: string | string[];
    postcode?: string | string[];
  };
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Un point [lng, lat] (les lieux « poi » peuvent avoir d'autres géométries : on les ignore). */
function pointOf(f: Feature): [number, number] | null {
  const c = f.geometry?.coordinates;
  return Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number" ? [c[0], c[1]] : null;
}

function labelOf(f: Feature, fallback: string): string {
  const p = f.properties ?? {};
  if (p.label) return p.label;
  return [first(p.name) ?? p.toponym, first(p.postcode), first(p.city)].filter(Boolean).join(" ") || fallback;
}

async function search(
  fetch: FetchLike,
  q: string,
  index: "address" | "poi",
  limit: number,
  cityOnly: boolean,
): Promise<Feature[]> {
  const params = new URLSearchParams({ q: q.slice(0, 200), limit: String(limit), index });
  if (cityOnly && index === "address") params.set("type", "municipality");
  const res = await fetch(`${GEOCODE_URL}?${params}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Géocodage en erreur (HTTP ${res.status})`);
  return ((await res.json()) as { features?: Feature[] }).features ?? [];
}

/**
 * Adresse, gare ou ville → coordonnées. Cherche d'abord dans les adresses (BAN), puis dans les lieux
 * nommés (gares, bâtiments… : index « poi »). Résultat peu sûr (score < 0,3) → écarté plutôt qu'un faux point.
 */
export async function geocode(
  query: string,
  opts: { fetch?: FetchLike; cityOnly?: boolean; limit?: number; debug?: (features: Feature[]) => void } = {},
): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
  const limit = opts.limit ?? 1;
  const toResults = (features: Feature[]) =>
    features
      .filter((f) => (f.properties?.score ?? 1) >= 0.3 && pointOf(f))
      .map((f) => {
        const [lng, lat] = pointOf(f)!;
        return {
          lat,
          lng,
          label: labelOf(f, q),
          precision: f.properties?.type === "municipality" ? ("city_centroid" as const) : ("address" as const),
        };
      });

  if (opts.cityOnly) {
    const cities = await search(fetch, q, "address", limit, true);
    opts.debug?.(cities);
    return toResults(cities);
  }
  // Adresses (BAN) ET lieux nommés (gares…), puis on garde les meilleurs scores :
  // « gare de Creil » doit donner la gare de Creil, pas une « rue de la Gare » ailleurs en France.
  const [addresses, pois] = await Promise.all([
    search(fetch, q, "address", Math.max(limit, 5), false),
    search(fetch, q, "poi", Math.max(limit, 5), false).catch(() => [] as Feature[]),
  ]);
  opts.debug?.([...addresses, ...pois]);
  const all = [...pois, ...addresses].sort((a, b) => (b.properties?.score ?? 0) - (a.properties?.score ?? 0));
  const seen = new Set<string>();
  return toResults(all)
    .filter((r) => {
      const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
