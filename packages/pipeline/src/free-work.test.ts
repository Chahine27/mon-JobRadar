import { normalize, withoutFreeWorkIntro } from "@job-radar/job-normalizer";
import { describe, expect, it } from "vitest";
import { freeWorkQuery } from "./complete";
import { fillGaps, oldestSalary, ownerFields, sameDescription } from "./renormalize";

const INTRO =
  "Free-Work est une plateforme qui s'adresse à tous les professionnels des métiers de l'informatique. Ses contenus et son jobboard IT sont mis à disposition 100% gratuitement pour les indépendants et les salariés du secteur. ";

describe("Adzuna / Free-Work", () => {
  it("présentation du site retirée de l'extrait", () => {
    expect(withoutFreeWorkIntro(`${INTRO}Contexte Nous recherchons un développeur.`)).toBe("Contexte Nous recherchons un développeur.");
    expect(withoutFreeWorkIntro("Contexte Nous recherchons un développeur.")).toBe("Contexte Nous recherchons un développeur.");
  });

  it("recherche : titre sans le contrat ajouté par Adzuna ni H/F", () => {
    expect(freeWorkQuery("Développeur java backend spring batch tdd h/f (CDI)")).toBe("Développeur java backend spring batch tdd");
    expect(freeWorkQuery("Développeur C# .NET / Angular – Framework Core (H/F) (CDI)")).toBe("Développeur C# .NET / Angular – Framework Core");
    expect(freeWorkQuery("Développeur(se) Full stack Angular/.Net F/H/X")).toBe("Développeur se Full stack Angular/.Net");
  });
});

describe("offres à plusieurs sources : source qui a écrit la description", () => {
  const raw = (id: string, description: string, contract: string) =>
    normalize({
      source: "adzuna",
      sourceJobId: id,
      data: { id, title: "Développeur Java", description, redirect_url: `https://www.adzuna.fr/land/ad/${id}`, contract_type: contract, company: { display_name: "Acme" } },
      collectedAt: new Date("2026-10-20"),
    })!;
  const text = "Nous recherchons un développeur Java confirmé pour une mission longue chez un client bancaire. ".repeat(5);

  it("même texte (présentation Free-Work ignorée) ou même début", () => {
    expect(sameDescription(`${INTRO}${text}`, text)).toBe(true);
    expect(sameDescription(text, `${text} Fin ajoutée.`)).toBe(true);
    expect(sameDescription(text, "Autre annonce, autre client.")).toBe(false);
    expect(sameDescription("", "")).toBe(false);
  });

  it("champs pris de la source propriétaire ; aucune ou en désaccord → rien", () => {
    const owner = raw("1", text, "permanent");
    const other = raw("2", "Un tout autre texte d'annonce, pour un autre poste ailleurs.", "contract");
    expect(ownerFields(text, [other, owner], { remoteType: "unknown" })?.contractType).toBe("CDI");
    expect(ownerFields("Texte inconnu des sources.", [other, owner], { remoteType: "unknown" })).toBeNull();
    expect(ownerFields(text, [owner, raw("3", text, "contract")], { remoteType: "unknown" })).toBeNull();
    // Contrat inconnu de la source propriétaire : le CDI venu d'une autre source reste.
    expect(ownerFields(text, [raw("4", text, "")], { remoteType: "unknown", contractType: "CDI" })?.contractType).toBe("CDI");
  });

  it("salaires contradictoires : celui de la plus ancienne annonce (Talan 36 k€, copie à 70–100 k€)", () => {
    const paid = (id: string, min: number | null, max: number | null) => ({ ...raw(id, text, "permanent"), salaryMin: min, salaryMax: max, salaryPeriod: min ? "year" as const : null });
    expect(oldestSalary([paid("1", 36000, 36000), paid("2", 70000, 100000)])?.salaryMin).toBe(36000);
    expect(oldestSalary([paid("1", null, null), paid("2", 50000, 70000), paid("3", 90000, 130000)])?.salaryMax).toBe(70000);
    expect(oldestSalary([paid("1", 40000, 45000), paid("2", 45000, 50000)])).toBeNull();
  });

  it("les infos s'additionnent : champ vide de l'annonce propriétaire pris aux autres, si elles s'accordent (VISIAN)", () => {
    const linkedin = raw("1", text, "");
    const cdi = raw("2", text, "permanent");
    const cdd = raw("3", text, "contract"); // Adzuna : « contract » = CDD
    expect(fillGaps(linkedin, [linkedin, cdi, raw("4", text, "permanent")]).contractType).toBe("CDI");
    expect(fillGaps(linkedin, [cdi, cdd]).contractType).toBeNull(); // CDI ici, CDD là : rien
    expect(fillGaps(cdd, [cdi]).contractType).toBe("CDD"); // une valeur connue n'est jamais remplacée
    const paid = { ...cdi, salaryMin: 40000, salaryMax: 45000, salaryPeriod: "year" as const };
    expect(fillGaps(linkedin, [cdi, paid])).toMatchObject({ salaryMin: 40000, salaryMax: 45000, salaryPeriod: "year" });
    expect(fillGaps(linkedin, [{ ...cdi, experienceMinYrs: 3, experienceMaxYrs: 5 }]).experienceMinYrs).toBe(3);
    expect(fillGaps(linkedin, [{ ...cdi, remoteType: "hybrid" as const }, { ...cdi, remoteType: "remote" as const }]).remoteType).toBe("unknown");
  });
});
