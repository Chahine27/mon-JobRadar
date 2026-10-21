import { type CvMaster, CvMasterSchema } from "@job-radar/shared";
import { buildJobForCv } from "./job";

/**
 * CV complet de test : mêmes morceaux que le fichier de départ (data/cv, hors Git), identité fictive,
 * toutes les phrases considérées validées (sauf `pendingMaster`).
 */
const v = (id: string, style: "verbe" | "nom", text: string, toValidate = false) => ({ id, style, text, toValidate });
const bullet = (id: string, skills: string[], rule: "always" | "ifRelevant", verbe: string, nom: string) => ({
  id,
  skills,
  level: "pro" as const,
  rule,
  variants: [v("v1", "verbe", verbe), v("v2", "nom", nom)],
});
const project = (id: string, name: string, context: string, team: string, nom: string, verbe: string, technologies: string[], ownSkills: string[], teamOnlySkills: string[], roleNote?: string, rule: "always" | "ifRelevant" = "ifRelevant", link = "") => ({
  id,
  name,
  context,
  team,
  ...(roleNote ? { roleNote } : {}),
  descriptions: [v("d1", "nom", nom), v("d2", "verbe", verbe)],
  technologies,
  ownSkills,
  teamOnlySkills,
  link,
  rule,
});
const item = (skillId: string, label: string, level: "pro" | "projet" | "cours") => ({ skillId, label, level });

