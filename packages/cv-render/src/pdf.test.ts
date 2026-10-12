import { tailorCv } from "@job-radar/cv-tailor";
import { EMPTY_OVERRIDES } from "@job-radar/shared";
import { describe, expect, it } from "vitest";
import { JOBS, MASTER } from "../../cv-tailor/src/fixtures";
import type { CvEngine } from "./engine";
import { fitToPage } from "./pdf";

/** Faux navigateur : la « hauteur » est le nombre de lignes + 2 par projet ; la page en tient `limit`. */
const engine = (limit: number): CvEngine => ({
  measure: async (html) => ({ overflowPx: (html.match(/<li>/g)?.length ?? 0) + 2 * (html.match(/class="proj"/g)?.length ?? 0) - limit, overflowing: [] }),
  pdf: async () => Buffer.from(""),
  readPdf: async () => ({ text: "", pages: 1 }),
  close: async () => {},
});

describe("remplissage de la page", () => {
  it("place libre : remet projets puis lignes par note, sans dépasser la page ni les maximums", async () => {
    const start = tailorCv(MASTER, JOBS.java, "deux-colonnes");
    const height = (d: typeof start) => d.sections.experiences.reduce((n, e) => n + e.bullets.length, 0) + 2 * d.sections.projects.length;
    const d = await fitToPage(start, MASTER, JOBS.java, EMPTY_OVERRIDES, engine(height(start) + 7));
    expect(height(d)).toBe(height(start) + 7);
    expect(d.sections.projects.length).toBe(start.sections.projects.length + 3); // 3 projets (6) puis 1 ligne
    expect(d.picked.filter((p) => p.fill).length).toBe(4);
    expect(d.checks.find((c) => c.id === 7)!.ok).toBe(true);
  });

  it("jamais remis : ce qui a été retiré à la main", async () => {
    const o = { ...EMPTY_OVERRIDES, remove: ["hackathon"] };
    const d = await fitToPage(tailorCv(MASTER, JOBS.java, "deux-colonnes", o), MASTER, JOBS.java, o, engine(999));
    expect(d.sections.projects.map((p) => p.id)).not.toContain("hackathon");
    expect(d.sections.projects).toHaveLength(MASTER.rules.maxProjects - 1);
  });
});
