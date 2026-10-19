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
