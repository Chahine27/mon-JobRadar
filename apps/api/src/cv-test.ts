/**
 * « pnpm cv:test <idOffre> [une-colonne|deux-colonnes] » : affiche le choix du CV adapté (morceaux, notes,
 * écartés, contrôles) sans créer de PDF ni rien enregistrer.
 */
import { OllamaClient } from "@job-radar/ai";
import { cvSkillLabel } from "@job-radar/skills";
import { createPrismaClient } from "@job-radar/db";
import { EMPTY_OVERRIDES, TemplateIdSchema } from "@job-radar/shared";
import { createCvService } from "./cv";
import { loadEnv } from "./env";
import { createPrismaStores } from "./prisma-stores";

const [jobId, tpl = "deux-colonnes"] = process.argv.slice(2);
if (!jobId) {
  console.error("Usage : pnpm cv:test <idOffre> [une-colonne|deux-colonnes]");
  process.exit(1);
}
const template = TemplateIdSchema.parse(tpl);
const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const stores = createPrismaStores(prisma);
try {
  const user = await prisma.user.findFirst({ select: { id: true } });
  const job = await stores.jobs.get(jobId);
  if (!user || !job) throw new Error(`Offre introuvable : ${jobId}`);
  const cv = createCvService(stores, { aiModel: new OllamaClient({ baseUrl: process.env.OLLAMA_URL, model: process.env.OLLAMA_MODEL }).model });
  const m = await cv.master(user.id);
  if ("error" in m) throw new Error(m.error === "NO_CV_MASTER" ? "Pas de CV complet en base (page /cv)." : "CV complet incohérent (page /cv).");
  const jobCv = await cv.jobForCv(user.id, job);
  const saved = await stores.tailoredCvs.get(job.id, template);
  const d = await cv.compute(m.master, jobCv, template, saved?.overrides ?? EMPTY_OVERRIDES);
  const skills = (ids: string[]) => ids.map(cvSkillLabel).join(", ") || "—";
  const why = (r: { skillId: string; points: number }[]) => r.map((x) => `${cvSkillLabel(x.skillId)} +${x.points}`).join(", ");

  console.log(`\n${job.title} — ${job.company ?? "?"}  [${template}, règles ${d.rulesVersion}]`);
  console.log(`Type de poste : ${jobCv.jobType} · compétences lues par ${jobCv.skillsSource === "ai" ? "l'analyse IA" : "le dictionnaire"}`);
  console.log(`Exigées : ${skills(jobCv.required)}\nEn plus : ${skills(jobCv.niceToHave)}`);
  console.log(`\nTitre : ${d.sections.title}`);
  for (const e of d.sections.experiences) {
    console.log(`\n${e.role} (${e.company})`);
    for (const b of e.bullets) {
      const p = d.picked.find((x) => x.kind === "bullet" && x.id === b.id)!;
      console.log(`  [${String(p.score).padStart(3)}] ${b.id}  ${why(p.reasons)}`);
    }
  }
  console.log("\nProjets :");
  for (const p of d.picked.filter((x) => x.kind === "project")) console.log(`  [${String(p.score).padStart(3)}] ${p.label}  ${why(p.reasons)}`);
  console.log(`\nCompétences : ${d.sections.skillGroups.map((g) => `${g.label} (${g.items.length})`).join(" · ")}`);
  console.log("\nLaissé de côté :");
  for (const x of d.dropped) console.log(`  [${String(x.score).padStart(3)}] ${x.kind} ${x.id} — ${x.why}`);
  console.log(`\nAbsent du CV : ${skills(d.missing.absent)} · vu en cours : ${skills(d.missing.onlyCourse)} · choisi de ne pas afficher : ${skills(d.missing.forbidden)}`);
  if (d.substitutions.length) console.log(`Remplacements : ${d.substitutions.map((s) => `${s.from} → ${s.to}`).join(", ")}`);
  for (const w of d.warnings) console.log(`⚠ ${w}`);
  console.log("\nContrôles :");
  for (const c of d.checks) console.log(`  ${c.ok === true ? "✔" : c.ok === false ? "✘" : "·"} ${c.id}. ${c.label}${c.details.length ? ` — ${c.details.join(" ; ")}` : ""}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
