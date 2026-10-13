import { z } from "zod";

export const GARE_DU_NORD = { label: "Gare du Nord, Paris", lat: 48.8809, lng: 2.3553 };

/** Départements d'Île-de-France : trajet en transports depuis la gare d'arrivée (ailleurs : en voiture depuis le domicile). */
export const IDF_DEPARTMENTS = ["75", "77", "78", "91", "92", "93", "94", "95"];

/**
 * Règle bonus/malus du profil : des points en plus ou en moins quand un mot est dans le titre / l'annonce,
 * ou pour une entreprise (« -30 si Angular dans le titre », « -50 pour ACME »).
 */
export const ScoreRuleSchema = z.object({
  kind: z.enum(["title", "text", "company"]),
  value: z.string().trim().min(2).max(80),
  points: z.number().int().min(-100).max(50),
});
export type ScoreRule = z.infer<typeof ScoreRuleSchema>;

export const LocationTargetSchema = z.object({
  label: z.string().min(1),
  /** Code département, ex. "60" pour l'Oise. */
  department: z.string().regex(/^(\d{2}|2A|2B|\d{3})$/),
});

export const PreferredTechSchema = z.object({
  name: z.string().min(1),
  /** Importance relative, 0 à 1. */
  weight: z.number().min(0).max(1),
});

/** Compétences maîtrisées par défaut (README §2). Modifiable depuis l'interface. */
export const DEFAULT_SKILLS = [
  "Vue.js",
  "JavaScript",
  "TypeScript",
  "React",
  "Node.js",
  "Java",
  "Spring Boot",
  "API REST",
  "C#",
  ".NET",
  "Python",
  "C",
  "C++",
  "SQL",
  "HTML",
  "CSS",
  "Docker",
  "Git",
  "GitLab",
  "CI/CD",
];

/** Filtres de la page « Entreprises » (candidatures spontanées), gardés d'une visite à l'autre. */
export const LeadFiltersSchema = z.object({
  status: z.enum(["active", "all", "TO_CONTACT", "CONTACTED", "FOLLOWED_UP", "INTERVIEW", "NOT_INTERESTED", "IGNORED"]),
  email: z.enum(["any", "hint", "missing", "noted", "set"]),
  sort: z.enum(["potential", "distance"]),
});
export const DEFAULT_LEAD_FILTERS: z.infer<typeof LeadFiltersSchema> = { status: "active", email: "any", sort: "potential" };

export const ProfileSchema = z
  .object({
    /** Ce que tu maîtrises : sert au pourcentage technique. */
    skills: z.array(z.string().trim().min(1)).min(1).default(DEFAULT_SKILLS),
    contracts: z.array(z.string().min(1)).min(1),
    experienceMin: z.number().int().min(0),
    experienceMax: z.number().int().min(0),
    /** Ton expérience réelle en années (décimales acceptées, ex. 2.5). null = non renseignée : on compare à ta cible max. */
    experienceYears: z.number().min(0).max(50).nullable().default(null),
    /** Plafond du score quand l'annonce exige des années d'expérience sur une techno / un produit absent de ton profil. */
    productExperienceCap: z.number().int().min(0).max(100).default(40),
    salaryTarget: z.number().int().positive().nullable(),
    salaryMinimum: z.number().int().positive().nullable(),
    locations: z.array(LocationTargetSchema).min(1),
    /** Rayon autour du point de départ : une offre à moins de N km est « dans ta zone » même hors de tes départements. null = désactivé. */
    searchRadiusKm: z.number().int().min(5).max(200).nullable().default(null),
    /**
     * Gare d'arrivée à Paris : les offres d'Île-de-France sont calculées en transports depuis ce point (le train
     * jusqu'à elle est un temps fixe que tu acceptes). Les autres offres : en voiture depuis ton domicile (privé, hors profil).
     */
    transitHub: z
      .object({ label: z.string().trim().min(1).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .nullable()
      .default(GARE_DU_NORD),
    /** Ce que tu préfères : sert aux recherches et à départager deux offres de même score. */
    preferredTechs: z.array(PreferredTechSchema).min(1),
    searches: z.array(z.string().min(2)).min(1),
    /** Tes règles bonus/malus, ajoutées à la main ou depuis « Pas pour moi » sur une offre. */
    scoreRules: z.array(ScoreRuleSchema).max(100).default([]),
    /** Candidatures spontanées (La Bonne Boîte) : métiers ROME et rayon autour du point de départ. */
    spontaneous: z
      .object({
        romes: z.array(z.string().regex(/^[A-N]\d{4}$/, "Code ROME invalide (ex. M1805)")).min(1).max(5),
        distanceKm: z.number().int().min(5).max(100),
        /** Zone propre aux candidatures spontanées (indépendante du point de départ des offres). */
        place: z
          .object({ label: z.string().trim().min(1).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
          .nullable()
          .default(null),
        departments: z.array(z.string().regex(/^(\d{2}|2A|2B|\d{3})$/, "Code département invalide (ex. 60)")).max(10).default([]),
        filters: LeadFiltersSchema.default(DEFAULT_LEAD_FILTERS),
      })
      .default({ romes: ["M1805"], distanceKm: 30, place: null, departments: [], filters: DEFAULT_LEAD_FILTERS }),
    minScoreForAnalysis: z.number().int().min(0).max(100),
    minScoreForNotification: z.number().int().min(0).max(100),
  })
  .refine((p) => p.experienceMin <= p.experienceMax, {
    message: "experienceMin doit être ≤ experienceMax",
    path: ["experienceMin"],
  });
export type Profile = z.infer<typeof ProfileSchema>;

/** Profil par défaut tiré du README (§2, §3, §17). Modifiable ensuite depuis l'interface. */
export const DEFAULT_PROFILE: Profile = {
  skills: DEFAULT_SKILLS,
  contracts: ["CDI"],
  experienceMin: 1,
  experienceMax: 3,
  experienceYears: null,
  productExperienceCap: 40,
  salaryTarget: 40000,
  salaryMinimum: 38000,
  locations: [
    { label: "Oise", department: "60" },
    { label: "Paris", department: "75" },
  ],
  searchRadiusKm: null,
  preferredTechs: [
    { name: "Vue.js", weight: 1 },
    { name: "Java", weight: 0.9 },
    { name: "Spring Boot", weight: 0.9 },
    { name: "React", weight: 0.8 },
    { name: "TypeScript", weight: 0.8 },
    { name: "Node.js", weight: 0.7 },
    { name: ".NET", weight: 0.6 },
    { name: "C#", weight: 0.6 },
    { name: "JavaScript", weight: 0.6 },
  ],
  searches: [
    "Développeur Vue.js",
    "Développeur Java Spring",
    "Développeur React TypeScript",
    "Développeur Node.js",
    "Développeur Full Stack",
    "Développeur .NET",
  ],
  scoreRules: [],
  transitHub: GARE_DU_NORD,
  spontaneous: { romes: ["M1805"], distanceKm: 30, place: null, departments: [], filters: DEFAULT_LEAD_FILTERS },
  minScoreForAnalysis: 55,
  minScoreForNotification: 70,
};

/** Profil enregistré. Les anciens champs (poids du score) sont ignorés. */
export function parseProfile(data: unknown): Profile {
  return ProfileSchema.parse(data);
}
