import type { PrismaClient } from "@job-radar/db";
import { IDF_DEPARTMENTS, departmentFromText, parseProfile } from "@job-radar/shared";
import { findCompanySite } from "./company";
import { geocode } from "./geocode";
import type { Point, RoutingService } from "./types";

/** Au-delà, on arrête pour la journée (PRIM : 1 000 appels/jour pour un nouveau compte ; OSRM : usage raisonnable). */
export const DAILY_ROUTE_BUDGET = 800;

const round = (n: number, d: number) => n.toFixed(d);
export const originKeyOf = (p: Point) => `${round(p.lat, 3)},${round(p.lng, 3)}`;
/** Arrondi ~1 km : deux offres dans le même quartier partagent le même trajet (économise le quota). */
export const routeKeyOf = (provider: string, o: Point, d: Point) =>
  `${provider}|${round(o.lat, 3)},${round(o.lng, 3)}|${round(d.lat, 2)},${round(d.lng, 2)}`;

export type TravelMode = "car" | "transit";

/** Île-de-France → transports depuis la gare d'arrivée ; ailleurs (Oise…) ou département inconnu → voiture depuis le domicile. */
export const travelModeOf = (department: string | null): TravelMode =>
  department && IDF_DEPARTMENTS.includes(department) ? "transit" : "car";

export type TravelReport = { considered: number; computed: number; fromCache: number; geocoded: number; skipped: string | null };

/** Coordonnées mises en cache (GeocodeCache) : une requête n'est jamais refaite, même sans résultat. */
async function cachedPoint(prisma: PrismaClient, query: string, find: () => Promise<Point | null>, precision: "address" | "city_centroid") {
  const cached = await prisma.geocodeCache.findUnique({ where: { query } });
  if (cached) return { point: cached.lat != null && cached.lng != null ? { lat: cached.lat, lng: cached.lng } : null, fresh: false };
  const point = await find().catch(() => null);
  await prisma.geocodeCache.create({ data: { query, lat: point?.lat ?? null, lng: point?.lng ?? null, precision: point ? precision : "unknown" } });
  return { point, fresh: true };
}

/**
 * Calcule le temps de trajet de CERTAINES offres (celles qu'on ouvre, ou les nouvelles offres
 * susceptibles d'être notifiées) — pas de calcul en masse, pour ménager les quotas.
 * - Île-de-France : transports en commun depuis la gare d'arrivée du profil (Gare du Nord par défaut).
 * - Ailleurs : voiture depuis le domicile.
 * Lieu : adresse de l'annonce, sinon établissement de l'entreprise dans la ville de l'offre, sinon centre de la ville.
 * Jamais de durée inventée : pas d'itinéraire → minutes = null.
 */
