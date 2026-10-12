import { DEFAULT_PROFILE } from "@job-radar/shared";
import { describe, expect, it } from "vitest";
import { APP_URL, TEST_EMAIL, TEST_PASSWORD, createTestApp, login } from "./test-helpers";

describe("santé", () => {
  it("GET /api/health répond ok", async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("erreurs", () => {
  it("ne divulgue pas le détail d'une erreur interne", async () => {
    const { app, stores } = await createTestApp();
    stores.users.findByEmail = async () => {
      throw new Error("Can't reach database server at /chemin/secret");
    };
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("secret");
    expect(res.json()).toEqual({ error: "INTERNAL_ERROR" });
  });
});

describe("authentification", () => {
  it("refuse l'accès sans session", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "GET", url: "/api/auth/me" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/profile" })).statusCode).toBe(401);
  });

  it("même réponse pour mauvais mot de passe et email inconnu", async () => {
    const { app } = await createTestApp();
    const a = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: TEST_EMAIL, password: "faux" },
    });
    const b = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "inconnu@example.com", password: TEST_PASSWORD },
    });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });

  it("connexion → cookie httpOnly → /me → déconnexion", async () => {
    const { app, sessions } = await createTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "  TEST@example.com ", password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "jr_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    // Le jeton brut n'est jamais stocké.
    expect(sessions.has(cookie.value)).toBe(false);
    expect(sessions.size).toBe(1);

    const cookies = { jr_session: cookie.value };
    const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies });
    expect(me.json()).toEqual({ user: { email: TEST_EMAIL } });

    await app.inject({ method: "POST", url: "/api/auth/logout", cookies });
    expect(sessions.size).toBe(0);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies })).statusCode).toBe(401);
  });

  it("session expirée → refusée et supprimée", async () => {
    const { app, sessions } = await createTestApp();
    const cookies = await login(app);
    for (const s of sessions.values()) s.expiresAt = new Date(Date.now() - 1000);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies })).statusCode).toBe(401);
    expect(sessions.size).toBe(0);
  });

  it("bloque après 5 tentatives de connexion par minute", async () => {
    const { app } = await createTestApp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: TEST_EMAIL, password: "faux" },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it("refuse une requête venant d'un autre site", async () => {
    const { app } = await createTestApp();
    const evil = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://site-malveillant.example" },
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    expect(evil.statusCode).toBe(403);
    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: APP_URL },
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe("profil", () => {
  it("renvoie le profil par défaut", async () => {
    const { app } = await createTestApp();
    const cookies = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/profile", cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile).toEqual(DEFAULT_PROFILE);
    expect(res.json().home).toBeNull();
  });

  it("modifie le profil et le point de départ", async () => {
    const { app } = await createTestApp();
    const cookies = await login(app);
    const profile = { ...DEFAULT_PROFILE, salaryTarget: 42000 };
    const home = { label: "Gare de départ", lat: 49.4, lng: 2.8 };
    const put = await app.inject({ method: "PUT", url: "/api/profile", cookies, payload: { profile, home } });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/api/profile", cookies });
    expect(get.json().profile.salaryTarget).toBe(42000);
    expect(get.json().home).toEqual(home);

    // home absent → conservé
    await app.inject({ method: "PUT", url: "/api/profile", cookies, payload: { profile } });
    expect((await app.inject({ method: "GET", url: "/api/profile", cookies })).json().home).toEqual(home);
  });

  it("refuse un profil invalide avec le détail", async () => {
    const { app } = await createTestApp();
    const cookies = await login(app);
    const bad = {
      ...DEFAULT_PROFILE,
      scoreRules: [{ kind: "title", value: "Angular", points: 80 }], // max +50
    };
    const res = await app.inject({ method: "PUT", url: "/api/profile", cookies, payload: { profile: bad } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_PROFILE");
    expect(res.json().issues.length).toBeGreaterThan(0);
  });
});

describe("recherche d'adresse", () => {
  it("renvoie des propositions, valide la saisie", async () => {
    const { app } = await createTestApp();
    const cookies = await login(app);
    const ok = await app.inject({ method: "GET", url: "/api/geocode?q=gare%20de%20compiegne", cookies });
    expect(ok.json().items[0]).toMatchObject({ lat: 49.4214, lng: 2.8267 });
    expect((await app.inject({ method: "GET", url: "/api/geocode?q=a", cookies })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/geocode?q=gare" })).statusCode).toBe(401);
  });
});
