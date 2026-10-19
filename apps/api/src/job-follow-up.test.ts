import { describe, expect, it } from "vitest";
import { createTestApp, login } from "./test-helpers";

const DAY = 86_400_000;

describe("relance des candidatures sur offre", () => {
  it("sans réponse depuis 14 jours : signalée ; « J'ai relancé » relance le délai ; annulable", async () => {
    const t = await createTestApp();
    const cookies = await login(t.app);
    const req = (method: "GET" | "POST", url: string, payload?: object) => t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
    // Candidature envoyée il y a 20 jours, aucune nouvelle.
    t.jobs.get("j-vue")!.status = "APPLIED";
    t.events.push({ jobId: "j-vue", from: "NEW", to: "APPLIED", at: new Date(Date.now() - 20 * DAY) });
    const appOf = async () => (await req("GET", "/api/applications")).json().jobs.find((j: { id: string }) => j.id === "j-vue");

    expect(await appOf()).toMatchObject({ noAnswer: true, stage: "REJECTED", followedUpAt: null });

    expect((await req("POST", "/api/applications/jobs/j-vue/followed-up", { done: true })).statusCode).toBe(200);
    const relanced = await appOf();
    expect(relanced.followedUpAt).not.toBeNull();
    expect(relanced).toMatchObject({ noAnswer: false, stage: "SENT" }); // 14 jours de plus pour répondre

    await req("POST", "/api/applications/jobs/j-vue/followed-up", { done: false });
    expect(await appOf()).toMatchObject({ noAnswer: true, followedUpAt: null });
    expect((await req("POST", "/api/applications/jobs/inconnue/followed-up", { done: true })).statusCode).toBe(404);
  });
});
