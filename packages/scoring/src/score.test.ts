import { DEFAULT_PROFILE, type Profile } from "@job-radar/shared";
import { describe, expect, it } from "vitest";
import { ACCEPTABLE, LOW_SALARY, NOT_CDI, PERFECT, TOO_FAR, TOO_SENIOR } from "./fixtures";
import { DEFAULT_RULES } from "./rules";
import { scoreJob, type ScoringInput } from "./score";

const score = (input: ScoringInput, profile: Profile = DEFAULT_PROFILE) => scoreJob(input, profile);

/**
 * Scores figés (README §32 : « le score ne doit pas changer sans modification explicite des règles »).
 * Si tu modifies les règles : change DEFAULT_RULES.version, puis mets à jour ces valeurs.
 */
describe(`scores figés — règles ${DEFAULT_RULES.version}`, () => {
  it.each([
    ["offre parfaite", PERFECT, 95],
    ["offre acceptable", ACCEPTABLE, 78],
    ["offre trop senior", TOO_SENIOR, 68],
    ["salaire faible", LOW_SALARY, 70],
    ["trop éloignée", TOO_FAR, 65],
    ["non-CDI", NOT_CDI, 0],
  ] as const)("%s", (_name, input, expected) => {
    expect(score(input).final).toBe(expected);
  });

  it("version des règles attendue", () => {
    expect(DEFAULT_RULES.version).toBe("2026-10-10.2");
  });
});

describe("classement des 6 cas", () => {
  it("un salaire faible baisse le score sans le bloquer", () => {
    expect(score(LOW_SALARY).final).toBeLessThan(score(PERFECT).final);
    expect(score(LOW_SALARY).final).toBeGreaterThanOrEqual(DEFAULT_PROFILE.minScoreForNotification);
  });

  it("les critères bloquants (expérience, lieu, contrat) passent sous l'acceptable et sous le seuil de notification", () => {
    const a = score(ACCEPTABLE).final;
    const threshold = DEFAULT_PROFILE.minScoreForNotification;
    expect(score(PERFECT).final).toBeGreaterThan(a);
    expect(a).toBeGreaterThanOrEqual(threshold);
    for (const blocked of [TOO_SENIOR, TOO_FAR, NOT_CDI]) {
      expect(score(blocked).final).toBeLessThan(a);
      expect(score(blocked).final).toBeLessThan(threshold);
    }
  });
});

describe("explications", () => {
  it("offre parfaite : stack principale, bonus détaillés, mots-clés manquants", () => {
    const r = score(PERFECT);
    // Vue.js, Node.js, TypeScript : tout maîtrisé (PostgreSQL et API REST sont des outils, hors calcul).
    expect(r.breakdown.technical).toBe(100);
    expect(r.base).toBe(80);
    expect(r.adjustments).toEqual([
      { label: "Vue.js, ta techno préférée", points: 10 },
      { label: "Salaire 40k–45k, à ta cible ou plus", points: 5 },
    ]);
    expect(r.reasons).toContain("Stack principale (titre) : Vue.js, Node.js");
    expect(r.reasons).toContain("Tu as : TypeScript, Vue.js, Node.js, API REST");
    expect(r.reasons).toContain("CDI");
    expect(r.reasons).toContain("Salaire 40k–45k");
    expect(r.missingSkills).toEqual(["PostgreSQL"]);
    expect(r.warnings).toEqual([
      "Mots-clés absents de ton profil : PostgreSQL — à ajouter au CV si tu les maîtrises",
    ]);
    expect(r.preferredSkills).toEqual(["TypeScript", "Vue.js", "Node.js"]);
    expect(r.hidden).toBe(false);
  });

  it("contrat hors profil : score nul, masquée du flux principal mais gardée", () => {
    const r = score(NOT_CDI);
    expect(r.final).toBe(0);
    expect(r.hidden).toBe(true);
    expect(r.hiddenReason).toBe("Contrat CDD hors profil");
  });

  it("indique le plafond appliqué", () => {
    expect(score(NOT_CDI).warnings[0]).toBe("Score plafonné à 0 % : contrat hors profil");
  });

  it("expérience au-dessus de la cible : malus détaillé", () => {
    expect(score(TOO_SENIOR).adjustments).toContainEqual({ label: "Expérience au-dessus de ta cible", points: -25 });
  });
});

