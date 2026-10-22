import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "@job-radar/shared";
import { getSkill } from "@job-radar/skills";
import { hashProfile } from "./profile-hash";
import { consultingFirm, contractFromText, contractFromTitle, contractOfJob, detectNonDevRole, detectRemote, detectSeniority, looksLikeItTitle, normalizeContract, masteryRequired, parseExperienceYears, trainingOffered,
  hireAfterInternship, internshipOpenToGraduates, jobseekerScheme, studentOnlyInternship,
} from "./signals";

describe("detectSeniority", () => {
  it.each([
    ["Développeur Vue.js Junior H/F", "junior"],
    ["Développeur Senior Java", "senior"],
    ["Développeur confirmé React", "senior"],
    ["Tech Lead Node.js", "lead"],
    ["Architecte logiciel", "lead"],
    ["Stage développeur web", "intern"],
    ["Développeur Full Stack", null],
    ["Développeur Fullstack Node.js / React (futur lead) - CDI", null],
    ["Développeur Vue.js - évolution vers lead dev", null],
    ["Développeur Java à terme tech lead", null],
    ["Tech Lead Fullstack JavaScript", "lead"],
    ["Staff Engineer Back-End", "lead"],
  ] as const)("%s → %s", (title, expected) => {
    expect(detectSeniority(title)).toBe(expected);
  });
});

describe("parseExperienceYears", () => {
  it.each([
    ["3 ans d'expérience", { min: 3, max: null }],
    ["Expérience de 2 à 4 ans sur un poste similaire", { min: 2, max: 4 }],
    ["minimum 5 ans en développement", { min: 5, max: null }],
    ["Vous avez 3-5 ans d'expérience", { min: 3, max: 5 }],
    ["Expérience exigée de 2 An(s)", { min: 2, max: null }],
    ["Débutant accepté", { min: 0, max: null }],
    ["5+ years of experience", { min: 5, max: null }],
  ] as const)("%s", (text, expected) => {
    expect(parseExperienceYears(text)).toEqual(expected);
  });

  it("ignore les nombres sans rapport avec l'expérience", () => {
    expect(parseExperienceYears("Entreprise créée il y a 20 ans, 150 salariés")).toBeNull();
    // Cas réel (Devoteam) : l'ancienneté de l'entreprise, pas l'expérience demandée.
    expect(parseExperienceYears("Forts de 25 ans d’expérience, nous sommes un acteur clé du digital en Europe")).toBeNull();
  });

  it("Welcome to the Jungle (Theodo) : l'expérience du CTO n'est pas celle demandée ; « > 1 an » compris", () => {
    const t = "Hard skills\n1 à 2 ans d’expérience en CDI\nTu seras managé(e) par Matthieu, notre CTO qui a plus de 12 ans d’expérience dans la tech.";
    expect(parseExperienceYears(t)).toEqual({ min: 1, max: 2 });
    expect(parseExperienceYears("Expérience : > 1 an")).toEqual({ min: 1, max: null });
    expect(parseExperienceYears("Nos consultants cumulent 15 ans d'expérience")).toBeNull();
  });

  it("plusieurs mentions → garde la plus exigeante", () => {
    expect(parseExperienceYears("2 ans d'expérience en Vue, 4 ans d'expérience en dev")).toEqual({ min: 4, max: null });
  });
});

describe("normalizeContract", () => {
  it.each([
    ["CDI", "CDI"],
    ["Contrat à durée indéterminée", "CDI"],
    ["CDD", "CDD"],
    ["MIS", "INTERIM"],
    ["Intérim", "INTERIM"],
    ["Alternance", "ALTERNANCE"],
    ["Contrat de professionnalisation", "ALTERNANCE"],
    ["Stage", "STAGE"],
    ["Freelance", "FREELANCE"],
    ["LIB", "FREELANCE"],
    ["", null],
    [null, null],
    ["Autre", null],
  ] as const)("%s → %s", (value, expected) => {
    expect(normalizeContract(value)).toBe(expected);
  });
});

describe("hashProfile", () => {
  it("stable quel que soit l'ordre des clés, différent si le profil change", () => {
    const reordered = Object.fromEntries(Object.entries(DEFAULT_PROFILE).reverse()) as typeof DEFAULT_PROFILE;
    expect(hashProfile(reordered)).toBe(hashProfile(DEFAULT_PROFILE));
    expect(hashProfile({ ...DEFAULT_PROFILE, salaryTarget: 41000 })).not.toBe(hashProfile(DEFAULT_PROFILE));
  });
});

