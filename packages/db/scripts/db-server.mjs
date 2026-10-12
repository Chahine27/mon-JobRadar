// Base de données de Job Radar, sans Docker : un vrai PostgreSQL lancé par Node (paquet « embedded-postgres »),
// invisible, sans compte, avec ses fichiers dans <projet>/data/postgres. Lancé en arrière-plan par le lanceur.
// Réglages lus dans DATABASE_URL (.env) : utilisateur, mot de passe, port, nom de la base.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import EmbeddedPostgres from "embedded-postgres";

const root = path.resolve(import.meta.dirname, "../../..");
config({ path: path.join(root, ".env"), quiet: true });

const url = new URL(process.env.DATABASE_URL ?? "");
if (!url.port || !url.username) throw new Error("DATABASE_URL manquant ou incomplet dans .env");
const dataDir = path.join(root, "data", "postgres");
const logFile = path.join(root, "data", "postgres.log");
mkdirSync(path.dirname(dataDir), { recursive: true });
const log = (m) => appendFileSync(logFile, `${new Date().toISOString()} ${String(m instanceof Error ? m.stack : m).trim()}\n`);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port),
  persistent: true,
  authMethod: "scram-sha-256",
  // Accents et émojis des annonces : base en UTF-8 quelle que soit la langue de Windows.
  initdbFlags: ["--encoding=UTF8"],
  // Seulement depuis ce PC, par le réseau local (pas de fichier « socket » qui pourrait rester bloqué après un arrêt brutal).
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories="],
  onLog: log,
  onError: log,
});

const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) {
  log("Première fois : création de la base");
  await pg.initialise();
}
await pg.start();
if (fresh) await pg.createDatabase(url.pathname.slice(1) || "jobradar");
log(`Base prête sur 127.0.0.1:${url.port}`);
console.log(`Base de données prête (port ${url.port}).`);

// Reste allumé tant que ce processus vit ; arrêt propre sur Ctrl + C.
const stop = async () => {
  await pg.stop().catch(() => {});
  process.exitCode = 0;
  setTimeout(() => process.exit(), 200);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
