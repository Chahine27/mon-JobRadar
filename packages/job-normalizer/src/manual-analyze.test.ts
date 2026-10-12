import { describe, expect, it } from "vitest";
import { analyzeJobText, cleanFullText, cleanPastedText } from "./manual-analyze";

// Extrait réel d'un copier-coller LinkedIn (bloc « À propos de l'offre d'emploi », sans titre ni lieu en tête).
const KOLECTO = `À propos de l’offre d’emploi
Qui sommes-nous ?

Kolecto est une fintech de gestion affiliée au Groupe Crédit Agricole qui simplifie, sécurise et améliore les finances des TPE-PME françaises.

Aujourd’hui, Kolecto, c’est une équipe de 215 personnes en hypercroissance, classée n°1 au [TECH500 ](https://www.linkedin.com/safety/go/?url=https%3A%2F%2Ftech500%2Efr%2F&urlhash=avEk)(classement relayé par [Les Echos](https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fwww%2Elesechos%2Efr)), qui évolue dans un environnement de travail très dynamique, avec des bureaux idéalement situés à Miromesnil (Paris 8e), à 5 min des Champs-Elysées et 10 min de la gare Saint-Lazare.

📌 Notre mission

Travailler chez Kolecto, c'est prendre activement part à un mouvement qui nous dépasse.

🤩 Pourquoi rejoindre Kolecto ?

* Notre politique de télétravail flexible, qui permet jusqu'à 3 jours de télétravail par semaine en France.

🎯 Votre mission

* Contribuer majoritairement au développement backend tout en participant activement au développement frontend, notamment sur des interfaces en React

🕵️‍♂️ Votre profil

* Expérience significative (5+ ans) en développement Fullstack, avec une forte appétence Backend
* Solides compétences en Backend (TypeScript, Node.js)

Notre stack technique

* Backend : Typescript, Node.js, Serverless, Paas, Zod, AWS SQS, EventBridge
* Frontend : Next.js 14, Typescript, React, Tailwind CSS, Zod
* Tests : Vitest, Playwright
* Storage : Postgresql, S3

🙌 Ce que nous offrons

* Tickets restaurant Swile de 11,52 € par jour, pris en charge à 60 %, par Kolecto ;
* Une enveloppe de 150 € par an pour vous équiper et aménager votre espace de travail à domicile ;
* Échange convivial au bureau (café, déjeuner) avec les équipes en poste.`;

describe("lecture d'une annonce collée (sans IA)", () => {
  it("copier-coller LinkedIn réel (Kolecto)", () => {
    const a = analyzeJobText(KOLECTO);
    expect(a.company).toBe("Kolecto");
    expect(a.location).toBe("Paris (75)");
    expect(a.remoteType).toBe("hybrid");
    expect(a.experienceYears).toBe(5);
    // Pas de salaire : les tickets restaurant et l'enveloppe de 150 €/an ne sont pas un salaire.
    expect(a.salaryMin).toBeNull();
    // Le contrat n'est pas écrit dans l'annonce : on ne le devine pas.
    expect(a.contractType).toBeNull();
    // Le titre n'est pas dans ce bloc : on ne l'invente pas.
    expect(a.title).toBeNull();
    expect(a.skills).toEqual(expect.arrayContaining(["TypeScript", "Node.js", "React", "Next.js", "PostgreSQL"]));
    // Liens LinkedIn nettoyés, en-tête de page retiré.
    expect(a.text).not.toMatch(/linkedin\.com|À propos de l’offre/);
    expect(a.text).toContain("classée n°1 au TECH500");
  });

  it("copier-coller depuis le haut de la page LinkedIn : titre, entreprise, lieu", () => {
    const a = analyzeJobText(`Kolecto
Développeur Fullstack TypeScript (H/F)
Paris, Île-de-France, France · Republié il y a 1 semaine · Plus de 100 candidats
Hybride  Temps plein
Postuler
À propos de l’offre d’emploi
Chez Kolecto, nous cherchons un développeur fullstack. CDI. Rémunération : 45 000 € - 55 000 € brut annuel.`);
    expect(a.title).toBe("Développeur Fullstack TypeScript (H/F)");
    expect(a.company).toBe("Kolecto");
    expect(a.location).toBe("Paris (75)");
    expect(a.contractType).toBe("CDI");
    expect(a.salaryMin).toBe(45000);
    expect(a.salaryMax).toBe(55000);
    expect(a.text).not.toMatch(/^Postuler$/m);
  });

  it("formules classiques d'une annonce", () => {
    const a = analyzeJobText(`Acme recrute !
Nous recrutons un Développeur Vue.js (H/F) pour renforcer notre équipe.
Localisation : Compiègne (60)
Type de contrat : Stage de 6 mois
Salaire : 38k€ - 42k€`);
    expect(a.title).toBe("Développeur Vue.js (H/F)");
    expect(a.company).toBe("Acme");
    expect(a.location).toBe("Compiègne (60)");
    expect(a.contractType).toBe("STAGE");
    expect(a.salaryMin).toBe(38000);
  });

  it("reconnaît un libellé de contrat « Alternance / Apprentissage »", () => {
    const a = analyzeJobText("Développeur Web Full Stack\nÉcole Hexagone\nParis (75)\nAlternance / Apprentissage\n15 000 € - 19 999 €");
    expect(a.contractType).toBe("ALTERNANCE");
  });

  it("nettoyage : liens Markdown, lignes vides en trop", () => {
    expect(cleanPastedText("Voir [le site ](https://x.fr/a)\n\n\n\nFin")).toBe("Voir le site\n\nFin");
  });
});

