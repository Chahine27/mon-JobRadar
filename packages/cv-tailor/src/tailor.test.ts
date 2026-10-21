import { CvMasterSchema, type TemplateId } from "@job-radar/shared";
import { CV_SKILLS } from "@job-radar/skills";
import { describe, expect, it } from "vitest";
import { blockingFailures, runChecks } from "./checks";
import { shrinkOnce } from "./fit";
import { JOBS, jobFor, MASTER, MASTER_INPUT } from "./fixtures";
import { buildJobForCv, jobTypeOf } from "./job";
import { BUILT_TITLE_ID, tailorCv } from "./tailor";
import type { TailoredCvDraft } from "./types";

const bulletIds = (d: TailoredCvDraft, exp: string) => d.sections.experiences.find((e) => e.id === exp)!.bullets.map((b) => b.id);
const allText = (d: TailoredCvDraft) => JSON.stringify(d.sections);
const failed = (d: TailoredCvDraft) => d.checks.filter((c) => c.ok === false);

describe("tailorCv — offres figées", () => {
  it("Frontend Vue.js / TypeScript", () => {
    const d = tailorCv(MASTER, JOBS.front, "deux-colonnes");
    expect(d.sections.title).toBe("Développeur Frontend Vue.js / TypeScript");
    expect(bulletIds(d, "lusis-front").slice(0, 2)).toEqual(["f-interfaces", "f-migration"]);
    expect(d.sections.skillGroups[0]!.id).toBe("entreprise");
    expect(d.sections.skillGroups[0]!.items.slice(0, 3).map((i) => i.skillId)).toEqual(["typescript", "vue", "vuetify"]);
    expect(bulletIds(d, "lusis-back")).toHaveLength(2); // réduite au minimum
    expect(d.sections.experiences.map((e) => e.id)).toEqual(["lusis-front", "lusis-back"]);
    expect(failed(d)).toEqual([]);
  });

  it("Java junior Spring Boot", () => {
    const d = tailorCv(MASTER, JOBS.java, "une-colonne");
    expect(bulletIds(d, "lusis-back")).toEqual(expect.arrayContaining(["b-serveur", "b-api-externes", "b-api-internes"]));
    expect(d.sections.skillGroups[0]!.items.slice(0, 3).map((i) => i.skillId)).toEqual(["java", "spring", "rest"]);
    expect(d.sections.title).toBe("Développeur Java Spring Boot / Vue.js");
    expect(d.sections.experiences[0]!.bullets[0]!.text).toMatch(/^Développé/); // style verbe
    expect(failed(d)).toEqual([]);
  });

  it("Mobile Flutter / Kotlin", () => {
    const job = jobFor("Développeur mobile Flutter / Kotlin", "Applications Android en Kotlin et multiplateforme en Flutter. BLoC apprécié.", ["Flutter", "Kotlin", "Android"], ["BLoC"]);
    const d = tailorCv(MASTER, job, "deux-colonnes");
    expect(d.sections.projects.slice(0, 3).map((p) => p.id)).toEqual(["job-radar", "search-your-product", "parking"]);
    expect(d.sections.skillGroups[1]!.items.map((i) => i.skillId)).toEqual(["flutter", "android", "kotlin"]);
    expect(d.sections.title).toBe("Développeur Web & Mobile"); // pas de techno mobile faite en entreprise : titre du CV complet
    expect(d.builtTitle).toBeNull();
    expect(failed(d)).toEqual([]);
  });

  it("offre qui exige PHP et Jira : jamais affichés, signalés « choisi de ne pas afficher »", () => {
    const d = tailorCv(MASTER, JOBS.phpJira, "deux-colonnes");
    expect(allText(d)).not.toMatch(/php|jira/i);
    expect(d.missing.forbidden).toEqual(["php", "jira"]);
    expect(d.missing.absent).toContain("symfony");
    expect(d.checks.find((c) => c.id === 2)!.ok).toBe(true);
  });

  it("offre qui exige .NET : aucun point (fait par l'équipe), signalé absent", () => {
    const d = tailorCv(MASTER, JOBS.dotnet, "deux-colonnes");
    expect(d.missing.absent).toContain("dotnet");
    const doc = [...d.picked, ...d.dropped].find((p) => p.kind === "project" && p.id === "doc-chez-vous")!;
    expect(doc.reasons.map((r) => r.skillId)).not.toContain("dotnet");
  });

  it("offre qui exige des microservices : affiché dans les compétences, « vu en cours », jamais dans le titre ni le profil", () => {
    const d = tailorCv(MASTER, JOBS.micro, "une-colonne");
    expect(d.missing.onlyCourse).toEqual(["microservices"]);
    expect(d.sections.skillGroups.flatMap((g) => g.items.map((i) => i.skillId))).toContain("microservices");
    expect(d.sections.title).not.toMatch(/microservices/i);
    expect(d.sections.summary).not.toMatch(/microservices/i);
    expect(d.checks.find((c) => c.id === 5)!.ok).toBe(true);
  });

  it("extrait Adzuna : avertissement « annonce incomplète »", () => {
    const d = tailorCv(MASTER, JOBS.abridged, "deux-colonnes");
    expect(d.warnings[0]).toMatch(/Annonce incomplète/);
    expect(d.warnings.join(" ")).toMatch(/Analyse IA absente/);
  });

  it("phrase à valider : jamais choisie, même avec la meilleure note", () => {
    const input = structuredClone(MASTER_INPUT);
    input.titles.find((t) => t.id === "t-front")!.toValidate = true;
    const mig = input.experiences[0]!.bullets.find((b) => b.id === "f-migration")!;
    mig.variants[1]!.toValidate = true; // style « nom » à valider
    const master = CvMasterSchema.parse(input);
    const d = tailorCv(master, JOBS.front, "deux-colonnes");
    expect(d.picked.find((p) => p.kind === "title")!.id).not.toBe("t-front");
    expect(allText(d)).not.toContain(mig.variants[1]!.text);
    expect(d.sections.experiences[0]!.bullets.find((b) => b.id === "f-migration")!.text).toBe(mig.variants[0]!.text);
    expect(d.warnings.join(" ")).toMatch(/Style mélangé/);
    expect(failed(d)).toEqual([]);
  });

  it("libellé de compétence écrit comme dans l'offre (synonyme), enregistré", () => {
    const job = jobFor("Développeur Front", "Stack VueJS et Node JS.", ["Vue.js", "Node.js"]);
    const d = tailorCv(MASTER, job, "deux-colonnes");
    const labels = d.sections.skillGroups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("VueJS");
    expect(labels).toContain("Node JS");
    expect(d.substitutions).toContainEqual({ blockId: "skill:vue", from: "Vue.js", to: "VueJS" });
    expect(d.sections.experiences[0]!.bullets[0]!.text).toContain("Vue.js"); // jamais dans les phrases
    expect(failed(d)).toEqual([]);
    const off = CvMasterSchema.parse({ ...MASTER_INPUT, rules: { ...MASTER_INPUT.rules, allowLabelSubstitution: false } });
    expect(tailorCv(off, job, "deux-colonnes").substitutions).toEqual([]);
  });

  it("même compétence deux fois dans un groupe (« Claude Code », « Cursor ») : libellés gardés, pas de doublon", () => {
    const ia = { id: "ia", label: "Développement assisté par IA", items: [
      { skillId: "agents-ia", label: "Claude Code", level: "projet" },
      { skillId: "agents-ia", label: "Cursor", level: "projet" },
      { skillId: "mcp", label: "MCP", level: "projet" },
    ] };
    const master = CvMasterSchema.parse({ ...MASTER_INPUT, skillGroups: [...MASTER_INPUT.skillGroups, ia] });
    const job = jobFor("Développeur Full Stack", "Vue.js, Java. Vous codez avec Claude Code et des agents IA.", ["Vue.js", "Java"]);
    const line = tailorCv(master, job, "deux-colonnes").sections.skillGroups.find((g) => g.id === "projets")!;
    expect(line.items.map((i) => i.label)).toEqual(["Claude Code", "Cursor"]); // MCP : pas cité par l'offre
    // Rien ajouté en double depuis le profil (Claude Code est déjà dans le CV complet).
    const all = tailorCv(master, { ...job, profileSkills: ["agents-ia"] } as typeof job, "deux-colonnes").sections.skillGroups.flatMap((g) => g.items.map((i) => i.label));
    expect(all.filter((l) => l === "Claude Code")).toHaveLength(1);
  });

  it("jamais de libellé raccourci : « Docker Compose » reste tel quel quand l'offre écrit « Docker »", () => {
    const d = tailorCv(MASTER, jobFor("Développeur Java", "Java, Docker et Kubernetes.", ["Java", "Docker"]), "deux-colonnes");
    expect(d.sections.projects.find((p) => p.id === "parking")!.technologies).toContain("Docker Compose");
    expect(d.substitutions.filter((x) => x.to === "Docker")).toEqual([]);
  });

  it("choix manuels : retirer, remettre, variante, titre, ordre", () => {
    const d = tailorCv(MASTER, JOBS.front, "deux-colonnes", {
      add: ["b-tests"],
      remove: ["f-fraude", "codenshare"],
      variants: { "f-traduction": "v1" },
      titleId: "t-fullstack",
      order: { "lusis-front": ["f-migration"] },
    });
    expect(bulletIds(d, "lusis-back")).toContain("b-tests");
    expect(bulletIds(d, "lusis-front")).not.toContain("f-fraude");
    expect(bulletIds(d, "lusis-front")[0]).toBe("f-migration");
    expect(d.sections.projects.map((p) => p.id)).not.toContain("codenshare");
    expect(d.dropped.find((x) => x.id === "f-fraude")!.why).toMatch(/à la main/);
    expect(d.sections.title).toMatch(/^Développeur Full Stack Web & Mobile/);
  });

  it("type de poste déduit du titre puis des compétences", () => {
    expect(jobTypeOf("Développeur Fullstack", [])).toBe("fullstack");
    expect(jobTypeOf("Ingénieur logiciel", ["vue", "java"])).toBe("fullstack");
    expect(jobTypeOf("Ingénieur logiciel", ["vue"])).toBe("frontend");
    expect(jobTypeOf("Développeur Android", [])).toBe("mobile");
    expect(buildJobForCv({ title: "Dev", description: "Java", abridged: false, analysis: { required: ["Spring"], bonus: ["Spring"] } }).niceToHave).toEqual([]);
  });
});

