// Un clic sur l'icône = l'offre affichée part tout de suite vers Job Radar.
const status = document.getElementById("status");
document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

function show(text, kind = "") {
  status.textContent = text;
  status.className = kind;
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const res = await chrome.runtime.sendMessage({ type: "send", tab }).catch((e) => ({ ok: false, error: String(e) }));
// En cas de succès, l'onglet Job Radar s'ouvre et cette fenêtre se ferme toute seule.
if (res?.ok) show(`Envoyée : ${res.title ?? "offre"}`, "ok");
else if (res) show(res.error ?? "Envoi impossible.", "err");
