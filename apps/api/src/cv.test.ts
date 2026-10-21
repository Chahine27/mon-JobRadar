import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CvEngine } from "@job-radar/cv-render";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { MASTER_INPUT } from "../../../packages/cv-tailor/src/fixtures";
import { cvFileBase } from "./routes/cv";
import { createTestApp, login } from "./test-helpers";

/** Faux navigateur : tout tient sur une page, le « PDF » est le texte de la page. */
const fakeEngine = (): CvEngine & { opened: string[] } => ({
  opened: [],
  measure: async () => ({ overflowPx: -10, overflowing: [] }),
  pdf: async (html) => Buffer.from(html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&")),
  readPdf: async (pdf) => ({ text: pdf.toString(), pages: 1 }),
  close: async () => {},
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "cv-"));
  const seed = join(dir, "seed.yaml");
  const input = structuredClone(MASTER_INPUT) as typeof MASTER_INPUT & { atsTemplate?: string };
  input.titles[1]!.toValidate = true; // une phrase « à valider »
  writeFileSync(seed, stringify(input));
  const engine = fakeEngine();
  const t = await createTestApp({ cvSeedPath: seed, cvEngine: engine });
  const cookies = await login(t.app);
  const req = (method: "GET" | "POST" | "PUT", url: string, payload?: object) => t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, req, dir };
}

describe("CV complet", () => {
  it("exige d'être connecté", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "GET", url: "/api/cv-master" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/jobs/j-vue/cv", payload: { template: "une-colonne" } })).statusCode).toBe(401);
  });

  it("import du fichier de départ seulement si vide, puis validation d'une phrase", async () => {
    const { req } = await setup();
    expect((await req("GET", "/api/cv-master")).json()).toMatchObject({ master: null, toValidate: 0 });
    const imported = await req("POST", "/api/cv-master/import-seed");
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ toValidate: 1, issues: [] });
    expect((await req("POST", "/api/cv-master/import-seed")).statusCode).toBe(409);
    expect((await req("POST", "/api/cv-master/variants/t-inconnu/validate")).statusCode).toBe(404);
    const v = await req("POST", "/api/cv-master/variants/t-front/validate");
    expect(v.json().toValidate).toBe(0);
    expect((await req("POST", `/api/cv-master/variants/${encodeURIComponent("f-fraude:v2")}/validate`)).statusCode).toBe(200);
  });

  it("fichier de départ absent : message clair", async () => {
    const t = await createTestApp({ cvSeedPath: join(tmpdir(), "absent-cv.yaml") });
    const cookies = await login(t.app);
    const r = await t.app.inject({ method: "POST", url: "/api/cv-master/import-seed", cookies });
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toMatch(/introuvable/);
  });

  it("refuse un CV complet incohérent (compétence interdite, inconnue, aucune phrase validée)", async () => {
    const { req } = await setup();
    const bad = structuredClone(MASTER_INPUT);
    bad.experiences[0]!.bullets[0]!.skills.push("php", "techno-inconnue");
    bad.experiences[0]!.bullets[1]!.variants.forEach((v) => (v.toValidate = true));
    const r = await req("PUT", "/api/cv-master", { master: bad });
    expect(r.statusCode).toBe(400);
    const messages = r.json().issues.map((i: { message: string }) => i.message).join(" | ");
    expect(messages).toMatch(/interdites/);
    expect(messages).toMatch(/inconnue/);
    expect(messages).toMatch(/validée/);
    expect((await req("PUT", "/api/cv-master", { master: MASTER_INPUT })).statusCode).toBe(200);
  });
});

