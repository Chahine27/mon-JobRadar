import { describe, expect, it } from "vitest";
import { readApplicationMailWithAi } from "./mail-reading";

const reply = (r: object) => ({ chatJson: async () => ({ candidature: 1, resume: "Candidature reçue.", certain: true, ...r }) });
const mail = { subject: "Votre candidature", from: "rh@escape.fr", text: "…" };
const candidates = [
  { company: "Escape", title: "Développeur Vue.js", since: new Date("2026-10-01") },
  { company: "Escape", title: null, since: new Date("2026-09-01") },
];

describe("readApplicationMailWithAi", () => {
  it.each([
    ["accuse_reception", { kind: "ACK", detail: null }],
    ["test_technique", { kind: "INTERVIEW", detail: "Test technique" }],
    ["refus", { kind: "REJECTION", detail: null }],
  ] as const)("%s", async (type, verdict) => {
    expect(await readApplicationMailWithAi(reply({ type }), mail, candidates)).toEqual({ index: 0, verdict, summary: "Candidature reçue.", certain: true });
  });

  it("aucune candidature (0), numéro inconnu ou mail sans rapport → pas rattaché", async () => {
    expect((await readApplicationMailWithAi(reply({ type: "refus", candidature: 0 }), mail, candidates)).index).toBeNull();
    expect((await readApplicationMailWithAi(reply({ type: "refus", candidature: 7 }), mail, candidates)).index).toBeNull();
    expect((await readApplicationMailWithAi(reply({ type: "autre" }), mail, candidates)).index).toBeNull();
  });

  it("donne la deuxième candidature, et dit quand elle hésite", async () => {
    expect(await readApplicationMailWithAi(reply({ type: "entretien", candidature: 2, certain: false }), mail, candidates)).toMatchObject({ index: 1, certain: false });
  });

  it("réponse hors format → erreur (le mail sera traité par les règles)", async () => {
    await expect(readApplicationMailWithAi({ chatJson: async () => ({ type: "peut-être" }) }, mail, candidates)).rejects.toThrow();
  });
});
