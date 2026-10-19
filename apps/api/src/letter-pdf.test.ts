import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { pdfTextProblems, renderLetterPdf, safeName } from "./letter-pdf";
import { createTestApp, login } from "./test-helpers";

const LETTER = [
  "Alex Martin\n75011 Paris\n06 00 00 00 00",
  "À Paris, le 30/09/2026",
  "Objet : Candidature au poste de Développeur Vue.js",
  "Madame, Monsieur,",
  "Chez Banquo, j'ai créé des écrans en Vue.js « accessibles » et migré l'appli vers Vue 3 — sans régression.",
  "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
  "Alex MARTIN",
].join("\n\n");

describe("lettre en PDF", () => {
  it("fabrique un PDF d'une page, avec les accents, sans adresse de page ni date d'impression", async () => {
    const pdf = await renderLetterPdf(LETTER, "Lettre de motivation - Banquo");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const raw = pdf.toString("latin1");
    expect(raw.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(raw).not.toContain("localhost");
  });

  it("aucune ligature : « gestion », « motivation », « distinguées » restent lisibles", async () => {
    const text = `${LETTER}

La gestion, la motivation, la certification, les fichiers, l'efficacité, offrir, attentes, distinguées.`;
    expect(await pdfTextProblems(text, await renderLetterPdf(text))).toEqual([]);
  });

  // Seulement là où Calibri ou Carlito est installée (ce sont elles qui ont des ligatures).
  const ligatureFont = ["C:/Windows/Fonts/calibri.ttf","/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf"].find(existsSync);
  it.skipIf(!ligatureFont)("un PDF avec ligatures est repéré, et renderLetterPdf l'aurait refusé", async () => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
    doc.font(ligatureFont!).text("La gestion et la certification.");
    doc.end();
    expect(await pdfTextProblems("La gestion et la certification.", await done)).toEqual(
      expect.arrayContaining(["« ti » en un seul signe", "« fi » en un seul signe"]),
    );
  });

  it("nom de fichier : .pdf ajouté, caractères interdits par Windows retirés", () => {
    expect(safeName("Lettre_de_motivation")).toBe("Lettre_de_motivation.pdf");
    expect(safeName("a:b?.pdf")).toBe("a_b_.pdf");
    expect(safeName("")).toBe("Lettre_de_motivation.pdf");
  });

  it("renvoie le PDF à télécharger, au nom choisi dans « CV & lettre »", async () => {
    const { app } = await createTestApp();
    const cookies = await login(app);
    const req = (method: "POST" | "PUT", url: string, payload: object) => app.inject({ method, url, cookies, payload });
    const kit = { header: "Alex", city: "Paris", signature: "Alex", cvText: "Vue.js, TypeScript, Java. ".repeat(20), letterExample: "" };

    await req("PUT", "/api/letter-kit", { ...kit, pdfName: "Lettre Alex" });
    // Seule une lettre enregistrée (donc relue) peut partir en PDF.
    expect((await req("POST", "/api/jobs/j-vue/letter/pdf", { content: LETTER })).statusCode).toBe(409);
    await app.inject({ method: "POST", url: "/api/jobs/j-vue/letter", cookies });
    await req("PUT", "/api/jobs/j-vue/letter", { content: LETTER });
    const res = await req("POST", "/api/jobs/j-vue/letter/pdf", { content: LETTER });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''Lettre%20Alex.pdf");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await req("POST", "/api/jobs/inconnue/letter/pdf", { content: LETTER })).statusCode).toBe(404);
  });
});
