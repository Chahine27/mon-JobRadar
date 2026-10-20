import { describe, expect, it } from "vitest";
import { letterBody, letterHash, reviewBlock, reviewLetter } from "./letter-review";

const LETTER = [
  "Alex Martin\n75011 Paris",
  "Objet : Candidature au poste de Développeur Java",
  "Madame, Monsieur,",
  "Titulaire d'un Mastère obtenu en 2026, je souhaite rejoindre Acme. Elle demande de comprendre le besoin métier.",
  "Les tests unitaires que j'ai écrit avec JUnit couvraient les services. Chez Banquo, j'ai utilisé Spring Boot.",
  "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
  "Alex MARTIN",
].join("\n\n");

/** Faux LanguageTool : une vraie faute d'accord, et des « fautes de frappe » sur des noms propres. */
const fakeLt = (async (_url: string, init: { body: URLSearchParams }) => {
  const text = init.body.get("text")!;
  const at = (w: string) => ({ offset: text.indexOf(w), length: w.length });
  return new Response(
    JSON.stringify({
      matches: [
        { ...at("écrit"), message: "Accordez le participe.", rule: { id: "QUE_AVOIR", issueType: "uncategorized", category: { id: "CAT_GRAMMAIRE" } } },
        { ...at("Banquo"), message: "Faute de frappe possible.", rule: { id: "FR_SPELLING_RULE", issueType: "misspelling", category: { id: "TYPOS" } } },
        { ...at("JUnit"), message: "Faute de frappe possible.", rule: { id: "FR_SPELLING_RULE", issueType: "misspelling", category: { id: "TYPOS" } } },
        { ...at("Madame"), message: "Espace insécable.", rule: { id: "FRENCH_WHITESPACE", issueType: "whitespace", category: { id: "TYPOGRAPHY" } } },
      ],
    }),
  );
}) as unknown as typeof fetch;

/** Fausse IA : un vrai problème, un doublon de LanguageTool, et un extrait inventé (absent de la lettre). */
const fakeAi = {
  chatJson: async () => ({
    problemes: [
      { type: "sujet", extrait: "Elle demande de comprendre le besoin métier", explication: "« Elle » ne renvoie à rien." },
      { type: "faute", extrait: "que j'ai écrit avec JUnit", explication: "« écrits »." },
      { type: "repetition", extrait: "j'ai développé deux fois", explication: "Inventé." },
    ],
  }),
};

