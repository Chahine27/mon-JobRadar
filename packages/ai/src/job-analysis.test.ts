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
/** Profil + annonce envoyés à l'IA, sans la consigne fixe. */
const fullPrompt = (...a: Parameters<typeof buildAnalysisPrompt>) => {
  const p = buildAnalysisPrompt(...a);
  return p.system.replace(ANALYSIS_SYSTEM_PROMPT, "") + p.user;
};
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
    const p = fullPrompt(JOB, PROFILE);
    expect(p).toContain("Compétences EN ENTREPRISE : Vue.js, TypeScript");
    expect(p).toContain("Compétences vues SEULEMENT EN PROJETS (pas en entreprise) : aucune");
    expect(p).toContain("Lieu : Levallois-Perret (92)");
    expect(p).toContain("Salaire : non indiqué");
    expect(p).toContain("Pour l'un de nos clients");
  });

  it("cache : consigne + profil identiques d'une offre à l'autre, l'annonce seulement dans la demande", () => {
    const a = buildAnalysisPrompt(JOB, PROFILE);
    const b = buildAnalysisPrompt({ ...JOB, title: "Développeur Vue.js", description: "Autre annonce." }, PROFILE);
    expect(a.system).toBe(b.system);
    expect(a.system.startsWith(ANALYSIS_SYSTEM_PROMPT)).toBe(true);
    expect(a.system).toContain("Compétences EN ENTREPRISE : Vue.js, TypeScript");
    expect(a.system).not.toContain("Pour l'un de nos clients");
    expect(a.user).toContain("Pour l'un de nos clients");
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
      note: 68.4,
    };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const { result } = await analyzeJobWithAi(client, JOB, PROFILE);
    expect(result.competences_obligatoires).toEqual(["Java", "Angular ou React"]);
    expect(result.adequation).toBe("faible"); // 5 ans demandés, profil jusqu'à 3 ans
    expect(result.note).toBe(40); // la note suit l'adéquation corrigée par le code
  });

  it("extrait (Adzuna) + CV : signalés à l'IA ; niveau du titre prioritaire ; avertissement « incomplète » en tête", async () => {
    const p = fullPrompt({ ...JOB, abridged: true }, { ...PROFILE, cv: "Alternance chez Banquo (banque)" });
    expect(p).toContain("EXTRAIT");
    expect(p).toContain("CV DU CANDIDAT");
    expect(p).toContain("Banquo");
    expect(fullPrompt(JOB, PROFILE)).not.toMatch(/EXTRAIT|CV DU CANDIDAT/);

    const answer = { ...GOOD, niveau: "senior", points_attention: ["Secteur bancaire", "Annonce incomplète"] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const { result } = await analyzeJobWithAi(client, { ...JOB, title: "Développeur junior Java / Angular F/H", abridged: true }, PROFILE);
    expect(result.niveau).toBe("junior");
    expect(result.points_attention[0]).toMatch(/^Annonce incomplète \(extrait\)/);
    expect(result.points_attention.filter((x) => /incompl/i.test(x))).toHaveLength(1);
  });

  it("années : le texte du recruteur (« au moins 4 ans ») l'emporte sur 3 lu par l'IA ; contrat « CDI ou Freelance » souhaité = pas un piège (cas ICARE, FEKRA)", async () => {
    const job = { ...JOB, description: "Fiche : 3 à 5 ans d'expérience. Profil : au moins 4 ans d'expérience en Java. Type de contrat : CDI ou Freelance." };
    const answer = { ...GOOD, experience_min_ans: 3, adequation: "moyenne", points_attention: ["Le contrat indiqué est CDI ou Freelance : le freelance n'est pas dans tes contrats souhaités", "Salaire non indiqué"] };
    const client = new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify(answer) } }) });
    const { result } = await analyzeJobWithAi(client, job, PROFILE);
    expect(result.experience_min_ans).toBe(4);
    expect(result.points_attention).toEqual(["Salaire non indiqué"]);
    // Plusieurs contrats dont aucun n'est souhaité : le piège reste.
    const none = await analyzeJobWithAi(client, job, { ...PROFILE, contracts: ["CDD"] });
    expect(none.result.points_attention).toContain(answer.points_attention[0]);
  });

  it("consigne : « au moins une de A, B ou C » en un seul élément ; avis et années d'accord", () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("au moins une de ces technologies");
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("« CDI ou Freelance »");
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("TOUJOURS celui de experience_min_ans");
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
    const job = { ...JOB, title, contractType, description: "Développeur Vue.js pour un produit interne." }; // sans années écrites (« 5 ans minimum » ferait « faible »)

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

    expect(fullPrompt(job, PROFILE)).toContain("à vérifier dans le texte) : ALTERNANCE");
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

    const prompt = fullPrompt(job, me);
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

  it("contrat, salaire et adresse lus par l'IA : gardés seulement s'ils sont écrits dans l'annonce", async () => {
    const job = { ...JOB, description: `${JOB.description} Salaire : 42 000 € à 48 000 € brut annuel. Lieu : 10 rue de Villiers, 92300 Levallois-Perret.` };
    const read = (extra: object) =>
      analyzeJobWithAi(new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify({ ...GOOD, ...extra }) } }) }), job, PROFILE);
    const { result } = await read({ contrat: "CDI", salaire_min: 42000, salaire_max: 48000, salaire_periode: "annuel", adresse: "10 rue de Villiers, 92300 Levallois-Perret" });
    expect(result).toMatchObject({ contrat: "CDI", salaire_min: 42000, salaire_max: 48000, adresse: "10 rue de Villiers, 92300 Levallois-Perret" });
    // Inventés (absents du texte) : jetés.
    const { result: bad } = await read({ salaire_min: 60000, salaire_max: 70000, salaire_periode: "annuel", adresse: "1 avenue des Champs-Élysées, 75008 Paris" });
    expect(bad).toMatchObject({ salaire_min: null, salaire_max: null, adresse: null });
  });
});