describe("données absentes = neutre, jamais inventées", () => {
  it("salaire, trajet, contrat, expérience inconnus → note neutre + vigilance", () => {
    const r = score({
      ...PERFECT,
      salaryMin: null,
      salaryMax: null,
      travelMinutes: null,
      contractType: null,
      experienceMinYears: null,
      title: "Développeur Vue.js",
    });
    expect(r.breakdown.salary).toBe(50);
    expect(r.breakdown.transport).toBe(DEFAULT_RULES.neutral);
    expect(r.breakdown.contract).toBe(DEFAULT_RULES.neutral);
    expect(r.breakdown.experience).toBe(DEFAULT_RULES.neutral);
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        "Salaire non communiqué",
        "Temps de trajet non calculé",
        "Type de contrat non précisé",
        "Expérience demandée non précisée",
      ]),
    );
    // Inconnu = ni bonus ni malus : seule la techno préférée compte.
    expect(r.adjustments).toEqual([{ label: "Vue.js, ta techno préférée", points: 10 }]);
    expect(r.final).toBe(90);
  });

  it("aucune techno détectée → note technique basse + vigilance", () => {
    const r = score({ ...PERFECT, title: "Développeur H/F", description: "Rejoignez une super équipe." });
    expect(r.breakdown.technical).toBe(DEFAULT_RULES.noSkillsTechnical);
    expect(r.warnings).toContain("Aucune techno détectée : poste peut-être hors informatique");
  });
});

