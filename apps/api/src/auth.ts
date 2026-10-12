import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SessionStore, UserStore } from "./stores";

export const SESSION_COOKIE = "jr_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

/** Jeton envoyé au navigateur (jamais stocké tel quel). */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Ce qui est stocké en base : l'empreinte du jeton. Une fuite de la base ne donne pas de session valide. */
export function sessionIdFromToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Hash factice pour que « email inconnu » prenne le même temps que « mauvais mot de passe ».
let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  dummyHash ??= hash("mot-de-passe-factice-pour-timing");
  return dummyHash;
}

export async function checkCredentials(
  users: UserStore,
  email: string,
  password: string,
): Promise<{ id: string; email: string } | null> {
  const user = await users.findByEmail(email.trim().toLowerCase());
  if (!user) {
    await verify(await getDummyHash(), password).catch(() => false);
    return null;
  }
  const ok = await verify(user.passwordHash, password).catch(() => false);
  return ok ? { id: user.id, email: user.email } : null;
}

export async function resolveSession(
  sessions: SessionStore,
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null;
  const id = sessionIdFromToken(token);
  const session = await sessions.find(id);
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await sessions.delete(id);
    return null;
  }
  return session.userId;
}

declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
  }
}

/** À mettre en preHandler sur les routes privées. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.userId) {
    return reply.code(401).send({ error: "UNAUTHENTICATED" });
  }
}
