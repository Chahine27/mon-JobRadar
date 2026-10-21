import type { CvMaster, JobType, Level, TemplateId } from "@job-radar/shared";

/**
 * Règles du choix des morceaux. Toute modification qui change un CV adapté DOIT changer cette version
 * (les CV déjà adaptés sont alors marqués « à refaire »).
 */
export const CV_RULES_VERSION = "2026-10-21.1";

/** Les deux lignes de technos de la rubrique Compétences (avant les groupes de notions). */
export const SKILL_LINES = { pro: "En entreprise", other: "En projets et formation" } as const;

/** Ce que le choix lit de l'offre (§4.1). */
export type JobForCv = {
  title: string;
  /** Identifiants de compétences (dictionnaire). */
  required: string[];
  niceToHave: string[];
  /** Toutes les compétences du dictionnaire trouvées dans l'annonce. */
  mentioned: string[];
  jobType: JobType;
  isAbridged: boolean;
  /** ai = analyse IA à jour ; dictionary = lu par le dictionnaire seul (tout est alors « exigé »). */
  skillsSource: "ai" | "dictionary";
  /** Écriture de chaque compétence dans l'annonce (« VueJS », « Node JS ») : sert aux remplacements de libellés. */
  forms: Record<string, string>;
  /** Compétences de ton profil Job Radar (identifiants) : ajoutées à la liste des compétences quand l'offre les cite. */
  profileSkills?: string[];
};

export type Reason = { skillId: string; points: number };

export type PickedItem = {
  kind: "bullet" | "project" | "skill" | "title" | "summary" | "hobbies";
  id: string;
  /** Texte court pour l'écran (début de phrase, nom du projet, libellé). */
  label: string;
  score: number;
  reasons: Reason[];
  /** Expérience d'une ligne, groupe d'une compétence. */
  parent?: string;
  rule?: "always" | "ifRelevant";
  level?: Level;
  /** Remis pour remplir la page (place libre), pas pour sa note. */
  fill?: boolean;
  /** Pour les écartés : pourquoi. */
  why?: string;
};

export type RenderModel = {
  template: TemplateId;
  identity: CvMaster["identity"];
  headline: string;
  title: string;
  summary: string;
  experiences: Array<{
    id: string;
    role: string;
    company: string;
    contract: string;
    start: string;
    end: string;
    bullets: Array<{ id: string; text: string }>;
  }>;
  projects: Array<{
    id: string;
    name: string;
    context: string;
    team: string;
    roleNote?: string;
    description: string;
    /** Version courte validée (modèle une colonne, si la place manque). */
    shortDescription?: string;
    technologies: string[];
    /** Lien du projet (dépôt), sans « https:// ». */
    link?: string;
  }>;
  skillGroups: Array<{ id: string; label: string; items: Array<{ skillId: string; label: string }> }>;
  education: Array<{ id: string; start: string; end: string; lines: string[] }>;
  languages: string[];
  hobbies: string[];
};

export type CheckResult = {
  id: number;
  label: string;
  /** null = pas encore vérifié (contrôles du PDF). */
  ok: boolean | null;
  details: string[];
};

export type Substitution = { blockId: string; from: string; to: string };

/** Compétences de l'offre retrouvées dans le texte affiché du CV (ce que lit un logiciel de tri). */
export type CvMatch = {
  /** Compétences de l'offre : exigées + « plus » (sinon toutes celles citées). */
  offer: string[];
  found: string[];
  missing: string[];
  /** Manquantes mais présentes dans le CV complet (écartées par les limites ou la place). */
  notShown: string[];
  percent: number;
};

export interface TailoredCvDraft {
  rulesVersion: string;
  masterHash: string;
  jobHash: string;
  overridesHash: string;
  template: TemplateId;
  sections: RenderModel;
  picked: PickedItem[];
  dropped: PickedItem[];
  substitutions: Substitution[];
  missing: { absent: string[]; onlyCourse: string[]; forbidden: string[] };
  /** Titre construit (métier de l'offre + technos faites en entreprise) ; null = titre du CV complet. */
  builtTitle: string | null;
  /** Compétences de ton profil ajoutées à la liste (citées par l'offre, absentes du CV complet). */
  fromProfile: string[];
  match: CvMatch;
  warnings: string[];
  checks: CheckResult[];
}
