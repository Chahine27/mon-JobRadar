import { createPrismaClient } from "../src/client";
import { testDatabaseUrl } from "./global-setup";

export function testPrisma() {
  return createPrismaClient(testDatabaseUrl());
}

/** Vide toutes les tables entre deux tests. */
export async function resetDatabase(prisma: ReturnType<typeof testPrisma>) {
  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}
