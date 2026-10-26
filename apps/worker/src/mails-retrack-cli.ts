/**
 * Relit les réponses de candidature des 60 derniers jours avec les règles actuelles de rattachement (mail rattaché au
 * mauvais poste, refus identiques d'une même entreprise, nom d'entreprise écrit autrement…).
 * Les mails reconnus sont effacés puis relus dans la boîte (lecture seule, IA gratuites) ; ceux que tu as écartés restent
 * écartés. Une offre passée « Refusée » par un refus qui ne lui est plus rattaché redevient « Postulé ».
 * À lancer sur le serveur :
 *   pnpm mails:retrack          → dit ce qui serait relu (n'écrit rien)
 *   pnpm mails:retrack --apply  → relit et met à jour
 */
import "./env"; // charge .env
import { aiChain, readApplicationMailWithAi } from "@job-radar/ai";
import { createPrismaClient } from "@job-radar/db";
import { createImapInbox, imapHostFrom } from "@job-radar/notifications";
import { trackApplicationMails } from "@job-radar/pipeline";

const e = process.env;
const apply = process.argv.includes("--apply");
const prisma = createPrismaClient();
// Même fenêtre que le clic « Actualiser » (60 jours) : au-delà, la boîte n'est pas relue et rien n'est effacé.
const since = new Date(Date.now() - 60 * 86_400_000);
const where = { dismissed: false, receivedAt: { gte: since }, kind: { in: ["ACK", "INTERVIEW", "OFFER", "REJECTION", "CAREER_SITE"] } };
try {
  const mails = await prisma.applicationMail.findMany({ where, select: { kind: true, jobId: true, job: { select: { status: true } } } });
  const rejectedJobs = [...new Set(mails.filter((m) => m.kind === "REJECTION" && m.job?.status === "REJECTED").map((m) => m.jobId!))];
  console.log(`${mails.length} réponse(s) reconnue(s) depuis le ${since.toLocaleDateString("fr-FR")} à relire, ${rejectedJobs.length} offre(s) refusée(s) par mail à revérifier.`);
  if (!apply) {
    console.log("Rien n'a été écrit. Pour relire : pnpm mails:retrack --apply");
  } else {
    const inbox = createImapInbox({
      host: e.IMAP_HOST?.trim() || imapHostFrom(e.SMTP_HOST?.trim()),
      port: e.IMAP_PORT ? Number(e.IMAP_PORT) : 993,
      user: e.SMTP_USER?.trim(),
      password: e.SMTP_PASSWORD?.replace(/\s/g, ""),
    });
    if (!inbox.isConfigured()) throw new Error("Boîte mail non configurée (SMTP_USER / SMTP_PASSWORD dans .env)");
    await prisma.applicationMail.deleteMany({ where });
    const mailAi = aiChain(e, "mail", (m) => console.log(m));
    const r = await trackApplicationMails({
      prisma,
      inbox,
      full: true,
      self: [e.SMTP_USER, e.NOTIFY_EMAIL_TO].map((a) => a?.trim()).filter((a): a is string => !!a),
      classify: (m, candidates) => readApplicationMailWithAi(mailAi, m, candidates),
      log: (m) => console.log(m),
    });
    // Refus qui ne lui est plus rattaché : l'offre redevient « Postulé » (un nouveau refus sûr l'aurait déjà repassée « Refusée »).
    let reopened = 0;
    for (const jobId of rejectedJobs) {
      const still = await prisma.applicationMail.count({ where: { jobId, kind: "REJECTION", dismissed: false } });
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
      if (still || job?.status !== "REJECTED") continue;
      await prisma.$transaction([
        prisma.job.update({ where: { id: jobId }, data: { status: "APPLIED" } }),
        prisma.jobEvent.create({ data: { jobId, type: "STATUS_CHANGED", fromValue: "REJECTED", toValue: "APPLIED" } }),
      ]);
      reopened++;
    }
    console.log(`${r.read} mail(s) relu(s), ${r.recorded} réponse(s) rattachée(s), ${r.rejected} refus, ${reopened} offre(s) repassée(s) « Postulé ».`);
  }
} finally {
  await prisma.$disconnect();
}
