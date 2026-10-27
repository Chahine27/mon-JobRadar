import type { Prisma, PrismaClient } from "@job-radar/db";
import { type NormalizedJob, type OfferSalary, dedupeKeyOf, sameAdText, sameOffer, sameSalary, urlKey } from "@job-radar/job-normalizer";
import { ABRIDGED_SOURCES } from "@job-radar/shared";
import { fillGaps } from "./renormalize";

export type IngestOutcome = "created" | "updated" | "unchanged" | "duplicate";

export function jobFields(n: NormalizedJob) {
  return {
    contentHash: n.contentHash,
    dedupeKey: dedupeKeyOf(n.company, n.title),
    title: n.title,
    company: n.company,
    description: n.description,
    contractType: n.contractType,
    experienceText: n.experienceText,
    experienceMinYrs: n.experienceMinYrs,
    experienceMaxYrs: n.experienceMaxYrs,
    salaryMin: n.salaryMin,
    salaryMax: n.salaryMax,
    salaryPeriod: n.salaryPeriod,
    salaryText: n.salaryText,
    city: n.city,
    postalCode: n.postalCode,
    department: n.department,
    address: n.address,
    latitude: n.latitude,
    longitude: n.longitude,
    locationPrecision: n.locationPrecision,
    remoteType: n.remoteType,
    technologies: n.technologies,
    publishedAt: n.publishedAt,
  };
}

const json = (v: unknown) => (v ?? undefined) as Prisma.InputJsonValue | undefined;

/** Champs tirés du texte de l'annonce (cf. RULE_FIELDS de renormalize), comblés d'une annonce à l'autre par fillGaps. */
const RULE_SELECT = {
  contractType: true, experienceText: true, experienceMinYrs: true, experienceMaxYrs: true, technologies: true,
  salaryMin: true, salaryMax: true, salaryPeriod: true, salaryText: true, remoteType: true,
} as const;

/**
 * Enregistre une offre normalisée en évitant les doublons (README §10) :
 *  1. même source + même identifiant → mise à jour de l'offre existante ;
 *  2. même lien d'annonce (clé d'URL, ex. même identifiant LinkedIn), ou même empreinte (entreprise + titre + ville),
 *     ou même offre écrite autrement (« … - Freelance (H/F) » / « … - Freelance », « Paris » / « 8ème Arrondissement »,
 *     cf. sameOffer) → la source est rattachée à l'offre existante ;
 *  3. sinon → nouvelle offre.
 * Une description vide, ou un extrait (Adzuna, Jooble) plus court, ne remplace jamais une description existante ; une offre
 * sans description ou réduite à un extrait est complétée par le doublon qui apporte le texte entier (ex. Adzuna + Indeed).
 */
