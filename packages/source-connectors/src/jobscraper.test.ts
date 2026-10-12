import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JobScraperSource, classifyProbe, detailsFromPage, fetchJobScraperDetails, relativeAge, isJobScraperNoResultsOutput, jobScraperLocation, linkedinJobIsOpen, mapJobScraperOfferToRawJob } from "./jobscraper";
import { SourceUnavailableError } from "./types";

const offer = {
  id: "li-42", source: "linkedin", url: "https://example.test/jobs/42", title: "Développeur",
  company: "Acme", location: "Paris, France", posted_at: "2026-10-04T09:30:00+02:00",
  scraped_at: "2026-10-05T12:00:00", salary_min: null, salary_max: null,
};

describe("JobScraper adapter", () => {
  it("adapts JobOffer to RawJob without confusing posted_at with collection time", () => {
    const collectedAt = new Date("2026-10-05T12:00:00Z");
    const raw = mapJobScraperOfferToRawJob(offer, "linkedin", collectedAt);
    expect(raw).toMatchObject({ source: "jobscraper:linkedin", sourceJobId: "li-42", collectedAt });
    expect((raw?.data as typeof offer).posted_at).toBe(offer.posted_at);
  });

  it("leaves missing optional values unknown and rejects wrong or invalid sources", () => {
    expect(mapJobScraperOfferToRawJob({ ...offer, salary_min: undefined, salary_max: undefined }, "linkedin")?.data).toMatchObject({
      salary_min: undefined, salary_max: undefined,
    });
    expect(mapJobScraperOfferToRawJob(offer, "hellowork")).toBeNull();
    expect(mapJobScraperOfferToRawJob({ ...offer, url: "invalid" }, "linkedin")).toBeNull();
  });

  it("treats the upstream CLI's empty-result message as a successful empty search", () => {
    expect(isJobScraperNoResultsOutput("Aucune offre trouvée.")).toBe(true);
    expect(isJobScraperNoResultsOutput("Aucune offre trouvee.")).toBe(true);
    expect(isJobScraperNoResultsOutput("Erreur HTTP 500")).toBe(false);
  });
});

