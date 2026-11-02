import { LETTER_PROMPT_VERSION, checkLetter, letterHash, reviewBlock, spontaneousJobInput, type AnalysisJobInput } from "@job-radar/ai";
import { createHash } from "node:crypto";
import { EMPTY_LETTER_KIT, letterKitReady, type LetterKit, followUpDue } from "@job-radar/shared";
import { z } from "zod";
import { DEFAULT_PDF_NAME, renderLetterPdf, safeName } from "../letter-pdf";
import { DEFAULT_SPONTANEOUS_TITLE, defaultMail, followUpMail } from "../spontaneous-mail";
import type { LeadRow, StoredApplication } from "../stores";
import { type AiDeps, LetterBody, IdParams, errorReply, NOT_SAVED, reviewPending, writingKit } from "./ai-shared";

/** Candidatures spontanées : lettre, envoi, relances, et envois groupés. */
export function registerApplicationRoutes(deps: AiDeps) {
  const { app, opts, stores, ai, withLock, notifyLetter, runReview } = deps;
  // ───── Candidatures spontanées (entreprises La Bonne Boîte) : lettre IA + envoi par email après relecture ─────

  const TitleBody = z.object({ title: z.string().trim().min(3).max(120).optional() });
  const SendBody = z.object({
    to: z.email().max(200),
    subject: z.string().trim().min(3).max(250),
    message: z.string().trim().min(10).max(5_000),
    letter: z.string().trim().min(50).max(20_000),
    force: z.boolean().optional(),
  });

  async function applicationContext(userId: string, leadId: string, title = DEFAULT_SPONTANEOUS_TITLE) {
    const [lead, kit, application, cvPdfName] = await Promise.all([stores.leads.get(leadId), stores.letterKits.get(userId), stores.applications.get(leadId), stores.letterKits.cvPdfName(userId)]);
    if (!lead) return null;
    const job = spontaneousJobInput(
      { name: lead.name, sector: lead.nafLabel, city: lead.city, department: lead.department, headcountMin: lead.headcountMin, headcountMax: lead.headcountMax },
      title,
    );
    const inputHash = kit
      ? createHash("sha256").update(JSON.stringify(["spontanee", job, writingKit(kit), ai?.model ?? "", LETTER_PROMPT_VERSION])).digest("hex").slice(0, 32)
      : "";
    return { lead, kit, application, job, inputHash, title, cvPdfName };
  }

  function applicationReply(ctx: { lead: LeadRow; kit: LetterKit | null; application: StoredApplication | null; job: AnalysisJobInput; inputHash: string; title: string; cvPdfName: string | null }) {
    const kit = ctx.kit ?? EMPTY_LETTER_KIT;
    const letter = ctx.application?.letter ?? "";
    return {
      lead: ctx.lead,
      title: ctx.title,
      application: ctx.application,
      upToDate: !!ctx.application && ctx.application.inputHash === ctx.inputHash,
      kitReady: letterKitReady(ctx.kit),
      warnings: letter ? checkLetter(letter, kit, ctx.job.description, ctx.title, { spontaneous: true }) : [],
      /** raison du blocage de l'envoi (null = la lettre peut partir) */
      blocked: ctx.application ? reviewBlock(ctx.application.review, letter) : null,
      mail: { configured: !!opts.mailer?.isConfigured(), from: opts.mailer?.address() ?? null },
      cvPdf: { name: ctx.cvPdfName ?? "", found: !!ctx.cvPdfName },
      letterPdfName: safeName(kit.pdfName || DEFAULT_PDF_NAME),
      defaults: defaultMail(kit, ctx.lead.name, ctx.title),
    };
  }

  /** Relit la lettre spontanée enregistrée et garde le résultat. */
  async function reviewApplication(application: StoredApplication, leadId: string, ctx: { kit: LetterKit | null; job: AnalysisJobInput }): Promise<StoredApplication> {
    const review = await runReview(application.letter, { cvText: ctx.kit?.cvText ?? "", jobText: ctx.job.description, spontaneous: true, ...(ctx.kit ? { facts: ctx.kit } : {}) });
    await stores.applications.setReview(leadId, review);
    return { ...application, review };
  }

  app.get("/api/leads/:id/application", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const title = TitleBody.safeParse(request.query).data?.title;
    const ctx = await applicationContext(request.userId!, params.data.id, title);
    if (!ctx) return reply.code(404).send({ error: "LEAD_NOT_FOUND" });
    return applicationReply(ctx);
  });

  app.post("/api/leads/:id/application/letter", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = TitleBody.safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    if (!ai) return reply.code(503).send({ error: "AI_UNAVAILABLE", message: "IA non configurée." });
    const ctx = await applicationContext(request.userId!, params.data.id, body.data.title);
    if (!ctx) return reply.code(404).send({ error: "LEAD_NOT_FOUND" });
    if (!ctx.kit || !letterKitReady(ctx.kit)) {
      return reply.code(400).send({ error: "LETTER_KIT_MISSING", message: "Colle d'abord ton CV dans « CV & lettre »." });
    }
    try {
      const { content, model, durationMs } = await withLock(() => ai.writeLetter(ctx.job, ctx.kit!, { spontaneous: true }));
      const saved = await reviewApplication(await stores.applications.save(params.data.id, { inputHash: ctx.inputHash, model, letter: content }), params.data.id, ctx);
      request.log.info({ leadId: params.data.id, durationMs, model, problems: saved.review?.problems.length }, "lettre spontanée écrite et relue");
      notifyLetter(reply, request.userId!, {
        title: "Lettre de motivation terminée",
        body: `Candidature spontanée — ${ctx.lead.name}`,
        path: `/entreprises/${encodeURIComponent(params.data.id)}/candidature`,
        tag: `letter-${params.data.id}`,
      });
      return { ...applicationReply({ ...ctx, application: saved }), durationMs };
    } catch (err) {
      const e = errorReply(err);
      return reply.code(e.status).send(e.body);
    }
  });

  app.put("/api/leads/:id/application", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = LetterBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "INVALID_LETTER" });
    const ctx = await applicationContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "LEAD_NOT_FOUND" });
    const edited = await stores.applications.edit(params.data.id, body.data.content);
    if (!edited) return reply.code(404).send({ error: "APPLICATION_NOT_FOUND" });
    return applicationReply({ ...ctx, application: await reviewApplication(edited, params.data.id, ctx) });
  });

  app.post("/api/leads/:id/application/review", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const ctx = await applicationContext(request.userId!, params.data.id);
    if (!ctx?.application) return reply.code(404).send({ error: "APPLICATION_NOT_FOUND" });
    return applicationReply({ ...ctx, application: await reviewApplication(ctx.application, params.data.id, ctx) });
  });

  app.post("/api/leads/:id/application/review/validate", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const ctx = await applicationContext(request.userId!, params.data.id);
    const application = ctx?.application;
    if (!ctx || !application) return reply.code(404).send({ error: "APPLICATION_NOT_FOUND" });
    if (!application.review || application.review.hash !== letterHash(application.letter)) return reviewPending(reply, NOT_SAVED);
    const review = { ...application.review, validated: true };
    await stores.applications.setReview(params.data.id, review);
    return applicationReply({ ...ctx, application: { ...application, review } });
  });

  /** Envoi après relecture : lettre en PDF + CV PDF en pièces jointes, depuis ton adresse Gmail. Rien ne part sans ce clic. */
  app.post("/api/leads/:id/application/send", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = SendBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY", message: "Adresse email, objet, message ou lettre manquant." });
    const ctx = await applicationContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "LEAD_NOT_FOUND" });
    if (!opts.mailer?.isConfigured()) {
      return reply.code(503).send({ error: "MAIL_NOT_CONFIGURED", message: "Envoi d'email non configuré : remplis SMTP_HOST, SMTP_USER et SMTP_PASSWORD dans .env." });
    }
    const kit = ctx.kit ?? EMPTY_LETTER_KIT;
    const cvPdf = await stores.letterKits.cvPdf(request.userId!);
    if (!cvPdf) return reply.code(400).send({ error: "CV_PDF_MISSING", message: "CV PDF manquant : envoie-le dans « CV & lettre »." });
    const blocked = ctx.application ? reviewBlock(ctx.application.review, body.data.letter) : NOT_SAVED;
    if (blocked) return reviewPending(reply, blocked);
    if (ctx.application?.sentAt && !body.data.force) {
      return reply.code(409).send({ error: "ALREADY_SENT", message: `Déjà envoyée le ${ctx.application.sentAt.toLocaleDateString("fr-FR")} à ${ctx.application.sentTo}.` });
    }
    let messageId: string | null = null;
    try {
      const title = `Lettre de motivation - ${ctx.lead.name}`;
      messageId = (await opts.mailer.send({
        fromName: kit.signature,
        to: body.data.to,
        subject: body.data.subject,
        text: body.data.message,
        attachments: [
          { filename: safeName(kit.pdfName || DEFAULT_PDF_NAME), content: await renderLetterPdf(body.data.letter, title) },
          { filename: cvPdf.name, content: cvPdf.content },
        ],
      })) || null;
    } catch (err) {
      request.log.error({ err, leadId: params.data.id }, "envoi de candidature spontanée impossible");
      return reply.code(502).send({ error: "MAIL_FAILED", message: `L'email n'est pas parti : ${err instanceof Error ? err.message : String(err)}` });
    }
    const now = new Date();
    if (ctx.application) {
      if (ctx.application.letter !== body.data.letter) await stores.applications.edit(params.data.id, body.data.letter);
    } else {
      await stores.applications.save(params.data.id, { inputHash: "", model: "manuel", letter: body.data.letter });
    }
    await stores.applications.markSent(params.data.id, body.data.to, now, messageId);
    await stores.leads.update(params.data.id, { status: "CONTACTED", contactEmail: body.data.to.toLowerCase() });
    request.log.info({ leadId: params.data.id }, "candidature spontanée envoyée");
    const fresh = await applicationContext(request.userId!, params.data.id, ctx.title);
    return { ...applicationReply(fresh!), sentAt: now };
  });

  // ───── Relance d'une spontanée sans réponse : même adresse, même fil, même lettre et ton CV actuel ─────

  /** Aperçu de la relance (modifiable avant l'envoi). */
  app.get("/api/leads/:id/application/follow-up", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const ctx = await applicationContext(request.userId!, params.data.id);
    if (!ctx?.application?.sentAt || !ctx.application.sentTo) return reply.code(404).send({ error: "NOT_SENT", message: "Cette candidature n'a pas été envoyée par Job Radar." });
    return { to: ctx.application.sentTo, ...followUpMail(ctx.kit ?? EMPTY_LETTER_KIT, ctx.lead.name, ctx.title, ctx.application.sentAt), followedUpAt: ctx.application.followedUpAt };
  });

  const FollowUpBody = z.object({ subject: z.string().trim().min(3).max(250), message: z.string().trim().min(10).max(5_000) });
  type FollowUpFail = { status: number; error: string; message: string };

  /**
   * Envoie la relance d'une spontanée : même adresse, en réponse au premier mail (même fil), même lettre, CV actuel.
   * Sans objet ni message : ceux écrits par le code (followUpMail).
   */
  /** Relances en cours d'envoi : un 2ᵉ clic (ou le lot) pendant l'envoi ne repart pas (Amelkis relancée deux fois). */
  const followingUp = new Set<string>();

  async function sendFollowUp(userId: string, leadId: string, mail?: { subject: string; message: string }): Promise<{ followedUpAt: Date } | FollowUpFail> {
    if (followingUp.has(leadId)) return { status: 409, error: "FOLLOW_UP_RUNNING", message: "Cette relance est déjà en cours d'envoi." };
    followingUp.add(leadId);
    try {
      return await sendFollowUpOnce(userId, leadId, mail);
    } finally {
      followingUp.delete(leadId);
    }
  }

  async function sendFollowUpOnce(userId: string, leadId: string, mail?: { subject: string; message: string }): Promise<{ followedUpAt: Date } | FollowUpFail> {
    const ctx = await applicationContext(userId, leadId);
    const sent = ctx?.application;
    if (!ctx || !sent?.sentAt || !sent.sentTo) return { status: 404, error: "NOT_SENT", message: "Cette candidature n'a pas été envoyée par Job Radar." };
    const spId = (await stores.applications.listSent()).find((s) => s.leadId === leadId)?.id;
    const own = (await stores.applicationMails.list()).filter((m) => m.spontaneousId === spId && !m.dismissed);
    // L'entreprise a déjà répondu (même « je fais suivre ») : jamais de relance, même demandée à la main.
    if (own.some((m) => m.kind !== "AWAY")) return { status: 409, error: "ALREADY_ANSWERED", message: "L'entreprise a déjà répondu : pas de relance." };
    if (sent.followedUpAt) {
      // Une seule relance, sauf si elle est tombée pendant une absence (message d'absence reçu après elle).
      const awayAfter = own.some((m) => m.kind === "AWAY" && m.receivedAt.getTime() >= sent.followedUpAt!.getTime());
      if (!awayAfter) return { status: 409, error: "ALREADY_FOLLOWED_UP", message: `Déjà relancée le ${sent.followedUpAt.toLocaleDateString("fr-FR")}.` };
    }
    if (!opts.mailer?.isConfigured()) {
      return { status: 503, error: "MAIL_NOT_CONFIGURED", message: "Envoi d'email non configuré : remplis SMTP_HOST, SMTP_USER et SMTP_PASSWORD dans .env." };
    }
    const kit = ctx.kit ?? EMPTY_LETTER_KIT;
    const cvPdf = await stores.letterKits.cvPdf(userId);
    if (!cvPdf) return { status: 400, error: "CV_PDF_MISSING", message: "CV PDF manquant : envoie-le dans « CV & lettre »." };
    const { subject, message } = mail ?? followUpMail(kit, ctx.lead.name, ctx.title, sent.sentAt);
    try {
      await opts.mailer.send({
        fromName: kit.signature,
        to: sent.sentTo,
        subject,
        text: message,
        inReplyTo: sent.messageId,
        attachments: [
          { filename: safeName(kit.pdfName || DEFAULT_PDF_NAME), content: await renderLetterPdf(sent.letter, `Lettre de motivation - ${ctx.lead.name}`) },
          { filename: cvPdf.name, content: cvPdf.content },
        ],
      });
    } catch (err) {
      app.log.error({ err, leadId }, "relance de candidature spontanée impossible");
      return { status: 502, error: "MAIL_FAILED", message: `L'email n'est pas parti : ${err instanceof Error ? err.message : String(err)}` };
    }
    const now = new Date();
    await stores.applications.markFollowedUp(leadId, now);
    app.log.info({ leadId }, "candidature spontanée relancée");
    return { followedUpAt: now };
  }

  app.post("/api/leads/:id/application/follow-up", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = FollowUpBody.safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY", message: "Objet ou message manquant." });
    const r = await sendFollowUp(request.userId!, params.data.id, body.data);
    if ("error" in r) return reply.code(r.status).send({ error: r.error, message: r.message });
    return { ok: true, followedUpAt: r.followedUpAt };
  });

  /** Spontanées à relancer (followUpDue : 7 jours sans réponse, après le retour d'une absence) ; les plus anciennes d'abord. */
  async function followUpQueue(now = new Date()) {
    const [sent, mails] = await Promise.all([stores.applications.listSent(), stores.applicationMails.list()]);
    return sent
      .filter((s) => !s.noOpeningAt && !s.appliedOnSiteAt && followUpDue(s, mails.filter((m) => m.spontaneousId === s.id), now))
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  }

  /**
   * Relance groupée (bouton « Relancer les 10 plus anciennes ») : en arrière-plan, une à la fois, avec une pause entre
   * deux envois (Gmail se méfie des rafales) ; la page suit l'avancement (GET). S'arrête sur une erreur de configuration.
   */
  type FollowStep = { leadId: string; name: string; status: "waiting" | "sending" | "sent" | "failed"; message: string | null };
  const followBatch = { running: false, total: 0, done: 0, remaining: 0, steps: [] as FollowStep[] };
  const BatchFollowUpBody = z.object({ limit: z.number().int().min(1).max(20).default(10) });

  app.get("/api/applications/follow-up/batch", async () => followBatch);

  app.post("/api/applications/follow-up/batch", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = BatchFollowUpBody.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    if (followBatch.running) return followBatch;
    const userId = request.userId!;
    const queue = (await followUpQueue()).slice(0, body.data.limit);
    const leads = new Map((await stores.leads.list()).map((l) => [l.id, l.name]));
    Object.assign(followBatch, {
      running: queue.length > 0,
      total: queue.length,
      done: 0,
      steps: queue.map((s): FollowStep => ({ leadId: s.leadId, name: leads.get(s.leadId) ?? "?", status: "waiting", message: null })),
    });
    void (async () => {
      try {
        for (const [i, step] of followBatch.steps.entries()) {
          if (i > 0 && opts.followUpPauseMs !== 0) await new Promise((r) => setTimeout(r, opts.followUpPauseMs ?? 4_000));
          step.status = "sending";
          const r = await sendFollowUp(userId, step.leadId);
          step.status = "error" in r ? "failed" : "sent";
          step.message = "error" in r ? r.message : null;
          followBatch.done++;
          if ("error" in r && ["MAIL_NOT_CONFIGURED", "CV_PDF_MISSING"].includes(r.error)) break;
        }
      } finally {
        followBatch.remaining = (await followUpQueue().catch(() => [])).length;
        followBatch.running = false;
      }
    })();
    return followBatch;
  });

  // ───── Préparation en lot : l'IA écrit les lettres des entreprises « À contacter » qui ont un email ; l'envoi reste un clic ─────

  /** Suivi affiché entreprise par entreprise, dans l'ordre d'écriture. */
  type BatchStep = { leadId: string; name: string; status: "waiting" | "writing" | "done" | "failed" | "stopped"; error: string | null };
  const batch = { running: false, total: 0, done: 0, current: null as string | null, error: null as string | null, steps: [] as BatchStep[] };

  /** Entreprises « À contacter », avec email, jamais contactées par Job Radar. */
  async function batchContexts(userId: string) {
    const out = [];
    for (const lead of await stores.leads.list()) {
      if (lead.status !== "TO_CONTACT" || !lead.contactEmail) continue;
      const ctx = await applicationContext(userId, lead.id);
      if (ctx && !ctx.application?.sentAt) out.push(ctx);
    }
    return out;
  }

  app.get("/api/leads/applications/batch", async (request) => {
    const all = await batchContexts(request.userId!);
    const ready = all.filter((c) => c.application?.letter);
    const kit = all[0]?.kit ?? (await stores.letterKits.get(request.userId!));
    const cvPdfName = await stores.letterKits.cvPdfName(request.userId!);
    return {
      batch,
      enabled: !!ai,
      kitReady: letterKitReady(kit),
      mail: { configured: !!opts.mailer?.isConfigured(), from: opts.mailer?.address() ?? null },
      cvPdf: { name: cvPdfName ?? "", found: !!cvPdfName },
      toWrite: all.length - ready.length,
      items: ready.map(applicationReply),
    };
  });

  /** Lance l'écriture des lettres manquantes, une par une, en arrière-plan (une lettre déjà écrite n'est jamais réécrite). */
  app.post("/api/leads/applications/batch", async (request, reply) => {
    if (!ai) return reply.code(503).send({ error: "AI_UNAVAILABLE", message: "IA non configurée." });
    if (batch.running) return { batch };
    const userId = request.userId!;
    const todo = (await batchContexts(userId)).filter((c) => !c.application?.letter);
    if (!todo.length) return { batch };
    if (!todo[0]!.kit || !letterKitReady(todo[0]!.kit)) {
      return reply.code(400).send({ error: "LETTER_KIT_MISSING", message: "Colle d'abord ton CV dans « CV & lettre »." });
    }
    const steps: BatchStep[] = todo.map(({ lead }) => ({ leadId: lead.id, name: lead.name, status: "waiting", error: null }));
    Object.assign(batch, { running: true, total: todo.length, done: 0, current: null, error: null, steps });
    void (async () => {
      try {
        for (const step of steps) {
          batch.current = step.name;
          step.status = "writing";
          const ctx = await applicationContext(userId, step.leadId); // relu : une lettre écrite à la main entre-temps est gardée
          try {
            if (ctx?.kit && !ctx.application?.letter) {
              const { content, model } = await withLock(() => ai.writeLetter(ctx.job, ctx.kit!, { spontaneous: true }));
              await reviewApplication(await stores.applications.save(step.leadId, { inputHash: ctx.inputHash, model, letter: content }), step.leadId, ctx);
            }
            step.status = "done";
            batch.done++;
          } catch (err) {
            const e = errorReply(err);
            step.status = "failed";
            step.error = e.body.message;
            if (e.status === 503) {
              batch.error = e.body.message; // Ollama éteint : inutile de continuer
              for (const s of steps) if (s.status === "waiting") s.status = "stopped";
              break;
            }
            app.log.warn({ leadId: step.leadId, err: e.body.message }, "lettre spontanée (lot) impossible");
          }
        }
      } finally {
        batch.running = false;
        batch.current = null;
      }
      if (batch.done > 0) {
        await opts.onLetterReady?.({
          title: "Candidatures spontanées prêtes",
          body: `${batch.done} lettre(s) écrite(s) : relis-les puis envoie`,
          path: "/entreprises/pretes",
          tag: "letters-batch",
        })?.catch(() => {});
      }
    })();
    return { batch };
  });
}
