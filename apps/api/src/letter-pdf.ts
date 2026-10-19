import { existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { readPdfText } from "@job-radar/cv-render";
import PDFDocument from "pdfkit";

/** Nom par défaut : le même à chaque fois, le nouveau PDF remplace l'ancien. */
export const DEFAULT_PDF_NAME = "Lettre_de_motivation.pdf";

const CM = 72 / 2.54;
/**
 * Calibri (Windows, comme Word), sinon Carlito (mêmes dimensions, serveur Linux : apt install fonts-crosextra-carlito),
 * sinon Helvetica (intégrée au PDF).
 */
const FONTS = [
  { regular: "C:\\Windows\\Fonts\\calibri.ttf", bold: "C:\\Windows\\Fonts\\calibrib.ttf" },
  { regular: "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf", bold: "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf" },
].find((f) => existsSync(f.regular) && existsSync(f.bold));

/**
 * Sans ligatures : Calibri/Carlito fondent « ti », « fi », « ff », « tt »… en un seul signe, et des lecteurs de PDF
 * (logiciels de tri, pdftotext de Poppler) le perdent : « gestion » devient « geston ». (Objet accepté par fontkit.)
 */
const NO_LIGATURES = { liga: false, clig: false, dlig: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[];

/** Signes du PDF qui valent plusieurs lettres (ligatures, lues dans les tables ToUnicode) : « ti », « fi »… */
function ligatures(pdf: Buffer): string[] {
  const raw = pdf.toString("latin1");
  const found = new Set<string>();
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let text: string;
    try {
      text = inflateSync(pdf.subarray(start, raw.indexOf("endstream", start))).toString("latin1");
    } catch {
      continue; // flux non compressé (image, police…) : pas une table de caractères
    }
    if (!text.includes("begincmap")) continue;
    for (const [, hex] of text.matchAll(/<((?:[0-9a-f]{4}\s?){2,})>/gi)) {
      const chars = String.fromCharCode(...(hex ?? "").split(/\s/).join("").match(/.{4}/g)!.map((h) => parseInt(h, 16)));
      if ([...chars].length > 1) found.add(chars); // une paire de substitution (émoji) = un seul caractère
    }
  }
  return [...found];
}

/**
 * Ce qui serait mal lu dans le PDF (vide = rien) : ligatures, puis mots de la lettre absents du texte lu par pdf.js
 * (espaces ignorés : seules les lettres comptent).
 */
export async function pdfTextProblems(content: string, pdf: Buffer): Promise<string[]> {
  const lig = ligatures(pdf).map((l) => `« ${l} » en un seul signe`);
  const read = (await readPdfText(pdf)).text.replace(/\s+/g, "");
  return [...lig, ...new Set(content.split(/\s+/).filter((w) => w && !read.includes(w)))];
}

const isDate = (b: string) => /^(À .+, )?le \d{2}\/\d{2}\/\d{4}$/i.test(b);
const isObject = (b: string) => /^Objet\s*:/i.test(b);

/**
 * Lettre en PDF A4, sans en-tête ni pied de page du navigateur (date, adresse de la page, numéro de page).
 * Même mise en page que l'ancienne impression : en-tête à gauche, date à droite, objet en gras, texte justifié.
 * Relu juste après : un mot abîmé dans le PDF → erreur, le PDF n'est ni téléchargé ni envoyé.
 */
export async function renderLetterPdf(content: string, title = "Lettre de motivation"): Promise<Buffer> {
  const pdf = await buildLetterPdf(content, title);
  const problems = await pdfTextProblems(content, pdf);
  if (problems.length) {
    throw Object.assign(new Error(`PDF de la lettre abîmé (mal lu par les logiciels de tri) : ${problems.slice(0, 10).join(", ")}`), { statusCode: 422 });
  }
  return pdf;
}

function buildLetterPdf(content: string, title: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 2 * CM, bottom: 2 * CM, left: 2.2 * CM, right: 2.2 * CM },
    info: { Title: title },
  });
  const regular = FONTS?.regular ?? "Helvetica";
  const bold = FONTS?.bold ?? "Helvetica-Bold";
  const size = FONTS ? 11 : 10.5;
  const gap = size * 0.85;

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const blocks = content.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  blocks.forEach((b, i) => {
    const text = b.replace(/[ \t]*\n[ \t]*/g, "\n");
    if (i === 0) {
      doc.font(regular).fontSize(size).text(text, { features: NO_LIGATURES, align: "left", lineGap: 1.5 });
      doc.moveDown(0.6);
    } else if (isDate(b)) {
      doc.moveDown(0.6).font(regular).fontSize(size).text(text, { features: NO_LIGATURES, align: "right" });
      doc.moveDown(1);
    } else if (isObject(b)) {
      doc.font(bold).fontSize(size).text(text, { features: NO_LIGATURES, align: "left" });
      doc.moveDown(1.1);
    } else {
      doc.font(regular).fontSize(size).text(text, { features: NO_LIGATURES, align: "justify", lineGap: 2, paragraphGap: 0 });
      doc.y += gap;
    }
  });
  doc.end();
  return done;
}

export function safeName(name: string): string {
  const base = (name.trim() || DEFAULT_PDF_NAME).replace(/[\\/:*?"<>|]/g, "_");
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}