describe("technos à apprendre (formation proposée, poste junior, ta liste)", () => {
  const JAVA = { ...PROFILE, skills: ["Java", "Spring Boot", "TypeScript"] };
  const job = (description: string, title = "Développeur Java / Angular (H/F)") => ({ ...JOB, title, description });
  const read = (j: typeof JOB, extra: object, profile: typeof JAVA & { learnableSkills?: string[] } = JAVA) =>
    analyzeJobWithAi(
      new OllamaClient({ fetch: async () => json({ message: { content: JSON.stringify({ ...GOOD, niveau: "inconnu", experience_min_ans: 2, ...extra }) } }) }),
      j,
      profile,
    ).then((r) => r.result.adequation);

  it("« faible » à cause d'une techno à apprendre seulement : remonté en « moyenne »", async () => {
    const trained = job("Java et Angular. 2 ans d'expérience. Formation Angular assurée à votre arrivée.");
    expect(await read(trained, { competences_obligatoires: ["Java", "Angular"] })).toBe("moyenne");
    // Deux technos à apprendre ne font pas « 2 compétences manquantes ».
    expect(await read(trained, { competences_obligatoires: ["Java", "Angular", "Go"] })).toBe("moyenne");
    // Ta liste « je peux l'apprendre vite », sans formation écrite.
    const plain = job("Java et Angular. 2 ans d'expérience.");
    expect(await read(plain, { competences_obligatoires: ["Java", "Angular"] }, { ...JAVA, learnableSkills: ["Angular"] })).toBe("moyenne");
  });

  it("reste « faible » : maîtrise exigée, rien à apprendre, expérience au-dessus, poste senior, autre manque", async () => {
    const req = { competences_obligatoires: ["Java", "Angular"] };
    expect(await read(job("Java. Maîtrise d'Angular indispensable. Formation interne assurée."), req)).toBe("faible");
    expect(await read(job("Java et Angular. 2 ans d'expérience."), req)).toBe("faible");
    const trained = job("Java et Angular. Formation interne assurée.");
    expect(await read(trained, { ...req, experience_min_ans: 4 })).toBe("faible");
    expect(await read(trained, { ...req, niveau: "senior" })).toBe("faible");
    expect(await read(trained, { competences_obligatoires: ["Java"] })).toBe("faible"); // aucune techno à apprendre : l'avis de l'IA tient
  });

  it("la consigne et le profil donnés à l'IA parlent des technos à apprendre", () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/À APPRENDRE/);
    expect(fullPrompt(JOB, { ...JAVA, learnableSkills: ["Angular", "Go"] })).toContain("APPRENDRE VITE (absentes de son profil, choisies par lui) : Angular, Go");
  });
});

describe("techno principale vue seulement en projets", () => {
  it("« forte » ramenée à « moyenne » par le code (cas Wemanity)", async () => {
    const profile = { ...PROFILE, skills: ["Java", "Spring Boot", "React"], projectSkills: ["React"] };
    const job = { ...JOB, title: "Ingénieur Full Stack (Java / Angular / React) (H/F)", description: "Java, Spring Boot. Une expérience significative sur Angular ou React." };
    const read = (adequation: string) =>
      analyzeJobWithAi(
        new OllamaClient({
          fetch: async () =>
            json({ message: { content: JSON.stringify({ ...GOOD, niveau: "confirme", experience_min_ans: 2, competences_obligatoires: ["Java", "Spring Boot", "Angular ou React"], adequation }) } }),
        }),
        job,
        profile,
      ).then((r) => r.result);
    const r = await read("forte");
    expect(r.exigees_en_projets).toEqual(["Angular ou React"]);
    expect(r.adequation).toBe("moyenne");
  });
});
