import { describe, expect, it } from "vitest";
import { createTestApp, login } from "./test-helpers";

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const req = (method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: object) =>
    t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, req };
}

describe("candidatures spontanées", () => {
  it("exige d'être connecté", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "GET", url: "/api/leads" })).statusCode).toBe(401);
  });

  it("actualise depuis La Bonne Boîte (départements si pas de point de départ), sans doublon", async () => {
    const { req, lbbSearches } = await setup();
    const r1 = (await req("POST", "/api/leads/refresh")).json();
    expect(r1).toMatchObject({ found: 2, created: 2, updated: 0, around: "départements 60, 75" });
    expect(lbbSearches[0]).toMatchObject({ romes: ["M1805"], departments: ["60", "75"] });
    const r2 = (await req("POST", "/api/leads/refresh")).json();
    expect(r2).toMatchObject({ created: 0, updated: 2 });

    const list = (await req("GET", "/api/leads")).json();
    expect(list.total).toBe(2);
    expect(list.items[0]).toMatchObject({ name: "ALPHA LOGICIELS", hiringPotential: 61.2, isHighPotential: true, hasEmail: true, headcountMin: 10 });
    expect(list.items[1]).toMatchObject({ headcountMin: null, headcountMax: null, hasEmail: false });
  });

  it("zone propre aux candidatures : n'utilise PAS le point de départ des offres", async () => {
    const { req, profiles, lbbSearches } = await setup();
    profiles.get("u1")!.home = { label: "Paris Gare du Nord", lat: 48.8809, lng: 2.3553 };

    // Départements choisis pour les candidatures spontanées.
    expect((await req("PUT", "/api/leads/settings", { romes: ["M1805"], distanceKm: 30, place: null, departments: ["60"] })).statusCode).toBe(200);
    expect((await req("POST", "/api/leads/refresh")).json().around).toBe("départements 60");
    expect(lbbSearches[0]).toMatchObject({ departments: ["60"] });
    expect(lbbSearches[0]).not.toHaveProperty("point");

    // Lieu + rayon.
    const place = { label: "Compiègne", lat: 49.4179, lng: 2.8261 };
    await req("PUT", "/api/leads/settings", { romes: ["M1805", "M1810"], distanceKm: 40, place, departments: [] });
    expect((await req("POST", "/api/leads/refresh")).json().around).toBe("40 km autour de Compiègne");
    expect(lbbSearches[1]).toMatchObject({ romes: ["M1805", "M1810"], point: { lat: 49.4179, lng: 2.8261, distanceKm: 40 } });
    expect((await req("GET", "/api/leads/settings")).json().place).toEqual(place);

  });

  it("n'affiche que les entreprises de la zone actuelle, tri par potentiel ou du plus proche au plus loin", async () => {
    const { req } = await setup();
    await req("POST", "/api/leads/refresh"); // ALPHA à Creil (49.26, 2.47), BETA à Chambly (49.3, 2.3)

    // Autour de Creil, 5 km : seule ALPHA est dans la zone.
    await req("PUT", "/api/leads/settings", { romes: ["M1805"], distanceKm: 5, place: { label: "Creil", lat: 49.2638, lng: 2.4692 }, departments: [] });
    const near = (await req("GET", "/api/leads")).json();
    expect(near.items.map((l: { name: string }) => l.name)).toEqual(["ALPHA LOGICIELS"]);
    expect(near.items[0].distanceKm).toBeLessThan(1);

    // Autour de Chambly, 30 km : les deux ; tri par distance → BETA (Chambly) d'abord.
    await req("PUT", "/api/leads/settings", { romes: ["M1805"], distanceKm: 30, place: { label: "Chambly", lat: 49.3, lng: 2.3 }, departments: [] });
    const byDistance = (await req("GET", "/api/leads?sort=distance")).json();
    expect(byDistance.items.map((l: { name: string }) => l.name)).toEqual(["BETA SERVICES", "ALPHA LOGICIELS"]);
    const byPotential = (await req("GET", "/api/leads?sort=potential")).json();
    expect(byPotential.items.map((l: { name: string }) => l.name)).toEqual(["ALPHA LOGICIELS", "BETA SERVICES"]);

    // Mode départements : filtre par département.
    await req("PUT", "/api/leads/settings", { romes: ["M1805"], distanceKm: 30, place: null, departments: ["75"] });
    expect((await req("GET", "/api/leads")).json().total).toBe(0);
  });

  it("réglages invalides refusés avec la raison", async () => {
    const { req } = await setup();
    const res = await req("PUT", "/api/leads/settings", { romes: ["XYZ"], distanceKm: 30, place: null, departments: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues[0].message).toContain("Code ROME invalide");
  });

  it("suivi : statut, notes, filtre", async () => {
    const { req } = await setup();
    await req("POST", "/api/leads/refresh");
    const [first] = (await req("GET", "/api/leads")).json().items;
    const upd = await req("PATCH", `/api/leads/${first.id}`, { status: "NOT_INTERESTED", notes: "  que du support  " });
    expect(upd.json()).toMatchObject({ status: "NOT_INTERESTED", notes: "que du support" });
    expect((await req("GET", "/api/leads")).json().total).toBe(1);
    expect((await req("GET", "/api/leads?status=all")).json().total).toBe(2);
    expect((await req("PATCH", `/api/leads/${first.id}`, { status: "PIPO" })).statusCode).toBe(400);
    expect((await req("PATCH", "/api/leads/inconnu", { status: "CONTACTED" })).statusCode).toBe(404);
  });
});

