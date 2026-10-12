/**
 * Test du calcul de trajet — n'écrit RIEN en base.
 *   pnpm travel:test "gare de Compiègne"
 * Calcule le trajet depuis cette adresse jusqu'à Paris Gare du Nord et La Défense.
 */
import { PrimRoutingService, geocode } from "@job-radar/routing";
import "./env";

const query = process.argv.slice(2).join(" ").trim() || "Gare de Compiègne";
const routing = new PrimRoutingService({ apiKey: process.env.PRIM_API_KEY?.trim() });

async function main() {
  if (!routing.isConfigured()) {
    console.error("✗ PRIM_API_KEY absente de .env");
    return 1;
  }
  const raw: unknown[] = [];
  // Coordonnées directes possibles : pnpm travel:test "49.2635,2.4686"
  const m = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
  const candidates = m
    ? [{ lat: Number(m[1]), lng: Number(m[2]), label: "coordonnées saisies", precision: "address" as const }]
    : await geocode(query, { limit: 5, debug: (f) => raw.push(...f) });
  const home = candidates[0];
  if (candidates.length > 1) {
    console.log("Adresses trouvées (la 1ʳᵉ est utilisée) :");
    for (const c of candidates) console.log(`  - ${c.label} (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})`);
  }
  if (!home) {
    console.error(`✗ Adresse introuvable : « ${query} »`);
    console.error("  Réponses brutes du service d'adresses (pour diagnostic) :");
    console.error(JSON.stringify(raw.slice(0, 3), null, 2).slice(0, 1500) || "  (aucune)");
    return 1;
  }
  console.log(`Départ : ${home.label} (${home.lat.toFixed(4)}, ${home.lng.toFixed(4)})`);
  for (const t of targets) {
    const r = await routing.estimateTravelTime(home, t);
    console.log(`  → ${t.name} : ${r.minutes === null ? `aucun itinéraire trouvé${r.reason ? ` (${r.reason})` : ""}` : `${r.minutes} min`}`);
  }
  return 0;
}

const targets = [
  { name: "Paris Gare du Nord", lat: 48.8809, lng: 2.3553 },
  { name: "La Défense", lat: 48.8918, lng: 2.2378 },
  { name: "Paris 13e (Bibliothèque F. Mitterrand)", lat: 48.8298, lng: 2.3764 },
];
// process.exitCode plutôt que process.exit() : évite un plantage de Node sous Windows.
process.exitCode = await main();
