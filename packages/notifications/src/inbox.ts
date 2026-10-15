import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

/** Mêmes formes que dans le pipeline (sans en dépendre). */
export type InboxMail = {
  messageId: string;
  folder: string;
  from: string;
  fromName: string;
  subject: string;
  text: string;
  date: Date;
  replyTo: string[];
};
export type MailCursorRow = { folder: string; uidValidity: string; lastUid: number };

export type InboxConfig = { host?: string | undefined; port?: number | undefined; user?: string | undefined; password?: string | undefined };

/** Mails lus au plus par dossier et par passage : un premier passage sur des semaines se fait en plusieurs fois. */
const MAX_PER_FOLDER = 300;

/**
 * Gmail sait chercher dans le texte côté serveur : on ne télécharge que ce qui parle d'une réponse à une candidature.
 * Pas de mots trop larges (« offre », « poste », « job ») : ils ramènent toutes les alertes emploi et rendent la lecture lente.
 * Les noms des entreprises où tu as postulé sont ajoutés à part (voir gmailQuery).
 */
const GMAIL_WORDS = [
  "candidature", "candidatures", "application", "entretien", "interview", "recrutement", "recruteur", "recruiting",
  "embauche", "malheureusement", "unfortunately", "regret", "disponibilités",
  '"donner suite"', '"votre démarche"', '"test technique"', '"cas pratique"', '"pas été retenue"', '"not been selected"',
  // Mail non distribué (adresse de candidature spontanée introuvable).
  "from:mailer-daemon", "from:postmaster",
];

/**
 * Recherche Gmail : les mots ci-dessus, OU le nom d'une entreprise où tu as postulé, OU un expéditeur déjà reconnu
 * (un refus qui ne contient aucun des mots est quand même lu). Coupée à ~1 500 caractères (limite des commandes IMAP).
 */
export function gmailQuery(terms: string[] = []): string {
  let q = GMAIL_WORDS.join(" OR ");
  for (const t of new Set(terms.map((t) => t.replace(/["()]/g, " ").replace(/\s+/g, " ").trim()).filter((t) => t.length >= 3))) {
    const part = /^[^\s@]+@[^\s@]+$/.test(t) ? `from:${t}` : `"${t}"`;
    if (q.length + part.length > 1_450) break; // + le filtre des onglets ci-dessous
    q += ` OR ${part}`;
  }
  return q;
}

/** Hôte IMAP déduit du SMTP (smtp.gmail.com → imap.gmail.com) si IMAP_HOST n'est pas donné. */
export function imapHostFrom(smtpHost: string | undefined): string | undefined {
  return smtpHost?.replace(/^smtp\./, "imap.");
}

/**
 * Boîte mail en LECTURE SEULE (dossier ouvert en « EXAMINE ») : rien n'est marqué comme lu, déplacé ou supprimé.
 * Gmail : « Tous les messages » (lus, non lus, archivés) + Spam. Autres : boîte de réception + courrier indésirable.
 */
export function createImapInbox(cfg: InboxConfig) {
  const configured = Boolean(cfg.host && cfg.user && cfg.password);
  return {
    isConfigured: () => configured,
    /** `skip` : mails à ne pas télécharger (déjà traités, ou tes propres envois avec leurs pièces jointes), lu dans l'enveloppe. */
    async fetchNew(opts: {
      since: Date;
      cursors: MailCursorRow[];
      terms?: string[];
      rescanSince?: Date;
      skip?: (m: { messageId: string; from: string }) => boolean;
    }): Promise<{ mails: InboxMail[]; cursors: MailCursorRow[] }> {
      if (!configured) throw new Error("Boîte mail non configurée (SMTP_USER, SMTP_PASSWORD, IMAP_HOST dans .env).");
      const client = new ImapFlow({
        host: cfg.host!,
        port: cfg.port ?? 993,
        secure: (cfg.port ?? 993) === 993,
        auth: { user: cfg.user!, pass: cfg.password! },
        logger: false,
      });
      await client.connect();
      const mails: InboxMail[] = [];
      const cursors: MailCursorRow[] = [];
      try {
        const boxes = await client.list();
        const all = boxes.find((b) => b.specialUse === "\\All")?.path ?? "INBOX";
        const junk = boxes.find((b) => b.specialUse === "\\Junk")?.path;
        const gmail = client.capabilities.has("X-GM-EXT-1");
        const query = gmailQuery(opts.terms);
        for (const folder of [all, ...(junk ? [junk] : [])]) {
          const lock = await client.getMailboxLock(folder, { readOnly: true });
          try {
            const box = client.mailbox;
            if (!box) continue;
            const uidValidity = String(box.uidValidity);
            const cursor = opts.cursors.find((c) => c.folder === folder && c.uidValidity === uidValidity);
            const found = await client.search(
              {
                // Relecture demandée (candidature marquée après coup) : les nouveaux mails ET ceux depuis cette date.
                ...(cursor
                  ? opts.rescanSince
                    ? { or: [{ uid: `${cursor.lastUid + 1}:*` }, { since: opts.rescanSince }] }
                    : { uid: `${cursor.lastUid + 1}:*` }
                  : { since: opts.since }),
                // Onglets Promotions et Réseaux sociaux de Gmail : newsletters et alertes, jamais une réponse de recruteur.
                ...(gmail ? { gmraw: `(${query}) -category:promotions -category:social` } : {}),
              },
              { uid: true },
            );
            // « N:* » renvoie toujours le dernier message, même déjà lu : on filtre.
            // Relecture : les plus récents d'abord (sinon les mêmes 300 anciens à chaque passage).
            let uids = (found || [])
              .filter((u) => !cursor || opts.rescanSince || u > cursor.lastUid)
              .sort((a, b) => (opts.rescanSince ? b - a : a - b))
              .slice(0, MAX_PER_FOLDER);
            let lastUid = cursor?.lastUid ?? 0;
            for (const u of uids) lastUid = Math.max(lastUid, u);
            if (uids.length && opts.skip) {
              // Enveloppe seule (léger) : on ne télécharge pas ce qui est déjà traité ni tes envois (CV et lettre en PDF).
              const keep: number[] = [];
              for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
                const id = msg.envelope?.messageId ?? "";
                const from = msg.envelope?.from?.[0]?.address ?? "";
                if (!id || !opts.skip({ messageId: id, from })) keep.push(msg.uid);
              }
              uids = keep;
            }
            if (uids.length) {
              for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
                lastUid = Math.max(lastUid, msg.uid);
                if (!msg.source) continue;
                const p = await simpleParser(msg.source);
                const from = p.from?.value[0];
                if (!p.messageId || !from?.address) continue;
                const refs = [p.inReplyTo, ...(Array.isArray(p.references) ? p.references : p.references ? [p.references] : [])];
                mails.push({
                  messageId: p.messageId,
                  folder,
                  from: from.address,
                  fromName: from.name ?? "",
                  subject: p.subject ?? "",
                  text: p.text || (typeof p.html === "string" ? p.html.replace(/<[^>]+>/g, " ") : ""),
                  date: p.date ?? new Date(),
                  replyTo: refs.filter((r): r is string => typeof r === "string"),
                });
              }
            } else if (!cursor) {
              // Rien depuis la date : on part du dernier message du dossier pour ne pas tout relire la prochaine fois.
              lastUid = Math.max(0, (box.uidNext ?? 1) - 1);
            }
            cursors.push({ folder, uidValidity, lastUid });
          } finally {
            lock.release();
          }
        }
      } finally {
        await client.logout().catch(() => {});
      }
      return { mails, cursors };
    },
  };
}