describe("emails trouvés par une IA avec recherche web (JSON collé)", () => {
  it("range chaque email par SIRET, garde la source dans les notes, ne remplace un email saisi que sur demande", async () => {
    const { app } = await createTestApp();
    const cookies = await login(app);
    const req = (method: "POST" | "GET" | "PATCH", url: string, payload?: object) => app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    await req("POST", "/api/leads/refresh");
    const leads = (await req("GET", "/api/leads?status=all")).json().items as Array<{ id: string; siret: string; name: string }>;
    const beta = leads.find((l) => l.name === "BETA SERVICES")!;
    await req("PATCH", `/api/leads/${beta.id}`, { contactEmail: "contact@beta.fr" });

    const items = [
      { siret: "11111111100011", email: "RH@Alpha.fr", source: "https://alpha.fr/recrutement" },
      { siret: "22222222200022", email: "jobs@beta.fr", source: null },
      { siret: "33333333300033", email: "x@inconnue.fr", source: null },
      { siret: "11111111100011", email: "pas-un-email", source: null },
    ];
    const r = (await req("POST", "/api/leads/emails", { items })).json();
    expect(r).toMatchObject({ updated: 1, kept: 1, unknown: 1, invalid: 1 });
    expect(r.leads[0]).toMatchObject({ contactEmail: "rh@alpha.fr" });
    expect(r.leads[0].notes).toContain("trouvé sur https://alpha.fr/recrutement");

    const forced = (await req("POST", "/api/leads/emails", { items: [items[1]], overwrite: true })).json();
    expect(forced.updated).toBe(1);
    expect(forced.leads[0]).toMatchObject({ contactEmail: "jobs@beta.fr" });
    expect((await req("POST", "/api/leads/emails", { items: [] })).statusCode).toBe(400);

    // Sans email mais avec le site / la page de candidature : noté pour postuler à la main.
    const links = (await req("POST", "/api/leads/emails", { items: [{ siret: "11111111100011", email: null, site: "https://alpha.fr", contactUrl: "https://alpha.fr/carrieres" }] })).json();
    expect(links).toMatchObject({ notFound: 1, linksOnly: 1 });
    expect(links.leads[0].notes).toContain("Candidature / contact : https://alpha.fr/carrieres");

    // Filtre « email sur la fiche » (La Bonne Boîte le connaît) et pas encore saisi.
    const hint = (await req("GET", "/api/leads?status=all&email=hint")).json().items as Array<{ name: string }>;
    expect(hint.map((l) => l.name)).toEqual([]); // ALPHA (seule « email sur la fiche ») a déjà son email
    expect((await req("GET", "/api/leads?status=all&email=missing")).json().total).toBe(0);
    // Filtre « email saisi » : la liste des entreprises dont l'email est noté.
    const withEmail = (await req("GET", "/api/leads?status=all&email=set")).json();
    expect(withEmail.total).toBe((await req("GET", "/api/leads?status=all")).json().total);
    expect(withEmail.items.every((l: { contactEmail: string | null }) => !!l.contactEmail)).toBe(true);
  });
  it("introuvable → noté, passe de « encore à chercher » à « avec une note »", async () => {
    const { app } = await createTestApp();
    const cookies = await login(app);
    const req = (method: "POST" | "GET", url: string, payload?: object) => app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    await req("POST", "/api/leads/refresh");
    const before = (await req("GET", "/api/leads?status=all&email=missing")).json().total as number;
    const r = (await req("POST", "/api/leads/emails", { items: [{ siret: "22222222200022", email: null }] })).json();
    expect(r.leads[0].notes).toContain("Aucun email trouvé par l'IA");
    expect((await req("GET", "/api/leads?status=all&email=missing")).json().total).toBe(before - 1);
    const noted = (await req("GET", "/api/leads?status=all&email=noted")).json().items as Array<{ name: string }>;
    expect(noted.map((l) => l.name)).toEqual(["BETA SERVICES"]);
  });
  it("filtres de la page gardés dans le profil, sans être écrasés par un réglage de zone", async () => {
    const { req } = await setup();
    expect((await req("GET", "/api/leads/settings")).json().filters).toEqual({ status: "active", email: "any", sort: "potential" });
    const filters = { status: "TO_CONTACT", email: "missing", sort: "distance" };
    expect((await req("PUT", "/api/leads/filters", filters)).json()).toEqual(filters);
    // Réglage de zone envoyé avec une copie périmée des filtres : les filtres enregistrés restent.
    await req("PUT", "/api/leads/settings", { romes: ["M1805"], distanceKm: 30, place: null, departments: ["60"] });
    expect((await req("GET", "/api/leads/settings")).json().filters).toEqual(filters);
    expect((await req("PUT", "/api/leads/filters", { ...filters, status: "nimporte" })).statusCode).toBe(400);
  });
});
