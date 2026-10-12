import { describe, expect, it } from "vitest";
import { createTestApp, login } from "./test-helpers";

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const req = (method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
    t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, req };
}

// Candidat fictif.
const KIT = {
  header: "Alex Martin\n75011 Paris",
  city: "Paris",
  signature: "Alex MARTIN",
  cvText: "Développeur Full Stack. Alternance chez Banquo : Vue.js, TypeScript, Java Spring Boot, PostgreSQL. ".repeat(4),
  letterExample: "Ce qui m'attire chez Alarmex, c'est la sécurité.",
};

describe("lettre de motivation", () => {
  it("exige d'être connecté", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "GET", url: "/api/letter-kit" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/jobs/j-vue/letter" })).statusCode).toBe(401);
  });

  it("CV & lettre exemple : vide au départ, enregistré, CV trop court = pas prêt", async () => {
    const { req } = await setup();
    expect((await req("GET", "/api/letter-kit")).json()).toMatchObject({ ready: false, kit: { cvText: "" } });
    expect((await req("PUT", "/api/letter-kit", { ...KIT, cvText: "trop court" })).json().ready).toBe(false);
    const saved = (await req("PUT", "/api/letter-kit", KIT)).json();
    expect(saved.ready).toBe(true);
    expect((await req("GET", "/api/letter-kit")).json().kit.signature).toBe("Alex MARTIN");
    expect((await req("PUT", "/api/letter-kit", { ...KIT, cvText: "x".repeat(20_000) })).statusCode).toBe(400);
  });

  it("sans CV : on demande de le coller d'abord", async () => {
    const { req, aiCalls } = await setup();
    const res = await req("POST", "/api/jobs/j-vue/letter");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("LETTER_KIT_MISSING");
    expect(aiCalls).toHaveLength(0);
    expect((await req("GET", "/api/jobs/j-vue/letter")).json()).toMatchObject({ letter: null, kitReady: false });
  });

  it("écrit, garde, signale les points à vérifier, modifiable, dépassée si le CV change", async () => {
    const { req, aiCalls } = await setup();
    await req("PUT", "/api/letter-kit", KIT);

    const first = (await req("POST", "/api/jobs/j-vue/letter")).json();
    expect(first.cached).toBe(false);
    expect(first.letter.content).toContain("Objet : Candidature au poste de Développeur Vue.js");
    expect(first.warnings.some((w: string) => w.includes("Kafka"))).toBe(true); // absent du CV

    expect((await req("POST", "/api/jobs/j-vue/letter")).json().cached).toBe(true);
    expect(aiCalls).toHaveLength(1);

    const edited = (await req("PUT", "/api/jobs/j-vue/letter", { content: "Ma lettre corrigée, chez Banquo." })).json();
    expect(edited.letter).toMatchObject({ content: "Ma lettre corrigée, chez Banquo.", edited: true });
    expect(edited.warnings).toEqual([]);
    expect(edited.upToDate).toBe(true);

    await req("PUT", "/api/letter-kit", { ...KIT, cvText: `${KIT.cvText} Docker.` });
    expect((await req("GET", "/api/jobs/j-vue/letter")).json().upToDate).toBe(false);

    await req("POST", "/api/jobs/j-vue/letter?force=true");
    expect(aiCalls).toHaveLength(2);
  });

  it("modifier sans lettre : 404 ; Ollama éteint : 503", async () => {
    const { req, aiState } = await setup();
    expect((await req("PUT", "/api/jobs/j-vue/letter", { content: "x" })).statusCode).toBe(404);
    await req("PUT", "/api/letter-kit", KIT);
    aiState.online = false;
    const res = await req("POST", "/api/jobs/j-vue/letter");
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toMatch(/lance l'appli Ollama/);
  });
  it("notification « lettre terminée » : envoyée, sauf si tu es déjà sur la page de l'offre", async () => {
    const { req, letterNotices } = await setup();
    await req("PUT", "/api/letter-kit", KIT);
    await req("POST", "/api/jobs/j-vue/letter");
    expect(letterNotices).toEqual(["/offres/j-vue"]);

    expect((await req("POST", "/api/presence", { path: "/offres/j-vue" })).statusCode).toBe(204);
    await req("POST", "/api/jobs/j-vue/letter?force=true");
    expect(letterNotices).toHaveLength(1); // page ouverte : pas de notification

    await req("POST", "/api/presence", { path: "/offres/autre" });
    await req("POST", "/api/jobs/j-vue/letter?force=true");
    expect(letterNotices).toHaveLength(1); // une autre page ouverte ne compte pas… mais j-vue l'est encore
  });
});
