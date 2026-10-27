import { describe, expect, it } from "vitest";
import { adzunaJobIsOpen } from "./source";

describe("offre Adzuna encore en ligne", () => {
  const page = (status: number) => (async () => new Response("<html></html>", { status })) as unknown as typeof fetch;
  it.each([
    ["page affichée", page(200), true],
    ["offre supprimée (410)", page(410), false],
    ["page introuvable (404)", page(404), false],
    ["blocage CloudFront (403) : on ne conclut rien", page(403), null],
  ] as const)("%s", async (_name, fetchImpl, expected) => {
    expect(await adzunaJobIsOpen("5922296683", fetchImpl)).toBe(expected);
  });

  it("réseau en panne ou id illisible : null", async () => {
    expect(await adzunaJobIsOpen("5922296683", (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch)).toBeNull();
    expect(await adzunaJobIsOpen("../x", page(200))).toBeNull();
  });
});
