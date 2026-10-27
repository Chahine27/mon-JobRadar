import { describe, expect, it } from "vitest";
import { adzunaDescription, adzunaJobIsOpen, fetchAdzunaAd } from "./source";

describe("annonce entière lue sur la page Adzuna", () => {
  // Forme réelle de la page (27/10/2026) : objet JSON az_details dans un <script>.
  const html = `<main>…</main><script type="text/javascript">window["az_details"] = { "ga4_tracking" : { "event_name" : "x" }, "description" : "\\u003cp\\u003eWink recrute un Développeur Full-Stack\\u003c/p\\u003e", "id" : "5943690457" };</script>`;
  it("description HTML de az_details", () => {
    expect(adzunaDescription(html)).toBe("<p>Wink recrute un Développeur Full-Stack</p>");
    expect(adzunaDescription("<html>rien</html>")).toBeNull();
    expect(adzunaDescription(`<script>window["az_details"] = { cassé };</script>`)).toBeNull();
  });

  it("410 = retirée (pas de texte), 429 = refusée (null)", async () => {
    const page = (status: number, body = "") => (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await fetchAdzunaAd("5943690457", page(200, html))).toEqual({ description: "<p>Wink recrute un Développeur Full-Stack</p>" });
    expect(await fetchAdzunaAd("5943690457", page(410))).toEqual({ description: null });
    expect(await fetchAdzunaAd("5943690457", page(429))).toBeNull();
  });
});

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
