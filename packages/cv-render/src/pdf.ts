import { type CheckResult, fillCandidates, type JobForCv, shrinkOnce, tailorCv, type TailoredCvDraft } from "@job-radar/cv-tailor";
import type { CvMaster, CvOverrides } from "@job-radar/shared";
import type { CvEngine } from "./engine";
import { renderCvHtml } from "./templates";

const setCheck = (d: TailoredCvDraft, id: number, ok: boolean, details: string[]): TailoredCvDraft => ({
  ...d,
  checks: d.checks.map((c): CheckResult => (c.id === id ? { ...c, ok, details } : c)),
});

/**
 * Ajuste à une page (§6.3) : mesure, puis retire dans l'ordre fixe jusqu'à ce que ça tienne.
 * Jamais de police ou de marge réduite. Ne tient toujours pas → contrôle 7 en échec, avec ce qui déborde.
 * S'il reste de la place, remet un à un les projets puis les lignes écartés (par note) tant que ça tient.
 */
export async function fitToPage(draft: TailoredCvDraft, master: CvMaster, job: JobForCv, overrides: CvOverrides, engine: CvEngine): Promise<TailoredCvDraft> {
  const overflow = async (d: TailoredCvDraft) => engine.measure(renderCvHtml(d.sections));
  let d = draft;
  let m = await overflow(d);
  if (m.overflowPx <= 0) {
    // Remplissage : chaque élément essayé une fois ; gardé seulement si la page tient encore.
    const fill: string[] = [];
    const tried = new Set<string>();
    for (;;) {
      const next = fillCandidates(d, master).find((id) => !tried.has(id));
      if (!next) break;
      tried.add(next);
      const bigger = tailorCv(master, job, draft.template, overrides, [...fill, next]);
      if ((await overflow(bigger)).overflowPx <= 0) {
        fill.push(next);
        d = bigger;
      }
    }
    return setCheck(d, 7, true, []);
  }
  for (;;) {
    const next = shrinkOnce(d, master, overrides);
    if (!next) {
      const cm = Math.ceil((m.overflowPx / 96) * 25.4) / 10;
      return setCheck(d, 7, false, [`Dépasse d'environ ${cm.toLocaleString("fr-FR")} cm, rien d'autre ne peut être retiré.`, ...m.overflowing.map((b) => `Déborde : ${b}`)]);
    }
    d = next;
    m = await overflow(d);
    if (m.overflowPx <= 0) return setCheck(d, 7, true, []);
  }
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** PDF du CV ajusté + contrôle 8 (texte lisible : nom, e-mail, titre ; une seule page). */
export async function renderPdf(draft: TailoredCvDraft, engine: CvEngine): Promise<{ pdf: Buffer; draft: TailoredCvDraft }> {
  const pdf = await engine.pdf(renderCvHtml(draft.sections));
  const { text, pages } = await engine.readPdf(pdf);
  const t = flat(text);
  const { fullName, email } = draft.sections.identity;
  const missing = [
    ...(t.includes(flat(fullName)) ? [] : ["nom"]),
    ...(t.includes(flat(email)) ? [] : ["e-mail"]),
    ...(t.includes(flat(draft.sections.title)) ? [] : ["titre"]),
  ];
  let d = setCheck(draft, 8, missing.length === 0, missing.map((x) => `Texte du PDF : ${x} illisible`));
  if (pages !== 1) d = setCheck(d, 7, false, [`Le PDF fait ${pages} pages.`]);
  return { pdf, draft: d };
}
