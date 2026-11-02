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
 * Seules les offres « Nouvelle » / « Vue » / « Ignorée » passent en « Expirée » : sauvegardées et postulées ne bougent pas.
 * Les liens Adzuna / LinkedIn dont la page est retirée sont supprimés de l'offre (tous statuts) tant qu'il en reste un autre.
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

export type ExpiryReport = { checked: number; expired: number; ftChecks: number; linkedinChecks: number; adzunaChecks: number; linksRemoved: number };

export type ExpireOptions = {
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
};

/** Un site dont on lit la page de l'offre. `failures` : réponses illisibles d'affilée (429, blocage) ; au-delà de 3, on arrête de lui demander pour ce passage. */
type PageSite = { isOpen: ((id: string) => Promise<boolean | null>) | undefined; max: number; pauseMs: number; key: "linkedinChecks" | "adzunaChecks"; failures: number; checkAll: boolean };

/** L'état d'un passage : compteurs, pause entre deux pages, sites dont on lit la page. */
type Run = {
  prisma: PrismaClient;
  opts: ExpireOptions;
  now: Date;
  report: ExpiryReport;
  sleep: (ms: number) => Promise<void>;
  pageChecks: Record<string, PageSite>;
  /** Pages demandées dans ce passage, tous sites confondus (pause entre deux). */
  pages: number;
};

/** Offres à vérifier : pas revues depuis au moins 1 jour, ou venues de LinkedIn (une offre peut y fermer en quelques heures). */
function findCandidates(opts: ExpireOptions, now: Date) {
  return opts.prisma.job.findMany({
    where: {
      // Tous statuts sauf déjà expirée : les liens morts d'une offre ignorée, sauvegardée ou postulée sont retirés aussi.
      status: { not: "EXPIRED" },
      OR: [
        { lastSeenAt: { lt: new Date(now.getTime() - DAY) } },
        ...(opts.linkedinIsOpen ? [{ sources: { some: { source: "jobscraper:linkedin" } } }] : []),
        // Annonce republiée sur Adzuna : plusieurs liens dont la plupart peuvent être morts, même si l'offre a été revue aujourd'hui.
        // ponytail: toute offre Adzuna est candidate (tri par ancienneté + 60 pages max par passage) ; compter les liens en SQL n'en vaut pas la peine.
        ...(opts.adzunaIsOpen ? [{ sources: { some: { source: "adzuna" } } }] : []),
      ],
    },
    select: {
      id: true,
      status: true,
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
}
type ExpiryJob = Awaited<ReturnType<typeof findCandidates>>[number];

/**
 * Demande à la source si ce lien est encore en ligne : France Travail (offre pas revue depuis 7 jours) ou la page de
 * l'offre (LinkedIn, Adzuna). undefined = pas demandé.
 */
async function askSource(run: Run, job: ExpiryJob, link: ExpiryJob["sources"][number], verdicts: ExpiryVerdict[]): Promise<boolean | null | undefined> {
  const { prisma, opts, now, report } = run;
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
  const page = run.pageChecks[link.source];
  // Déjà une source en ligne : l'offre ne sera pas expirée, inutile de demander d'autres pages (sauf Adzuna, dont chaque lien mort est retiré).
  const skip = page?.checkAll ? false : verdicts.includes("online");
  if (page?.isOpen && !skip && !(opts.zone && outOfZone(job, opts.zone)) && report[page.key] < page.max && page.failures < 3) {
    // Une page à la fois, espacées : une rafale de 100 pages faisait bloquer l'IP par LinkedIn (HTTP 429).
    if (run.pages++ > 0) await run.sleep(page.pauseMs);
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
  return ftOnline;
}

/** Tire la conclusion pour une offre : liens morts retirés si elle vit ailleurs, « Expirée » si toutes ses sources la donnent retirée. */
async function settle(run: Run, job: ExpiryJob, verdicts: ExpiryVerdict[], deadLinks: { source: string; sourceJobId: string }[]) {
  const { prisma, report } = run;
  const allGone = verdicts.length > 0 && verdicts.every((v) => v === "gone");
  // L'offre vit encore ailleurs : les liens morts (Adzuna republie la même annonce des dizaines de fois) ne servent plus qu'à afficher des « page introuvable ».
  if (!allGone && deadLinks.length > 0) {
    await prisma.jobSourceLink.deleteMany({ where: { jobId: job.id, OR: deadLinks.map(({ source, sourceJobId }) => ({ source, sourceJobId })) } });
    report.linksRemoved += deadLinks.length;
  }
  // « Nouvelle », « Vue » et « Ignorée » passent en « Expirée » ; sauvegardée et postulée gardent leurs liens et leur statut.
  if (allGone && (job.status === "NEW" || job.status === "SEEN" || job.status === "IGNORED")) {
    await prisma.$transaction([
      prisma.job.update({ where: { id: job.id }, data: { status: "EXPIRED" } }),
      prisma.jobEvent.create({ data: { jobId: job.id, type: "STATUS_CHANGED", toValue: "EXPIRED", fromValue: "auto" } }),
    ]);
    report.expired++;
  }
}

/** Vérifie une offre : un verdict par source, les liens dont la page est retirée, puis la conclusion. */
async function expireOne(run: Run, job: ExpiryJob) {
  run.report.checked++;
  const verdicts: ExpiryVerdict[] = [];
  /** Liens dont la page répond « retirée » : supprimés si l'offre reste en ligne ailleurs. */
  const deadLinks: { source: string; sourceJobId: string }[] = [];
  for (const link of job.sources) {
    const online = await askSource(run, job, link, verdicts);
    if (run.pageChecks[link.source] && online === false) deadLinks.push(link);
    verdicts.push(linkVerdict(link, job, run.now, online));
  }
  await settle(run, job, verdicts, deadLinks);
}

export async function expireJobs(opts: ExpireOptions): Promise<ExpiryReport> {
  const { prisma, log = () => {} } = opts;
  const now = opts.now ?? new Date();
  const report: ExpiryReport = { checked: 0, expired: 0, ftChecks: 0, linkedinChecks: 0, adzunaChecks: 0, linksRemoved: 0 };
  const run: Run = {
    prisma,
    opts,
    now,
    report,
    sleep: opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
    pages: 0,
    pageChecks: {
      "jobscraper:linkedin": { isOpen: opts.linkedinIsOpen, max: EXPIRY.maxLinkedinChecks, pauseMs: 1500, key: "linkedinChecks", failures: 0, checkAll: false },
      // Adzuna répond 429 au-delà d'une dizaine de pages à 1 s d'écart ; 40 pages à 3 s passent (27/10/2026).
      adzuna: { isOpen: opts.adzunaIsOpen, max: EXPIRY.maxAdzunaChecks, pauseMs: 3000, key: "adzunaChecks", failures: 0, checkAll: true },
    },
  };
  for (const job of await findCandidates(opts, now)) await expireOne(run, job);
  if (report.expired) log(`Offres expirées : ${report.expired} (sur ${report.checked} vérifiées)`);
  if (report.linksRemoved) log(`Liens morts retirés : ${report.linksRemoved}`);
  return report;
}
