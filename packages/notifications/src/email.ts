import nodemailer from "nodemailer";
import { emailHtml, emailSubject, emailText } from "./format";
import type { JobAlert, Notifier } from "./types";

export type EmailConfig = {
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  from?: string | undefined;
  /** Destinataire : fonction pour lire la valeur à jour (réglable depuis le site). */
  to: () => Promise<string | null>;
};

type SendMail = (msg: { from: string; to: string; subject: string; text: string; html: string }) => Promise<unknown>;

export function createEmailNotifier(cfg: EmailConfig, sendMail?: SendMail): Notifier {
  const configured = Boolean(cfg.host && cfg.user && cfg.password);
  let transport: SendMail | undefined = sendMail;

  function send(): SendMail {
    if (!transport) {
      const t = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port ?? 587,
        secure: (cfg.port ?? 587) === 465, // 465 = TLS direct ; 587 = STARTTLS
        auth: { user: cfg.user!, pass: cfg.password! },
      });
      transport = (msg) => t.sendMail(msg);
    }
    return transport;
  }

  async function deliver(subject: string, text: string, html: string) {
    const to = await cfg.to();
    if (!to) throw new Error("Aucune adresse de destination (réglage Notifications ou NOTIFY_EMAIL_TO)");
    await send()({ from: cfg.from || `Job Radar <${cfg.user}>`, to, subject, text, html });
  }

  return {
    channel: "email",
    isConfigured: () => configured,
    async sendAlerts(alerts: JobAlert[]) {
      if (alerts.length) await deliver(emailSubject(alerts), emailText(alerts), emailHtml(alerts));
    },
    async sendTest() {
      await deliver(
        "Job Radar — email de test",
        "Les notifications par email fonctionnent.",
        "<p>Les notifications par email de <strong>Job Radar</strong> fonctionnent.</p>",
      );
    },
  };
}