describe("relecture des lettres", () => {
  it("garde les vrais problèmes : sujet sans référent, faute d'accord ; ignore noms propres, typographie, extraits inventés et doublons", async () => {
    const r = await reviewLetter(LETTER, { cvText: "Banquo", jobText: "Développeur Java" }, { ai: fakeAi, fetch: fakeLt });
    expect(r.errors).toEqual([]);
    expect(r.problems.map((p) => p.kind).sort()).toEqual(["faute", "sujet"]);
    expect(r.problems.find((p) => p.kind === "faute")!.detail).toContain("« écrit »");
    expect(r.hash).toBe(letterHash(LETTER));
  });

  it("un relecteur injoignable n'empêche pas les autres, et la lettre est à valider", async () => {
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    const r = await reviewLetter(LETTER, { cvText: "", jobText: "" }, { ai: fakeAi, fetch: down });
    expect(r.problems.some((p) => p.kind === "sujet")).toBe(true);
    expect(r.errors[0]).toContain("LanguageTool");
    expect(reviewBlock({ ...r, problems: [] }, LETTER)).toContain("pas pu se faire en entier");
  });

  it("bouts de l'annonce recopiés : repérés par le code", async () => {
    const job = "Vous travaillerez en méthode agile au sein d'une équipe pluridisciplinaire sur nos applications.";
    const text = "Madame, Monsieur,\n\nJe travaillerai en méthode agile au sein d'une équipe pluridisciplinaire sur vos projets.";
    const noLt = (async () => new Response(JSON.stringify({ matches: [] }))) as unknown as typeof fetch;
    const r = await reviewLetter(text, { cvText: "", jobText: job }, { ai: { chatJson: async () => ({ problemes: [] }) }, fetch: noLt });
    expect(r.problems).toMatchObject([{ kind: "fragment" }]);
  });

  it("pas de fausse alerte (cas emagine) : objet, « est ce que » affirmatif, nom d'entreprise en minuscule, majuscule inventée par l'IA", async () => {
    const text = [
      "Objet : Candidature au poste de Développeur Fullstack Java / React",
      "Madame, Monsieur,",
      "Ce mélange de backend et de frontend est ce que je peux vous apporter. Avec Budget Insight, l'application relançait la connexion.",
      "Je serais heureux d'échanger avec emagine.",
    ].join("\n\n");
    const job = "emagine\nCandidature au poste de Développeur Fullstack Java / React chez notre client.";
    const lt = (async (_u: string, init: { body: URLSearchParams }) => {
      const t = init.body.get("text")!;
      const at = (w: string) => ({ offset: t.indexOf(w), length: w.length });
      return new Response(
        JSON.stringify({
          matches: [
            { ...at("est ce"), message: "Trait d'union.", rule: { id: "EST_CE", issueType: "grammar", category: { id: "CAT_GRAMMAIRE" } } },
            { ...at("emagine"), message: "Faute de frappe possible.", rule: { id: "FR_SPELLING_RULE", issueType: "misspelling", category: { id: "TYPOS" } } },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const ai = { chatJson: async () => ({ problemes: [{ type: "faute", extrait: "avec Budget Insight, l'application", explication: "Majuscule." }] }) };
    const r = await reviewLetter(text, { cvText: "", jobText: job, jobTitle: "Développeur Fullstack Java / React (H/F)" }, { ai, fetch: lt });
    expect(r.problems).toEqual([]);
  });

  it("correcteur des faits : phrase non prouvée signalée (et bloque l'envoi) ; correcteur injoignable noté", async () => {
    const text = "Objet : Candidature\n\nMadame, Monsieur,\n\nChez LUSIS j'ai travaillé en banque pendant deux ans. J'ai migré un module vers Vue 3.";
    const noLt = (async () => new Response(JSON.stringify({ matches: [] }))) as unknown as typeof fetch;
    const facts = { cvText: "Vue.js", blocks: [{ title: "Vue 3", text: "J'ai migré un module vers Vue 3.", useFor: "" }], rules: "LUSIS n'est pas une banque." };
    const factAi = { chatJson: async () => ({ inventions: [{ phrase: "Chez LUSIS j'ai travaillé en banque pendant deux ans.", raison: "LUSIS n'est pas une banque" }] }) };
    const r = await reviewLetter(text, { cvText: "", jobText: "", facts }, { ai: { chatJson: async () => ({ problemes: [] }) }, factAi, fetch: noLt });
    expect(r.problems).toMatchObject([{ kind: "fait", excerpt: "Chez LUSIS j'ai travaillé en banque pendant deux ans." }]);
    expect(reviewBlock(r, text)).toContain("1 problème");
    const down = await reviewLetter(text, { cvText: "", jobText: "", facts }, { ai: { chatJson: async () => ({ problemes: [] }) }, factAi: { chatJson: async () => { throw new Error("hors ligne"); } }, fetch: noLt });
    expect(down.errors.join(" ")).toMatch(/Faits non vérifiés/);
  });

  it("blocage : rien à signaler = libre ; problème = bloqué sauf validé ; autre texte = à relire", () => {
    const base = { hash: letterHash(LETTER), problems: [], errors: [], validated: false, at: "" };
    expect(reviewBlock(base, LETTER)).toBeNull();
    const flagged = { ...base, problems: [{ kind: "faute" as const, excerpt: "x", detail: "y" }] };
    expect(reviewBlock(flagged, LETTER)).toContain("1 problème");
    expect(reviewBlock({ ...flagged, validated: true }, LETTER)).toBeNull();
    expect(reviewBlock({ ...flagged, validated: true }, `${LETTER} modifiée`)).toContain("pas encore été faite");
    expect(reviewBlock(null, LETTER)).not.toBeNull();
  });

  it("corps de la lettre : sans en-tête, politesse ni signature", () => {
    const body = letterBody(LETTER);
    expect(body.startsWith("Objet")).toBe(true);
    expect(body).not.toContain("Je vous prie");
    expect(body).not.toContain("75011");
  });
});
