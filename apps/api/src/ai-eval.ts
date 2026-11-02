/**
 * « pnpm ai:eval [--detail] [--model=claude] » : l'avis de l'IA est-il d'accord avec tes décisions ? Aucun appel IA.
 * Intéressé = offre sauvegardée, postulée ou refusée après candidature ; pas intéressé = offre ignorée.
 * Mesure clé : sur une paire (intéressé, ignoré) au hasard, la part où l'intéressé a la meilleure note
 * (50 % = pas mieux qu'un tirage à pile ou face, 100 % = parfait). Comparée à la note par mots-clés.
 * Limite : une offre peut être ignorée pour le lieu ou le salaire, que la note de l'IA ne regarde pas.
 * --detail : les désaccords (ignorée mais « forte », intéressé mais « faible »), avec l'avis de l'IA.
 */
import { createPrismaClient } from "@job-radar/db";
import { DEFAULT_RULES, scoreJob, scoringInputFromJob } from "@job-radar/scoring";
import { readVerdict } from "./ai-context";
import { loadEnv } from "./env";
import { createPrismaStores } from "./prisma-stores";

const detail = process.argv.includes("--detail");
const model = process.argv.find((a) => a.startsWith("--model="))?.slice(8) ?? "";
const WANTED = new Set(["SAVED", "APPLIED", "REJECTED"]);
const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const stores = createPrismaStores(prisma);
try {
  const user = await prisma.user.findFirst({ select: { id: true } });
  const rec = user && (await stores.profiles.get(user.id));
  if (!rec) throw new Error("Profil introuvable");
  const analyses = await stores.analyses.latestAll();
  const rows: { title: string; company: string | null; wanted: boolean; ad: string; note: number | null; keywords: number; avis: string }[] = [];
  for (const job of await stores.jobs.list()) {
    const a = analyses.get(job.id);
    const v = a && readVerdict(a.result);
    if (!v || !a.model.startsWith(model)) continue;
    if (!WANTED.has(job.status) && job.status !== "IGNORED") continue;
    const s = scoreJob(scoringInputFromJob(job), rec.profile, DEFAULT_RULES);
    rows.push({ title: job.title, company: job.company, wanted: WANTED.has(job.status), ad: v.adequation, note: v.note ?? null, keywords: s.final, avis: v.avis });
  }
  const yes = rows.filter((r) => r.wanted);
  const no = rows.filter((r) => !r.wanted);
  console.log(`${rows.length} offres jugées par l'IA${model ? ` (${model})` : ""} et triées par toi : ${yes.length} intéressé, ${no.length} ignorées\n`);

  console.log("adéquation IA | intéressé | ignorées");
  for (const ad of ["forte", "moyenne", "faible"]) {
    console.log(`${ad.padEnd(13)} | ${String(yes.filter((r) => r.ad === ad).length).padStart(9)} | ${String(no.filter((r) => r.ad === ad).length).padStart(8)}`);
  }

  // ponytail: comparaison de toutes les paires (n²), assez rapide pour quelques milliers d'offres.
  const pairs = (score: (r: (typeof rows)[number]) => number | null) => {
    const y = yes.map(score).filter((x): x is number => x !== null);
    const n = no.map(score).filter((x): x is number => x !== null);
    if (!y.length || !n.length) return "pas assez d'offres";
    let won = 0;
    for (const a of y) for (const b of n) won += a > b ? 1 : a === b ? 0.5 : 0;
    return `${Math.round((100 * won) / (y.length * n.length))} % (sur ${y.length} × ${n.length})`;
  };
  console.log(`\nL'offre intéressante a la meilleure note (50 % = hasard) :`);
  console.log(`- note de l'IA      : ${pairs((r) => r.note)}`);
  console.log(`- note mots-clés    : ${pairs((r) => r.keywords)}`);
  console.log(`- adéquation seule  : ${pairs((r) => ({ forte: 2, moyenne: 1, faible: 0 })[r.ad] ?? null)}`);

  if (detail) {
    const show = (r: (typeof rows)[number]) => console.log(`- ${r.note ?? "?"} ${r.title} (${r.company ?? "?"})\n    IA : ${r.avis.slice(0, 220)}`);
    console.log(`\nIgnorées alors que l'IA dit « forte » :`);
    no.filter((r) => r.ad === "forte").forEach(show);
    console.log(`\nIntéressé alors que l'IA dit « faible » :`);
    yes.filter((r) => r.ad === "faible").forEach(show);
  }
} finally {
  await prisma.$disconnect();
}
