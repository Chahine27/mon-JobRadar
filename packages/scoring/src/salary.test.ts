import { describe, expect, it } from "vitest";
import { parseSalaryText, salaryFromText, salaryOfJob } from "./salary";

const r = (min: number, max = min) => ({ min, max });

describe("parseSalaryText", () => {
  it.each([
    // Annuel, fourchettes
    ["35 000 € - 45 000 €", r(35000, 45000)],
    ["35 000 € - 45 000 € par an", r(35000, 45000)],
    ["De 40 000 à 45 000 euros bruts annuels", r(40000, 45000)],
    ["Salaire : 40000€ - 50000€", r(40000, 50000)],
    ["38 000,00 € - 45 000,00 €", r(38000, 45000)],
    ["45.000 € à 55.000 €", r(45000, 55000)],
    ["€60,000 – €70,000 per year", r(60000, 70000)],
    ["50 000 EUR - 60 000 EUR", r(50000, 60000)],
    // Milliers en k
    ["38k € - 42k €", r(38000, 42000)],
    ["45-55k€", r(45000, 55000)],
    ["45-55 K€ brut annuel", r(45000, 55000)],
    ["45k-55k", r(45000, 55000)],
    ["Entre 40 et 45 KE", r(40000, 45000)],
    ["40/45 k€", r(40000, 45000)],
    ["45 keuros", r(45000)],
    ["Rémunération : 42K€ fixe", r(42000)],
    ["Salary: €50K to €90K", r(50000, 90000)],
    ["3,5k€ brut par mois", r(42000)],
    // Un seul montant
    ["À partir de 42k", r(42000)],
    ["Jusqu'à 55 000 €", r(55000)],
    // Mensuel
    ["2 800 € par mois", r(33600)],
    ["2 800 € brut mensuel", r(33600)],
    ["Salaire : 2 800 € brut", r(33600)],
    ["3 000 €/mois sur 13 mois", r(39000)],
    ["2 500 € x 13", r(32500)],
    ["€2,000–3,500/month", r(24000, 42000)],
    ["45k€ sur 13 mois", r(45000)],
    // Net → brut
    ["39 000 € net annuel", r(50000)],
    // Autre devise : l'euro seulement
    ["Salary: €50K to €90K / CHF70k - CHF105K gross plus 20% bonus", r(50000, 90000)],
    // Ce qui suit est autre chose
    ["Salaire : 45k€ + prime de 5 000 €", r(45000)],
    ["45 000 € + variable 10 000 €", r(45000)],
  ] as const)("%s", (text, expected) => {
    expect(parseSalaryText(text)).toEqual(expected);
  });

  it.each([
    "450 € par jour",
    "TJM : 500 €",
    "12 € de l'heure",
    "15 €/h",
    "$120,000",
    "£50k - £60k",
    "CHF 100 000",
    "Selon profil",
    "Tickets restaurant 9 €",
    "Prime de 3 000 €",
    "Chiffre d'affaires de 12 M€",
    "Estimation Hellowork : 37 900 - 65 000 € / an",
    "Bac+5, 3 ans d'expérience",
    "20 % de remise",
    "",
  ])("%s → null", (text) => {
    expect(parseSalaryText(text)).toBeNull();
  });
});

describe("salaryFromText", () => {
  it("lit la ligne de salaire d'une annonce LinkedIn en anglais", () => {
    const text = [
      "Offer details",
      "• Location: Paris/Geneva hybrid (~3 days/week) or remote within France/Switzerland",
      "• Contract: CDI (permanent)",
      "• Salary: €50K to €90K / CHF70k - CHF105K gross plus 20% bonus on collective milestones.",
      "• Also open to: interns / young graduates (5–6 month internship, €2,000–3,500/month)",
    ].join("\n");
    expect(salaryFromText(text)).toEqual(r(50000, 90000));
  });

  it("ignore avantages et chiffres de l'entreprise, garde le salaire", () => {
    const text =
      "Créée en 2015, 120 collaborateurs, 15 M€ de CA. Avantages : tickets restaurant 10 €, mutuelle. Salaire : 42 - 48 k€ selon profil.";
    expect(salaryFromText(text)).toEqual(r(42000, 48000));
  });

  it("sans mot « salaire », seulement un montant marqué", () => {
    expect(salaryFromText("Poste basé à Paris\n45 000 € - 50 000 €")).toEqual(r(45000, 50000));
    expect(salaryFromText("Fondée en 2012, 3 500 clients")).toBeNull();
  });
});

describe("salaryOfJob", () => {
  it("garde le salaire de la source, sinon le lit dans l'annonce", () => {
    expect(salaryOfJob({ salaryMin: 40000, salaryMax: 45000, description: "Salaire : 60k€" })).toEqual({ salaryMin: 40000, salaryMax: 45000 });
    expect(salaryOfJob({ salaryMin: null, salaryMax: null, description: "Salaire : 60k€" })).toEqual({ salaryMin: 60000, salaryMax: 60000 });
    expect(salaryOfJob({ salaryMin: null, salaryMax: null, description: "Rien" })).toEqual({ salaryMin: null, salaryMax: null });
  });
});
