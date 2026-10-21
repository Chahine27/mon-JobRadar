/**
 * « pnpm --filter @job-radar/api cv:upgrade [--apply] » : mise à jour unique du CV complet et du kit de lettres
 * (règles du CV du 21/10/2026) : lien GitHub, « En recherche d'un CDI ou CDD », projet Job Radar affiché sur
 * tous les CV (description à valider), profils « frontend » à valider. Sans --apply : montre ce qui changerait.
 * Relancer ne change plus rien.
 */
import { hashOf } from "@job-radar/cv-tailor";
import { createPrismaClient } from "@job-radar/db";
import { type CvMaster, CvMasterSchema, LetterKitSchema } from "@job-radar/shared";
import { loadEnv } from "./env";
import { createPrismaStores } from "./prisma-stores";

const GITHUB = "github.com/Chahine27";
const JOB_RADAR = {
  name: "Job Radar",
  context: "Application de recherche d'emploi en production (projet perso, depuis 2026)",
  team: "",
  link: "github.com/Chahine27/mon-JobRadar",
  rule: "always" as const,
  technologies: ["TypeScript", "Vue 3", "Fastify", "PostgreSQL", "API Claude"],
  ownSkills: ["typescript", "vue", "postgresql", "llm-api"],
  description:
    "Cahier des charges, pilotage du développement avec Claude Code, tests et mise en ligne d'une application complète : collecte d'offres sur une dizaine de sources, note de compatibilité, suivi des candidatures par mail. Plus de 800 tests automatiques, mise en ligne automatique sur serveur.",
};
const cdd = (s: string) => s.replace(/En recherche d'un CDI(?! ou CDD)/g, "En recherche d'un CDI ou CDD");

function upgrade(m: CvMaster, log: (s: string) => void): void {
  if (!m.identity.github) {
    m.identity.github = GITHUB;
    log(`GitHub : ${GITHUB}`);
  }
  for (const h of m.headline.filter((x) => cdd(x.text) !== x.text)) {
    h.text = cdd(h.text);
    log(`En-tête : ${h.text}`);
  }

  let p = m.projects.find((x) => /job\s*radar/i.test(x.name));
  if (!p) {
    p = { id: "job-radar", name: JOB_RADAR.name, context: "", team: "", descriptions: [], technologies: [], ownSkills: [], teamOnlySkills: [], link: "", rule: "ifRelevant" };
    m.projects.unshift(p);
    log("Projet Job Radar créé");
  }
  Object.assign(p, { name: JOB_RADAR.name, context: JOB_RADAR.context, team: JOB_RADAR.team, link: JOB_RADAR.link, rule: JOB_RADAR.rule, technologies: JOB_RADAR.technologies });
  delete p.roleNote;
  p.ownSkills = [...new Set([...p.ownSkills, ...JOB_RADAR.ownSkills])];
  if (!p.descriptions.some((d) => d.text === JOB_RADAR.description)) {
    const id = `d${p.descriptions.length + 1}`;
    p.descriptions.unshift({ id, style: "nom", text: JOB_RADAR.description, toValidate: true });
    log(`Description Job Radar à valider : ${p.id}:${id}`);
  }
  m.projects = [p, ...m.projects.filter((x) => x !== p)];

  // Profil cohérent avec le titre « Développeur Frontend … » : copie « frontend » de chaque profil full stack, à valider.
  for (const s of m.summaries.filter((x) => x.jobTypes === "any" && /^Développeur full[\s-]?stack/i.test(x.text))) {
    const id = `${s.id}-front`;
    if (m.summaries.some((x) => x.id === id)) continue;
    const text = s.text.replace(/^Développeur full[\s-]?stack/i, "Développeur frontend");
    m.summaries.push({ id, template: s.template, jobTypes: ["frontend"], text, toValidate: true });
    log(`Profil frontend à valider : ${id} — ${text.slice(0, 90)}…`);
  }
}

const apply = process.argv.includes("--apply");
const prisma = createPrismaClient(loadEnv().DATABASE_URL);
const stores = createPrismaStores(prisma);
try {
  const user = await prisma.user.findFirst({ select: { id: true } });
  const rec = user && (await stores.cvMasters.get(user.id));
  if (!user || !rec) throw new Error("Pas de CV complet en base.");
  const master = CvMasterSchema.parse(rec.master);
  const before = hashOf(master);
  upgrade(master, (s) => console.log(`CV complet · ${s}`));
  const next = CvMasterSchema.parse(master);
  if (apply && hashOf(next) !== before) await stores.cvMasters.save(user.id, next, hashOf(next));

  const kit = await stores.letterKits.get(user.id);
  if (kit && cdd(kit.cvText) !== kit.cvText) {
    console.log("Kit de lettres · CV texte : « En recherche d'un CDI ou CDD »");
    if (apply) await stores.letterKits.save(user.id, LetterKitSchema.parse({ ...kit, cvText: cdd(kit.cvText) }));
  }
  console.log(apply ? "Enregistré." : "Rien enregistré (ajoute --apply).");
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
