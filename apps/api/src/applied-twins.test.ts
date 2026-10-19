import { describe, expect, it } from "vitest";
import { createTestApp, job, login } from "./test-helpers";

/** Cas réel : la même offre Ingeniance envoyée le 15/10 via Free-Work puis le 16/10 via Adzuna. */
async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const add = (id: string, title: string, company: string, source: string) =>
    t.jobs.set(id, job({ id, title, company, city: "Paris", department: "75", description: "Java, Spring Boot", sources: [{ source, url: `https://example.com/${id}` }] }));
  add("free-work", "Développeur Java Junior Spring Boot / BDD Cucumber - F/H", "INGENIANCE", "manual");
  add("adzuna", "Développeur Java Junior Spring Boot / BDD Cucumber - F/H (IT)", "Ingeniance", "adzuna");
  add("autre-poste", "Développeur / Architecte Java Big Data - Finance de marché - F/H", "Ingeniance", "adzuna");
  // Canal et CV obligatoires au premier « Postulé » (testés à part, dans jobs.test.ts).
  const status = (id: string, body: object) => t.app.inject({ method: "POST", url: `/api/jobs/${id}/status`, cookies, payload: { channel: "mail", cv: "ats", ...body } });
  return { ...t, cookies, status };
}

describe("anti-doublon avant de postuler", () => {
  it("même offre vue sur un autre site : prévient et demande confirmation", async () => {
    const { status, app, cookies } = await setup();
    expect((await status("free-work", { status: "APPLIED" })).statusCode).toBe(200);

    const twin = await status("adzuna", { status: "APPLIED" });
    expect(twin.statusCode).toBe(409);
    expect(twin.json()).toMatchObject({ error: "ALREADY_APPLIED", twins: [{ id: "free-work", sources: ["manual"] }] });
    expect(twin.json().message).toContain("Tu as déjà postulé à cette offre");
    // Affiché aussi sur la page de l'offre, avant même de postuler.
    const page = (await app.inject({ method: "GET", url: "/api/jobs/adzuna", cookies })).json();
    expect(page.appliedTwins).toMatchObject([{ id: "free-work" }]);
    expect(page.status).not.toBe("APPLIED");

    // Confirmé : c'est voulu.
    const forced = await status("adzuna", { status: "APPLIED", confirmDuplicate: true });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().status).toBe("APPLIED");
  });

  it("autre poste chez la même entreprise : rien ne bloque", async () => {
    const { status } = await setup();
    await status("free-work", { status: "APPLIED" });
    expect((await status("autre-poste", { status: "APPLIED" })).statusCode).toBe(200);
  });

  it("offre déjà postulée remise en attente après un refus : pas de question", async () => {
    const { status } = await setup();
    await status("free-work", { status: "APPLIED" });
    await status("adzuna", { status: "APPLIED", confirmDuplicate: true });
    await status("adzuna", { status: "REJECTED" });
    expect((await status("adzuna", { status: "APPLIED" })).statusCode).toBe(200);
  });
});
