import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./routes/notifications";
import { createTestApp, login } from "./test-helpers";

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const req = (method: "GET" | "PUT" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, req };
}

describe("notifications", () => {
  it("exige d'être connecté", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "GET", url: "/api/notifications/settings" })).statusCode).toBe(401);
  });

  it("lit et modifie les réglages", async () => {
    const { req } = await setup();
    const get = (await req("GET", "/api/notifications/settings")).json();
    expect(get).toMatchObject({ emailEnabled: true, emailConfigured: true, pushConfigured: false, vapidPublicKey: "BTestPublicKey" });
    const put = await req("PUT", "/api/notifications/settings", { emailEnabled: false, pushEnabled: true, emailTo: "moi@example.com" });
    expect(put.statusCode).toBe(200);
    expect((await req("GET", "/api/notifications/settings")).json().emailTo).toBe("moi@example.com");
    expect((await req("PUT", "/api/notifications/settings", { emailEnabled: true, pushEnabled: true, emailTo: "pas-un-email" })).statusCode).toBe(400);
  });

  it("abonnement navigateur : seuls les services de notification connus sont acceptés", async () => {
    const { req, pushSubs } = await setup();
    const keys = { p256dh: "BKey", auth: "auth" };
    expect((await req("POST", "/api/notifications/subscribe", { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys })).statusCode).toBe(200);
    expect((await req("POST", "/api/notifications/subscribe", { endpoint: "http://127.0.0.1:5432/x", keys })).statusCode).toBe(400);
    expect((await req("POST", "/api/notifications/subscribe", { endpoint: "https://evil.example/fcm.googleapis.com", keys })).statusCode).toBe(400);
    expect(pushSubs.size).toBe(1);
    await req("POST", "/api/notifications/unsubscribe", { endpoint: "https://fcm.googleapis.com/fcm/send/abc" });
    expect(pushSubs.size).toBe(0);
  });

  it("isAllowedPushEndpoint", () => {
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("javascript:alert(1)")).toBe(false);
  });

  it("envoi de test : canal configuré ou non", async () => {
    const { req, tests } = await setup();
    expect((await req("POST", "/api/notifications/test", { channel: "email" })).statusCode).toBe(200);
    expect((await req("POST", "/api/notifications/test", { channel: "webpush" })).statusCode).toBe(409);
    expect(tests).toEqual(["email"]);
  });
});
