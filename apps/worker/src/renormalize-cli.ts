/**
 * Réapplique les règles actuelles (contrat, expérience, compétences, salaire, télétravail) aux offres déjà en base.
 * L'API le fait seule à chaque démarrage ; cette commande sert à voir ce qui changerait, ou à le faire sans la relancer.
 *   pnpm jobs:renormalize          → liste ce qui changerait (n'écrit rien)
 *   pnpm jobs:renormalize --apply  → met à jour les offres
 */
import "./env"; // charge .env
import { createPrismaClient } from "@job-radar/db";
import { renormalizeJobs } from "@job-radar/pipeline";

const apply = process.argv.includes("--apply");
const prisma = createPrismaClient();
try {
  const r = await renormalizeJobs({ prisma, apply });
  const detail = Object.entries(r.fields).map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(`${r.checked} offre(s) vérifiée(s), ${r.changed} ${apply ? "mise(s) à jour" : "à mettre à jour"}${detail ? ` (${detail})` : ""}.`);
  if (!apply && r.changed) console.log("Rien n'a été écrit. Pour appliquer : pnpm jobs:renormalize --apply");
} finally {
  await prisma.$disconnect();
}
