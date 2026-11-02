import { LETTER_PROMPT_VERSION, offerWantsAiCoding, checkLetter, letterHash, reviewBlock, type LetterOptions } from "@job-radar/ai";
import { createHash } from "node:crypto";
import { letterKitReady, type LetterKit } from "@job-radar/shared";
import { isAbridged, toJobInput } from "../ai-context";
import { DEFAULT_PDF_NAME, renderLetterPdf, safeName } from "../letter-pdf";
import type { JobRow, StoredLetter } from "../stores";
import { type AiDeps, LetterBody, IdParams, errorReply, NOT_SAVED, reviewPending, writingKit } from "./ai-shared";

/** Lettre de motivation d'une offre : écriture, PDF, retouche, relecture. */
export function registerJobLetterRoutes(deps: AiDeps) {
  const { app, opts, stores, ai, withLock, notifyLetter, runReview } = deps;
  async function letterContext(userId: string, jobId: string) {
    const [job, kit, analysis] = await Promise.all([stores.jobs.get(jobId), stores.letterKits.get(userId), stores.analyses.latest(jobId)]);
    if (!job) return null;
    // Job Radar (projet perso fait avec des agents IA) n'est cité que si l'offre parle de développer avec l'IA.
    const opts: LetterOptions = { aiCoding: offerWantsAiCoding(analysis?.result, `${job.title}\n${job.description}`) };
    const inputHash = kit
      ? createHash("sha256")
          .update(JSON.stringify([job.contentHash, writingKit(kit), ai?.model ?? "", LETTER_PROMPT_VERSION, opts.aiCoding]))
          .digest("hex")
          .slice(0, 32)
      : "";
    const jobText = [job.title, job.company ?? "", job.description].join("\n");
    return { job, kit, inputHash, jobText, abridged: isAbridged(job), opts };
  }

  function letterReply(letter: StoredLetter | null, ctx: { job: JobRow; kit: LetterKit | null; inputHash: string; jobText: string; abridged: boolean; opts: LetterOptions }) {
    const warnings = letter && ctx.kit ? checkLetter(letter.content, ctx.kit, ctx.jobText, ctx.job.title, ctx.opts) : [];
    if (letter && ctx.abridged) {
      warnings.unshift("L'annonce n'est qu'un extrait : colle l'annonce complète (bouton « Compléter l'annonce ») puis réécris la lettre, elle sera plus précise.");
    }
    return {
      letter,
      upToDate: !!letter && letter.inputHash === ctx.inputHash,
      kitReady: letterKitReady(ctx.kit),
      warnings,
      /** raison du blocage du PDF (null = la lettre peut partir) */
      blocked: letter ? reviewBlock(letter.review, letter.content) : null,
    };
  }

  /** Relit la lettre enregistrée d'une offre et garde le résultat. */
  async function reviewJobLetter(letter: StoredLetter, jobId: string, ctx: { job: JobRow; kit: LetterKit | null; opts?: LetterOptions }): Promise<StoredLetter> {
    // Nom de l'entreprise compris : sinon « emagine » (minuscule) passe pour une faute de frappe.
    const jobText = `${ctx.job.company ?? ""}\n${ctx.job.description}`;
    const review = await runReview(letter.content, { cvText: ctx.kit?.cvText ?? "", jobText, jobTitle: ctx.job.title, ...(ctx.kit ? { facts: ctx.kit } : {}), aiCoding: ctx.opts?.aiCoding });
    await stores.letters.setReview(jobId, review);
    return { ...letter, review };
  }

  app.get("/api/jobs/:id/letter", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const ctx = await letterContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    return letterReply(await stores.letters.get(params.data.id), ctx);
  });

  app.post("/api/jobs/:id/letter", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    if (!ai) return reply.code(503).send({ error: "AI_UNAVAILABLE", message: "IA non configurée." });
    const ctx = await letterContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    if (!ctx.kit || !letterKitReady(ctx.kit)) {
      return reply.code(400).send({ error: "LETTER_KIT_MISSING", message: "Colle d'abord ton CV dans « CV & lettre »." });
    }

    const existing = await stores.letters.get(params.data.id);
    const force = (request.query as { force?: string }).force === "true";
    if (existing && existing.inputHash === ctx.inputHash && !force) return { ...letterReply(existing, ctx), cached: true };

    try {
      const { content, model, durationMs } = await withLock(() => ai.writeLetter(toJobInput(ctx.job), ctx.kit!, ctx.opts));
      const saved = await reviewJobLetter(await stores.letters.save(params.data.id, { inputHash: ctx.inputHash, model, content }), params.data.id, ctx);
      request.log.info({ jobId: params.data.id, durationMs, model, problems: saved.review?.problems.length }, "lettre IA écrite et relue");
      notifyLetter(reply, request.userId!, {
        title: "Lettre de motivation terminée",
        body: `${ctx.job.title}${ctx.job.company ? ` — ${ctx.job.company}` : ""}`,
        path: `/offres/${encodeURIComponent(params.data.id)}`,
        tag: `letter-${params.data.id}`,
      });
      return { ...letterReply(saved, ctx), cached: false, durationMs };
    } catch (err) {
      const e = errorReply(err);
      return reply.code(e.status).send(e.body);
    }
  });

  /** La lettre (le texte affiché, même non enregistré) en PDF, téléchargée par le navigateur. */
  app.post("/api/jobs/:id/letter/pdf", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const body = LetterBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_LETTER" });
    const ctx = await letterContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const saved = await stores.letters.get(params.data.id);
    const blocked = saved ? reviewBlock(saved.review, body.data.content) : NOT_SAVED;
    if (blocked) return reviewPending(reply, blocked);
    const pdf = await renderLetterPdf(body.data.content, `Lettre de motivation - ${ctx.job.company ?? ctx.job.title}`);
    const name = safeName(ctx.kit?.pdfName || DEFAULT_PDF_NAME);
    return reply.type("application/pdf").header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`).send(pdf);
  });

  app.put("/api/jobs/:id/letter", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const body = LetterBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_LETTER" });
    const ctx = await letterContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const edited = await stores.letters.edit(params.data.id, body.data.content);
    if (!edited) return reply.code(404).send({ error: "LETTER_NOT_FOUND" });
    return letterReply(await reviewJobLetter(edited, params.data.id, ctx), ctx);
  });

  /** Relance la relecture (relecteur injoignable la première fois, ou lettre écrite avant la relecture automatique). */
  app.post("/api/jobs/:id/letter/review", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const ctx = await letterContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const letter = await stores.letters.get(params.data.id);
    if (!letter) return reply.code(404).send({ error: "LETTER_NOT_FOUND" });
    return letterReply(await reviewJobLetter(letter, params.data.id, ctx), ctx);
  });

  /** « J'ai lu, j'envoie quand même » : valable pour ce texte-là seulement (une retouche relance la relecture). */
  app.post("/api/jobs/:id/letter/review/validate", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const ctx = await letterContext(request.userId!, params.data.id);
    if (!ctx) return reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const letter = await stores.letters.get(params.data.id);
    if (!letter?.review || letter.review.hash !== letterHash(letter.content)) return reviewPending(reply, NOT_SAVED);
    const review = { ...letter.review, validated: true };
    await stores.letters.setReview(params.data.id, review);
    return letterReply({ ...letter, review }, ctx);
  });
}
