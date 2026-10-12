/**
 * Test de la clé Jooble : UN seul appel réel (compté dans les 500 appels à vie de la clé gratuite).
 *   pnpm jooble:test
 */
import { createPrismaClient } from "@job-radar/db";
import { prismaJoobleQuota } from "@job-radar/pipeline";
import { JOOBLE_DEFAULTS } from "@job-radar/source-connectors";
import { joobleFromEnv } from "./env";

const prisma = createPrismaClient();
try {
  const quota = prismaJoobleQuota(prisma, process.env.JOOBLE_API_KEY);
  const jooble = joobleFromEnv(quota);
  const health = await jooble.healthCheck();
  if (health.status !== "OK") {
    console.log(`Jooble : ${health.status === "SOURCE_UNAVAILABLE" ? "non configurée" : "ERREUR"} — ${health.message}`);
    process.exitCode = 1;
  } else {
    const r = await jooble.testCall("Développeur", "60");
    console.log(`Jooble : OK — ${r.count} offre(s) reçue(s) pour « Développeur » dans l'Oise`);
    if (r.sample) console.log(`  exemple : ${r.sample.title} — ${r.sample.company ?? "?"} — ${r.sample.location ?? "?"}`);
    const { used } = await quota.get();
    console.log(`  appels utilisés : ${used} / ${JOOBLE_DEFAULTS.lifetimeLimit} (arrêt automatique à ${JOOBLE_DEFAULTS.stopAt})`);
  }
} catch (err) {
  console.log(`Jooble : ERREUR — ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
