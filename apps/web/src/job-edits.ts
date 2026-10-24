import type { JobEdits } from "./types";

const NUMBERS = ["salaryMin", "salaryMax", "experienceMinYrs"];

/**
 * Corrections à envoyer : les précédentes, plus chaque champ changé dans le formulaire.
 * `before` : valeurs affichées à l'ouverture du formulaire. Un champ vidé reprend la valeur de la source.
 * Les champs `type="number"` arrivent en nombre (v-model de Vue), les autres en texte.
 */
export function mergeEdits(form: Record<string, string | number>, before: Record<string, string>, previous: JobEdits | null): JobEdits {
  const edits: Record<string, string | number> = { ...previous };
  for (const [k, v] of Object.entries(form)) {
    const value = String(v).trim();
    if (value === before[k]) continue;
    if (!value) delete edits[k];
    else edits[k] = NUMBERS.includes(k) ? Number(value) : value;
  }
  return edits as JobEdits;
}