describe("detectRemote", () => {
  it.each([
    ["Poste en 100% télétravail", "remote"],
    ["Full remote possible", "remote"],
    ["Télétravail complet", "remote"],
    ["2 jours de télétravail par semaine", "hybrid"],
    ["Organisation hybride", "hybrid"],
    ["Pas de télétravail", "onsite"],
    ["Poste basé à Compiègne", "unknown"],
  ] as const)("%s → %s", (text, expected) => {
    expect(detectRemote(text)).toBe(expected);
  });
});

describe("detectNonDevRole", () => {
  it.each([
    ["CHEF DE PROJET MOE JAVA / SPRING BOOT (F/H)", "chef de projet"],
    ["Product Owner Data", "product owner / manager"],
    ["Scrum Master", "scrum master / coach agile"],
    ["Développeur Foncier 77 et 93 (H/F)", "développement commercial / immobilier"],
    ["Business Developer IT", "commercial"],
    ["Responsable applicatif", "poste de direction / responsable"],
    ["[Mission] Product designer - PARTAGEONS L'EAU", "design (UX/UI)"],
    ["UX/UI Designer", "design (UX/UI)"],
    ["Développeur Full Stack (H/F)", null],
    ["Développeur Front-end Vue.js & Accessibilité - CDI", null],
    ["Tech Lead Flutter", null],
  ] as const)("%s → %s", (title, expected) => {
    expect(detectNonDevRole(title)).toBe(expected);
  });
});

describe("contractFromTitle", () => {
  it.each([
    ["Développeur React - Freelance", "FREELANCE"],
    ["Développeur .NET (TJM 450€)", "FREELANCE"],
    ["Stage développeur web", "STAGE"],
    ["Développeur Full Stack en alternance", "ALTERNANCE"],
    ["Développeur Java CDD 6 mois", "CDD"],
    ["Développeur Vue.js - CDI", "CDI"],
    ["[Mission] Développeur Vue.js - beta.gouv", "FREELANCE"],
    ["Développeur Vue.js H/F", null],
  ] as const)("%s → %s", (title, expected) => {
    expect(contractFromTitle(title)).toBe(expected);
  });
});

describe("contractFromText", () => {
  it.each([
    ["Alternance / Apprentissage", "ALTERNANCE"],
    ["Type de contrat : Stage de 6 mois", "STAGE"],
    ["Contrat proposé : freelance, TJM 450 €", "FREELANCE"],
    ["CDI ou alternance selon le profil", null],
    ["Temps plein · Télétravail hybride", null],
    ["Contrat : MIS", "INTERIM"],
    ["Tu as mis en place des API REST en Vue.js", null],
    ["Projet d'apprentissage automatique en Python", null],
    ["Développement d'une lib interne de composants", null],
    ["Poste en contrat d'apprentissage, rythme 3 semaines / 1 semaine", "ALTERNANCE"],
    ["Démarche de développement et de professionnalisation de nos pratiques agiles", null],
    ["Poste ouvert en contrat de professionnalisation", "ALTERNANCE"],
    ["Contrat : professionnalisation", "ALTERNANCE"],
    ["- 3 ans d'expérience minimum sur un poste similaire (alternance inclus)", null],
    ["2 ans d'expérience, stages compris", null],
    ["• Contract: CDI (permanent)\n• Also open to: interns (5–6 month internship)", "CDI"],
    // « indépendant » qui décrit l'entreprise ou la personne n'est pas un contrat (cas réel : Néosoft).
    ["Groupe indépendant de conseil en transformation digitale de près de 1800 collaborateurs", null],
    ["Agence indépendante", null],
    ["Vous êtes autonome et indépendant dans votre travail", null],
    ["Mission ouverte aux travailleurs indépendants, TJM selon profil", "FREELANCE"],
    ["Poste sous statut d'indépendant", "FREELANCE"],
    ["Statut : indépendant", "FREELANCE"],
    ["Type de contrat : Indépendant", "FREELANCE"],
    ["Freelance ou portage salarial", "FREELANCE"],
  ] as const)("%s → %s", (text, expected) => {
    expect(contractFromText(text)).toBe(expected);
  });
});

