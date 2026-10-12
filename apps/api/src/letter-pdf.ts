import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import PDFDocument from "pdfkit";

/** Nom par défaut : le même à chaque fois, le nouveau PDF remplace l'ancien. */
export const DEFAULT_PDF_NAME = "Lettre_de_motivation.pdf";

const CM = 72 / 2.54;
/** Calibri si Windows l'a (comme Word), sinon Helvetica (intégrée au PDF). */
const WINDOWS_FONTS = { regular: "C:\\Windows\\Fonts\\calibri.ttf", bold: "C:\\Windows\\Fonts\\calibrib.ttf" };

const isDate = (b: string) => /^(À .+, )?le \d{2}\/\d{2}\/\d{4}$/i.test(b);
const isObject = (b: string) => /^Objet\s*:/i.test(b);

/**
 * Lettre en PDF A4, sans en-tête ni pied de page du navigateur (date, adresse de la page, numéro de page).
 * Même mise en page que l'ancienne impression : en-tête à gauche, date à droite, objet en gras, texte justifié.
 */
export function renderLetterPdf(content: string, title = "Lettre de motivation"): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 2 * CM, bottom: 2 * CM, left: 2.2 * CM, right: 2.2 * CM },
    info: { Title: title },
  });
  const calibri = existsSync(WINDOWS_FONTS.regular) && existsSync(WINDOWS_FONTS.bold);
  const regular = calibri ? WINDOWS_FONTS.regular : "Helvetica";
  const bold = calibri ? WINDOWS_FONTS.bold : "Helvetica-Bold";
  const size = calibri ? 11 : 10.5;
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
      doc.font(regular).fontSize(size).text(text, { align: "left", lineGap: 1.5 });
      doc.moveDown(0.6);
    } else if (isDate(b)) {
      doc.moveDown(0.6).font(regular).fontSize(size).text(text, { align: "right" });
      doc.moveDown(1);
    } else if (isObject(b)) {
      doc.font(bold).fontSize(size).text(text, { align: "left" });
      doc.moveDown(1.1);
    } else {
      doc.font(regular).fontSize(size).text(text, { align: "justify", lineGap: 2, paragraphGap: 0 });
      doc.y += gap;
    }
  });
  doc.end();
  return done;
}

/** Enregistre (en remplaçant) le PDF dans le dossier choisi. Crée le dossier s'il n'existe pas. */
export async function saveLetterPdf(content: string, folder: string, name: string, title?: string): Promise<string> {
  const file = join(folder, safeName(name));
  await mkdir(folder, { recursive: true });
  await writeFile(file, await renderLetterPdf(content, title));
  return file;
}

export function safeName(name: string): string {
  const base = (name.trim() || DEFAULT_PDF_NAME).replace(/[\\/:*?"<>|]/g, "_");
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}
