import { DEFAULT_PROFILE } from "@job-radar/shared";
import { DEFAULT_RULES, scoreJob, scoringInputFromJob } from "@job-radar/scoring";
import { describe, expect, it } from "vitest";
import { chancesOf, withAiInfo } from "./jobs/service";
import { createTestApp, login } from "./test-helpers";

/** Seuil du profil (« Analyse IA à partir de ») : c'est lui qui décide des offres vérifiées. */
const THRESHOLD = DEFAULT_PROFILE.minScoreForAnalysis;

async function setup() {
  const t = await createTestApp();
  const cookies = await login(t.app);
  const req = (method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
    t.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });
  return { ...t, req };
}

describe("analyse IA d'une offre", () => {
  it("exige d'être connecté", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "POST", url: "/api/jobs/j-vue/analysis" })).statusCode).toBe(401);
  });

  it("état de l'IA", async () => {
    const { req, aiState } = await setup();
    expect((await req("GET", "/api/ai/status")).json()).toMatchObject({ available: true, installed: true });
    aiState.online = false;
    expect((await req("GET", "/api/ai/status")).json()).toMatchObject({ available: false });
  });

  it("analyse, garde le résultat, ne relance pas l'IA pour rien", async () => {
    const { req, aiCalls } = await setup();
    expect((await req("GET", "/api/jobs/j-vue/analysis")).json()).toEqual({ analysis: null, upToDate: false });

    const first = (await req("POST", "/api/jobs/j-vue/analysis")).json();
    expect(first.cached).toBe(false);
    expect(first.analysis.result.resume).toBe("Résumé de Développeur Vue.js");
    expect(aiCalls[0]!.skills.length).toBeGreaterThan(0); // le profil est bien envoyé

    const again = (await req("POST", "/api/jobs/j-vue/analysis")).json();
    expect(again.cached).toBe(true);
    expect(aiCalls).toHaveLength(1);
    expect((await req("GET", "/api/jobs/j-vue/analysis")).json().upToDate).toBe(true);

    // « Relancer » force une nouvelle analyse.
    await req("POST", "/api/jobs/j-vue/analysis?force=true");
    expect(aiCalls).toHaveLength(2);
  });

  it("profil modifié → analyse signalée comme dépassée", async () => {
    const { req } = await setup();
    await req("POST", "/api/jobs/j-vue/analysis");
    const { profile } = (await req("GET", "/api/profile")).json();
    await req("PUT", "/api/profile", { profile: { ...profile, skills: [...profile.skills, "Rust"] } });
    expect((await req("GET", "/api/jobs/j-vue/analysis")).json().upToDate).toBe(false);
  });

  it("annonce complète collée : l'analyse devient dépassée ; le CV est envoyé à l'IA quand il est rempli", async () => {
    const { req } = await setup();
    await req("POST", "/api/jobs/j-vue/analysis");
    const full = "Annonce complète. Développeur Vue.js et TypeScript. Minimum 1 an d'expérience. ".repeat(6);
    const job = (await req("PUT", "/api/jobs/j-vue/full-text", { text: full })).json();
    expect(job.fullTextAt).not.toBeNull();
    expect(job.description).toContain("Annonce complète.");
    expect((await req("GET", "/api/jobs/j-vue/analysis")).json().upToDate).toBe(false);

    await req("POST", "/api/jobs/j-vue/analysis");
    expect((await req("GET", "/api/jobs/j-vue/analysis")).json().upToDate).toBe(true);
    // CV collé dans « CV & lettre » : il fait partie de ce que lit l'IA, l'analyse est donc à refaire.
    await req("PUT", "/api/letter-kit", { cvText: "Mon CV : Vue.js, TypeScript, alternance en banque. ".repeat(6) });
    expect((await req("GET", "/api/jobs/j-vue/analysis")).json().upToDate).toBe(false);
  });

  it("Ollama éteint : erreur 503 avec un message simple ; offre inconnue : 404", async () => {
    const { req, aiState } = await setup();
    aiState.online = false;
    const res = await req("POST", "/api/jobs/j-vue/analysis");
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toMatch(/lance l'appli Ollama/);
    expect((await req("POST", "/api/jobs/inconnue/analysis")).statusCode).toBe(404);
  });
});