describe("ajustement à une page (ordre fixe de retrait)", () => {
  it("loisirs → projet le moins bien noté → ligne ifRelevant → compétences « cours » à 0 → description courte", () => {
    let d = tailorCv(MASTER, JOBS.java, "une-colonne");
    const steps: string[] = [];
    for (let i = 0; i < 40; i++) {
      const next = shrinkOnce(d, MASTER);
      if (!next) break;
      const removed = next.dropped.slice(d.dropped.length).map((x) => x.kind);
      steps.push(removed.length ? removed[0]! : "court");
      d = next;
    }
    const firstOf = (k: string) => steps.indexOf(k);
    expect(steps[0]).toBe("hobbies");
    expect(firstOf("project")).toBeLessThan(firstOf("bullet"));
    expect(firstOf("bullet")).toBeLessThan(firstOf("skill"));
    expect(firstOf("skill")).toBeLessThan(firstOf("court"));
    expect(d.sections.projects).toHaveLength(MASTER.rules.minProjects);
    for (const e of d.sections.experiences) expect(e.bullets.length).toBe(MASTER.experiences.find((m) => m.id === e.id)!.minBullets);
    expect(d.dropped.filter((x) => x.why === "manque de place").length).toBeGreaterThan(3);
    expect(failed(d)).toEqual([]);
  });
});

