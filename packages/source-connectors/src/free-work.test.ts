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
});