describe("CV adapté à une offre", () => {
  it("sans CV complet : 409", async () => {
    const { req } = await setup();
    expect((await req("POST", "/api/jobs/j-vue/cv", { template: "une-colonne" })).json().error).toBe("NO_CV_MASTER");
  });

  it("brouillon, aperçu, périmé si le CV complet change, choix manuels conservés", async () => {
    const { req } = await setup();
    await req("POST", "/api/cv-master/import-seed");
    expect((await req("GET", "/api/jobs/j-vue/cv?template=deux-colonnes")).json()).toMatchObject({ cv: null, stale: false });
    const d = (await req("POST", "/api/jobs/j-vue/cv", { template: "deux-colonnes" })).json();
    expect(d.cv.status).toBe("DRAFT");
    expect(d.cv.draft.checks.find((c: { id: number }) => c.id === 7).ok).toBe(true);
    expect(d.cv.draft.warnings.join(" ")).toMatch(/Analyse IA absente/);
    const html = await req("GET", "/api/jobs/j-vue/cv/preview?template=deux-colonnes");
    expect(html.headers["content-type"]).toMatch(/text\/html/);
    expect(html.body).toContain("Camille Testeur");

    const put = await req("PUT", "/api/jobs/j-vue/cv", { template: "deux-colonnes", overrides: { remove: ["codenshare"] }, validated: true });
    expect(put.json().cv).toMatchObject({ status: "VALIDATED", overrides: { remove: ["codenshare"] } });
    expect((await req("PUT", "/api/jobs/j-vue/cv", { template: "deux-colonnes", overrides: { add: ["x".repeat(80)] } })).statusCode).toBe(400);

    await req("POST", "/api/cv-master/variants/t-front/validate");
    const stale = (await req("GET", "/api/jobs/j-vue/cv?template=deux-colonnes")).json();
    expect(stale).toMatchObject({ stale: true, staleReasons: ["ton CV complet a changé"] });
    const again = (await req("POST", "/api/jobs/j-vue/cv", { template: "deux-colonnes" })).json();
    expect(again).toMatchObject({ stale: false, cv: { status: "DRAFT", overrides: { remove: ["codenshare"] } } });
  });

  it("PDF : validation obligatoire, renvoyé au navigateur, suffixe _ATS si les deux, « Postulé » mémorise le CV", async () => {
    const { req } = await setup();
    await req("POST", "/api/cv-master/import-seed");
    for (const template of ["une-colonne", "deux-colonnes"]) await req("POST", "/api/jobs/j-vue/cv", { template });
    expect((await req("POST", "/api/jobs/j-vue/cv/pdf", { templates: ["une-colonne"] })).json().error).toBe("NOT_VALIDATED");

    for (const template of ["une-colonne", "deux-colonnes"]) await req("PUT", "/api/jobs/j-vue/cv", { template, overrides: {}, validated: true });
    const one = await req("POST", "/api/jobs/j-vue/cv/pdf", { templates: ["une-colonne"] });
    expect(one.statusCode).toBe(200);
    const [r] = one.json().results;
    expect(r).toMatchObject({ ok: true, fileName: "TESTEUR_CAMILLE.pdf" });
    expect(r.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(Buffer.from(r.pdf, "base64").length).toBeGreaterThan(0);

    // Les deux ensemble : le CV ATS (une colonne) prend « _ATS ».
    const both = (await req("POST", "/api/jobs/j-vue/cv/pdf", { templates: ["une-colonne", "deux-colonnes"] })).json();
    expect(both.results.map((x: { fileName: string }) => x.fileName)).toEqual(["TESTEUR_CAMILLE_ATS.pdf", "TESTEUR_CAMILLE.pdf"]);

    await req("POST", "/api/jobs/j-vue/apply", { channel: "formulaire", cv: "ats" });
    const apps = (await req("GET", "/api/applications")).json();
    const cvs = apps.jobs.find((j: { id: string }) => j.id === "j-vue").cvs;
    expect(cvs.map((c: { template: string }) => c.template).sort()).toEqual(["deux-colonnes", "une-colonne"]);
    expect(cvs.every((c: { sentAt: string | null }) => c.sentAt)).toBe(true);
  });

  it("nom du fichier : NOM_PRÉNOM sans accents", () => {
    expect(cvFileBase("Chahine Mehadji")).toBe("MEHADJI_CHAHINE");
    expect(cvFileBase("Éloïse Le Gall")).toBe("GALL_ELOISE-LE");
  });
});
