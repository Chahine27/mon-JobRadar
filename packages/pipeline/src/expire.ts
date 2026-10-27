import type { PrismaClient } from "@job-radar/db";
import { outOfZone } from "@job-radar/shared";

/**
 * Offres expirées (plus en ligne). On ne devine pas : chaque source a sa règle.
 *  - France Travail : l'offre n'a pas été revue depuis 7 jours → on DEMANDE à France Travail si elle existe encore.
 *  - Sites carrières : chaque collecte récupère toutes les offres de l'entreprise → absente depuis 2 jours = retirée.
 *  - Adzuna : on DEMANDE à sa page publique (404 / 410 = retirée) ; sans réponse, la règle des 45 jours ci-dessous.
 *  - Jooble, HelloWork, WTTJ, Indeed : pas de vérification possible → publiée (ou vue la 1ʳᵉ fois) il y a plus de 45 jours.
 *  - LinkedIn (JobScraper) : on DEMANDE à la page publique ; bandeau « candidatures plus acceptées » ou offre supprimée → close.
 *  - Démo : jamais.
 * Une offre trouvée sur plusieurs sources n'expire que si TOUTES ses sources la donnent retirée.
 * Seules les offres « Nouvelle » / « Vue » passent en « Expirée » : sauvegardées et postulées ne bougent pas.
 */
export const EXPIRY = { ftUnseenDays: 7, careersUnseenDays: 2, adzunaMaxAgeDays: 45, maxFtChecks: 40, maxLinkedinChecks: 100, maxAdzunaChecks: 60 };

export type LinkInfo = { source: string; sourceJobId: string; lastSeenAt: Date };
export type ExpiryVerdict = "gone" | "online" | "unknown";

const DAY = 86_400_000;

/** Verdict pour une source d'une offre (fonction pure, testée). `ftOnline` : réponse du site (France Travail, LinkedIn, Adzuna) si demandée. */
export function linkVerdict(
  link: LinkInfo,
  job: { publishedAt: Date | null; firstSeenAt: Date },
  now: Date,
  ftOnline?: boolean | null,
): ExpiryVerdict {
  const unseenDays = (now.getTime() - link.lastSeenAt.getTime()) / DAY;
  if (link.source === "adzuna" && typeof ftOnline === "boolean") return ftOnline ? "online" : "gone";
  switch (link.source) {
    case "france-travail":
      if (unseenDays < EXPIRY.ftUnseenDays) return "online";
      return ftOnline === false ? "gone" : ftOnline === true ? "online" : "unknown";
    case "company-careers":
      return unseenDays >= EXPIRY.careersUnseenDays ? "gone" : "online";
    case "jobscraper:linkedin":
      // Une offre LinkedIn ne se devine pas : seulement si la page dit qu'elle est close.
      return ftOnline === false ? "gone" : "online";
    // Adzuna : réponse de sa page si on l'a, sinon la règle des 45 jours ci-dessous.
    case "adzuna":
    case "jooble":
    // Sites scrapés sur les dernières 24 h : une offre n'y est plus revue après sa 1ʳᵉ journée, l'absence ne dit rien.
    case "jobscraper:hellowork":
    case "jobscraper:wttj":
    case "jobscraper:indeed": {
      const ageDays = (now.getTime() - (job.publishedAt ?? job.firstSeenAt).getTime()) / DAY;
      return ageDays > EXPIRY.adzunaMaxAgeDays && unseenDays >= 1 ? "gone" : "online";
    }
    default:
      return "online";
  }
}

export type ExpiryReport = { checked: number; expired: number; ftChecks: number; linkedinChecks: number; adzunaChecks: number };

export async function expireJobs(opts: {
  prisma: PrismaClient;
  /** Vérification France Travail (FranceTravailSource.isStillOnline). */
  ftIsOnline?: (id: string) => Promise<boolean | null>;
  /** Vérification LinkedIn (linkedinJobIsOpen) : offre close = candidatures plus acceptées. */
  linkedinIsOpen?: (id: string) => Promise<boolean | null>;
  /** Vérification Adzuna (adzunaJobIsOpen) : page de l'offre en 404 / 410 = retirée. */
  adzunaIsOpen?: (id: string) => Promise<boolean | null>;
  /** Pause entre deux pages LinkedIn ou Adzuna (remplaçable dans les tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Départements de ta zone (zoneDepartments) : les offres LinkedIn / Adzuna ailleurs, masquées, ne sont pas vérifiées. */
  zone?: Set<string>;
  now?: Date;
  log?: (m: string) => void;
}): Promise<ExpiryReport> {
  const { prisma, log = () => {} } = opts;
  const now = opts.now ?? new Date();
  const report: ExpiryReport = { checked: 0, expired: 0, ftChecks: 0, linkedinChecks: 0, adzunaChecks: 0 };
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  /** Sites dont on lit la page de l'offre. `failures` : réponses illisibles d'affilée (429, blocage) ; au-delà de 3, on arrête de lui demander pour ce passage. */
  const pageChecks = {
    "jobscraper:linkedin": { isOpen: opts.linkedinIsOpen, max: EXPIRY.maxLinkedinChecks, pauseMs: 1500, key: "linkedinChecks" as const, failures: 0 },
    // Adzuna répond 429 au-delà d'une dizaine de pages à 1 s d'écart ; 40 pages à 3 s passent (27/10/2026).
    adzuna: { isOpen: opts.adzunaIsOpen, max: EXPIRY.maxAdzunaChecks, pauseMs: 3000, key: "adzunaChecks" as const, failures: 0 },
  };
  /** Pages demandées dans ce passage, tous sites confondus (pause entre deux). */
  let pages = 0;

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
      department: true,
      remoteType: true,
      // Lien le plus récent d'abord : le plus souvent encore en ligne, il évite de demander les autres.
      sources: { select: { source: true, sourceJobId: true, lastSeenAt: true }, orderBy: { lastSeenAt: "desc" } },
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
      const page = pageChecks[link.source as keyof typeof pageChecks];
      // Déjà une source en ligne : l'offre ne sera pas expirée, inutile de demander d'autres pages.
      const stillOnline = verdicts.includes("online");
      if (page?.isOpen && !stillOnline && !(opts.zone && outOfZone(job, opts.zone)) && report[page.key] < page.max && page.failures < 3) {
        // Une page à la fois, espacées : une rafale de 100 pages faisait bloquer l'IP par LinkedIn (HTTP 429).
        if (pages++ > 0) await sleep(page.pauseMs);
        report[page.key]++;
        ftOnline = await page.isOpen(link.sourceJobId);
        page.failures = ftOnline === null ? page.failures + 1 : 0;
        // Encore ouverte : notée « revue », elle passe en fin de file (tri par lastSeenAt) et les suivantes ont leur tour.
        if (ftOnline === true) {
          await prisma.$transaction([
            prisma.jobSourceLink.updateMany({ where: { source: link.source, sourceJobId: link.sourceJobId }, data: { lastSeenAt: now } }),
            prisma.job.update({ where: { id: job.id }, data: { lastSeenAt: now } }),
          ]);
        }
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
