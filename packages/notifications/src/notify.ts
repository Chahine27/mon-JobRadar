import type { PrismaClient } from "@job-radar/db";
import { DEFAULT_RULES, type ScorableJob, type ScoringRules, scoreJob, scoringInputFromJob } from "@job-radar/scoring";
import { isAbridged, type Profile } from "@job-radar/shared";
import { REMOTE_LABEL, salaryLabel } from "./format";
import type { AlertKind, Channel, JobAlert, Notice, Notifier } from "./types";

export type CandidateJob = ScorableJob & {
  id: string;
  company: string | null;
  city: string | null;
  sources: Array<{ source: string }>;
  fullTextAt: Date | null;
};

export type NotificationSettingsLite = { emailEnabled: boolean; pushEnabled: boolean };

/** Accès base pour les notifications (interface → testable sans PostgreSQL). */
export interface NotifyRepo {
  settings(): Promise<NotificationSettingsLite>;
  /** Offres jamais notifiées, apparues depuis `since`. */
  candidates(since: Date): Promise<CandidateJob[]>;
  /** Réserve (offre, canal, type). false si déjà fait → anti-double notification. */
  claim(jobId: string, channel: Channel, kind: AlertKind): Promise<boolean>;
  finish(jobId: string, channel: Channel, kind: AlertKind, status: "sent" | "failed", error?: string): Promise<void>;
  /** Un mail/push de ce type a-t-il été envoyé pour cette offre (sur un canal au moins) ? */
  wasSent(jobId: string, kind: AlertKind): Promise<boolean>;
  markNotified(jobIds: string[]): Promise<void>;
}

export type NotifyResult = { candidates: number; matched: number; sent: Partial<Record<Channel, number>>; errors: string[] };

export type AlertJob = Pick<
  CandidateJob,
  "id" | "title" | "company" | "city" | "department" | "contractType" | "salaryMin" | "salaryMax" | "remoteType"
>;
export type AlertScore = { final: number; matchedSkills: string[]; missingSkills: string[] };

export function toAlert(job: AlertJob, score: AlertScore, appUrl: string, kind: AlertKind): JobAlert {
  return {
    kind,
    jobId: job.id,
    title: job.title,
    company: job.company,
    place: [job.city, job.department ? `(${job.department})` : null].filter(Boolean).join(" ") || null,
    score: score.final,
    contract: job.contractType,
    salary: salaryLabel(job.salaryMin, job.salaryMax),
    remote: REMOTE_LABEL[job.remoteType] ?? null,
    skills: score.matchedSkills,
    missing: score.missingSkills,
    url: new URL(`/offres/${encodeURIComponent(job.id)}`, appUrl).href,
  };
}

type Match = { id: string; alert: JobAlert };

function activeNotifiers(notifiers: Notifier[], settings: NotificationSettingsLite) {
  return notifiers.filter((n) => n.isConfigured() && (n.channel === "email" ? settings.emailEnabled : settings.pushEnabled));
}

