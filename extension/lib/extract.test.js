import { describe, expect, it } from "vitest";
import { analyzeJobText } from "../../packages/job-normalizer/src/manual-analyze.ts";
import { buildPayload, findJobPosting, htmlToText, indeedJobUrl, linkedinJobUrl } from "./extract.js";
import { INDEED_SEARCH_PAGE } from "./indeed.fixture.js";

const base = { url: "https://example.com/offre/1", host: "example.com", pageTitle: "", h1: "", selection: "", jsonLd: [], headerTitle: "", headerCompany: "", headerText: "", descriptionText: "", mainText: "", sideText: "" };
const LONG = "Nous recherchons un développeur Vue.js / TypeScript pour notre équipe produit. ".repeat(4);

describe("extension — lecture de la page d'une offre", () => {
  it("données structurées JobPosting (Welcome to the Jungle, HelloWork, sites carrières)", () => {
    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Autre" },
        {
          "@type": "JobPosting",
          title: "Développeur Java Full Stack (H/F)",
          hiringOrganization: { "@type": "Organization", name: "Open" },
          jobLocation: { address: { addressLocality: "Levallois-Perret", postalCode: "92300" } },
          employmentType: "CDI",
          baseSalary: { currency: "EUR", value: { minValue: 45000, maxValue: 55000, unitText: "YEAR" } },
          description: "<p>Le poste</p><ul><li>Java &amp; Angular</li><li>Scrum</li></ul>",
        },
      ],
    });
    const p = buildPayload({ ...base, jsonLd: ["{ pas du json", jsonLd] });
    expect(p.hints).toEqual({
      title: "Développeur Java Full Stack (H/F)",
      company: "Open",
      location: "Levallois-Perret (92)",
      contractType: "CDI",
      salaryMin: 45000,
      salaryMax: 55000,
    });
    expect(p.text).toContain("* Java & Angular");
  });

  it("LinkedIn : titre et entreprise lus dans le titre de l'onglet, description dans son bloc", () => {
    const p = buildPayload({
      ...base,
      host: "www.linkedin.com",
      pageTitle: "(3) Développeur Fullstack TypeScript | Kolecto | LinkedIn",
      descriptionText: LONG,
      mainText: "Autres offres qui pourraient vous intéresser… (ne doit pas être pris)",
    });
    expect(p.hints.title).toBe("Développeur Fullstack TypeScript");
    expect(p.hints.company).toBe("Kolecto");
    expect(p.text.startsWith("Développeur Fullstack TypeScript\nKolecto")).toBe(true);
    expect(p.text).not.toContain("Autres offres");
  });

  it("le texte sélectionné par l'utilisateur est prioritaire", () => {
    const p = buildPayload({ ...base, h1: "Mon titre", selection: LONG, mainText: "tout le reste de la page" });
    expect(p.text).toContain("développeur Vue.js");
    expect(p.text).not.toContain("tout le reste");
    expect(p.hints.title).toBe("Mon titre");
  });

  it("salaires mensuels convertis, autre devise ou taux horaire ignorés", () => {
    const job = (baseSalary) => JSON.stringify({ "@type": "JobPosting", title: "Dev", baseSalary });
    expect(buildPayload({ ...base, jsonLd: [job({ currency: "EUR", value: { value: 3000, unitText: "MONTH" } })] }).hints.salaryMin).toBe(36000);
    expect(buildPayload({ ...base, jsonLd: [job({ currency: "USD", value: { value: 90000, unitText: "YEAR" } })] }).hints.salaryMin).toBeNull();
    expect(buildPayload({ ...base, jsonLd: [job({ currency: "EUR", value: { value: 15, unitText: "HOUR" } })] }).hints.salaryMin).toBeNull();
  });

  it("utilitaires", () => {
    expect(findJobPosting(['[{"@type":"WebPage"},{"@type":["JobPosting"],"title":"X"}]'])?.title).toBe("X");
    expect(htmlToText("a<br>b&nbsp;c &#233;")).toBe("a\nb c é");
  });

  it("HelloWork (CGI) : description complète de la fiche + haut de page (lieu, contrat, télétravail)", () => {
    const description =
      "<p>Développeur(euse) JavaScript - automaticien(ne) de tests Playwright F/H</p><p>Description de poste</p><p>Nous rejoindre, c'est intégrer une communauté technique animée.</p><ul><li>Maîtrise de JavaScript, idéalement Node.js</li><li>La connaissance de Playwright est indispensable</li></ul><p>Flexibilité grâce à notre accord télétravail (jusqu'à 3 jours de télétravail par semaine).</p>";
    const jsonLd = JSON.stringify({
      "@type": "JobPosting",
      title: "Développeur Javascript - Automaticien de Tests Playwright H/F",
      hiringOrganization: { name: "CGI" },
      jobLocation: { address: { postalCode: "75000", addressRegion: "Île-de-France" } },
      employmentType: "FULL_TIME",
      description,
    });
    const mainText = [
      "Le job",
      "L'entreprise",
      "Postuler",
      "Développeur Javascript - Automaticien de Tests Playwright H/F",
      "CGI",
      "Paris - 75 · CDI",
      "Estimation Hellowork → 37 900 - 65 000 € / an",
      "ESN",
      "Télétravail partiel",
      "Bac +3, Bac +4 · Bac +5",
      "À noter sur ce job",
      "Détail du poste",
      "Développeur(euse) JavaScript - automaticien(ne) de tests Playwright F/H",
      "Description de poste (tronquée par « Voir plus »)…",
      "Envoyez votre candidature",
      "Ces offres pourraient aussi vous intéresser",
      "Frontend Typescript H/F",
      "Créteil - 94",
      "45 000 - 55 000 € / an",
    ].join("\n");
    const p = buildPayload({ ...base, host: "www.hellowork.com", jsonLd: [jsonLd], mainText });
    expect(p.hints.location).toBe("Paris (75)");
    expect(p.text).toContain("Paris - 75 · CDI");
    expect(p.text).toContain("Playwright est indispensable");

    const a = analyzeJobText(p.text);
    expect(a.location).toBe("Paris (75)");
    expect(a.contractType).toBe("CDI");
    expect(a.remoteType).toBe("hybrid");
    // L'estimation HelloWork n'est pas le salaire de l'annonce ; les offres du bas de page non plus.
    expect(a.salaryMin).toBeNull();
    expect(a.skills).toEqual(expect.arrayContaining(["JavaScript", "Node.js", "Playwright"]));
  });
});

