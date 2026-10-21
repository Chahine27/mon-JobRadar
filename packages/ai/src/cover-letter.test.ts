import { describe, expect, it } from "vitest";
import {
  analysisWantsAiCoding,
  assembleLetter,
  badPunctuation,
  buildPlanPrompt,
  buildWritePrompt,
  checkLetter,
  findInventions,
  cleanTitle,
  offerWantsAiCoding,
  cleanPlan,
  cvEntities,
  findLetterIssues,
  fixPunctuation,
  inventedNeeds,
  letterBlocks,
  rewriteFlaggedSentences,
  spontaneousJobInput,
  toParagraphs,
  tooManyCommas,
  writeCoverLetter,
} from "./cover-letter";

// Candidat et entreprises fictifs.
const KIT = {
  header: "Alex Martin\n75011 Paris\n06 00 00 00 00\nalex.martin@example.com",
  city: "Paris",
  signature: "Alex MARTIN",
  cvText:
    "Alex Martin — Développeur Full Stack. Mastère Architecture Logicielle. 2 ans d'alternance chez Banquo : " +
    "interfaces Vue.js et TypeScript, API REST en Java Spring Boot, base PostgreSQL. Projet de fin d'études : " +
    "application .NET 8 avec Docker et Keycloak. Git, GitLab, CI/CD. ".repeat(2),
  blocks: [
    { title: "Écrans de supervision", useFor: "frontend, Vue.js", text: "Chez Banquo j'ai créé six écrans de supervision en Vue.js. Ma collègue du backend écrivait les fonctions serveur pendant que je branchais les écrans." },
    { title: "API Java", useFor: "backend, Java, API", text: "Chez Banquo j'ai aussi développé des API REST en Java Spring Boot. Je testais chaque appel avant de le brancher." },
    { title: "Hackathon", useFor: "initiative", text: "Au hackathon de mon école notre équipe a fini troisième." },
  ],
  rules: "Pas de Scrum chez Banquo.",
  mastered: "",
  bannedWords: "",
  pdfName: "",
};
const JOB = {
  title: "Développeur Vue.js / Java (H/F)",
  company: "Logistik",
  city: "Lyon",
  department: "69",
  contractType: "CDI",
  remoteType: "hybrid",
  salaryMin: null,
  salaryMax: null,
  description: "Logistik, éditeur de logiciels de transport, recrute un développeur Vue.js / Java Spring Boot. Kafka apprécié.",
};
const jobText = `${JOB.title}\n${JOB.description}`;
const GOOD =
  "Chez Banquo j'ai travaillé sur des interfaces Vue.js et sur des API Java. C'est ce double profil que je vous propose pour vos logiciels de transport.\n\n" +
  "J'ai créé six écrans de supervision en Vue.js chez Banquo. Ma collègue du backend écrivait les fonctions serveur pendant que je branchais les écrans. " +
  "Ce travail en parallèle demandait de bien se parler chaque jour. ".repeat(6) +
  "\n\nJ'ai aussi développé des API REST en Java Spring Boot. Je testais chaque appel avant de le brancher. " +
  "Les équipes métier utilisaient ces écrans tous les jours pour suivre leur activité. ".repeat(4) +
  "\n\nJe serais heureux d'échanger avec vous sur vos projets chez Logistik.";

/** Faux client IA : répond selon la demande (plan, lettre, phrase à réécrire). */
function fakeClient(letters: string[], opts: { phrase?: string; paid?: boolean; inventions?: Array<{ phrase: string; raison: string }> } = {}) {
  const calls: Array<{ kind: string; user: unknown }> = [];
  let n = 0;
  return {
    calls,
    model: "fake",
    paid: opts.paid ?? false,
    chatJson: async (_system: string, user: unknown, schema: { properties: Record<string, unknown> }) => {
      if ("blocs" in schema.properties) return calls.push({ kind: "plan", user }), { angle: "Vue.js et Java", blocs: [1, 2], accroche: "logiciels de transport" };
      if ("inventions" in schema.properties) return calls.push({ kind: "verif", user }), { inventions: opts.inventions ?? [] };
      if ("phrase" in schema.properties) return calls.push({ kind: "phrase", user }), { phrase: opts.phrase ?? "" };
      calls.push({ kind: "lettre", user });
      return { lettre: letters[Math.min(n++, letters.length - 1)] };
    },
  };
}

