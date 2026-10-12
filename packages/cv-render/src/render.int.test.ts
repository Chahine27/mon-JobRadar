import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tailorCv, type TailoredCvDraft } from "@job-radar/cv-tailor";
import { CvMasterSchema, EMPTY_OVERRIDES, type TemplateId } from "@job-radar/shared";
import { afterAll, describe, expect, it } from "vitest";
import { JOBS, MASTER, MASTER_INPUT } from "../../cv-tailor/src/fixtures";
import { createBrowserEngine } from "./engine";
import { fitToPage, renderPdf } from "./pdf";
import { renderCvHtml } from "./templates";

/** Vrai navigateur (Edge ou Chrome) : lancé avec « pnpm test:int ». */
const engine = createBrowserEngine();
afterAll(() => engine.close());

describe("rendu PDF avec Edge", () => {
  for (const template of ["une-colonne", "deux-colonnes"] as TemplateId[]) {
    it(`${template} : une page, texte lisible (nom, e-mail, titre)`, async () => {
      const draft = await fitToPage(tailorCv(MASTER, JOBS.front, template), MASTER, JOBS.front, EMPTY_OVERRIDES, engine);
      const { pdf, draft: d } = await renderPdf(draft, engine);
      const { text, pages } = await engine.readPdf(pdf);
      expect(pages).toBe(1);
      expect(text).toContain(MASTER.identity.email);
      expect(d.checks.filter((c) => c.ok !== true)).toEqual([]);
    });
  }

  it("trop long : retraits dans l'ordre fixe, police jamais réduite", async () => {
    const input = structuredClone(MASTER_INPUT);
    const front = input.experiences[0]!;
    front.maxBullets = 20;
    for (let i = 0; i < 8; i++) front.bullets.push({ ...structuredClone(front.bullets[1]!), id: `extra-${i}` });
    const master = CvMasterSchema.parse(input);
    const start = tailorCv(master, JOBS.front, "une-colonne");
    const d = await fitToPage(start, master, JOBS.front, EMPTY_OVERRIDES, engine);
    const kinds = d.dropped.filter((x) => x.why === "manque de place").map((x) => x.kind);
    expect(kinds[0]).toBe("hobbies");
    const order = (k: string) => kinds.indexOf(k as TailoredCvDraft["dropped"][number]["kind"]);
    if (order("bullet") >= 0) expect(order("project")).toBeLessThan(order("bullet"));
    expect(renderCvHtml(d.sections)).toContain("font-size: 9pt");
  });
});

/** Comparaison grossière avec le CV de référence (fichiers perso dans data/cv, sautée s'ils sont absents). */
const REF = join(import.meta.dirname, "../../../data/cv/reference/MEHADJI_CHAHINE_v2.html");
describe.skipIf(!existsSync(REF))("ressemblance avec le CV deux colonnes de référence", () => {
  it("différence d'image sous le seuil", async () => {
    const { chromium } = await import("playwright-core");
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const seed = join(import.meta.dirname, "../../../data/cv/cv-master.seed.yaml");
    const { parse } = await import("yaml");
    const master = CvMasterSchema.parse(parse(readFileSync(seed, "utf8")));
    const all = tailorCv(master, { title: "", required: [], niceToHave: [], mentioned: [], jobType: "fullstack", isAbridged: false, skillsSource: "ai", forms: {} }, "deux-colonnes", {
      ...EMPTY_OVERRIDES,
      add: master.experiences.flatMap((e) => e.bullets.map((b) => b.id)),
    });
    const browser = await chromium.launch({ channel: "msedge" });
    const shot = async (html: string) => {
      const p = await browser.newPage({ viewport: { width: 794, height: 1123 } });
      await p.setContent(html);
      const png = await p.screenshot();
      await p.close();
      const img = await loadImage(png);
      const c = createCanvas(40, 56); // très grossier : la mise en page, pas le texte
      c.getContext("2d").drawImage(img, 0, 0, 40, 56);
      return c.getContext("2d").getImageData(0, 0, 40, 56).data;
    };
    const ref = await shot(readFileSync(REF, "utf8"));
    const ours = await shot(renderCvHtml(all.sections));
    await browser.close();
    let d = 0;
    for (let i = 0; i < ref.length; i += 4) d += Math.abs(ref[i]! - ours[i]!);
    // Le contenu diffère un peu de la référence (phrases du CV complet) : seuil large, mesuré à ≈ 0,066 le 07/10/2026.
    // Une mise en page cassée (colonne perdue, police changée) le dépasse.
    expect(d / (ref.length / 4) / 255).toBeLessThan(0.08);
  });
});
