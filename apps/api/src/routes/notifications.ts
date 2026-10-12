import type { Notifier } from "@job-radar/notifications";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import type { Stores } from "../stores";

/**
 * Le serveur enverra des requêtes vers l'adresse fournie par le navigateur :
 * on n'accepte que les services de notification connus (protection SSRF, README §26).
 */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const SettingsBody = z.object({
  emailEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  emailTo: z.email().max(254).nullable(),
});

const SubscribeBody = z.object({
  endpoint: z.string().max(2000).refine(isAllowedPushEndpoint, "Service de notification non reconnu"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

const TestBody = z.object({ channel: z.enum(["email", "webpush"]) });

export async function notificationRoutes(
  app: FastifyInstance,
  opts: { stores: Stores; notifiers: Notifier[]; vapidPublicKey: string | null },
) {
  const { stores, notifiers } = opts;
  app.addHook("preHandler", requireAuth);
  const byChannel = (c: string) => notifiers.find((n) => n.channel === c);

  app.get("/api/notifications/settings", async () => ({
    ...(await stores.notifications.getSettings()),
    emailConfigured: byChannel("email")?.isConfigured() ?? false,
    pushConfigured: byChannel("webpush")?.isConfigured() ?? false,
    vapidPublicKey: opts.vapidPublicKey,
    subscriptions: await stores.notifications.countSubscriptions(),
  }));

  app.put("/api/notifications/settings", async (request, reply) => {
    const body = SettingsBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_SETTINGS" });
    return stores.notifications.saveSettings(body.data);
  });

  app.post("/api/notifications/subscribe", async (request, reply) => {
    const body = SubscribeBody.safeParse(request.body);
    if (!body.success) {
      const host = (() => {
        try {
          return new URL(String((request.body as { endpoint?: unknown } | null)?.endpoint)).hostname;
        } catch {
          return "?";
        }
      })();
      return reply.code(400).send({ error: "INVALID_SUBSCRIPTION", message: `Abonnement refusé (service de notification : ${host}).` });
    }
    await stores.notifications.subscribe(request.userId!, body.data);
    return { ok: true };
  });

  app.post("/api/notifications/unsubscribe", async (request, reply) => {
    const body = z.object({ endpoint: z.string().max(2000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    await stores.notifications.unsubscribe(body.data.endpoint);
    return { ok: true };
  });

  app.post(
    "/api/notifications/test",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = TestBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "INVALID_CHANNEL" });
      const notifier = byChannel(body.data.channel);
      if (!notifier?.isConfigured()) return reply.code(409).send({ error: "CHANNEL_NOT_CONFIGURED" });
      try {
        await notifier.sendTest();
        return { ok: true };
      } catch (err) {
        // Message utile (ex. « authentification SMTP refusée ») sans détails internes.
        const message = err instanceof Error ? err.message.split("\n")[0]!.slice(0, 200) : "Erreur inconnue";
        return reply.code(502).send({ error: "SEND_FAILED", message });
      }
    },
  );

  app.get("/api/notifications", async () => ({ items: await stores.notifications.recent(50) }));
}
