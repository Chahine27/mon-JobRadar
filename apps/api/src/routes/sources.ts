import { minIntervalFor } from "@job-radar/pipeline";
import { ATS_KINDS, BOARD_KEY_RE, parseCareersInput } from "@job-radar/source-connectors";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import type { Stores } from "../stores";

export const SOURCE_LABELS: Record<string, string> = {
  "france-travail": "France Travail",
  adzuna: "Adzuna",
  "company-careers": "Sites carrières d'entreprises",
  jooble: "Jooble",
  "jobscraper:linkedin": "JobScraper · LinkedIn",
  "jobscraper:hellowork": "JobScraper · HelloWork",
  "jobscraper:wttj": "JobScraper · Welcome to the Jungle",
  "jobscraper:indeed": "JobScraper · Indeed",
};

export type SourcesOptions = {
  stores: Stores;
  /** Identifiants présents dans .env, par source. */
  configured: Record<string, boolean>;
  /** Appels utilisés / limite, pour les sources à quota (Jooble). */
  quotas?: () => Promise<Record<string, { used: number; limit: number }>>;
};

const SourceBody = z.object({ enabled: z.boolean(), intervalMinutes: z.number().int().min(1).max(1440) });
const CompanyBody = z.union([
  z.object({ name: z.string().trim().min(1).max(100), url: z.string().trim().min(1).max(500) }),
  z.object({
    name: z.string().trim().min(1).max(100),
    ats: z.enum(ATS_KINDS),
    boardKey: z.string().trim().regex(BOARD_KEY_RE, "Identifiant invalide"),
  }),
]);

export async function sourceRoutes(app: FastifyInstance, opts: SourcesOptions) {
  const { stores } = opts;
  app.addHook("preHandler", requireAuth);

  async function callsPerRun(userId: string) {
    const rec = await stores.profiles.get(userId);
    return rec ? rec.profile.searches.length * rec.profile.locations.length : 12;
  }

  app.get("/api/sources", async (request) => {
    const calls = await callsPerRun(request.userId!);
    const companies = await stores.companies.list();
    const quotas = (await opts.quotas?.().catch(() => null)) ?? {};
    return {
      items: (await stores.sources.list()).map((s) => ({
        ...s,
        quota: quotas[s.source] ?? null,
        label: SOURCE_LABELS[s.source] ?? s.source,
        minIntervalMinutes: minIntervalFor(s.source, calls),
        configured: s.source === "company-careers" ? companies.some((c) => c.enabled) : (opts.configured[s.source] ?? false),
      })),
    };
  });

  app.put("/api/sources/:source", async (request, reply) => {
    const { source } = request.params as { source: string };
    const body = SourceBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    const min = minIntervalFor(source, await callsPerRun(request.userId!));
    if (body.data.intervalMinutes < min) {
      return reply.code(400).send({ error: "INTERVAL_TOO_SHORT", message: `Minimum ${min} min pour respecter les limites de cette source.` });
    }
    const row = await stores.sources.update(source, body.data);
    if (!row) return reply.code(404).send({ error: "SOURCE_NOT_FOUND" });
    return row;
  });

  app.get("/api/companies", async () => ({ items: await stores.companies.list() }));

  app.post("/api/companies", async (request, reply) => {
    const body = CompanyBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_COMPANY" });
    const target = "url" in body.data ? parseCareersInput(body.data.url) : { ats: body.data.ats, boardKey: body.data.boardKey };
    if (!target) {
      return reply.code(400).send({
        error: "UNSUPPORTED_CAREERS_PAGE",
        message: "Adresse non reconnue : il faut une page Greenhouse, Lever, Ashby ou Recruitee.",
      });
    }
    const row = await stores.companies.add({ name: body.data.name, ...target });
    if (!row) return reply.code(409).send({ error: "ALREADY_EXISTS", message: "Cette page carrières est déjà dans la liste." });
    return reply.code(201).send(row);
  });

  app.patch("/api/companies/:id", async (request, reply) => {
    const body = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY" });
    const row = await stores.companies.setEnabled((request.params as { id: string }).id, body.data.enabled);
    if (!row) return reply.code(404).send({ error: "COMPANY_NOT_FOUND" });
    return row;
  });

  app.delete("/api/companies/:id", async (request, reply) => {
    const ok = await stores.companies.remove((request.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: "COMPANY_NOT_FOUND" });
    return { ok: true };
  });
}
