/**
 * Job Radar — extension navigateur : transforme ce qui a été relevé sur la page d'une offre
 * (données structurées JobPosting, titre, bloc de description…) en un paquet pour l'écran « Ajouter une offre ».
 * Fonctions pures (testées dans extract.test.js). Aucune donnée n'est envoyée ailleurs que vers TON Job Radar.
 */

const MAX_TEXT = 30000;

const clean = (s) =>
  String(s ?? "")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** HTML de la description (données structurées) → texte lisible, sans navigateur. */
export function htmlToText(html) {
  return clean(
    String(html ?? "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "\n* ")
      .replace(/<\/\s*(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&#039;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))),
  );
}

/** Trouve l'offre (@type JobPosting) dans les blocs <script type="application/ld+json"> de la page. */
export function findJobPosting(rawBlocks) {
  const visit = (node) => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const f = visit(n);
        if (f) return f;
      }
      return null;
    }
    const type = node["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return node;
    return visit(node["@graph"]);
  };
  for (const raw of rawBlocks ?? []) {
    try {
      const found = visit(JSON.parse(raw));
      if (found) return found;
    } catch {
      /* bloc illisible : ignoré */
    }
  }
  return null;
}

function departmentOf(postalCode) {
  const pc = String(postalCode ?? "").trim();
  if (!/^\d{5}$/.test(pc)) return null;
  if (pc.startsWith("97")) return pc.slice(0, 3);
  if (pc.startsWith("20")) return Number(pc) < 20200 ? "2A" : "2B";
  return pc.slice(0, 2);
}

function locationOf(job) {
  const places = Array.isArray(job.jobLocation) ? job.jobLocation : job.jobLocation ? [job.jobLocation] : [];
  for (const p of places) {
    const a = p?.address ?? {};
    const city = typeof a.addressLocality === "string" ? a.addressLocality.trim() : "";
    const dep = departmentOf(a.postalCode);
    if (/^paris\b/i.test(city) || (!city && dep === "75")) return "Paris (75)";
    if (city && dep) return `${city} (${dep})`;
    if (city) return city;
  }
  return null;
}

const CONTRACTS = {
  CDI: "CDI",
  CDD: "CDD",
  STAGE: "STAGE",
  INTERN: "STAGE",
  INTERNSHIP: "STAGE",
  ALTERNANCE: "ALTERNANCE",
  APPRENTISSAGE: "ALTERNANCE",
  FREELANCE: "FREELANCE",
  CONTRACTOR: "FREELANCE",
  INTERIM: "INTERIM",
};

function contractOf(job) {
  const values = Array.isArray(job.employmentType) ? job.employmentType : [job.employmentType];
  for (const v of values) {
    const key = String(v ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    if (CONTRACTS[key]) return CONTRACTS[key];
  }
  return null; // FULL_TIME / PART_TIME ne disent rien du contrat
}

function salaryOf(job) {
  const s = job.baseSalary;
  if (!s || typeof s !== "object") return null;
  if (s.currency && String(s.currency).toUpperCase() !== "EUR") return null;
  const v = typeof s.value === "object" && s.value ? s.value : { value: s.value };
  const unit = String(v.unitText ?? s.unitText ?? "YEAR").toUpperCase();
  const factor = unit === "YEAR" ? 1 : unit === "MONTH" ? 12 : null;
  if (!factor) return null;
  const num = (x) => (typeof x === "number" ? x : typeof x === "string" && x.trim() ? Number(x.replace(/[\s,]/g, "")) : NaN);
  let min = num(v.minValue ?? v.value);
  let max = num(v.maxValue ?? v.value);
  if (!Number.isFinite(min) && Number.isFinite(max)) min = max;
  if (!Number.isFinite(max) && Number.isFinite(min)) max = min;
  if (!Number.isFinite(min)) return null;
  min = Math.round(min * factor);
  max = Math.round(max * factor);
  if (min < 8000 || max > 500000) return null;
  return { min, max };
}

/** « Titre | Entreprise | LinkedIn » (titre d'onglet LinkedIn). */
function fromLinkedInTitle(pageTitle) {
  const parts = String(pageTitle ?? "")
    .replace(/^\(\d+\)\s*/, "")
    .split(" | ")
    .map((p) => p.trim());
  if (parts.length >= 3 && /linkedin/i.test(parts[parts.length - 1])) return { title: parts[0], company: parts[1] };
  return {};
}

const short = (s, max) => {
  const t = clean(s).split("\n")[0].trim();
  return t && t.length <= max ? t : null;
};

/**
 * Haut de la page, avant la description (HelloWork, Welcome to the Jungle…) : c'est là que le site affiche
 * « Paris - 75 · CDI », « Télétravail partiel », le salaire… Ces infos ne sont pas toujours dans la fiche structurée.
 */
export function headerZone(mainText, body, strict = false) {
  const main = clean(mainText);
  if (!main) return "";
  const firstLine = clean(body)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 20);
  const needle = firstLine ? firstLine.slice(0, 40) : "";
  const idx = needle ? main.indexOf(needle) : -1;
  if (idx <= 0 && strict) return "";
  return (idx > 0 ? main.slice(Math.max(0, idx - 3000), idx) : main.slice(0, 1500)).trim();
}

// ───── Indeed : la page de recherche contient la liste des offres ET l'offre affichée à droite ─────

const INDEED_END = /^(signaler l'offre|report job)$/i;
const INDEED_DESC = /^(description du poste|description de l'offre|full job description|job description)$/i;
const INDEED_APPLY = /^(postuler maintenant|postuler sur le site de l'entreprise|postuler|apply now)$/i;
/** Lignes du haut du panneau qui ne sont ni le titre ni l'entreprise. */
const INDEED_META = /^(·|\d([.,]\d)?|candidature simplifiée|nouveau|cdi|cdd|stage|intérim|alternance|temps plein|temps partiel|.*\(\d{2,3}\)|\d{5}\b.*|télétravail.*|.*\+\d)$/i;

/** LinkedIn : adresse propre de l'offre (page de recherche → « currentJobId »). */
export function linkedinJobUrl(url) {
  try {
    const u = new URL(url);
    const id = u.searchParams.get("currentJobId") || u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
    return id && /^\d+$/.test(id) ? `${u.origin}/jobs/view/${id}/` : url;
  } catch {
    return url;
  }
}

/** Adresse propre de l'offre affichée (la page de recherche porte son numéro dans « vjk » ou « jk »). */
export function indeedJobUrl(url) {
  try {
    const u = new URL(url);
    const key = u.searchParams.get("vjk") || u.searchParams.get("jk");
    return key && /^[0-9a-f]{8,32}$/i.test(key) ? `${u.origin}/viewjob?jk=${key}` : url;
  } catch {
    return url;
  }
}

/**
 * Découpe le texte d'une page Indeed : garde seulement l'offre affichée (du titre jusqu'à « Signaler l'offre »).
 * `pane` = panneau repéré dans la page ; sinon, on retrouve l'offre dans le texte de toute la page :
 * elle est juste avant « Postuler maintenant », suivie de « Description du poste ».
 */
export function indeedOffer(pane, mainText) {
  const cut = (lines) => {
    const end = lines.findIndex((l) => INDEED_END.test(l));
    return end > 0 ? lines.slice(0, end) : lines;
  };
  const tidy = (t) => clean(t).split("\n").map((l) => l.trim()).filter(Boolean);

  let lines = cut(tidy(pane));
  if (lines.join("\n").length < 200) {
    const all = tidy(mainText);
    const desc = all.findLastIndex((l) => INDEED_DESC.test(l));
    if (desc < 0) return null;
    let apply = -1;
    for (let i = desc - 1; i >= Math.max(0, desc - 25); i--) if (INDEED_APPLY.test(all[i])) { apply = i; break; }
    if (apply < 0) return null;
    // Au-dessus de « Postuler » : titre, entreprise, (· note), lieu, contrat. On saute lieu / contrat / note…
    let at = apply - 1;
    while (at > 0 && apply - at < 8 && INDEED_META.test(all[at])) at--;
    // … on arrive sur l'entreprise ; le titre est juste avant, et il figure aussi dans la liste des offres plus haut.
    const before = all.slice(0, Math.max(0, at - 1));
    const start = at > 0 && before.includes(all[at - 1]) ? at - 1 : at;
    lines = cut(all.slice(start));
  }
  if (lines.join("\n").length < 200) return null;
  const firstReal = lines.findIndex((l) => l.length >= 5 && !INDEED_META.test(l) && !INDEED_APPLY.test(l));
  const title = firstReal >= 0 ? lines[firstReal] : null;
  const company = lines.slice(firstReal + 1, firstReal + 4).find((l) => l.length >= 2 && !INDEED_META.test(l) && !INDEED_APPLY.test(l)) ?? null;
  // « CGI · 3.5 » (entreprise + note sur la même ligne) → « CGI »
  return { title, company: company ? company.replace(/\s*·.*$/, "").trim() || null : null, text: lines.join("\n") };
}

/**
 * Paquet envoyé à l'écran « Ajouter une offre » :
 *  - text : le texte à lire (sélection de l'utilisateur, sinon description de l'offre) ;
 *  - hints : ce que la page dit clairement (titre, entreprise, lieu, contrat, salaire), prioritaire sur la lecture du texte.
 */
export function buildPayload(raw) {
  // Indeed (page de recherche avec l'offre à droite, ou page de l'offre) : seulement l'offre affichée.
  if (/(^|\.)indeed\./i.test(raw.host ?? "") && clean(raw.selection).length < 200) {
    const offer = indeedOffer(raw.paneText, raw.mainText);
    if (offer) {
      const hints = {
        title: short(offer.title, 200),
        company: short(offer.company, 150),
        location: null,
        contractType: null,
        salaryMin: null,
        salaryMax: null,
      };
      return { url: indeedJobUrl(raw.url), source: raw.host, text: clean(offer.text).slice(0, MAX_TEXT), hints };
    }
  }
  // LinkedIn : seulement la carte du haut + « À propos de l'offre d'emploi » (+ « À propos de l'entreprise » en infos).
  if (/(^|\.)linkedin\./i.test(raw.host ?? "") && clean(raw.selection).length < 200 && clean(raw.linkedinJob).length >= 200) {
    const li = fromLinkedInTitle(raw.pageTitle);
    const company = clean(raw.linkedinCompany);
    const extra = company ? `\n\nINFOS À CÔTÉ DE L'ANNONCE\n${company}` : "";
    return {
      url: linkedinJobUrl(raw.url),
      source: raw.host,
      text: clean(`${clean(raw.linkedinJob)}${extra}`).slice(0, MAX_TEXT),
      hints: {
        title: short(li.title, 200) ?? short(raw.headerTitle, 200) ?? short(raw.h1, 200),
        company: short(li.company, 150) ?? short(raw.headerCompany, 150),
        location: null,
        contractType: null,
        salaryMin: null,
        salaryMax: null,
      },
    };
  }
  const job = findJobPosting(raw.jsonLd);
  const li = /linkedin\./i.test(raw.host ?? "") ? fromLinkedInTitle(raw.pageTitle) : {};
  const salary = job ? salaryOf(job) : null;

  const hints = {
    title: short(job?.title, 200) ?? short(li.title, 200) ?? short(raw.headerTitle, 200) ?? short(raw.h1, 200),
    company:
      short(typeof job?.hiringOrganization === "object" ? job.hiringOrganization?.name : job?.hiringOrganization, 150) ??
      short(li.company, 150) ??
      short(raw.headerCompany, 150),
    location: job ? locationOf(job) : null,
    contractType: job ? contractOf(job) : null,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
  };

  const selection = clean(raw.selection);
  let body;
  let header = clean(raw.headerText);
  if (selection.length >= 200) body = selection;
  else if (clean(raw.descriptionText).length >= 200) {
    body = clean(raw.descriptionText);
    // Welcome to the Jungle… : le résumé du poste (télétravail, expérience, salaire) est au-dessus de la description.
    if (!header) header = headerZone(raw.mainText, body, true);
  }
  else if (job?.description) {
    // Description complète de la fiche structurée + haut de la page (lieu, contrat, télétravail… affichés par le site).
    body = htmlToText(job.description);
    header = [header, headerZone(raw.mainText, body)].filter(Boolean).join("\n");
  } else body = clean(raw.mainText);

  const head = [hints.title, hints.company, header].filter(Boolean).join("\n");
  // Colonne d'infos de la page (entreprise, avantages, adresse du lieu de travail) : à la fin, pour l'IA.
  const side = clean(raw.sideText).slice(0, 5000);
  const extra = side && !body.includes(side.slice(0, 80)) ? `\n\nINFOS À CÔTÉ DE L'ANNONCE\n${side}` : "";
  const text = clean(`${head}\n\n${body}${extra}`).slice(0, MAX_TEXT);
  return { url: raw.url, source: raw.host ?? null, text, hints };
}
