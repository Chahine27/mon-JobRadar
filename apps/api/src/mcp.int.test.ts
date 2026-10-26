import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEFAULT_PROFILE } from "@job-radar/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@job-radar/db";
import { resetDatabase, testPrisma } from "../../../packages/db/test/helpers";
import { testDatabaseUrl } from "../../../packages/db/test/global-setup";
import { buildMcpServer, readOnlyDatabaseUrl } from "./mcp";

const prisma = testPrisma();
beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

async function connect() {
  const user = await prisma.user.create({ data: { email: "t@t.fr", passwordHash: "x", profile: { create: { data: DEFAULT_PROFILE } } } });
  await prisma.job.create({
    data: { fingerprint: "f", contentHash: "h", title: "Dev Vue", company: "Acme", description: "Vue 3, TypeScript", technologies: ["Vue"], contractType: "CDI" },
  });
  const { server, close } = await buildMcpServer(testDatabaseUrl(), {});
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close, user };
}
const text = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0]!.text;

describe("serveur MCP (base réelle, lecture seule)", () => {
  it("liste les offres, détaille l'une d'elles et donne le suivi", async () => {
    const { client, close } = await connect();
    const list = JSON.parse(text(await client.callTool({ name: "lister_offres", arguments: {} })));
    expect(list.offers).toHaveLength(1);
    expect(list.offers[0]).toMatchObject({ title: "Dev Vue", company: "Acme" });
    expect(typeof list.offers[0].score).toBe("number");
    const detail = JSON.parse(text(await client.callTool({ name: "voir_offre", arguments: { id: list.offers[0].id } })));
    expect(detail.scoreSteps.length).toBeGreaterThan(0);
    const follow = JSON.parse(text(await client.callTool({ name: "suivi_candidatures", arguments: {} })));
    expect(follow).toMatchObject({ total: 0, applications: [] });
    await close();
  });

  it("aucune écriture possible avec l'URL protégée", async () => {
    const ro = createPrismaClient(readOnlyDatabaseUrl(testDatabaseUrl()));
    await expect(ro.job.create({ data: { fingerprint: "x", contentHash: "h", title: "t", description: "d", technologies: [] } })).rejects.toThrow(/read-only/i);
    await ro.$disconnect();
  });
});
