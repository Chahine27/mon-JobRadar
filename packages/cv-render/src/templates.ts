import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RenderModel } from "@job-radar/cv-tailor";

/**
 * Modèles HTML/CSS des deux CV (§6.1), alimentés UNIQUEMENT par le RenderModel.
 * Seuls textes en dur : les titres de rubrique. Mise en page reprise de data/cv/reference.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 'AAAA-MM' → 'MM/AAAA' ; 'AAAA' reste tel quel (jamais de précision inventée). */
export function formatDate(d: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(d);
  return m ? `${m[2]}/${m[1]}` : d;
}
const hasMonth = (d: string) => /^\d{4}-\d{2}$/.test(d);
const datesBlock = (start: string, end: string) =>
  hasMonth(start) || hasMonth(end) ? `${esc(formatDate(start))} –<br>${esc(formatDate(end))}` : `${esc(start)} – ${esc(end)}`;
const datesInline = (start: string, end: string) => `${esc(formatDate(start))} – ${esc(formatDate(end))}`;

/** « Mastère … — Bac+5 … — ESGI (…) » : le dernier morceau (l'école) est aligné à droite, comme sur les CV de référence. */
function splitSchool(line: string): [string, string] {
  const i = line.lastIndexOf(" — ");
  return i > 0 ? [line.slice(0, i), line.slice(i + 3)] : [line, ""];
}

/** Libellés courts insécables (comme sur le CV de référence) ; les longs peuvent passer à la ligne. */
const dot = (xs: string[]) => xs.map((x) => (x.length <= 24 ? `<span class="nb">${esc(x)}</span>` : esc(x))).join(" · ");
/**
 * Puces écrites dans le texte (pas dessinées par le navigateur) : les logiciels de tri qui lisent le PDF
 * voient alors une liste, ligne par ligne. Même rendu : retrait suspendu, la puce dans la marge.
 */
const bullets = (items: Array<{ text: string }>) => `<ul>${items.map((b) => `<li><span class="dot">•</span>${esc(b.text)}</li>`).join("")}</ul>`;
/** Lien cliquable dans le PDF, affiché sans « https:// ». */
const linkTo = (url: string) => `<a href="https://${esc(url.replace(/^https?:\/\//, ""))}">${esc(url)}</a>`;
/** Technologies du projet puis son lien (dépôt). */
const stack = (p: RenderModel["projects"][number]) => [...p.technologies.map(esc), ...(p.link ? [linkTo(p.link)] : [])].join(" · ");
const block = (label: string, inner: string, tag = "div", cls = "") => `<${tag} class="${cls}" data-block="${esc(label)}">${inner}</${tag}>`;

const FONT_DIR = join(import.meta.dirname, "..", "fonts");
const FONT_FILES: Array<[string, string, string]> = [
  ["Liberation Sans", "normal", "LiberationSans-Regular.ttf"],
  ["Liberation Sans", "bold", "LiberationSans-Bold.ttf"],
  ["Liberation Serif", "bold", "LiberationSerif-Bold.ttf"],
];
let fontCss: string | null = null;
/**
 * Polices Liberation embarquées si leurs fichiers sont dans packages/cv-render/fonts/ ; sinon Arial et
 * Times New Roman (mêmes dimensions, c'est le principe des polices Liberation) : la mise en page ne change pas.
 */
function fonts(): string {
  if (fontCss !== null) return fontCss;
  fontCss = FONT_FILES.filter(([, , f]) => existsSync(join(FONT_DIR, f)))
    .map(([family, weight, f]) => `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/ttf;base64,${readFileSync(join(FONT_DIR, f)).toString("base64")}) format("truetype");}`)
    .join("\n");
  return fontCss;
}

