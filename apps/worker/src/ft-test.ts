/**
 * Test de connexion France Travail — n'écrit RIEN en base.
 *   pnpm ft:test
 */
import { normalize } from "@job-radar/job-normalizer";
import { franceTravailFromEnv } from "./env";

const source = franceTravailFromEnv();

console.log("1) Authentification auprès de France Travail…");
const health = await source.healthCheck();
if (health.status !== "OK") {
  console.error(`   ✗ ${health.status} : ${health.message}`);
  process.exit(1);
}
console.log("   ✔ Jeton obtenu");

console.log("2) Recherche test : « Développeur » dans l'Oise (60), 31 derniers jours…");
const raws = await source.search({ keywords: "Développeur", department: "60", publishedSinceDays: 31, maxResults: 10 });
console.log(`   ✔ ${raws.length} offre(s) reçue(s)\n`);

for (const raw of raws.slice(0, 10)) {
  const job = normalize(raw);
  if (!job) continue;
  const salary = job.salaryMin ? `${Math.round(job.salaryMin / 1000)}–${Math.round((job.salaryMax ?? job.salaryMin) / 1000)}k` : "salaire ?";
  console.log(`   • ${job.title}`);
  console.log(`     ${job.company ?? "entreprise non affichée"} — ${job.city ?? "?"} (${job.department ?? "?"}) — ${job.contractType ?? "?"} — ${salary}`);
  if (job.technologies.length) console.log(`     ${job.technologies.join(", ")}`);
}
console.log("\n✔ Connexion France Travail OK. Rien n'a été enregistré.");