describe("règles détaillées", () => {
  it("pourcentage = technos principales possédées / technos principales de l'offre (outils hors calcul)", () => {
    const t = (description: string) => score({ ...PERFECT, title: "Développeur", description }).breakdown.technical;
    expect(t("Vue.js")).toBe(100);
    expect(t("Vue.js et Angular")).toBe(50);
    expect(t("Vue.js, Angular, Kubernetes")).toBe(50);
    expect(t("Ruby, Kubernetes")).toBe(0);
    // Seulement des outils : ils comptent faute de mieux.
    expect(t("Docker et Kubernetes")).toBe(50);
  });

  it("la stack du titre compte triple", () => {
    const t = (title: string) => score({ ...PERFECT, title, description: "Java et Angular." }).breakdown.technical;
    expect(t("Développeur Java")).toBe(75); // Java ×3 / (Java ×3 + Angular)
    expect(t("Développeur Angular")).toBe(25);
  });

  it("techno manquante : à moitié si junior ou formation proposée, sauf maîtrise exigée", () => {
    const t = (title: string, description: string) =>
      score({ ...PERFECT, title, description, experienceMinYears: null });
    const base = t("Développeur Java / Angular", "Java et Angular.");
    expect(base.breakdown.technical).toBe(50);
    expect(base.warnings).toContain("Techno principale ou exigée que tu n'as pas : Angular");

    const junior = t("Développeur Java / Angular junior", "Java et Angular.");
    expect(junior.breakdown.technical).toBe(75);
    expect(junior.reasons).toContain("À apprendre (poste junior) : Angular");

    const trained = t("Développeur Java / Angular", "Java et Angular. Formation interne assurée à votre arrivée.");
    expect(trained.breakdown.technical).toBe(75);
    expect(trained.reasons).toContain("À apprendre (formation proposée) : Angular");

    const years = t("Développeur Java / Angular junior", "Java. Vous avez 3 ans d'expérience sur Angular.");
    expect(years.breakdown.technical).toBe(50);
    expect(years.warnings).toContain("Techno principale ou exigée que tu n'as pas : Angular (3 ans exigés)");

    const mastery = t("Développeur Java / Angular junior", "Java. Maîtrise d'Angular indispensable.");
    expect(mastery.breakdown.technical).toBe(50);

    // « Formation : Bac+5 » est un diplôme demandé, pas une formation proposée.
    expect(t("Développeur Java / Angular", "Formation : Bac+5 en informatique. Java et Angular.").breakdown.technical).toBe(50);
  });

  it("fonction voisine du développement (support, analyste…) : malus", () => {
    const r = score({ ...PERFECT, title: "Ingénieur support applicatif Vue.js" });
    expect(r.adjustments).toContainEqual({ label: "Fonction à vérifier : support", points: DEFAULT_RULES.sideRolePoints });
  });

  it("tes règles bonus/malus : mot du titre, de l'annonce, entreprise", () => {
    const profile: Profile = {
      ...DEFAULT_PROFILE,
      scoreRules: [
        { kind: "title", value: "angular", points: -30 },
        { kind: "text", value: "secteur bancaire", points: -15 },
        { kind: "company", value: "ACME", points: -50 },
      ],
    };
    const s = (input: Partial<ScoringInput>) => score({ ...PERFECT, ...input }, profile);
    expect(s({ title: "Développeur Angular" }).adjustments).toContainEqual({ label: "Ta règle : « angular » (dans le titre)", points: -30 });
    expect(s({ title: "Développeur rectangular" }).adjustments.some((a) => a.label.includes("angular"))).toBe(false);
    expect(s({ description: "Projet dans le Secteur Bancaire." }).adjustments).toContainEqual({ label: "Ta règle : « secteur bancaire » (dans l'annonce)", points: -15 });
    expect(s({ company: "Acme Consulting" }).final).toBe(score(PERFECT).final - 50);
  });

  it("plus l'offre contient de tes compétences, plus le score monte", () => {
    const base = { ...PERFECT, title: "Développeur" };
    const few = score({ ...base, description: "Vue.js, Angular, Kubernetes, GraphQL" }).final;
    const more = score({ ...base, description: "Vue.js, TypeScript, Docker, GraphQL" }).final;
    expect(more).toBeGreaterThan(few);
  });

  it("stack hors profil : note technique 0, mots-clés listés, score très bas", () => {
    const r = score({ ...PERFECT, title: "Développeur Ruby", description: "API en Ruby on Rails, Kubernetes." });
    expect(r.breakdown.technical).toBe(0);
    expect(r.missingSkills).toEqual(["Ruby", "Kubernetes"]);
    expect(r.final).toBeLessThanOrEqual(10);
    expect(r.warnings).toContain("Techno principale ou exigée que tu n'as pas : Ruby");
  });

  it("les notes s'étalent : stack parfaite ≫ stack à moitié ≫ stack absente", () => {
    const f = (title: string) => score({ ...PERFECT, title, description: "", salaryMin: null, salaryMax: null }).final;
    const full = f("Développeur Vue.js");
    const half = f("Développeur Vue.js / Angular");
    const none = f("Développeur Angular");
    expect(full - half).toBeGreaterThanOrEqual(30);
    expect(half - none).toBeGreaterThanOrEqual(30);
  });

  it("télétravail complet → lieu et trajet au maximum", () => {
    const r = score({ ...TOO_FAR, remoteType: "remote" });
    expect(r.breakdown.location).toBe(100);
    expect(r.breakdown.transport).toBe(100);
  });

  it("trajet : paliers", () => {
    const t = (m: number) => score({ ...PERFECT, travelMinutes: m }).breakdown.transport;
    expect([t(25), t(45), t(60), t(75), t(90), t(120)]).toEqual([100, 85, 65, 40, 20, 5]);
  });

  it("expérience : paliers pour une cible de 1 à 3 ans", () => {
    const e = (y: number) =>
      score({ ...PERFECT, title: "Développeur", experienceMinYears: y }).breakdown.experience;
    expect([e(0), e(2), e(3), e(4), e(5), e(7), e(8)]).toEqual([100, 100, 85, 65, 35, 35, 10]);
  });

  it("un poste junior sans années indiquées est très compatible", () => {
    const r = score({ ...PERFECT, title: "Développeur Vue.js Junior", experienceMinYears: null });
    expect(r.breakdown.experience).toBe(100);
  });

  it("niveau donné par la source (« Niveau senior ») : compte quand le titre ne dit rien", () => {
    const r = score({ ...PERFECT, title: "Software engineer fullstack Java/JS", experienceMinYears: null, experienceText: "Niveau senior" });
    expect(r.breakdown.experience).toBe(30);
  });

  it("une compétence ajoutée au profil est reconnue et fait monter le score", () => {
    const profile: Profile = { ...DEFAULT_PROFILE, skills: [...DEFAULT_PROFILE.skills, "Quasar"] };
    const r = score({ ...PERFECT, title: "Développeur Quasar", description: "Front Quasar." }, profile);
    expect(r.breakdown.technical).toBe(100);
  });

  it("« futur lead » n'est pas un poste de lead", () => {
    const r = score({ ...PERFECT, title: "Développeur Fullstack Node.js / React (futur lead) - CDI" });
    expect(r.breakdown.experience).toBe(100);
    expect(r.warnings.some((w) => w.startsWith("Score plafonné"))).toBe(false);
    expect(r.final).toBeGreaterThanOrEqual(90);
  });

  it("poste qui n'est pas du développement → plafonné, avec la raison", () => {
    const r = score({ ...PERFECT, title: "Chef de projet MOE Java / Spring Boot" });
    expect(r.final).toBe(DEFAULT_RULES.nonDevRoleCap);
    expect(r.warnings[0]).toMatch(/^Score plafonné à 35 % : pas un poste de développement \(chef de projet\)/);
    const foncier = score({ ...PERFECT, title: "Développeur Foncier 77 et 93", description: "Prospection de terrains." });
    expect(foncier.final).toBeLessThanOrEqual(35);
  });

  it("contrat lu dans le titre quand la source ne le donne pas", () => {
    const r = score({ ...PERFECT, contractType: null, title: "Développeur Vue.js - Freelance" });
    expect(r.hidden).toBe(true);
    expect(r.hiddenReason).toBe("Contrat FREELANCE hors profil");
    const cdi = score({ ...PERFECT, contractType: null, title: "Développeur Vue.js (CDI)" });
    expect(cdi.breakdown.contract).toBe(100);
    // « Freelance » dans le titre l'emporte sur le contrat de la source (Adzuna : « contract » → CDD).
    expect(score({ ...PERFECT, contractType: "CDD", title: "Développeur .NET/React.JS - Freelance" }).hiddenReason).toBe(
      "Contrat FREELANCE hors profil",
    );
    // Pour les autres mentions, le contrat de la source reste prioritaire.
    expect(score({ ...PERFECT, contractType: "CDI", title: "Développeur Vue.js (CDD possible)" }).breakdown.contract).toBe(100);
  });

  it.each([
    ["STAGE", "Stage"],
    ["ALTERNANCE", "Alternance"],
  ] as const)("le contrat %s est accepté et noté depuis le profil", (contractType, label) => {
    const profile = { ...DEFAULT_PROFILE, contracts: [label] };
    const matching = score({ ...PERFECT, contractType }, profile);
    expect(matching.breakdown.contract).toBe(100);
    expect(matching.hidden).toBe(false);

    const notMatching = score({ ...PERFECT, contractType }, DEFAULT_PROFILE);
    expect(notMatching.breakdown.contract).toBe(10);
    expect(notMatching.final).toBe(0);
    expect(notMatching.hiddenReason).toBe(`Contrat ${contractType} hors profil`);
  });

  it("détecte un contrat dans la description si la source ne remplit pas le champ", () => {
    const r = score({
      ...PERFECT,
      contractType: null,
      title: "Développeur Web Full Stack",
      description: "Alternance / Apprentissage\nDurée du contrat : 12 mois",
    });
    expect(r.breakdown.contract).toBe(10);
    expect(r.final).toBe(0);
    expect(r.hiddenReason).toBe("Contrat ALTERNANCE hors profil");
  });

  it("postes senior / confirmé / lead masqués du flux principal", () => {
    expect(score({ ...PERFECT, title: "Développeur Java Confirmé H/F" }).hiddenReason).toBe("Poste senior / confirmé");
    expect(score({ ...PERFECT, title: "Senior Frontend Engineer" }).hidden).toBe(true);
    expect(score({ ...PERFECT, title: "Tech Lead Vue.js" }).hiddenReason).toBe("Poste de lead / manager");
    expect(score({ ...PERFECT, title: "Développeur Vue.js (futur lead)" }).hidden).toBe(false);
  });

  it("un « salaire » sous 8 000 € (taux journalier) est ignoré", () => {
    const r = score({ ...PERFECT, salaryMin: 450, salaryMax: 550 });
    expect(r.breakdown.salary).toBe(50);
    expect(r.warnings).toContain("Salaire non communiqué");
  });

  it("plus de 4 ans d'expérience demandés → masquée", () => {
    expect(score({ ...PERFECT, title: "Développeur", experienceMinYears: 4 }).hidden).toBe(false);
    expect(score({ ...PERFECT, title: "Développeur", experienceMinYears: 5 }).hiddenReason).toBe("Demande 5 ans d'expérience");
  });

  it("déterministe : même entrée → même résultat", () => {
    expect(score(ACCEPTABLE)).toEqual(score(ACCEPTABLE));
  });
});

