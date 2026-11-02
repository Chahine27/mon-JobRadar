import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, testPrisma } from "../../db/test/helpers";
import { createPrismaNotifyRepo } from "./notify";

const prisma = testPrisma();
beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe("anti double notification (base réelle)", () => {
  it("une offre ne peut être réservée qu'une fois par canal", async () => {
    const job = await prisma.job.create({
      data: { fingerprint: "f1", contentHash: "h", title: "Dev", description: "Vue", technologies: [] },
    });
    const repo = createPrismaNotifyRepo(prisma);
    expect(await repo.claim(job.id, "email", "complete")).toBe(true);
    expect(await repo.claim(job.id, "email", "complete")).toBe(false);
    expect(await repo.claim(job.id, "webpush", "complete")).toBe(true);
    // « à postuler » après « à compléter » : autre type, donc autorisé une fois.
    expect(await repo.claim(job.id, "email", "apply")).toBe(true);
    expect(await repo.wasSent(job.id, "complete")).toBe(false);
    await repo.finish(job.id, "email", "complete", "sent");
    expect(await repo.wasSent(job.id, "complete")).toBe(true);
    await repo.markNotified([job.id]);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).notifiedAt).not.toBeNull();
    expect(await repo.candidates(new Date(0))).toEqual([]);
  });

  it("republication : repérée seulement si la jumelle (même clé) a été triée ou annoncée il y a moins de 60 jours", async () => {
    const day = 86_400_000;
    const make = (n: string, data: object) =>
      prisma.job.create({ data: { fingerprint: n, contentHash: n, title: "Dev", description: "Vue", technologies: [], dedupeKey: "acme|dev", ...data } });
    await make("a", { status: "IGNORED", firstSeenAt: new Date(Date.now() - 10 * day) });
    await make("b", { dedupeKey: "autre|dev", status: "REJECTED", firstSeenAt: new Date(Date.now() - 90 * day) });
    await make("c", { dedupeKey: "troisieme|dev", firstSeenAt: new Date(Date.now() - 10 * day) }); // « Nouvelle », jamais annoncée ni triée
    const republished = await make("d", {});
    const afterOldTwin = await make("e", { dedupeKey: "autre|dev" });
    const afterUnhandledTwin = await make("f", { dedupeKey: "troisieme|dev" });
    const alone = await make("g", { dedupeKey: "seule|dev" });

    const repost = Object.fromEntries((await createPrismaNotifyRepo(prisma).candidates(new Date(0))).map((j) => [j.id, j.repost]));
    expect(repost[republished.id]).toBe(true);
    expect(repost[afterOldTwin.id]).toBe(false); // jumelle refusée il y a 90 jours
    expect(repost[afterUnhandledTwin.id]).toBe(false); // jumelle jamais annoncée ni triée
    expect(repost[alone.id]).toBe(false);
  });

  it("offre LinkedIn sans description : attend la lecture de sa page avant tout mail", async () => {
    const job = await prisma.job.create({
      data: { fingerprint: "f2", contentHash: "h", title: "Dev Angular", description: "", technologies: [] },
    });
    const link = await prisma.jobSourceLink.create({
      data: { jobId: job.id, source: "jobscraper:linkedin", sourceJobId: "1", sourceUrl: "https://x", rawData: {} },
    });
    const repo = createPrismaNotifyRepo(prisma);
    expect(await repo.candidates(new Date(0))).toEqual([]);
    // Page lue sans succès : là, « à compléter » est le bon mail.
    await prisma.jobSourceLink.update({ where: { id: link.id }, data: { rawData: { detailTriedAt: new Date().toISOString() } } });
    expect((await repo.candidates(new Date(0))).map((j) => [j.id, j.sources])).toEqual([[job.id, [{ source: "jobscraper:linkedin" }]]]);
  });
});
