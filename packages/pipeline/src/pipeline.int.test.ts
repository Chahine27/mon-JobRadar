import { normalize } from "@job-radar/job-normalizer";
import { DEFAULT_PROFILE } from "@job-radar/shared";
import { FT_SAMPLE_OFFER, type JobSource, JoobleSource, mapJobScraperOfferToRawJob, type RawJob } from "@job-radar/source-connectors";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../../db/test/helpers";
import { prismaJoobleQuota } from "./api-quota";
import { buildManualJob, removeManualJob, saveManualJob } from "./manual";
import { collectOnce } from "./collect";
import { completeJobScraperDescriptions } from "./complete";
import { expireJobs } from "./expire";
import { ingestJob } from "./ingest";

const prisma = testPrisma();
beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

// Comme en vrai, chaque offre France Travail a sa propre page (les variantes copient l'exemple, donc son lien).
const withOwnUrl = (data: object) => {
  const o = data as { id: string; origineOffre?: { urlOrigine?: string } };
  return o.origineOffre?.urlOrigine
    ? { ...o, origineOffre: { ...o.origineOffre, urlOrigine: `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}` } }
    : data;
};

const raw = (data: object, source = "france-travail"): RawJob => ({
  source,
  sourceJobId: (data as { id: string }).id,
  data: source === "france-travail" ? withOwnUrl(data) : data,
  collectedAt: new Date(),
});

