/**
 * Test de connexion des sources à clé (France Travail, Adzuna) — n'écrit RIEN en base.
 *   pnpm sources:test
 */
import { adzunaFromEnv, franceTravailFromEnv } from "./env";

for (const source of [franceTravailFromEnv(), adzunaFromEnv()]) {
  process.stdout.write(`${source.name} : `);
  const health = await source.healthCheck();
  if (health.status !== "OK") {
    console.log(`${health.status === "SOURCE_UNAVAILABLE" ? "non configurée" : "ERREUR"} — ${health.message}`);
    continue;
  }
  const raws = await source.search({ keywords: "Développeur", department: "60", publishedSinceDays: 31, maxResults: 5 });
  console.log(`OK — ${raws.length} offre(s) de test reçue(s)`);
}
