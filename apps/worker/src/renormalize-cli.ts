/**
 * Réapplique les règles actuelles (contrat, expérience, compétences, salaire, télétravail) aux offres déjà en base.
 * L'API le fait seule à chaque démarrage ; cette commande sert à voir ce qui changerait, ou à le faire sans la relancer.
 *   pnpm jobs:renormalize          → liste ce qui changerait, et les analyses IA que ça rendrait périmées (n'écrit rien)
 *   pnpm jobs:renormalize --apply  → met à jour les offres
 *   --all                          → aussi les offres archivées (cf. ARCHIVE_DAYS)
 * Avant de pousser une nouvelle règle : la lancer sans --apply dans le bac à sable (scripts/sandbox.sh).
 */
import "./env"; // charge .env
import { createPrismaClient } from "@job-radar/db";
import { ARCHIVE_DAYS, renormalizeJobs } from "@job-radar/pipeline";

const apply = process.argv.includes("--apply");
const archived = process.argv.includes("--all");
const prisma = createPrismaClient();
try {
  const r = await renormalizeJobs({ prisma, apply, archived });
  const detail = Object.entries(r.fields).map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(`${r.checked} offre(s) vérifiée(s)${archived ? "" : ` (sans les archivées : plus vues depuis ${ARCHIVE_DAYS} j)`}, ${r.changed} ${apply ? "mise(s) à jour" : "à mettre à jour"}${detail ? ` (${detail})` : ""}.`);
  console.log(`Analyses IA périmées : ${r.aiStale}, dont au plus ${r.aiAuto} refaite(s) automatiquement (offres du flux encore en ligne, appels payants ; 30 par collecte).`);
  if (!apply && r.changed) console.log("Rien n'a été écrit. Pour appliquer : pnpm jobs:renormalize --apply");
} finally {
  await prisma.$disconnect();
}
