import { CvMasterSchema, type TemplateId } from "@job-radar/shared";
import { CV_SKILLS } from "@job-radar/skills";
import { describe, expect, it } from "vitest";
import { runChecks } from "./checks";
import { shrinkOnce } from "./fit";
import { JOBS, jobFor, MASTER, MASTER_INPUT } from "./fixtures";
import { buildJobForCv, cleanOfferTitle, jobTypeOf } from "./job";
import { OFFER_TITLE_ID, tailorCv } from "./tailor";
import type { TailoredCvDraft } from "./types";

const bulletIds = (d: TailoredCvDraft, exp: string) => d.sections.experiences.find((e) => e.id === exp)!.bullets.map((b) => b.id);
const allText = (d: TailoredCvDraft) => JSON.stringify(d.sections);
const failed = (d: TailoredCvDraft) => d.checks.filter((c) => c.ok === false);

describe("tailorCv — offres figées", () => {
  it("Frontend Vue.js / TypeScript", () => {
    const d = tailorCv(MASTER, JOBS.front, "deux-colonnes");
    expect(d.sections.title).toBe("Développeur Frontend Vue.js | TypeScript");
    expect(bulletIds(d, "lusis-front").slice(0, 2)).toEqual(["f-interfaces", "f-migration"]);
    expect(d.sections.skillGroups[0]!.id).toBe("frontend");
    expect(d.sections.skillGroups[0]!.items.slice(0, 3).map((i) => i.skillId)).toEqual(["typescript", "vue", "vuetify"]);
    expect(bulletIds(d, "lusis-back")).toHaveLength(2); // réduite au minimum
    expect(d.sections.experiences.map((e) => e.id)).toEqual(["lusis-front", "lusis-back"]);
    expect(failed(d)).toEqual([]);
  });

  it("Java junior Spring Boot", () => {
    const d = tailorCv(MASTER, JOBS.java, "une-colonne");
    expect(bulletIds(d, "lusis-back")).toEqual(expect.arrayContaining(["b-serveur", "b-api-externes", "b-api-internes"]));
    expect(d.sections.skillGroups[0]!.id).toBe("backend");
    expect(d.sections.title).toMatch(/Java/);
    expect(d.sections.experiences[0]!.bullets[0]!.text).toMatch(/^Développé/); // style verbe
    expect(failed(d)).toEqual([]);
  });

  it("Mobile Flutter / Kotlin", () => {
    const job = jobFor("Développeur mobile Flutter / Kotlin", "Applications Android en Kotlin et multiplateforme en Flutter. BLoC apprécié.", ["Flutter", "Kotlin", "Android"], ["BLoC"]);
    const d = tailorCv(MASTER, job, "deux-colonnes");
    expect(d.sections.projects.slice(0, 2).map((p) => p.id)).toEqual(["search-your-product", "parking"]);
    expect(d.sections.skillGroups[0]!.id).toBe("mobile");
    expect(d.sections.title).toBe("Développeur mobile Flutter / Kotlin | Android"); // intitulé de l'offre
    expect(d.offerTitle).toBe("Développeur mobile Flutter / Kotlin");
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
  });
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

describe("titre repris de l'offre", () => {
  it("nettoie l'intitulé : H/F, CDI, lieu, entreprise, doublon masculin/féminin", () => {
    expect(cleanOfferTitle("Junior Full-Stack Engineer (Product & Platform)")).toBe("Junior Full-Stack Engineer");
    expect(cleanOfferTitle("Software Engineer Fullstack - CDI Paris - Theodo Retail")).toBe("Software Engineer Fullstack");
    expect(cleanOfferTitle("Développeur FullStack Java/React H/F (CDI)")).toBe("Développeur FullStack Java/React");
    expect(cleanOfferTitle("Développeur Java Fullstack X/ F/H")).toBe("Développeur Java Fullstack");
    expect(cleanOfferTitle("CDI - Développeur Front-End Applications Web")).toBe("Développeur Front-End Applications Web");
    expect(cleanOfferTitle("Ingénieur logiciel/Ingénieure logiciel")).toBe("Ingénieur logiciel");
  });

  it("refuse un niveau au-dessus du tien, un contrat qui n'est pas un emploi, ou un autre métier", () => {
    expect(cleanOfferTitle("Confirmed Software Engineer")).toBeNull();
    expect(cleanOfferTitle("Développeur Senior Vue.js")).toBeNull();
    expect(cleanOfferTitle("Tech Lead Java")).toBeNull();
    expect(cleanOfferTitle("Alternance - Développeur web")).toBeNull();
    expect(cleanOfferTitle("Consultant(e) DORA / Power Platform")).toBeNull();
    expect(cleanOfferTitle("Chef de projet digital")).toBeNull();
  });

  it("reprend l'intitulé si ses compétences sont dans ton CV, sinon le titre du CV complet", () => {
    const ok = tailorCv(MASTER, jobFor("Développeur Full-Stack Java H/F", "Java, Spring Boot, Vue.js", ["Java", "Spring Boot", "Vue.js"]), "deux-colonnes");
    expect(ok.sections.title).toBe("Développeur Full-Stack Java | Vue.js, Spring Boot");
    expect(ok.picked.find((p) => p.kind === "title")!.id).toBe(OFFER_TITLE_ID);
    expect(failed(ok)).toEqual([]);
    // Svelte n'est pas dans le CV : l'intitulé n'est pas repris.
    const ko = tailorCv(MASTER, jobFor("Développeur Svelte / TypeScript", "Svelte, TypeScript", ["Svelte", "TypeScript"]), "deux-colonnes");
    expect(ko.offerTitle).toBeNull();
    expect(ko.sections.title).not.toMatch(/Svelte/);
  });

  it("un titre choisi à la main prime sur l'intitulé de l'offre", () => {
    const d = tailorCv(MASTER, JOBS.java, "deux-colonnes", { add: [], remove: [], variants: {}, titleId: "t-back", order: {} });
    expect(d.offerTitle).toBeNull();
    expect(d.sections.title).toMatch(/^Développeur Backend Java Spring Boot/);
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
    expect(group("python")).toBe("backend");
    expect(group("express")).toBe("backend");
    expect(group("gitlab")).toBe("outils");
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
