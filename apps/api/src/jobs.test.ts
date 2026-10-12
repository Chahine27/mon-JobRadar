import { describe, expect, it } from "vitest";
import { createTestApp, login } from "./test-helpers";

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const get = (url: string) => t.app.inject({ method: "GET", url, cookies });
  const post = (url: string, payload?: object) =>
    t.app.inject({ method: "POST", url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, cookies, get, post };
}

describe("GET /api/jobs", () => {
  it("exige d'être connecté", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "GET", url: "/api/jobs" })).statusCode).toBe(401);
  });

  it("filtre par source : une seule source, une offre vue sur 2 sources apparaît dans les 2", async () => {
    const { get, jobs } = await setup();
    jobs.get("j-vue")!.sources.push({ source: "france-travail", url: "https://candidat.francetravail.fr/offres/1" });
    jobs.get("j-java")!.sources = [{ source: "france-travail", url: "https://candidat.francetravail.fr/offres/2" }];
    const all = (await get("/api/jobs?limit=50")).json();
    const ft = (await get("/api/jobs?limit=50&source=france-travail")).json();
    expect(ft.items.map((j: { id: string }) => j.id).sort()).toEqual(["j-java", "j-vue"]);
    expect(ft.total).toBeLessThan(all.total);
    expect((await get("/api/jobs?limit=50&source=demo")).json().items.some((j: { id: string }) => j.id === "j-vue")).toBe(true);
    expect((await get("/api/jobs?limit=50&source=adzuna")).json().total).toBe(0);
    expect((await get("/api/jobs?source=Pas%20valide")).statusCode).toBe(400);
  });

  it("trie par score et masque les contrats hors profil", async () => {
    const { get } = await setup();
    const res = await get("/api/jobs");
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(["j-vue", "j-java", "j-ruby"]);
  });

  it("montre les offres masquées sur demande", async () => {
    const { get } = await setup();
    const items = (await get("/api/jobs?includeHidden=true")).json().items;
    const cdd = items.find((i: { id: string }) => i.id === "j-cdd");
    expect(cdd.score.hidden).toBe(true);
    expect(cdd.score.hiddenReason).toBe("Contrat CDD hors profil");
  });

  it("filtre par score minimum, texte et tri par date", async () => {
    const { get } = await setup();
    const min = (await get("/api/jobs?minScore=95")).json().items.map((i: { id: string }) => i.id);
    expect(min).toEqual(["j-vue"]);
    const q = (await get("/api/jobs?q=java")).json().items.map((i: { id: string }) => i.id);
    expect(q).toEqual(["j-java"]);
    const byDate = (await get("/api/jobs?sort=date")).json().items.map((i: { id: string }) => i.id);
    expect(byDate[0]).toBe("j-java");
  });

  it("renvoie les compétences présentes et manquantes", async () => {
    const { get } = await setup();
    const java = (await get("/api/jobs")).json().items.find((i: { id: string }) => i.id === "j-java");
    expect(java.matchedSkills).toEqual(["Java", "Spring Boot"]);
    expect(java.missingSkills).toEqual(["Angular"]);
  });

  it("pagination : limit / offset, total inchangé", async () => {
    const { get } = await setup();
    const p1 = (await get("/api/jobs?limit=2")).json();
    const p2 = (await get("/api/jobs?limit=2&offset=2")).json();
    expect(p1.total).toBe(3);
    expect(p1.items.map((i: { id: string }) => i.id)).toEqual(["j-vue", "j-java"]);
    expect(p2.items.map((i: { id: string }) => i.id)).toEqual(["j-ruby"]);
    expect((await get("/api/jobs")).json().limit).toBe(20);
  });

  it("refuse un filtre invalide", async () => {
    const { get } = await setup();
    expect((await get("/api/jobs?minScore=500")).statusCode).toBe(400);
  });
});

describe("GET /api/jobs/:id", () => {
  it("renvoie le détail avec raisons et vigilances", async () => {
    const { get } = await setup();
    const res = await get("/api/jobs/j-java");
    expect(res.statusCode).toBe(200);
    const job = res.json();
    expect(job.description).toContain("Spring Boot");
    expect(job.reasons).toContain("Tu as : Java, Spring Boot");
    expect(job.warnings.some((w: string) => w.includes("Angular"))).toBe(true);
    expect(job.score.breakdown.technical).toBe(80); // Java (titre, ×3) + Spring Boot sur 5, Angular manquant
  });

  it("404 si l'offre n'existe pas", async () => {
    const { get } = await setup();
    expect((await get("/api/jobs/inconnue")).statusCode).toBe(404);
  });
});

