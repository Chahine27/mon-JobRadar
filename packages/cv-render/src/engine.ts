import type { Browser } from "playwright-core";

/** Mesure et impression d'une page HTML. Remplaçable dans les tests (pas de navigateur). */
export interface CvEngine {
  /** Hauteur qui dépasse la page A4 (px, ≤ 0 = tient) et blocs (data-block) qui débordent. */
  measure(html: string): Promise<{ overflowPx: number; overflowing: string[] }>;
  pdf(html: string): Promise<Buffer>;
  /** Texte lisible dans le PDF (ce que lisent les logiciels de tri) et nombre de pages. */
  readPdf(pdf: Buffer): Promise<{ text: string; pages: number }>;
  close(): Promise<void>;
}

/** A4 à 96 ppp. */
const PAGE_HEIGHT_PX = (297 / 25.4) * 96;

export async function readPdfText(pdf: Buffer): Promise<{ text: string; pages: number }> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false });
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      for (const item of content.items) if ("str" in item) parts.push(item.str, item.hasEOL ? "\n" : "");
    }
    return { text: parts.join(""), pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

/**
 * Edge déjà installé sous Windows (sans téléchargement), sinon Chrome. Un seul navigateur sans fenêtre,
 * lancé à la première demande et réutilisé ; close() à l'arrêt de Job Radar.
 */
export function createBrowserEngine(): CvEngine {
  let browser: Promise<Browser> | null = null;
  const launch = async (): Promise<Browser> => {
    const { chromium } = await import("playwright-core");
    // undefined = Chromium téléchargé par Playwright (serveur Linux ARM, sans Edge ni Chrome).
    for (const channel of ["msedge", "chrome", undefined]) {
      try {
        return await chromium.launch({ channel, headless: true });
      } catch {
        // essai suivant
      }
    }
    throw Object.assign(new Error("Ni Microsoft Edge ni Google Chrome trouvé sur ce PC : installe l'un des deux pour créer les PDF."), { code: "NO_BROWSER" });
  };
  const page = async (html: string) => {
    browser ??= launch().catch((e) => {
      browser = null;
      throw e;
    });
    const p = await (await browser).newPage({ viewport: { width: 794, height: 1123 } });
    await p.setContent(html, { waitUntil: "load" });
    await p.emulateMedia({ media: "print" });
    return p;
  };
  return {
    async measure(html) {
      const p = await page(html);
      try {
        // Code exécuté dans la page (chaîne : le projet ne compile pas avec les types du navigateur).
        return (await p.evaluate(`(() => {
          const limit = ${PAGE_HEIGHT_PX};
          const height = document.querySelector(".page").getBoundingClientRect().height;
          const overflowing = [...document.querySelectorAll("[data-block]")]
            .filter((el) => el.getBoundingClientRect().bottom > limit)
            .map((el) => el.dataset.block);
          return { overflowPx: Math.ceil(height - limit), overflowing };
        })()`)) as { overflowPx: number; overflowing: string[] };
      } finally {
        await p.close();
      }
    },
    async pdf(html) {
      const p = await page(html);
      try {
        return await p.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
      } finally {
        await p.close();
      }
    },
    readPdf: readPdfText,
    async close() {
      const b = browser;
      browser = null;
      if (b) await (await b.catch(() => null))?.close();
    },
  };
}
