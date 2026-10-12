import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, parseProfile, ProfileSchema } from "./profile";

describe("ProfileSchema", () => {
  it("accepte le profil par défaut", () => {
    expect(ProfileSchema.safeParse(DEFAULT_PROFILE).success).toBe(true);
  });

  it("ancien profil avec des poids : poids ignorés, aucune règle bonus/malus", () => {
    const profile = parseProfile({ ...DEFAULT_PROFILE, scoreRules: undefined, scoringWeights: { technical: 1 } });
    expect(profile.scoreRules).toEqual([]);
    expect("scoringWeights" in profile).toBe(false);
  });

  it("règles bonus/malus : type connu et points bornés", () => {
    const ok = { kind: "title", value: "Angular", points: -30 };
    expect(ProfileSchema.safeParse({ ...DEFAULT_PROFILE, scoreRules: [ok] }).success).toBe(true);
    expect(ProfileSchema.safeParse({ ...DEFAULT_PROFILE, scoreRules: [{ ...ok, kind: "salary" }] }).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...DEFAULT_PROFILE, scoreRules: [{ ...ok, points: 80 }] }).success).toBe(false);
  });

  it("refuse experienceMin > experienceMax", () => {
    const res = ProfileSchema.safeParse({
      ...DEFAULT_PROFILE,
      experienceMin: 5,
      experienceMax: 2,
    });
    expect(res.success).toBe(false);
  });

  it("complète les compétences d'un ancien profil qui n'en avait pas", () => {
    const { skills: _ignored, ...old } = DEFAULT_PROFILE;
    const res = ProfileSchema.parse(old);
    expect(res.skills).toContain("Vue.js");
  });

  it("refuse un code département invalide", () => {
    const res = ProfileSchema.safeParse({
      ...DEFAULT_PROFILE,
      locations: [{ label: "X", department: "Oise" }],
    });
    expect(res.success).toBe(false);
  });
});
