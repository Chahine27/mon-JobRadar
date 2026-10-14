import { describe, expect, it } from "vitest";
import { ANALYSIS_SYSTEM_PROMPT, analyzeJobWithAi, buildAnalysisPrompt } from "./job-analysis";
import { OllamaClient } from "./ollama";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const JOB = {
  title: "Développeur Java Full Stack (H/F)",
  company: "Open",
  city: "Levallois-Perret",
  department: "92",
  contractType: "CDI",
  remoteType: "hybrid",
  salaryMin: null,
  salaryMax: null,
  description: "Pour l'un de nos clients, nous recherchons un développeur Java / Angular. 5 ans minimum. Kubernetes apprécié.",
};
const PROFILE = { skills: ["Vue.js", "TypeScript"], experienceMin: 0, experienceMax: 3, contracts: ["CDI"], locations: ["Oise (60)"] };
const GOOD = {
  resume: "Développeur Java / Angular en mission chez un client d'Open.",
  missions: ["Développer en Java", "Développer en Java", "Faire les interfaces Angular"],
  competences_obligatoires: ["Java", "Angular"],
  competences_bonus: ["Kubernetes", "java"],
  niveau: "confirme",
  experience_min_ans: 5,
  employeur: "esn_ou_cabinet",
  points_attention: ["5 ans demandés", "Mission chez un client"],
  adequation: "faible",
  avis: "Stack Java/Angular éloignée de ton profil Vue.js, et 5 ans demandés.",
};

describe("IA locale (Ollama)", () => {
  it("consigne : profil + annonce, sans rien inventer", () => {
    const p = buildAnalysisPrompt(JOB, PROFILE);
    expect(p).toContain("Compétences EN ENTREPRISE : Vue.js, TypeScript");
    expect(p).toContain("Compétences vues SEULEMENT EN PROJETS (pas en entreprise) : aucune");
    expect(p).toContain("Lieu : Levallois-Perret (92)");
    expect(p).toContain("Salaire : non indiqué");
    expect(p).toContain("Pour l'un de nos clients");
  });

  it("appel à Ollama : format JSON imposé, sans « réflexion », mémoire 8k ; réponse nettoyée", async () => {
    let body: any;
    const client = new OllamaClient({
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return json({ message: { content: "```json\n" + JSON.stringify(GOOD) + "\n```" } });
      },
    });
    const { result, model } = await analyzeJobWithAi(client, JOB, PROFILE);
    expect(body).toMatchObject({ model: "gemma4:e4b", stream: false, think: false, options: { num_ctx: 12_288 } });
    expect(body.format.required).toContain("avis");
    expect(model).toBe("gemma4:e4b");
    expect(result.missions).toEqual(["Développer en Java", "Faire les interfaces Angular"]);
    expect(result.competences_bonus).toEqual(["Kubernetes"]); // « java » est déjà obligatoire
    expect(result.employeur).toBe("esn_ou_cabinet");
  });

  it("cas réel : phrases retirées des compétences, poste trop expérimenté → adéquation faible", async () => {
    const answer = {
      ...GOOD,
      competences_obligatoires: ["Java", "Angular ou React", "5 ans de développement Java en backend", "Angular ou React en front end chez le client final"],
      competences_bonus: ["Kubernetes", "Docker"],
      adequation: "moyenne",
    };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const { result } = await analyzeJobWithAi(client, JOB, PROFILE);
    expect(result.competences_obligatoires).toEqual(["Java", "Angular ou React"]);
    expect(result.adequation).toBe("faible"); // 5 ans demandés, profil jusqu'à 3 ans
  });

  it("extrait (Adzuna) + CV : signalés à l'IA ; niveau du titre prioritaire ; avertissement « incomplète » en tête", async () => {
    const p = buildAnalysisPrompt({ ...JOB, abridged: true }, { ...PROFILE, cv: "Alternance chez Banquo (banque)" });
    expect(p).toContain("EXTRAIT");
    expect(p).toContain("CV DU CANDIDAT");
    expect(p).toContain("Banquo");
    expect(buildAnalysisPrompt(JOB, PROFILE)).not.toMatch(/EXTRAIT|CV DU CANDIDAT/);

    const answer = { ...GOOD, niveau: "senior", points_attention: ["Secteur bancaire", "Annonce incomplète"] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const { result } = await analyzeJobWithAi(client, { ...JOB, title: "Développeur junior Java / Angular F/H", abridged: true }, PROFILE);
    expect(result.niveau).toBe("junior");
    expect(result.points_attention[0]).toMatch(/^Annonce incomplète \(extrait\)/);
    expect(result.points_attention.filter((x) => /incompl/i.test(x))).toHaveLength(1);
  });

  it("consigne : tutoiement et « A ou B » en un seul élément", () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("TUTOYANT");
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("« A ou B »");
  });

  it("listes un peu trop longues ou avec des vides : coupées et nettoyées, pas refusées", async () => {
    const many = Array.from({ length: 18 }, (_, i) => `Outil${i}`);
    const reply = { ...GOOD, competences_obligatoires: many, missions: ["", " Coder ", "x".repeat(250)] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(reply) } }) });
    const { result } = await analyzeJobWithAi(client, JOB, PROFILE);
    expect(result.competences_obligatoires).toHaveLength(15);
    expect(result.missions).toEqual(["Coder", "x".repeat(200)]);
  });

  it("réponse hors format : redemandée une fois, puis erreur claire", async () => {
    let calls = 0;
    const client = new OllamaClient({ fetch: async () => (calls++, json({ message: { content: JSON.stringify({ resume: "x" }) } })) });
    await expect(analyzeJobWithAi(client, JOB, PROFILE)).rejects.toThrow(/hors format/);
    expect(calls).toBe(2);
  });

  it("Ollama éteint / modèle absent : messages simples", async () => {
    const off = new OllamaClient({ fetch: async () => { throw new TypeError("fetch failed"); } });
    await expect(off.chatJson("s", "u", {})).rejects.toThrow(/lance l'appli Ollama/);
    expect(await off.status()).toMatchObject({ available: false });

    const missing = new OllamaClient({ fetch: async () => json({ error: "model not found" }, 404) });
    await expect(missing.chatJson("s", "u", {})).rejects.toThrow(/ollama pull gemma4:e4b/);

    const noModel = new OllamaClient({ fetch: async () => json({ models: [{ name: "llama3:latest" }] }) });
    expect(await noModel.status()).toMatchObject({ available: true, installed: false });
    const ok = new OllamaClient({ fetch: async () => json({ models: [{ name: "gemma4:e4b", model: "gemma4:e4b" }] }) });
    expect(await ok.status()).toMatchObject({ available: true, installed: true });
  });
});