const BASE_CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: "Liberation Sans", Arial, sans-serif; font-size: 9pt; color: #222; line-height: 1.36; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; padding: 10mm 13mm 8mm 13mm; }
a { color: #1f4e9c; text-decoration: none; }
.grey { color: #666; }
.blue { color: #1f4e9c; }
h1 { font-family: "Liberation Serif", "Times New Roman", serif; font-weight: bold; color: #111; line-height: 1.1; }
h2 { font-size: 9.8pt; font-weight: bold; color: #1f4e9c; letter-spacing: .6px; text-transform: uppercase; border-bottom: 1px solid #bbb; padding-bottom: 5px; margin: 10px 0 6px; }
p { margin: 0; }
ul { list-style: none; padding-left: 20px; margin-top: 2px; }
li { margin-bottom: 1px; }
li .dot { display: inline-block; width: 12px; margin-left: -12px; }
.nb { white-space: nowrap; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.row > span { color: #666; text-align: right; flex-shrink: 0; max-width: 42%; }
.row > span.when { white-space: nowrap; max-width: none; }
.proj { margin-bottom: 5px; }
.stack { color: #1f4e9c; font-size: 8.6pt; }
`;

function deuxColonnes(m: RenderModel): string {
  const [first, ...rest] = m.headline.split(" · ");
  const headline = m.headline ? `<b>${esc(first!)}</b>${rest.length ? ` · ${esc(rest.join(" · "))}` : ""}` : "";
  const exp = m.experiences
    .map((e) =>
      block(
        `Expérience ${e.role}`,
        `<div class="dates">${datesBlock(e.start, e.end)}</div><div><div class="row"><strong class="big">${esc(e.role)}</strong><span>${esc([e.contract, e.company].filter(Boolean).join(" · "))}</span></div>${bullets(e.bullets)}</div>`,
        "div",
        "job",
      ),
    )
    .join("");
  const projects = m.projects
    .map((p) =>
      block(
        `Projet ${p.name}`,
        `<p><strong>${esc(p.name)}</strong> <span class="grey">— ${esc([p.context, p.roleNote, p.team].filter(Boolean).join(" · "))}</span></p><p>${esc(p.description)}</p>${stack(p) ? `<p class="stack">${stack(p)}</p>` : ""}`,
        "div",
        "proj",
      ),
    )
    .join("");
  const edu = m.education
    .map((e) => {
      const [main, school] = splitSchool(e.lines[0] ?? "");
      return block(
        `Formation ${e.id}`,
        `<div class="dates">${datesBlock(e.start, e.end)}</div><div><div class="row"><strong class="big">${esc(main)}</strong><span>${esc(school)}</span></div>${e.lines.slice(1).map((l) => `<p class="grey">${esc(l)}</p>`).join("")}</div>`,
        "div",
        "job",
      );
    })
    .join("");
  const skills = m.skillGroups.map((g) => block(`Compétences ${g.label}`, `<h3>${esc(g.label)}</h3><p>${dot(g.items.map((i) => i.label))}</p>`)).join("");
  return `
<style>
h1 { font-size: 29pt; }
header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.2px solid #333; padding-bottom: 8px; }
.title { font-size: 12.5pt; font-weight: bold; color: #1f4e9c; margin-top: 6px; }
.tags { margin-top: 9px; font-size: 9.2pt; color: #666; }
.tags b { color: #1f4e9c; }
.contact { text-align: right; font-size: 9.2pt; line-height: 1.65; margin-top: 4px; }
.cols { display: flex; margin-top: 8px; }
.main { width: 72%; padding-right: 12px; border-right: 1px solid #ccc; }
.side { width: 28%; padding-left: 13px; }
.main > h2:first-child, .side > h2:first-child { margin-top: 2px; }
.job { display: grid; grid-template-columns: 82px 1fr; margin-bottom: 5px; }
.dates { line-height: 1.45; padding-top: 1px; }
.big { font-size: 10.4pt; }
.side h3 { font-size: 9.2pt; font-weight: bold; margin-top: 6px; }
.side p { margin-bottom: 1px; }
</style>
<div class="page">
  <header data-block="En-tête">
    <div>
      <h1>${esc(m.identity.fullName)}</h1>
      <div class="title">${esc(m.title)}</div>
      <div class="tags">${headline}</div>
    </div>
    <div class="contact">
      ${esc(m.identity.phone)}<br>
      <a href="mailto:${esc(m.identity.email)}">${esc(m.identity.email)}</a><br>
      ${m.identity.linkedin ? `${linkTo(m.identity.linkedin)}<br>` : ""}
      ${m.identity.github ? `${linkTo(m.identity.github)}<br>` : ""}
      ${esc(m.identity.city)}
    </div>
  </header>
  <div class="cols">
    <div class="main">
      ${m.summary ? `<h2>Profil</h2>${block("Profil", esc(m.summary), "p")}` : ""}
      <h2>Expérience professionnelle</h2>${exp}
      ${projects ? `<h2>Projets</h2>${projects}` : ""}
      <h2>Formation</h2>${edu}
    </div>
    <div class="side">
      ${skills ? `<h2>Compétences</h2>${skills}` : ""}
      ${m.languages.length ? `<h2>Langues</h2>${block("Langues", m.languages.map(esc).join("<br>"), "p")}` : ""}
      ${m.hobbies.length ? `<h2>Loisirs</h2>${block("Loisirs", dot(m.hobbies), "p")}` : ""}
    </div>
  </div>
</div>`;
}

function uneColonne(m: RenderModel): string {
  const { phone, email, linkedin, github, city } = m.identity;
  const contact = [esc(phone), email && esc(email), linkedin && linkTo(linkedin), github && linkTo(github), city && esc(city)].filter(Boolean).join(" · ");
  const exp = m.experiences
    .map((e) =>
      block(
        `Expérience ${e.role}`,
        `<div class="row"><p><strong class="big">${esc(e.role)}</strong> — ${esc([e.company, e.contract].filter(Boolean).join(" · "))}</p><span class="when">${datesInline(e.start, e.end)}</span></div>${bullets(e.bullets)}`,
        "div",
        "job",
      ),
    )
    .join("");
  const projects = m.projects
    .map((p) =>
      block(
        `Projet ${p.name}`,
        `<p><strong>${esc(p.name)}</strong> <span class="grey">— ${esc([p.context, p.roleNote, p.team].filter(Boolean).join(" · "))}</span></p><p>${esc(p.description)}</p>${stack(p) ? `<p class="stack">Technologies du projet : ${stack(p)}</p>` : ""}`,
        "div",
        "proj",
      ),
    )
    .join("");
  const skills = m.skillGroups.map((g) => block(`Compétences ${g.label}`, `<b>${esc(g.label)} :</b> ${g.items.map((i) => esc(i.label)).join(", ")}`, "p", "skill")).join("");
  const edu = m.education
    .map((e) => {
      const [main, school] = splitSchool(e.lines[0] ?? "");
      return block(
        `Formation ${e.id}`,
        `<div class="row"><p><strong>${esc(main)}</strong>${school ? ` — ${esc(school)}` : ""}</p><span class="when">${datesInline(e.start, e.end)}</span></div>${e.lines.slice(1).map((l) => `<p class="grey">${esc(l)}</p>`).join("")}`,
        "div",
        "edu",
      );
    })
    .join("");
  return `
<style>
h1 { font-size: 24pt; }
header { text-align: center; padding-bottom: 4px; }
.title { font-size: 12.5pt; font-weight: bold; color: #1f4e9c; margin-top: 4px; }
.tags { margin-top: 4px; font-size: 9.2pt; color: #666; }
.contact { margin-top: 4px; font-size: 9pt; }
.job { margin-bottom: 5px; }
.big { font-size: 10.2pt; }
.skill { margin-bottom: 2px; }
.edu { margin-bottom: 3px; }
</style>
<div class="page">
  <header data-block="En-tête">
    <h1>${esc(m.identity.fullName)}</h1>
    <div class="title">${esc(m.title)}</div>
    ${m.headline ? `<div class="tags">${esc(m.headline)}</div>` : ""}
    <div class="contact">${contact}</div>
  </header>
  ${m.summary ? `<h2>Profil</h2>${block("Profil", esc(m.summary), "p")}` : ""}
  <h2>Expérience professionnelle</h2>${exp}
  ${projects ? `<h2>Projets</h2>${projects}` : ""}
  ${skills ? `<h2>Compétences</h2>${skills}` : ""}
  <h2>Formation</h2>${edu}
  ${m.languages.length ? `<h2>Langues</h2>${block("Langues", m.languages.map(esc).join(" · "), "p")}` : ""}
  ${m.hobbies.length ? `<h2>Loisirs</h2>${block("Loisirs", m.hobbies.map(esc).join(" · "), "p")}` : ""}
</div>`;
}

/** Page HTML complète du CV (aperçu et PDF). */
export function renderCvHtml(m: RenderModel): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(m.identity.fullName)} – CV</title>
<style>${fonts()}${BASE_CSS}</style></head><body>${m.template === "une-colonne" ? uneColonne(m) : deuxColonnes(m)}</body></html>`;
}
