import { buildPayload } from "./lib/extract.js";

const DEFAULT_BASE = "http://localhost:5173";

async function jobRadarBase() {
  const { baseUrl } = await chrome.storage.sync.get("baseUrl");
  return String(baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
}

/**
 * Exécutée DANS la page de l'offre (l'onglet que tu regardes), uniquement quand tu cliques sur l'extension.
 * Relève le texte utile ; rien n'est modifié sur la page.
 */
async function collectPageData() {
  const JOB_HEADING = /^(à propos de l'offre d'emploi|à propos de l’offre d’emploi|about the job)$/i;
  const COMPANY_HEADING = /^(à propos de l'entreprise|à propos de l’entreprise|about the company)$/i;
  const OTHER_SECTIONS = [
    COMPANY_HEADING,
    /^plus d[’']offres d[’']emploi$/i,
    /^personnes que vous pouvez contacter$/i,
    /^activer une alerte emploi/i,
    /^more jobs/i,
    /^people you can reach out to$/i,
    /^set alert for similar jobs$/i,
    /^découvrez les tendances/i,
    /^des recherches d[’']emploi plus/i,
  ];
  // Blocs repliés (« Voir plus », « Afficher plus »…) : on les déplie pour lire l'annonce entière.
  // Seulement des boutons qui déplient sur place (jamais un lien qui change de page).
  const MORE = /^(voir plus|afficher plus|lire la suite|en savoir plus|plus de détails|voir la suite|show more|see more|read more|…\s*plus|\.\.\.\s*plus)$/i;
  const toggles = [...document.querySelectorAll("button, [role='button'], summary, a[href='#'], a:not([href])")].filter((el) => {
    const label = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
    return MORE.test(label) && el.getAttribute("aria-expanded") !== "true" && !el.closest("nav, header, footer");
  });
  for (const el of toggles.slice(0, 20)) {
    try {
      el.click();
    } catch {
      /* bouton récalcitrant : tant pis */
    }
  }
  for (const d of document.querySelectorAll("details:not([open])")) d.open = true;
  if (toggles.length) await new Promise((r) => setTimeout(r, 500));

  // LinkedIn : la description est tronquée (« … plus ») ; on la déplie avant de la lire.
  if (/(^|\.)linkedin\./i.test(location.hostname)) {
    const card = cardByHeading(JOB_HEADING, OTHER_SECTIONS);
    if (card) {
      const more = [...card.querySelectorAll("button, [role='button'], span, a:not([href])")].filter((el) =>
        /^(…\s*)?(plus|voir plus|afficher plus|see more|show more|more)$/i.test((el.innerText || el.textContent || "").trim()),
      );
      for (const el of more.slice(0, 5)) {
        try {
          el.click();
        } catch {
          /* rien */
        }
      }
      if (more.length) await new Promise((r) => setTimeout(r, 500));
    }
  }

  const text = (sel) => {
    for (const s of sel) {
      const el = document.querySelector(s);
      const t = el && (el.innerText || el.textContent || "").trim();
      if (t) return t;
    }
    return "";
  };
  return {
    url: location.href,
    host: location.hostname,
    pageTitle: document.title,
    h1: text(["h1"]),
    selection: String(window.getSelection() || ""),
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent || ""),
    // LinkedIn / Indeed : en-tête et description de l'offre (le reste de la page = autres offres, menus…)
    headerTitle: text([
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
      "[data-testid='jobsearch-JobInfoHeader-title']",
      ".jobsearch-JobInfoHeader-title",
    ]),
    headerCompany: text([
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
      "[data-testid='inlineHeader-companyName']",
      "[data-company-name]",
    ]),
    headerText: text([
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".job-details-jobs-unified-top-card__tertiary-description-container",
      "[data-testid='jobsearch-JobInfoHeader-companyLocation']",
      "[data-testid='inlineHeader-companyLocation']",
    ]).slice(0, 300),
    // Welcome to the Jungle : résumé (contrat, salaire, expérience) + description + profil recherché + entretiens,
    // chacun dans sa section (la 1ʳᵉ seule ne suffit pas : l'expérience demandée est dans « Profil recherché »).
    descriptionText: (
      ["job-metadata-block", "job-section-description", "job-section-experience", "job-section-process"]
        .map((id) => (document.querySelector(`[data-testid='${id}']`)?.innerText || "").trim())
        .filter(Boolean)
        .join("\n\n") ||
      text([
      "#job-details",
      ".jobs-description__content",
      ".jobs-box__html-content",
      "#jobDescriptionText",
      "[data-testid='job-section-description']",
    ])
    ).slice(0, 30000),
    mainText: (text(["main", "[role='main']", "article"]) || (document.body.innerText || "")).slice(0, 30000),
    paneText: /(^|\.)indeed\./i.test(location.hostname) ? indeedPane().slice(0, 30000) : "",
    sideText: sideColumns().slice(0, 5000),
    linkedinJob: /(^|\.)linkedin\./i.test(location.hostname) ? linkedinJob().slice(0, 30000) : "",
    linkedinCompany: /(^|\.)linkedin\./i.test(location.hostname)
      ? (cardByHeading(COMPANY_HEADING, [JOB_HEADING, ...OTHER_SECTIONS.filter((r) => r !== COMPANY_HEADING)])?.innerText || "").slice(0, 2500)
      : "",
  };

  /**
   * Bloc (carte) qui entoure un titre de section : on part du titre et on remonte tant que le bloc
   * ne contient pas une AUTRE section de la page (« À propos de l'entreprise », « Plus d'offres d'emploi »…).
   */
  function cardByHeading(heading, stops) {
    const title = [...document.querySelectorAll("h1, h2, h3, h4, span, div, p")].find((el) => heading.test((el.textContent || "").trim()));
    if (!title) return null;
    const hasOther = (el) => {
      const t = el.innerText || "";
      return stops.some((re) => t.split("\n").some((line) => re.test(line.trim())));
    };
    let box = title;
    while (box.parentElement && box.parentElement !== document.body && !hasOther(box.parentElement)) box = box.parentElement;
    return box;
  }

  /** LinkedIn : carte du haut (titre, entreprise, lieu, contrat) + carte « À propos de l'offre d'emploi ». */
  function linkedinJob() {
    const about = cardByHeading(JOB_HEADING, OTHER_SECTIONS);
    if (!about) return "";
    const h1 = document.querySelector("h1");
    let top = h1;
    while (top && top.parentElement && top.parentElement !== document.body && !top.parentElement.contains(about)) {
      const t = top.parentElement.innerText || "";
      if (OTHER_SECTIONS.some((re) => t.split("\n").some((l) => re.test(l.trim())))) break;
      top = top.parentElement;
    }
    const head = top && !top.contains(about) ? (top.innerText || "").slice(0, 1500) : "";
    return [head, about.innerText || ""].filter(Boolean).join("\n\n");
  }

  /**
   * Colonne d'infos à côté de l'annonce (Welcome to the Jungle : « L'entreprise », « Les avantages salariés »,
   * « Le lieu de travail » avec l'adresse…). Blocs <aside> de la page + bloc « Lieu de travail » s'il est ailleurs.
   */
  function sideColumns() {
    const parts = [...document.querySelectorAll("aside, [role='complementary']")]
      .filter((el) => !el.closest("nav, header, footer"))
      .map((el) => (el.innerText || "").trim())
      .filter((t) => t.length > 20);
    // Rubriques utiles même hors d'un <aside> : on prend le bloc qui entoure leur titre.
    const TITLES = /^(le )?lieu de travail$|^adresse du poste$|^localisation du poste$|^l'entreprise$|^(les )?avantages( salariés)?$/i;
    for (const el of document.querySelectorAll("h2, h3, h4, h5, p, span, div")) {
      if (!TITLES.test((el.textContent || "").trim()) || el.closest("nav, header, footer")) continue;
      let box = el.parentElement;
      if (box && (box.innerText || "").trim().length < 40 && box.parentElement) box = box.parentElement;
      const t = box ? (box.innerText || "").trim().slice(0, 600) : "";
      if (t && !parts.some((p) => p.includes(t))) parts.push(t);
    }
    return [...new Set(parts)].join("\n\n");
  }

  /**
   * Indeed affiche la liste des offres à gauche et l'offre choisie à droite, dans la même page.
   * On part du titre « Description du poste » et on remonte les blocs tant qu'on ne touche pas la liste
   * (plusieurs cartes d'offres) : on garde ainsi seulement le panneau de l'offre affichée.
   */
  function indeedPane() {
    const direct = document.querySelector("#jobsearch-ViewjobPaneWrapper, .jobsearch-RightPane, [data-testid='viewJob-pane']");
    if (direct && (direct.innerText || "").trim().length > 200) return direct.innerText;
    const heading = [...document.querySelectorAll("h1, h2, h3, h4, div, span")].find((el) =>
      /^(description du poste|description de l'offre|full job description|job description)$/i.test((el.textContent || "").trim()),
    );
    if (!heading) return "";
    const cards = (el) => el.querySelectorAll("[data-jk], a[href*='jk='], [id^='job_']").length;
    let box = heading;
    while (box.parentElement && box.parentElement !== document.body && cards(box.parentElement) <= 1) box = box.parentElement;
    return box.innerText || "";
  }
}

/** Exécutée dans l'onglet Job Radar : dépose l'offre pour l'écran « Ajouter une offre ». */
function deliver(payload) {
  document.getElementById("jobradar-import")?.remove();
  const el = document.createElement("script");
  el.type = "application/json";
  el.id = "jobradar-import";
  el.textContent = JSON.stringify(payload);
  document.body.appendChild(el);
  window.dispatchEvent(new CustomEvent("jobradar-import"));
}

function waitUntilLoaded(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Job Radar ne répond pas : as-tu lancé « pnpm dev » ?"));
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendToJobRadar(tab) {
  if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("Ouvre d'abord la page d'une offre d'emploi.");
  const base = await jobRadarBase();
  if (tab.url.startsWith(base)) throw new Error("Tu es déjà sur Job Radar : ouvre la page d'une offre d'emploi.");

  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageData });
  const payload = buildPayload(result);
  if (payload.text.length < 60) throw new Error("Aucun texte d'offre trouvé sur cette page.");

  const target = await chrome.tabs.create({ url: `${base}/ajouter?depuis=extension`, index: tab.index + 1 });
  await waitUntilLoaded(target.id);
  await chrome.scripting.executeScript({ target: { tabId: target.id }, func: deliver, args: [payload] });
  return { ok: true, title: payload.hints.title };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "send") return false;
  sendToJobRadar(msg.tab)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true; // réponse asynchrone
});
