import type { PrismaClient } from "@job-radar/db";
import { dedupeKeyOf, normalize, type OfferSalary, sameAdText, sameOffer, sameSalary } from "@job-radar/job-normalizer";
import { jobFields } from "./ingest";

/** Offre déjà en base, avec ce qui compte pour choisir celle qu'on garde. */
type Row = OfferSalary & {
  id: string;
  title: string;
  company: string | null;
  city: string | null;
  department: string | null;
  description: string;
  sources: Array<{ source: string }>;
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

/** Une source commune (hors ajout manuel) : seulement si c'est le même texte d'annonce et un salaire compatible (cf. sameAdText, sameSalary). */
function sameSourceFits(a: Row, b: Row): boolean {
  const shared = a.sources.some((s) => s.source !== "manual" && b.sources.some((t) => t.source === s.source));
  return !shared || (sameAdText(a.description, b.description) && sameSalary(a, b));
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
      const home = clusters.find((c) => sameOffer(c[0]!, r) && c.every((o) => sameSourceFits(o, r)));
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
      description: true, salaryMin: true, salaryMax: true, salaryPeriod: true, sources: { select: { source: true } },
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

/**
 * Défait les fusions à tort : une offre qui porte plusieurs annonces d'une même source au texte différent (agence qui
 * publie le même titre dans la même ville pour plusieurs clients, ou même texte à un autre salaire). Chaque annonce différente redevient une offre, lue
 * depuis ses données brutes ; l'offre d'origine garde la plus ancienne (et ton statut, ta lettre, tes mails).
 * Lancée au démarrage de l'API ; rien à faire si tout est déjà propre.
 * ponytail: la description de l'offre d'origine n'est pas recalculée si elle venait d'une annonce déplacée (rare).
 */
export async function splitMergedAds(opts: { prisma: PrismaClient; apply?: boolean; log?: (m: string) => void; now?: Date }): Promise<{ jobs: number; created: number }> {
  const { prisma, apply = true, log = () => {}, now = new Date() } = opts;
  const jobs = await prisma.job.findMany({
    where: { sources: { some: { source: { not: "manual" } } } },
    select: {
      id: true, status: true,
      sources: { select: { id: true, source: true, sourceJobId: true, rawData: true, firstSeenAt: true }, orderBy: { firstSeenAt: "asc" } },
    },
  });
  let touched = 0;
  let created = 0;
  for (const job of jobs) {
    const bySource = new Map<string, typeof job.sources>();
    for (const l of job.sources) if (l.source !== "manual") (bySource.get(l.source) ?? bySource.set(l.source, []).get(l.source)!).push(l);
    let split = false;
    for (const links of bySource.values()) {
      if (links.length < 2) continue;
      const read = links.map((l) => ({ l, n: normalize({ source: l.source, sourceJobId: l.sourceJobId, data: l.rawData, collectedAt: l.firstSeenAt }) }));
      // Annonces regroupées par texte et salaire ; le 1er groupe (la plus ancienne) reste sur l'offre.
      const clusters: Array<typeof read> = [];
      for (const r of read) {
        const home = clusters.find((c) => sameAdText(c[0]!.n?.description ?? "", r.n?.description ?? "") && (!c[0]!.n || !r.n || sameSalary(c[0]!.n, r.n)));
        if (home) home.push(r);
        else clusters.push([r]);
      }
      for (const c of clusters.slice(1)) {
        const first = c[0]!;
        if (!first.n) continue;
        split = true;
        created++;
        if (!apply) continue;
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.job.create({
            data: {
              ...jobFields(first.n!),
              fingerprint: `src:${first.l.source}:${first.l.sourceJobId}`,
              firstSeenAt: first.l.firstSeenAt,
              lastSeenAt: now,
              // Déjà vue avec l'offre d'origine : ni « Nouvelle » ni notification, sauf si l'origine était encore nouvelle.
              status: job.status === "NEW" ? "NEW" : "SEEN",
              notifiedAt: now,
              events: { create: { type: "SPLIT", fromValue: job.id } },
            },
          });
          await tx.jobSourceLink.updateMany({ where: { id: { in: c.map((r) => r.l.id) } }, data: { jobId: fresh.id } });
        });
      }
    }
    if (split) touched++;
  }
  if (created) log(`Annonces séparées : ${created} offre(s) recréée(s) depuis ${touched} offre(s) fusionnée(s) à tort`);
  return { jobs: touched, created };
}
