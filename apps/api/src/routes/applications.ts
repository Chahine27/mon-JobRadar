import { applicationStage, noAnswer } from "@job-radar/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import type { JobService } from "../jobs/service";
import type { ApplicationMailRow, Stores } from "../stores";

/** Suivi des mails (lecture seule de la boîte) : état affiché sur la page, et vérification à la demande. */
export type MailTracker = {
  status(): { configured: boolean; running: boolean; lastCheckAt: Date | null; lastError: string | null };
  /** `full` : clic sur « Actualiser », relit tout depuis la plus ancienne candidature. */
  run(opts?: { full?: boolean }): Promise<unknown>;
};

const IdParams = z.object({ id: z.string().min(1).max(64) });

const toMail = (m: ApplicationMailRow) => ({
  id: m.id,
  kind: m.kind,
  detail: m.detail,
  summary: m.summary,
  needsReview: m.needsReview,
  subject: m.subject,
  from: m.fromAddress,
  // Recherche Gmail par Message-ID : ouvre exactement ce mail (boîte suivie = Gmail).
  url: `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(m.messageId.replace(/^<|>$/g, ""))}`,
  receivedAt: m.receivedAt,
  dismissed: m.dismissed,
});

/** Candidatures : sur une offre et spontanées, chacune avec son étape (déduite des mails reçus) et ses mails. */
export async function applicationRoutes(app: FastifyInstance, opts: { stores: Stores; jobs: JobService; mailTracker?: MailTracker }) {
  const { stores, jobs } = opts;
  app.addHook("preHandler", requireAuth);

  app.get("/api/applications", async (request) => {
    const [offers, sent, leads, mails, cvs] = await Promise.all([
      jobs.listApplications(request.userId!),
      stores.applications.listSent(),
      stores.leads.list(),
      stores.applicationMails.list(),
      stores.tailoredCvs.exported(),
    ]);
    const mailsOf = (key: "jobId" | "spontaneousId", id: string) => mails.filter((m) => m[key] === id);
    const leadById = new Map(leads.map((l) => [l.id, l]));
    return {
      jobs: offers.map((j) => {
        const own = mailsOf("jobId", j.id);
        // CV envoyé : ceux exportés au moment de « Postulé » (sinon les exportés, s'il n'y a pas eu de marque).
        const own_cvs = cvs.filter((c) => c.jobId === j.id);
        const sentCvs = own_cvs.some((c) => c.sentAt) ? own_cvs.filter((c) => c.sentAt) : own_cvs;
        const stage = applicationStage(own, j.status === "REJECTED");
        // Aucune nouvelle depuis 14 jours : refus de fait (le statut de l'offre ne change pas, une réponse le corrige).
        const silent = noAnswer(stage, j.appliedAt, own);
        return {
          ...j,
          stage: silent ? "REJECTED" : stage,
          noAnswer: silent,
          mails: own.map(toMail),
          cvs: sentCvs.map((c) => ({ template: c.template, exportedAt: c.exportedAt, sentAt: c.sentAt })),
        };
      }),
      spontaneous: sent.flatMap((s) => {
        const lead = leadById.get(s.leadId);
        if (!lead) return [];
        const own = mailsOf("spontaneousId", s.id);
        return [
          {
            id: s.id,
            leadId: s.leadId,
            company: lead.name,
            city: lead.city,
            department: lead.department,
            sentAt: s.sentAt,
            sentTo: s.sentTo,
            // Rien à postuler sur leur site : candidature close.
            stage: s.noOpeningAt ? "REJECTED" : applicationStage(own, false, !!s.appliedOnSiteAt),
            appliedOnSiteAt: s.appliedOnSiteAt,
            noOpeningAt: s.noOpeningAt,
            followedUpAt: s.followedUpAt,
            mails: own.map(toMail),
          },
        ];
      }),
      tracking: opts.mailTracker?.status() ?? { configured: false, running: false, lastCheckAt: null, lastError: null },
    };
  });

  app.post("/api/applications/check", async (_request, reply) => {
    if (!opts.mailTracker?.status().configured) {
      return reply.code(503).send({ error: "MAIL_TRACKING_OFF", message: "Suivi des mails désactivé (MAIL_TRACKING_ENABLED=true dans .env)." });
    }
    await opts.mailTracker.run({ full: true });
    return opts.mailTracker.status();
  });

  // Renvoyé vers leur site carrière : « J'ai postulé sur leur site » (le suivi des réponses continue),
  // « Rien à postuler sur leur site » (candidature close), ou null pour annuler.
  app.post("/api/applications/spontaneous/:id/site-outcome", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = z.object({ outcome: z.enum(["applied", "none"]).nullable() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    const ok = await stores.applications.setSiteOutcome(params.data.id, body.data.outcome, new Date());
    if (!ok) return reply.code(404).send({ error: "APPLICATION_NOT_FOUND" });
    return { ok: true };
  });

  // « Oui, c'est bien ça » : le mail n'est plus à vérifier ; un refus confirmé passe l'offre en « Refusée ».
  app.post("/api/applications/mails/:id/confirm", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const mail = await stores.applicationMails.confirm(params.data.id);
    if (!mail) return reply.code(404).send({ error: "MAIL_NOT_FOUND" });
    if (mail.kind === "REJECTION" && mail.jobId && (await stores.jobs.get(mail.jobId))?.status === "APPLIED") {
      await jobs.setStatus(request.userId!, mail.jobId, "REJECTED");
    }
    return toMail(mail);
  });

  // « Ce mail ne concerne pas cette candidature » : il ne compte plus. Un refus écarté remet l'offre en attente.
  app.post("/api/applications/mails/:id/dismiss", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const mail = await stores.applicationMails.dismiss(params.data.id);
    if (!mail) return reply.code(404).send({ error: "MAIL_NOT_FOUND" });
    if (mail.kind === "REJECTION" && mail.jobId) {
      const job = await stores.jobs.get(mail.jobId);
      const otherRejection = (await stores.applicationMails.list()).some((m) => m.jobId === mail.jobId && m.kind === "REJECTION" && !m.dismissed);
      if (job?.status === "REJECTED" && !otherRejection) await jobs.setStatus(request.userId!, mail.jobId, "APPLIED");
    }
    return toMail(mail);
  });
}