export async function ingestJob(prisma: PrismaClient, n: NormalizedJob, now = new Date()): Promise<IngestOutcome> {
  const link = await prisma.jobSourceLink.findUnique({
    where: { source_sourceJobId: { source: n.source, sourceJobId: n.sourceJobId } },
    select: { id: true, jobId: true, rawData: true, firstSeenAt: true, job: { select: { contentHash: true, description: true, publishedAt: true, salaryMin: true, salaryMax: true, salaryPeriod: true, salaryText: true } } },
  });
  // Lien de l'annonce elle-même (pas le lien partenaire de France Travail : il peut être commun à plusieurs offres).
  const key = urlKey(n.sourceUrl);
  // Description perdue : vide, ou simple extrait (Adzuna, Jooble) plus court que le texte déjà connu (venu d'une autre source).
  // Annonce relue sur sa page (Free-Work pour Adzuna, cf. completeFreeWorkAds) : texte entier, plus un extrait.
  const fromExcerpt = ABRIDGED_SOURCES.includes(n.source) && (n.rawData as Record<string, unknown> | null)?.detailFetched !== true;
  const lostDescription = (old: string) =>
    (!n.description.trim() && old.trim() !== "") || (fromExcerpt && n.description.trim().length < old.trim().length);
  // Texte plus complet que l'extrait connu : une source qui donne l'annonce entière remplace l'extrait.
  const improvesDescription = (old: string) => !fromExcerpt && n.description.trim().length > old.trim().length + 50;
  const dedupeKey = dedupeKeyOf(n.company, n.title);
  // Salaire qui contredit celui d'une annonce plus ancienne de la même offre (copie d'agrégateur à « 70–100 k€ ») :
  // l'offre garde le sien (cf. oldestSalary, qui fait pareil pour les offres déjà en base).
  const keptSalary = (job: OfferSalary & { salaryText: string | null }) =>
    sameSalary(job, n) ? {} : { salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryPeriod: job.salaryPeriod, salaryText: job.salaryText };

  if (link) {
    // Annonce complétée depuis sa page (completeJobScraperDescriptions) : la collecte, qui n'en donne qu'un résumé
    // ou rien, ne l'écrase pas. Idem si le détail n'a pas été récupéré cette fois (blocage, page vide).
    const keepDetail = (link.rawData as Record<string, unknown> | null)?.detailFetched === true &&
      (n.rawData as Record<string, unknown> | null)?.detailFetched !== true;
    const changed = link.job.contentHash !== n.contentHash && !lostDescription(link.job.description) && !keepDetail;
    const older = changed && (await prisma.jobSourceLink.count({ where: { jobId: link.jobId, firstSeenAt: { lt: link.firstSeenAt } } })) > 0;
    // Date de publication : une date connue n'est jamais effacée par « inconnue » (JobScraper n'en donne pas,
    // elle vient de la page de l'offre), et une offre qui gagne sa date est mise à jour même si le texte est le même.
    const publishedAt = n.publishedAt ?? link.job.publishedAt;
    const gainsDate = !link.job.publishedAt && n.publishedAt !== null;
    const old = (link.rawData ?? {}) as Record<string, unknown>;
    const fresh = (n.rawData ?? {}) as Record<string, unknown>;
    // Données brutes : on garde la date trouvée sur la page (sinon elle serait recherchée à chaque passage).
    const rawData = old.dateChecked === true && fresh.dateChecked !== true ? { ...fresh, posted_at: fresh.posted_at ?? old.posted_at, dateChecked: true } : fresh;
    await prisma.$transaction([
      prisma.jobSourceLink.update({
        where: { id: link.id },
        data: { lastSeenAt: now, sourceUrl: n.sourceUrl, canonicalUrl: key, ...(keepDetail ? {} : { rawData: json(rawData) }) },
      }),
      prisma.job.update({
        where: { id: link.jobId },
        data: changed
          ? { ...jobFields(n), ...(older ? keptSalary(link.job) : {}), publishedAt, lastSeenAt: now }
          : { lastSeenAt: now, ...(gainsDate ? { publishedAt } : {}), ...(dedupeKey ? { dedupeKey } : {}) },
      }),
      ...(changed
        ? [prisma.jobEvent.create({ data: { jobId: link.jobId, type: "UPDATED", toValue: n.contentHash } })]
        : []),
    ]);
    return changed || gainsDate ? "updated" : "unchanged";
  }

  const sourceLink = {
    source: n.source,
    sourceJobId: n.sourceJobId,
    sourceUrl: n.sourceUrl,
    canonicalUrl: key,
    rawData: json(n.rawData),
    firstSeenAt: now,
    lastSeenAt: now,
  };

  const byUrl = key ? await prisma.jobSourceLink.findFirst({ where: { canonicalUrl: key }, select: { jobId: true } }) : null;
  // Offre qui a déjà une annonce de cette source : seulement si c'est le même texte (cf. sameAdText).
  const fitsSource = async (job: { id: string; description: string }) =>
    n.source === "manual" ||
    sameAdText(job.description, n.description) ||
    (await prisma.jobSourceLink.count({ where: { jobId: job.id, source: n.source } })) === 0;
  type Known = { id: string; description: string } & OfferSalary & { salaryText: string | null };
  const salarySelect = { salaryMin: true, salaryMax: true, salaryPeriod: true, salaryText: true } as const;
  let same: Known | null = await prisma.job.findUnique({
    where: byUrl ? { id: byUrl.jobId } : { fingerprint: n.fingerprint },
    select: { id: true, description: true, ...salarySelect },
  });
  const fingerprintTaken = !byUrl && same !== null;
  if (same && !byUrl && !(await fitsSource(same))) same = null;
  // Même offre écrite autrement par une autre source (titre, contrat, lieu) : rattachée à l'offre connue.
  if (!same && dedupeKey) {
    const candidates = await prisma.job.findMany({
      where: { dedupeKey },
      select: { id: true, description: true, ...salarySelect, title: true, city: true, department: true },
      orderBy: { firstSeenAt: "asc" },
    });
    for (const c of candidates) {
      if (sameOffer(c, n) && (await fitsSource(c))) {
        same = c;
        break;
      }
    }
  }
  if (same) {
    // L'offre connue n'avait pas de description, ou seulement un extrait : celle du doublon la complète (score et IA sur le vrai texte).
    const fill = (!same.description.trim() && n.description.trim() !== "") || improvesDescription(same.description);
    // Les infos s'additionnent : un champ vide d'un côté (contrat, salaire, expérience, télétravail) est pris à l'autre.
    const current = await prisma.job.findUniqueOrThrow({ where: { id: same.id }, select: RULE_SELECT });
    const fields = fill ? fillGaps({ ...jobFields(n), ...keptSalary(same) }, [current]) : fillGaps(current, [n]);
    await prisma.$transaction([
      prisma.jobSourceLink.create({ data: { ...sourceLink, jobId: same.id } }),
      prisma.job.update({ where: { id: same.id }, data: { ...(fill ? jobFields(n) : {}), ...fields, lastSeenAt: now } }),
      prisma.jobEvent.create({ data: { jobId: same.id, type: "SOURCE_ADDED", toValue: n.source } }),
    ]);
    return "duplicate";
  }

  await prisma.job.create({
    data: {
      ...jobFields(n),
      // Empreinte (entreprise + titre + ville) déjà prise par une autre annonce de la même agence : celle de l'annonce.
      fingerprint: fingerprintTaken ? `src:${n.source}:${n.sourceJobId}` : n.fingerprint,
      firstSeenAt: now,
      lastSeenAt: now,
      sources: { create: sourceLink },
      events: { create: { type: "CREATED", toValue: n.source } },
    },
  });
  return "created";
}
