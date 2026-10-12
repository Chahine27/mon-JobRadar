/**
 * Départements français : nom → code, et lecture d'un département dans un texte libre
 * (« Compiègne, Hauts-de-France », « Paris 9e », « 75009 Paris », « Remote - France »).
 * Rien de reconnu → null (on ne devine pas). "99" = étranger (code INSEE des pays étrangers).
 */

export const DEPARTMENTS: Record<string, string> = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
  "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube", "11": "Aude",
  "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal", "16": "Charente",
  "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud", "2B": "Haute-Corse",
  "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne", "25": "Doubs", "26": "Drôme",
  "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère", "30": "Gard", "31": "Haute-Garonne", "32": "Gers",
  "33": "Gironde", "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire",
  "38": "Isère", "39": "Jura", "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire",
  "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère",
  "49": "Maine-et-Loire", "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne",
  "54": "Meurthe-et-Moselle", "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord",
  "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
  "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône",
  "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
  "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres",
  "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse", "85": "Vendée",
  "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort",
  "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise",
  "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte",
};

/** Villes fréquentes dans les annonces tech (sans département écrit). Liste volontairement courte. */
const CITIES: Record<string, string> = {
  paris: "75", "la defense": "92", "boulogne-billancourt": "92", "issy-les-moulineaux": "92", nanterre: "92",
  "levallois-perret": "92", "neuilly-sur-seine": "92", courbevoie: "92", puteaux: "92", montrouge: "92",
  "saint-denis": "93", montreuil: "93", pantin: "93", "ivry-sur-seine": "94", creteil: "94", vincennes: "94",
  "saint-ouen": "93", "massy": "91", "saclay": "91", "evry": "91", versailles: "78", "velizy-villacoublay": "78",
  "saint-quentin-en-yvelines": "78", cergy: "95", argenteuil: "95", roissy: "95", "marne-la-vallee": "77",
  compiegne: "60", beauvais: "60", creil: "60", senlis: "60", chantilly: "60", noyon: "60", clermont: "60",
  "crepy-en-valois": "60", "nogent-sur-oise": "60", amiens: "80", "saint-quentin": "02", soissons: "02",
  lyon: "69", villeurbanne: "69", marseille: "13", "aix-en-provence": "13", lille: "59", roubaix: "59",
  toulouse: "31", bordeaux: "33", nantes: "44", rennes: "35", strasbourg: "67", montpellier: "34",
  nice: "06", "sophia antipolis": "06", grenoble: "38", rouen: "76", reims: "51", orleans: "45", tours: "37",
};

const FOREIGN = /\b(germany|allemagne|deutschland|berlin|munich|london|londres|united kingdom|royaume-uni|\buk\b|spain|espagne|madrid|barcelona|portugal|lisbon|lisbonne|italy|italie|milan|netherlands|pays-bas|amsterdam|belgium|belgique|bruxelles|brussels|switzerland|suisse|geneve|zurich|luxembourg|ireland|dublin|poland|pologne|warsaw|usa|united states|etats-unis|new york|san francisco|canada|montreal|toronto|india|singapore|morocco|maroc|tunisia|tunisie|casablanca)\b/;

function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[’']/g, "'").trim();
}

const NAME_TO_CODE = new Map(Object.entries(DEPARTMENTS).map(([code, name]) => [norm(name), code]));

export function departmentName(code: string): string | null {
  return DEPARTMENTS[code] ?? null;
}

export function departmentFromPostalCode(postalCode: string | null | undefined): string | null {
  const pc = postalCode?.trim();
  if (!pc || !/^\d{5}$/.test(pc)) return null;
  if (pc.startsWith("97")) return pc.slice(0, 3);
  if (pc.startsWith("20")) return Number(pc) < 20200 ? "2A" : "2B";
  return pc.slice(0, 2);
}

export function departmentFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = norm(text);
  const pc = t.match(/\b(\d{5})\b/)?.[1];
  if (pc) return departmentFromPostalCode(pc);
  const inParens = t.match(/\((\d{2,3}|2a|2b)\)/)?.[1];
  if (inParens) return inParens.toUpperCase();
  // « Paris 9e », « Paris 09 », « Paris 15e Arrondissement »
  if (/\bparis\b/.test(t)) return "75";
  const parts = t.split(/[,/|;·–-]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  for (const p of [t, ...parts]) {
    const byName = NAME_TO_CODE.get(p);
    if (byName) return byName;
    const byCity = CITIES[p];
    if (byCity) return byCity;
  }
  for (const [city, code] of Object.entries(CITIES)) {
    if (new RegExp(`(^|[^a-z])${city.replace(/[-]/g, "[- ]")}([^a-z]|$)`).test(t)) return code;
  }
  if (FOREIGN.test(t)) return "99";
  return null;
}
