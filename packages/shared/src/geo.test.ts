import { describe, expect, it } from "vitest";
import { departmentFromPostalCode, departmentFromText, departmentName } from "./geo";

describe("géographie", () => {
  it.each([
    ["Compiègne, Hauts-de-France, France", "60"],
    ["Paris 9e Arrondissement", "75"],
    ["75009 Paris", "75"],
    ["Beauvais (60)", "60"],
    ["Oise", "60"],
    ["Val-d'Oise", "95"],
    ["La Défense", "92"],
    ["Issy-les-Moulineaux, France", "92"],
    ["Lyon", "69"],
    ["Berlin, Germany", "99"],
    ["London, UK", "99"],
    ["Remote", null],
    ["France", null],
    ["", null],
  ] as const)("%s → %s", (text, expected) => {
    expect(departmentFromText(text)).toBe(expected);
  });

  it("codes postaux", () => {
    expect(departmentFromPostalCode("60200")).toBe("60");
    expect(departmentFromPostalCode("97400")).toBe("974");
    expect(departmentFromPostalCode("20000")).toBe("2A");
    expect(departmentFromPostalCode("6020")).toBeNull();
  });

  it("nom d'un département", () => {
    expect(departmentName("60")).toBe("Oise");
    expect(departmentName("00")).toBeNull();
  });
});