describe("Indeed : liste des offres + offre affichée à droite", () => {
  const indeed = { ...base, host: "fr.indeed.com", url: "https://fr.indeed.com/jobs?q=d%C3%A9veloppeur&l=Paris&vjk=0a1b2c3d4e5f6a7b" };

  it("texte de toute la page : seulement l'offre affichée (CGI), sans la liste ni le pied de page", () => {
    const p = buildPayload({ ...indeed, mainText: INDEED_SEARCH_PAGE });
    expect(p.hints.title).toBe("Développeur(euse) JavaScript - automaticien(ne) de tests Playwright F/H");
    expect(p.hints.company).toBe("CGI");
    expect(p.url).toBe("https://fr.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b");
    expect(p.text.startsWith("Développeur(euse) JavaScript - automaticien(ne) de tests Playwright F/H\nCGI")).toBe(true);
    expect(p.text).toContain("La connaissance de Playwright est indispensable");
    expect(p.text).not.toMatch(/Assystem|BNP Paribas|Webnet|Trier par|Hiring Lab|Signaler l'offre|développeur web junior/);

    const a = analyzeJobText(p.text);
    expect(a.title).toBe("Développeur(euse) JavaScript - automaticien(ne) de tests Playwright F/H");
    expect(a.company).toBe("CGI");
    expect(a.location).toMatch(/^Paris/);
    expect(a.contractType).toBe("CDI");
    expect(a.skills).toEqual(expect.arrayContaining(["JavaScript", "Node.js", "Playwright"]));
  });

  it("panneau repéré dans la page : utilisé tel quel (entreprise au nom long)", () => {
    const pane = "Développeur Full Stack Senior / Expert – Java & Kafka (H/F)\nECM - Engineering Conception Maintenance\n75017 Paris\nCDI\nPostuler maintenant\nDescription du poste\n" + LONG + "\nSignaler l'offre\nHiring Lab";
    const p = buildPayload({ ...indeed, paneText: pane, mainText: INDEED_SEARCH_PAGE });
    expect(p.hints).toMatchObject({ title: "Développeur Full Stack Senior / Expert – Java & Kafka (H/F)", company: "ECM - Engineering Conception Maintenance" });
    expect(p.text).not.toContain("Hiring Lab");
  });

  it("panneau avec « entreprise · note » sur une ligne", () => {
    const pane = "Développeur(euse) JavaScript F/H\nCGI · 3.5\nParis (75)\nCDI\nPostuler maintenant\nDescription du poste\n" + LONG;
    expect(buildPayload({ ...indeed, paneText: pane }).hints.company).toBe("CGI");
  });

  it("adresse de l'offre : numéro « vjk » ou « jk », sinon adresse inchangée", () => {
    expect(indeedJobUrl("https://fr.indeed.com/viewjob?jk=abcdef0123456789&from=serp")).toBe("https://fr.indeed.com/viewjob?jk=abcdef0123456789");
    expect(indeedJobUrl("https://fr.indeed.com/jobs?q=dev")).toBe("https://fr.indeed.com/jobs?q=dev");
  });

  it("autre site : aucun changement", () => {
    const p = buildPayload({ ...base, mainText: INDEED_SEARCH_PAGE });
    expect(p.text).toContain("Assystem");
  });
});

describe("Welcome to the Jungle : résumé du poste au-dessus de la description", () => {
  const desc = `Descriptif du poste
L’histoire du groupe Theodo et son succès
Theodo accompagne depuis 2009 les entreprises innovantes dans la conception de produits digitaux.
Tu seras managé(e) par Matthieu, notre CTO qui a plus de 12 ans d’expérience dans la tech.
Profil recherché
Hard skills
1 à 2 ans d’expérience en CDI
Tu maîtrises les concepts web simples et es capable de développer une fonctionnalité sur toute la stack (front, back, BDD).
Voir plus`;
  const main = `Trouver un job
Explorer les entreprises
Retour
THEODO GOVTECH
Développeur/se Fullstack - CDI Paris - Theodo GovTech
Résumé du poste
CDI
Paris
Télétravail occasionnel
Salaire : Non spécifié
Expérience : > 1 an
Éducation : Bac +5 / Master
Postuler
Le poste
${desc}`;

  it("le résumé (télétravail, expérience) est gardé ; l'expérience du CTO n'est pas prise pour celle demandée", () => {
    const p = buildPayload({
      ...base,
      host: "www.welcometothejungle.com",
      headerTitle: "",
      h1: "Développeur/se Fullstack - CDI Paris - Theodo GovTech",
      descriptionText: desc,
      mainText: main,
    });
    expect(p.text).toContain("Télétravail occasionnel");
    expect(p.text).toContain("Expérience : > 1 an");
    const a = analyzeJobText(p.text);
    expect(a.remoteType).toBe("hybrid");
    expect(a.experienceYears).toBe(1);
    expect(a.contractType).toBe("CDI");
  });
});

describe("colonne d'infos à côté de l'annonce", () => {
  it("adresse du lieu de travail et infos entreprise ajoutées à la fin du texte", () => {
    const side = "L'entreprise\nTheodo GovTech\n46 collaborateurs\nLes avantages salariés\nEntre 1-2 jours de télétravail\nLe lieu de travail\n48 Boulevard des Batignolles, 75017 Paris";
    const p = buildPayload({ ...base, host: "www.welcometothejungle.com", descriptionText: LONG, sideText: side });
    expect(p.text).toMatch(/INFOS À CÔTÉ DE L'ANNONCE\nL'entreprise/);
    expect(p.text).toContain("48 Boulevard des Batignolles, 75017 Paris");
    expect(buildPayload({ ...base, descriptionText: LONG }).text).not.toContain("INFOS À CÔTÉ");
  });
});

describe("LinkedIn : seulement la carte du poste et « À propos de l'offre d'emploi »", () => {
  const li = { ...base, host: "www.linkedin.com", pageTitle: "Développeur H/F | LeXi | LinkedIn", url: "https://www.linkedin.com/jobs/search/?currentJobId=4312345678&keywords=dev" };
  const job = "LeXi\nDéveloppeur H/F\nParis, Île-de-France, France · il y a 1 heure\nHybride\nCDD\n\nÀ propos de l'offre d'emploi\n" + LONG;

  it("texte = poste + description, entreprise en infos annexes ; titre et entreprise depuis l'onglet ; adresse propre", () => {
    const p = buildPayload({
      ...li,
      linkedinJob: job,
      linkedinCompany: "À propos de l'entreprise\nLeXi\nServices et conseil en informatique • 11-50 employés",
      mainText: "Plus d'offres d'emploi\nDéveloppeur Fullstack NodeJS / VueJS H/F\nViveris",
    });
    expect(p.hints).toMatchObject({ title: "Développeur H/F", company: "LeXi" });
    expect(p.text).toContain("CDD");
    expect(p.text).toContain("INFOS À CÔTÉ DE L'ANNONCE\nÀ propos de l'entreprise");
    expect(p.text).not.toContain("Viveris");
    expect(p.url).toBe("https://www.linkedin.com/jobs/view/4312345678/");
  });

  it("adresse LinkedIn : numéro « currentJobId » ou /jobs/view/<id>", () => {
    expect(linkedinJobUrl("https://www.linkedin.com/jobs/view/4312345678/?trk=abc")).toBe("https://www.linkedin.com/jobs/view/4312345678/");
    expect(linkedinJobUrl("https://www.linkedin.com/feed/")).toBe("https://www.linkedin.com/feed/");
  });
});
