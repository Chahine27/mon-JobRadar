import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@job-radar/db";
import { MANUAL_SOURCE, type NormalizedJob, normalize } from "@job-radar/job-normalizer";
import { ingestJob } from "./ingest";

export { analyzeJobText, cleanFullText, cleanPastedText, type JobTextAnalysis } from "@job-radar/job-normalizer";

/** Offre du formulaire → offre normalisée (null si le formulaire est invalide). */
export function buildManualJob(input: unknown, id = `m-${randomUUID()}`): NormalizedJob | null {
  return normalize({ source: MANUAL_SOURCE, sourceJobId: id, data: input, collectedAt: new Date() });
}

export type ManualSaveResult = {
  jobId: string;
  /** L'offre existait déjà (même entreprise + titre + ville) : la tienne y est rattachée. */
  duplicate: boolean;
  /** Autres sources de cette offre (ex. « france-travail ») quand elle existait déjà. */
  otherSources: string[];
};

/**
 * Enregistre une offre ajoutée à la main, puis la passe en « Sauvegardée » (si elle était Nouvelle / Vue)
 * pour la conserver : jamais expirée, jamais masquée, jamais notifiée.
 */
export async function saveManualJob(prisma: PrismaClient, n: NormalizedJob): Promise<ManualSaveResult> {
  const outcome = await ingestJob(prisma, n);
  const link = await prisma.jobSourceLink.findUniqueOrThrow({
    where: { source_sourceJobId: { source: n.source, sourceJobId: n.sourceJobId } },
    select: { jobId: true, job: { select: { status: true, sources: { select: { source: true } } } } },
  });
  const { status } = link.job;
  if (status === "NEW" || status === "SEEN") {
    await prisma.$transaction([
      prisma.job.update({ where: { id: link.jobId }, data: { status: "SAVED" } }),
      prisma.jobEvent.create({ data: { jobId: link.jobId, type: "STATUS_CHANGED", fromValue: status, toValue: "SAVED" } }),
    ]);
  }
  return {
    jobId: link.jobId,
    duplicate: outcome === "duplicate",
    otherSources: [...new Set(link.job.sources.map((s) => s.source).filter((s) => s !== MANUAL_SOURCE))],
  };
}

/**
 * Retire une offre ajoutée à la main. Si une autre source l'a aussi trouvée, seul l'ajout manuel est retiré
 * (l'offre reste, avec son suivi).
 */
export async function removeManualJob(prisma: PrismaClient, jobId: string): Promise<"deleted" | "unlinked" | "not_found" | "not_manual"> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { sources: { select: { id: true, source: true } } } });
  if (!job) return "not_found";
  const manual = job.sources.filter((s) => s.source === MANUAL_SOURCE);
  if (manual.length === 0) return "not_manual";
  if (manual.length === job.sources.length) {
    await prisma.job.delete({ where: { id: jobId } });
    return "deleted";
  }
  await prisma.jobSourceLink.deleteMany({ where: { id: { in: manual.map((s) => s.id) } } });
  return "unlinked";
}