describe("propriétés (200 offres au hasard)", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T>(xs: T[], n: number) => xs.filter(() => rand() < n / xs.length);
  const titles = ["Développeur Frontend", "Développeur Backend Java", "Développeur Full Stack", "Développeur mobile", "Ingénieur logiciel", "Développeur PHP senior"];
  const labels = CV_SKILLS.map((s) => s.label);

  it("toujours : origine, aucune interdite, obligatoires, mots forts, cours, déterministe", () => {
    for (let i = 0; i < 200; i++) {
      const required = pick(labels, 5);
      const bonus = pick(labels, 3);
      const title = titles[Math.floor(rand() * titles.length)]!;
      const job = jobFor(title, [...required, ...bonus, ...pick(labels, 4)].join(", "), rand() < 0.7 ? required : undefined, bonus, rand() < 0.1);
      const template: TemplateId = rand() < 0.5 ? "une-colonne" : "deux-colonnes";
      const d = tailorCv(MASTER, job, template);
      expect(failed(d), `${title} / ${required.join(", ")}`).toEqual([]);
      expect(tailorCv(MASTER, job, template)).toStrictEqual(d);
      expect(d.sections.identity.fullName).toBe(MASTER.identity.fullName);
      expect(d.sections.experiences).toHaveLength(MASTER.experiences.length);
    }
  }, 20_000); // 400 CV calculés : lent quand tous les tests tournent ensemble
});