export const MASTER_INPUT = {
  identity: { fullName: "Camille Testeur", phone: "06 00 00 00 00", email: "camille@example.com", linkedin: "linkedin.com/in/camille", github: "github.com/camille", city: "Creil (60100)" },
  headline: [v("h1", "nom", "Bac+5 · Titre RNCP niveau 7 · En recherche d'un CDI ou CDD · Permis B, véhiculé")],
  titles: [
    { id: "t-fullstack", text: "Développeur Full Stack Web & Mobile", skills: [], jobTypes: ["fullstack", "other"], toValidate: false, isDefault: true },
    { id: "t-front", text: "Développeur Frontend Vue.js", skills: ["vue"], jobTypes: ["frontend"], toValidate: false },
    { id: "t-java", text: "Développeur Full Stack Java / Vue.js", skills: ["java", "spring", "vue"], jobTypes: ["backend", "fullstack"], toValidate: false },
    { id: "t-back", text: "Développeur Backend Java Spring Boot", skills: ["java", "spring"], jobTypes: ["backend"], toValidate: false },
    { id: "t-mobile", text: "Développeur Web & Mobile", skills: ["flutter", "kotlin"], jobTypes: ["mobile"], toValidate: false },
  ],
  summaries: [
    {
      id: "s-long",
      template: "une-colonne",
      jobTypes: "any",
      toValidate: false,
      text: "Développeur full stack diplômé d'un Bac+5 (Mastère Architecture Logicielle, titre RNCP niveau 7). 2 ans et demi d'alternance chez LUSIS : interfaces web Vue.js pour un logiciel de supervision bancaire, puis serveur Java Spring Boot et intégration d'API REST.",
    },
    {
      id: "s-court",
      template: "deux-colonnes",
      jobTypes: "any",
      toValidate: false,
      text: "Développeur full stack diplômé d'un Bac+5 (Mastère Architecture Logicielle, titre RNCP niveau 7), 2 ans et demi d'alternance sur des applications web métier en Vue.js, back-end Java Spring Boot et intégration d'API REST.",
    },
  ],
  experiences: [
    {
      id: "lusis-front",
      role: "Développeur Frontend",
      company: "LUSIS",
      contract: "Alternance",
      start: "2023-10",
      end: "2025-09",
      rule: "always",
      minBullets: 3,
      maxBullets: 6,
      bullets: [
        bullet("f-interfaces", ["vue", "javascript"], "always", "Développé des interfaces web en Vue.js pour un logiciel de supervision bancaire", "Développement d'interfaces web en Vue.js pour un logiciel de supervision bancaire"),
        bullet("f-fraude", ["vue", "vuetify"], "ifRelevant", "Créé 6 écrans de gestion de la fraude à partir de spécifications, avec l'équipe backend", "Création de 6 écrans de gestion de la fraude à partir de spécifications fonctionnelles, en coordination avec l'équipe backend"),
        bullet("f-migration", ["vue", "vuetify", "typescript"], "ifRelevant", "Migré le module Fraude de Vue 2 / Vuetify 2 vers Vue 3 / Vuetify 3 en TypeScript, en composants réutilisables", "Migration du module Fraude de Vue 2 / Vuetify 2 vers Vue 3 / Vuetify 3 en TypeScript, avec restructuration en composants réutilisables"),
        bullet("f-accessibilite", ["accessibilite", "aria", "lighthouse"], "ifRelevant", "Rendu les interfaces accessibles (rôles ARIA, audits Lighthouse)", "Mise en accessibilité des interfaces (rôles ARIA, audits Lighthouse)"),
        bullet("f-traduction", ["i18n"], "ifRelevant", "Traduit toute l'application de l'anglais vers le français (vocabulaire exact de la banque et de la monétique)", "Mise en place des traductions des pages"),
        bullet("f-preferences", ["vue"], "ifRelevant", "Relié au compte utilisateur les préférences d'un écran de suivi statistique (avant : navigateur seul)", "Enregistrement des préférences d'un écran de suivi statistique sur le compte utilisateur (auparavant dans le navigateur seul)"),
      ],
    },
    {
      id: "lusis-back",
      role: "Développeur Backend",
      company: "LUSIS",
      contract: "Alternance",
      start: "2023-03",
      end: "2023-09",
      rule: "always",
      minBullets: 2,
      maxBullets: 4,
      bullets: [
        bullet("b-serveur", ["java", "spring"], "always", "Développé et maintenu un serveur backend Java Spring Boot", "Développement et maintenance d'un serveur backend Java Spring Boot"),
        bullet("b-api-externes", ["rest"], "ifRelevant", "Intégré des API REST externes (TradeDoubler, Budget Insight / Powens)", "Intégration d'API externes REST (TradeDoubler, Budget Insight / Powens)"),
        bullet("b-api-internes", ["rest"], "ifRelevant", "Créé des API REST internes", "Création et modification d'API REST internes"),
        bullet("b-tests", ["postman", "postgresql", "sql"], "ifRelevant", "Testé les services avec Postman et vérifié les données en base PostgreSQL", "Tests des services via Postman et vérification des données en base PostgreSQL"),
      ],
    },
  ],
  projects: [
    project("job-radar", "Job Radar", "Application de recherche d'emploi en production (projet perso, depuis 2026)", "", "Cahier des charges, pilotage du développement avec Claude Code, tests et mise en ligne d'une application complète.", "Application complète de recherche d'emploi, mise en ligne sur serveur.", ["TypeScript", "Vue 3", "Fastify", "PostgreSQL", "API Claude"], ["typescript", "vue", "postgresql", "llm-api"], [], undefined, "always", "github.com/camille/job-radar"),
    project("doc-chez-vous", "Doc Chez Vous", "Projet de fin d'études 5e année", "équipe de 2", "Application de mise en relation patients / professionnels de santé à domicile.", "Mise en relation patients / professionnels de santé à domicile (3 rôles). Ma part : site web React (Keycloak, administration), back-office et application mobile Flutter. Backend .NET 8 surtout réalisé par mon binôme.", ["React + Vite", "Flutter", "Keycloak", ".NET 8 (Clean Architecture, CQRS)", "SQL Server", "Docker"], ["react", "vite", "flutter", "keycloak", "google-maps"], ["dotnet", "sql-server", "cqrs", "clean-architecture", "docker"]),
    project("codenshare", "CodeNShare", "Projet de fin d'études 4e année", "équipe", "Réseau social web et mobile de partage et d'exécution de code à distance.", "Réseau social web de partage et d'exécution de code à distance. Ma part : le front React (Auth0) et un test d'exécution à distance en Node.js.", ["React", "Node.js", "PostgreSQL", "Auth0 / JWT", "OpenAPI", "Vercel"], ["react", "auth0", "node"], ["postgresql", "jwt", "openapi", "vercel"]),
    project("hackathon", "Hackathon ESGI — 3e place", "Hackathon", "équipe", "Jeu multijoueur en ligne inspiré d'Among Us, développé comme extension du logiciel WorkAdventure.", "Jeu multijoueur en ligne inspiré d'Among Us, extension du logiciel WorkAdventure, dont j'ai proposé l'idée.", ["TypeScript"], ["gestion-de-projet"], ["typescript"], "porteur de l'idée et chef de projet"),
    project("search-your-product", "Search Your Product", "Projet Android", "équipe de 3", "Application mobile de recherche de produits en magasin par géolocalisation.", "Application mobile qui liste les magasins les plus proches et leurs produits à partir de l'adresse saisie.", ["Kotlin", "MVVM", "Room", "Retrofit / OkHttp", "API Google Maps"], ["kotlin", "android", "mvvm", "room", "retrofit", "google-maps"], []),
    project("parking", "Réservation de parking", "Projet d'architecture logicielle 5e année", "équipe de 4", "Système de réservation de places de parking.", "Réservation de 60 places de parking pour les salariés d'une entreprise (monolithe modulaire).", ["Flutter (BLoC)", "Java / Spring Boot", "Docker Compose"], ["flutter", "bloc", "java", "spring", "docker"], ["architecture-modulaire"]),
  ],
  skillGroups: [
    { id: "frontend", label: "Frontend", items: [item("typescript", "TypeScript", "pro"), item("javascript", "JavaScript", "pro"), item("vue", "Vue.js", "pro"), item("vuetify", "Vuetify", "pro"), item("vuex", "Vuex", "pro"), item("react", "React", "projet"), item("vite", "Vite", "projet"), item("accessibilite", "Accessibilité web (ARIA)", "pro")] },
    { id: "backend", label: "Backend", items: [item("java", "Java", "pro"), item("spring", "Spring Boot", "pro"), item("rest", "API REST", "pro"), item("postgresql", "PostgreSQL", "pro"), item("sql", "SQL", "pro"), item("node", "Node.js", "projet")] },
    { id: "mobile", label: "Mobile", items: [item("flutter", "Flutter", "projet"), item("android", "Android", "projet"), item("kotlin", "Kotlin", "projet")] },
    { id: "architecture", label: "Architecture", items: [item("architecture-logicielle", "Architecture logicielle", "cours"), item("ddd", "DDD (Domain-Driven Design)", "cours"), item("architecture-hexagonale", "Architecture hexagonale", "cours"), item("microservices", "Microservices", "cours")] },
    { id: "outils", label: "Outils / DevOps", items: [item("git", "Git", "pro"), item("docker", "Docker", "projet"), item("cicd", "CI / CD (intégration et déploiement continus)", "projet")] },
    { id: "tests", label: "Tests", items: [item("tests-unitaires", "Tests unitaires", "cours"), item("tests-integration", "Tests d'intégration", "cours"), item("tests-e2e", "Tests de bout en bout", "cours")] },
    { id: "methodes", label: "Méthodes", items: [item("agile-scrum", "Agile / Scrum", "cours"), item("kanban", "Kanban", "cours")] },
  ],
  education: [
    { id: "mastere", rule: "always", start: "2023-09", end: "2025-09", lines: [v("l1", "nom", "Mastère Architecture Logicielle — Bac+5, titre RNCP niveau 7 — ESGI (École Supérieure de Génie Informatique)")] },
    { id: "licence", rule: "always", start: "2022", end: "2023", lines: [v("l1", "nom", "Licence professionnelle Métiers de l'informatique : conception, développement et test de logiciels — IUT de Villetaneuse · IUT de Paris")] },
    { id: "dut", rule: "always", start: "2020", end: "2022", lines: [v("l1", "nom", "DUT Informatique (Diplôme Universitaire de Technologie) — IUT d'Amiens")] },
  ],
  languages: ["Anglais : intermédiaire (B1+)"],
  hobbies: ["Voyage", "Musique", "Jeu d'échecs", "Séries et films"],
  rules: {
    forbiddenSkills: ["securite-applicative", "salesforce", "wordpress", "jira", "php", "github-actions", "rust", "solidity"],
    strongWords: ["maîtrise", "maîtrisé", "maîtrisée", "expert", "experte", "expertise", "confirmé", "senior"],
    strongWordsAllowedFor: ["vue", "typescript", "javascript", "java", "spring", "rest", "git", "gitlab"],
    maxProjects: 5,
    minProjects: 2,
    maxSkillsPerGroup: 8,
  },
};

