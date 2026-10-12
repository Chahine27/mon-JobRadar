import type { LetterKit } from "@job-radar/shared";

/** Intitulé proposé par défaut dans une candidature spontanée. */
export const DEFAULT_SPONTANEOUS_TITLE = "Développeur full stack";

/** Téléphone lu dans l'en-tête des lettres (« 06 12 34 56 78 »). */
function phoneOf(header: string): string | null {
  return header.split("\n").map((l) => l.trim()).find((l) => /^(\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}$/.test(l)) ?? null;
}

/** Objet et message du mail, écrits par le code (pas par l'IA) : courts, sans surprise, modifiables avant l'envoi. */
export function defaultMail(kit: Pick<LetterKit, "signature" | "header">, company: string, title: string) {
  const who = kit.signature.trim();
  const phone = phoneOf(kit.header);
  const subject = `Candidature spontanée – ${title}${who ? ` – ${who}` : ""}`;
  const message = [
    "Madame, Monsieur,",
    "",
    `Je vous adresse ma candidature spontanée pour un poste de ${title.charAt(0).toLowerCase()}${title.slice(1)} en CDI chez ${company}.`,
    "Vous trouverez ci-joint mon CV et ma lettre de motivation.",
    "",
    "Je serais heureux d'échanger avec vous à ce sujet.",
    "",
    "Bien cordialement,",
    who,
    ...(phone ? [phone] : []),
  ].join("\n");
  return { subject, message };
}
