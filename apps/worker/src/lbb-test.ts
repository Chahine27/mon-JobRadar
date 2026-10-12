/**
 * Découverte de l'API La Bonne Boîte v2 — n'écrit RIEN en base, n'affiche jamais la clé.
 *   pnpm lbb:test
 * Essaie plusieurs formes de requête et affiche ce que l'API répond, pour construire le connecteur sur du concret.
 */
import "./env";

const TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const BASE = "https://api.francetravail.io/partenaire/labonneboite/v2";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function token(scope: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.FRANCE_TRAVAIL_CLIENT_ID?.trim() ?? "",
      client_secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET?.trim() ?? "",
      scope,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  return { status: res.status, token: body.access_token, scope: body.scope, error: body.error_description ?? body.error };
}

function shape(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `… ${v.length} élément(s)`] : [];
  if (v && typeof v === "object") {
    if (depth > 2) return "{…}";
    return Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return typeof v === "string" ? (v.length > 60 ? `${v.slice(0, 60)}…` : v) : v;
}

async function main() {
  // La documentation (Stoplight) montre des routes « search » et « office » : on essaie les combinaisons
  // de droits (scopes) et d'adresses, et on garde la première qui répond 200.
  const scopes = ["api_labonneboitev2 search", "api_labonneboitev2 search office", "api_labonneboitev2"];
  const paths = [
    "/search?rome=M1805&citycode=60175&distance=30&page=1&page_size=3",
    "/search/count?rome=M1805&citycode=60175&distance=30",
    "/recherche?rome=M1805&citycode=60175&distance=30",
  ];
  for (const scope of scopes) {
    const t = await token(scope);
    console.log(`\n=== Droits demandés : « ${scope} » → ${t.token ? `jeton OK (droits accordés : ${t.scope ?? "?"})` : `refusé (HTTP ${t.status} : ${t.error})`}`);
    if (!t.token) continue;
    for (const path of paths) {
      await sleep(700); // 2 appels / seconde maximum
      const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${t.token}`, Accept: "application/json" } });
      const text = await res.text();
      console.log(`\n→ ${path}\n  HTTP ${res.status}`);
      try {
        console.log(JSON.stringify(shape(JSON.parse(text)), null, 2).split("\n").map((l) => `  ${l}`).join("\n"));
      } catch {
        console.log(`  ${text.slice(0, 300)}`);
      }
      if (res.status === 200) {
        console.log(`\n✔ Trouvé : droits « ${scope} », adresse « ${path.split("?")[0]} »`);
        console.log("\nCopie tout ce qui s'affiche et envoie-le à Claude.");
        return 0;
      }
    }
  }
  console.log("\nCopie tout ce qui s'affiche et envoie-le à Claude.");
  return 0;
}

process.exitCode = await main();
