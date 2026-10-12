/**
 * Offres de DÉMONSTRATION pour tester l'interface avant le vrai connecteur (étape 6).
 * Toutes marquées source « demo » et entreprise « [DÉMO] ».
 *   pnpm db:demo        → ajoute / met à jour les offres de démo
 *   pnpm db:demo:clear  → les supprime toutes
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import { createPrismaClient } from "../src/client";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

type Demo = {
  key: string;
  title: string;
  company: string;
  description: string;
  contractType: string;
  experienceText: string | null;
  experienceMinYrs: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  city: string;
  postalCode: string;
  department: string;
  remoteType: "remote" | "hybrid" | "onsite" | "unknown";
  travelMinutes: number | null;
  daysAgo: number;
};

const DEMOS: Demo[] = [
  {
    key: "vue-node-compiegne",
    title: "Développeur Full Stack Vue.js / Node.js H/F",
    company: "Atelier Numérique",
    description:
      "Au sein d'une équipe produit de 6 personnes, vous développerez notre application métier en Vue 3 et TypeScript, " +
      "avec un backend Node.js exposant une API REST sur PostgreSQL. Déploiement Docker, GitLab CI.\n\n" +
      "Profil : 2 ans d'expérience, débutant motivé accepté. 2 jours de télétravail par semaine.",
    contractType: "CDI",
    experienceText: "2 ans",
    experienceMinYrs: 2,
    salaryMin: 40000,
    salaryMax: 45000,
    city: "Compiègne",
    postalCode: "60200",
    department: "60",
    remoteType: "hybrid",
    travelMinutes: 30,
    daysAgo: 0,
  },
  {
    key: "java-spring-paris",
    title: "Développeur Java Spring Boot",
    company: "Banque Horizon",
    description:
      "Maintenance et évolution d'applications métier en Java 17 / Spring Boot, front Angular. " +
      "Méthodes agiles, revue de code, tests JUnit. 3 ans d'expérience souhaités.",
    contractType: "CDI",
    experienceText: "3 ans",
    experienceMinYrs: 3,
    salaryMin: null,
    salaryMax: null,
    city: "Paris 9e",
    postalCode: "75009",
    department: "75",
    remoteType: "onsite",
    travelMinutes: null,
    daysAgo: 1,
  },
  {
    key: "react-ts-creil",
    title: "Développeur Front-End React / TypeScript",
    company: "LogiNord",
    description:
      "Création d'interfaces en React et TypeScript, consommation d'API REST, tests Jest. Junior accepté.",
    contractType: "CDI",
    experienceText: "Débutant accepté",
    experienceMinYrs: 0,
    salaryMin: 36000,
    salaryMax: 39000,
    city: "Creil",
    postalCode: "60100",
    department: "60",
    remoteType: "hybrid",
    travelMinutes: 25,
    daysAgo: 2,
  },
  {
    key: "dotnet-beauvais",
    title: "Développeur .NET / C# H/F",
    company: "Picardie Services",
    description: "Développement d'API en C# .NET 8, SQL Server, Azure DevOps. Clean Architecture appréciée.",
    contractType: "CDI",
    experienceText: "1 an",
    experienceMinYrs: 1,
    salaryMin: 38000,
    salaryMax: 42000,
    city: "Beauvais",
    postalCode: "60000",
    department: "60",
    remoteType: "onsite",
    travelMinutes: 55,
    daysAgo: 3,
  },
  {
    key: "senior-react-paris",
    title: "Développeur Senior React",
    company: "ScaleUp Paris",
    description: "Vous avez 7 ans d'expérience minimum en React, TypeScript et GraphQL.",
    contractType: "CDI",
    experienceText: "7 ans",
    experienceMinYrs: 7,
    salaryMin: 55000,
    salaryMax: 65000,
    city: "Paris 2e",
    postalCode: "75002",
    department: "75",
    remoteType: "hybrid",
    travelMinutes: 40,
    daysAgo: 1,
  },
  {
    key: "vue-cdd-senlis",
    title: "Développeur Vue.js (CDD 6 mois)",
    company: "Mairie Numérique",
    description: "Refonte d'un portail en Vue 3 / Vuetify. CDD de 6 mois.",
    contractType: "CDD",
    experienceText: "1 an",
    experienceMinYrs: 1,
    salaryMin: 34000,
    salaryMax: 36000,
    city: "Senlis",
    postalCode: "60300",
    department: "60",
    remoteType: "onsite",
    travelMinutes: 20,
    daysAgo: 0,
  },
  {
    key: "python-lyon",
    title: "Développeur Python Django",
    company: "DataRhône",
    description: "API en Python / Django, PostgreSQL, Kubernetes. 2 ans d'expérience.",
    contractType: "CDI",
    experienceText: "2 ans",
    experienceMinYrs: 2,
    salaryMin: 42000,
    salaryMax: 48000,
    city: "Lyon",
    postalCode: "69003",
    department: "69",
    remoteType: "hybrid",
    travelMinutes: null,
    daysAgo: 4,
  },
  {
    key: "fullstack-remote",
    title: "Développeur Full Stack TypeScript (100 % télétravail)",
    company: "RemoteFirst",
    description: "Stack Vue.js, NestJS, PostgreSQL, Docker. Télétravail complet. 2 à 4 ans d'expérience.",
    contractType: "CDI",
    experienceText: "2 à 4 ans",
    experienceMinYrs: 2,
    salaryMin: null,
    salaryMax: null,
    city: "Télétravail",
    postalCode: "",
    department: "",
    remoteType: "remote",
    travelMinutes: null,
    daysAgo: 0,
  },
];

const prisma = createPrismaClient();
const clear = process.argv.includes("--clear");

async function main() {
  const removed = await prisma.job.deleteMany({ where: { sources: { some: { source: "demo" } } } });
  if (clear) {
    console.log(`✔ ${removed.count} offre(s) de démo supprimée(s)`);
    return;
  }
  for (const d of DEMOS) {
    const contentHash = createHash("sha256").update(JSON.stringify(d)).digest("hex").slice(0, 16);
    const publishedAt = new Date(Date.now() - d.daysAgo * 86_400_000);
    await prisma.job.create({
      data: {
        fingerprint: `demo:${d.key}`,
        contentHash,
        title: d.title,
        company: `[DÉMO] ${d.company}`,
        description: d.description,
        contractType: d.contractType,
        experienceText: d.experienceText,
        experienceMinYrs: d.experienceMinYrs,
        salaryMin: d.salaryMin,
        salaryMax: d.salaryMax,
        salaryPeriod: d.salaryMin ? "year" : null,
        city: d.city,
        postalCode: d.postalCode || null,
        department: d.department || null,
        locationPrecision: "city_centroid",
        remoteType: d.remoteType,
        technologies: [],
        publishedAt,
        sources: {
          create: { source: "demo", sourceJobId: d.key, sourceUrl: `https://example.com/demo/${d.key}` },
        },
        ...(d.travelMinutes !== null
          ? { travel: { create: { minutes: d.travelMinutes, provider: "demo", precision: "city_centroid" } } }
          : {}),
      },
    });
  }
  console.log(`✔ ${DEMOS.length} offres de démo créées (source « demo »)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