describe("trajet à l'ouverture", () => {
  it("calcule le trajet quand on ouvre l'offre, pas dans la liste", async () => {
    const { get, travelRequests } = await setup();
    await get("/api/jobs");
    expect(travelRequests).toEqual([]);
    const job = (await get("/api/jobs/j-vue")).json();
    expect(travelRequests).toEqual(["j-vue"]);
    expect(job.travelMinutes).toBe(42);
  });

  it("calcul lent : l'offre s'affiche sans l'attendre, la page redemande, un seul calcul", async () => {
    const { get, travelRequests, travelDelay } = await setup();
    travelDelay.ms = 600;
    const t = Date.now();
    const first = (await get("/api/jobs/j-vue")).json();
    expect(Date.now() - t).toBeLessThan(550);
    expect(first.travelPending).toBe(true);
    const again = (await get("/api/jobs/j-vue")).json(); // attend le calcul déjà lancé
    expect(again.travelPending).toBe(false);
    expect(again.travelMinutes).toBe(42);
    expect(travelRequests).toEqual(["j-vue"]);
  });

  it("une erreur de calcul n'empêche pas d'afficher l'offre, et la raison est donnée", async () => {
    const { get } = await setup();
    const res = await get("/api/jobs/j-java");
    expect(res.statusCode).toBe(200);
    expect(res.json().travelIssue).toBe("quota PRIM atteint");
  });
});

describe("statuts", () => {
  it("sauvegarder, postuler, ignorer — avec historique", async () => {
    const { post, get, events } = await setup();
    expect((await post("/api/jobs/j-vue/save")).json().status).toBe("SAVED");
    expect((await post("/api/jobs/j-vue/apply")).json().status).toBe("APPLIED");
    expect((await post("/api/jobs/j-ruby/ignore")).json().status).toBe("IGNORED");
    expect(events.map(({ at: _at, ...e }) => e)).toEqual([
      { jobId: "j-vue", from: "NEW", to: "SAVED" },
      { jobId: "j-vue", from: "SAVED", to: "APPLIED" },
      { jobId: "j-ruby", from: "NEW", to: "IGNORED" },
    ]);
    // Une offre ignorée disparaît du flux principal.
    const ids = (await get("/api/jobs")).json().items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain("j-ruby");
    const saved = (await get("/api/jobs?status=APPLIED")).json().items.map((i: { id: string }) => i.id);
    expect(saved).toEqual(["j-vue"]);
  });

  it("statut générique et validation", async () => {
    const { post } = await setup();
    expect((await post("/api/jobs/j-vue/status", { status: "SEEN" })).json().status).toBe("SEEN");
    expect((await post("/api/jobs/j-vue/status", { status: "PIPO" })).statusCode).toBe(400);
    expect((await post("/api/jobs/inconnue/save")).statusCode).toBe(404);
  });

  it("le score change quand le profil change", async () => {
    const { app, cookies, get, profiles } = await setup();
    const before = (await get("/api/jobs/j-java")).json().score.breakdown.technical;
    const rec = profiles.get("u1")!;
    const profile = { ...rec.profile, skills: [...rec.profile.skills, "Angular"] };
    await app.inject({ method: "PUT", url: "/api/profile", cookies, payload: { profile } });
    const after = (await get("/api/jobs/j-java")).json().score.breakdown.technical;
    expect(before).toBe(80);
    expect(after).toBe(100);
  });
});

