import { describe, expect, it } from "vitest";
import { amountIn, appearsIn, buildReadingPrompt, readJobWithAi } from "./job-reading";
import { OllamaClient } from "./ollama";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
const clientReturning = (answer: unknown, seen?: { body?: any }) =>
  new OllamaClient({
    fetch: async (_u, init) => {
      if (seen) seen.body = JSON.parse(String(init?.body));
      return json({ message: { content: JSON.stringify(answer) } });
    },
  });

// Page Welcome to the Jungle (raccourcie) envoyée par l'extension.
const PAGE = `Trouver un job
THEODO GOVTECH
Développeur/se Fullstack - CDI Paris - Theodo GovTech
Résumé du poste
CDI
Paris
Télétravail occasionnel
Salaire : Non spécifié
Expérience : > 1 an
Descriptif du poste
Tu seras managé(e) par Matthieu, notre CTO qui a plus de 12 ans d’expérience dans la tech.
Hard skills
1 à 2 ans d’expérience en CDI
Stack : TypeScript, React, Node.js, PostgreSQL.`;

const GOOD = {
  titre: "Développeur/se Fullstack - CDI Paris - Theodo GovTech",
  entreprise: "Theodo GovTech",
  ville: "Paris",
  adresse: null,
  departement: null,
  contrat: "CDI",
  teletravail: "hybride",
  salaire_min: null,
  salaire_max: null,
  salaire_periode: "inconnu",
  experience_min_ans: 1,
  competences: ["TypeScript", "React", "Node.js", "PostgreSQL"],
};

describe("lecture d'une annonce par l'IA", () => {
  it("toutes les infos rangées au bon endroit ; consigne stricte, température 0", async () => {
    const seen: { body?: any } = {};
    const { fields } = await readJobWithAi(clientReturning(GOOD, seen), PAGE);
    expect(fields).toEqual({
      title: "Développeur/se Fullstack - CDI Paris - Theodo GovTech",
      company: "Theodo GovTech",
      location: "Paris (75)",
      address: null,
      contractType: "CDI",
      remoteType: "hybrid",
      salaryMin: null,
      salaryMax: null,
      experienceYears: 1,
      skills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
    });
    expect(seen.body.options.temperature).toBe(0);
    expect(seen.body.messages[0].content).toMatch(/JAMAIS l'expérience d'une personne de l'équipe/);
  });

  it("anti-invention : salaire, entreprise, compétence ou expérience absents du texte sont jetés", async () => {
    const invented = {
      ...GOOD,
      entreprise: "Capgemini",
      salaire_min: 45000,
      salaire_max: 50000,
      salaire_periode: "annuel",
      experience_min_ans: 3,
      competences: ["TypeScript", "Kubernetes"],
    };
    const { fields } = await readJobWithAi(clientReturning(invented), PAGE, { company: "Theodo GovTech" });
    expect(fields.company).toBe("Theodo GovTech"); // donnée de la page, en secours
    expect(fields.salaryMin).toBeNull();
    expect(fields.experienceYears).toBeNull();
    expect(fields.skills).toEqual(["TypeScript"]);
  });

  it("salaire mensuel converti en annuel ; journalier (freelance) ignoré", async () => {
    const page = `${PAGE}\nRémunération : 3 500 € brut par mois`;
    const monthly = { ...GOOD, salaire_min: 3500, salaire_max: 3500, salaire_periode: "mensuel" };
    expect((await readJobWithAi(clientReturning(monthly), page)).fields).toMatchObject({ salaryMin: 42000, salaryMax: 42000 });
    const daily = { ...GOOD, salaire_min: 450, salaire_max: 450, salaire_periode: "journalier" };
    expect((await readJobWithAi(clientReturning(daily), `${PAGE}\nTJM 450 €`)).fields.salaryMin).toBeNull();
  });

  it("adresse du lieu de travail (colonne d'infos) gardée si elle est écrite ; inventée → jetée", async () => {
    const page = `${PAGE}\n\nINFOS À CÔTÉ DE L'ANNONCE\nLe lieu de travail\n48 Boulevard des Batignolles, 75017 Paris`;
    const r1 = await readJobWithAi(clientReturning({ ...GOOD, adresse: "48 Boulevard des Batignolles, 75017 Paris" }), page);
    expect(r1.fields).toMatchObject({ address: "48 Boulevard des Batignolles, 75017 Paris", location: "Paris (75)" });
    const r2 = await readJobWithAi(clientReturning({ ...GOOD, adresse: "12 rue de Rivoli, 75004 Paris" }), page);
    expect(r2.fields.address).toBeNull();
  });

  it("utilitaires : libellé et montant retrouvés dans le texte", () => {
    expect(appearsIn("Développeur Fullstack (H/F)", "DEVELOPPEUR FULLSTACK - Paris")).toBe(true);
    expect(appearsIn("Capgemini", PAGE)).toBe(false);
    expect(amountIn(45000, "Salaire : 45 000 € par an")).toBe(true);
    expect(amountIn(45000, "45k€ brut")).toBe(true);
    expect(amountIn(45500, "45,5 K€")).toBe(true);
    expect(amountIn(45000, "Salaire non précisé")).toBe(false);
    expect(buildReadingPrompt("texte", { title: "Dev", company: "Acme" })).toContain("entreprise donnée par la page : Acme");
  });
});
