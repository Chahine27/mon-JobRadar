import { createHash } from "node:crypto";
import type { PrismaClient } from "@job-radar/db";
import type { JoobleQuotaStore } from "@job-radar/source-connectors";

/** Identifiant du compteur : source + empreinte de la clé (la clé elle-même n'est jamais écrite en base). */
export function quotaId(source: string, apiKey: string | undefined): string {
  const hash = createHash("sha256").update(apiKey?.trim() ?? "").digest("hex").slice(0, 16);
  return `${source}:${hash}`;
}

/** Compteur d'appels Jooble gardé en base (table ApiQuota). */
export function prismaJoobleQuota(prisma: PrismaClient, apiKey: string | undefined): JoobleQuotaStore {
  const id = quotaId("jooble", apiKey);
  return {
    async get() {
      const row = await prisma.apiQuota.findUnique({ where: { id } });
      return { used: row?.used ?? 0, lastCallAt: row?.lastCallAt ?? null };
    },
    async record(calls, at) {
      await prisma.apiQuota.upsert({
        where: { id },
        create: { id, used: calls, lastCallAt: at },
        update: { used: { increment: calls }, ...(at ? { lastCallAt: at } : {}) },
      });
    },
  };
}