import {
  HELLOWORK_ALCADIA,
  HELLOWORK_ELAP,
  HELLOWORK_STABILIS,
  INDEED_PROTECTLINE,
  LINKEDIN_FELPS,
  LINKEDIN_WORLDGRID,
  WTTJ_OPEN,
} from "./manual-analyze.fixtures";

describe("vraies annonces collées (HelloWork, LinkedIn)", () => {
  it("HelloWork — Stabilis IT (titre collé au lien de l'entreprise, pas de salaire)", () => {
    const a = analyzeJobText(HELLOWORK_STABILIS);
    expect(a.title).toBe("Développeur Java 21 - Spring Boot - Kafka - Finance H/F");
    expect(a.company).toBe("Stabilis IT");
    expect(a.location).toBe("Paris (75)");
    expect(a.contractType).toBe("CDI");
    expect(a.remoteType).toBe("hybrid");
    expect(a.experienceYears).toBe(3);
    // « 50 000 - 58 000 € / an » appartient à une AUTRE offre (bas de page) : ignoré.
    expect(a.salaryMin).toBeNull();
    expect(a.skills).toEqual(expect.arrayContaining(["Java", "Spring Boot", "Kafka"]));
    // Bas de page (formulaire de candidature, nom du CV, offres similaires) retiré.
    expect(a.text).not.toMatch(/CV-EXEMPLE|Groupe Alliance|Coche ou décoche|Super recruteur/);
  });

  it("HelloWork — Alcadia (salaire en puce)", () => {
    const a = analyzeJobText(HELLOWORK_ALCADIA);
    expect(a.title).toBe("Développeur Full Stack Confirmé H/F");
    expect(a.company).toBe("Alcadia Entreprises");
    expect(a.location).toBe("Paris (75)");
    expect(a.contractType).toBe("CDI");
    expect(a.salaryMin).toBe(38000);
    expect(a.salaryMax).toBe(48000);
    expect(a.experienceYears).toBe(5);
    expect(a.skills).toEqual(expect.arrayContaining(["Angular", "PostgreSQL"]));
  });

  it("HelloWork — ELAP (salaire dans le texte en K€)", () => {
    const a = analyzeJobText(HELLOWORK_ELAP);
    expect(a.title).toBe("Developpeur PHP - Paris H/F");
    expect(a.company).toBe("ELAP");
    expect(a.location).toBe("Paris (75)");
    expect(a.contractType).toBe("CDI");
    expect(a.salaryMin).toBe(35000);
    expect(a.salaryMax).toBe(40000);
    expect(a.experienceYears).toBe(1);
    expect(a.skills).toEqual(expect.arrayContaining(["PHP", "JavaScript"]));
  });

  it("LinkedIn — Felps Group (titre dans une phrase « nous recherchons un … »)", () => {
    const a = analyzeJobText(LINKEDIN_FELPS);
    expect(a.title).toBe("Développeur React senior");
    expect(a.company).toBe("Felps Group");
    expect(a.location).toBe("Paris (75)");
    expect(a.experienceYears).toBe(5);
    expect(a.contractType).toBeNull();
    expect(a.skills).toEqual(expect.arrayContaining(["React", "TypeScript"]));
  });

  it("LinkedIn — Worldgrid (titre « en tant que … », faute de frappe « Vu.js »)", () => {
    const a = analyzeJobText(LINKEDIN_WORLDGRID);
    expect(a.title).toBe("Développeur Web Python / Vu.js");
    expect(a.company).toBe("Worldgrid");
    expect(a.location).toBeNull();
    expect(a.experienceYears).toBe(3);
    expect(a.skills).toEqual(expect.arrayContaining(["Python", "Vue.js", "TypeScript", "SQL"]));
  });

  it("Indeed — Protectline (code postal, « par an », expérience de l'entreprise ignorée)", () => {
    const a = analyzeJobText(INDEED_PROTECTLINE);
    expect(a.title).toBe("Développeur Full Stack confirmé - Noisy le Grand - H/F");
    expect(a.company).toBe("Protectline");
    expect(a.location).toBe("Noisy-le-Grand (93)");
    expect(a.contractType).toBe("CDI");
    expect(a.remoteType).toBe("hybrid");
    expect(a.salaryMin).toBe(60000);
    expect(a.salaryMax).toBe(60000);
    // « expérience de plus de 20 ans en la matière » parle de l'entreprise, pas du poste.
    expect(a.experienceYears).toBe(10);
    expect(a.skills).toEqual(expect.arrayContaining(["Java", "Spring Boot", "Angular", "Docker", "Kubernetes"]));
    // « Postuler maintenant » (en haut de page) ne coupe pas l'annonce.
    expect(a.text).toContain("Lieu du poste");
  });

  it("Welcome to the Jungle — Open (entreprise au-dessus du titre, ville sous le contrat)", () => {
    const a = analyzeJobText(WTTJ_OPEN);
    expect(a.title).toBe("Développeur Java Full Stack (H/F)");
    expect(a.company).toBe("Open");
    expect(a.location).toBe("Levallois-Perret (92)");
    expect(a.contractType).toBe("CDI");
    expect(a.remoteType).toBe("hybrid");
    expect(a.salaryMin).toBeNull();
    expect(a.experienceYears).toBe(5);
    expect(a.skills).toEqual(expect.arrayContaining(["Java", "React", "Angular"]));
    expect(a.text).not.toMatch(/^(Sauvegarder|Partager|Postuler|Cette offre vous tente \?)$/m);
  });
});