describe("offres hors informatique (aucune techno + titre sans rapport)", () => {
  const offTopic: ScoringInput = {
    title: "Dessinateur (H/F)",
    description: "Mobilité pour des déplacements ponctuels sur chantier. Contrat : CDI. Perspectives d'évolution.",
    contractType: null,
    experienceMinYears: null,
    salaryMin: null,
    salaryMax: null,
    department: "60",
    remoteType: "unknown",
    travelMinutes: null,
  };

  it("« Dessinateur » dans ta zone : plafonné à 15 % et masqué", () => {
    const s = scoreJob(offTopic, DEFAULT_PROFILE);
    expect(s.final).toBeLessThanOrEqual(DEFAULT_RULES.offTopicCap);
    expect(s.hidden).toBe(true);
    expect(s.hiddenReason).toBe("Pas un poste informatique");
    expect(s.warnings[0]).toMatch(/titre sans rapport avec l'informatique/);
  });

  it("titre de développeur avec un extrait trop court (aucune techno) : ni plafonné ni masqué", () => {
    const s = scoreJob({ ...offTopic, title: "Développeur web (H/F)" }, DEFAULT_PROFILE);
    expect(s.hidden).toBe(false);
    expect(s.final).toBeGreaterThan(DEFAULT_RULES.offTopicCap);
  });

  it("une techno dans l'annonce suffit à ne pas être hors sujet", () => {
    const s = scoreJob({ ...offTopic, title: "Chargé d'études", description: "Vous utiliserez Python au quotidien." }, DEFAULT_PROFILE);
    expect(s.hiddenReason).not.toBe("Pas un poste informatique");
  });
});

describe("critère Technique calculé sur les compétences lues par l'IA", () => {
  it("exigées = poids 1, « plus » = poids ½ ; libellés de l'IA reconnus (« Java 21 » = Java) ; détail cohérent", () => {
    const profile: Profile = { ...DEFAULT_PROFILE, skills: ["Java", "Spring Boot", "Vue.js"] };
    const input = { ...PERFECT, aiSkills: { required: ["Java 21", "Spring Boot", "Kafka"], bonus: ["AWS", "Vue.js"] } };
    const s = scoreJob(input, profile);
    // (2 exigées + ½ × 1 plus) / (3 + ½ × 2) = 2,5 / 4 = 63 %
    expect(s.breakdown.technical).toBe(63);
    expect(s.matchedSkills).toEqual(expect.arrayContaining(["Java", "Spring Boot", "Vue.js"]));
    expect(s.missingSkills).toEqual(expect.arrayContaining(["Kafka", "AWS"]));
    expect(s.reasons).toContain("Compétences lues par l'IA (« plus » comptés à moitié)");
  });

  it("sans liste de l'IA : calcul habituel sur le texte", () => {
    const s1 = scoreJob(PERFECT, DEFAULT_PROFILE);
    const s2 = scoreJob({ ...PERFECT, aiSkills: { required: [], bonus: [] } }, DEFAULT_PROFILE);
    expect(s2.breakdown.technical).toBe(s1.breakdown.technical);
  });
});

describe("zone : départements, rayon, télétravail", () => {
  const far = { ...PERFECT, department: "13" };
  it("hors zone → masquée (sauf télétravail ou lieu inconnu)", () => {
    expect(score(far).hidden).toBe(true);
    expect(score({ ...far, remoteType: "remote" }).hidden).toBe(false);
    expect(score({ ...far, department: null }).hidden).toBe(false);
  });
  it("le rayon autour du point de départ remet une offre dans la zone", () => {
    const withRadius = { ...DEFAULT_PROFILE, searchRadiusKm: 30 };
    expect(score({ ...far, distanceKm: 12 }, withRadius).hidden).toBe(false);
    expect(score({ ...far, distanceKm: 80 }, withRadius).hidden).toBe(true);
  });
});

describe("trajet selon le mode", () => {
  it("transports depuis la gare d'arrivée : rien jusqu'à 30 min, puis malus", () => {
    const t = (m: number) => score({ ...PERFECT, travelMinutes: m, travelMode: "transit" }).adjustments.find((a) => a.label.includes("transports"));
    expect(t(30)).toBeUndefined();
    expect(t(40)?.points).toBe(-5);
    expect(t(55)?.points).toBe(-15);
    expect(t(75)?.points).toBe(-25);
  });

  it("voiture depuis le domicile : libellé « en voiture », mêmes paliers qu'avant", () => {
    const r = score({ ...PERFECT, travelMinutes: 55, travelMode: "car" });
    expect(r.adjustments).toContainEqual({ label: "55 min en voiture", points: -5 });
    expect(r.breakdown.transport).toBe(65);
  });
});
