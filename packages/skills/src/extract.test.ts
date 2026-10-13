import { describe, expect, it } from "vitest";
import { SKILLS } from "./dictionary";
import { extractSkills, resolveSkill } from "./extract";

describe("extractSkills", () => {
  it("détecte les technos courantes", () => {
    const text = "Développeur Full Stack Vue.js / Node.js, TypeScript, PostgreSQL et Docker. API REST.";
    expect(extractSkills(text)).toEqual(["typescript", "vue", "node", "postgresql", "docker", "rest"]);
  });

  it("ne confond pas Java et JavaScript", () => {
    expect(extractSkills("Nous cherchons un expert JavaScript")).toEqual(["javascript"]);
    expect(extractSkills("Stack : Java 17 / Spring Boot")).toEqual(["java", "spring"]);
  });

  it("ne confond pas SQL et PostgreSQL, ni .NET et internet", () => {
    expect(extractSkills("Base PostgreSQL")).toEqual(["postgresql"]);
    expect(extractSkills("Site internet vitrine")).toEqual([]);
    expect(extractSkills("Développeur .NET 8 / C#")).toEqual(["csharp", "dotnet"]);
    expect(extractSkills("ASP.NET Core")).toEqual(["dotnet"]);
  });

  it("n'interprète pas le mot français « vue » comme Vue.js", () => {
    expect(extractSkills("en vue de développer une vue d'ensemble")).toEqual([]);
    expect(extractSkills("Maîtrise de Vue et Pinia")).toEqual(["vue", "pinia"]);
    expect(extractSkills("VueJS 3")).toEqual(["vue"]);
  });

  it("reconnaît C++ et C", () => {
    expect(extractSkills("Développement C/C++ embarqué")).toEqual(["cpp", "c"]);
  });

  it("ignore les accents et la casse", () => {
    expect(extractSkills("INTÉGRATION CONTINUE GitLab-CI")).toEqual(["gitlab", "cicd"]);
  });

  it("détecte une compétence personnalisée du profil", () => {
    const custom = resolveSkill("Quasar");
    expect(custom.id).toBe("custom:quasar");
    expect(extractSkills("Front en Quasar", [custom])).toEqual(["custom:quasar"]);
  });
});

describe("resolveSkill", () => {
  it("retrouve une compétence depuis un nom du profil", () => {
    expect(resolveSkill("Vue.js").id).toBe("vue");
    expect(resolveSkill("Spring Boot").id).toBe("spring");
    expect(resolveSkill("C#").id).toBe("csharp");
    expect(resolveSkill(".NET").id).toBe("dotnet");
    expect(resolveSkill("node.js").id).toBe("node");
  });
});

describe("barre oblique avec espaces", () => {
  it("« CI / CD » (CV mis en page) = CI/CD", () => {
    expect(extractSkills("DevOps : Git · Docker · CI / CD · Postman")).toContain("cicd");
    expect(extractSkills("principes de CI/CD")).toContain("cicd");
  });
});

describe("pré-filtre rapide : aucune écriture du dictionnaire n'est perdue", () => {
  it.each(SKILLS.map((s) => [s.id, s] as const))("%s", (_, skill) => {
    for (const a of skill.aliases) {
      const variants = [a, a.replace(/ /g, "-"), a.replace(/\//g, " / "), a.toUpperCase()];
      for (const v of variants) expect(extractSkills(`Poste : ${v}, en équipe.`), v).toContain(skill.id);
    }
    for (const a of skill.caseSensitiveAliases ?? []) expect(extractSkills(`Poste : ${a}, en équipe.`), a).toContain(skill.id);
  });
});
