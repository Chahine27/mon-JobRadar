import { describe, expect, it } from "vitest";
import { JOOBLE_DEFAULTS, JoobleSource, joobleJobId, memoryJoobleQuota } from "./jooble";
import { SourceUnavailableError } from "./types";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const job = (i: number) => ({
  id: 1000 + i,
  title: `Développeur Vue.js ${i}`,
  location: "Creil",
  snippet: "Nous cherchons un <b>développeur</b> Vue.js",
  salary: "35 000 € - 42 000 €",
  source: "hellowork.com",
  type: "CDI",
  link: `https://fr.jooble.org/desc/-73946204185372930${i}?ckey=x`,
  company: "ACME",
  updated: "2026-09-28T10:00:00.0000000",
});

function source(fetch: (url: string, init?: RequestInit) => Promise<Response>, quota = memoryJoobleQuota(), now = () => Date.parse("2026-09-29T10:00:00Z")) {
  return { quota, jooble: new JoobleSource({ apiKey: "abcd-1234-efgh", quota, fetch, now, sleep: async () => {} }) };
}

describe("Jooble", () => {
  it("non configurée sans clé, sans aucun appel", async () => {
    let calls = 0;
    const j = new JoobleSource({ apiKey: "", quota: memoryJoobleQuota(), fetch: async () => (calls++, json({})) });
    await expect(j.searchAll([{ keywords: "dev", department: "60" }])).rejects.toBeInstanceOf(SourceUnavailableError);
    expect((await j.healthCheck()).status).toBe("SOURCE_UNAVAILABLE");
    expect(calls).toBe(0);
  });

  it("identifiant lu dans le lien (les grands nombres perdent des chiffres en JavaScript)", () => {
    expect(joobleJobId({ id: 7394620418537293000, link: "https://fr.jooble.org/desc/-7394620418537293123?x=1" })).toBe("-7394620418537293123");
    expect(joobleJobId({ id: 42 })).toBe("42");
    expect(joobleJobId({ link: "https://fr.jooble.org/away/8123456789012?p=1" })).toBe("8123456789012");
    expect(joobleJobId({ link: "https://fr.jooble.org/offre/abc" })).toBe("url:/offre/abc");
    expect(joobleJobId({ id: 2 ** 60 })).toBe(String(2 ** 60));
    expect(joobleJobId({})).toBeNull();
  });

  it("une seule requête par zone, mots-clés regroupés, clé dans l'adresse, appels comptés", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const { jooble, quota } = source(async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return json({ totalCount: 2, jobs: [job(1), job(2)] });
    });
    const r = await jooble.searchAll([
      { keywords: "Développeur Vue.js", department: "60" },
      { keywords: "Développeur frontend", department: "60" },
      { keywords: "Développeur Vue.js", department: "75" },
      { keywords: "Développeur frontend", department: "75" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://fr.jooble.org/api/abcd-1234-efgh");
    expect(calls[0]!.body).toMatchObject({ keywords: "Développeur Vue.js, Développeur frontend", location: "Oise" });
    expect(calls[1]!.body.location).toBe("Paris");
    expect(r.jobs).toHaveLength(4);
    expect(r.jobs[0]).toMatchObject({ source: "jooble", sourceJobId: "-739462041853729301" });
    expect((r.jobs[0]!.data as any)._searchDepartment).toBe("60");
    expect(quota.used).toBe(2);
  });

  it("au plus une collecte toutes les 20 h (même avec le bouton Actualiser)", async () => {
    let t = Date.parse("2026-09-29T10:00:00Z");
    let calls = 0;
    const { jooble } = source(async () => (calls++, json({ jobs: [job(1)] })), memoryJoobleQuota(), () => t);
    await jooble.searchAll([{ keywords: "dev", department: "60" }]);
    t += 5 * 3_600_000;
    const second = await jooble.searchAll([{ keywords: "dev", department: "60" }]);
    expect(second.skipped).toMatch(/20 h/);
    t += 16 * 3_600_000;
    await jooble.searchAll([{ keywords: "dev", department: "60" }]);
    expect(calls).toBe(2);
  });

  it("s'arrête avant d'épuiser la clé", async () => {
    let calls = 0;
    const { jooble } = source(async () => (calls++, json({ jobs: [] })), memoryJoobleQuota(JOOBLE_DEFAULTS.stopAt - 1));
    await expect(
      jooble.searchAll([
        { keywords: "dev", department: "60" },
        { keywords: "dev", department: "75" },
      ]),
    ).rejects.toThrow(/Quota Jooble épuisé/);
    expect(calls).toBe(0);
  });

  it("clé refusée (403) → source non configurée ; appel compté quand même", async () => {
    const { jooble, quota } = source(async () => json({}, 403));
    await expect(jooble.searchAll([{ keywords: "dev", department: "60" }])).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(quota.used).toBe(1);
  });

  it("le test de clé compte l'appel sans retarder la prochaine collecte", async () => {
    let calls = 0;
    const { jooble, quota } = source(async () => (calls++, json({ jobs: [job(1)] })));
    const r = await jooble.testCall("Développeur", "60");
    expect(r.count).toBe(1);
    expect(quota.used).toBe(1);
    const run = await jooble.searchAll([{ keywords: "dev", department: "60" }]);
    expect(run.skipped).toBeUndefined();
    expect(calls).toBe(2);
  });
});