export async function ensureTravelTimes(opts: {
  prisma: PrismaClient;
  transit: RoutingService;
  car: RoutingService;
  jobIds: string[];
  maxRoutes?: number;
  log?: (m: string) => void;
}): Promise<TravelReport> {
  const { prisma, log = () => {} } = opts;
  const report: TravelReport = { considered: 0, computed: 0, fromCache: 0, geocoded: 0, skipped: null };
  if (opts.jobIds.length === 0) return report;

  const row = await prisma.profile.findFirst({ select: { data: true, homeLat: true, homeLng: true } });
  const home = row?.homeLat != null && row.homeLng != null ? { lat: row.homeLat, lng: row.homeLng } : null;
  const hub = row ? parseProfile(row.data).transitHub : null;
  const modes: Record<TravelMode, { routing: RoutingService; origin: Point | null; missing: string }> = {
    transit: { routing: opts.transit, origin: hub, missing: "gare d'arrivée à Paris non renseignée (Profil)" },
    car: { routing: opts.car, origin: home, missing: "point de départ non renseigné" },
  };

  const jobs = await prisma.job.findMany({
    // `not: "99"` seul exclurait aussi les départements inconnus (NULL en SQL) : la ville ne serait jamais localisée.
    where: { id: { in: opts.jobIds }, remoteType: { not: "remote" }, OR: [{ department: null }, { department: { not: "99" } }] },
    select: {
      id: true, company: true, latitude: true, longitude: true, city: true, department: true, address: true, locationPrecision: true, userEdits: true,
      travel: { select: { mode: true, originKey: true, provider: true } },
    },
  });
  const since = new Date(Date.now() - 86_400_000);
  const usedToday = async (provider: string) => prisma.travelCache.count({ where: { createdAt: { gte: since }, key: { startsWith: `${provider}|` } } });
  let calls = 0;

  for (const job of jobs) {
    // Corrections à la main (page de l'offre) : elles décident du mode, comme à l'affichage (même règle qu'applyEdits).
    const edits = job.userEdits as { address?: string; department?: string } | null;
    const userAddress = edits?.address?.trim();
    const mode = travelModeOf(edits?.department ?? departmentFromText(userAddress) ?? job.department);
    const { routing, origin, missing } = modes[mode];
    if (!origin) {
      report.skipped = missing;
      continue;
    }
    if (!routing.isConfigured()) {
      report.skipped = `calcul d'itinéraire ${mode === "transit" ? "en transports (PRIM_API_KEY)" : "en voiture"} non configuré`;
      continue;
    }
    const originKey = originKeyOf(origin);
    // Déjà à jour : même mode, même départ, même calculateur (un calculateur amélioré refait le calcul).
    if (job.travel?.mode === mode && job.travel.originKey === originKey && job.travel.provider === routing.name) continue;
    report.considered++;

    let dest: Point | null = null;
    let precision: "address" | "city_centroid" = "city_centroid";
    // Adresse saisie à la main : prime sur tout, sans toucher aux coordonnées de la source.
    if (userAddress) {
      const r = await cachedPoint(prisma, userAddress, async () => (await geocode(userAddress))[0] ?? null, "address");
      if (r.fresh) report.geocoded++;
      dest = r.point;
    }
    if (dest) precision = "address";
    else if (job.latitude != null && job.longitude != null && job.locationPrecision === "address") {
      dest = { lat: job.latitude, lng: job.longitude };
      precision = "address";
    }
    // Adresse précise lue dans l'annonce.
    if (!dest && job.address && /\d/.test(job.address)) {
      const query = job.address.trim();
      const r = await cachedPoint(prisma, query, async () => (await geocode(query))[0] ?? null, "address");
      if (r.fresh) report.geocoded++;
      if (r.point) [dest, precision] = [r.point, "address"];
    }
    // Établissement de l'entreprise dans la ville de l'offre (API Recherche d'entreprises).
    if (!dest && job.company && (job.city || job.department)) {
      const query = `entreprise|${job.company}|${job.city ?? ""}|${job.department ?? ""}`;
      const r = await cachedPoint(prisma, query, () => findCompanySite(job.company!, { city: job.city, department: job.department }), "address");
      if (r.fresh) report.geocoded++;
      if (r.point) [dest, precision] = [r.point, "address"];
    }
    if (dest && !userAddress && precision === "address" && job.locationPrecision !== "address") {
      await prisma.job.update({ where: { id: job.id }, data: { latitude: dest.lat, longitude: dest.lng, locationPrecision: "address" } });
    }
    // Sinon : coordonnées déjà connues (centre de la ville), ou la commune à localiser.
    if (!dest && job.latitude != null && job.longitude != null) dest = { lat: job.latitude, lng: job.longitude };
    if (!dest && job.city) {
      const query = `${job.city} ${job.department ?? ""}`.trim();
      const r = await cachedPoint(prisma, query, async () => (await geocode(query, { cityOnly: true }))[0] ?? null, "city_centroid");
      if (r.fresh) report.geocoded++;
      dest = r.point;
      if (dest) await prisma.job.update({ where: { id: job.id }, data: { latitude: dest.lat, longitude: dest.lng, locationPrecision: "city_centroid" } });
    }
    if (!dest) continue;

    const key = routeKeyOf(routing.name, origin, dest);
    let minutes: number | null;
    const cached = await prisma.travelCache.findUnique({ where: { key } });
    if (cached) {
      minutes = cached.minutes;
      report.fromCache++;
    } else {
      if (calls >= (opts.maxRoutes ?? 20) || (await usedToday(routing.name)) >= DAILY_ROUTE_BUDGET) {
        report.skipped = "quota atteint : la suite sera calculée plus tard";
        break;
      }
      try {
        minutes = (await routing.estimateTravelTime(origin, dest)).minutes;
      } catch (err) {
        report.skipped = err instanceof Error ? err.message : String(err);
        log(`Trajets : ${report.skipped}`);
        break; // erreur (clé, quota…) : on ne gaspille pas d'appels
      }
      calls++;
      report.computed++;
      await prisma.travelCache.create({ data: { key, minutes } });
    }

    await prisma.travelEstimate.upsert({
      where: { jobId: job.id },
      create: { jobId: job.id, minutes, provider: routing.name, mode, precision, originKey },
      update: { minutes, provider: routing.name, mode, precision, originKey, computedAt: new Date() },
    });
  }
  if (report.computed || report.fromCache) {
    log(`Trajets : ${report.computed} calculé(s), ${report.fromCache} déjà connu(s), ${report.geocoded} lieu(x) localisé(s)`);
  }
  return report;
}

/**
 * Trajet entre deux points avec cache (même règle que pour les offres).
 * Renvoie undefined si le quota du jour est atteint (on réessaiera plus tard).
 */
export async function cachedTravelMinutes(
  prisma: PrismaClient,
  routing: RoutingService,
  origin: Point,
  dest: Point,
): Promise<number | null | undefined> {
  const key = routeKeyOf(routing.name, origin, dest);
  const cached = await prisma.travelCache.findUnique({ where: { key } });
  if (cached) return cached.minutes;
  const usedToday = await prisma.travelCache.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) }, key: { startsWith: `${routing.name}|` } } });
  if (usedToday >= DAILY_ROUTE_BUDGET) return undefined;
  const { minutes } = await routing.estimateTravelTime(origin, dest);
  await prisma.travelCache.create({ data: { key, minutes } });
  return minutes;
}
