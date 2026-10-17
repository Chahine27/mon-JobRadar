/**
 * Règles du score. Toute modification qui change un résultat DOIT changer `version`
 * (les scores déjà calculés seront alors recalculés, et les tests figés mis à jour).
 *
 * Score = note technique (stack principale de l'offre) ramenée sur `technicalPoints` + bonus/malus en points, borné entre 0 et 100.
 * Une information absente ne donne ni bonus ni malus.
 */
export type ScoringRules = {
  version: string;
  /** Sous-score affiché quand l'information est absente (expérience, contrat, trajet). Sans effet sur le score. */
  neutral: number;
  /** Points apportés par une technique à 100 % : le reste (jusqu'à 100) vient des bonus, pour départager les offres « stack parfaite ». */
  technicalPoints: number;
  /** Une techno de l'offre compte 3 fois plus quand elle est dans le titre (la stack principale). */
  titleWeight: number;
  /** Techno que tu n'as pas, sur un poste junior ou avec formation proposée (sans maîtrise exigée) : comptée à moitié. */
  learnableCredit: number;
  /** Compétence vue seulement en projets (pas en entreprise) : comptée à moitié. */
  projectCredit: number;
  /** Note technique maximum quand la techno principale de l'offre n'est vue qu'en projets. */
  projectOnlyMainCap: number;
  /** Malus quand l'annonce exige un anglais courant / bilingue (ou de candidater en anglais). */
  fluentEnglishPoints: number;
  /** Plafond « adéquation faible » : au moins 2 compétences exigées manquantes, ou poste orienté IA sans IA en entreprise. */
  weakFitCap: number;
  /**
   * Plafond quand la techno principale (titre) ou une techno à maîtrise exigée est absente de ton profil, même en projets
   * (Angular, UiPath, Go…) : sous le seuil d'analyse IA par défaut. Mesuré sur 520 avis de l'IA : 0 « forte » sur 23.
   */
  missingMainTechCap: number;
  /** Masquer du flux principal les contrats hors profil (ils restent en base). */
  hideNonMatchingContract: boolean;
  /** Masquer au-delà de « ton expérience max » + N années demandées (null = jamais masquer, seulement pénaliser). */
  hideYearsOverMax: number | null;
  /** Masquer les postes senior / confirmé / lead / manager (lu dans le titre). */
  hideSenior: boolean;
  /** Note technique quand aucune compétence n'est détectée (souvent un poste hors informatique). */
  noSkillsTechnical: number;
  /** Plafond pour un poste qui n'est pas du développement (chef de projet, commercial...). */
  nonDevRoleCap: number;
  /** Malus pour une fonction voisine du développement (support, analyste, sécurité, test). */
  sideRolePoints: number;
  /** Aucune techno dans l'annonce ET titre sans rapport avec l'informatique (« Dessinateur ») : plafond + masquage. */
  offTopicCap: number;
  hideOffTopic: boolean;
  /** Masquer les offres hors de la zone du profil (départements + rayon). Le télétravail et les lieux inconnus ne sont jamais masqués. */
  hideOutOfZone: boolean;
};

export const DEFAULT_RULES: ScoringRules = {
  version: "2026-10-17.1",
  neutral: 60,
  technicalPoints: 80,
  titleWeight: 3,
  learnableCredit: 0.5,
  projectCredit: 0.5,
  projectOnlyMainCap: 50,
  fluentEnglishPoints: -10,
  weakFitCap: 40,
  missingMainTechCap: 45,
  hideNonMatchingContract: true,
  hideYearsOverMax: 1,
  hideSenior: true,
  noSkillsTechnical: 30,
  nonDevRoleCap: 35,
  sideRolePoints: -20,
  offTopicCap: 15,
  hideOffTopic: true,
  hideOutOfZone: true,
};
