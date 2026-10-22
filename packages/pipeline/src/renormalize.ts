import type { PrismaClient } from "@job-radar/db";
import { type NormalizedJob, comparable, normalize, withoutFreeWorkIntro } from "@job-radar/job-normalizer";

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

/** Texte comparable d'une description (sans la présentation Free-Work des extraits Adzuna). */
const descriptionKey = (text: string) => comparable(withoutFreeWorkIntro(text)).replace(/ /g, "");

/** Même annonce : même texte, ou même début (une source coupe la fin, l'autre non). */
export function sameDescription(a: string, b: string): boolean {
  const ka = descriptionKey(a);
  const kb = descriptionKey(b);
  return ka !== "" && (ka === kb || (ka.length >= 300 && kb.length >= 300 && ka.slice(0, 300) === kb.slice(0, 300)));
}

/**
 * Offre à plusieurs sources : les champs viennent de la source dont la description est celle de l'offre (c'est elle qui
 * l'a écrite, cf. ingestJob). null si aucune source ne correspond, ou si plusieurs correspondent sans donner la même chose.
 * Une valeur connue (venue d'une autre source : « CDI » de WTTJ) n'est pas effacée par « inconnu » de cette source.
 */
export function ownerFields(
  description: string,
  normalized: NormalizedJob[],
  current: { remoteType: string } & Partial<Record<RuleField, unknown>>,
): Pick<NormalizedJob, RuleField> | null {
  const owners = normalized.filter((n) => sameDescription(n.description, description)).map((n) => ruleFieldsOf(n, current));
  if (!owners.length) return null;
  const first = JSON.stringify(owners[0]);
  if (!owners.every((o) => JSON.stringify(o) === first)) return null;
  const out = { ...owners[0]! } as Record<RuleField, unknown>;
  for (const k of RULE_FIELDS) if (out[k] === null && current[k] !== null && current[k] !== undefined) out[k] = current[k];
  return out as Pick<NormalizedJob, RuleField>;
}

/**
 * Réapplique les règles actuelles aux offres déjà en base, depuis les données brutes de leur source. Sans ça, une
 * règle corrigée (ex. « Niveau senior » de LinkedIn ignoré) ne touchait que les offres collectées après : les autres
 * gardaient l'ancienne valeur, et le score qui en dépend restait faux. Lancée au démarrage de l'API (rien à faire à
 * chaque changement de règle) et par « pnpm jobs:renormalize ».
 * Le score est recalculé à chaque affichage ; l'IA refait l'analyse si ce qu'elle lit change (cf. analysisFitsJob).
 * Corrections faites à la main et annonces collées : rangées à part, elles priment toujours.
 * Plusieurs sources : relues depuis celle qui a écrit la description (cf. ownerFields ; 452 sur 459 au 23/10/2026).
 * ponytail: offres avec un ajout manuel jamais relues ; à étendre si une règle doit aussi les corriger.
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
      id: true, description: true, remoteType: true, contractType: true, experienceText: true, experienceMinYrs: true, experienceMaxYrs: true,
      technologies: true, salaryMin: true, salaryMax: true, salaryPeriod: true, salaryText: true,
      sources: { select: { source: true, sourceJobId: true, rawData: true, firstSeenAt: true } },
    },
  });
  const fields: Partial<Record<RuleField, number>> = {};
  let checked = 0;
  let changed = 0;
  for (const job of jobs) {
    const all = job.sources
      .map((l) => normalize({ source: l.source, sourceJobId: l.sourceJobId, data: l.rawData, collectedAt: l.firstSeenAt }))
      .filter((n): n is NormalizedJob => n !== null);
    if (all.length !== job.sources.length || all.length === 0) continue;
    const next = all.length === 1 ? ruleFieldsOf(all[0]!, job) : ownerFields(job.description, all, job);
    if (!next) continue;
    checked++;
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
