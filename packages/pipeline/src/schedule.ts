/** Règles de planification, sans base ni réseau (testables). */

export const ALLOWED_DAYS = [1, 3, 7, 14, 31] as const;
export type PublishedDays = (typeof ALLOWED_DAYS)[number];

/**
 * Période à interroger : juste assez pour couvrir le temps écoulé depuis la dernière collecte réussie.
 * Jamais collecté → 31 jours. Appli éteinte 2 jours → 3 jours.
 */
export function daysToFetch(lastSuccessAt: Date | null, now: Date): PublishedDays {
  if (!lastSuccessAt) return 31;
  const gapDays = (now.getTime() - lastSuccessAt.getTime()) / 86_400_000;
  return ALLOWED_DAYS.find((d) => gapDays <= d - 0.05) ?? 31;
}

/** Prochaine collecte : intervalle normal, doublé à chaque échec (5 → 10 → 20 → 40 min), remis à zéro après un succès. */
export function computeNextRunAt(now: Date, intervalMinutes: number, failures: number): Date {
  const factor = 2 ** Math.min(Math.max(failures, 0), 3);
  return new Date(now.getTime() + intervalMinutes * factor * 60_000);
}

export type SourceStateLite = { source: string; enabled: boolean; nextRunAt: Date };

export function dueSources(states: SourceStateLite[], now: Date): string[] {
  return states.filter((s) => s.enabled && s.nextRunAt.getTime() <= now.getTime()).map((s) => s.source);
}
