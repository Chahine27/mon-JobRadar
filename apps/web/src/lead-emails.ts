import type { Lead } from "./types";

/** Entreprises envoyées dans un prompt (une IA avec recherche web trouve leur email de contact). */
/** 10 par prompt : au-delà, les IA cherchent moins bien pour chaque entreprise. */
export const MAX_PROMPT_COMPANIES = 10;

/**
 * Prompt à coller dans une IA qui sait chercher sur internet (ChatGPT, Claude, Perplexity…).
 * Le SIRET sert de clé : Job Radar range chaque email dans la bonne entreprise au retour.
 */
export function buildEmailPrompt(leads: Lead[]): string {
  const companies = leads.slice(0, MAX_PROMPT_COMPANIES).map((l) => ({
    siret: l.siret,
    nom: l.name,
    etablissement: l.officeName || undefined,
    ville: [l.postcode, l.city].filter(Boolean).join(" ") || undefined,
    secteur: l.nafLabel || undefined,
  }));
  return `Fais une recherche sur internet pour trouver l'adresse email de contact OU de recrutement de chacune de ces entreprises françaises.
Je veux leur envoyer une candidature spontanée (développeur, CDI).

Règles :
- Cherche sur le site officiel de l'entreprise (pages Contact, Recrutement, Carrières, Mentions légales), puis sur des annuaires professionnels sérieux.
- Préfère une adresse de recrutement (recrutement@, rh@, jobs@, careers@), sinon une adresse de contact générale (contact@, info@…).
- N'INVENTE RIEN : pas d'adresse devinée (ex. prenom.nom@ ou contact@ deviné à partir du nom de domaine). Si tu ne trouves pas d'adresse écrite quelque part, mets null.
- Vérifie que c'est bien la même entreprise (même nom ET même ville / SIRET) : en cas de doute, mets null.
- Indique l'adresse de la page où tu as trouvé l'email dans "source".
- Même sans email, donne le site officiel ("site") et, s'il existe, la page de candidature ou le formulaire de contact ("contact_url").
- Prends le temps de chercher pour CHAQUE entreprise (site officiel, mentions légales, page LinkedIn de l'entreprise, Pages Jaunes, societe.com) avant de mettre null.

Réponds UNIQUEMENT avec ce JSON (même ordre, un objet par entreprise, garde le SIRET tel quel), placé dans UN SEUL bloc de code (\`\`\`json … \`\`\`) pour que rien ne soit reformaté :
[{"siret": "…", "email": "…" ou null, "source": "https://…" ou null, "site": "https://…" ou null, "contact_url": "https://…" ou null}]

Dans ce bloc de code, écris les emails et les URL en TEXTE BRUT : jamais de lien Markdown ([texte](url)), pas de "mailto:", pas de lien cliquable. Rien avant, rien après le bloc de code.

Entreprises :
${JSON.stringify(companies, null, 2)}`;
}

export type EmailFound = { siret: string; email: string | null; source: string | null; site: string | null; contactUrl: string | null };

const url = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim() : null);

/** Lit la réponse de l'IA collée : accepte le JSON seul, ou entouré de texte / de \`\`\`json. */
export function parseEmailJson(text: string): EmailFound[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Aucun tableau JSON [ … ] trouvé dans le texte collé.");
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Le JSON collé est mal formé : recopie toute la réponse de l'IA.");
  }
  if (!Array.isArray(data)) throw new Error("Le JSON doit être une liste [ … ].");
  return data
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      siret: String(x.siret ?? "").replace(/\s/g, ""),
      email: typeof x.email === "string" && x.email.trim() ? x.email.trim() : null,
      source: url(x.source),
      site: url(x.site),
      contactUrl: url(x.contact_url ?? x.contactUrl),
    }))
    .filter((x) => /^\d{9,14}$/.test(x.siret));
}
