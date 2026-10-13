import type { PrismaClient } from "@job-radar/db";
import { type NormalizedJob, normalize } from "@job-radar/job-normalizer";

/**
 * Champs que les règles tirent du texte de l'annonce et dont le score dépend : les seuls réécrits.
 * Jamais le titre, la description, le lieu, les coordonnées ni la date : ils viennent aussi d'autres étapes
 * (complément depuis la page, département depuis la ville, adresse trouvée pour le trajet) qu'on ne veut pas défaire.
 */
const RULE_FIELDS = [
  "contractType", "experienceText", "experienceMinYrs", "experienceMaxYrs", "technologies",
  "salaryMin", "salaryMax", "salaryPeriod", "salaryText", "remoteType",
] as const;
type RuleField = (typeof RULE_FIELDS)[number];

/** Ce que les règles actuelles donnent pour ces champs. Télétravail : une valeur connue n'est pas effacée par « inconnu ». */
export function ruleFieldsOf(n: NormalizedJob, current: { remoteType: string }): Pick<NormalizedJob, RuleField> {
  const out = Object.fromEntries(RULE_FIELDS.map((k) => [k, n[k]])) as Pick<NormalizedJob, RuleField>;
  if (out.remoteType === "unknown") out.remoteType = current.remoteType as NormalizedJob["remoteType"];
  return out;
}

/**
 * Réapplique les règles actuelles aux offres déjà en base, depuis les données brutes de leur source. Sans ça, une
 * règle corrigée (ex. « Niveau senior » de LinkedIn ignoré) ne touchait que les offres collectées après : les autres
 * gardaient l'ancienne valeur, et le score qui en dépend restait faux. Lancée au démarrage de l'API (rien à faire à
 * chaque changement de règle) et par « pnpm jobs:renormalize ».
 * Le score est recalculé à chaque affichage ; l'IA refait l'analyse si ce qu'elle lit change (cf. analysisFitsJob).
 * Corrections faites à la main et annonces collées : rangées à part, elles priment toujours.
 * ponytail: offres d'une seule source et sans ajout manuel (1 537 sur 1 793) ; plusieurs sources = valeurs fusionnées
 * à la collecte, qu'on ne sait pas refaire sans risque. À étendre si une règle doit aussi les corriger.
 */
export async function renormalizeJobs(opts: {
  prisma: PrismaClient;
  /** false : compte seulement ce qui changerait. */
  apply?: boolean;
  log?: (m: string) => void;
}): Promise<{ checked: number; changed: number; fields: Partial<Record<RuleField, number>> }> {
  const { prisma, log = () => {} } = opts;
  const jobs = await prisma.job.findMany({
    where: { sources: { none: { source: "manual" } } },
    select: {
      id: true, remoteType: true, contractType: true, experienceText: true, experienceMinYrs: true, experienceMaxYrs: true,
      technologies: true, salaryMin: true, salaryMax: true, salaryPeriod: true, salaryText: true,
      sources: { select: { source: true, sourceJobId: true, rawData: true, firstSeenAt: true } },
    },
  });
  const fields: Partial<Record<RuleField, number>> = {};
  let checked = 0;
  let changed = 0;
  for (const job of jobs) {
    if (job.sources.length !== 1) continue;
    const link = job.sources[0]!;
    const n = normalize({ source: link.source, sourceJobId: link.sourceJobId, data: link.rawData, collectedAt: link.firstSeenAt });
    if (!n) continue;
    checked++;
    const next = ruleFieldsOf(n, job);
    const diff = RULE_FIELDS.filter((k) => JSON.stringify(next[k]) !== JSON.stringify(job[k]));
    if (diff.length === 0) continue;
    changed++;
    for (const k of diff) fields[k] = (fields[k] ?? 0) + 1;
    if (opts.apply !== false) await prisma.job.update({ where: { id: job.id }, data: Object.fromEntries(diff.map((k) => [k, next[k]])) });
  }
  const detail = Object.entries(fields).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(", ");
  if (changed) log(`Règles actuelles réappliquées : ${changed} offre(s) mise(s) à jour (${detail})`);
  return { checked, changed, fields };
}
