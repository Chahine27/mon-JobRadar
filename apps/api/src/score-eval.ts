/**
 * « pnpm score:eval [--detail] » : mesure le score des règles (celui qui décide si l'IA relit une offre)
 * face aux avis déjà donnés par l'IA. Pour chaque seuil : offres envoyées à l'IA par adéquation,
 * et ce qu'on perdrait (offres « forte » sous le seuil). Ne modifie rien.
 * --detail : les offres « faible » qui passent le seuil, avec leurs points de vigilance (pistes de règles).
 */
import { createPrismaClient } from "@job-radar/db";
import { DEFAULT_RULES, scoreJob, scoringInputFromJob } from "@job-radar/scoring";
import { isAbridged, readVerdict } from "./ai-context";
import { loadEnv } from "./env";
import { distanceKm } from "./routes/leads";
import { createPrismaStores } from "./prisma-stores";

const detail = process.argv.includes("--detail");
const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const stores = createPrismaStores(prisma);
try {
  const user = await prisma.user.findFirst({ select: { id: true } });
  const rec = user && (await stores.profiles.get(user.id));
  if (!rec) throw new Error("Profil introuvable");
  const { profile, home } = rec;
  const analyses = await stores.analyses.latestAll();
  const rows: { title: string; ad: "forte" | "moyenne" | "faible"; final: number; hidden: boolean; warnings: string[]; cap: string | null }[] = [];
  for (const job of await stores.jobs.list()) {
    const a = analyses.get(job.id);
    const v = a && readVerdict(a.result);
    if (!v || isAbridged(job)) continue;
    const km = home && job.latitude !== null && job.longitude !== null ? distanceKm(home, { lat: job.latitude, lng: job.longitude }) : null;
    const s = scoreJob({ ...scoringInputFromJob(job), distanceKm: km }, profile, DEFAULT_RULES);
    rows.push({ title: job.title, ad: v.adequation, final: s.final, hidden: s.hidden, warnings: s.warnings, cap: s.capLabel });
  }
  const count = (f: (r: (typeof rows)[number]) => boolean) => ({
    forte: rows.filter((r) => r.ad === "forte" && f(r)).length,
    moyenne: rows.filter((r) => r.ad === "moyenne" && f(r)).length,
    faible: rows.filter((r) => r.ad === "faible" && f(r)).length,
  });
  const all = count(() => true);
  console.log(`Règles ${DEFAULT_RULES.version} — ${rows.length} offres déjà jugées par l'IA : forte ${all.forte}, moyenne ${all.moyenne}, faible ${all.faible}`);
  console.log(`Seuil actuel du profil : ${profile.minScoreForAnalysis}\n`);
  console.log("seuil | envoyées à l'IA | forte | moyenne | faible (% inutiles) | forte perdues");
  for (const t of [40, 45, 50, 55, 60, 65, 70]) {
    const c = count((r) => !r.hidden && r.final >= t);
    const sent = c.forte + c.moyenne + c.faible;
    const pct = sent ? Math.round((100 * c.faible) / sent) : 0;
    console.log(`${String(t).padStart(5)} | ${String(sent).padStart(15)} | ${String(c.forte).padStart(5)} | ${String(c.moyenne).padStart(7)} | ${String(c.faible).padStart(6)} (${pct} %) | ${all.forte - c.forte}`);
  }
  if (detail) {
    console.log(`\nOffres « faible » qui passent le seuil ${profile.minScoreForAnalysis} :`);
    for (const r of rows.filter((x) => x.ad === "faible" && !x.hidden && x.final >= profile.minScoreForAnalysis).sort((a, b) => b.final - a.final)) {
      console.log(`- ${r.final} ${r.title}\n    ${r.warnings.slice(0, 4).join(" | ")}`);
    }
    console.log(`\nOffres « forte » sous le seuil ou masquées :`);
    for (const r of rows.filter((x) => x.ad === "forte" && (x.hidden || x.final < profile.minScoreForAnalysis))) {
      console.log(`- ${r.final}${r.hidden ? " (masquée)" : ""} ${r.title}${r.cap ? ` — plafond : ${r.cap}` : ""}`);
    }
  }
} finally {
  await prisma.$disconnect();
}
