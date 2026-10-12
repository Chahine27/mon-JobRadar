import type { JobAlert } from "./types";

const k = (n: number) => `${Math.round(n / 1000)}k`;

export function salaryLabel(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min !== max) return `${k(min)}–${k(max)} €`;
  return `${k((max ?? min)!)} €`;
}

export const REMOTE_LABEL: Record<string, string | null> = {
  remote: "télétravail complet",
  hybrid: "hybride",
  onsite: "sur site",
  unknown: null,
};

function metaLine(a: JobAlert): string {
  return [a.contract, a.salary ?? "salaire non communiqué", a.remote].filter(Boolean).join(" · ");
}

function header(a: JobAlert): string {
  return [a.company, a.place].filter(Boolean).join(" — ") || "Entreprise et lieu non précisés";
}

/** Annonce incomplète : score provisoire, qui peut chuter une fois l'annonce complète lue. */
const scoreLabel = (a: JobAlert) => (a.kind === "complete" ? `${a.score} % provisoire` : `${a.score} %`);
const actionLabel = (a: JobAlert) => (a.kind === "complete" ? "Compléter l'annonce" : "Voir l'offre");

export const COMPLETE_INTRO =
  "Bon score provisoire, mais la source ne donne qu'un extrait de l'annonce. Colle l'annonce complète dans Job Radar pour confirmer le score : tu recevras un mail « à postuler » s'il reste bon.";

export function emailSubject(alerts: JobAlert[]): string {
  const best = alerts[0]!;
  if (best.kind === "complete") {
    return alerts.length === 1
      ? `📝 À compléter — ${scoreLabel(best)} — ${best.title}`
      : `📝 ${alerts.length} offres à compléter (jusqu'à ${scoreLabel(best)})`;
  }
  return alerts.length === 1
    ? `🟢 ${best.score} % — ${best.title}`
    : `🟢 ${alerts.length} nouvelles offres compatibles (jusqu'à ${best.score} %)`;
}

export function emailText(alerts: JobAlert[]): string {
  const blocks = alerts.map((a) =>
    [
      `${scoreLabel(a)} — ${a.title}`,
      header(a),
      metaLine(a),
      a.skills.length ? `Tu as : ${a.skills.join(", ")}` : null,
      a.missing.length ? `À travailler : ${a.missing.join(", ")}` : null,
      `${actionLabel(a)} : ${a.url}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const intro = alerts[0]?.kind === "complete" ? COMPLETE_INTRO : "Nouvelle(s) offre(s) compatible(s) trouvée(s) par Job Radar :";
  return `${intro}\n\n${blocks.join("\n\n")}\n`;
}

/** Échappe le texte venant des annonces avant de l'insérer dans le HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function emailHtml(alerts: JobAlert[]): string {
  const cards = alerts
    .map((a) => {
      const color = a.kind === "complete" ? "#5d6673" : "#1f8a4c" /* toute offre notifiée a déjà passé ton seuil */;
      const chips = (list: string[], bg: string, fg: string) =>
        list.map((s) => `<span style="display:inline-block;margin:2px;padding:2px 8px;border-radius:99px;background:${bg};color:${fg};font-size:12px">${escapeHtml(s)}</span>`).join("");
      return `
<div style="border:1px solid #dde1e7;border-radius:10px;padding:14px 16px;margin:0 0 12px">
  <div style="font-size:22px;font-weight:800;color:${color}">${scoreLabel(a)}</div>
  <div style="font-size:16px;font-weight:700;margin:4px 0">${escapeHtml(a.title)}</div>
  <div style="color:#5d6673">${escapeHtml(header(a))}</div>
  <div style="color:#5d6673;margin:4px 0 8px">${escapeHtml(metaLine(a))}</div>
  <div>${chips(a.skills, "#e3f4ea", "#1f8a4c")}${chips(a.missing, "#f0f2f5", "#5d6673")}</div>
  <a href="${escapeHtml(a.url)}" style="display:inline-block;margin-top:10px;padding:8px 14px;background:#2f6fed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">${actionLabel(a)}</a>
</div>`;
    })
    .join("");
  const heading =
    alerts[0]?.kind === "complete"
      ? `<h2 style="font-size:18px">Job Radar — offre(s) à compléter</h2><p style="color:#5d6673">${escapeHtml(COMPLETE_INTRO)}</p>`
      : `<h2 style="font-size:18px">Job Radar — nouvelle(s) offre(s) compatible(s)</h2>`;
  return `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;color:#1b1f24">
${heading}${cards}
<p style="color:#5d6673;font-size:12px">Tu reçois cet email car les notifications sont activées dans ton profil Job Radar.</p></div>`;
}

export function pushPayload(a: JobAlert): string {
  return JSON.stringify({
    title: `${a.kind === "complete" ? "📝 À compléter · " : ""}${scoreLabel(a)} — ${a.title}`,
    body: [header(a), metaLine(a), a.skills.slice(0, 4).join(" / ")].filter(Boolean).join("\n"),
    url: a.url,
    tag: `job-${a.jobId}`,
  });
}
