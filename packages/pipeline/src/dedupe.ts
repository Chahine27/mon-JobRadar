import type { PrismaClient } from "@job-radar/db";
import { dedupeKeyOf, sameOffer } from "@job-radar/job-normalizer";

/** Offre déjà en base, avec ce qui compte pour choisir celle qu'on garde. */
type Row = {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  department: string | null;
  status: string;
  firstSeenAt: Date;
  fullText: string | null;
  coverLetter: { id: string } | null;
  _count: { mails: number };
};

/** Ce que tu as décidé sur l'offre : postulé > refusé > sauvegardé > ignoré > simplement vue > nouvelle > expirée. */
const STATUS_RANK: Record<string, number> = { APPLIED: 6, REJECTED: 5, SAVED: 4, IGNORED: 3, SEEN: 2, NEW: 1, EXPIRED: 0 };
const statusRank = (s: string) => STATUS_RANK[s] ?? 0;

/** Ce que tu as fait sur l'offre (statut, mails reçus, lettre) compte plus que son ancienneté. */
function keeperRank(j: Row): number {
  return statusRank(j.status) * 10 + (j._count.mails > 0 ? 8 : 0) + (j.coverLetter ? 4 : 0) + (j.fullText ? 2 : 0);
}

/** Regroupe les offres qui sont la même ; la 1ʳᵉ de chaque groupe est celle à garder. */
export function groupDuplicates(rows: Row[]): Row[][] {
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const key = dedupeKeyOf(r.company, r.title);
    if (key) (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(r);
  }
  const groups: Row[][] = [];
  for (const rs of byKey.values()) {
    const clusters: Row[][] = [];
    for (const r of [...rs].sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime())) {
      const home = clusters.find((c) => sameOffer(c[0]!, r));
      if (home) home.push(r);
      else clusters.push([r]);
    }
    for (const c of clusters) {
      if (c.length < 2) continue;
      groups.push([...c].sort((a, b) => keeperRank(b) - keeperRank(a) || a.firstSeenAt.getTime() - b.firstSeenAt.getTime()));
    }
  }
  return groups;
}

/**
 * Fusionne `dropId` dans `keepId` : sources, historique et mails passent à l'offre gardée ; son statut, sa lettre et son
 * annonce complète sont repris si l'offre gardée n'en a pas ; puis le doublon disparaît.
 */
export async function mergeJobs(prisma: PrismaClient, keepId: string, dropId: string): Promise<void> {
  const [keep, drop] = await Promise.all([
    prisma.job.findUniqueOrThrow({ where: { id: keepId }, include: { coverLetter: { select: { id: true } } } }),
    prisma.job.findUniqueOrThrow({ where: { id: dropId }, include: { coverLetter: { select: { id: true } } } }),
  ]);
  const adopt = {
    ...(statusRank(drop.status) > statusRank(keep.status) ? { status: drop.status } : {}),
    ...(!keep.notifiedAt && drop.notifiedAt ? { notifiedAt: drop.notifiedAt } : {}),
    ...(!keep.fullText && drop.fullText
      ? { fullText: drop.fullText, fullTextAt: drop.fullTextAt, fullExperienceYrs: drop.fullExperienceYrs, fullInfo: drop.fullInfo ?? undefined }
      : {}),
    ...(!keep.description.trim() && drop.description.trim() ? { description: drop.description } : {}),
    ...(keep.firstSeenAt > drop.firstSeenAt ? { firstSeenAt: drop.firstSeenAt } : {}),
  };
  await prisma.$transaction([
    prisma.jobSourceLink.updateMany({ where: { jobId: dropId }, data: { jobId: keepId } }),
    prisma.jobEvent.updateMany({ where: { jobId: dropId }, data: { jobId: keepId } }),
    prisma.applicationMail.updateMany({ where: { jobId: dropId }, data: { jobId: keepId } }),
    ...(!keep.coverLetter && drop.coverLetter ? [prisma.coverLetter.update({ where: { jobId: dropId }, data: { jobId: keepId } })] : []),
    prisma.notification.deleteMany({ where: { jobId: dropId } }),
    prisma.job.update({ where: { id: keepId }, data: adopt }),
    prisma.jobEvent.create({ data: { jobId: keepId, type: "MERGED", fromValue: dropId } }),
    prisma.job.delete({ where: { id: dropId } }),
  ]);
}

export type DedupeReport = { jobs: number; groups: Array<{ keep: string; drop: string[]; title: string; company: string | null }>; merged: number };

/**
 * Nettoie les doublons déjà en base : calcule la clé de chaque offre, repère les offres identiques et, avec `apply`,
 * les fusionne. Sans `apply`, ne change que les clés (rien n'est supprimé).
 */
export async function dedupeJobs(prisma: PrismaClient, opts: { apply: boolean } = { apply: false }): Promise<DedupeReport> {
  const rows: Row[] = await prisma.job.findMany({
    select: {
      id: true, title: true, company: true, city: true, department: true, status: true, firstSeenAt: true, fullText: true,
      coverLetter: { select: { id: true } },
      _count: { select: { mails: true } },
    },
  });
  const stored = new Map((await prisma.job.findMany({ select: { id: true, dedupeKey: true } })).map((j) => [j.id, j.dedupeKey]));
  const stale = rows.filter((r) => (dedupeKeyOf(r.company, r.title) ?? null) !== stored.get(r.id));
  for (let i = 0; i < stale.length; i += 200) {
    await prisma.$transaction(
      stale.slice(i, i + 200).map((r) => prisma.job.update({ where: { id: r.id }, data: { dedupeKey: dedupeKeyOf(r.company, r.title) } })),
    );
  }
  const groups = groupDuplicates(rows);
  let merged = 0;
  if (opts.apply) {
    for (const g of groups) {
      for (const dup of g.slice(1)) {
        await mergeJobs(prisma, g[0]!.id, dup.id);
        merged++;
      }
    }
  }
  return {
    jobs: rows.length,
    merged,
    groups: groups.map((g) => ({ keep: g[0]!.id, drop: g.slice(1).map((j) => j.id), title: g[0]!.title, company: g[0]!.company })),
  };
}
