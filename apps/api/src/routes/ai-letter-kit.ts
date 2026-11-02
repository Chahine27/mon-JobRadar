import { EMPTY_LETTER_KIT, LetterKitSchema, letterKitReady } from "@job-radar/shared";
import { z } from "zod";
import { requireAuth } from "../auth";
import { safeName } from "../letter-pdf";
import type { AiDeps } from "./ai-shared";
import { issuesOf } from "./http";

/** Trousseau de lettres (CV, blocs, règles) et CV en PDF. */
export function registerLetterKitRoutes(deps: AiDeps) {
  const { app, stores } = deps;
  // ───────────── Trousseau : CV, blocs et règles des lettres ─────────────

  app.get("/api/letter-kit", async (request) => {
    const kit = (await stores.letterKits.get(request.userId!)) ?? EMPTY_LETTER_KIT;
    return { kit, ready: letterKitReady(kit), cvPdfName: await stores.letterKits.cvPdfName(request.userId!) };
  });

  // CV PDF joint aux candidatures spontanées : envoyé tel quel par le navigateur (le serveur ne voit pas les fichiers du PC).
  app.addContentTypeParser("application/pdf", { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 }, (_request, body, done) => done(null, body));
  // onRequest : la session est vérifiée avant de lire jusqu'à 5 Mo.
  app.put("/api/letter-kit/cv-pdf", { onRequest: requireAuth }, async (request, reply) => {
    const q = z.object({ name: z.string().trim().min(1).max(120) }).safeParse(request.query);
    const body = request.body;
    if (!q.success || !Buffer.isBuffer(body) || body.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return reply.code(400).send({ error: "INVALID_PDF", message: "Ce fichier n'est pas un PDF." });
    }
    const name = safeName(q.data.name.split(/[\\/]/).pop()!);
    await stores.letterKits.setCvPdf(request.userId!, { name, content: body });
    return { cvPdfName: name };
  });
  app.get("/api/letter-kit/cv-pdf", async (request, reply) => {
    const file = await stores.letterKits.cvPdf(request.userId!);
    if (!file) return reply.code(404).send({ error: "NO_CV_PDF" });
    return reply.type("application/pdf").header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`).send(file.content);
  });
  app.delete("/api/letter-kit/cv-pdf", async (request) => {
    await stores.letterKits.setCvPdf(request.userId!, null);
    return { cvPdfName: null };
  });

  app.put("/api/letter-kit", async (request, reply) => {
    const body = LetterKitSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "INVALID_LETTER_KIT",
        issues: issuesOf(body.error),
      });
    }
    const kit = await stores.letterKits.save(request.userId!, body.data);
    return { kit, ready: letterKitReady(kit) };
  });
}
