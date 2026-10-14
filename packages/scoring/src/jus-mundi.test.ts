import { DEFAULT_PROFILE, type Profile } from "@job-radar/shared";
import { describe, expect, it } from "vitest";
import { scoreJob, type ScoringInput } from "./score";
import { fluentEnglishRequired, productionRequired, requiredText } from "./signals";

// Offre Jus Mundi (LinkedIn, Paris), extraits de l'annonce : notée 75 % alors que Python en production en est le
// cœur (vu seulement en projets), que Vue n'est qu'un « plus » et que l'anglais courant est exigé.
const JUS_MUNDI: ScoringInput = {
  title: "Backend Engineer — Data Platform & AI Agents",
  description: `📌 About the Role

Jus Mundi is building the AI layer for international law.

• Lineage for every value. A FastAPI service and a Postgres catalog hold every document, its versions, and where each value came from.
• What you ship, you run. You deploy, watch logs, metrics and traces, fix what breaks.

Stack: Python, FastAPI, Pydantic AI, RabbitMQ, Postgres, Elasticsearch, Langfuse, Kubernetes, Vue for the back office. Nobody expects you to know all of it.

⚙️ Preferred Experience And Skills

Must have

• You have built and run backend services in Python in production. You can deliver a well-scoped feature on your own, investigate a production failure, and reason about data consistency. You write tests and design APIs.
• Solid SQL and Postgres: table design, indexes, migrations, transactions.
• Production habits: Docker, CI/CD, logs and metrics.
• Fluent English, written and spoken.

Strongly Preferred

• You have built something real with an LLM, at work or in a side project you can show us.

Nice to have

• Queues and background jobs (Celery, RabbitMQ or similar)
• Search and embeddings (Elasticsearch, OpenSearch, vector search)
• LLM observability (Langfuse or similar)
• Some TypeScript and Vue

🔄 Interview process

To ensure smooth communication, please apply in English (CV + application form).

Whether you're early in your career or a seasoned professional, your unique perspective and skills are what matter most.`,
  technologies: ["TypeScript", "Vue.js", "Python", "FastAPI", "SQL", "PostgreSQL", "Docker", "Kubernetes", "CI/CD", "HTML"],
  contractType: null,
  experienceMinYears: null,
  salaryMin: null,
  salaryMax: null,
  department: "75",
  remoteType: "hybrid",
  travelMinutes: 9,
  travelMode: "transit",
};

/** Ce que l'IA a lu dans l'annonce (analyse enregistrée). */
const AI_SKILLS = { required: ["Python", "FastAPI", "Postgres", "Docker", "CI/CD", "SQL"], bonus: ["LLM", "Langfuse", "Elasticsearch", "RabbitMQ", "Vue", "TypeScript"] };

const ME: Profile = {
  ...DEFAULT_PROFILE,
  skills: ["Vue.js", "Vuetify", "JavaScript", "Java", "Spring Boot", "API REST", "PostgreSQL", "SQL", "Git", "Accessibilité",
    "Python", "React", "TypeScript", "Node.js", ".NET", "C#", "Kotlin", "Flutter", "Docker", "CI/CD", "IA", "Intelligence artificielle"],
  projectSkills: ["Python", "React", "TypeScript", "Node.js", ".NET", "C#", "Kotlin", "Flutter", "Docker", "CI/CD", "IA", "Intelligence artificielle"],
  contracts: ["CDI"],
};

describe("offre Jus Mundi : Python vu seulement en projets, anglais courant, domaine IA", () => {
  it("avec les compétences lues par l'IA : entre 20 et 30 %", () => {
    const s = scoreJob({ ...JUS_MUNDI, aiSkills: AI_SKILLS }, ME);
    expect(s.final).toBeGreaterThanOrEqual(20);
    expect(s.final).toBeLessThanOrEqual(30);
    expect(s.breakdown.technical).toBeLessThanOrEqual(50);
    expect(s.adjustments.map((a) => a.label)).toEqual(["Anglais courant exigé"]); // ni Vue, ni « junior »
    expect(s.weakFit).toContain("poste orienté IA / LLM, domaine absent de ton expérience en entreprise");
    expect(s.reasons.some((r) => r.includes("En projets") || r.includes("en projets"))).toBe(true);
  });

  it("sans l'IA (mots-clés du texte) : pas de bonus Vue (un « plus ») ni junior, plafond faible", () => {
    const s = scoreJob(JUS_MUNDI, ME);
    expect(s.adjustments.some((a) => a.label.includes("Vue"))).toBe(false);
    expect(s.adjustments.some((a) => a.label.includes("junior"))).toBe(false);
    expect(s.final).toBeLessThanOrEqual(40);
  });

  it("« 0 an » lu par l'IA mais services en production exigés : pas de bonus junior", () => {
    const s = scoreJob({ ...JUS_MUNDI, aiSkills: AI_SKILLS, experienceMinYears: 0 }, ME);
    expect(s.adjustments.some((a) => a.label.includes("junior"))).toBe(false);
    expect(s.reasons.some((r) => r.includes("À apprendre"))).toBe(false);
  });

  it("une compétence en entreprise compte en entier, en projets à moitié", () => {
    const java = { ...JUS_MUNDI, title: "Développeur Java", aiSkills: { required: ["Java", "SQL"], bonus: [] } };
    expect(scoreJob(java, ME).breakdown.technical).toBe(100);
    const py = { ...java, title: "Développeur Python", aiSkills: { required: ["Python", "SQL"], bonus: [] } };
    // Python (titre, ×3) à moitié + SQL entier = 2,5 / 4 = 63 %, plafonné à 50 % : techno principale en projets.
    expect(scoreJob(py, ME).breakdown.technical).toBe(50);
  });
});

describe("vérifications faites par le code", () => {
  it("anglais courant exigé, pas quand c'est un plus", () => {
    expect(fluentEnglishRequired("• Fluent English, written and spoken.")).toBe(true);
    expect(fluentEnglishRequired("Anglais courant indispensable")).toBe(true);
    expect(fluentEnglishRequired("Merci de candidater en anglais.")).toBe(true);
    expect(fluentEnglishRequired("Anglais courant apprécié")).toBe(false);
    expect(fluentEnglishRequired("Anglais technique (lecture de documentation)")).toBe(false);
  });

  it("services en production exigés", () => {
    expect(productionRequired("You have built and run backend services in Python in production.")).toBe(true);
    expect(productionRequired("Vous avez déjà mis des applications en production.")).toBe(true);
    expect(productionRequired("Tu participeras à la mise en production des évolutions.")).toBe(false);
  });

  it("rubrique « Nice to have » retirée du texte exigé", () => {
    const t = requiredText("Must have\n• Java\n\nNice to have\n• Some TypeScript and Vue\n\nInterview process\nApply now.");
    expect(t).toContain("Java");
    expect(t).not.toContain("Vue");
    expect(t).toContain("Apply now");
  });
});
