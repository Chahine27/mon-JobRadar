import { describe, expect, it } from "vitest";
import { analysisFitsJob, analysisHash } from "./ai-context";
import { TEST_JOBS } from "./test-helpers";

const job = TEST_JOBS[0]!;
const profile = { skills: ["Vue.js"], experienceMin: 0, experienceMax: 3, contracts: ["CDI"], locations: ["Oise (60)"] };
const done = (j = job, model = "gemma") => ({ inputHash: analysisHash(j, profile, model), model });

describe("l'avis de l'IA vaut-il encore ?", () => {
  it("profil ou CV changé : oui (« Relancer » le refait à la demande)", () => {
    const other = analysisHash(job, { ...profile, skills: ["Rust"] }, "gemma");
    expect(analysisFitsJob({ inputHash: other, model: "gemma" }, job, "gemma")).toBe(true);
  });

  it("ce que l'IA lit de l'offre change (texte, contrat, salaire…) : non", () => {
    expect(analysisFitsJob(done(), { ...job, description: `${job.description} Télétravail 2 jours.` }, "gemma")).toBe(false);
    expect(analysisFitsJob(done(), { ...job, contractType: "CDD" }, "gemma")).toBe(false);
    expect(analysisFitsJob(done(), { ...job, salaryMin: 52_000 }, "gemma")).toBe(false);
  });

  it("une donnée que l'IA ne lit pas (compétences recalculées, empreinte) : oui, pas de nouvel appel pour rien", () => {
    expect(analysisFitsJob(done(), { ...job, technologies: [...job.technologies, "Salesforce"], contentHash: "autre" }, "gemma")).toBe(true);
  });

  it("modèle changé : non", () => {
    expect(analysisFitsJob(done(), job, "llama")).toBe(false);
  });

  it("analyses d'avant ce format : gardées avec le même modèle et la même consigne", () => {
    expect(analysisFitsJob({ inputHash: "0123456789abcdef0123456789abcdef", model: "gemma" }, job, "gemma")).toBe(true);
    expect(analysisFitsJob({ inputHash: "0123456789abcdef0123456789abcdef", model: "gemma" }, job, "llama")).toBe(false);
  });
});
