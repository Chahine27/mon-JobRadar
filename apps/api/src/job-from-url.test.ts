import { describe, expect, it, vi } from "vitest";
import { isPrivateAddress, readJobFromUrl } from "./job-from-url";

const html = (body: string, status = 200, headers: Record<string, string> = { "content-type": "text/html" }) =>
  new Response(body, { status, headers });

const LONG = "Vous développerez des applications Vue.js et Spring Boot au sein d'une équipe produit. ".repeat(4);

describe("offre lue depuis un lien", () => {
  it("refuse les adresses internes (serveur, réseau privé, Tailscale)", async () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.20.1.1", "192.168.1.10", "169.254.169.254", "100.100.1.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    await expect(readJobFromUrl("http://127.0.0.1:3000/api/health")).rejects.toThrow(/adresse interne/);
    await expect(readJobFromUrl("file:///etc/passwd")).rejects.toThrow(/http/);
  });

  it("ne suit pas une redirection vers une adresse interne", async () => {
    const fetchMock = vi.fn(async () => html("", 302, { location: "http://169.254.169.254/latest/meta-data" }));
    await expect(readJobFromUrl("https://93.184.216.34/offre", fetchMock as unknown as typeof fetch)).rejects.toThrow(/adresse interne/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lit la fiche JobPosting d'une page carrières", async () => {
    const jsonLd = JSON.stringify({
      "@type": "JobPosting",
      title: "Développeur Full Stack",
      hiringOrganization: { name: "Acme" },
      employmentType: "CDI",
      jobLocation: { address: { addressLocality: "Creil", postalCode: "60100" } },
      description: `<p>${LONG}</p>`,
    });
    const page = `<html><head><title>Offre</title><script type="application/ld+json">${jsonLd}</script></head><body><h1>Développeur Full Stack</h1><p>${LONG}</p></body></html>`;
    const p = await readJobFromUrl("https://93.184.216.34/jobs/42", (async () => html(page)) as unknown as typeof fetch);
    expect(p.hints).toMatchObject({ title: "Développeur Full Stack", company: "Acme", location: "Creil (60)", contractType: "CDI" });
    expect(p.text).toContain("Spring Boot");
  });

  it("LinkedIn : lien de recherche → page publique de l'offre", async () => {
    const fragment = `<h2 class="top-card-layout__title topcard__title">Front-end Engineer</h2>
      <a class="topcard__org-name-link topcard__flavor--black-link" href="#">Modjo</a>
      <span class="topcard__flavor topcard__flavor--bullet">Paris, Île-de-France, France</span>
      <div class="show-more-less-html__markup relative">${LONG}</div>
      <h3 class="description__job-criteria-subheader">Employment type</h3><span class="description__job-criteria-text">Full-time</span>`;
    const fetchMock = vi.fn(async () => html(fragment));
    const p = await readJobFromUrl("https://www.linkedin.com/jobs/search-results/?currentJobId=4479660434&keywords=dev", fetchMock as unknown as typeof fetch);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4479660434");
    expect(p.url).toBe("https://www.linkedin.com/jobs/view/4479660434/");
    expect(p.hints).toMatchObject({ title: "Front-end Engineer", company: "Modjo" });
    expect(p.text).toContain("Paris, Île-de-France");
    expect(p.text).toContain("Employment type : Full-time");
  });

  it("refus passager (429) : nouvel essai", async () => {
    const page = `<html><body><h1>Développeur</h1><p>${LONG}</p></body></html>`;
    const fetchMock = vi.fn().mockResolvedValueOnce(html("", 429)).mockResolvedValueOnce(html(page));
    const p = await readJobFromUrl("https://93.184.216.34/offre", fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(p.text).toContain("Spring Boot");
  });

  it("site qui bloque les robots : message clair", async () => {
    await expect(readJobFromUrl("https://93.184.216.34/viewjob", (async () => html("", 403)) as unknown as typeof fetch)).rejects.toThrow(/bloque/);
  });
});