describe("détection de blocage d'IP", () => {
  it.each([
    ["page LinkedIn saine (contient « captcha » dans ses scripts)", "linkedin", 200, "https://www.linkedin.com/jobs/search", '<li class="base-search-card"></li><script>recaptcha</script>', "OK"],
    ["trop de requêtes", "linkedin", 429, "https://www.linkedin.com/jobs/search", "", "BLOCKED"],
    ["code 999 de LinkedIn", "linkedin", 999, "https://www.linkedin.com/jobs/search", "", "BLOCKED"],
    ["redirection vers le mur de connexion", "linkedin", 200, "https://www.linkedin.com/authwall?trk=x", "<html></html>", "BLOCKED"],
    ["page anti-robot Cloudflare", "hellowork", 200, "https://www.hellowork.com/x", "<title>Just a moment...</title>", "BLOCKED"],
    ["page sans offres ni blocage visible", "hellowork", 200, "https://www.hellowork.com/x", "<html>autre</html>", "UNREACHABLE"],
    ["résultats HelloWork", "hellowork", 200, "https://www.hellowork.com/x", '<a href="/fr-fr/emplois/83841806.html">', "OK"],
  ] as const)("%s → %s", (_name, provider, status, url, body, expected) => {
    expect(classifyProbe(provider, status, url, body).status).toBe(expected);
  });

  it("« Aucune offre » + IP bloquée : la source s'arrête avec un message clair au lieu de renvoyer 0 offre", async () => {
    // Fausse CLI : Node exécute ce « main.py » et répond comme JobScraper quand la page ne contient rien.
    const dir = await mkdtemp(path.join(os.tmpdir(), "fake-jobscraper-"));
    await writeFile(path.join(dir, "main.py"), 'console.log("Aucune offre trouvée.")');
    const make = (status: "OK" | "BLOCKED") =>
      new JobScraperSource({
        provider: "linkedin",
        enabled: true,
        path: dir,
        python: process.execPath,
        probe: async () => ({ status, detail: "LinkedIn limite tes requêtes (HTTP 429 : trop de requêtes)" }),
      });
    try {
      expect(await make("OK").search({ keywords: "dev" })).toEqual([]);
      await expect(make("BLOCKED").search({ keywords: "dev" })).rejects.toThrow(/IP bloquée — LinkedIn limite tes requêtes/);
      await expect(make("BLOCKED").search({ keywords: "dev" })).rejects.toBeInstanceOf(SourceUnavailableError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("offre LinkedIn close", () => {
  const page = (status: number, body = "") => (async () => new Response(body, { status })) as unknown as typeof fetch;
  it.each([
    ["bandeau « Les candidatures ne sont plus acceptées »", page(200, '<span class="closed-job__flavor--closed">Les candidatures ne sont plus acceptées</span>'), false],
    ["offre ouverte", page(200, '<div class="show-more-less-html__markup">Quel est le projet</div>'), true],
    ["offre supprimée", page(404), false],
    ["blocage (429) : on ne conclut rien", page(429), null],
  ] as const)("%s", async (_name, fetchImpl, expected) => {
    expect(await linkedinJobIsOpen("linkedin_4474244898", fetchImpl)).toBe(expected);
  });
});

describe("description lue sur la page publique", () => {
  it("HelloWork : données schema.org JobPosting (le « + » de ld+json est encodé dans la page)", () => {
    const page = `<script type="application/ld&#x2B;json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script>
      <script type="application/ld&#x2B;json">{"@context":"https://schema.org","@type":"JobPosting","title":"Dev","description":"<h2>Détail du poste</h2><p>Rejoins l'équipe</p>"}</script>`;
    expect(detailsFromPage(page).description).toBe("<h2>Détail du poste</h2><p>Rejoins l'équipe</p>");
  });

  it("LinkedIn : bloc de description de la page sans compte", () => {
    expect(detailsFromPage('<div class="show-more-less-html__markup relative">\n<strong>Quel est le projet</strong>\n</div>').description).toBe("<strong>Quel est le projet</strong>");
  });

  it("rien de reconnaissable → null", () => {
    expect(detailsFromPage("<html><body>Connexion requise</body></html>")).toEqual({ description: null, postedAt: null });
  });

  it("LinkedIn : interroge la page légère sans compte, par identifiant", async () => {
    let asked = "";
    const fetchImpl = (async (url: string) => {
      asked = url;
      return new Response('<div class="show-more-less-html__markup">Texte</div>', { status: 200 });
    }) as unknown as typeof fetch;
    const d = await fetchJobScraperDetails({ source: "jobscraper:linkedin", sourceJobId: "linkedin_4474244898", sourceUrl: "https://fr.linkedin.com/jobs/view/x-4474244898" }, fetchImpl);
    expect(asked).toBe("https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4474244898");
    expect(d?.description).toBe("Texte");
  });
});

describe("WTTJ : annonce entière via l'API publique du site (la page est derrière une vérification anti-robot)", () => {
  it("lit description + profil depuis l'organisation et le slug du lien", async () => {
    let asked = "";
    const fetchImpl = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ job: { description: "<p>Tech stack: Svelte</p>", profile: "<p>1-2 ans</p>", summary: "", published_at: "2026-09-28T09:00:00.000+02:00" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const d = await fetchJobScraperDetails(
      { source: "jobscraper:wttj", sourceJobId: "wttj_42", sourceUrl: "https://www.welcometothejungle.com/fr/companies/escape/jobs/junior-full-stack-engineer-ai-security_paris?q=x" },
      fetchImpl,
    );
    expect(asked).toBe("https://api.welcometothejungle.com/api/v1/organizations/escape/jobs/junior-full-stack-engineer-ai-security_paris");
    expect(d).toEqual({ description: "<p>Tech stack: Svelte</p>\n<p>1-2 ans</p>", postedAt: new Date("2026-09-28T07:00:00Z") });
  });
});

describe("date de publication lue sur la page (JobScraper n'en donne pas : l'offre passait pour publiée à la collecte)", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  it.each([
    ["il y a 41 minutes", "2026-10-06T11:19:00Z"],
    ["il y a 3 heures", "2026-10-06T09:00:00Z"],
    ["il y a 2 jours", "2026-10-04T12:00:00Z"],
    ["il y a 1 semaine", "2026-09-29T12:00:00Z"],
    ["2 weeks ago", "2026-09-22T12:00:00Z"],
  ] as const)("LinkedIn « %s »", (text, expected) => {
    expect(relativeAge(text, now)?.toISOString()).toBe(new Date(expected).toISOString());
  });

  it("LinkedIn : date relative de la page sans compte", () => {
    const page = '<span class="posted-time-ago__text topcard__flavor--metadata">\n il y a 1 semaine\n</span><div class="show-more-less-html__markup">Texte</div>';
    expect(detailsFromPage(page, now)).toEqual({ description: "Texte", postedAt: new Date("2026-09-29T12:00:00Z") });
  });

  it("HelloWork : datePosted des données schema.org (exacte)", () => {
    const page = '<script type="application/ld&#x2B;json">{"@type":"JobPosting","datePosted":"2026-09-28T11:57:31Z","description":"<p>Poste</p>"}</script>';
    expect(detailsFromPage(page, now).postedAt?.toISOString()).toBe("2026-09-28T11:57:31.000Z");
  });

  it("les « il y a N jours » des offres similaires d'une page HelloWork ne sont pas pris pour la date", () => {
    expect(detailsFromPage('<div class="typo-s text-grey-500">il y a 2 jours</div>', now).postedAt).toBeNull();
  });
});

describe("jobScraperLocation", () => {
  it("Indeed : « Nom (département) », sinon le libellé tel quel", () => {
    expect(jobScraperLocation("indeed", { keywords: "dev", locationLabel: "Oise", department: "60" })).toBe("Oise (60)");
    expect(jobScraperLocation("indeed", { keywords: "dev", locationLabel: "Oise (60)", department: "60" })).toBe("Oise (60)");
    expect(jobScraperLocation("linkedin", { keywords: "dev", locationLabel: "Oise", department: "60" })).toBe("Oise");
    expect(jobScraperLocation("indeed", { keywords: "dev" })).toBe("France");
  });
});
