const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", ocirc: "ô", hellip: "…", ndash: "–", mdash: "—" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** HTML d'une annonce → texte lisible (le site n'affiche jamais de HTML venant d'une source). */
export function htmlToText(html: string): string {
  let s = html;
  // Greenhouse renvoie du HTML lui-même échappé (&lt;p&gt;…).
  if (/&lt;\/?[a-z]/i.test(s) && !/<[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(s)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Apostrophes perdues par l'outil de diffusion de l'employeur (« d?expérience », « s?inscrit », « mise en ?uvre ») :
 * le « ? » (ou « � ») arrive tel quel de la source (Indeed, Adzuna…). Seulement après une élision française
 * (d, l, qu, jusqu…) écrite comme un mot à part et devant une voyelle : une adresse « jobs?id= » n'est pas touchée.
 */
export function repairApostrophes(s: string): string {
  return s
    .replace(/(?<![\p{L}\p{N}/=&?._-])(jusqu|lorsqu|puisqu|quoiqu|qu|[cdjlmnst])[?�](?=[aeiouyhàâäéèêëîïôöûü])/giu, "$1’")
    .replace(/(?<![\p{L}\p{N}])[?�](uvre|uvres)\b/gu, "œ$1");
}
