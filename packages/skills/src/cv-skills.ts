import { SKILLS, type Skill } from "./dictionary";
import { extractSkills, normalizeText } from "./extract";

/**
 * Compétences en plus, utilisées seulement par le CV adapté (étiquettes du CV complet).
 * Gardées hors de SKILLS : le score des offres ne change pas (pas de nouvelle version des règles).
 */
export const CV_EXTRA_SKILLS: Skill[] = [
  { id: "vuex", label: "Vuex", family: "frontend-tools", core: false, aliases: ["vuex"] },
  { id: "vite", label: "Vite", family: "frontend-tools", core: false, aliases: ["vitejs", "vite.js"], caseSensitiveAliases: ["Vite"] },
  { id: "accessibilite", label: "Accessibilité web", family: "frontend-tools", core: false, aliases: ["accessibilite", "accessibility", "a11y", "rgaa", "wcag"] },
  { id: "aria", label: "ARIA", family: "frontend-tools", core: false, aliases: ["wai-aria"], caseSensitiveAliases: ["ARIA"] },
  { id: "lighthouse", label: "Lighthouse", family: "frontend-tools", core: false, aliases: ["lighthouse"] },
  { id: "i18n", label: "Traduction (i18n)", family: "frontend-tools", core: false, aliases: ["i18n", "vue-i18n", "internationalisation", "internationalization"] },
  { id: "postman", label: "Postman", family: "api", core: false, aliases: ["postman"] },
  { id: "openapi", label: "OpenAPI", family: "api", core: false, aliases: ["openapi", "swagger"] },
  { id: "jwt", label: "JWT", family: "api", core: false, aliases: ["jwt", "json web token"] },
  { id: "auth0", label: "Auth0", family: "api", core: false, aliases: ["auth0"] },
  { id: "keycloak", label: "Keycloak", family: "api", core: false, aliases: ["keycloak"] },
  { id: "google-maps", label: "API Google Maps", family: "api", core: false, aliases: ["google maps", "google maps api", "api google maps"] },
  { id: "sql-server", label: "SQL Server", family: "data", core: false, aliases: ["sql server", "mssql", "ms sql"] },
  { id: "android", label: "Android", family: "mobile", core: true, aliases: ["android"] },
  { id: "mvvm", label: "MVVM", family: "mobile", core: false, aliases: ["mvvm"] },
  { id: "room", label: "Room", family: "mobile", core: false, aliases: ["android room", "room database"] },
  { id: "retrofit", label: "Retrofit", family: "mobile", core: false, aliases: ["retrofit", "okhttp"] },
  { id: "bloc", label: "BLoC", family: "mobile", core: false, aliases: ["flutter bloc", "flutter_bloc"], caseSensitiveAliases: ["BLoC", "BLOC"] },
  { id: "vercel", label: "Vercel", family: "devops", core: false, aliases: ["vercel"] },
  { id: "cqrs", label: "CQRS", family: "other", core: false, aliases: ["cqrs"] },
  { id: "clean-architecture", label: "Clean Architecture", family: "other", core: false, aliases: ["clean architecture", "clean archi"] },
  { id: "ddd", label: "DDD", family: "other", core: false, aliases: ["ddd", "domain driven design", "domain-driven design"] },
  { id: "architecture-hexagonale", label: "Architecture hexagonale", family: "other", core: false, aliases: ["architecture hexagonale", "hexagonal architecture", "ports and adapters"] },
  { id: "architecture-logicielle", label: "Architecture logicielle", family: "other", core: false, aliases: ["architecture logicielle", "software architecture"] },
  { id: "architecture-modulaire", label: "Monolithe modulaire", family: "other", core: false, aliases: ["monolithe modulaire", "modular monolith"] },
  { id: "tests-unitaires", label: "Tests unitaires", family: "testing", core: false, aliases: ["tests unitaires", "test unitaire", "unit tests", "unit testing"] },
  { id: "tests-integration", label: "Tests d'intégration", family: "testing", core: false, aliases: ["tests d'integration", "test d'integration", "integration tests"] },
  { id: "tests-e2e", label: "Tests de bout en bout", family: "testing", core: false, aliases: ["tests de bout en bout", "tests e2e", "e2e", "end-to-end", "end to end"] },
  { id: "agile-scrum", label: "Agile / Scrum", family: "other", core: false, aliases: ["agile", "scrum", "methode agile", "methodes agiles"] },
  { id: "kanban", label: "Kanban", family: "other", core: false, aliases: ["kanban"] },
  { id: "gestion-de-projet", label: "Gestion de projet", family: "other", core: false, aliases: ["gestion de projet", "chef de projet", "project management"] },
  // Compétences qu'on choisit de ne pas afficher : connues pour les reconnaître dans l'offre et les bloquer.
  { id: "securite-applicative", label: "Sécurité applicative", family: "other", core: false, aliases: ["securite applicative", "application security", "owasp"] },
  { id: "salesforce", label: "Salesforce", family: "other", core: true, aliases: ["salesforce"] },
  { id: "wordpress", label: "WordPress", family: "php", core: true, aliases: ["wordpress"] },
  { id: "jira", label: "Jira", family: "other", core: false, aliases: ["jira"] },
  { id: "github-actions", label: "GitHub Actions", family: "devops", core: false, aliases: ["github actions"] },
  { id: "solidity", label: "Solidity", family: "other", core: true, aliases: ["solidity"] },
];

export const CV_SKILLS: Skill[] = [...SKILLS, ...CV_EXTRA_SKILLS];
const CV_SKILLS_BY_ID = new Map(CV_SKILLS.map((s) => [s.id, s]));

export function getCvSkill(id: string): Skill | undefined {
  return CV_SKILLS_BY_ID.get(id);
}

/** Libellé lisible d'un identifiant (« custom:xyz » → « xyz »). */
export function cvSkillLabel(id: string): string {
  return getCvSkill(id)?.label ?? id.replace(/^custom:/, "");
}

/** Compétences du dictionnaire (+ celles du CV) trouvées dans le texte. */
export function extractCvSkills(text: string): string[] {
  return extractSkills(text, CV_EXTRA_SKILLS);
}

/**
 * Nom donné par l'IA (« Vue.js 3 », « Spring ») → identifiants. Plusieurs possibles (« Java / Spring »).
 * Nom inconnu → « custom:nom » (gardé pour signaler qu'il manque au CV).
 */
export function resolveCvSkills(name: string): string[] {
  const found = extractCvSkills(name);
  if (found.length) return found;
  const n = normalizeText(name.trim());
  return n ? [`custom:${n}`] : [];
}

/** Le libellé saisi dans le CV désigne-t-il simplement cette compétence (« Node.js », « React ») ? */
export function isPlainSkillLabel(label: string, id: string): boolean {
  const s = getCvSkill(id);
  if (!s) return false;
  const n = normalizeText(label.trim());
  return [s.label, s.id, ...s.aliases, ...(s.caseSensitiveAliases ?? [])].some((a) => normalizeText(a) === n);
}
