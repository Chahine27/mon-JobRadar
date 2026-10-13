import { CV_RULES_VERSION, buildJobForCv, hashOf, type JobForCv, tailorCv, type TailoredCvDraft } from "@job-radar/cv-tailor";
import { type CvEngine, fitToPage } from "@job-radar/cv-render";
import { type CvMaster, CvMasterSchema, type CvOverrides, isAbridged, type TemplateId } from "@job-radar/shared";
import { analysisFitsJob, readVerdict } from "./ai-context";
import type { JobRow, Stores, TailoredCvRow } from "./stores";

/**
 * CV adapté : lecture de l'offre (analyse IA si elle est à jour), choix des morceaux, ajustement à une page.
 * Partagé par les routes et la commande « pnpm cv:test ».
 */
export function createCvService(stores: Stores, opts: { aiModel?: string | undefined; engine?: CvEngine | undefined }) {
  async function jobForCv(userId: string, job: JobRow): Promise<JobForCv> {
    let analysis: { required: string[]; bonus: string[] } | null = null;
    const profile = await stores.profiles.get(userId);
    if (opts.aiModel && !isAbridged(job)) {
      const latest = await stores.analyses.latest(job.id);
      const v = latest && analysisFitsJob(latest, job, opts.aiModel) ? readVerdict(latest.result) : null;
      if (v) analysis = { required: v.required, bonus: v.bonus };
    }
    // Compétences du profil : ajoutées à la liste du CV quand l'offre les cite (tu les as déclarées).
    return buildJobForCv({ title: job.title, description: job.description, abridged: isAbridged(job), analysis, profileSkills: profile?.profile.skills ?? [] });
  }

  /** CV complet valide, ou la raison pour laquelle on ne peut pas adapter. */
  async function master(userId: string): Promise<{ master: CvMaster; hash: string } | { error: "NO_CV_MASTER" | "CV_MASTER_INVALID" }> {
    const rec = await stores.cvMasters.get(userId);
    if (!rec) return { error: "NO_CV_MASTER" };
    const parsed = CvMasterSchema.safeParse(rec.master);
    // Empreinte recalculée sur le CV relu (l'ordre des clés JSON n'est pas gardé par la base).
    return parsed.success ? { master: parsed.data, hash: hashOf(parsed.data) } : { error: "CV_MASTER_INVALID" };
  }

  /** Raisons pour lesquelles un CV adapté enregistré est périmé (vide = à jour). */
  function staleReasons(row: TailoredCvRow, masterHash: string, job: JobForCv): string[] {
    return [
      ...(row.rulesVersion !== CV_RULES_VERSION ? ["les règles de choix ont changé"] : []),
      ...(row.masterHash !== masterHash ? ["ton CV complet a changé"] : []),
      ...(row.jobHash !== hashOf(job) ? ["l'offre a changé"] : []),
    ];
  }

  /** Brouillon calculé (et ajusté à une page si un navigateur est disponible). */
  async function compute(m: CvMaster, job: JobForCv, template: TemplateId, overrides: CvOverrides): Promise<TailoredCvDraft> {
    const draft = tailorCv(m, job, template, overrides);
    if (!opts.engine) return draft;
    try {
      return await fitToPage(draft, m, job, overrides, opts.engine);
    } catch (e) {
      return { ...draft, warnings: [...draft.warnings, `Ajustement à une page pas vérifié : ${(e as Error).message}`] };
    }
  }

  return { jobForCv, master, staleReasons, compute };
}
export type CvService = ReturnType<typeof createCvService>;
