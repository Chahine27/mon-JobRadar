import type { PrismaClient } from "@job-radar/db";

/**
 * Offres expirées (plus en ligne). On ne devine pas : chaque source a sa règle.
 *  - France Travail : l'offre n'a pas été revue depuis 7 jours → on DEMANDE à France Travail si elle existe encore.
 *  - Sites carrières : chaque collecte récupère toutes les offres de l'entreprise → absente depuis 2 jours = retirée.
 *  - Adzuna, Jooble : pas de vérification possible → publiée (ou vue la 1ʳᵉ fois) il y a plus de 45 jours.
 *  - LinkedIn (JobScraper) : on DEMANDE à la page publique ; bandeau « candidatures plus acceptées » ou offre supprimée → close.
 *  - Démo : jamais.
 * Une offre trouvée sur plusieurs sources n'expire que si TOUTES ses sources la donnent retirée.
 * Seules les offres « Nouvelle » / « Vue » passent en « Expirée » : sauvegardées et postulées ne bougent pas.
 */
export const EXPIRY = { ftUnseenDays: 7, careersUnseenDays: 2, adzunaMaxAgeDays: 45, maxFtChecks: 40, maxLinkedinChecks: 100 };

export type LinkInfo = { source: string; sourceJobId: string; lastSeenAt: Date };
export type ExpiryVerdict = "gone" | "online" | "unknown";

const DAY = 86_400_000;

/** Verdict pour une source d'une offre (fonction pure, testée). `ftOnline` : réponse du site (France Travail, LinkedIn) si demandée. */
export function linkVerdict(
  link: LinkInfo,
  job: { publishedAt: Date | null; firstSeenAt: Date },
  now: Date,
  ftOnline?: boolean | null,
): ExpiryVerdict {
  const unseenDays = (now.getTime() - link.lastSeenAt.getTime()) / DAY;
  switch (link.source) {
    case "france-travail":
      if (unseenDays < EXPIRY.ftUnseenDays) return "online";
      return ftOnline === false ? "gone" : ftOnline === true ? "online" : "unknown";
    case "company-careers":
      return unseenDays >= EXPIRY.careersUnseenDays ? "gone" : "online";
    case "jobscraper:linkedin":
      // Une offre LinkedIn ne se devine pas : seulement si la page dit qu'elle est close.
      return ftOnline === false ? "gone" : "online";
    case "adzuna":
    case "jooble": {
      const ageDays = (now.getTime() - (job.publishedAt ?? job.firstSeenAt).getTime()) / DAY;
      return ageDays > EXPIRY.adzunaMaxAgeDays && unseenDays >= 1 ? "gone" : "online";
    }
    default:
      return "online";
  }
}

export type ExpiryReport = { checked: number; expired: number; ftChecks: number; linkedinChecks: number };

export async function expireJobs(opts: {
  prisma: PrismaClient;
  /** Vérification France Travail (FranceTravailSource.isStillOnline). */
  ftIsOnline?: (id: string) => Promise<boolean | null>;
  /** Vérification LinkedIn (linkedinJobIsOpen) : offre close = candidatures plus acceptées. */
  linkedinIsOpen?: (id: string) => Promise<boolean | null>;
  now?: Date;
  log?: (m: string) => void;
}): Promise<ExpiryReport> {
  const { prisma, log = () => {} } = opts;
  const now = opts.now ?? new Date();
  const report: ExpiryReport = { checked: 0, expired: 0, ftChecks: 0, linkedinChecks: 0 };

  // Candidates : pas revues depuis au moins 1 jour, ou venues de LinkedIn (une offre peut y fermer en quelques heures).
  const jobs = await prisma.job.findMany({
    where: {
      status: { in: ["NEW", "SEEN"] },
      OR: [
        { lastSeenAt: { lt: new Date(now.getTime() - DAY) } },
        ...(opts.linkedinIsOpen ? [{ sources: { some: { source: "jobscraper:linkedin" } } }] : []),
      ],
    },
    select: {
      id: true,
      publishedAt: true,
      firstSeenAt: true,
      sources: { select: { source: true, sourceJobId: true, lastSeenAt: true } },
    },
    orderBy: { lastSeenAt: "asc" },
    take: 500,
  });

  for (const job of jobs) {
    report.checked++;
    const verdicts: ExpiryVerdict[] = [];
    for (const link of job.sources) {
      let ftOnline: boolean | null | undefined;
      const needsFt =
        link.source === "france-travail" &&
        (now.getTime() - link.lastSeenAt.getTime()) / DAY >= EXPIRY.ftUnseenDays &&
        opts.ftIsOnline &&
        report.ftChecks < EXPIRY.maxFtChecks;
      if (needsFt) {
        report.ftChecks++;
        ftOnline = await opts.ftIsOnline!(link.sourceJobId);
        // Encore en ligne : on la note « revue » pour ne pas redemander avant 7 jours.
        if (ftOnline === true) {
          await prisma.jobSourceLink.updateMany({ where: { source: link.source, sourceJobId: link.sourceJobId }, data: { lastSeenAt: now } });
        }
      }
      // ponytail: plafond fixe, toujours les mêmes offres les plus anciennes en premier ; faire tourner (date de dernière vérification) si plus de 100 offres LinkedIn actives.
      if (link.source === "jobscraper:linkedin" && opts.linkedinIsOpen && report.linkedinChecks < EXPIRY.maxLinkedinChecks) {
        report.linkedinChecks++;
        ftOnline = await opts.linkedinIsOpen(link.sourceJobId);
      }
      verdicts.push(linkVerdict(link, job, now, ftOnline));
    }
    if (verdicts.length > 0 && verdicts.every((v) => v === "gone")) {
      await prisma.$transaction([
        prisma.job.update({ where: { id: job.id }, data: { status: "EXPIRED" } }),
        prisma.jobEvent.create({ data: { jobId: job.id, type: "STATUS_CHANGED", toValue: "EXPIRED", fromValue: "auto" } }),
      ]);
      report.expired++;
    }
  }
  if (report.expired) log(`Offres expirées : ${report.expired} (sur ${report.checked} vérifiées)`);
  return report;
}