// Copier-coller d'une page d'offre Adzuna (Ctrl + A) pour compléter l'extrait donné par l'API.
const ADZUNA_PAGE = `adzuna
Quoi?
Où?
Rechercher
Recherche avancée
Développeur junior Java / Angular F/H
TALAN
PARIS 16, 75116
A partir de 36 k€ brut annuel
NOUVEAU
Postuler à ce poste
Vous ne cherchez pas juste un poste. Vous cherchez un terrain de jeu technique.
Stack technique
Backend : Java (8, 11, 17 ou 21), Java EE, Spring Boot
Frontend : Angular (18+), TypeScript
Minimum 1 ans d'expérience en développement Java Full Stack (Java / Angular)
Postuler à ce poste
Stats pour cet emploi
Comparaison de salaire:
Postes similaires
Développeur Java Angular Junior F/H`;

describe("compléter une offre avec l'annonce complète", () => {
  it("retire le haut de page (jusqu'au bouton Postuler) et le bas (stats, postes similaires)", () => {
    const t = cleanFullText(ADZUNA_PAGE);
    expect(t.startsWith("Vous ne cherchez pas juste un poste.")).toBe(true);
    expect(t).toContain("Minimum 1 ans d'expérience");
    expect(t).not.toMatch(/Rechercher|Stats pour cet emploi|Postes similaires|Postuler/);
    expect(analyzeJobText(t).experienceYears).toBe(1);
  });

  it("sans bouton Postuler en haut : texte gardé en entier", () => {
    expect(cleanFullText("Ligne 1\nLigne 2\nLigne 3")).toBe("Ligne 1\nLigne 2\nLigne 3");
  });
});
