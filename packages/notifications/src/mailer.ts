import nodemailer from "nodemailer";

export type MailAttachment = { filename: string; content: Buffer };
export type OutgoingMail = {
  /** Nom affiché de l'expéditeur (ex. « Prénom NOM ») ; l'adresse est celle du compte SMTP. */
  fromName: string;
  to: string;
  subject: string;
  text: string;
  attachments: MailAttachment[];
};

export type Mailer = {
  isConfigured(): boolean;
  /** Adresse d'envoi (compte SMTP). */
  address(): string | null;
  /** Renvoie le Message-ID du mail envoyé (les réponses dans ce fil sont reconnues dans « Candidatures »). */
  send(mail: OutgoingMail): Promise<string | null | void>;
};

type Transport = (msg: { from: string; to: string; subject: string; text: string; attachments: MailAttachment[] }) => Promise<unknown>;

/**
 * Envoi d'emails en ton nom (candidatures spontanées), par le même compte SMTP que les notifications (Gmail).
 * Avec Gmail, le message apparaît aussi dans « Messages envoyés ».
 */
export function createMailer(
  cfg: { host?: string | undefined; port?: number | undefined; user?: string | undefined; password?: string | undefined },
  transport?: Transport,
): Mailer {
  const configured = Boolean(cfg.host && cfg.user && cfg.password);
  let t: Transport | undefined = transport;
  const get = (): Transport => {
    if (!t) {
      const tr = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port ?? 587,
        secure: (cfg.port ?? 587) === 465,
        auth: { user: cfg.user!, pass: cfg.password! },
      });
      t = (msg) => tr.sendMail(msg);
    }
    return t;
  };
  return {
    isConfigured: () => configured || Boolean(transport),
    address: () => cfg.user ?? null,
    async send(mail) {
      if (!configured && !transport) throw new Error("Envoi d'email non configuré (SMTP_HOST, SMTP_USER, SMTP_PASSWORD dans .env).");
      const name = mail.fromName.replace(/["<>]/g, "").trim();
      const info = await get()({
        from: name ? `"${name}" <${cfg.user}>` : cfg.user!,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        attachments: mail.attachments,
      });
      return (info as { messageId?: string } | undefined)?.messageId ?? null;
    },
  };
}
