import { describe, expect, it } from "vitest";
import { geocode } from "./geocode";
import { PrimRoutingService, nextWeekdayMorning } from "./prim";
import { originKeyOf, routeKeyOf, travelModeOf } from "./travel";
import { OsrmRoutingService } from "./osrm";
import { findCompanySite } from "./company";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("géocodage", () => {
  it("renvoie les coordonnées et ignore les résultats peu sûrs", async () => {
    const urls: string[] = [];
    const res = await geocode("Gare de Compiègne", {
      fetch: async (u) => {
        urls.push(u);
        return json({
          features: [
            { geometry: { coordinates: [2.8267, 49.4214] }, properties: { label: "Place de la Gare 60200 Compiègne", score: 0.82, type: "street" } },
            { geometry: { coordinates: [0, 0] }, properties: { label: "???", score: 0.2, type: "street" } },
          ],
        });
      },
      limit: 2,
    });
    expect(res).toEqual([{ lat: 49.4214, lng: 2.8267, label: "Place de la Gare 60200 Compiègne", precision: "address" }]);
    expect(new URL(urls[0]!).hostname).toBe("data.geopf.fr");
  });

  it("rien dans les adresses → cherche dans les lieux nommés (gares)", async () => {
    const indexes: string[] = [];
    const res = await geocode("gare de Creil", {
      fetch: async (u) => {
        const idx = new URL(u).searchParams.get("index")!;
        indexes.push(idx);
        if (idx === "address") return json({ features: [] });
        return json({
          features: [{ geometry: { type: "Point", coordinates: [2.4686, 49.2635] }, properties: { name: ["Gare de Creil"], city: ["Creil"], postcode: ["60100"], score: 0.7 } }],
        });
      },
    });
    expect(indexes.sort()).toEqual(["address", "poi"]);
    expect(res[0]).toMatchObject({ lat: 49.2635, lng: 2.4686, label: "Gare de Creil 60100 Creil" });
  });

  it("garde le meilleur score entre adresses et lieux nommés", async () => {
    const res = await geocode("gare de Creil", {
      fetch: async (u) =>
        new URL(u).searchParams.get("index") === "address"
          ? json({ features: [{ geometry: { coordinates: [5.13, 48.49] }, properties: { label: "Rue de la Gare 52300 Curel", score: 0.55 } }] })
          : json({ features: [{ geometry: { coordinates: [2.4686, 49.2635] }, properties: { name: "Gare de Creil", city: "Creil", score: 0.9 } }] }),
    });
    expect(res[0]!.label).toBe("Gare de Creil Creil");
  });

  it("requête trop courte → rien", async () => {
    expect(await geocode("a", { fetch: async () => json({}) })).toEqual([]);
  });
});

describe("PRIM", () => {
  const origin = { lat: 49.4214, lng: 2.8267 };
  const dest = { lat: 48.8766, lng: 2.3592 };

  it("prochain jour ouvré à 8 h", () => {
    expect(nextWeekdayMorning(new Date(2026, 8, 25, 18, 0))).toBe("20260928T080000"); // vendredi → lundi
    expect(nextWeekdayMorning(new Date(2026, 8, 28, 9, 0))).toBe("20260929T080000");
  });

  it("part de la station la plus proche, garde le trajet le plus court, clé dans l'en-tête apiKey", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const svc = new PrimRoutingService({
      apiKey: "cle",
      now: () => new Date(2026, 8, 28, 9, 0),
      sleep: async () => {},
      fetch: async (url, init) => {
        calls.push({ url, headers: init?.headers as Record<string, string> });
        if (url.includes("/places_nearby")) return json({ places_nearby: [{ id: "stop_area:IDFM:71410", embedded_type: "stop_area" }] });
        return json({ journeys: [{ duration: 4200 }, { duration: 3540 }] });
      },
    });
    expect(await svc.estimateTravelTime(origin, dest)).toEqual({ minutes: 59, provider: "prim-idfm-gare" });
    await svc.estimateTravelTime(origin, dest);
    expect(calls.filter((c) => c.url.includes("/places_nearby"))).toHaveLength(1); // station gardée en mémoire
    const u = new URL(calls[1]!.url);
    expect(u.pathname).toBe("/marketplace/v2/navitia/journeys");
    expect(u.searchParams.get("from")).toBe("stop_area:IDFM:71410");
    expect(u.searchParams.get("count")).toBe("5");
    expect(calls[1]!.headers.apiKey).toBe("cle");
  });

  it("pas de station à moins de 300 m → départ du point lui-même", async () => {
    const urls: string[] = [];
    const svc = new PrimRoutingService({
      apiKey: "cle",
      sleep: async () => {},
      fetch: async (url) => (urls.push(url), json(url.includes("/places_nearby") ? { places_nearby: [] } : { journeys: [{ duration: 600 }] })),
    });
    await svc.estimateTravelTime(origin, dest);
    expect(new URL(urls[1]!).searchParams.get("from")).toBe("2.826700;49.421400");
  });

  it("aucun itinéraire → null (jamais inventé)", async () => {
    const svc = new PrimRoutingService({ apiKey: "cle", sleep: async () => {}, fetch: async () => json({ error: { id: "no_origin" } }, 404) });
    expect(await svc.estimateTravelTime(origin, dest)).toEqual({ minutes: null, provider: "prim-idfm-gare", reason: "no_origin" });
    const empty = new PrimRoutingService({ apiKey: "cle", sleep: async () => {}, fetch: async () => json({ journeys: [] }) });
    expect((await empty.estimateTravelTime(origin, dest)).minutes).toBeNull();
  });

  it("un 404 sans « pas d'itinéraire » est une vraie erreur (mauvaise adresse d'API)", async () => {
    const svc = new PrimRoutingService({ apiKey: "cle", sleep: async () => {}, fetch: async () => json({ message: "Not Found" }, 404) });
    await expect(svc.estimateTravelTime(origin, dest)).rejects.toThrow("HTTP 404");
  });

  it("clé refusée → erreur claire", async () => {
    const svc = new PrimRoutingService({ apiKey: "mauvaise", sleep: async () => {}, fetch: async () => json({}, 401) });
    await expect(svc.estimateTravelTime(origin, dest)).rejects.toThrow("HTTP 401");
    expect(new PrimRoutingService({ apiKey: "" }).isConfigured()).toBe(false);
  });

  it("clés de cache : domicile précis, destination arrondie à ~1 km", () => {
    expect(originKeyOf(origin)).toBe("49.421,2.827");
    expect(routeKeyOf("prim-idfm", origin, dest)).toBe("prim-idfm|49.421,2.827|48.88,2.36");
    expect(routeKeyOf("prim-idfm", origin, { lat: 48.8791, lng: 2.3571 })).toBe(routeKeyOf("prim-idfm", origin, dest));
  });
});

