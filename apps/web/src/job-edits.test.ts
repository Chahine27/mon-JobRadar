import { describe, expect, it } from "vitest";
import { mergeEdits } from "./job-edits";

const before = {
  title: "Développeur web fullstack H/F", company: "Leihia", city: "Chennevières-Sur-Marne", address: "", department: "51",
  contractType: "CDI", remoteType: "", salaryMin: "", salaryMax: "", experienceMinYrs: "",
};

describe("corrections du formulaire « Modifier les infos »", () => {
  it("chaque champ changé devient une correction, les champs nombre arrivent en nombre", () => {
    const form = {
      ...before, title: "Dév fullstack", company: "Acme", city: "Paris", address: " 78 Av. des Champs-Élysées, 75008 Paris ", department: "75",
      contractType: "CDD", remoteType: "hybrid", salaryMin: 38000, salaryMax: 42000, experienceMinYrs: 2,
    };
    expect(mergeEdits(form, before, null)).toEqual({
      title: "Dév fullstack", company: "Acme", city: "Paris", address: "78 Av. des Champs-Élysées, 75008 Paris", department: "75",
      contractType: "CDD", remoteType: "hybrid", salaryMin: 38000, salaryMax: 42000, experienceMinYrs: 2,
    });
  });

  it("0 an d'expérience est une vraie valeur ; rien de changé : rien d'envoyé", () => {
    expect(mergeEdits({ ...before, experienceMinYrs: 0 }, before, null)).toEqual({ experienceMinYrs: 0 });
    expect(mergeEdits(before, before, null)).toEqual({});
  });

  it("garde les corrections précédentes ; un champ vidé reprend la valeur de la source", () => {
    const previous = { company: "Acme", experienceMinYrs: 3 };
    const shown = { ...before, company: "Acme", experienceMinYrs: "3" };
    expect(mergeEdits({ ...shown, city: "Paris" }, shown, previous)).toEqual({ company: "Acme", experienceMinYrs: 3, city: "Paris" });
    expect(mergeEdits({ ...shown, company: "", experienceMinYrs: "" }, shown, previous)).toEqual({});
  });
});
