import { DEFAULT_PROFILE } from "@job-radar/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase, testPrisma } from "../../db/test/helpers";

// Le géocodeur et la recherche d'entreprise appellent des sites publics : remplacés par des réponses fixes.
const geocodeCalls: Array<{ query: string; opts: unknown }> = [];
let geocodeAnswer: (query: string, opts: { cityOnly?: boolean; department?: string | null } | undefined) => Array<{ lat: number; lng: number; label: string; precision: "address" | "city_centroid" }> = () => [];
vi.mock("./geocode", () => ({
  geocode: async (query: string, opts?: { cityOnly?: boolean; department?: string | null }) => {
    geocodeCalls.push({ query, opts });
    return geocodeAnswer(query, opts);
  },
}));
vi.mock("./company", () => ({ findCompanySite: async () => null }));

const { ensureTravelTimes, DAILY_ROUTE_BUDGET } = await import("./travel");

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

const HOME = { lat: 49.2, lng: 2.5 };
const routing = (minutes: number | (() => never), name = "osrm", configured = true) => {
  const calls: Array<{ o: unknown; d: unknown }> = [];
  return {
    name,
    calls,
    isConfigured: () => configured,
    estimateTravelTime: async (o: unknown, d: unknown) => {
      calls.push({ o, d });
      return { minutes: typeof minutes === "function" ? minutes() : minutes, provider: name };
    },
  };
};
const transit = routing(30, "prim");

let n = 0;
const job = (data: object = {}) =>
  prisma.job.create({ data: { fingerprint: `t${++n}`, contentHash: "h", title: `Dev ${n}`, description: "x", technologies: [], department: "60", city: "Creil", ...data } });
const estimate = (jobId: string) => prisma.travelEstimate.findUnique({ where: { jobId } });

beforeEach(async () => {
  await resetDatabase(prisma);
  geocodeCalls.length = 0;
  geocodeAnswer = () => [];
  await prisma.user.create({ data: { email: "t@t.fr", passwordHash: "x", profile: { create: { data: DEFAULT_PROFILE, homeLat: HOME.lat, homeLng: HOME.lng } } } });
});