describe("vérification automatique des meilleures offres affichées", () => {
  async function waitIdle(req: (m: "GET", u: string) => Promise<{ json(): any }>) {
    for (let i = 0; i < 50; i++) {
      const s = (await req("GET", "/api/ai/auto")).json();
      if (s.pending.length === 0) return s;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("file IA jamais vidée");
  }

  it("seules les offres ≥ seuil du profil sans analyse à jour partent à l'IA ; « faible » ramène le score à 50 % max", async () => {
    const { req, aiCalls, aiState } = await setup();
    aiState.adequation = "faible";
    const list = (await req("GET", "/api/jobs?limit=10")).json().items as Array<{ id: string; score: { final: number } }>;
    const high = list.filter((j) => j.score.final >= THRESHOLD).map((j) => j.id);
    expect(high.length).toBeGreaterThan(0);

    const first = (await req("POST", "/api/ai/auto", { jobIds: list.map((j) => j.id) })).json();
    expect(first.threshold).toBe(THRESHOLD);
    await waitIdle(req);
    expect(aiCalls.map((c) => c.title).sort()).toEqual(
      list.filter((j) => high.includes(j.id)).map((j: any) => j.title).sort(),
    );

    const after = (await req("GET", "/api/jobs?limit=50")).json().items as Array<any>;
    const checked = after.find((j) => j.id === high[0]);
    expect(checked.ai).toMatchObject({ adequation: "faible" });
    expect(checked.score.final).toBeLessThanOrEqual(50);
    expect(checked.ai.before).toBeGreaterThanOrEqual(THRESHOLD);
    const detail = (await req("GET", `/api/jobs/${high[0]}`)).json();
    expect(detail.warnings[0]).toMatch(/^Score ramené de \d+ à \d+ % par l'IA \(adéquation faible\)/);

    // Déjà vérifiées : pas de nouvel appel.
    await req("POST", "/api/ai/auto", { jobIds: list.map((j) => j.id) });
    await waitIdle(req);
    expect(aiCalls).toHaveLength(high.length);
  });

  it("« forte » ne monte jamais le score ; profil modifié → avis gardé, annonce modifiée → avis retiré et offre revérifiée", async () => {
    const { req, aiState, jobs, aiCalls } = await setup();
    const list = (await req("GET", "/api/jobs?limit=10")).json().items as Array<any>;
    const top = (await req("GET", `/api/jobs/${list[0].id}`)).json();
    aiState.adequation = "forte";
    await req("POST", "/api/ai/auto", { jobIds: [top.id] });
    await waitIdle(req);
    const again = (await req("GET", `/api/jobs/${top.id}`)).json();
    expect(again.score.final).toBe(top.score.final);
    expect(again.ai).toMatchObject({ adequation: "forte", before: null });

    const { profile } = (await req("GET", "/api/profile")).json();
    await req("PUT", "/api/profile", { profile: { ...profile, skills: [...profile.skills, "Rust"] } });
    expect((await req("GET", `/api/jobs/${top.id}`)).json().ai).toMatchObject({ adequation: "forte" });
    expect((await req("POST", "/api/ai/auto/feed", {})).json().pending).not.toContain(top.id);
    await waitIdle(req);
    const calls = aiCalls.length;

    jobs.set(top.id, { ...jobs.get(top.id)!, contentHash: "annonce-modifiee", description: `${jobs.get(top.id)!.description} Télétravail 2 jours.` });
    expect((await req("GET", `/api/jobs/${top.id}`)).json().ai).toBeNull();
    await req("POST", "/api/ai/auto", { jobIds: [top.id] });
    await waitIdle(req);
    expect(aiCalls.length).toBe(calls + 1);
  });

  it("réponse inutilisable : pas de nouvel essai automatique à chaque collecte", async () => {
    const { req, aiState, aiCalls } = await setup();
    aiState.badFormat = true;
    await req("POST", "/api/ai/auto/feed", {});
    await waitIdle(req);
    const calls = aiCalls.length;
    expect(calls).toBeGreaterThan(0);
    expect((await req("POST", "/api/ai/auto/feed", {})).json().queued).toBe(0);
    await waitIdle(req);
    expect(aiCalls).toHaveLength(calls);
  });

  it("tout le flux (bouton « Actualiser » / « Vérifier avec l'IA ») : même les offres pas affichées, seulement ≥ seuil du profil, une seule fois", async () => {
    const { req, aiCalls } = await setup();
    const all = (await req("GET", "/api/jobs?limit=50")).json().items as Array<{ id: string; title: string; score: { final: number } }>;
    const high = all.filter((j) => j.score.final >= THRESHOLD);
    expect(high.length).toBeGreaterThan(0);

    const res = (await req("POST", "/api/ai/auto/feed", {})).json();
    expect(res.queued).toBe(high.length);
    await waitIdle(req);
    expect(aiCalls.map((c) => c.title).sort()).toEqual(high.map((j) => j.title).sort());

    // Déjà vérifiées : rien de plus.
    expect((await req("POST", "/api/ai/auto/feed", {})).json().queued).toBe(0);
    expect(aiCalls).toHaveLength(high.length);
  });

  it("Ollama éteint puis rallumé : le clic (retry) relance tout de suite", async () => {
    const { req, aiState, aiCalls } = await setup();
    aiState.online = false;
    await req("POST", "/api/ai/auto/feed", {});
    expect((await waitIdle(req)).offline).toBe(true);
    aiState.online = true;
    expect((await req("POST", "/api/ai/auto/feed", {})).json().queued).toBe(0); // encore « éteinte » pendant 1 min
    expect((await req("POST", "/api/ai/auto/feed", { retry: true })).json().queued).toBeGreaterThan(0);
    await waitIdle(req);
    expect(aiCalls.length).toBeGreaterThan(0);
  });

  it("Ollama éteint : rien n'est mis en file, l'état le dit", async () => {
    const { req, aiState, aiCalls } = await setup();
    aiState.online = false;
    const list = (await req("GET", "/api/jobs?limit=10")).json().items as Array<any>;
    await req("POST", "/api/ai/auto", { jobIds: list.map((j) => j.id) });
    const s = await waitIdle(req);
    expect(s.offline).toBe(true);
    expect(s.message).toMatch(/Ollama/);
    expect(aiCalls).toHaveLength(0);
  });
});

describe("offres Adzuna / Jooble (simple extrait)", () => {
  async function withAdzuna() {
    const t = await setup();
    // Même profil que « Développeur Vue.js » (bien noté), mais seulement un extrait Adzuna.
    const base = t.jobs.get("j-vue")!;
    t.jobs.set("j-adz", {
      ...structuredClone(base),
      id: "j-adz",
      contentHash: "j-adz",
      title: "Développeur junior Vue.js / Java F/H",
      company: "TALAN",
      sources: [{ source: "adzuna", url: "https://www.adzuna.fr/land/ad/5412345678?se=abc&v=XYZ" }],
      fullTextAt: null,
    });
    return t;
  }

  it("jamais vérifiées par l'IA tant que l'annonce n'est pas complète ; marquées « extrait » dans la liste", async () => {
    const { req, aiCalls } = await withAdzuna();
    const list = (await req("GET", "/api/jobs?limit=50")).json().items as Array<any>;
    const adz = list.find((j) => j.id === "j-adz");
    expect(adz.score.final).toBeGreaterThanOrEqual(70);
    expect(adz.abridged).toBe(true);
    const s = (await req("POST", "/api/ai/auto", { jobIds: ["j-adz"] })).json();
    expect(s.pending).toEqual([]);
    expect(aiCalls).toHaveLength(0);

    // Annonce complète collée → vérifiable.
    await req("PUT", "/api/jobs/j-adz/full-text", { text: "Développeur Vue.js et TypeScript, Java Spring Boot. ".repeat(10) });
    const again = (await req("POST", "/api/ai/auto", { jobIds: ["j-adz"] })).json();
    expect(again.pending).toContain("j-adz");
  });

  it("page envoyée par l'extension : l'offre Adzuna déjà connue est retrouvée (numéro d'annonce, ou titre + entreprise)", async () => {
    const { req } = await withAdzuna();
    const byId = (await req("POST", "/api/jobs/find-abridged", { url: "https://www.adzuna.fr/details/5412345678?utm=x" })).json();
    expect(byId.job).toMatchObject({ id: "j-adz", sources: ["adzuna"] });
    const byTitle = (await req("POST", "/api/jobs/find-abridged", { title: "DÉVELOPPEUR JUNIOR VUE.JS / JAVA (H/F)", company: "Talan" })).json();
    expect(byTitle.job?.id).toBe("j-adz");
    const none = (await req("POST", "/api/jobs/find-abridged", { url: "https://www.adzuna.fr/details/999999999", title: "Autre", company: "X" })).json();
    expect(none.job).toBeNull();
  });
});

describe("lecture d'une annonce par l'IA (page envoyée par l'extension)", () => {
  const PAGE = "Menu\nDéveloppeur Vue.js (H/F)\nAcme\nParis\nCDI\nDescription du poste : nous cherchons un développeur Vue.js avec 1 an d'expérience. ".repeat(2);

  it("renvoie les champs rangés + le texte nettoyé ; les indices de la page sont transmis", async () => {
    const { req } = await setup();
    const res = (await req("POST", "/api/jobs/manual/ai-read", { text: PAGE, hints: { title: "Développeur Vue.js (H/F)" } })).json();
    expect(res.fields).toMatchObject({ title: "Développeur Vue.js (H/F)", location: "Paris (75)", remoteType: "hybrid", experienceYears: 1 });
    expect(res.text).toContain("Description du poste");
  });

  it("Ollama éteint : 503 avec un message simple ; texte trop court : 400", async () => {
    const { req, aiState } = await setup();
    expect((await req("POST", "/api/jobs/manual/ai-read", { text: "court" })).statusCode).toBe(400);
    aiState.online = false;
    const res = await req("POST", "/api/jobs/manual/ai-read", { text: PAGE });
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toMatch(/Ollama/);
  });

  it("l'expérience lue par l'IA est celle utilisée pour l'offre ajoutée", async () => {
    const { req } = await setup();
    const text = "Tu seras managé par notre CTO qui a 12 ans d'expérience. Stack Vue.js, TypeScript. Poste en CDI à Paris.";
    const added = (await req("POST", "/api/jobs/manual", { title: "Développeur Vue.js", description: text, experienceYears: 1 })).json();
    expect(added.job.experienceText ?? "").not.toMatch(/12/);
    const detail = (await req("GET", `/api/jobs/${added.job.id}`)).json();
    expect(detail.score.hidden).toBe(false);
  });
});

describe("cohérence : l'expérience lue par l'IA prime sur les règles", () => {
  it("annonce ambiguë (« Exp. 1 à 7 ans » + « Exp. + 7 ans ») : l'IA dit 1 an → plus masquée, score recalculé", async () => {
    const { req, jobs } = await setup();
    const base = jobs.get("j-vue")!;
    jobs.set("j-amb", { ...structuredClone(base), id: "j-amb", contentHash: "j-amb", experienceMinYrs: 7, experienceText: "7 ans minimum" });
    const before = (await req("GET", "/api/jobs/j-amb")).json();
    expect(before.score.hidden).toBe(true);
    await req("POST", "/api/jobs/j-amb/analysis"); // la fausse IA lit « experience_min_ans: 2 »
    const after = (await req("GET", "/api/jobs/j-amb")).json();
    expect(after.experienceText).toBe("2 ans minimum (lu par l'IA)");
    expect(after.score.hidden).toBe(false);
    expect(after.score.breakdown.experience).toBeGreaterThan(before.score.breakdown.experience);
  });

  it("offre Adzuna complétée : contrat lu par l'IA utilisé si la source ne le donnait pas", async () => {
    const { req, jobs } = await setup();
    const base = jobs.get("j-vue")!;
    jobs.set("j-noc", { ...structuredClone(base), id: "j-noc", contentHash: "j-noc", contractType: null });
    const res = (await req("PUT", "/api/jobs/j-noc/full-text", {
      text: "Développeur Vue.js, un vrai CDI. ".repeat(20),
      experienceYears: 1,
      info: { contractType: "CDI", remoteType: "hybrid" },
    })).json();
    expect(res.contractType).toBe("CDI");
  });
});

describe("infos lues par l'IA (withAiInfo)", () => {
  const verdict = { adequation: "faible" as const, avis: "", required: [], bonus: [], experience: null, contract: "STAGE", noContract: false, salary: { min: 18000, max: 18000 }, address: null };

  it("cas réel (Néosoft) : l'IA n'a trouvé aucun contrat dans l'annonce → celui deviné dans la description est effacé", async () => {
    const { jobs } = await setup();
    const none = { ...verdict, contract: null, noContract: true, salary: null };
    const guessed = { ...structuredClone(jobs.get("j-vue")!), contractType: "FREELANCE", contractFromDescription: true };
    expect(withAiInfo(guessed, none).contractType).toBeNull();
    // Écrit par la source ou le titre, ou corrigé à la main : gardé ; ancienne analyse sans avis sur le contrat : rien ne change.
    expect(withAiInfo({ ...guessed, contractFromDescription: false }, none).contractType).toBe("FREELANCE");
    expect(withAiInfo({ ...guessed, userEdits: { contractType: "FREELANCE" } }, none).contractType).toBe("FREELANCE");
    expect(withAiInfo(guessed, { ...none, noContract: false }).contractType).toBe("FREELANCE");
  });
  it("cas réel (Devoteam) : « 25 ans minimum » des règles effacé, contrat et salaire de l'IA ; correction à la main prioritaire", async () => {
    const { jobs } = await setup();
    const job = { ...structuredClone(jobs.get("j-vue")!), experienceMinYrs: 25, experienceText: "25 ans minimum", contractType: "CDI" };
    expect(withAiInfo(job, verdict)).toMatchObject({ experienceMinYrs: null, experienceText: null, contractType: "STAGE", salaryMin: 18000, salaryMax: 18000 });
    const edited = { ...job, userEdits: { contractType: "CDI", experienceMinYrs: 3 } };
    expect(withAiInfo(edited, verdict)).toMatchObject({ experienceMinYrs: 25, contractType: "CDI" });
    // France Travail : l'expérience vient d'une fiche que l'IA ne voit pas.
    const ft = { ...job, sources: [{ source: "france-travail", url: "https://x" }] };
    expect(withAiInfo(ft, verdict).experienceMinYrs).toBe(25);
  });
});

describe("offre ajoutée avec l'adresse du lieu de travail (WTTJ)", () => {
  it("« Paris (75) » reste une ville ; l'adresse est gardée et affichée ; expérience de l'IA affichée même si identique", async () => {
    const { req } = await setup();
    const added = (
      await req("POST", "/api/jobs/manual", {
        title: "Développeur/se Fullstack - CDI Paris - Theodo GovTech",
        company: "Theodo GovTech",
        location: "Paris (75)",
        address: "48 Boulevard des Batignolles, 75017 Paris",
        description: "Développeur fullstack Vue.js. 1 à 2 ans d'expérience en CDI. ".repeat(3),
        experienceYears: 2,
      })
    ).json();
    const d = (await req("GET", `/api/jobs/${added.job.id}`)).json();
    expect(d.city).toBe("Paris");
    expect(d.department).toBe("75");
    expect(d.address).toBe("48 Boulevard des Batignolles, 75017 Paris");
    await req("POST", `/api/jobs/${added.job.id}/analysis`); // fausse IA : 2 ans
    expect((await req("GET", `/api/jobs/${added.job.id}`)).json().experienceText).toBe("2 ans minimum (lu par l'IA)");
  });
});

describe("détail du score cohérent avec l'IA", () => {
  it("étapes du calcul : technique → bonus/malus → plafond IA → score ; Technique calculé sur les compétences de l'IA", async () => {
    const { req, aiState } = await setup();
    aiState.adequation = "faible";
    const before = (await req("GET", "/api/jobs/j-vue")).json();
    await req("POST", "/api/jobs/j-vue/analysis"); // fausse IA : exigée Vue.js, « plus » Docker
    const d = (await req("GET", "/api/jobs/j-vue")).json();
    expect(d.aiSkills).toBe(true);
    expect(d.scoreSteps[0]).toMatchObject({ kind: "base", label: "Technique 100 % (stack principale)", value: 80 });
    expect(d.scoreSteps.at(-2)).toMatchObject({ kind: "cap", label: "Plafond IA : adéquation faible", value: d.score.final });
    expect(d.scoreSteps.at(-1)).toMatchObject({ kind: "total", value: d.score.final });
    expect(d.score.final).toBeLessThanOrEqual(50);
    expect(d.reasons).toContain("Compétences lues par l'IA (« plus » comptés à moitié)");
    expect(before.aiSkills).toBe(false);
  });

  it("note de l'IA : remplace la note par mots-clés, garde les bonus/malus, reste dans la fourchette de l'adéquation", async () => {
    const { req, aiState } = await setup();
    const keywords = (await req("GET", "/api/jobs/j-vue")).json().score.final;
    aiState.note = 62;
    aiState.adequation = "moyenne";
    await req("POST", "/api/jobs/j-vue/analysis");
    const d = (await req("GET", "/api/jobs/j-vue")).json();
    const points = d.scoreSteps.filter((st: { kind: string }) => st.kind === "adjust").reduce((a: number, st: { value: number }) => a + st.value, 0);
    expect(d.scoreSteps[0]).toMatchObject({ kind: "base", label: `Note de l'IA (mots-clés : ${keywords} %)`, value: 62 });
    expect(d.score.final).toBe(Math.min(75, Math.max(0, 62 + points)));
    expect(d.ai).toMatchObject({ note: 62, before: keywords });

    // 90 avec « faible » : le petit modèle se contredit, la note est ramenée à 40 au plus.
    const other = await setup();
    other.aiState.note = 90;
    other.aiState.adequation = "faible";
    await other.req("POST", "/api/jobs/j-vue/analysis");
    const low = (await other.req("GET", "/api/jobs/j-vue")).json();
    expect(low.ai.note).toBe(40);
    expect(low.score.final).toBeLessThanOrEqual(40);
  });
});

describe("offre sans description (ex. LinkedIn via JobScraper sans le détail)", () => {
  it("l'IA ne l'analyse pas (elle inventerait les missions) ; une ancienne analyse n'est pas montrée", async () => {
    const t = await setup();
    const { req, aiCalls } = t;
    await req("POST", "/api/jobs/j-vue/analysis"); // analyse faite quand la description existait
    const base = t.jobs.get("j-vue")!;
    t.jobs.set("j-vue", { ...base, description: "", contentHash: "vide", sources: [{ source: "jobscraper:linkedin", url: "https://www.linkedin.com/jobs/view/1" }], fullTextAt: null });

    expect((await req("GET", "/api/jobs/j-vue/analysis")).json()).toMatchObject({ analysis: null, noDescription: true });
    const res = await req("POST", "/api/jobs/j-vue/analysis?force=true");
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("NO_DESCRIPTION");
    expect(aiCalls).toHaveLength(1);
    expect((await req("GET", "/api/jobs/j-vue")).json().abridged).toBe(true); // « Compléter l'annonce » proposé
  });
});

describe("chances d'un junior (sans IA)", () => {
  const now = new Date("2026-10-21T12:00:00Z").getTime();
  it("signaux, points et onglet « À tenter » (35 à 59 %, junior ou formation)", async () => {
    const { jobs } = await setup();
    const base = structuredClone(jobs.get("j-vue")!);
    const job = {
      ...base,
      title: "Développeur Java / Angular junior",
      company: "Acme Conseil",
      description: "Pour l'un de nos clients, Java et Angular. Formation Angular assurée.",
      experienceMinYrs: null,
      publishedAt: new Date(now - 3600_000),
    };
    const s = scoreJob(scoringInputFromJob(job), { ...DEFAULT_PROFILE, skills: ["Java"] }, DEFAULT_RULES);
    const c = chancesOf(job, s, null, 50, now);
    expect(c.tags).toEqual(["Junior", "Formation proposée", "ESN ou cabinet", "Publiée il y a moins de 48 h", "À apprendre : Angular"]);
    expect(c.points).toBe(9);
    expect(c.tryable).toBe(true);
    expect(chancesOf(job, s, null, 60, now).tryable).toBe(false); // déjà au-dessus : dans le flux normal
    expect(chancesOf(job, s, null, 34, now).tryable).toBe(false);
    // Ni junior ni formation : pas « À tenter », même entre 35 et 59 %.
    const plain = { ...job, title: "Développeur Java", description: "Java.", publishedAt: new Date(now - 72 * 3600_000) };
    const p = chancesOf(plain, scoreJob(scoringInputFromJob(plain), DEFAULT_PROFILE, DEFAULT_RULES), { adequation: "moyenne", avis: "", required: [], bonus: [], experience: null, contract: null, noContract: false, salary: null, address: null, consulting: false }, 50, now);
    expect(p).toEqual({ points: 0, tags: [], tryable: false });
  });
});