describe("titre informatique ou non", () => {
  it.each([
    ["Développeur Vue.js H/F", true],
    ["Ingénieur logiciel", true],
    ["Intégrateur web", true],
    ["Technicien support informatique", true],
    ["Dessinateur (H/F)", false],
    ["Soudeur", false],
    ["Comptable", false],
    ["Technicien de maintenance", false],
  ])("%s → %s", (title, expected) => {
    expect(looksLikeItTitle(title)).toBe(expected);
  });
});

describe("expérience : l'ancienneté de l'entreprise n'est pas l'expérience demandée", () => {
  it("ignore « expérience de plus de 20 ans en la matière » (entreprise)", () => {
    const text = "Disposant d'une expérience de plus de 20 ans en la matière, Protectline… Vous avez une expérience de 3 ans dans un poste similaire.";
    expect(parseExperienceYears(text)).toEqual({ min: 3, max: null });
  });
});

describe("contractOfJob : la même règle pour le score, l'IA et l'affichage", () => {
  it.each([
    ["source « CDI » par défaut, titre « STAGE »", { contractType: "CDI", title: "STAGE Backend - Pilotage des flux de paiement (H/F)", description: "" }, "STAGE"],
    ["source « CDI », titre en alternance", { contractType: "CDI", title: "Développeur Full Stack en alternance", description: "" }, "ALTERNANCE"],
    ["« (CDD possible) » ne remplace pas un CDI de la source", { contractType: "CDI", title: "Développeur Vue.js (CDD possible)", description: "" }, "CDI"],
    ["rien dans la source ni le titre : la description", { contractType: null, title: "Développeur Java H/F", description: "Type de contrat : CDI" }, "CDI"],
  ] as const)("%s", (_name, job, expected) => {
    expect(contractOfJob(job)).toBe(expected);
  });
});

describe("signaux du score (oct. 2026)", () => {
  it("expérience cumulée de l'équipe ≠ expérience demandée", () => {
    expect(parseExperienceYears("2 Tech Leads with a combined 30 years of experience.")).toBeNull();
  });

  it("« Confirmed » / « Experienced » = poste confirmé", () => {
    expect(detectSeniority("Confirmed Software Engineer (fullstack)")).toBe("senior");
    expect(detectSeniority("Experienced Backend Developer")).toBe("senior");
  });
});

describe("trainingOffered", () => {
  it.each([
    ["Formation Angular assurée à votre arrivée.", true],
    ["Une formation interne complète.", true],
    ["Vous serez formé à nos outils.", true],
    ["Formation : Bac+5 en informatique.", false],
    ["Un onboarding soigné.", false],
    ["Mid carries more ownership of application design, and internal mentoring / task coordination.", false],
    ["Vous assurerez le mentorat des juniors.", false],
    ["Vous bénéficierez d'un mentorat personnalisé.", true],
    ["A structured mentoring program for new hires.", true],
    ["You will be mentored by senior engineers.", true],
    ["Un tuteur dédié vous suivra.", true],
    ["Python, sur lequel tu seras accompagné(e) pour monter en compétence.", true],
    ["Nous vous accompagnons dans votre montée en compétences.", true],
    ["Formation continue assurée sur nos outils.", true],
    ["Contribuer à la montée en compétences collective.", false],
    ["l'accompagnement et la montée en compétence des équipes clientes", false],
    ["Une forte appétence pour monter en compétence sur Kubernetes.", false],
    ["Forte envie de monter en compétence sur Go, montée en compétence rapide.", false],
    ["Formation continue : Accès à Udemy Business.", false],
    ["Accompagnement sur mesure avec votre people manager, parcours d'intégration sur 9 mois.", false],
  ])("« %s » → %s", (text, expected) => expect(trainingOffered(text)).toBe(expected));
});

