import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  checkCredentials,
  newSessionToken,
  requireAuth,
  sessionIdFromToken,
} from "../auth";
import type { Stores } from "../stores";

const LoginBody = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(512),
});

export async function authRoutes(app: FastifyInstance, opts: { stores: Stores; secureCookie: boolean }) {
  const { stores, secureCookie } = opts;

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = LoginBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });

      const user = await checkCredentials(stores.users, body.data.email, body.data.password);
      // Même réponse que l'email existe ou non.
      if (!user) return reply.code(401).send({ error: "INVALID_CREDENTIALS" });

      const token = newSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await stores.sessions.create({ id: sessionIdFromToken(token), userId: user.id, expiresAt });

      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: secureCookie,
        path: "/",
        expires: expiresAt,
      });
      return { user: { email: user.email } };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await stores.sessions.delete(sessionIdFromToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await stores.users.findById(request.userId!);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    return { user: { email: user.email } };
  });
}
