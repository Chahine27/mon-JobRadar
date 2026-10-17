/**
 * « Ajouter une offre » depuis un lien : le serveur télécharge la page de l'offre et en tire le même paquet
 * que l'extension navigateur (texte de l'annonce + titre, entreprise, lieu, contrat, salaire quand la page les donne).
 * Lecture : fiche structurée JobPosting de la page, sinon son texte ; LinkedIn passe par sa page publique d'offre.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { buildPayload, htmlToText, indeedJobUrl, linkedinJobUrl, type PagePayload } from "../../../extension/lib/extract.js";

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const RETRY_MS = 1500;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
};

export class UrlReadError extends Error {}

/** Adresse interne (serveur, réseau privé, Tailscale…) : jamais téléchargée. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlReadError("Ce lien n'est pas une adresse web valide.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UrlReadError("Seuls les liens http(s) sont acceptés.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (!ips.length) throw new UrlReadError("Site introuvable : vérifie le lien.");
  // ponytail: contrôle DNS puis fetch séparés (rebinding DNS possible en théorie) ; épingler l'IP via un Agent undici si besoin.
  if (ips.some(isPrivateAddress)) throw new UrlReadError("Ce lien pointe vers une adresse interne : refusé.");
  return url;
}

/** Télécharge une page HTML publique (redirections vérifiées une à une, taille et durée limitées). */
export async function fetchPage(raw: string, fetchImpl: typeof fetch = fetch): Promise<{ url: string; html: string }> {
  let url = await assertPublicUrl(raw);
  let retries = 2;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: HEADERS, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new UrlReadError("Le site ne répond pas.");
    }
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = await assertPublicUrl(new URL(next, url).toString());
      continue;
    }
    // LinkedIn refuse par moments (429) puis répond normalement : nouvel essai un peu plus tard.
    if (res.status === 429 && retries > 0) {
      await new Promise((r) => setTimeout(r, (3 - retries--) * RETRY_MS));
      hop--;
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 999) {
      throw new UrlReadError("Ce site bloque la lecture automatique : utilise l'extension ou colle le texte de l'annonce.");
    }
    if (!res.ok) throw new UrlReadError(`Le site a répondu ${res.status} : l'offre n'existe plus ou le lien est faux.`);
    if (!/html|xml/i.test(res.headers.get("content-type") ?? "html")) throw new UrlReadError("Ce lien n'est pas une page web.");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new UrlReadError("Page trop lourde.");
    return { url: url.toString(), html: new TextDecoder().decode(buf) };
  }
  throw new UrlReadError("Trop de redirections.");
}

const first = (html: string, re: RegExp) => htmlToText(html.match(re)?.[1] ?? "");
const byClass = (html: string, cls: string) => first(html, new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</(?:h\\d|a|span|div|section)>`));

/** Page publique d'une offre LinkedIn (jobs-guest) → paquet. */
export function linkedinPayload(url: string, html: string): PagePayload | null {
  const title = byClass(html, "topcard__title");
  const company = byClass(html, "topcard__org-name-link") || byClass(html, "topcard__flavor");
  const location = byClass(html, "topcard__flavor--bullet");
  const desc = htmlToText(html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "");
  if (!title || desc.length < 100) return null;
  const criteria = [...html.matchAll(/job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>[\s\S]*?job-criteria-text[^>]*>([\s\S]*?)<\/span>/g)]
    .map((m) => `${htmlToText(m[1])} : ${htmlToText(m[2])}`)
    .join("\n");
  const text = `${[title, company, location, criteria].filter(Boolean).join("\n")}\n\n${desc}`;
  return {
    url,
    source: "www.linkedin.com",
    text: text.slice(0, 30_000),
    hints: { title: title.slice(0, 200), company: company.slice(0, 150) || null, location: null, contractType: null, salaryMin: null, salaryMax: null },
  };
}

/** Page HTML quelconque → paquet (même lecture que l'extension : fiche JobPosting, sinon texte de la page). */
export function pagePayload(url: string, html: string): PagePayload {
  const jsonLd = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html).replace(
    /<(script|style|noscript|svg|nav|footer|form|iframe|template)\b[\s\S]*?<\/\1>/gi,
    " ",
  );
  return buildPayload({
    url,
    host: new URL(url).hostname,
    pageTitle: first(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    h1: first(body, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    jsonLd,
    mainText: htmlToText(body),
  });
}

/** Lien d'offre → paquet pour l'écran « Ajouter une offre ». */
export async function readJobFromUrl(raw: string, fetchImpl: typeof fetch = fetch): Promise<PagePayload> {
  // Texte partagé depuis un téléphone (« Regarde cette offre : https://… ») : on garde le premier lien.
  const clean = indeedJobUrl(linkedinJobUrl(raw.match(/https?:\/\/\S+/i)?.[0] ?? raw.trim()));
  const id = /linkedin\.com\/jobs\/view\/(\d+)/.exec(clean)?.[1];
  if (id) {
    // Page publique de l'offre : accessible sans compte, contrairement à linkedin.com/jobs/view.
    const page = await fetchPage(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, fetchImpl);
    const payload = linkedinPayload(clean, page.html);
    if (!payload) throw new UrlReadError("Offre LinkedIn illisible (supprimée ou réservée aux membres) : utilise l'extension ou colle le texte.");
    return payload;
  }
  const page = await fetchPage(clean, fetchImpl);
  const payload = pagePayload(page.url, page.html);
  if (payload.text.length < 200) {
    throw new UrlReadError("Aucune annonce trouvée sur cette page (site qui s'affiche en JavaScript ?) : utilise l'extension ou colle le texte.");
  }
  return payload;
}
