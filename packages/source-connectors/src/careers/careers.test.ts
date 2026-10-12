import { describe, expect, it } from "vitest";
import { AdzunaSource } from "../adzuna/source";
import { SourceUnavailableError } from "../types";
import { type CompanyTarget, parseCareersInput } from "./ats";
import { CompanyCareersSource, isTechTitle } from "./source";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noWait = { now: () => 0, sleep: async () => {} };

describe("parseCareersInput", () => {
  it.each([
    ["https://boards.greenhouse.io/doctolib", { ats: "greenhouse", boardKey: "doctolib" }],
    ["https://job-boards.eu.greenhouse.io/acme/jobs/123", { ats: "greenhouse", boardKey: "acme" }],
    ["https://jobs.lever.co/qonto/abc-123", { ats: "lever", boardKey: "qonto" }],
    ["https://jobs.eu.lever.co/mirakl", { ats: "lever", boardKey: "mirakl" }],
    ["https://jobs.ashbyhq.com/alan", { ats: "ashby", boardKey: "alan" }],
    ["https://lucca.recruitee.com/o/dev-front", { ats: "recruitee", boardKey: "lucca" }],
    ["https://www.welcometothejungle.com/fr/companies/x", null],
    ["pas une url", null],
  ] as const)("%s", (input, expected) => {
    expect(parseCareersInput(input)).toEqual(expected);
  });
});

describe("isTechTitle", () => {
  it("garde les postes tech, écarte les autres", () => {
    expect(isTechTitle("Développeur Front-end Vue.js")).toBe(true);
    expect(isTechTitle("Senior Software Engineer")).toBe(true);
    expect(isTechTitle("Account Executive")).toBe(false);
    expect(isTechTitle("Chargé de recrutement")).toBe(false);
  });
});

describe("CompanyCareersSource", () => {
  const companies: CompanyTarget[] = [
    { id: "1", name: "Acme", ats: "greenhouse", boardKey: "acme", enabled: true },
    { id: "2", name: "Mirakl", ats: "lever", boardKey: "mirakl", enabled: true },
    { id: "3", name: "Alan", ats: "ashby", boardKey: "alan", enabled: true },
    { id: "4", name: "Lucca", ats: "recruitee", boardKey: "lucca", enabled: true },
    { id: "5", name: "Cassée", ats: "greenhouse", boardKey: "cassee", enabled: true },
    { id: "6", name: "Désactivée", ats: "greenhouse", boardKey: "off", enabled: false },
  ];
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    if (url.includes("boards/acme"))
      return json({ jobs: [
        { id: 1, title: "Développeur Vue.js", content: "&lt;p&gt;Vue 3&lt;/p&gt;", location: { name: "Paris" }, absolute_url: "https://acme/1" },
        { id: 2, title: "Office Manager", content: "", location: { name: "Paris" }, absolute_url: "https://acme/2" },
      ] });
    if (url.startsWith("https://api.lever.co")) return json({ ok: false }, 404);
    if (url.startsWith("https://api.eu.lever.co"))
      return json([{ id: "l1", text: "Software Engineer", descriptionPlain: "Java", categories: { location: "Paris", commitment: "CDI" }, hostedUrl: "https://lever/l1", createdAt: 1790000000000 }]);
    if (url.includes("ashbyhq"))
      return json({ jobs: [{ id: "a1", title: "Backend Engineer", descriptionPlain: "Node.js", location: "Paris", isListed: true, jobUrl: "https://ashby/a1", employmentType: "FullTime",
        compensation: { summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "EUR", minValue: 45000, maxValue: 55000 }] } }] });
    if (url.includes("lucca.recruitee.com"))
      return json({ offers: [{ id: 9, title: "Développeur .NET", description: "<p>C#</p>", city: "Paris", country_code: "FR", careers_url: "https://lucca/9", remote: false }] });
    return json({}, 500);
  };

  it("récupère chaque entreprise, filtre les postes non tech, isole les erreurs", async () => {
    const src = new CompanyCareersSource({ companies: async () => companies, fetch, ...noWait });
    const { jobs, errors } = await src.fetchAll();
    expect(jobs.map((j) => j.sourceJobId)).toEqual([
      "greenhouse:acme:1",
      "lever:mirakl:l1",
      "ashby:alan:a1",
      "recruitee:lucca:9",
    ]);
    expect(errors).toEqual(["Cassée (greenhouse) : HTTP 500"]);
    expect(calls.some((u) => u.includes("/off/"))).toBe(false);
  });

  it("aucune entreprise → source non configurée", async () => {
    const src = new CompanyCareersSource({ companies: async () => [], fetch, ...noWait });
    expect((await src.healthCheck()).status).toBe("SOURCE_UNAVAILABLE");
  });
});

describe("AdzunaSource", () => {
  it("SOURCE_UNAVAILABLE sans clé", async () => {
    const src = new AdzunaSource({ appId: "", appKey: undefined, ...noWait });
    await expect(src.search({ keywords: "vue" })).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("recherche France, 1 page, département en toutes lettres, sans afficher la clé en cas d'erreur", async () => {
    const urls: string[] = [];
    const src = new AdzunaSource({
      appId: "id",
      appKey: "cle-secrete",
      ...noWait,
      fetch: async (url) => {
        urls.push(url);
        return url.includes("Java") ? json({}, 401) : json({ results: [{ id: 42, title: "Dev", redirect_url: "https://adzuna/42" }] });
      },
    });
    const res = await src.search({ keywords: "Développeur Vue.js", department: "60", publishedSinceDays: 7 });
    expect(res.map((r) => r.sourceJobId)).toEqual(["42"]);
    const u = new URL(urls[0]!);
    expect(u.pathname).toBe("/v1/api/jobs/fr/search/1");
    expect(u.searchParams.get("where")).toBe("Oise");
    expect(u.searchParams.get("max_days_old")).toBe("7");
    expect(u.searchParams.get("results_per_page")).toBe("50");
    const err = await src.search({ keywords: "Java" }).catch((e) => e);
    expect(err.message).toBe("Recherche Adzuna en erreur (HTTP 401)");
    expect(err.message).not.toContain("cle-secrete");
  });
});
