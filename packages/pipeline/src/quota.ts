/**
 * Adzuna : 250 appels / jour. On garde une marge (200) et on en déduit l'intervalle minimum
 * entre deux collectes, selon le nombre de recherches (recherches × zones du profil).
 */
export const ADZUNA_DAILY_BUDGET = 200;

export function adzunaMinIntervalMinutes(callsPerRun: number): number {
  const runsPerDay = Math.max(1, Math.floor(ADZUNA_DAILY_BUDGET / Math.max(1, callsPerRun)));
  return Math.ceil(1440 / runsPerDay);
}

export const JOOBLE_CHECK_MINUTES = 60;

/** Intervalle minimum imposé par les règles de chaque source (null = pas de contrainte). */
export function minIntervalFor(source: string, callsPerRun: number): number {
  if (source === "adzuna") return adzunaMinIntervalMinutes(callsPerRun);
  if (source === "company-careers") return 30;
  // Jooble : 500 appels à vie par clé gratuite. Le connecteur limite à un appel par créneau (8 h, 13 h, 18 h) ;
  // la source est donc vérifiée chaque heure et décide elle-même.
  if (source === "jooble") return JOOBLE_CHECK_MINUTES;
  // JobScraper : sites scrapés (pas d'API). En dessous de 15 min, risque de blocage de l'IP.
  if (source.startsWith("jobscraper:")) return 15;
  return 5;
}
