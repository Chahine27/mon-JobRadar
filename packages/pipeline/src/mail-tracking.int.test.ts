import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../../db/test/helpers";
import { type Inbox, type InboxMail, trackApplicationMails } from "./mail-tracking";

const prisma = testPrisma();
beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

const mail = (m: Partial<InboxMail> & Pick<InboxMail, "messageId">): InboxMail => ({
  folder: "[Gmail]/Tous les messages", from: "no-reply@welcomekit.co", fromName: "", subject: "Votre candidature",
  text: "", date: new Date(), replyTo: [], ...m,
});
const inboxOf = (mails: InboxMail[]): Inbox & { calls: number } => {
  const inbox = {
    calls: 0,
    fetchNew: async () => {
      inbox.calls++;
      return { mails, cursors: [{ folder: "[Gmail]/Tous les messages", uidValidity: "1", lastUid: 42 }] };
    },
  };
  return inbox;
};

describe("suivi des candidatures par les mails (base réelle)", () => {
  it("accusé puis refus : statut « Refusée » ; spontanée reconnue dans le fil ; bruit ignoré ; jamais deux fois", async () => {
    const applied = new Date(Date.now() - 5 * 86_400_000);
    const job = await prisma.job.create({
      data: { fingerprint: "f1", contentHash: "h", title: "Développeur Vue.js", company: "Escape", description: "Vue", technologies: [], status: "APPLIED" },
    });
    await prisma.jobEvent.create({ data: { jobId: job.id, type: "STATUS_CHANGED", toValue: "APPLIED", createdAt: applied } });
    const lead = await prisma.companyLead.create({ data: { siret: "123", name: "Acme Industrie" } });
    const sp = await prisma.spontaneousApplication.create({
      data: { leadId: lead.id, inputHash: "", model: "manuel", letter: "…", sentAt: applied, sentTo: "rh@acme.fr", messageId: "<sent-1@gmail.com>" },
    });

    const inbox = inboxOf([
      mail({ messageId: "<ack@x>", text: "Nous avons bien reçu votre candidature chez Escape.", date: new Date(Date.now() - 3 * 86_400_000) }),
      mail({ messageId: "<no@x>", text: "Escape : malheureusement, nous ne donnerons pas suite à votre candidature." }),
      mail({ messageId: "<sp@x>", from: "dirigeant@autre.fr", subject: "Re: Candidature spontanée", text: "Bonjour, pouvez-vous m'indiquer vos disponibilités pour un échange téléphonique ?", replyTo: ["<sent-1@gmail.com>"] }),
      mail({ messageId: "<jr@x>", from: "moi@gmail.com", subject: "🟢 91 % — Développeur Vue.js chez Escape", text: "Escape" }),
      mail({ messageId: "<other@x>", text: "Merci pour votre candidature chez Globex." }),
    ]);
    const r = await trackApplicationMails({ prisma, inbox, self: ["moi@gmail.com"] });
    expect(r).toMatchObject({ read: 5, matched: 3, recorded: 3, rejected: 1 });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("REJECTED");
    const mails = await prisma.applicationMail.findMany({ orderBy: { receivedAt: "asc" } });
    expect(mails.map((m) => [m.kind, m.jobId ? "offre" : "spontanée"])).toEqual([["ACK", "offre"], ["REJECTION", "offre"], ["INTERVIEW", "spontanée"]]);
    expect(mails[2]!.spontaneousId).toBe(sp.id);
    expect((await prisma.mailCursor.findFirstOrThrow()).lastUid).toBe(42);

    // Même mails relus (ex. curseur réinitialisé) : rien n'est enregistré deux fois.
    expect((await trackApplicationMails({ prisma, inbox, self: ["moi@gmail.com"] })).recorded).toBe(0);
  });

  it("refus selon les règles mais pas selon l'IA (qui lit tout le mail) : l'IA l'emporte, le statut ne change pas", async () => {
    const job = await prisma.job.create({
      data: { fingerprint: "f2", contentHash: "h", title: "Développeur C#", company: "Abylsen", description: "C#", technologies: [], status: "APPLIED" },
    });
    await prisma.jobEvent.create({ data: { jobId: job.id, type: "STATUS_CHANGED", toValue: "APPLIED", createdAt: new Date(Date.now() - 86_400_000) } });
    const inbox = inboxOf([mail({ messageId: "<abylsen@x>", text: "Abylsen : votre candidature ne correspond pas à notre recherche." })]);
    const asked: string[] = [];
    await trackApplicationMails({
      prisma, inbox, self: [],
      classify: async (m) => (asked.push(m.subject), { index: 0, verdict: { kind: "ACK", detail: null }, summary: "Candidature reçue.", certain: true }),
    });
    expect(asked).toHaveLength(1);
    const saved = await prisma.applicationMail.findFirstOrThrow();
    expect(saved).toMatchObject({ kind: "ACK", summary: "Candidature reçue.", needsReview: false });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("APPLIED");
  });

  it("refus dont l'IA n'est pas sûre : gardé « à vérifier », le statut ne change pas ; mail en double ignoré", async () => {
    const job = await prisma.job.create({
      data: { fingerprint: "f9", contentHash: "h", title: "Développeur Java", company: "Abylsen", description: "Java", technologies: [], status: "APPLIED" },
    });
    await prisma.jobEvent.create({ data: { jobId: job.id, type: "STATUS_CHANGED", toValue: "APPLIED", createdAt: new Date(Date.now() - 86_400_000) } });
    const text = "Abylsen : nous ne donnerons pas suite à votre candidature.";
    const inbox = inboxOf([mail({ messageId: "<r1@x>", text }), mail({ messageId: "<r2@x>", text })]);
    await trackApplicationMails({
      prisma, inbox, self: [],
      classify: async () => ({ index: 0, verdict: { kind: "REJECTION", detail: null }, summary: "Refus.", certain: false }),
    });
    const saved = await prisma.applicationMail.findMany({ where: { jobId: job.id } });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ kind: "REJECTION", needsReview: true });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("APPLIED");
    expect(await prisma.applicationMail.count({ where: { kind: "DUPLICATE" } })).toBe(1);
  });

  it("adresse introuvable : candidature annulée, entreprise « À contacter » sans cette adresse, avec une note", async () => {
    const lead = await prisma.companyLead.create({ data: { siret: "456", name: "AGORAPULSE", contactEmail: "claire.bernard@agorapulse.com", status: "CONTACTED" } });
    const sp = await prisma.spontaneousApplication.create({
      data: { leadId: lead.id, inputHash: "", model: "m", letter: "…", sentAt: new Date(Date.now() - 60_000), sentTo: "claire.bernard@agorapulse.com", messageId: "<s@gmail.com>" },
    });
    const bounce = mail({
      messageId: "<bounce@x>", from: "mailer-daemon@googlemail.com", fromName: "Mail Delivery Subsystem", subject: "Delivery Status Notification (Failure)",
      text: "Adresse introuvable\nVotre message n'est pas parvenu à claire.bernard@agorapulse.com, car l'adresse est introuvable.\n550 5.1.1 The email account that you tried to reach does not exist.",
    });
    const inbox = inboxOf([bounce]);
    expect((await trackApplicationMails({ prisma, inbox, self: ["moi@gmail.com"] })).bounced).toBe(1);
    const after = await prisma.companyLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: "TO_CONTACT", contactEmail: null });
    expect(after.notes).toContain("claire.bernard@agorapulse.com rejeté");
    expect(await prisma.spontaneousApplication.findUniqueOrThrow({ where: { id: sp.id } })).toMatchObject({ sentAt: null, sentTo: null, letter: "…" });
    // Relu plus tard : rien de plus (et plus aucune candidature envoyée à suivre).
    expect((await trackApplicationMails({ prisma, inbox, self: [] })).bounced).toBe(0);
  });

  it("personne partie, nouvelle adresse : elle remplace l'ancienne, candidature à renvoyer ; site carrière noté", async () => {
    const sentAt = new Date(Date.now() - 3_600_000);
    const naxos = await prisma.companyLead.create({ data: { siret: "789", name: "NAXOS", contactEmail: "sophie.lambert@naxos.fr", status: "CONTACTED" } });
    const rmc = await prisma.companyLead.create({ data: { siret: "790", name: "NEXTINTERACTIVE", contactEmail: "accueil@rmcbfm.com", status: "CONTACTED" } });
    await prisma.spontaneousApplication.create({ data: { leadId: naxos.id, inputHash: "", model: "m", letter: "…", sentAt, sentTo: "sophie.lambert@naxos.fr", messageId: "<n@gmail.com>" } });
    const sp = await prisma.spontaneousApplication.create({ data: { leadId: rmc.id, inputHash: "", model: "m", letter: "…", sentAt, sentTo: "accueil@rmcbfm.com", messageId: "<r@gmail.com>" } });
    const inbox = inboxOf([
      mail({ messageId: "<auto@x>", from: "sophie.lambert@naxos.fr", subject: "Réponse automatique : Candidature spontanée", text: "Sophie LAMBERT ne fait plus partie de la société.\nVeuillez adresser votre message à Julie (julie.moreau@naxos.fr)." }),
      mail({ messageId: "<rmc@x>", from: "accueil@rmcbfm.com", subject: "RE: Candidature spontanée", text: "Bonjour,\nVous pourrez retrouver toutes les offres d'emploi sur le site : https://jobs.cmacgm-group.com/\nCordialement,", replyTo: ["<r@gmail.com>"] }),
    ]);
    await trackApplicationMails({ prisma, inbox, self: [] });
    expect(await prisma.companyLead.findUniqueOrThrow({ where: { id: naxos.id } })).toMatchObject({ status: "TO_CONTACT", contactEmail: "julie.moreau@naxos.fr" });
    const reply = await prisma.applicationMail.findFirstOrThrow({ where: { spontaneousId: sp.id } });
    expect(reply).toMatchObject({ kind: "CAREER_SITE", detail: "https://jobs.cmacgm-group.com/" });
    expect((await prisma.companyLead.findUniqueOrThrow({ where: { id: rmc.id } })).notes).toContain("https://jobs.cmacgm-group.com/");
  });

  it("clic « Actualiser » : relit depuis la date d'envoi, sans retélécharger ce qui est déjà traité", async () => {
    const sentAt = new Date(Date.now() - 7 * 86_400_000);
    const lead = await prisma.companyLead.create({ data: { siret: "999", name: "Globex" } });
    await prisma.spontaneousApplication.create({ data: { leadId: lead.id, inputHash: "", model: "m", letter: "…", sentAt, sentTo: "rh@globex.fr" } });
    await prisma.mailCursor.create({ data: { folder: "[Gmail]/Tous les messages", uidValidity: "1", lastUid: 40 } });
    const calls: Array<Parameters<Inbox["fetchNew"]>[0]> = [];
    const inbox: Inbox = { fetchNew: async (o) => (calls.push(o), { mails: [], cursors: [] }) };
    await trackApplicationMails({ prisma, inbox, self: ["moi@gmail.com"], full: true });
    expect(Math.abs(calls[0]!.rescanSince!.getTime() - (sentAt.getTime() - 3_600_000))).toBeLessThan(1000);
    expect(calls[0]!.skip!({ messageId: "<x@y>", from: "Moi@gmail.com" })).toBe(true);
    await trackApplicationMails({ prisma, inbox, self: [] });
    expect(calls[1]!.rescanSince).toBeUndefined(); // passage automatique : seulement les nouveaux
  });

  it("aucune candidature : la boîte n'est même pas lue", async () => {
    const inbox = inboxOf([]);
    await trackApplicationMails({ prisma, inbox, self: [] });
    expect(inbox.calls).toBe(0);
  });
});

