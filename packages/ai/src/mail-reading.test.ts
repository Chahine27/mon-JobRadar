import { describe, expect, it } from "vitest";
import { readApplicationMailWithAi } from "./mail-reading";

const client = (type: string) => ({ chatJson: async () => ({ type }) });
const mail = { subject: "Votre candidature", text: "…", company: "Escape", title: "Développeur Vue.js" };

describe("readApplicationMailWithAi", () => {
  it.each([
    ["accuse_reception", { kind: "ACK", detail: null }],
    ["test_technique", { kind: "INTERVIEW", detail: "Test technique" }],
    ["refus", { kind: "REJECTION", detail: null }],
    ["autre", null],
  ] as const)("%s", async (type, expected) => {
    expect(await readApplicationMailWithAi(client(type), mail)).toEqual(expected);
  });

  it("réponse hors format → erreur (le mail sera traité par les règles)", async () => {
    await expect(readApplicationMailWithAi({ chatJson: async () => ({ type: "peut-être" }) }, mail)).rejects.toThrow();
  });
});
