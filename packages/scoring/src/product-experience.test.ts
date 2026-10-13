import { DEFAULT_PROFILE, type Profile } from "@job-radar/shared";
import { describe, expect, it } from "vitest";
import { scoreJob, type ScoringInput } from "./score";

// Offre TECHNIA (LinkedIn, Paris), extraits de l'annonce : 89 % avant correction alors qu'elle exige
// 3 ans sur 3DEXPERIENCE ou APRISO, absents du profil.
const TECHNIA: ScoringInput = {
  title: "PLM 3DEXPERIENCE or MES APRISO Consultants (H/F)",
  description: `TECHNIA recrute !

Consultants PLM 3DEXPERIENCE Ou APRISO (H/F)

Dans le cadre de notre croissance, nous recrutons plusieurs consultants expérimentés sur les solutions 3DEXPERIENCE (PLM) ou APRISO (MES).

Vous justifiez de 3 ans d’expérience minimum sur ces environnements ? Rejoignez-nous !

Developer

• Réaliser les développements et paramétrages
• Effectuer les tests unitaires
• Gérer la configuration logicielle (Git, CI/CD)

Compétences Clés :

• Solides bases techniques (Java, JS, scripts selon techno)
• Connaissance des frameworks 3DEXPERIENCE / APRISO
• Bonne culture DevOps et intégration continue

As part of our continued growth, we are looking for experienced consultants specializing in 3DEXPERIENCE (PLM) or APRISO (MES) solutions.

If you have at least 3 years of experience working with these technologies, we'd love to hear from you!`,
  technologies: ["Java", "Git", "CI/CD"],
  contractType: null,
  experienceMinYears: 3,
  salaryMin: null,
  salaryMax: null,
  department: "75",
  remoteType: "unknown",
  travelMinutes: 18,
  travelMode: "transit",
};

const ME: Profile = {
  ...DEFAULT_PROFILE,
  skills: ["Vue.js", "JavaScript", "TypeScript", "React", "Node.js", "Java", "Spring Boot", "SQL", "Docker", "Git", "CI/CD", "DevOps", "Tests unitaires"],
  contracts: ["CDD", "CDI"],
  experienceYears: 2.5,
};

describe("expérience exigée sur un produit absent du profil", () => {
  it("annonce Technia : 40 % maximum, avec le point de vigilance", () => {
    const s = scoreJob(TECHNIA, ME);
    // 3DEXPERIENCE et APRISO (titre) comptent maintenant dans la technique : 26 %, déjà sous le plafond de 40 %.
    expect(s.final).toBe(26);
    expect(s.warnings).toContain("Expérience exigée sur un produit que tu n'as pas : 3DEXPERIENCE, DELMIA Apriso (3 ans demandés)");
    expect(s.reasons.some((r) => r.includes("d'expérience demandé"))).toBe(false);
  });

  it("plafond réglable", () => {
    const s = scoreJob(TECHNIA, { ...ME, productExperienceCap: 15 });
    expect(s.final).toBe(15);
    expect(s.capLabel).toBe("expérience exigée sur un produit que tu n'as pas");
  });

  it("bonne technique mais années exigées sur une techno absente : plafonnée à 40 %", () => {
    const job = { ...TECHNIA, title: "Développeur Java", description: "Java, Spring Boot. 3 ans d'expérience minimum sur Angular." };
    const s = scoreJob(job, ME);
    expect(s.final).toBe(40);
    expect(s.capLabel).toBe("expérience exigée sur un produit que tu n'as pas");
  });

  it("produit dans le profil : pas de plafond", () => {
    expect(scoreJob(TECHNIA, { ...ME, skills: [...ME.skills, "3DEXPERIENCE", "Apriso"] }).capLabel).toBeNull();
  });

  it("années demandées au-delà de l'expérience réelle (mais dans la cible) : vigilance, pas de vert", () => {
    const job = { ...TECHNIA, title: "Développeur Java", description: "3 ans d'expérience en développement." };
    const s = scoreJob(job, ME);
    expect(s.warnings).toContain("Demande 3 ans d'expérience (tu en as 2,5)");
    expect(s.reasons).not.toContain("3 an(s) d'expérience demandé(s)");
    // Le score ne bouge pas : il suit ta cible (1 à 3 ans).
    expect(s.final).toBe(scoreJob(job, { ...ME, experienceYears: null }).final);
    expect(scoreJob(job, { ...ME, experienceYears: null }).reasons).toContain("3 an(s) d'expérience demandé(s)");
  });
});
