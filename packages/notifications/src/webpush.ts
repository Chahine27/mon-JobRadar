import webpush from "web-push";
import { pushPayload } from "./format";
import type { JobAlert, Notice, Notifier } from "./types";

export type PushSubscriptionRecord = { endpoint: string; keys: { p256dh: string; auth: string } };

export type WebPushConfig = {
  publicKey?: string | undefined;
  privateKey?: string | undefined;
  /** Contact exigé par le protocole (mailto:…). */
  subject?: string | undefined;
  subscriptions: {
    list(): Promise<PushSubscriptionRecord[]>;
    remove(endpoint: string): Promise<void>;
  };
  /** Au-delà, une seule notification récapitulative. */
  maxIndividual?: number;
};

type Sender = (sub: PushSubscriptionRecord, payload: string) => Promise<unknown>;

export function createWebPushNotifier(cfg: WebPushConfig, sender?: Sender): Notifier {
  const configured = Boolean(cfg.publicKey && cfg.privateKey);
  const send: Sender =
    sender ??
    ((sub, payload) =>
      webpush.sendNotification(sub, payload, {
        TTL: 24 * 3600,
        vapidDetails: { subject: cfg.subject || "mailto:job-radar@localhost", publicKey: cfg.publicKey!, privateKey: cfg.privateKey! },
      }));

  async function broadcast(payloads: string[]) {
    const subs = await cfg.subscriptions.list();
    if (subs.length === 0) throw new Error("Aucun navigateur abonné (Profil → Notifications → Activer sur ce navigateur)");
    let delivered = 0;
    for (const sub of subs) {
      for (const payload of payloads) {
        try {
          await send(sub, payload);
          delivered++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // 404 / 410 : abonnement expiré ou révoqué → on l'oublie.
          if (status === 404 || status === 410) {
            await cfg.subscriptions.remove(sub.endpoint);
            break;
          }
          throw err;
        }
      }
    }
    if (delivered === 0) throw new Error("Aucun navigateur joignable (abonnements expirés)");
  }

  return {
    channel: "webpush",
    isConfigured: () => configured,
    hasRecipients: async () => (await cfg.subscriptions.list()).length > 0,
    async sendAlerts(alerts: JobAlert[]) {
      if (!alerts.length) return;
      const max = cfg.maxIndividual ?? 3;
      const payloads =
        alerts.length <= max
          ? alerts.map(pushPayload)
          : [
              ...alerts.slice(0, max).map(pushPayload),
              JSON.stringify({
                title: `+ ${alerts.length - max} autre(s) offre(s) ${alerts[0]!.kind === "complete" ? "à compléter" : "compatible(s)"}`,
                body: "Ouvre Job Radar pour les voir.",
                url: new URL("/", alerts[0]!.url).href,
                tag: "job-radar-summary",
              }),
            ];
      await broadcast(payloads);
    },
    async sendNotice(n: Notice) {
      await broadcast([JSON.stringify(n)]);
    },
    async sendTest() {
      await broadcast([JSON.stringify({ title: "Job Radar", body: "Les notifications du navigateur fonctionnent.", url: "/", tag: "test" })]);
    },
  };
}

export function generateVapidKeys() {
  return webpush.generateVAPIDKeys();
}