describe("trajet voiture (OSRM), adresse d'entreprise, choix du mode", () => {
  it("OSRM : durée en minutes ; pas de route → null ; panne → erreur", async () => {
    const urls: string[] = [];
    const osrm = new OsrmRoutingService({ fetch: async (u) => (urls.push(u), json({ code: "Ok", routes: [{ duration: 3244.6 }] })), sleep: async () => {} });
    expect(await osrm.estimateTravelTime({ lat: 49.43, lng: 2.0833 }, { lat: 49.4179, lng: 2.8261 })).toEqual({ minutes: 54, provider: "osrm-car" });
    expect(urls[0]).toContain("/route/v1/driving/2.083300,49.430000;2.826100,49.417900");
    const none = new OsrmRoutingService({ fetch: async () => json({ code: "NoRoute" }), sleep: async () => {} });
    expect((await none.estimateTravelTime({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })).minutes).toBeNull();
    const down = new OsrmRoutingService({ fetch: async () => json({ code: "Error", message: "boom" }, 500), sleep: async () => {} });
    await expect(down.estimateTravelTime({ lat: 0, lng: 0 }, { lat: 1, lng: 1 })).rejects.toThrow(/OSRM/);
  });

  it("Île-de-France → transports ; Oise ou inconnu → voiture", () => {
    expect(travelModeOf("75")).toBe("transit");
    expect(travelModeOf("92")).toBe("transit");
    expect(travelModeOf("60")).toBe("car");
    expect(travelModeOf(null)).toBe("car");
  });

  const site = (commune: string, lat: number, lng: number, etat = "A") => ({ libelle_commune: commune, latitude: String(lat), longitude: String(lng), etat_administratif: etat, adresse: `RUE X ${commune}` });
  const api = (results: unknown[]) => async () => json({ results });

  it("adresse exacte : même nom, établissement dans la ville de l'offre", async () => {
    const fetch = api([{ nom_raison_sociale: "ISAGRI", nom_complet: "ISAGRI (ISAGRI, AGIRIS)", siege: site("TILLE", 49.4551, 2.0956), matching_etablissements: [site("TILLE", 49.4551, 2.0956), site("BEAUVAIS", 49.46, 2.07, "F")] }]);
    expect(await findCompanySite("Isagri", { city: "Tillé", department: "60" }, { fetch })).toMatchObject({ lat: 49.4551, lng: 2.0956 });
    // Pas d'établissement dans la ville de l'offre → rien (on garde le centre de la ville).
    expect(await findCompanySite("Isagri", { city: "Beauvais", department: "60" }, { fetch })).toBeNull();
  });

  it("homonyme approchant ou plusieurs sites éloignés → rien", async () => {
    const homonyme = api([{ nom_raison_sociale: "THEODOR FELEZEU", siege: site("PARIS", 48.87, 2.33) }]);
    expect(await findCompanySite("Theodo", { city: "Paris", department: "75" }, { fetch: homonyme })).toBeNull();
    const deuxSites = api([{ nom_raison_sociale: "ACME", siege: site("PARIS", 48.87, 2.33), matching_etablissements: [site("PARIS 11", 48.86, 2.38)] }]);
    expect(await findCompanySite("Acme", { city: "Paris", department: "75" }, { fetch: deuxSites })).toBeNull();
  });

  it("une enseigne identique ne compte que si aucune raison sociale ne correspond", async () => {
    const fetch = api([
      { nom_raison_sociale: "ISAGRI", siege: site("TILLE", 49.4551, 2.0956) },
      { nom_raison_sociale: "SOGERES", siege: { ...site("TILLE", 49.6, 2.3), liste_enseignes: ["ISAGRI"] } },
    ]);
    expect(await findCompanySite("ISAGRI SAS", { city: "Tille", department: "60" }, { fetch })).toMatchObject({ lat: 49.4551 });
  });
});
