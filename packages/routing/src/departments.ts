import type { PrismaClient } from "@job-radar/db";
import { IDF_DEPARTMENTS, parseProfile } from "@job-radar/shared";
import type { FetchLike } from "@job-radar/source-connectors";
import { GEOCODE_URL } from "./geocode";

type Feature = { geometry?: { coordinates?: [number, number] }; properties?: { name?: string; citycode?: string } };
type Commune = { name: string; department: string; lat: number | null; lng: number | null };

const key = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Commune → département et centre (géocodeur de l'IGN, déjà utilisé pour les trajets : gratuit, ~150 ms ; l'API
 * « communes » de l'État mettait jusqu'à 25 s). Seulement un nom identique ; plusieurs communes du même nom
 * (Saint-Denis 93 / 974, Châtillon…) : celle de tes zones, sinon celle d'Île-de-France (les recherches visent
 * Paris et ses environs), sinon on ne devine pas.
 */
export async function communeOf(
  city: string,
  zones: string[],
  fetch: FetchLike = (i, init) => globalThis.fetch(i, init),
): Promise<{ department: string; lat: number | null; lng: number | null } | null> {
  const params = new URLSearchParams({ q: city.slice(0, 200), index: "address", type: "municipality", limit: "10" });
  const res = await fetch(`${GEOCODE_URL}?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Recherche de commune en erreur (HTTP ${res.status})`);
  const same = (((await res.json()) as { features?: Feature[] }).features ?? []).flatMap((f): Commune[] => {
    const code = f.properties?.citycode;
    if (!code || key(f.properties?.name ?? "") !== key(city)) return [];
    const [lng, lat] = f.geometry?.coordinates ?? [];
    return [{ name: f.properties!.name!, department: code.slice(0, code.startsWith("97") ? 3 : 2), lat: lat ?? null, lng: lng ?? null }];
  });
  const pick =
    same.length === 1 ? same[0] : (same.find((c) => zones.includes(c.department)) ?? same.find((c) => IDF_DEPARTMENTS.includes(c.department)));
  return pick ? { department: pick.department, lat: pick.lat, lng: pick.lng } : null;
}

/** Pays ou région, pas une commune (« Île-de-France », « France ») : l'API met ~20 s à ne rien trouver. */
const NOT_A_CITY = /^(france|ile de france|hauts de france|grand est|normandie|bretagne|occitanie|nouvelle aquitaine|auvergne rhone alpes|bourgogne franche comte|centre val de loire|pays de la loire|provence alpes cote d azur|corse|region parisienne|teletravail|remote)$/;

// ponytail: cache en mémoire (une requête par ville et par démarrage) ; une table si les villes inconnues se comptent par centaines.
const cache = new Map<string, Awaited<ReturnType<typeof communeOf>>>();

/**
 * Offres dont on connaît la ville mais pas le département (LinkedIn : « Suresnes », « Vitry-sur-Seine »…) :
 * sans lui, le lieu était noté « non précisé » et le trajet calculé en voiture au lieu des transports (Île-de-France).
 * Le département (et le centre de la commune, si l'offre n'a pas encore de coordonnées) est complété.
 */
export async function fillDepartments(opts: {
  prisma: PrismaClient;
  fetch?: FetchLike;
  /** Villes nouvelles interrogées au plus par passage. */
  max?: number;
  log?: (m: string) => void;
}): Promise<{ cities: number; filled: number }> {
  const { prisma, log = () => {} } = opts;
  const jobs = await prisma.job.findMany({
    where: { department: null, city: { not: null }, status: { in: ["NEW", "SEEN", "SAVED", "APPLIED"] }, remoteType: { not: "remote" } },
    select: { id: true, city: true },
  });
  if (jobs.length === 0) return { cities: 0, filled: 0 };
  const row = await prisma.profile.findFirst({ select: { data: true } });
  const zones = row ? parseProfile(row.data).locations.map((l) => l.department).filter((d): d is string => !!d) : [];
  const byCity = new Map<string, string[]>();
  for (const j of jobs) byCity.set(j.city!, [...(byCity.get(j.city!) ?? []), j.id]);

  let asked = 0;
  let filled = 0;
  let errors = 0;
  for (const [city, ids] of byCity) {
    if (NOT_A_CITY.test(key(city))) continue;
    if (!cache.has(key(city))) {
      if (asked >= (opts.max ?? 40)) continue;
      asked++;
      try {
        cache.set(key(city), await communeOf(city, zones, opts.fetch));
      } catch (err) {
        log(`Départements (${city}) : ${err instanceof Error ? err.message : String(err)}`);
        if (++errors >= 3) break; // service indisponible : on réessaiera au prochain passage
        continue;
      }
    }
    const c = cache.get(key(city));
    if (!c) continue;
    await prisma.job.updateMany({ where: { id: { in: ids } }, data: { department: c.department } });
    if (c.lat !== null && c.lng !== null) {
      await prisma.job.updateMany({
        where: { id: { in: ids }, latitude: null },
        data: { latitude: c.lat, longitude: c.lng, locationPrecision: "city_centroid" },
      });
    }
    filled += ids.length;
  }
  if (filled) log(`Départements complétés depuis la ville : ${filled} offre(s)`);
  return { cities: asked, filled };
}