describe("écriture en deux temps : l'angle et les blocs, puis la lettre", () => {
  it("le plan reçoit les blocs numérotés et l'annonce ; la lettre ne reçoit que les blocs choisis", () => {
    const blocks = letterBlocks(KIT);
    expect(buildPlanPrompt(JOB, blocks)).toMatch(/1\. Écrans de supervision\nSert pour : frontend, Vue\.js/);
    const p = buildWritePrompt(JOB, KIT, { angle: "Vue.js et Java", blocs: [2], accroche: "" }, blocks);
    expect(p).toContain("[API Java]");
    expect(p).not.toContain("Écrans de supervision");
    expect(p).toContain("RÈGLES D'HONNÊTETÉ");
    expect(p).toContain("Entreprise : Logistik");
  });

  it("plan douteux : blocs inconnus ou en double ignorés ; plan vide → les blocs qui recoupent l'annonce", () => {
    const blocks = letterBlocks(KIT);
    expect(cleanPlan({ angle: "a", blocs: [2, 2, 9, 0], accroche: "" }, blocks, JOB).blocs).toEqual([2]);
    expect(cleanPlan(null, blocks, JOB).blocs.slice(0, 2).sort()).toEqual([1, 2]);
  });

  it("sans bloc, le CV sert de seule source ; Job Radar ajouté seulement si autorisé", () => {
    expect(letterBlocks({ ...KIT, blocks: [] })).toMatchObject([{ title: "CV" }]);
    expect(letterBlocks(KIT, { aiCoding: true }).at(-1)!.title).toMatch(/Job Radar/);
    expect(letterBlocks(KIT).some((b) => /Job Radar/.test(b.title))).toBe(false);
  });

  it("lettre correcte : un plan, une lettre, assemblée avec objet, politesse et signature", async () => {
    const client = fakeClient([GOOD]);
    const { content } = await writeCoverLetter(client, JOB, KIT, new Date("2026-09-29T10:00:00Z"));
    expect(client.calls.map((c) => c.kind)).toEqual(["plan", "lettre", "verif"]);
    expect(content.startsWith("Alex Martin\n75011 Paris")).toBe(true);
    expect(content).toContain("À Paris, le 29/09/2026");
    expect(content).toContain("Objet : Candidature au poste de Développeur Vue.js / Java\n\nMadame, Monsieur,\n\nChez Banquo");
    expect(content.endsWith("salutations distinguées.\n\nAlex MARTIN")).toBe(true);
  });

  it("lettre fautive → corrigée en conversation avec la liste des problèmes ; la meilleure version est gardée", async () => {
    const bad = GOOD.replace("Je serais heureux", "Je maîtrise Kafka. Je serais heureux");
    const client = fakeClient([bad, GOOD]);
    const { content } = await writeCoverLetter(client, JOB, KIT);
    const fix = client.calls[2]!.user as Array<{ role: string; content: string }>;
    expect(fix.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(fix[2]!.content).toMatch(/PROBLÈMES À CORRIGER/);
    expect(fix[2]!.content).toMatch(/maîtrise/);
    expect(content).not.toContain("Kafka");
  });

  it("IA payante : la plume écrit une seule fois ; l'assistant choisit l'angle, vérifie et corrige la phrase fautive", async () => {
    const bad = GOOD.replace("Je serais heureux", "Je maîtrise Kafka. Je serais heureux");
    const pen = fakeClient([bad], { paid: true });
    const helper = fakeClient([], { phrase: "Je serais ravi d'en parler." });
    const { content } = await writeCoverLetter(pen, JOB, KIT, new Date(), {}, helper);
    expect(pen.calls.map((c) => c.kind)).toEqual(["lettre"]);
    expect(helper.calls.map((c) => c.kind)).toEqual(["plan", "verif", "phrase"]);
    expect(String(helper.calls[2]!.user)).toMatch(/maîtrise/);
    expect(content).not.toContain("Kafka");
  });

  it("candidature spontanée : objet imposé et pas de « votre offre »", async () => {
    const company = { name: "ALPHA LOGICIELS", sector: "Programmation informatique", city: "Creil", department: "60", headcountMin: 10, headcountMax: 19 };
    const job = spontaneousJobInput(company, "Développeur full stack");
    expect(job.description).toContain("AUCUNE offre");
    expect(buildWritePrompt(job, KIT, { angle: "", blocs: [1], accroche: "" }, letterBlocks(KIT), { spontaneous: true })).toMatch(/^CANDIDATURE SPONTANÉE/);
    expect(findLetterIssues("x\nVotre offre a retenu mon attention.", KIT, job.description, { spontaneous: true }).join("\n")).toMatch(/il n'y a pas d'offre/);
    const { content } = await writeCoverLetter(fakeClient([GOOD.replace(/Logistik/g, "ALPHA LOGICIELS")]), job, KIT, new Date(), { spontaneous: true });
    expect(content).toContain("Objet : Candidature spontanée – Développeur full stack");
  });
});

describe("ponctuation : seulement des virgules et des points", () => {
  it("repère deux-points, point-virgule, tirets, parenthèses, guillemets, « ! », « ? » ; laisse CI/CD, C#, Vue.js et .NET", () => {
    for (const s of ["Mon rôle : créer des écrans.", "J'ai créé des écrans ; ils marchent.", "J'ai créé — en Vue.js — des écrans.", "J'ai créé des écrans (six).", "J'ai créé l'écran « Pipelines ».", "Pourquoi pas ?", "React + Vite"]) {
      expect(badPunctuation(s)).toBe(true);
    }
    expect(badPunctuation("J'ai mis en place la CI/CD en C# et en .NET avec Vue.js et du full-stack.")).toBe(false);
  });

  it("une virgule au plus par phrase", () => {
    expect(tooManyCommas("Chez Banquo, j'ai créé des écrans.")).toBe(false);
    expect(tooManyCommas("Chez Banquo, j'ai créé des écrans, des API, des tests.")).toBe(true);
  });

  it("dernier recours : la ponctuation interdite est remplacée par le code", () => {
    expect(fixPunctuation("Mon rôle : créer des écrans ; ils marchent (bien).")).toBe("Mon rôle. Créer des écrans. Ils marchent bien.");
    expect(fixPunctuation("J'ai utilisé React + Vite et l'écran « Pipelines » en .NET.")).toBe("J'ai utilisé React et Vite et l'écran Pipelines en .NET.");
  });

  it("signalée par la relecture dans le corps seulement (l'objet garde ses deux-points)", () => {
    const issues = findLetterIssues("Objet : Candidature\nMon rôle : créer des écrans chez Banquo, en Vue.js, avec TypeScript.", KIT, jobText).join("\n");
    expect(issues).toMatch(/^Ponctuation/m);
    expect(issues).toMatch(/Trop de virgules/);
    expect(findLetterIssues("Objet : Candidature\nChez Banquo j'ai créé des écrans en Vue.js.", KIT, jobText).join("\n")).not.toMatch(/Ponctuation|virgules/);
  });
});

describe("cas emagine (règles 2026-10-20.4)", () => {
  it("reprendre l'intitulé du poste n'est pas recopier l'annonce", () => {
    const job = "Développeur Fullstack Java / React\nemagine recrute pour le poste de développeur fullstack Java React chez un client bancaire.";
    expect(findLetterIssues("x\nChez emagine le poste de développeur fullstack Java et React m'intéresse.", KIT, job).join("\n")).not.toMatch(/recopiée/);
  });
  it("phrases-formules de liaison refusées", () => {
    const all = findLetterIssues("x\nCe travail sur des API est celui que vous demandez. J'ai migré une interface, ce qui sert la maintenance de votre annonce.", KIT, jobText).join("\n");
    expect(all).toMatch(/c'est ce que vous demandez/);
    expect(all).toMatch(/ce qui sert/);
  });
  it("virgule d'introduction retirée en dernier recours", async () => {
    const s = "Pendant ma licence pro, j'ai passé six mois sur Gold Circle, une application de cashback.";
    const out = await rewriteFlaggedSentences({ chatJson: async () => ({ phrase: s }) }, { objet: "x", paragraphes: [s, "Merci."] }, { bannedWords: "" });
    expect(out.paragraphes[0]).toBe("Pendant ma licence pro j'ai passé six mois sur Gold Circle, une application de cashback.");
  });
});

describe("objet et détection de l'IA (cas Wake IT UP et Theodo)", () => {
  it("intitulé nettoyé : version féminine, queue après un tiret, élision", async () => {
    expect(cleanTitle("Ingénieur conception logiciels/Ingénieure conception logiciels")).toBe("Ingénieur conception logiciels");
    expect(cleanTitle("Software Engineer Fullstack - CDI Paris - E-commerce - Theodo")).toBe("Software Engineer Fullstack");
    expect(cleanTitle("Développeur Fullstack Java / React (H/F)")).toBe("Développeur Fullstack Java / React");
    const { content } = await writeCoverLetter(fakeClient([GOOD]), { ...JOB, title: "Ingénieur logiciel (H/F)" }, KIT);
    expect(content).toContain("Objet : Candidature au poste d'Ingénieur logiciel\n");
  });
  it("développement avec l'IA repéré dans l'annonce même si l'analyse l'a raté", () => {
    const text = "Environnement : C#, React, Intelligence Artificielle appliquée au développement logiciel : agentic engineering.";
    expect(offerWantsAiCoding({ competences_obligatoires: ["C#", "React"] }, text)).toBe(true);
    expect(offerWantsAiCoding({ competences_obligatoires: ["C#"] }, "Environnement : C#, React.")).toBe(false);
  });
});

describe("vérification des faits par l'IA, apostrophes, Job Radar (règles 2026-10-20.6)", () => {
  const invented = "Avec mon binôme nous avons travaillé ensemble pour assurer la cohérence du front.";
  const letter = GOOD.replace("Je serais heureux", `${invented} Je serais heureux`);

  it("phrase inventée repérée par le vérificateur puis retirée ; phrase absente de la lettre ignorée", async () => {
    const draft = { objet: "x", paragraphes: toParagraphs(letter, "") };
    const found = await findInventions({ chatJson: async () => ({ inventions: [{ phrase: invented, raison: "collaboration non prouvée" }, { phrase: "Une phrase qui n'existe pas du tout ici.", raison: "x" }] }) }, draft, KIT);
    expect([...found.keys()]).toEqual([invented]);
    const out = await rewriteFlaggedSentences({ chatJson: async () => ({ phrase: "" }) }, draft, { bannedWords: "" }, found);
    expect(out.paragraphes.join(" ")).not.toContain("nous avons travaillé ensemble");
    const { content } = await writeCoverLetter(fakeClient([letter], { inventions: [{ phrase: invented, raison: "collaboration non prouvée" }] }), JOB, KIT);
    expect(content).not.toContain("nous avons travaillé ensemble");
  });

  it("phrases-commentaires refusées ; une techno déclarée maîtrisée compte comme connue", () => {
    const all = findLetterIssues("x\nJ'ai fait le back-office, ce qui m'a familiarisé avec les interfaces. Le code est sur GitHub, ce qui montre mon aisance.", { ...KIT, mastered: "Git" }, "Vue.js").join("\n");
    expect(all).toMatch(/ce qui m'a appris/);
    expect(all).toMatch(/ce qui montre/);
    expect(all).not.toMatch(/Git.*n'est pas/);
  });

  it("apostrophes perdues rétablies, sans toucher au langage C", () => {
    expect(fixPunctuation("J ai géré l erreur et j ai codé en C avec d autres.")).toBe("J’ai géré l’erreur et j’ai codé en C avec d’autres.");
  });

  it("offre qui parle de développer avec l'IA : le bloc Job Radar est toujours écrit", async () => {
    const client = fakeClient([GOOD]);
    await writeCoverLetter(client, JOB, KIT, new Date(), { aiCoding: true });
    const write = String(client.calls.find((c) => c.kind === "lettre")!.user);
    expect(write).toContain("[Job Radar");
  });
});

describe("style haché", () => {
  it("plus de deux phrases très courtes dans le corps : signalé", () => {
    const choppy = "Objet\nChez Banquo j'ai travaillé sur Gold Circle. C'était une application. Nous étions deux. J'ai codé l'API. Elle marchait bien.";
    expect(findLetterIssues(choppy, KIT, jobText).join("\n")).toMatch(/Trop de phrases très courtes/);
  });
});

describe("réécriture ciblée d'une phrase", () => {
  const d = { objet: "x", paragraphes: ["Chez Banquo j'ai développé des API. Je suis convaincu de ma motivation. Elles tournent sur PostgreSQL.", "Je serais ravi d'échanger."] };

  it("réécrit la phrase fautive au lieu de la supprimer, avec ses voisines pour le contexte", async () => {
    const seen: string[] = [];
    const client = { chatJson: async (_s: string, u: unknown) => (seen.push(String(u)), { phrase: "Ce travail m'a plu." }) };
    const out = await rewriteFlaggedSentences(client, d, { bannedWords: "" });
    expect(out.paragraphes[0]).toBe("Chez Banquo j'ai développé des API. Ce travail m'a plu. Elles tournent sur PostgreSQL.");
    expect(seen[0]).toMatch(/PHRASE D'AVANT : Chez Banquo/);
    expect(seen[0]).toMatch(/PHRASE D'APRÈS : Elles tournent/);
  });

  it("refuse une réécriture qui ajoute une techno ou un chiffre : mot interdit → phrase retirée", async () => {
    for (const phrase of ["J'ai aussi utilisé Kafka.", "J'ai créé 12 écrans."]) {
      const out = await rewriteFlaggedSentences({ chatJson: async () => ({ phrase }) }, d, { bannedWords: "" });
      expect(out.paragraphes[0]).toBe("Chez Banquo j'ai développé des API. Elles tournent sur PostgreSQL.");
    }
  });

  it("ponctuation qui résiste : remplacée par le code, la phrase reste", async () => {
    const p = { objet: "x", paragraphes: ["Mon rôle : créer des écrans chez Banquo.", "Je serais ravi d'échanger."] };
    const out = await rewriteFlaggedSentences({ chatJson: async () => ({ phrase: "Mon rôle ; créer." }) }, p, { bannedWords: "" });
    expect(out.paragraphes[0]).toBe("Mon rôle. Créer des écrans chez Banquo.");
  });
});

describe("vérité", () => {
  it("techno absente du CV et des blocs, « maîtrise », faux liens de cause, mots creux", () => {
    const bad = "x\nJe maîtrise Vue.js et j'ai de l'expérience en Go (Golang). J'ai développé un serveur, ce qui m'a permis d'avancer. Cette opportunité me motive.";
    const issues = findLetterIssues(bad, KIT, "Go (Golang), Vue.js").join("\n");
    expect(issues).toMatch(/Pas de « maîtrise »/);
    expect(issues).toMatch(/Go.*n'est pas dans le CV/);
    expect(issues).toMatch(/ce qui m'a permis/);
    expect(issues).toMatch(/opportunité/);
  });

  it("un fait écrit dans un bloc compte comme vrai (techno et chiffre)", () => {
    const kit = { ...KIT, blocks: [{ title: "Kafka", useFor: "", text: "Chez Banquo j'ai branché 3 flux Kafka." }] };
    const all = findLetterIssues("x\nChez Banquo j'ai utilisé Kafka pour 3 flux.", kit, "Kafka").join("\n");
    expect(all).not.toMatch(/Kafka n'est pas dans le CV/);
    expect(all).not.toMatch(/chiffre « 3 »/);
    expect(findLetterIssues("x\nChez Banquo j'ai créé 12 écrans.", KIT, jobText).join("\n")).toMatch(/chiffre « 12 »/);
  });

  it("manque cité hors intitulé du poste : signalé ; dans l'intitulé : permis", () => {
    expect(findLetterIssues("x\nJe n'ai pas encore utilisé Kafka.", KIT, "Développeur Vue.js / Java\nStack : Vue.js, Java, Kafka.").join("\n")).toMatch(/Ne liste pas tes manques \(Kafka\)/);
    expect(findLetterIssues("x\nJe n'ai pas encore utilisé Kafka.", KIT, "Développeur Java / Kafka\nStack : Java.").join("\n")).not.toMatch(/manques/);
  });

  it("techno attribuée au mauvais projet, entreprise d'alternance non nommée", () => {
    const cv = [
      "10/2023 – 09/2025 : Développeur Frontend — Alternance · LUSIS",
      "- Interfaces web en Vue.js",
      "",
      "- Réservation de parking — Projet : Java / Spring Boot, Flutter, Docker Compose.",
      "- CodeNShare — Projet : React, Node JS, PostgreSQL, Auth0 / JWT.",
      "",
      "COMPÉTENCES",
      "- Architecture : API REST, Microservices",
    ].join("\n");
    const kit = { ...KIT, cvText: cv, blocks: [] };
    const e = cvEntities(cv);
    expect(e.find((x) => x.name === "Réservation de parking")?.skills.has("microservices")).toBe(false);
    const issues = findLetterIssues("x\nJ'ai pratiqué les Microservices sur le projet de réservation de parking.", kit, "Microservices, Java.");
    expect(issues[0]).toMatch(/Microservices n'est pas écrit pour Réservation de parking/);
    expect(issues.join("\n")).toMatch(/Nomme l'entreprise d'alternance \(LUSIS\)/);
  });

  it("besoin inventé, phrase recopiée de l'annonce, « J'ai » en série", () => {
    expect(inventedNeeds("Mon expérience Keycloak répond au besoin de sécurisation que vous décrivez.", "Développeurs .NET et Angular.")).toHaveLength(1);
    const job = "Développeur\nVous travaillerez en méthode agile au sein d'une équipe pluridisciplinaire sur nos applications.";
    expect(findLetterIssues("x\nJe travaillerai en méthode agile au sein d'une équipe pluridisciplinaire.", KIT, job).join("\n")).toMatch(/Phrase recopiée/);
    expect(findLetterIssues("x\nJ'ai fait A. J'ai fait B. J'ai fait C.", KIT, jobText).join("\n")).toMatch(/Trois phrases de suite/);
  });

  it("Job Radar : cité seulement si l'analyse IA de l'offre parle de développement avec des agents IA", () => {
    expect(analysisWantsAiCoding({ competences_obligatoires: ["Vue.js"], competences_bonus: ["Claude Code ou Cursor"] })).toBe(true);
    expect(analysisWantsAiCoding({ competences_obligatoires: ["Vue.js"], missions: ["Développer des écrans"] })).toBe(false);
    expect(analysisWantsAiCoding(null)).toBe(false);
    const letter = "x\nSur Job Radar, mon projet perso j'ai travaillé avec Claude Code.";
    expect(findLetterIssues(letter, KIT, "Vue.js").join("\n")).toMatch(/Supprime Job Radar/);
    expect(findLetterIssues(letter, KIT, "Vue.js", { aiCoding: true }).join("\n")).not.toMatch(/Job Radar|n'est pas dans le CV/);
  });
});

describe("mise en forme et relecture affichée", () => {
  it("découpe le texte de l'IA en paragraphes, sans « Madame, Monsieur », politesse ni signature", () => {
    const p = toParagraphs("Madame, Monsieur,\n\n1. Premier paragraphe.\n\nSecond. Je vous prie d'agréer, Madame, Monsieur, mes salutations distinguées.\n\nAlex MARTIN", "Alex MARTIN");
    expect(p).toEqual(["Premier paragraphe.", "Second."]);
  });

  it("politesse et signature jamais en double", () => {
    const text = assembleLetter(KIT, { objet: "Candidature", paragraphes: ["Je candidate chez Logistik.", "Merci. Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\nAlex MARTIN"] }, new Date());
    expect(text.match(/salutations distinguées/g)).toHaveLength(1);
    expect(text.match(/Alex MARTIN/g)).toHaveLength(1);
  });

  it("relecture d'une lettre retouchée à la main : techno absente du CV, ponctuation du corps ; rien sur l'en-tête ni l'objet", () => {
    const letter = assembleLetter(KIT, { objet: "Candidature au poste de Développeur", paragraphes: ["Chez Banquo j'ai créé des écrans en Vue.js.", "Je maîtrise Kafka : c'est mon fort."] }, new Date());
    const w = checkLetter(letter, KIT, jobText, JOB.title).join("\n");
    expect(w).toMatch(/« Kafka » n'est pas dans ton CV/);
    expect(w).toMatch(/^Ponctuation/m);
    expect(checkLetter(assembleLetter(KIT, { objet: "Candidature au poste de Développeur Vue.js / Java", paragraphes: ["Chez Banquo j'ai créé des écrans en Vue.js."] }, new Date()), KIT, jobText, JOB.title)).toEqual([]);
  });
});