describe("temps de trajet des offres (base réelle, calculateur et géocodeur simulés)", () => {
  it("coordonnées précises : trajet calculé et gardé ; relancé, rien à refaire", async () => {
    const car = routing(42);
    const j = await job({ latitude: 49.26, longitude: 2.48, locationPrecision: "address" });
    const r = await ensureTravelTimes({ prisma, transit, car, jobIds: [j.id] });
    expect(r).toMatchObject({ considered: 1, computed: 1, fromCache: 0, geocoded: 0, skipped: null });
    expect(await estimate(j.id)).toMatchObject({ minutes: 42, provider: "osrm", mode: "car", precision: "address" });
    expect(await prisma.travelCache.count()).toBe(1);
    // Déjà à jour (même mode, même départ, même calculateur) : pas même un calcul.
    expect((await ensureTravelTimes({ prisma, transit, car, jobIds: [j.id] })).considered).toBe(0);
    expect(car.calls).toHaveLength(1);
  });

  it("deux offres dans le même quartier : le second trajet vient du cache", async () => {
    const car = routing(42);
    const a = await job({ latitude: 49.2601, longitude: 2.4801, locationPrecision: "address" });
    const b = await job({ latitude: 49.2602, longitude: 2.4802, locationPrecision: "address" });
    const r = await ensureTravelTimes({ prisma, transit, car, jobIds: [a.id, b.id] });
    expect(r).toMatchObject({ considered: 2, computed: 1, fromCache: 1 });
    expect((await estimate(b.id))?.minutes).toBe(42);
    expect(car.calls).toHaveLength(1);
  });

  it("ville seule : localisée une fois (cache), position gardée sur l'offre", async () => {
    geocodeAnswer = () => [{ lat: 49.27, lng: 2.47, label: "Creil", precision: "city_centroid" }];
    const car = routing(35);
    const j = await job();
    const r = await ensureTravelTimes({ prisma, transit, car, jobIds: [j.id] });
    expect(r).toMatchObject({ computed: 1, geocoded: 1 });
    expect(geocodeCalls).toEqual([{ query: "Creil 60", opts: { cityOnly: true } }]);
    expect(await estimate(j.id)).toMatchObject({ minutes: 35, precision: "city_centroid" });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).toMatchObject({ latitude: 49.27, longitude: 2.47, locationPrecision: "city_centroid" });
    expect(await prisma.geocodeCache.count()).toBe(1);
  });

  it("adresse avec son département : le résultat est demandé dans ce département, la position précise est gardée", async () => {
    geocodeAnswer = (_q, opts) => (opts?.cityOnly ? [] : [{ lat: 49.43, lng: 2.08, label: "Beauvais", precision: "address" }]);
    const car = routing(40);
    const j = await job({ address: "12 rue de Paris 60000 Beauvais", city: "Beauvais" });
    await ensureTravelTimes({ prisma, transit, car, jobIds: [j.id] });
    expect(geocodeCalls[0]).toEqual({ query: "12 rue de Paris 60000 Beauvais", opts: { department: "60" } });
    expect(await estimate(j.id)).toMatchObject({ minutes: 40, precision: "address" });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).toMatchObject({ latitude: 49.43, locationPrecision: "address" });
  });

  it("« Beauvais (60), locaux » introuvable à l'adresse : le centre de la ville écrite dans l'adresse", async () => {
    geocodeAnswer = (_q, opts) => (opts?.cityOnly ? [{ lat: 49.43, lng: 2.08, label: "Beauvais", precision: "city_centroid" }] : []);
    const car = routing(36);
    const j = await job({ address: "Beauvais (60), locaux Groupe ISAGRI", city: "Oise", latitude: 49.4, longitude: 2.4, locationPrecision: "city_centroid" });
    await ensureTravelTimes({ prisma, transit, car, jobIds: [j.id] });
    expect(geocodeCalls.at(-1)).toEqual({ query: "Beauvais 60", opts: { cityOnly: true, department: "60" } });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).toMatchObject({ latitude: 49.43, longitude: 2.08, locationPrecision: "city_centroid" });
  });

  it("Île-de-France : transports depuis la gare d'arrivée du profil", async () => {
    const car = routing(99);
    const j = await job({ department: "75", city: "Paris", latitude: 48.86, longitude: 2.35, locationPrecision: "address" });
    await ensureTravelTimes({ prisma, transit, car, jobIds: [j.id] });
    expect(await estimate(j.id)).toMatchObject({ minutes: 30, provider: "prim", mode: "transit" });
    expect(car.calls).toHaveLength(0);
  });

  it("quota de ce passage : la suite attend, rien n'est inventé", async () => {
    const car = routing(42);
    const a = await job({ latitude: 49.26, longitude: 2.48, locationPrecision: "address" });
    const b = await job({ latitude: 49.5, longitude: 2.9, locationPrecision: "address" });
    const r = await ensureTravelTimes({ prisma, transit, car, jobIds: [a.id, b.id], maxRoutes: 1 });
    expect(r).toMatchObject({ computed: 1, skipped: "quota atteint : la suite sera calculée plus tard" });
    expect(await estimate(a.id)).not.toBeNull();
    expect(await estimate(b.id)).toBeNull();
  });

  it("quota du jour déjà atteint pour ce calculateur", async () => {
    const car = routing(42);
    await prisma.travelCache.createMany({ data: Array.from({ length: DAILY_ROUTE_BUDGET }, (_, i) => ({ key: `osrm|${i}`, minutes: 1 })) });
    const j = await job({ latitude: 49.26, longitude: 2.48, locationPrecision: "address" });
    const r = await ensureTravelTimes({ prisma, transit, car, jobIds: [j.id] });
    expect(r.skipped).toBe("quota atteint : la suite sera calculée plus tard");
    expect(car.calls).toHaveLength(0);
  });

  it("erreur du calculateur : on s'arrête sans gaspiller d'appels, avec le message", async () => {
    const car = routing(() => { throw new Error("clé refusée"); });
    const a = await job({ latitude: 49.26, longitude: 2.48, locationPrecision: "address" });
    const b = await job({ latitude: 49.5, longitude: 2.9, locationPrecision: "address" });
    const logs: string[] = [];
    const r = await ensureTravelTimes({ prisma, transit, car, jobIds: [a.id, b.id], log: (m) => logs.push(m) });
    expect(r).toMatchObject({ computed: 0, skipped: "clé refusée" });
    expect(car.calls).toHaveLength(1);
    expect(logs).toContain("Trajets : clé refusée");
    expect(await prisma.travelEstimate.count()).toBe(0);
  });

  it("calculateur non configuré, ou point de départ absent : offre sautée avec la raison", async () => {
    const j = await job({ latitude: 49.26, longitude: 2.48, locationPrecision: "address" });
    expect((await ensureTravelTimes({ prisma, transit, car: routing(42, "osrm", false), jobIds: [j.id] })).skipped).toBe("calcul d'itinéraire en voiture non configuré");
    await prisma.profile.updateMany({ data: { homeLat: null, homeLng: null } });
    expect((await ensureTravelTimes({ prisma, transit, car: routing(42), jobIds: [j.id] })).skipped).toBe("point de départ non renseigné");
    expect(await estimate(j.id)).toBeNull();
  });

  it("télétravail complet et département 99 : jamais calculés ; adresse saisie à la main : elle prime", async () => {
    geocodeAnswer = (q) => (q === "1 rue Saisie 60100 Creil" ? [{ lat: 49.25, lng: 2.46, label: "x", precision: "address" }] : []);
    const car = routing(25);
    const remote = await job({ remoteType: "remote", latitude: 49.26, longitude: 2.48, locationPrecision: "address" });
    const abroad = await job({ department: "99", latitude: 40, longitude: 2, locationPrecision: "address" });
    const edited = await job({ latitude: 49.9, longitude: 2.9, locationPrecision: "address", userEdits: { address: " 1 rue Saisie 60100 Creil " } });
    await ensureTravelTimes({ prisma, transit, car, jobIds: [remote.id, abroad.id, edited.id] });
    expect(await estimate(remote.id)).toBeNull();
    expect(await estimate(abroad.id)).toBeNull();
    expect(await estimate(edited.id)).toMatchObject({ minutes: 25, precision: "address" });
    expect(car.calls[0]!.d).toMatchObject({ lat: 49.25, lng: 2.46 });
    // Les coordonnées de la source ne sont pas touchées par l'adresse saisie.
    expect(await prisma.job.findUniqueOrThrow({ where: { id: edited.id } })).toMatchObject({ latitude: 49.9, longitude: 2.9 });
  });
});
