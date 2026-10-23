import { describe, expect, it } from "vitest";
import { analysisHash } from "./ai-context";
import { createTestApp, job, login } from "./test-helpers";

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  t.jobs.set("sans-contrat", job({ id: "sans-contrat", title: "Développeur Vue.js", description: "Vue 3", contractType: null }));
  const req = (method: "GET" | "POST" | "PUT", url: string, payload?: object) => t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, req };
}

describe("canal, CV et contrat obligatoires à chaque candidature", () => {
  it("« Postulé » refusé tant que le canal et le CV ne sont pas indiqués ; enregistrés ensuite", async () => {
    const { req } = await setup();
    const refused = await req("POST", "/api/jobs/j-vue/status", { status: "APPLIED" });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: "APPLY_INFO_MISSING" });
    expect(refused.json().message).toBe("Pour enregistrer la candidature, indique le canal d'envoi, le CV utilisé.");
    expect((await req("POST", "/api/jobs/j-vue/status", { status: "APPLIED", channel: "pigeon", cv: "ats" })).statusCode).toBe(400);
    expect((await req("GET", "/api/jobs/j-vue")).json().status).not.toBe("APPLIED");

    const ok = (await req("POST", "/api/jobs/j-vue/status", { status: "APPLIED", channel: "linkedin", cv: "ats" })).json();
    expect(ok).toMatchObject({ status: "APPLIED", applyChannel: "linkedin", applyCv: "ats" });
    const apps = (await req("GET", "/api/applications")).json().jobs;
    expect(apps[0]).toMatchObject({ id: "j-vue", applyChannel: "linkedin", applyCv: "ats" });
  });

  it("contrat inconnu de l'offre : demandé aussi, et gardé comme correction de l'offre", async () => {
    const { req } = await setup();
    const refused = await req("POST", "/api/jobs/sans-contrat/status", { status: "APPLIED", channel: "mail", cv: "classique" });
    expect(refused.json().message).toBe("Pour enregistrer la candidature, indique le type de contrat.");
    const ok = (await req("POST", "/api/jobs/sans-contrat/status", { status: "APPLIED", channel: "mail", cv: "classique", contractType: "CDI" })).json();
    expect(ok).toMatchObject({ status: "APPLIED", contractType: "CDI", applyChannel: "mail", userEdits: { contractType: "CDI" } });
  });

  it("contrat absent de l'annonce mais lu par l'IA (celui affiché) : rien à demander", async () => {
    const { req, jobs, analysisRows } = await setup();
    const row = jobs.get("sans-contrat")!;
    const inputHash = analysisHash(row, {} as Parameters<typeof analysisHash>[1], "fake-model");
    analysisRows.set("sans-contrat", { inputHash, model: "fake-model", result: { adequation: "forte", contrat: "CDI" }, createdAt: new Date() });
    expect((await req("GET", "/api/jobs/sans-contrat")).json().contractType).toBe("CDI");
    const ok = await req("POST", "/api/jobs/sans-contrat/status", { status: "APPLIED", channel: "linkedin", cv: "ats" });
    expect(ok.statusCode).toBe(200);
  });

  it("anciennes candidatures : complétées après coup ; remise en attente après un refus sans rien redemander", async () => {
    const { req, events } = await setup();
    events.push({ jobId: "sans-contrat", from: "NEW", to: "APPLIED", at: new Date("2026-10-01") }); // candidature d'avant la règle
    expect((await req("PUT", "/api/jobs/sans-contrat/application-info", { channel: "formulaire" })).statusCode).toBe(400);
    const done = (await req("PUT", "/api/jobs/sans-contrat/application-info", { channel: "formulaire", cv: "ats", contractType: "CDD" })).json();
    expect(done).toMatchObject({ applyChannel: "formulaire", applyCv: "ats", contractType: "CDD" });
    expect((await req("POST", "/api/jobs/sans-contrat/status", { status: "REJECTED" })).statusCode).toBe(200);
    expect((await req("POST", "/api/jobs/sans-contrat/status", { status: "APPLIED" })).statusCode).toBe(200);
  });
});