describe("source → normalisation → base (README §32)", () => {
  it("JobScraper → RawJob → normalisation → ingest fusionne les offres inter-sources", async () => {
    const linkedin = mapJobScraperOfferToRawJob({
      id: "li-42", source: "linkedin", url: "https://example.test/jobs/42", title: "Développeur Vue.js",
      company: "Acme JobScraper", location: "Paris, France", description: "Vue.js et TypeScript", posted_at: "2026-10-04T09:30:00+02:00",
      salary_min: null, salary_max: null,
    }, "linkedin")!;
    const hellowork = mapJobScraperOfferToRawJob({
      ...(linkedin.data as object), id: "hw-42", source: "hellowork", url: "https://example.test/jobs/hw-42",
    }, "hellowork")!;
    const first = normalize(linkedin)!;
    const second = normalize(hellowork)!;
    expect(await ingestJob(prisma, first)).toBe("created");
    expect(await ingestJob(prisma, second)).toBe("duplicate");
    expect(await prisma.job.count()).toBe(1);
    expect((await prisma.jobSourceLink.findMany()).map((link) => link.source).sort()).toEqual([
      "jobscraper:hellowork", "jobscraper:linkedin",
    ]);
  });

  it("crée, reconnaît, met à jour et fusionne les doublons", async () => {
    const first = normalize(raw(FT_SAMPLE_OFFER))!;
    expect(await ingestJob(prisma, first)).toBe("created");
    expect(await ingestJob(prisma, first)).toBe("unchanged");

    const changed = normalize(raw({ ...FT_SAMPLE_OFFER, salaire: { libelle: "Annuel de 45000 Euros" } }))!;
    expect(await ingestJob(prisma, changed)).toBe("updated");
    expect((await prisma.job.findFirstOrThrow()).salaryMin).toBe(45000);

    // Même offre (entreprise + titre + ville) venue d'une autre source → rattachée, pas dupliquée.
    const other = { ...changed, source: "adzuna", sourceJobId: "az-1", sourceUrl: "https://adzuna/1" };
    expect(await ingestJob(prisma, other)).toBe("duplicate");
    expect(await prisma.job.count()).toBe(1);
    expect(await prisma.jobSourceLink.count()).toBe(2);
    const events = (await prisma.jobEvent.findMany()).map((e) => e.type).sort();
    expect(events).toEqual(["CREATED", "SOURCE_ADDED", "UPDATED"]);
  });

  it("collecte complète : une source en erreur n'arrête pas les autres, tout est tracé", async () => {
    const ok: JobSource = {
      name: "france-travail",
      search: async (q) => (q.department === "60" ? [raw(FT_SAMPLE_OFFER), raw({ ...FT_SAMPLE_OFFER, id: "2", intitule: "Développeur Java" })] : []),
      healthCheck: async () => ({ status: "OK" }),
    };
    const broken: JobSource = {
      name: "adzuna",
      search: async () => {
        throw new Error("HTTP 500");
      },
      healthCheck: async () => ({ status: "ERROR", message: "x" }),
    };
    const r = await collectOnce({ prisma, sources: [ok, broken], profile: DEFAULT_PROFILE, trigger: "cli", publishedSinceDays: 7 });
    expect(r).toMatchObject({ status: "partial", fetched: 2, created: 2 });
    expect(r.sources.map((s) => s.status)).toEqual(["OK", "ERROR"]);

    const runs = await prisma.sourceRun.findMany({ orderBy: { source: "asc" } });
    expect(runs.map((x) => [x.source, x.status])).toEqual([
      ["adzuna", "ERROR"],
      ["france-travail", "OK"],
    ]);
    const states = await prisma.sourceState.findMany({ orderBy: { source: "asc" } });
    expect(states.find((s) => s.source === "adzuna")!.failures).toBe(1);
    expect(states.find((s) => s.source === "france-travail")!.lastSuccessAt).not.toBeNull();
    expect((await prisma.collectionRun.findFirstOrThrow()).status).toBe("partial");
  });

  it("relance à la main (keepSchedule) : un échec ne ralentit pas la planification, une réussite efface le ralentissement", async () => {
    let fail = true;
    const src: JobSource = {
      name: "adzuna",
      search: async () => {
        if (fail) throw new Error("HTTP 500");
        return [];
      },
      healthCheck: async () => ({ status: "OK" }),
    };
    const planned = new Date(Date.now() + 10 * 60_000);
    await prisma.sourceState.create({ data: { source: "adzuna", intervalMinutes: 90, failures: 0, nextRunAt: planned } });

    await collectOnce({ prisma, sources: [src], profile: DEFAULT_PROFILE, trigger: "manual", keepSchedule: true });
    let state = await prisma.sourceState.findUniqueOrThrow({ where: { source: "adzuna" } });
    expect(state).toMatchObject({ failures: 0, nextRunAt: planned });
    expect((await prisma.sourceRun.findFirstOrThrow()).status).toBe("ERROR"); // l'échec reste visible

    // Ralentie par 3 échecs automatiques (prochaine dans 8 × l'intervalle) : une relance réussie remet le rythme normal.
    const slowed = new Date(Date.now() + 24 * 3600_000);
    await prisma.sourceState.update({ where: { source: "adzuna" }, data: { failures: 3, nextRunAt: slowed } });
    fail = false;
    await collectOnce({ prisma, sources: [src], profile: DEFAULT_PROFILE, trigger: "manual", keepSchedule: true });
    state = await prisma.sourceState.findUniqueOrThrow({ where: { source: "adzuna" } });
    expect(state.failures).toBe(0);
    expect(state.lastSuccessAt).not.toBeNull();
    expect(state.nextRunAt.getTime()).toBeLessThan(slowed.getTime());
  });

  it("offres expirées : seulement quand toutes les sources le confirment, jamais les sauvegardées", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 10 * 86_400_000);
    await ingestJob(prisma, normalize(raw(FT_SAMPLE_OFFER))!, old);
    await ingestJob(prisma, normalize(raw({ ...FT_SAMPLE_OFFER, id: "ENCORE", intitule: "Dev encore en ligne" }))!, old);
    await ingestJob(prisma, normalize(raw({ ...FT_SAMPLE_OFFER, id: "SAUVEE", intitule: "Dev sauvegardé" }))!, old);
    await prisma.job.updateMany({ where: { title: "Dev sauvegardé" }, data: { status: "SAVED" } });

    const asked: string[] = [];
    const r = await expireJobs({
      prisma,
      now,
      ftIsOnline: async (id) => {
        asked.push(id);
        return id === "ENCORE";
      },
    });
    expect(r.expired).toBe(1);
    expect(asked.sort()).toEqual(["199XYZT", "ENCORE"]);
    const byTitle = Object.fromEntries((await prisma.job.findMany()).map((j) => [j.title, j.status]));
    expect(byTitle["Développeur Full Stack Vue.js / Node.js (H/F)"]).toBe("EXPIRED");
    expect(byTitle["Dev encore en ligne"]).toBe("NEW");
    expect(byTitle["Dev sauvegardé"]).toBe("SAVED");
  });

  it("Jooble : offres enregistrées, appels comptés en base, pas de 2ᵉ appel le même jour", async () => {
    const quota = prismaJoobleQuota(prisma, "abcd-1234-efgh");
    let calls = 0;
    const jooble = new JoobleSource({
      apiKey: "abcd-1234-efgh",
      quota,
      sleep: async () => {},
      fetch: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 1,
                title: "Développeur Vue.js",
                location: "Creil",
                snippet: "Vue.js et TypeScript",
                type: "CDI",
                link: "https://fr.jooble.org/desc/-111?ckey=x",
                company: "ACME Jooble",
                updated: new Date().toISOString(),
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    const profile = { ...DEFAULT_PROFILE, searches: ["Développeur Vue.js", "Développeur frontend"], locations: [{ label: "Oise", department: "60" }] };
    const r1 = await collectOnce({ prisma, profile, sources: [jooble], trigger: "manual" });
    expect(r1.created).toBe(1);
    expect(calls).toBe(1); // 2 recherches, 1 zone → 1 seul appel
    expect((await quota.get()).used).toBe(1);

    const r2 = await collectOnce({ prisma, profile, sources: [jooble], trigger: "manual" });
    expect(r2.sources[0]!.status).toBe("OK");
    expect(calls).toBe(1); // moins de 20 h : ignorée
    expect((await prisma.apiQuota.findMany()).map((q) => q.used)).toEqual([1]);
    expect((await prisma.job.findFirstOrThrow()).department).toBe("60");
  });

  it("offre JobScraper sans description : complétée depuis sa page publique, score recalculé", async () => {
    const offer = {
      id: "linkedin_4475563031", source: "linkedin", title: "Développeur Vue.js", company: "Acme", location: "Paris, France",
      url: "https://fr.linkedin.com/jobs/view/developpeur-vue-js-at-acme-4475563031", description: null,
    };
    await ingestJob(prisma, normalize(mapJobScraperOfferToRawJob(offer, "linkedin")!)!);
    const asked: string[] = [];
    const r = await completeJobScraperDescriptions({
      prisma,
      sleep: async () => {},
      fetchDetails: async (link) => {
        asked.push(link.sourceJobId);
        return {
          description: "<p>Type de contrat : CDI</p><p>Vue.js, TypeScript et Node.js au sein d'une équipe produit à taille humaine, en télétravail partiel.</p>",
          postedAt: new Date("2026-09-29T12:00:00Z"),
        };
      },
    });
    expect(r).toEqual({ checked: 1, completed: 1 });
    expect(asked).toEqual(["linkedin_4475563031"]);
    const job = await prisma.job.findFirstOrThrow();
    expect(job.description).toContain("Vue.js, TypeScript");
    expect(job.publishedAt?.toISOString()).toBe("2026-09-29T12:00:00.000Z");
    expect(job.technologies).toEqual(expect.arrayContaining(["Vue.js", "TypeScript"])); // score technique sur le vrai texte
    // Déjà complétée : rien à refaire au passage suivant.
    expect((await completeJobScraperDescriptions({ prisma, sleep: async () => {}, fetchDetails: async () => null })).checked).toBe(0);
  });

  it("résumé WTTJ : remplacé par l'annonce entière, que la collecte suivante n'écrase plus", async () => {
    const offer = {
      id: "wttj_42", source: "wttj", title: "Junior Full Stack Engineer", company: "Escape", location: "Paris",
      url: "https://www.welcometothejungle.com/fr/companies/escape/jobs/junior-full-stack-engineer_paris",
      description: "Join Escape, a leading AI cybersecurity company, as a Junior Full-Stack Engineer.",
    };
    await ingestJob(prisma, normalize(mapJobScraperOfferToRawJob(offer, "wttj")!)!);
    const full = "<h2>Our Tech Stack</h2><p>Frontend: Svelte, TypeScript, GraphQL. Backend: Node.js, GraphQL, Prisma, PostgreSQL, Kafka. Infra: AWS, Kubernetes.</p>";
    const r = await completeJobScraperDescriptions({ prisma, sleep: async () => {}, fetchDetails: async () => ({ description: full, postedAt: null }) });
    expect(r).toEqual({ checked: 1, completed: 1 });
    const done = await prisma.job.findFirstOrThrow();
    expect(done.technologies).toEqual(expect.arrayContaining(["TypeScript", "PostgreSQL"]));

    // Collecte suivante : JobScraper redonne le résumé → l'annonce entière reste.
    expect(await ingestJob(prisma, normalize(mapJobScraperOfferToRawJob(offer, "wttj")!)!)).toBe("unchanged");
    expect((await prisma.job.findFirstOrThrow()).description).toContain("Our Tech Stack");
    // Et elle n'est plus redemandée.
    expect((await completeJobScraperDescriptions({ prisma, sleep: async () => {}, fetchDetails: async () => ({ description: full, postedAt: null }) })).checked).toBe(0);
  });

  it("offre déjà décrite mais sans date : elle gagne sa date, que la collecte suivante (sans date) n'efface pas", async () => {
    const offer = {
      id: "linkedin_4473676089", source: "linkedin", title: "Développeur Java", company: "Acme", location: "Paris",
      url: "https://fr.linkedin.com/jobs/view/developpeur-java-4473676089", description: "Java, Spring Boot et Angular dans une équipe produit. ".repeat(4),
    };
    await ingestJob(prisma, normalize(mapJobScraperOfferToRawJob(offer, "linkedin")!)!);
    const posted = new Date("2026-09-29T12:00:00Z");
    const r = await completeJobScraperDescriptions({ prisma, sleep: async () => {}, fetchDetails: async () => ({ description: null, postedAt: posted }) });
    expect(r).toEqual({ checked: 1, completed: 1 });
    expect((await prisma.job.findFirstOrThrow()).publishedAt).toEqual(posted);

    // Collecte suivante, texte modifié et toujours sans date : la date reste, et n'est plus recherchée.
    expect(await ingestJob(prisma, normalize(mapJobScraperOfferToRawJob({ ...offer, description: "Java et Kotlin. ".repeat(10) }, "linkedin")!)!)).toBe("updated");
    expect((await prisma.job.findFirstOrThrow()).publishedAt).toEqual(posted);
    expect((await completeJobScraperDescriptions({ prisma, sleep: async () => {}, fetchDetails: async () => null })).checked).toBe(0);
  });

  it("même lien d'annonce (LinkedIn) : un seul job, complété par l'ajout manuel, jamais vidé ensuite", async () => {
    const offer = {
      id: "linkedin_4474244898", source: "linkedin", title: "Ingénieur.e logiciel C# - Secteur bancaire", company: "SOLENT",
      location: "La Garenne-Colombes, France", description: null,
      url: "https://fr.linkedin.com/jobs/view/ingenieur-e-logiciel-c-secteur-bancaire-at-solent-sas-4474244898?position=6&refId=a",
    };
    const scraped = normalize(mapJobScraperOfferToRawJob(offer, "linkedin")!)!;
    expect(await ingestJob(prisma, scraped)).toBe("created");

    // Ajout à la main : autre titre (pas la même empreinte), même offre LinkedIn → rattaché, et la description complète la fiche.
    const manual = await saveManualJob(prisma, buildManualJob({
      url: "https://www.linkedin.com/jobs/view/ingenieur-e-full-stack-c-secteur-bancaire-at-solent-sas-4474244898/?refId=b",
      title: "Ingénieur.e Full Stack C# - Secteur bancaire", company: "SOLENT", location: "La Garenne-Colombes",
      description: "Chez SOLENT, nous plaçons des ingénieurs C# .NET au cœur de projets bancaires. CDI.",
    })!);
    expect(manual.duplicate).toBe(true);
    expect(await prisma.job.count()).toBe(1);
    const filled = await prisma.job.findUniqueOrThrow({ where: { id: manual.jobId } });
    expect(filled.description).toContain("Chez SOLENT");

    // Collecte suivante sans le détail : la description n'est pas effacée.
    expect(await ingestJob(prisma, normalize(mapJobScraperOfferToRawJob({ ...offer, title: "Autre titre" }, "linkedin")!)!)).toBe("unchanged");
    expect((await prisma.job.findUniqueOrThrow({ where: { id: manual.jobId } })).description).toContain("Chez SOLENT");
  });

  it("offre ajoutée à la main : sauvegardée, jamais expirée ; rattachée si déjà connue ; retrait", async () => {
    const form = {
      title: "Développeur Vue.js",
      company: "Acme Manuel",
      location: "Creil",
      description: "Vue.js et TypeScript, CDI, 2 ans d'expérience minimum.",
    };
    const a = await saveManualJob(prisma, buildManualJob(form)!);
    expect(a.duplicate).toBe(false);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: a.jobId } });
    expect(job).toMatchObject({ status: "SAVED", contractType: "CDI", city: "Creil", department: "60" });

    // Deuxième ajout identique : rattaché à la même offre.
    const b = await saveManualJob(prisma, buildManualJob(form)!);
    expect(b).toMatchObject({ jobId: a.jobId, duplicate: true });
    expect(await prisma.job.count()).toBe(1);

    // Vieille de 100 jours : l'expiration ne la touche pas.
    await prisma.job.update({ where: { id: a.jobId }, data: { lastSeenAt: new Date(Date.now() - 100 * 86_400_000) } });
    await expireJobs({ prisma });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: a.jobId } })).status).toBe("SAVED");

    expect(await removeManualJob(prisma, a.jobId)).toBe("deleted");
    expect(await prisma.job.count()).toBe(0);
  });
});
