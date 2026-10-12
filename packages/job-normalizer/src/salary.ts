import { parseSalaryText } from "@job-radar/scoring";

/**
 * Lit un libellé de salaire France Travail et le convertit en brut annuel.
 *   « Annuel de 38000.00 Euros à 42000.00 Euros sur 12 mois »
 *   « Mensuel de 2500,00 Euros sur 13 mois »
 *   « Horaire de 11.88 Euros »
 * Libellé absent ou incompréhensible → null (jamais deviné).
 */
export type AnnualSalary = { min: number; max: number };

const HOURS_PER_MONTH = 151.67; // durée légale : 35 h/semaine

export function parseFtSalary(label: string | null | undefined): AnnualSalary | null {
  if (!label) return null;
  const text = label.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const period = /annuel/.test(text) ? "year" : /mensuel/.test(text) ? "month" : /horaire/.test(text) ? "hour" : null;
  if (!period) return null;

  const amounts = [...text.matchAll(/(\d[\d\s]*(?:[.,]\d+)?)\s*euros?/g)]
    .map((m) => Number(m[1]!.replace(/\s/g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (amounts.length === 0) return null;

  const monthsMatch = text.match(/sur\s+(\d+(?:[.,]\d+)?)\s*mois/);
  const months = monthsMatch ? Number(monthsMatch[1]!.replace(",", ".")) : 12;

  const toYear = (n: number) => {
    if (period === "year") return n;
    if (period === "month") return n * months;
    return n * HOURS_PER_MONTH * months;
  };
  const values = amounts.slice(0, 2).map((n) => Math.round(toYear(n)));
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Garde-fou : un « annuel » à 3 000 € est une erreur de saisie → on ne l'utilise pas.
  if (min < 8000 || max > 500_000) return null;
  return { min, max };
}

/** Salaire en texte libre (Jooble, annonce collée…) : même lecture que le score (voir @job-radar/scoring). */
export const parseLooseSalary = (label: string | null | undefined): AnnualSalary | null => parseSalaryText(label);