describe("relecture après un « postulé » tardif (base réelle)", () => {
  it("candidature marquée depuis la dernière lecture : on relit 7 jours, puis plus rien à relire", async () => {
    const job = await prisma.job.create({
      data: { fingerprint: "f9", contentHash: "h", title: "Ingénieur logiciel", company: "Eurofins Biologie Médicale", description: "", technologies: [], status: "APPLIED" },
    });
    await prisma.mailCursor.create({ data: { folder: "[Gmail]/Tous les messages", uidValidity: "1", lastUid: 40, checkedAt: new Date(Date.now() - 3_600_000) } });
    await prisma.jobEvent.create({ data: { jobId: job.id, type: "STATUS_CHANGED", toValue: "APPLIED" } });
    const calls: Array<{ rescanSince?: Date; terms?: string[] }> = [];
    const inbox: Inbox = {
      fetchNew: async (o) => {
        calls.push(o);
        return { mails: [], cursors: [{ folder: "[Gmail]/Tous les messages", uidValidity: "1", lastUid: 42 }] };
      },
    };
    await trackApplicationMails({ prisma, inbox, self: [] });
    expect(calls[0]!.rescanSince!.getTime()).toBeLessThan(Date.now() - 6 * 86_400_000);
    expect(calls[0]!.terms).toContain("Eurofins Biologie Médicale");
    await trackApplicationMails({ prisma, inbox, self: [] });
    expect(calls[1]!.rescanSince).toBeUndefined();
  });
});