export const MASTER: CvMaster = CvMasterSchema.parse(MASTER_INPUT);

export const jobFor = (title: string, description: string, required?: string[], bonus: string[] = [], abridged = false) =>
  buildJobForCv({ title, description, abridged, analysis: required ? { required, bonus } : null });

export const JOBS = {
  front: jobFor("Développeur Frontend Vue.js (H/F)", "Vous développerez nos interfaces en VueJS 3 et TypeScript. Vuetify est un plus.", ["Vue.js", "TypeScript"], ["Vuetify"]),
  java: jobFor("Développeur Java junior", "Développement de services Java Spring Boot et d'API REST. PostgreSQL apprécié.", ["Java", "Spring Boot", "API REST"], ["PostgreSQL"]),
  mobile: jobFor("Développeur mobile Flutter / Kotlin", "Applications Android en Kotlin et multiplateforme en Flutter.", ["Flutter", "Kotlin", "Android"]),
  phpJira: jobFor("Développeur PHP", "Stack PHP Symfony, suivi dans Jira.", ["PHP", "Jira", "Symfony"]),
  dotnet: jobFor("Développeur .NET", "C# / .NET 8, SQL Server.", [".NET", "C#", "SQL Server"]),
  micro: jobFor("Développeur Java microservices", "Architecture microservices en Java Spring Boot.", ["Microservices", "Java", "Spring Boot"]),
  abridged: jobFor("Développeur Vue.js", "Rejoignez notre équipe… (extrait)", undefined, [], true),
};
