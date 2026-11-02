import { letterHash, type LetterReview } from "@job-radar/ai";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import type { AiDeps, AiRouteOptions, ReviewContext } from "./ai-shared";
import { registerAnalysisRoutes } from "./ai-analysis";
import { registerLetterKitRoutes } from "./ai-letter-kit";
import { registerJobLetterRoutes } from "./ai-job-letters";
import { registerApplicationRoutes } from "./ai-applications";
export type { AiService, AutoFeed } from "./ai-shared";

export async function aiRoutes(app: FastifyInstance, opts: AiRouteOptions) {
  const { stores, ai } = opts;
  app.addHook("preHandler", requireAuth);

  /**
   * Pages ouvertes et visibles : le navigateur le signale toutes les 10 s (POST /api/presence).
   * Une lettre terminée sur la page où tu es déjà n'envoie pas de notification.
   */
  const watching = new Map<string, number>();
  const WATCH_TTL_MS = 25_000;
  const watchKey = (userId: string, path: string) => `${userId}|${decodeURIComponent(path)}`;
  // Envoyée une fois la réponse partie : la page affiche déjà la lettre quand la notification arrive.
  function notifyLetter(reply: FastifyReply, userId: string, n: { title: string; body: string; path: string; tag: string }) {
    reply.raw.once("finish", () => {
      if (Date.now() - (watching.get(watchKey(userId, n.path)) ?? 0) < WATCH_TTL_MS) return;
      void opts.onLetterReady?.(n)?.catch(() => {});
    });
  }

  app.post("/api/presence", async (request, reply) => {
    const body = z.object({ path: z.string().min(1).max(300) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    try {
      watching.set(watchKey(request.userId!, body.data.path), Date.now());
    } catch {
      return reply.code(400).send({ error: "INVALID_BODY" });
    }
    return reply.code(204).send();
  });

  /**
   * La carte graphique fait une chose à la fois : chaque appel à l'IA passe par cette file.
   * Une demande faite à la main attend au plus la fin de l'analyse automatique en cours.
   */
  let chain: Promise<unknown> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  }

  /** Relecture automatique d'une lettre (jamais d'erreur : un relecteur absent est noté, la lettre sera à valider). */
  async function runReview(text: string, ctx: ReviewContext): Promise<LetterReview> {
    if (ai?.reviewLetter) return ai.reviewLetter(text, ctx);
    return { hash: letterHash(text), problems: [], errors: ["Relecture automatique non configurée."], validated: false, at: new Date().toISOString() };
  }

  const deps: AiDeps = { app, opts, stores, ai, withLock, notifyLetter, runReview };
  registerAnalysisRoutes(deps);
  registerLetterKitRoutes(deps);
  registerJobLetterRoutes(deps);
  registerApplicationRoutes(deps);
}
