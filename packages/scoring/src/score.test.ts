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
    expect(DEFAULT_RULES.version).toBe("2026-10-22.2");
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

  it("« Architecte » avec peu d'années demandées n'est pas un poste de lead", () => {
    const few = score({ ...PERFECT, title: "Architecte Fullstack", experienceMinYears: 2 });
    expect(few.breakdown.experience).toBe(100);
    expect(few.hidden).toBe(false);
    const unknown = score({ ...PERFECT, title: "Architecte Fullstack", experienceMinYears: null });
    expect(unknown.warnings).toContain("Poste de lead / architecte / manager");
    expect(score({ ...PERFECT, title: "Architecte Lead Java", experienceMinYears: 2 }).breakdown.experience).toBe(15);
  });

  it("compétences de l'IA reconnues par leurs synonymes (Fullstack, Architecture technique, Tests automatisés)", () => {
    const profile = { ...DEFAULT_PROFILE, skills: ["Développement Fullstack", "Architecture logicielle", "Tests unitaires"], projectSkills: [] };
    const r = scoreJob({ ...PERFECT, aiSkills: { required: ["Fullstack", "Architecture technique", "Tests automatisés"], bonus: [] } }, profile);
    expect(r.missingSkills).toEqual([]);
    expect(r.breakdown.technical).toBe(100);
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

  it("formation proposée : une techno à apprendre ne compte pas dans les compétences exigées manquantes (lecture de l'IA)", () => {
    const java = { ...DEFAULT_PROFILE, skills: ["Java", "Spring Boot", "TypeScript"] };
    const t = (description: string, required: string[], profile: Profile = java) =>
      score({ ...PERFECT, title: "Développeur Java / Angular", description, experienceMinYears: 2, aiSkills: { required, bonus: [] } }, profile);
    const trained = t("Java et Angular. Formation Angular assurée.", ["Java", "Angular"]);
    expect(trained.final).toBeGreaterThan(DEFAULT_RULES.weakFitCap);
    expect(trained.toLearn).toEqual(["Angular"]);
    expect(trained.reasons).toContain("À apprendre (formation proposée) : Angular");
    expect(t("Java, Angular et Go. Formation interne assurée.", ["Java", "Angular", "Go"]).weakFit).toEqual([]);
    // Sans formation : les deux manquent vraiment → adéquation faible, plafond 40.
    const plain = t("Java, Angular et Go.", ["Java", "Angular", "Go"]);
    expect(plain.weakFit).toEqual(["compétences exigées manquantes : Angular, Go"]);
    expect(plain.final).toBeLessThanOrEqual(DEFAULT_RULES.weakFitCap);
  });

  it("au plus 3 technos à apprendre comptées à moitié, les plus importantes ; les suivantes manquent", () => {
    const java = { ...DEFAULT_PROFILE, skills: ["Java"] };
    const r = score(
      {
        ...PERFECT,
        title: "Développeur Java",
        description: "Formation interne assurée.",
        experienceMinYears: 2,
        aiSkills: { required: ["Java", "Angular", "Go", "Kotlin", "Rust"], bonus: [] },
      },
      java,
    );
    expect(r.toLearn).toEqual(["Angular", "Go", "Kotlin"]);
    expect(r.warnings).toContain("Trop de technos à apprendre (3 au plus comptées à moitié), manquantes : Rust");
    // Java du titre (× 3) + 3 technos à apprendre (3 × 0,5) sur 7 ; sans limite : 5 / 7 = 71 %.
    expect(r.breakdown.technical).toBe(64);
  });

  it("ta liste « je peux l'apprendre vite » : comptée à moitié sans formation écrite, sauf maîtrise exigée", () => {
    const learner = { ...DEFAULT_PROFILE, skills: ["Java"], learnableSkills: ["Angular"] };
    const t = (description: string) => score({ ...PERFECT, title: "Développeur Java / Angular", description, experienceMinYears: null }, learner);
    const plain = t("Java et Angular.");
    expect(plain.breakdown.technical).toBe(75);
    expect(plain.capLabel).toBeNull();
    expect(plain.reasons).toContain("À apprendre (dans ta liste « je peux l'apprendre vite ») : Angular");
    const mastery = t("Java. Maîtrise d'Angular indispensable.");
    expect(mastery.breakdown.technical).toBe(50);
    expect(mastery.final).toBe(DEFAULT_RULES.missingMainTechCap);
  });

  it("techno principale absente de ton profil : score plafonné sous le seuil de l'IA, pas si elle s'apprend", () => {
    const t = (title: string, description: string) => score({ ...PERFECT, title, description, experienceMinYears: null });
    const base = t("Développeur Java / Angular", "Java et Angular.");
    expect(base.final).toBe(DEFAULT_RULES.missingMainTechCap);
    expect(base.capLabel).toBe("techno principale ou exigée que tu n'as pas : Angular");
    expect(t("Développeur Java / Angular junior", "Java et Angular.").final).toBeGreaterThan(DEFAULT_RULES.missingMainTechCap);
  });

  it("direction et web analytics : pas un poste de développement", () => {
    expect(score({ ...PERFECT, title: "Director, Engineering - Vue.js" }).capLabel).toContain("poste de direction");
    expect(score({ ...PERFECT, title: "Consultant Web Analytics H/F" }).capLabel).toContain("web analytics");
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
    expect([e(0), e(2), e(3), e(4), e(5), e(7), e(8)]).toEqual([100, 100, 85, 35, 35, 35, 10]);
  });

  it("un poste junior sans années indiquées est très compatible", () => {
    const r = score({ ...PERFECT, title: "Développeur Vue.js Junior", experienceMinYears: null });
    expect(r.breakdown.experience).toBe(100);
  });

  it("niveau donné par la source (« Niveau senior ») : compte quand le titre ne dit rien", () => {
    const r = score({ ...PERFECT, title: "Software engineer fullstack Java/JS", experienceMinYears: null, experienceText: "Niveau senior" });
    expect(r.breakdown.experience).toBe(30);
  });

  it("années lues dans l'annonce (« 2 à 3 ans ») : elles priment sur l'étiquette « Niveau senior » de la source", () => {
    const profile: Profile = { ...DEFAULT_PROFILE, experienceMin: 1, experienceMax: 3 };
    const r = score({ ...PERFECT, title: "Ingénieur en IA générative", experienceMinYears: 2, experienceText: "Niveau senior" }, profile);
    expect(r.breakdown.experience).toBe(100);
    expect(r.warnings).not.toContain("Poste indiqué senior / confirmé");
    // « Senior » dans le titre : compte toujours, années ou pas.
    expect(score({ ...PERFECT, title: "Ingénieur IA Senior", experienceMinYears: 2 }, profile).breakdown.experience).toBe(30);
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
    expect(score({ ...PERFECT, title: "Développeur Java Confirmé H/F", experienceMinYears: null }).hiddenReason).toBe("Poste senior / confirmé");
    expect(score({ ...PERFECT, title: "Développeur Java Confirmé H/F", experienceMinYears: 4 }).hiddenReason).toBe("Poste senior / confirmé");
    expect(score({ ...PERFECT, title: "Senior Frontend Engineer" }).hidden).toBe(true);
    expect(score({ ...PERFECT, title: "Tech Lead Vue.js" }).hiddenReason).toBe("Poste de lead / manager");
    expect(score({ ...PERFECT, title: "Développeur Vue.js (futur lead)" }).hidden).toBe(false);
  });

  it("« confirmé » / « expérimenté » avec des années dans ta cible : ni masqué ni pénalisé ; « senior » et « expert » restent masqués", () => {
    for (const title of ["Développeur Java Confirmé H/F", "Développeur Vue.js expérimenté", "Architecte Java confirmé"]) {
      const r = score({ ...PERFECT, title, experienceMinYears: 2 });
      expect(r.hidden).toBe(false);
      expect(r.breakdown.experience).toBe(100);
    }
    expect(score({ ...PERFECT, title: "Développeur Java Senior", experienceMinYears: 2 }).hiddenReason).toBe("Poste senior / confirmé");
    expect(score({ ...PERFECT, title: "Développeur Java expert", experienceMinYears: 2 }).hiddenReason).toBe("Poste senior / confirmé");
    expect(score({ ...PERFECT, title: "Développeur senior confirmé", experienceMinYears: 2 }).hidden).toBe(true);
  });

  it("salaire sous ton minimum : malus divisé par deux si une formation est proposée", () => {
    const low = (salary: number, description: string) =>
      score({ ...PERFECT, salaryMin: salary, salaryMax: salary, description }).adjustments.find((a) => a.label.startsWith("Salaire"));
    expect(low(36000, "Vue.js et Node.js.")?.points).toBe(-10);
    expect(low(36000, "Vue.js et Node.js. Formation interne assurée.")).toEqual({ label: "Salaire 36k, sous ton minimum (malus réduit : formation proposée)", points: -5 });
    expect(low(30000, "Vue.js et Node.js.")?.points).toBe(-20);
    expect(low(30000, "Vue.js et Node.js. Vous serez formé à nos outils.")?.points).toBe(-10);
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
    // Kafka et AWS sont des outils : sans effet quand l'offre a des langages / frameworks. (2 exigées + ½ plus) / 2,5 = 100 %
    expect(s.breakdown.technical).toBe(100);
    expect(s.matchedSkills).toEqual(expect.arrayContaining(["Java", "Spring Boot", "Vue.js"]));
    expect(s.missingSkills).toEqual(expect.arrayContaining(["Kafka", "AWS"]));
    expect(s.reasons).toContain("Compétences lues par l'IA (« plus » comptés à moitié)");
  });

  it("mots qui ne sont pas des technos ignorés ; synonymes (« Bases de données » = SQL, « REST APIs » = API REST)", () => {
    const profile: Profile = { ...DEFAULT_PROFILE, skills: ["Java", "SQL", "API REST"] };
    const s = scoreJob(
      { ...PERFECT, title: "Développeur Java", aiSkills: { required: ["Java", "Défense", "Cycle en V", "Anglais professionnel", "Bases de données"], bonus: ["REST APIs", "RSE"] } },
      profile,
    );
    expect(s.breakdown.technical).toBe(100);
    expect(s.missingSkills).toEqual([]);
    expect(s.matchedSkills).toEqual(["Java", "SQL", "API REST"]);
  });

  it("langue étrangère exigée (autre que l'anglais) : plafonnée comme une techno principale absente (cas JD.COM)", () => {
    const profile: Profile = { ...DEFAULT_PROFILE, skills: ["Java", "Spring Boot"] };
    const jd = scoreJob({ ...PERFECT, title: "Software Engineer", aiSkills: { required: ["Java", "Spring Boot", "Chinois", "Anglais"], bonus: [] } }, profile);
    expect(jd.final).toBe(DEFAULT_RULES.missingMainTechCap);
    expect(jd.capLabel).toBe("chinois exigé");
    expect(jd.warnings).toContain("Langue exigée : chinois");
    // Sans l'IA : lu dans le texte, avec un niveau tout près ; pas en « un plus ».
    const t = (description: string) => scoreJob({ ...PERFECT, description }, DEFAULT_PROFILE).capLabel;
    expect(t("Vue.js et Node.js. Allemand courant exigé.")).toBe("allemand exigé");
    expect(t("Vue.js et Node.js. Maîtrise du japonais indispensable.")).toBe("japonais exigé");
    expect(t("Vue.js et Node.js.\nL'espagnol serait un plus.")).toBeNull();
    expect(t("Vue.js et Node.js. Anglais courant.")).toBeNull();
    expect(t("Vue.js et Node.js. Clients en Allemagne et en Italie.")).toBeNull();
  });

  it("aucun langage ni framework compté (seulement des outils) : technique plafonnée à 50, note peu fiable (cas Theodo GovTech)", () => {
    const profile: Profile = { ...DEFAULT_PROFILE, skills: ["Java", "SQL"] };
    const s = scoreJob(
      { ...PERFECT, title: "Software Engineer Fullstack", aiSkills: { required: ["Concepts web", "Algorithmique", "Base de données", "Déploiement"], bonus: [] } },
      profile,
    );
    expect(s.breakdown.technical).toBe(DEFAULT_RULES.noCoreTechCap);
    expect(s.warnings).toContain("Note peu fiable : aucune techno principale lue (technique plafonnée à 50 %)");
  });

  describe("exigence au choix « A ou B » (cas réel Wemanity)", () => {
    const WEMANITY: ScoringInput = {
      ...PERFECT,
      title: "Ingénieur Full Stack (Java / Angular / React) (H/F)",
      description: "Profil recherché :\n2 à 5 ans d'expérience en développement\nUne bonne maîtrise de Java (Spring Boot)\nUne expérience significative sur Angular ou React",
      experienceMinYears: 2,
    };
    const me: Profile = { ...DEFAULT_PROFILE, skills: ["Java", "Spring Boot", "React"], projectSkills: ["React"] };

    it("sans l'IA : une seule exigence, remplie par React (en projets, compté à moitié) ; Angular ne bloque plus", () => {
      const s = scoreJob(WEMANITY, me);
      expect(s.capLabel).toBeNull();
      expect(s.reasons).toContain("Exigence au choix, comptée une fois : Angular ou React (tu as React)");
      expect(s.missingSkills).not.toContain("Angular");
      // Java (titre, × 3) + React (titre, × 3, en projets : moitié) + Spring Boot (1) : 5,5 / 7 = 79 %.
      expect(s.breakdown.technical).toBe(79);
      expect(s.notStrong).toEqual(["React"]);
    });

    it("avec la liste de l'IA (« Angular ou React ») : même résultat", () => {
      const s = scoreJob({ ...WEMANITY, aiSkills: { required: ["Java", "Spring Boot", "Angular ou React"], bonus: [] } }, me);
      expect(s.capLabel).toBeNull();
      expect(s.breakdown.technical).toBe(79);
    });

    it("sans React ni Angular : la maîtrise exigée bloque toujours", () => {
      const s = scoreJob(WEMANITY, { ...me, skills: ["Java", "Spring Boot"], projectSkills: [] });
      expect(s.capLabel).toMatch(/^techno principale ou exigée que tu n'as pas : /);
    });
  });

  it("React Native n'est pas React : pas de plafond levé par un ancien classement « en projets » (cas Garance)", () => {
    const me: Profile = { ...DEFAULT_PROFILE, skills: ["React", "TypeScript"], projectSkills: ["React", "TypeScript"] };
    const s = scoreJob(
      {
        ...PERFECT,
        title: "Développeur Frontend Mobile F/H/X",
        description: "Vous maîtrisez React Native, Expo et TypeScript.",
        experienceMinYears: 3,
        aiSkills: { required: ["React Native", "Expo", "TypeScript"], bonus: [], atWork: [], inProjects: ["React Native", "TypeScript"] },
      },
      me,
    );
    expect(s.liftedCaps).toEqual([]);
    expect(s.matchedSkills).not.toContain("React");
    expect(s.missingSkills).toContain("React Native");
    expect(s.warnings).toContain("Techno principale ou exigée que tu n'as pas : React Native (maîtrise exigée)");
  });

  it("plafond levé par la lecture de l'IA : techno que le code croit absente mais rangée « en projets » par l'IA", () => {
    // L'IA a lu « React / Angular » (une barre, pas un « ou ») et l'a rangé « en projets » : tu as React en projets.
    const me: Profile = { ...DEFAULT_PROFILE, skills: ["Java", "React"], projectSkills: ["React"] };
    const input: ScoringInput = { ...PERFECT, title: "Développeur Java / Angular", description: "Java. Maîtrise d'Angular indispensable.", experienceMinYears: 2 };
    const ai = { required: ["Java", "React / Angular"], bonus: [] };
    expect(scoreJob({ ...input, aiSkills: ai }, me).final).toBe(DEFAULT_RULES.missingMainTechCap);
    const lifted = scoreJob({ ...input, aiSkills: { ...ai, atWork: ["Java"], inProjects: ["React / Angular"] } }, me);
    expect(lifted.capLabel).toBeNull();
    expect(lifted.liftedCaps).toEqual(["techno principale ou exigée : Angular (rangée « en projets » par l'IA)"]);
    // Rangée « en projets » alors qu'aucune de ses technos n'est à toi (ancien classement) : rien ne change.
    const stale = scoreJob({ ...input, aiSkills: { required: ["Java", "Angular"], bonus: [], atWork: ["Java"], inProjects: ["Angular"] } }, me);
    expect(stale.final).toBe(DEFAULT_RULES.missingMainTechCap);
  });

  it("sans liste de l'IA : calcul habituel sur le texte", () => {
    const s1 = scoreJob(PERFECT, DEFAULT_PROFILE);
    const s2 = scoreJob({ ...PERFECT, aiSkills: { required: [], bonus: [] } }, DEFAULT_PROFILE);
    expect(s2.breakdown.technical).toBe(s1.breakdown.technical);
  });
});

describe("zone : départements, rayon, télétravail", () => {
  const far = { ...PERFECT, department: "13", travelMinutes: null };
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
  it("département accepté en plus (93, sans recherche dédiée) : dans ta zone ; télétravail complet : partout", () => {
    const stOuen = { ...PERFECT, department: "93" };
    expect(score(stOuen).hidden).toBe(true);
    const r = score(stOuen, { ...DEFAULT_PROFILE, extraDepartments: ["93"] });
    expect(r.hidden).toBe(false);
    expect(r.reasons).toContain("Dans ta zone : Seine-Saint-Denis");
    expect(score({ ...far, remoteType: "remote" }).hidden).toBe(false);
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

describe("stages", () => {
  const profile = { ...DEFAULT_PROFILE, contracts: ["CDI", "Stage"] };
  const stage = (description: string) =>
    score({ ...PERFECT, title: "Stage - Développeur Full Stack Vue.js / Node.js", contractType: "STAGE", experienceMinYears: null, description: `Vue 3, TypeScript, Node.js. ${description}` }, profile);
  const hasLabel = (r: ReturnType<typeof stage>, re: RegExp) => r.adjustments.some((a) => re.test(a.label));

  it("un stage n'est pas « au-dessus de ta cible » : pas d'expérience exigée", () => {
    const r = stage("Rejoins une équipe de 10 personnes.");
    expect(r.breakdown.experience).toBe(100);
    expect(hasLabel(r, /au-dessus/)).toBe(false);
    expect(r.reasons).toContain("Stage : pas d'expérience exigée");
    expect(r.capLabel).toBeNull();
  });

  it("réservé aux étudiants : plafonné, relevé si l'annonce prévoit une embauche", () => {
    const student = stage("Étudiant(e) en école d'ingénieur, tu recherches un stage de fin d'études.");
    expect(student.final).toBe(DEFAULT_RULES.studentOnlyInternshipCap);
    expect(student.capLabel).toContain("stage réservé aux étudiants");

    const hire = stage("Étudiant(e) en école d'ingénieur. Si ton stage se passe bien, nous sommes ouverts à poursuivre en CDI avec toi.");
    expect(hire.final).toBe(DEFAULT_RULES.studentOnlyHireCap);
    expect(hire.capLabel).toContain("à proposer en POEI");
  });

  it("ouvert aux reconversions, ou POEI citée : pas de plafond étudiant", () => {
    expect(stage("Étudiant(e) en école d'ingénieur, en reconversion ou autodidacte.").capLabel).toBeNull();
    const poei = stage("Étudiant(e) en école d'ingénieur. Possible en POEI avec France Travail.");
    expect(poei.capLabel).toBeNull();
    expect(hasLabel(poei, /POEI citée/)).toBe(true);
  });

  it("débouché sur un CDI : bonus", () => {
    const base = stage("Rejoins une équipe de 10 personnes.");
    const hire = stage("Rejoins une équipe de 10 personnes. Stage de pré-embauche.");
    expect(hasLabel(hire, /débouche sur un CDI/)).toBe(true);
    expect(hire.final).toBeGreaterThan(base.final);
  });
});
