import type { z } from "zod";

/** Erreurs de validation d'un corps de requête, telles que le site les affiche (champ, message). */
export const issuesOf = (e: z.ZodError) => e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
