import { describe, expect, it } from "vitest";
import { SourceHttpError, SourceUnavailableError } from "../types";
import { FT_SAMPLE_OFFER } from "./sample";
import { FranceTravailSource } from "./source";

type Call = { url: string; init?: RequestInit | undefined };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Faux serveur France Travail : répond selon l'URL, enregistre les appels. */
function fakeFetch(handler: (url: URL, call: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  let n = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(new URL(url), n++);
  };
  return { fetch, calls };
}

const offers = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({ ...FT_SAMPLE_OFFER, id: `id-${from + i}` }));

function makeSource(fetch: ReturnType<typeof fakeFetch>["fetch"], extra = {}) {
  let t = 1_000_000;
  return new FranceTravailSource({
    clientId: "PAR_test",
    clientSecret: "secret-de-test",
    fetch,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    ...extra,
  });
}

const tokenOk = () => json({ access_token: "tok-1", expires_in: 1499, token_type: "Bearer" });

describe("FranceTravailSource", () => {
  it("SOURCE_UNAVAILABLE sans identifiants, sans appel réseau", async () => {
    const { fetch, calls } = fakeFetch(() => tokenOk());
    const src = new FranceTravailSource({ clientId: "", clientSecret: undefined, fetch });
    await expect(src.search({ keywords: "vue" })).rejects.toBeInstanceOf(SourceUnavailableError);
    expect((await src.healthCheck()).status).toBe("SOURCE_UNAVAILABLE");
    expect(calls).toHaveLength(0);
  });

  it("demande un jeton puis cherche avec les bons paramètres", async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.hostname.startsWith("entreprise") ? tokenOk() : json({ resultats: offers(2) }, 206, { "content-range": "offres 0-1/2" }),
    );
    const res = await makeSource(fetch).search({ keywords: "Développeur Vue.js", department: "60", publishedSinceDays: 7 });
    expect(res.map((r) => r.sourceJobId)).toEqual(["id-0", "id-1"]);
    expect(res[0]!.source).toBe("france-travail");

    const tokenBody = new URLSearchParams(String(calls[0]!.init!.body));
    expect(tokenBody.get("grant_type")).toBe("client_credentials");
    expect(tokenBody.get("scope")).toBe("api_offresdemploiv2 o2dsoffre");

    const search = new URL(calls[1]!.url);
    expect(search.searchParams.get("motsCles")).toBe("Développeur Vue.js");
    expect(search.searchParams.get("departement")).toBe("60");
    expect(search.searchParams.get("publieeDepuis")).toBe("7");
    expect(search.searchParams.get("range")).toBe("0-149");
    expect((calls[1]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("réutilise le jeton entre deux recherches", async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.hostname.startsWith("entreprise") ? tokenOk() : json({ resultats: offers(1) }),
    );
    const src = makeSource(fetch);
    await src.search({ keywords: "a" });
    await src.search({ keywords: "b" });
    expect(calls.filter((c) => c.url.includes("access_token"))).toHaveLength(1);
  });

  it("pagine grâce à Content-Range et respecte maxResults", async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.hostname.startsWith("entreprise")) return tokenOk();
      const [a, b] = url.searchParams.get("range")!.split("-").map(Number) as [number, number];
      const last = Math.min(b, 199);
      return json({ resultats: offers(last - a + 1, a) }, 206, { "content-range": `offres ${a}-${last}/200` });
    });
    const res = await makeSource(fetch).search({ keywords: "dev", maxResults: 500 });
    expect(res).toHaveLength(200);
    expect(calls.filter((c) => c.url.includes("/search")).map((c) => new URL(c.url).searchParams.get("range"))).toEqual([
      "0-149",
      "150-299",
    ]);

    const limited = await makeSource(fakeFetch((url) => {
      if (url.hostname.startsWith("entreprise")) return tokenOk();
      const [a, b] = url.searchParams.get("range")!.split("-").map(Number) as [number, number];
      return json({ resultats: offers(b - a + 1, a) }, 206, { "content-range": `offres ${a}-${b}/5000` });
    }).fetch).search({ keywords: "dev", maxResults: 160 });
    expect(limited).toHaveLength(160);
  });

  it("204 = aucun résultat, pas une erreur", async () => {
    const { fetch } = fakeFetch((url) => (url.hostname.startsWith("entreprise") ? tokenOk() : new Response(null, { status: 204 })));
    expect(await makeSource(fetch).search({ keywords: "cobol" })).toEqual([]);
  });

  it("réessaie après un 429 puis réussit", async () => {
    let searchCalls = 0;
    const { fetch } = fakeFetch((url) => {
      if (url.hostname.startsWith("entreprise")) return tokenOk();
      searchCalls++;
      return searchCalls === 1 ? new Response(null, { status: 429, headers: { "retry-after": "2" } }) : json({ resultats: offers(1) });
    });
    expect(await makeSource(fetch).search({ keywords: "vue" })).toHaveLength(1);
    expect(searchCalls).toBe(2);
  });

  it("redemande un jeton si le serveur répond 401", async () => {
    let tokens = 0;
    let searches = 0;
    const { fetch } = fakeFetch((url) => {
      if (url.hostname.startsWith("entreprise")) return json({ access_token: `tok-${++tokens}`, expires_in: 1499 });
      return ++searches === 1 ? new Response(null, { status: 401 }) : json({ resultats: offers(1) });
    });
    expect(await makeSource(fetch).search({ keywords: "vue" })).toHaveLength(1);
    expect(tokens).toBe(2);
  });

  it("erreur d'authentification claire, sans jamais afficher le secret", async () => {
    const { fetch } = fakeFetch(() => json({ error: "invalid_client" }, 401));
    const err = await makeSource(fetch).search({ keywords: "vue" }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceHttpError);
    expect(err.message).toContain("HTTP 401");
    expect(err.message).not.toContain("secret-de-test");
    expect((await makeSource(fetch).healthCheck()).status).toBe("ERROR");
  });

  it("ignore une offre illisible sans bloquer les autres", async () => {
    const { fetch } = fakeFetch((url) =>
      url.hostname.startsWith("entreprise") ? tokenOk() : json({ resultats: [{ pasDId: true }, FT_SAMPLE_OFFER] }),
    );
    const res = await makeSource(fetch).search({ keywords: "vue" });
    expect(res.map((r) => r.sourceJobId)).toEqual(["199XYZT"]);
  });

  it("espace les appels (limite de débit)", async () => {
    const times: number[] = [];
    let t = 0;
    const src = new FranceTravailSource({
      clientId: "a",
      clientSecret: "b",
      minDelayMs: 250,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      fetch: async (url) => {
        times.push(t);
        return url.includes("access_token") ? tokenOk() : json({ resultats: offers(1) });
      },
    });
    await src.search({ keywords: "a" });
    await src.search({ keywords: "b" });
    expect(times).toEqual([0, 250, 500]);
  });

  it("vérifie si une offre est toujours en ligne", async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.hostname.startsWith("entreprise")) return tokenOk();
      if (url.pathname.endsWith("/EN-LIGNE")) return json({ id: "EN-LIGNE" });
      if (url.pathname.endsWith("/RETIREE")) return new Response(null, { status: 204 });
      if (url.pathname.endsWith("/INCONNUE")) return json({}, 404);
      return json({}, 500);
    });
    const src = makeSource(fetch);
    expect(await src.isStillOnline("EN-LIGNE")).toBe(true);
    expect(await src.isStillOnline("RETIREE")).toBe(false);
    expect(await src.isStillOnline("INCONNUE")).toBe(false);
    expect(await src.isStillOnline("PANNE")).toBeNull();
    expect(new URL(calls.find((c) => c.url.includes("EN-LIGNE"))!.url).pathname).toBe("/partenaire/offresdemploi/v2/offres/EN-LIGNE");
  });
});