describe("points d'attention sur le contrat", () => {
  it("« Contrat CDD » retiré si le candidat accepte les CDD, gardé sinon", async () => {
    const answer = { ...GOOD, points_attention: ["Contrat CDD", "Le contrat est un CDD.", "Anglais professionnel exigé"] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const withCdd = await analyzeJobWithAi(client, JOB, { ...PROFILE, contracts: ["CDI", "CDD"] });
    expect(withCdd.result.points_attention).toEqual(["Anglais professionnel exigé"]);
    const cdiOnly = await analyzeJobWithAi(client, JOB, PROFILE);
    expect(cdiOnly.result.points_attention).toContain("Le contrat est un CDD.");
  });

  it.each([
    ["STAGE", "Développeur Vue.js — Stage", "Stage"],
    ["ALTERNANCE", "Développeur Vue.js — Alternance", "Alternance"],
  ] as const)("le contrat %s influence l'adéquation et les points d'attention", async (contractType, title, label) => {
    const answer = { ...GOOD, experience_min_ans: null, adequation: "forte", points_attention: [], competences_obligatoires: ["Vue.js"] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const job = { ...JOB, title, contractType };

    const wanted = await analyzeJobWithAi(client, job, { ...PROFILE, contracts: [label] });
    expect(wanted.result.adequation).toBe("forte");
    expect(wanted.result.points_attention).not.toEqual(expect.arrayContaining([expect.stringContaining("Contrat")]));

    const unwanted = await analyzeJobWithAi(client, job, PROFILE);
    expect(unwanted.result.adequation).toBe("faible");
    expect(unwanted.result.points_attention).toContain(`Contrat ${contractType} hors de tes critères (tu cherches : CDI)`);
  });

  it("déduit et pénalise le contrat à partir de l'annonce quand le champ de la source est vide", async () => {
    const answer = { ...GOOD, experience_min_ans: null, adequation: "forte", points_attention: [] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const job = {
      ...JOB,
      title: "Développeur Web Full Stack",
      contractType: null,
      description: "Alternance / Apprentissage\nDurée du contrat : 12 mois",
    };

    expect(buildAnalysisPrompt(job, PROFILE)).toContain("Contrat : ALTERNANCE");
    const { result } = await analyzeJobWithAi(client, job, PROFILE);
    expect(result.adequation).toBe("faible");
    expect(result.points_attention).toContain("Contrat ALTERNANCE hors de tes critères (tu cherches : CDI)");
  });

  it("offre Jus Mundi : profil par niveau, jamais « solides bases » pour une techno vue en projets", async () => {
    const me = {
      ...PROFILE,
      skills: ["Vue.js", "Java", "Spring Boot", "PostgreSQL", "SQL", "Git", "Python", "Docker", "CI/CD", "IA"],
      projectSkills: ["Python", "Docker", "CI/CD", "IA"],
    };
    const job = {
      ...JOB,
      title: "Backend Engineer — Data Platform & AI Agents",
      company: "Jus Mundi",
      description:
        "Must have\n• You have built and run backend services in Python in production.\n• Fluent English, written and spoken.\n\nWhether you're early in your career or a seasoned professional, apply.",
    };
    // Ce qu'a vraiment répondu le modèle sur cette offre.
    const answer = {
      ...GOOD,
      competences_obligatoires: ["Python", "FastAPI", "Postgres", "Docker", "CI/CD", "SQL"],
      niveau: "senior",
      experience_min_ans: 0,
      exigees_en_entreprise: ["Python", "Postgres", "SQL"],
      exigees_en_projets: [],
      exigees_manquantes: ["FastAPI"],
      adequation: "moyenne",
      avis: "Tu as de solides bases en Python, Java et PostgreSQL, ce qui est un bon point de départ, mais l'accent mis sur les LLM nécessite de te former.",
    };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });

    const prompt = buildAnalysisPrompt(job, me);
    expect(prompt).toContain("Compétences EN ENTREPRISE : Vue.js, Java, Spring Boot, PostgreSQL, SQL, Git");
    expect(prompt).toContain("Compétences vues SEULEMENT EN PROJETS (pas en entreprise) : Python, Docker, CI/CD, IA");
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("JAMAIS une « solide base »");

    const { result } = await analyzeJobWithAi(client, job, me);
    expect(result.avis).not.toMatch(/solides? bases? en Python/i);
    expect(result.exigees_en_entreprise).toEqual(["Postgres", "SQL"]);
    expect(result.exigees_en_projets).toEqual(["Python", "Docker", "CI/CD"]);
    expect(result.exigees_manquantes).toEqual(["FastAPI"]);
    expect(result.experience_min_ans).toBeNull(); // aucun nombre d'années écrit
    expect(result.adequation).toBe("faible"); // poste orienté IA, IA vue seulement en projets
  });
});
