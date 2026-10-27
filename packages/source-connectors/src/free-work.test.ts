import { describe, expect, it } from "vitest";
import { fetchFreeWorkAd, freeWorkAdLinks, searchFreeWork } from "./free-work";

const link = "/fr/tech-it/job-mission/developpeur-java-kotlin-groovy-scala/developpeur-java-backend-spring-batch-tdd-29";

describe("Free-Work", () => {
  it("liens des annonces d'une page de résultats, sans doublon (chaque carte répète son lien)", () => {
    const html = `<a href="${link}">Dev</a><a href="${link}">Voir cette offre</a><a href="/fr/tech-it/forum/t/x">Forum</a><a href="/fr/tech-it/job-mission/a/b-2?x=1">B</a>`;
    expect(freeWorkAdLinks(html)).toEqual([link, "/fr/tech-it/job-mission/a/b-2"]);
  });

  it("recherche refusée (403) → null ; annonce lue depuis son bloc JobPosting", async () => {
    const refused = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    expect(await searchFreeWork("dev", refused)).toBeNull();
    const page = (async () =>
      new Response(`<script type="application/ld+json">{"@type":"JobPosting","description":"<p>Mission</p>","hiringOrganization":{"name":"CELAD"}}</script>`)) as unknown as typeof fetch;
    expect(await fetchFreeWorkAd(link, page)).toMatchObject({ description: "<p>Mission</p>", company: "CELAD", url: `https://www.free-work.com${link}` });
  });

  it("bloc « Profil recherché » (hors du JobPosting) ajouté au texte : il porte l'expérience attendue", async () => {
    // Forme réelle de la page (27/10/2026, annonce OCTOGONE).
    const html = `<script type="application/ld+json">{"@type":"JobPosting","description":"<p>Mission</p>"}</script>
      <div class="p-4"><h2 class="font-semibold text-xl mb-4"><!--[-->Profil recherché<!--]--></h2><div class="html-renderer prose-content"><p>Expérience attendue : 2 à 7 ans</p></div></div>`;
    const page = (async () => new Response(html)) as unknown as typeof fetch;
    expect((await fetchFreeWorkAd(link, page))?.description).toBe("<p>Mission</p><h2>Profil recherché</h2><p>Expérience attendue : 2 à 7 ans</p>");
  });
});
