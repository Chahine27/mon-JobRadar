/**
 * Tests d'intégration : prépare une base SÉPARÉE « jobradar_test » (ta vraie base n'est jamais touchée),
 * puis y applique les migrations. Nécessite la base lancée (Job Radar démarré, ou pnpm db:server).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

export function testDatabaseUrl(): string {
  config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant dans .env");
  const u = new URL(url);
  u.pathname = "/jobradar_test";
  return u.toString();
}

export default async function setup() {
  const testUrl = testDatabaseUrl();
  const admin = new URL(testUrl);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`Base de données injoignable : lance Job Radar ou « pnpm db:server ». (${String(err)})`);
  }
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'jobradar_test'");
  if (exists.rowCount === 0) await client.query("CREATE DATABASE jobradar_test");
  await client.end();

  const res = spawnSync("pnpm exec prisma migrate deploy", {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "inherit",
    shell: true,
  });
  if (res.status !== 0) throw new Error("Migrations de la base de test en échec");
}