describe("compléter une offre avec l'annonce complète", () => {
  async function setup() {
    const t = await createTestApp();
    const cookies = await login(t.app);
    const req = (method: "GET" | "PUT" | "DELETE", url: string, payload?: object) =>
      t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    return { ...t, req };
  }
  const PAGE = `Rechercher\nDéveloppeur Vue.js\nPostuler à ce poste\n${"Développeur Vue.js, TypeScript et Docker. Minimum 3 ans d'expérience. ".repeat(6)}\nStats pour cet emploi\nPostes similaires`;

  it("remplace l'extrait, recalcule le score, et peut être annulé", async () => {
    const { req } = await setup();
    const before = (await req("GET", "/api/jobs/j-vue")).json();
    expect(before).toMatchObject({ abridged: false, fullTextAt: null });

    const res = await req("PUT", "/api/jobs/j-vue/full-text", { text: PAGE });
    expect(res.statusCode).toBe(200);
    const after = res.json();
    expect(after.description.startsWith("Développeur Vue.js, TypeScript et Docker.")).toBe(true);
    expect(after.description).not.toMatch(/Rechercher|Stats pour cet emploi|Postuler/);
    expect(after.fullTextAt).not.toBeNull();
    expect(after.matchedSkills.length + after.missingSkills.length).toBeGreaterThanOrEqual(before.matchedSkills.length + before.missingSkills.length);

    const undone = (await req("DELETE", "/api/jobs/j-vue/full-text")).json();
    expect(undone.description).toBe(before.description);
    expect(undone.fullTextAt).toBeNull();
  });

  it("texte trop court : refusé avec un message simple ; offre inconnue : 404", async () => {
    const { req } = await setup();
    const res = await req("PUT", "/api/jobs/j-vue/full-text", { text: "trop court" });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Ctrl \+ A/);
    expect((await req("PUT", "/api/jobs/inconnue/full-text", { text: PAGE })).statusCode).toBe(404);
  });
});

describe("corriger les infos d'une offre à la main", () => {
  it("les corrections priment sur la source, changent la rubrique, et peuvent être annulées", async () => {
    const { get, cookies, app } = await setup();
    const put = (payload: object) => app.inject({ method: "PUT", url: "/api/jobs/j-vue/edits", cookies, payload });
    const before = (await get("/api/jobs/j-vue")).json();
    const edited = (await put({ company: "Acme", department: "60", contractType: "CDI", salaryMin: 38000, experienceMinYrs: 2 })).json();
    expect(edited).toMatchObject({ company: "Acme", department: "60", zone: "local", contractType: "CDI", salaryMin: 38000, salaryMax: 38000, experienceText: "2 ans minimum" });
    expect(edited.userEditsAt).not.toBeNull();
    expect((await put({ salaryMin: 50000, salaryMax: 40000 })).statusCode).toBe(400);
    expect((await put({ department: "Oise" })).statusCode).toBe(400);
    const reset = (await put({})).json();
    expect(reset).toMatchObject({ company: before.company, userEditsAt: null });
  });
});

describe("candidatures (offres où j'ai postulé)", () => {
  async function setup() {
    const t = await createTestApp();
    const cookies = await login(t.app);
    const req = (method: "GET" | "POST", url: string, payload?: object) =>
      t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    return { ...t, req };
  }

  it("« Postulé » sort du flux et apparaît dans Candidatures (avec la date) ; « Refusée » après candidature y reste", async () => {
    const { req } = await setup();
    await req("POST", "/api/jobs/j-vue/apply");
    const feed = (await req("GET", "/api/jobs?limit=50")).json().items as Array<{ id: string }>;
    expect(feed.some((j) => j.id === "j-vue")).toBe(false);
    expect((await req("GET", "/api/jobs?status=APPLIED")).json().items.map((j: { id: string }) => j.id)).toEqual(["j-vue"]);

    const apps = (await req("GET", "/api/applications")).json().jobs;
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ id: "j-vue", status: "APPLIED" });
    expect(new Date(apps[0].appliedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    await req("POST", "/api/jobs/j-vue/status", { status: "REJECTED" });
    expect((await req("GET", "/api/applications")).json().jobs[0].status).toBe("REJECTED");

    await req("POST", "/api/jobs/j-ruby/ignore"); // ignorée sans candidature : pas une candidature
    expect((await req("GET", "/api/applications")).json().jobs).toHaveLength(1);
  });
});

describe("urlKey (offre déjà en base, envoyée par l'extension)", async () => {
  const { urlKey } = await import("./jobs/service");
  it("reconnaît la même offre sous plusieurs liens", () => {
    expect(urlKey("https://www.linkedin.com/jobs/view/4012345678/?trk=abc")).toBe("linkedin:4012345678");
    expect(urlKey("https://fr.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=dev")).toBe("linkedin:4012345678");
    expect(urlKey("https://fr.indeed.com/viewjob?jk=ab12cd34&from=serp")).toBe("indeed:ab12cd34");
    expect(urlKey("https://www.welcometothejungle.com/fr/companies/acme/jobs/dev_paris/?q=1")).toBe(
      urlKey("https://welcometothejungle.com/fr/companies/acme/jobs/dev_paris"),
    );
    expect(urlKey("pas un lien")).toBeNull();
  });
});