describe("contrôles", () => {
  it("détecte une phrase inventée, une interdite, un mot fort mal placé, un obligatoire manquant", () => {
    const d = tailorCv(MASTER, JOBS.front, "deux-colonnes");
    const s = structuredClone(d.sections);
    s.experiences[0]!.bullets.push({ id: "x", text: "Expert en Jira et maîtrise de WordPress" });
    s.experiences = s.experiences.slice(0, 1);
    const checks = runChecks(s, MASTER, []);
    expect(checks.filter((c) => c.ok === false).map((c) => c.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("titre construit (métier de l'offre + technos faites en entreprise)", () => {
  const titleOf = (title: string, required: string[]) => tailorCv(MASTER, jobFor(title, required.join(", "), required), "deux-colonnes");

  it("offre Java, front, full stack : jamais l'intitulé de l'offre", () => {
    const java = titleOf("Développeur Java Angular F/H", ["Java", "Angular"]);
    expect(java.sections.title).toBe("Développeur Java Spring Boot / Vue.js");
    expect(java.picked.find((p) => p.kind === "title")!.id).toBe(BUILT_TITLE_ID);
    expect(titleOf("Développeur Frontend Svelte / TypeScript", ["Svelte", "TypeScript"]).sections.title).toBe("Développeur Frontend Vue.js / TypeScript");
    expect(titleOf("Développeur Full-Stack Java EE / Docker H/F", ["Java", "Docker"]).sections.title).toBe("Développeur Full Stack Vue.js / Java Spring Boot");
    for (const d of [java, titleOf("Développeur Full-Stack Java EE", ["Java"])]) expect(failed(d)).toEqual([]);
  });

  it("un titre choisi à la main prime sur le titre construit", () => {
    const d = tailorCv(MASTER, JOBS.java, "deux-colonnes", { add: [], remove: [], variants: {}, titleId: "t-back", order: {} });
    expect(d.builtTitle).toBeNull();
    expect(d.sections.title).toBe("Développeur Backend Java Spring Boot");
  });

  it("contrôle bloquant : techno absente des expériences pro (Java EE, Docker, Angular)", () => {
    const d = tailorCv(MASTER, JOBS.java, "deux-colonnes");
    for (const [title, bad] of <Array<[string, string]>>[["Développeur Java EE", "java ee"], ["Développeur Full Stack Docker", "Docker"], ["Développeur Angular / Vue.js", "Angular"], ["Développeur React", "React"]]) {
      const check = runChecks({ ...d.sections, title }, MASTER, [], title).find((c) => c.id === 9)!;
      expect(check.ok, title).toBe(false);
      expect(check.details.join(" ")).toContain(bad);
      expect(blockingFailures(runChecks({ ...d.sections, title }, MASTER, [], title)).map((c) => c.id)).toContain(9);
    }
    expect(runChecks({ ...d.sections, title: "Développeur Java Spring Boot / API REST" }, MASTER, [], "Développeur Java Spring Boot / API REST").find((c) => c.id === 9)!.ok).toBe(true);
  });

  it("profil incohérent avec le titre : signalé", () => {
    expect(tailorCv(MASTER, JOBS.front, "deux-colonnes").warnings.join(" ")).toMatch(/Profil « full stack » sous un titre « frontend »/);
    const input = structuredClone(MASTER_INPUT);
    input.summaries.push({ id: "s-front", template: "deux-colonnes", jobTypes: ["frontend"], toValidate: false, text: "Développeur frontend diplômé d'un Bac+5." } as never);
    const d = tailorCv(CvMasterSchema.parse(input), JOBS.front, "deux-colonnes");
    expect(d.sections.summary).toMatch(/^Développeur frontend/);
    expect(d.warnings.join(" ")).not.toMatch(/Profil « /);
  });
});

describe("projet « toujours » (Job Radar)", () => {
  it("présent et en premier pour toutes les offres, jamais retiré pour la place", () => {
    for (const job of Object.values(JOBS)) {
      for (const tpl of ["une-colonne", "deux-colonnes"] as TemplateId[]) {
        let d = tailorCv(MASTER, job, tpl);
        expect(d.sections.projects[0]!.id, job.title).toBe("job-radar");
        expect(d.sections.projects[0]!.link).toBe("github.com/camille/job-radar");
        for (let next = shrinkOnce(d, MASTER); next; next = shrinkOnce(d, MASTER)) d = next;
        expect(d.sections.projects.map((p) => p.id)).toContain("job-radar");
      }
    }
  });

  it("contrôle bloquant s'il manque ; description à valider : pas affiché, signalé", () => {
    const d = tailorCv(MASTER, JOBS.front, "deux-colonnes");
    const without = { ...d.sections, projects: d.sections.projects.filter((p) => p.id !== "job-radar") };
    expect(runChecks(without, MASTER, [], d.builtTitle).find((c) => c.id === 4)!.details).toContain("manque : projet Job Radar");
    const input = structuredClone(MASTER_INPUT);
    for (const v of input.projects[0]!.descriptions) v.toValidate = true;
    const pending = tailorCv(CvMasterSchema.parse(input), JOBS.front, "deux-colonnes");
    expect(pending.sections.projects.map((p) => p.id)).not.toContain("job-radar");
    expect(pending.warnings.join(" ")).toMatch(/Job Radar.*à valider/);
    expect(failed(pending)).toEqual([]);
  });
});

describe("compétences en deux niveaux", () => {
  it("« En entreprise » d'abord (technos pro), puis les technos de projets citées par l'offre ; notions telles quelles", () => {
    const d = tailorCv(MASTER, jobFor("Développeur Full Stack", "Vue.js, Java, Docker, React, Microservices", ["Vue.js", "Java", "Docker", "React", "Microservices"]), "deux-colonnes");
    const [pro, other, ...rest] = d.sections.skillGroups;
    expect([pro!.label, other!.label]).toEqual(["En entreprise", "En projets et formation"]);
    const levelOf = (id: string) => MASTER.skillGroups.flatMap((g) => g.items).find((i) => i.skillId === id)!.level;
    expect(pro!.items.every((i) => levelOf(i.skillId) === "pro")).toBe(true);
    expect(pro!.items.map((i) => i.skillId)).toEqual(expect.arrayContaining(["vue", "typescript", "java", "spring", "rest", "git"]));
    expect(other!.items.map((i) => i.skillId).sort()).toEqual(["docker", "react"]); // ni Flutter, ni Kotlin, ni Node.js
    for (const id of ["architecture", "tests", "methodes"]) {
      const master = MASTER.skillGroups.find((g) => g.id === id)!;
      expect(rest.find((g) => g.id === id)!.items.map((i) => i.label).sort()).toEqual(master.items.map((i) => i.label).sort());
    }
    expect(failed(d)).toEqual([]);
  });

  it("rien de cité hors entreprise : pas de ligne « En projets et formation »", () => {
    expect(tailorCv(MASTER, JOBS.front, "deux-colonnes").sections.skillGroups.map((g) => g.id)).not.toContain("projets");
  });
});

describe("correspondance avec l'offre", () => {
  it("compte les compétences de l'offre écrites dans le CV, et celles du CV complet laissées de côté", () => {
    const d = tailorCv(MASTER, jobFor("Développeur Full Stack", "Vue.js, Java, Svelte", ["Vue.js", "Java", "Svelte"]), "deux-colonnes");
    expect(d.match.offer).toEqual(["vue", "java", "svelte"]);
    expect(d.match.found).toEqual(["vue", "java"]);
    expect(d.match.missing).toEqual(["svelte"]);
    expect(d.match.notShown).toEqual([]); // Svelte n'est pas non plus dans le CV complet
    expect(d.match.percent).toBe(67);
  });
});

describe("compétences du profil", () => {
  const job = (profileSkills: string[]) =>
    buildJobForCv({
      title: "Développeur Fullstack React/Node.js",
      description: "React, Node.js, Express, Python, GitLab, Svelte.",
      abridged: false,
      analysis: { required: ["React", "Node.js", "Express", "Python", "GitLab", "Svelte"], bonus: [] },
      profileSkills,
    });

  it("ajoute à la liste celles que l'offre cite, dans le groupe qui leur ressemble", () => {
    const d = tailorCv(MASTER, job(["Python", "GitLab", "Express", "Rust"]), "deux-colonnes");
    const group = (id: string) => d.sections.skillGroups.find((g) => g.items.some((i) => i.skillId === id))?.id;
    expect(d.fromProfile.sort()).toEqual(["express", "gitlab", "python"]); // Rust : pas dans l'offre
    expect(group("python")).toBe("projets");
    expect(group("express")).toBe("projets");
    expect(group("gitlab")).toBe("projets");
    expect(d.missing.absent).toEqual(["svelte"]);
    expect(d.match.found).toEqual(expect.arrayContaining(["python", "gitlab", "express"]));
    expect(failed(d)).toEqual([]);
  });

  it("jamais une compétence interdite, et rien sans profil", () => {
    const input = structuredClone(MASTER_INPUT);
    input.rules.forbiddenSkills = [...input.rules.forbiddenSkills, "python"];
    const d = tailorCv(CvMasterSchema.parse(input), job(["Python"]), "deux-colonnes");
    expect(d.fromProfile).toEqual([]);
    expect(tailorCv(MASTER, job([]), "deux-colonnes").fromProfile).toEqual([]);
  });
});
