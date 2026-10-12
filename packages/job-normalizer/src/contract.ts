import { normalizeContract } from "@job-radar/scoring";
import { comparable } from "./text";

/** Types de contrat des outils de recrutement / Adzuna. « Temps plein » seul ne dit rien du contrat → null. */
export function contractFromLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const direct = normalizeContract(label);
  if (direct) return direct;
  const t = comparable(label);
  if (/permanent|indetermin|\bcdi\b/.test(t)) return "CDI";
  if (/apprenti|alternan|work study/.test(t)) return "ALTERNANCE";
  if (/intern|stage|stagiaire/.test(t)) return "STAGE";
  if (/freelance|independ|contractor/.test(t)) return "FREELANCE";
  if (/contract|temporary|fixed term|determin|\bcdd\b/.test(t)) return "CDD";
  return null;
}

/** Salaire → brut annuel en euros. Autre devise ou période inconnue → null. */
export function annualEuros(
  s: { min: number | null; max: number | null; currency: string | null; period: string | null } | null,
): { min: number; max: number } | null {
  if (!s || (s.min === null && s.max === null)) return null;
  if (s.currency && s.currency.toUpperCase() !== "EUR") return null;
  const p = (s.period ?? "").toLowerCase();
  const factor = /year|annual|an/.test(p) ? 1 : /month|mois/.test(p) ? 12 : null;
  if (factor === null) return null;
  const min = Math.round((s.min ?? s.max!) * factor);
  const max = Math.round((s.max ?? s.min!) * factor);
  if (min < 8000 || max > 500_000) return null;
  return { min, max };
}
