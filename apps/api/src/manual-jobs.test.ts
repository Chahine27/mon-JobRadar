import { describe, expect, it } from "vitest";
import { createTestApp, login } from "./test-helpers";

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const req = (method: "GET" | "POST" | "DELETE", url: string, payload?: object) =>
    t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, req };
}

const OFFER = {
  url: "https://www.linkedin.com/jobs/view/123",
  title: "Développeur Frontend Vue.js",
  company: "Acme",
  location: "Creil (60)",
  description: "Nous cherchons un développeur Vue.js / TypeScript en CDI, 2 ans d'expérience. Télétravail 2 jours par semaine.",
};

describe("offres ajoutées à la main", () => {
  it("exige d'être connecté", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "POST", url: "/api/jobs/manual", payload: OFFER })).statusCode).toBe(401);
  });

  it("titre et texte obligatoires, adresse vérifiée, messages en français", async () => {
    const { req } = await setup();
    const res = await req("POST", "/api/jobs/manual", { title: "", description: "court", url: "javascript:alert(1)" });
    expect(res.statusCode).toBe(400);
    const paths = res.json().issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["title", "description", "url"]));
  });

  it("ajoute, détecte compétences / contrat / télétravail / lieu, sauvegarde et conserve", async () => {
    const { req } = await setup();
    const res = await req("POST", "/api/jobs/manual", OFFER);
    expect(res.statusCode).toBe(201);
    const { job, duplicate } = res.json();
    expect(duplicate).toBe(false);
    expect(job).toMatchObject({ title: OFFER.title, company: "Acme", city: "Creil", department: "60", contractType: "CDI", remoteType: "hybrid", status: "SAVED" });
    expect(job.matchedSkills).toEqual(expect.arrayContaining(["Vue.js", "TypeScript"]));
    expect(job.sources).toEqual([{ source: "manual", url: OFFER.url }]);

    const list = (await req("GET", "/api/jobs/manual")).json().items;
    expect(list.map((j: { id: string }) => j.id)).toEqual([job.id]);
    // Visible dans la liste principale (onglet Sauvegardées).
    const saved = (await req("GET", "/api/jobs?status=SAVED")).json().items.map((j: { id: string }) => j.id);
    expect(saved).toContain(job.id);
  });

  it("jamais masquée, même si le contrat est hors profil", async () => {
    const { req } = await setup();
    const { job } = (await req("POST", "/api/jobs/manual", { ...OFFER, title: "Développeur Vue.js", contractType: "CDD" })).json();
    expect(job.score.hidden).toBe(true);
    const ids = (await req("GET", "/api/jobs?status=all")).json().items.map((j: { id: string }) => j.id);
    expect(ids).toContain(job.id);
  });

  it("offre déjà connue (même entreprise, titre, ville) : rattachée, pas de doublon ; retirer ne supprime que l'ajout", async () => {
    const { req } = await setup();
    const known = { title: "Développeur Vue.js", company: "Entreprise test", location: "Compiègne", description: OFFER.description };
    const res = (await req("POST", "/api/jobs/manual", known)).json();
    expect(res.duplicate).toBe(true);
    expect(res.otherSources).toEqual(["demo"]);
    expect(res.job.id).toBe("j-vue");

    expect((await req("DELETE", `/api/jobs/manual/${res.job.id}`)).json().result).toBe("unlinked");
    expect((await req("GET", "/api/jobs/j-vue")).statusCode).toBe(200);
  });

  it("supprimer une offre ajoutée à la main ; refus pour une offre d'une autre source", async () => {
    const { req } = await setup();
    const { job } = (await req("POST", "/api/jobs/manual", OFFER)).json();
    expect((await req("DELETE", `/api/jobs/manual/${job.id}`)).json().result).toBe("deleted");
    expect((await req("GET", `/api/jobs/${job.id}`)).statusCode).toBe(404);
    expect((await req("DELETE", "/api/jobs/manual/j-ruby")).statusCode).toBe(400);
    expect((await req("DELETE", "/api/jobs/manual/inconnue")).statusCode).toBe(404);
  });

  it("lecture d'une annonce collée : pré-remplissage, rien d'enregistré", async () => {
    const { req } = await setup();
    const res = await req("POST", "/api/jobs/manual/analyze", {
      text: "Acme recrute !\nDéveloppeur Vue.js (H/F)\nLocalisation : Creil (60)\nCDI, télétravail 2 jours. Vue.js, TypeScript.",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: "Développeur Vue.js (H/F)", company: "Acme", location: "Creil (60)", contractType: "CDI", remoteType: "hybrid" });
    expect((await req("GET", "/api/jobs/manual")).json().items).toEqual([]);
  });
});
