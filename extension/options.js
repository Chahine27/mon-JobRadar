const input = document.getElementById("base");
const msg = document.getElementById("msg");
const { baseUrl } = await chrome.storage.sync.get("baseUrl");
input.value = baseUrl || "http://localhost:5173";

document.getElementById("save").addEventListener("click", async () => {
  let url;
  try {
    url = new URL(input.value.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    msg.textContent = "Adresse invalide (exemple : http://localhost:5173).";
    return;
  }
  const origin = url.origin;
  const builtIn = origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173";
  // Autre adresse : Chrome demande ton accord pour que l'extension puisse y déposer les offres.
  if (!builtIn && !(await chrome.permissions.request({ origins: [`${origin}/*`] }))) {
    msg.textContent = "Accès refusé : l'extension ne pourra pas ouvrir cette adresse.";
    return;
  }
  await chrome.storage.sync.set({ baseUrl: origin });
  msg.textContent = `Enregistré : ${origin}`;
});
