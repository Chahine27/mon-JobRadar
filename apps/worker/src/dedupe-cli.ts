/**
 * Doublons déjà en base : la même offre vue par plusieurs sources avec un titre ou un lieu écrit autrement.
 *   pnpm jobs:dedupe          → liste ce qui serait fusionné (ne supprime rien)
 *   pnpm jobs:dedupe --apply  → fusionne : l'offre où tu as agi est gardée, sources et mails rapatriés
 */
import "./env"; // charge .env
import { createPrismaClient } from "@job-radar/db";
import { dedupeJobs } from "@job-radar/pipeline";

const apply = process.argv.includes("--apply");
const prisma = createPrismaClient();
try {
  const r = await dedupeJobs(prisma, { apply });
  const dups = r.groups.reduce((n, g) => n + g.drop.length, 0);
  console.log(`${r.jobs} offres en base, ${r.groups.length} groupe(s) de doublons (${dups} offre(s) en trop).`);
  const titles = new Map((await prisma.job.findMany({ where: { id: { in: r.groups.flatMap((g) => [g.keep, ...g.drop]) } }, select: { id: true, title: true, city: true, status: true, sources: { select: { source: true } } } })).map((j) => [j.id, j]));
  for (const g of r.groups.slice(0, 60)) {
    console.log(`\n${g.company} — ${g.title}`);
    for (const id of [g.keep, ...g.drop]) {
      const j = titles.get(id);
      console.log(`  ${id === g.keep ? "garde  " : "fusion "} [${j?.status ?? "fusionnée"}] ${j?.title ?? "(déjà fusionnée)"} — ${j?.city ?? "?"} ${j ? `(${j.sources.map((s) => s.source).join(", ")})` : ""}`);
    }
  }
  console.log(apply ? `\n${r.merged} offre(s) fusionnée(s).` : "\nRien n'a été supprimé. Pour fusionner : pnpm jobs:dedupe --apply");
} finally {
  await prisma.$disconnect();
}