describe("stages : réservé aux étudiants, débouché, POEI / PMSMP", () => {
  it.each([
    ["Étudiant(e) en École d'Ingénieur, tu recherches un stage de fin d'études.", "etudiant(e) en ecole"],
    ["Vous préparez un diplôme de niveau Bac+5.", "vous preparez un diplome"],
    ["Tous nos stages sont conventionnés.", "stages sont conventionnes"],
    ["Currently pursuing a Master's degree (M1 or M2).", "currently pursuing"],
    ["Vous êtes actuellement en Bac+4 ou Bac+5.", "actuellement en bac"],
    ["Stage de 6 mois en React, rejoins une équipe de 10 personnes.", null],
    ["Une première expérience en développement.", null],
  ])("studentOnlyInternship « %s » → %s", (text, expected) => expect(studentOnlyInternship(text)).toBe(expected));

  it.each([
    ["Étudiant(e), en reconversion ou autodidacte : c'est ce que tu sais faire qui compte.", true],
    ["Currently pursuing or recently graduated in Computer Science.", true],
    ["Étudiant en école d'ingénieur.", false],
  ])("internshipOpenToGraduates « %s » → %s", (text, expected) => expect(internshipOpenToGraduates(text)).toBe(expected));

  it.each([
    ["Si ton stage se passe bien, nous sommes ouverts à poursuivre en CDI avec toi !", "poursuivre en cdi"],
    ["Vous recherchez un stage de pré embauche.", "pre embauche"],
    ["Une vraie perspective d'embauche à la clé.", "perspective d'embauche"],
    ["Commitment: Internship-to-hire.", "internship-to-hire"],
    ["High conversion rate to full time employee.", "conversion rate to full time"],
    ["Toutes les décisions d'embauche demeurent entre les mains du recrutement.", null],
    ["We're proud of the diversity of perspectives.", null],
    ["Télétravail jusqu'à 2 jours pour les contrats en CDI.", null],
  ])("hireAfterInternship « %s » → %s", (text, expected) => expect(hireAfterInternship(text)).toBe(expected));

  it.each([
    ["Poste ouvert en POEI avec France Travail.", "POEI"],
    ["Préparation opérationnelle à l'emploi individuelle avant embauche.", "POEI"],
    ["Une PMSMP de 2 semaines pour découvrir l'équipe.", "PMSMP"],
    ["Recrutement via une AFPR.", "AFPR"],
    ["Stage de 6 mois.", null],
  ])("jobseekerScheme « %s » → %s", (text, expected) => expect(jobseekerScheme(text)).toBe(expected));
});

describe("masteryRequired : des années ne comptent que reliées à la techno", () => {
  const angular = getSkill("angular")!;
  it.each([
    ["Java et Angular, 2 ans d'expérience.", null],
    ["Développeur Java / Angular avec 2 ans d'expérience minimum.", null],
    ["Vous avez 3 ans d'expérience sur Angular.", "3 ans exigés"],
    ["3 ans minimum en Angular.", "3 ans exigés"],
    ["Au moins 4 ans d'expérience sur Java et Angular.", "4 ans exigés"],
    ["Angular : 3 ans minimum.", "3 ans exigés"],
    ["Angular (5 ans) indispensable.", "5 ans exigés"],
    ["Maîtrise d'Angular.", "maîtrise exigée"],
    ["Angular indispensable.", "maîtrise exigée"],
    ["Angular serait un plus.", null],
  ])("« %s » → %s", (text, expected) => expect(masteryRequired(text, angular)).toBe(expected));
});

describe("consultingFirm", () => {
  it.each([
    ["Pour l'un de nos clients grands comptes, nous recherchons…", true],
    ["Vous interviendrez en mission chez nos clients.", true],
    ["Rejoignez notre ESN à taille humaine.", true],
    ["Nous développons notre propre produit SaaS.", false],
  ])("« %s » → %s", (text, expected) => expect(consultingFirm(text)).toBe(expected));
});

describe("stages : formulations vues dans les vraies annonces", () => {
  it.each([
    ["Vous êtes étudiant·e en études supérieures, de niveau Bac+4.", "vous etes etudiante"],
    ["Vous préparez en tant qu'étudiant(e), un bac+ 5.", "en tant qu'etudiant"],
    ["Vous préparez un niveau d'études Bac+5.", "vous preparez un niveau"],
    ["You are a 5th-year student (or equivalent).", "5th-year student"],
    ["Master's or engineering-school student looking for an internship.", "school student"],
    ["L'expérience « CANAL+ STUDENT CLUB ».", null],
    ["Formation Bac +4/5 (école d'ingénieurs, master informatique).", null],
  ])("studentOnlyInternship « %s » → %s", (text, expected) => expect(studentOnlyInternship(text)).toBe(expected));

  it("« convention de stage obligatoire » l'emporte sur « jeune diplômé »", () => {
    expect(internshipOpenToGraduates("Étudiant(e) ou jeune diplômé(e). Convention de stage obligatoire.")).toBe(false);
    expect(internshipOpenToGraduates("Étudiant(e) ou jeune diplômé(e) en informatique.")).toBe(true);
  });
});
