/**
 * Collecte manuelle : lance toutes les recherches du profil et enregistre les offres en base.
 *   pnpm collect            → offres des 7 derniers jours
 *   pnpm collect --days=31  → offres des 31 derniers jours (première collecte)
 */
import { createPrismaClient } from "@job-radar/db";
import { collectOnce, prismaJoobleQuota } from "@job-radar/pipeline";
import { parseProfile } from "@job-radar/shared";
import { type AtsKind, CompanyCareersSource } from "@job-radar/source-connectors";
import { adzunaFromEnv, franceTravailFromEnv, jobScraperFromEnv, joobleFromEnv } from "./env";

const ALLOWED_DAYS = [1, 3, 7, 14, 31] as const;
const arg = process.argv.find((a) => a.startsWith("--days="));
const days = Number(arg?.split("=")[1] ?? 7) as (typeof ALLOWED_DAYS)[number];
if (!ALLOWED_DAYS.includes(days)) {
  console.error(`--days doit valoir ${ALLOWED_DAYS.join(", ")}`);
  process.exit(1);
}

const prisma = createPrismaClient();
try {
  const row = await prisma.profile.findFirst();
  if (!row) throw new Error("Aucun profil en base : lance d'abord « pnpm db:seed »");
  const profile = parseProfile(row.data);
  const enabled = new Set((await prisma.sourceState.findMany({ where: { enabled: true } })).map((s) => s.source));

  console.log(`Collecte des offres publiées depuis ${days} jour(s) — ${profile.searches.length} recherche(s) × ${profile.locations.length} zone(s)`);
  const t0 = Date.now();
  const r = await collectOnce({
    prisma,
    profile,
    // Uniquement les sources actives (page Sources).
    sources: [
      franceTravailFromEnv(),
      adzunaFromEnv(),
      joobleFromEnv(prismaJoobleQuota(prisma, process.env.JOOBLE_API_KEY)),
      new CompanyCareersSource({
        companies: async () => (await prisma.companyTarget.findMany()).map((c) => ({ ...c, ats: c.ats as AtsKind })),
      }),
      ...jobScraperFromEnv(),
    ].filter((s) => enabled.has(s.name)),
    trigger: "cli",
    publishedSinceDays: days,
    log: (line) => console.log(line),
  });

  console.log(`\nRésultat (${((Date.now() - t0) / 1000).toFixed(1)} s) : ${r.status}`);
  console.log(`  offres reçues     : ${r.fetched}`);
  console.log(`  nouvelles         : ${r.created}`);
  console.log(`  mises à jour      : ${r.updated}`);
  console.log(`  déjà connues      : ${r.unchanged}`);
  console.log(`  doublons fusionnés: ${r.duplicates}`);
  if (r.rejected) console.log(`  illisibles        : ${r.rejected}`);
  for (const s of r.sources) {
    console.log(`  source ${s.source} : ${s.status}${s.errors.length ? ` (${s.errors.length} erreur(s))` : ""}`);
    for (const e of s.errors.slice(0, 3)) console.log(`    - ${e}`);
  }
  if (r.status === "failed") process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
