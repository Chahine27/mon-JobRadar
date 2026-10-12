/**
 * Test de l'IA locale (Ollama) sur une offre d'exemple — n'écrit RIEN en base.
 *   pnpm ai:test
 */
import { OllamaClient, analyzeJobWithAi } from "@job-radar/ai";
import "./env";

const ollama = new OllamaClient({ baseUrl: process.env.OLLAMA_URL, model: process.env.OLLAMA_MODEL });
const status = await ollama.status();
if (!status.available || !status.installed) {
  console.log(`IA : ${"message" in status ? status.message : "indisponible"}`);
  process.exitCode = 1;
} else {
  console.log(`IA : modèle ${ollama.model} prêt. Analyse d'une offre d'exemple…`);
  try {
    const { result, durationMs } = await analyzeJobWithAi(
      ollama,
      {
        title: "Développeur Java Full Stack (H/F)",
        company: "Open",
        city: "Levallois-Perret",
        department: "92",
        contractType: "CDI",
        remoteType: "hybrid",
        salaryMin: null,
        salaryMax: null,
        description: `Sur les marchés Parisiens nous sommes incontournables sur le secteur Banque, Finance et Assurance.
Nous travaillons en direct chez nos clients Grands Comptes, dans leurs locaux, au sein de notre centre de services, ou en télétravail.
Dans le cadre de l'acquisition de nouveaux marchés, nous recherchons des Concepteurs Développeurs Java Fullstack (Java / Angular ou Java/React).
Missions : développer des outils d'aide à la décision pour le Front Office, développement d'automates de trading, application des standards (Clean code, TDD, BDD), méthodologie Agile Scrum.
Vous avez minimum 5 ans sur du développement Java en backend et Angular ou React en front end. La pratique de l'anglais est demandée.
Kubernetes et Docker souhaitables.`,
      },
      { skills: ["Vue.js", "TypeScript", "JavaScript", "Node.js", "PostgreSQL"], experienceMin: 0, experienceMax: 3, contracts: ["CDI"], locations: ["Oise (60)", "Paris (75)"] },
    );
    console.log(JSON.stringify(result, null, 2));
    console.log(`\nDurée : ${(durationMs / 1000).toFixed(1)} s`);
  } catch (err) {
    console.log(`ERREUR : ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
