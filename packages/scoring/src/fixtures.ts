import type { ScoringInput } from "./score";

/** Les 6 cas du README §32, réutilisés par les tests. */
export const PERFECT: ScoringInput = {
  title: "Développeur Full Stack Vue.js / Node.js H/F",
  description:
    "Au sein d'une équipe produit, vous développerez notre application en Vue 3 et TypeScript, " +
    "avec un backend Node.js et une API REST sur PostgreSQL. Débutant accepté, 2 ans d'expérience appréciés.",
  technologies: [],
  contractType: "CDI",
  experienceMinYears: 2,
  salaryMin: 40000,
  salaryMax: 45000,
  department: "60",
  remoteType: "hybrid",
  travelMinutes: 30,
};

export const ACCEPTABLE: ScoringInput = {
  title: "Développeur Java Spring Boot",
  description: "Maintenance et évolution d'applications métier en Java / Spring Boot, front Angular. 3 ans d'expérience.",
  technologies: [],
  contractType: "CDI",
  experienceMinYears: 3,
  salaryMin: null,
  salaryMax: null,
  department: "75",
  remoteType: "onsite",
  travelMinutes: null,
};

export const TOO_SENIOR: ScoringInput = {
  title: "Développeur Senior React",
  description: "Vous avez 7 ans d'expérience minimum en React et TypeScript.",
  technologies: [],
  contractType: "CDI",
  experienceMinYears: 7,
  salaryMin: 55000,
  salaryMax: 65000,
  department: "75",
  remoteType: "hybrid",
  travelMinutes: 40,
};

export const LOW_SALARY: ScoringInput = { ...PERFECT, salaryMin: 28000, salaryMax: 31000 };

export const TOO_FAR: ScoringInput = { ...PERFECT, department: "69", travelMinutes: null };

export const NOT_CDI: ScoringInput = { ...PERFECT, contractType: "CDD" };