/** Envoie un lot (même type) sur chaque canal actif ; un canal en panne n'empêche pas les autres. */
async function deliver(repo: NotifyRepo, active: Notifier[], matches: Match[], result: NotifyResult, log: (msg: string) => void) {
  for (const notifier of active) {
    // Aucun navigateur abonné : canal sauté sans rien réserver (sinon une notification « en échec » par offre, et
    // l'offre ne serait plus jamais annoncée sur ce canal une fois un navigateur abonné).
    if (notifier.hasRecipients && !(await notifier.hasRecipients())) continue;
    const claimed = [];
    for (const m of matches) if (await repo.claim(m.id, notifier.channel, m.alert.kind)) claimed.push(m);
    if (claimed.length === 0) continue;
    const kind = claimed[0]!.alert.kind;
    try {
      await notifier.sendAlerts(claimed.map((m) => m.alert));
      for (const m of claimed) await repo.finish(m.id, notifier.channel, kind, "sent");
      result.sent[notifier.channel] = (result.sent[notifier.channel] ?? 0) + claimed.length;
      log(`Notification ${notifier.channel} (${kind}) : ${claimed.length} offre(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const m of claimed) await repo.finish(m.id, notifier.channel, kind, "failed", msg);
      result.errors.push(`${notifier.channel} : ${msg}`);
      log(`Notification ${notifier.channel} en échec : ${msg}`);
    }
  }
}

/**
 * Après une collecte : annonce les NOUVELLES offres au-dessus du seuil du profil.
 * Annonce complète → « à postuler ». Annonce incomplète (extrait) → « à compléter » : son score n'est
 * que provisoire. Une fois l'annonce collée, aucun mail : l'offre est déjà sous tes yeux.
 * Une offre retrouvée plus tard ne redéclenche rien (README §11) : table Notification unique (offre, canal, type) + Job.notifiedAt.
 */
export async function notifyNewMatches(opts: {
  repo: NotifyRepo;
  notifiers: Notifier[];
  profile: Profile;
  since: Date;
  appUrl: string;
  rules?: ScoringRules;
  /**
   * Score corrigé par l'IA des offres qu'elle a vérifiées. Fourni (IA branchée) : une annonce complète
   * n'est annoncée qu'une fois vérifiée, avec ce score ; sinon elle attend la collecte suivante.
   */
  aiScores?: Map<string, number>;
  log?: (msg: string) => void;
}): Promise<NotifyResult> {
  const { repo, profile, log = () => {} } = opts;
  const active = activeNotifiers(opts.notifiers, await repo.settings());
  const result: NotifyResult = { candidates: 0, matched: 0, sent: {}, errors: [] };
  if (active.length === 0) return result;

  const candidates = await repo.candidates(opts.since);
  result.candidates = candidates.length;
  const matches = candidates
    .flatMap((job) => {
      const score = scoreJob(scoringInputFromJob(job), profile, opts.rules ?? DEFAULT_RULES);
      if (!opts.aiScores || isAbridged(job)) return [{ job, score }]; // extrait : l'IA ne le vérifie pas
      const ai = opts.aiScores.get(job.id);
      return ai === undefined ? [] : [{ job, score: { ...score, final: ai } }];
    })
    .filter(({ score }) => !score.hidden && score.final >= profile.minScoreForNotification)
    .sort((a, b) => b.score.final - a.score.final)
    .map(({ job, score }): Match => ({
      id: job.id,
      alert: toAlert(job, score, opts.appUrl, isAbridged(job) ? "complete" : "apply"),
    }));
  result.matched = matches.length;
  if (matches.length === 0) return result;

  await deliver(repo, active, matches.filter((m) => m.alert.kind === "apply"), result, log);
  await deliver(repo, active, matches.filter((m) => m.alert.kind === "complete"), result, log);
  await repo.markNotified(matches.map((m) => m.id));
  return result;
}

/** Envoie une information ponctuelle sur les canaux actifs ; un canal en panne n'empêche pas les autres. */
export async function notifyNotice(opts: {
  repo: Pick<NotifyRepo, "settings">;
  notifiers: Notifier[];
  notice: Notice;
  log?: (msg: string) => void;
}): Promise<void> {
  const { log = () => {} } = opts;
  for (const n of activeNotifiers(opts.notifiers, await opts.repo.settings())) {
    if (!n.sendNotice) continue;
    try {
      await n.sendNotice(opts.notice);
    } catch (err) {
      log(`Notification ${n.channel} en échec : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function createPrismaNotifyRepo(prisma: PrismaClient): NotifyRepo {
  return {
    async settings() {
      const s = await prisma.notificationSettings.findUnique({ where: { id: "singleton" } });
      return { emailEnabled: s?.emailEnabled ?? true, pushEnabled: s?.pushEnabled ?? true };
    },
    async candidates(since) {
      const rows = await prisma.job.findMany({
        where: { firstSeenAt: { gte: since }, notifiedAt: null, status: "NEW" },
        select: {
          id: true,
          title: true,
          company: true,
          city: true,
          description: true,
          technologies: true,
          contractType: true,
          experienceMinYrs: true,
          salaryMin: true,
          salaryMax: true,
          department: true,
          remoteType: true,
          fullTextAt: true,
          sources: { select: { source: true } },
          travel: { select: { minutes: true, mode: true } },
        },
      });
      return rows.map(({ travel, ...j }) => ({ ...j, travelMinutes: travel?.minutes ?? null, travelMode: travel?.mode ?? null }));
    },
    async claim(jobId, channel, kind) {
      try {
        await prisma.notification.create({ data: { jobId, channel, kind, status: "pending" } });
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") return false; // déjà notifiée sur ce canal
        throw err;
      }
    },
    async finish(jobId, channel, kind, status, error) {
      await prisma.notification.update({
        where: { jobId_channel_kind: { jobId, channel, kind } },
        data: { status, error: error?.slice(0, 1000) ?? null },
      });
    },
    async wasSent(jobId, kind) {
      return (await prisma.notification.count({ where: { jobId, kind, status: "sent" } })) > 0;
    },
    async markNotified(jobIds) {
      if (!jobIds.length) return;
      const now = new Date();
      await prisma.job.updateMany({ where: { id: { in: jobIds } }, data: { notifiedAt: now } });
      await prisma.jobEvent.createMany({ data: jobIds.map((jobId) => ({ jobId, type: "NOTIFIED" })) });
    },
  };
}
