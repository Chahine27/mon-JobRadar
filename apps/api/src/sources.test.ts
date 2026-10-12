import { describe, expect, it } from "vitest";
import { createTestApp, login } from "./test-helpers";

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const req = (method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, req };
}

describe("sources", () => {
  it("liste avec libellé, état de configuration et intervalle minimum", async () => {
    const { req } = await setup();
    const items = (await req("GET", "/api/sources")).json().items;
    const adzuna = items.find((i: { source: string }) => i.source === "adzuna");
    expect(adzuna).toMatchObject({ label: "Adzuna", configured: false, minIntervalMinutes: 90 });
    const careers = items.find((i: { source: string }) => i.source === "company-careers");
    expect(careers.configured).toBe(false);
  });

  it("refuse un intervalle plus court que la limite de la source", async () => {
    const { req } = await setup();
    const bad = await req("PUT", "/api/sources/adzuna", { enabled: true, intervalMinutes: 30 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toContain("Minimum 90 min");
    expect((await req("PUT", "/api/sources/adzuna", { enabled: true, intervalMinutes: 120 })).statusCode).toBe(200);
    expect((await req("PUT", "/api/sources/inconnue", { enabled: true, intervalMinutes: 120 })).statusCode).toBe(404);
  });
});

describe("entreprises", () => {
  it("ajout par adresse de page carrières, doublon refusé, activation, suppression", async () => {
    const { req } = await setup();
    const add = await req("POST", "/api/companies", { name: "Qonto", url: "https://jobs.lever.co/qonto" });
    expect(add.statusCode).toBe(201);
    expect(add.json()).toMatchObject({ name: "Qonto", ats: "lever", boardKey: "qonto", enabled: true });
    expect((await req("POST", "/api/companies", { name: "Qonto bis", url: "https://jobs.lever.co/qonto/123" })).statusCode).toBe(409);

    const bad = await req("POST", "/api/companies", { name: "X", url: "https://www.welcometothejungle.com/fr/companies/x" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toContain("Greenhouse, Lever, Ashby ou Recruitee");

    expect((await req("POST", "/api/companies", { name: "Y", ats: "greenhouse", boardKey: "../../etc" })).statusCode).toBe(400);

    const id = add.json().id;
    expect((await req("PATCH", `/api/companies/${id}`, { enabled: false })).json().enabled).toBe(false);
    expect((await req("DELETE", `/api/companies/${id}`)).statusCode).toBe(200);
    expect((await req("GET", "/api/companies")).json().items).toEqual([]);
  });

  it("la source « sites carrières » devient configurée dès qu'une entreprise est active", async () => {
    const { req } = await setup();
    await req("POST", "/api/companies", { name: "Alan", url: "https://jobs.ashbyhq.com/alan" });
    const items = (await req("GET", "/api/sources")).json().items;
    expect(items.find((i: { source: string }) => i.source === "company-careers").configured).toBe(true);
  });
});
