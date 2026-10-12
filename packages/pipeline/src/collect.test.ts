import { DEFAULT_PROFILE } from "@job-radar/shared";
import { describe, expect, it } from "vitest";
import { buildQueries } from "./collect";

describe("buildQueries", () => {
  it("chaque recherche × chaque zone", () => {
    const q = buildQueries(DEFAULT_PROFILE, 7, 300);
    expect(q).toHaveLength(DEFAULT_PROFILE.searches.length * DEFAULT_PROFILE.locations.length);
    expect(q[0]).toEqual({ keywords: "Développeur Vue.js", department: "60", locationLabel: DEFAULT_PROFILE.locations[0]!.label, maxResults: 300, publishedSinceDays: 7 });
    expect(q[1]!.department).toBe("75");
  });
});
