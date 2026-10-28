/**
 * Serveur MCP en LECTURE SEULE : offres, notes, suivi des candidatures et profil, pour Claude Code.
 * Pas de port ouvert : Claude Code le lance sur le serveur par SSH (donc par Tailscale), échange sur stdin/stdout.
 *   claude mcp add --scope user jobradar -- "C:\Program Files\Git\usr\bin\ssh.exe" jobradar "bash -lc 'cd ~/jobradar/apps/api && node_modules/.bin/tsx src/mcp-server.ts'"
 *   (ssh de Git : celui de Windows refuse ~/.ssh/config, dont les droits incluent un autre compte)
 * Lecture seule garantie par la base elle-même (transactions en lecture seule), pas seulement par le code.
 * Aucun appel IA : les notes et avis viennent de la base. Rien ne s'écrit sur stdout hors protocole.
 */
import { aiChain } from "@job-radar/ai";
import { createPrismaClient } from "@job-radar/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadEnv } from "./env";
import { createJobService, type JobSummary } from "./jobs/service";
import { createPrismaStores } from "./prisma-stores";
import { listApplications } from "./routes/applications";

const STATUSES = ["active", "all", "NEW", "SEEN", "SAVED", "APPLIED", "REJECTED", "EXPIRED", "IGNORED"] as const;
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

const brief = (j: JobSummary) => ({
  id: j.id,
  title: j.title,
  company: j.company,
  city: j.city,
  contract: j.contractType,
  salary: j.salaryText ?? ([j.salaryMin, j.salaryMax].filter(Boolean).join("–") || null),
  status: j.status,
  score: j.score.final,
  aiAdequation: j.ai?.adequation ?? null,
  aiNote: j.ai?.note ?? null,
  publishedAt: j.publishedAt,
  url: j.sources[0]?.url ?? null,
});

/** Client Prisma dont chaque transaction est en lecture seule (option envoyée à PostgreSQL à la connexion). */
export function readOnlyDatabaseUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("options", "-c default_transaction_read_only=on");
  return u.toString();
}

export async function buildMcpServer(databaseUrl: string, env: Record<string, string | undefined> = process.env) {
  const prisma = createPrismaClient(readOnlyDatabaseUrl(databaseUrl));
  // Garde-fou : si PostgreSQL n'a pas pris l'option, on refuse de démarrer plutôt que de risquer une écriture.
  const rows = await prisma.$queryRaw<Array<{ ro: string }>>`SELECT current_setting('default_transaction_read_only') AS ro`;
  if (rows[0]?.ro !== "on") throw new Error("Base non protégée en lecture seule : arrêt");

  const stores = createPrismaStores(prisma);
  // Même modèle que l'API : l'avis de l'IA n'est repris que s'il a été fait par lui (construire la chaîne n'appelle rien).
  const jobs = createJobService(stores, undefined, { aiModel: aiChain(env, "general").model });
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("Aucun utilisateur en base");
  const userId = user.id;

  const server = new McpServer({ name: "job-radar", version: "1.0.0" });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

  server.registerTool(
    "lister_offres",
    {
      description: "Liste les offres avec leur note sur 100 (la même que sur le site). Triées par note ou par date.",
      inputSchema: {
        status: z.enum(STATUSES).default("active").describe("active = hors ignorées / refusées / expirées"),
        minScore: z.number().int().min(0).max(100).default(0),
        q: z.string().max(100).optional().describe("mot du titre, de l'entreprise ou de la description"),
        sort: z.enum(["score", "date"]).default("score"),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: readOnly,
    },
    async ({ status, minScore, q, sort, limit }) => {
      const all = await jobs.list(userId, { status, minScore, includeHidden: false, q, sort });
      return json({ total: all.length, offers: all.slice(0, limit).map(brief) });
    },
  );

  server.registerTool(
    "voir_offre",
    {
      description: "Détail d'une offre : annonce, calcul de la note, points forts / manques, avis de l'IA, trajet.",
      inputSchema: { id: z.string().min(1).max(64) },
      annotations: readOnly,
    },
    async ({ id }) => {
      const j = await jobs.get(userId, id);
      if (!j) return fail("Offre introuvable");
      return json({
        ...brief(j),
        description: j.description.slice(0, 6000),
        experienceMinYrs: j.experienceMinYrs,
        remote: j.remoteType,
        travelMinutes: j.travelMinutes,
        travelMode: j.travelMode,
        scoreSteps: j.scoreSteps,
        reasons: j.reasons,
        warnings: j.warnings,
        matchedSkills: j.matchedSkills,
        missingSkills: j.missingSkills,
        ai: j.ai,
        applyChannel: j.applyChannel,
        applyCv: j.applyCv,
        sources: j.sources,
      });
    },
  );

  server.registerTool(
    "suivi_candidatures",
    {
      description:
        "Candidatures envoyées (sur offre et spontanées) : total par étape (SENT, ACK, INTERVIEW, OFFER, REJECTED…), puis les plus récentes, " +
        "une ligne chacune avec le dernier mail reçu. Détail d'une offre : voir_offre.",
      inputSchema: {
        stage: z.string().max(20).optional().describe("seulement cette étape, ex. INTERVIEW"),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: readOnly,
    },
    async ({ stage, limit }) => {
      const { jobs: offers, spontaneous } = await listApplications(stores, jobs, userId);
      // Une ligne par candidature : tout renvoyer (mails compris) dépasse ce que Claude Code accepte (~150 000 caractères).
      const lastMail = (mails: Array<{ kind: string; detail: string | null; summary: string | null; receivedAt: Date; dismissed: boolean }>) => {
        const m = mails.filter((x) => !x.dismissed).at(-1);
        return m ? { kind: m.kind, detail: m.detail, summary: m.summary, receivedAt: m.receivedAt } : null;
      };
      const all = [
        ...offers.map((o) => ({ type: "offre", id: o.id, company: o.company, title: o.title, score: o.score.final, date: o.appliedAt, stage: o.stage, noAnswer: o.noAnswer, lastMail: lastMail(o.mails) })),
        ...spontaneous.map((s) => ({ type: "spontanée", id: s.id, company: s.company, title: null, score: null, date: s.sentAt, stage: s.stage, noAnswer: false, lastMail: lastMail(s.mails) })),
      ];
      const byStage: Record<string, number> = {};
      for (const x of all) byStage[x.stage] = (byStage[x.stage] ?? 0) + 1;
      const kept = all
        .filter((x) => !stage || x.stage === stage.toUpperCase())
        .sort((x, y) => new Date(y.lastMail?.receivedAt ?? y.date ?? 0).getTime() - new Date(x.lastMail?.receivedAt ?? x.date ?? 0).getTime());
      return json({ total: all.length, byStage, shown: Math.min(limit, kept.length), of: kept.length, applications: kept.slice(0, limit) });
    },
  );

  server.registerTool(
    "voir_profil",
    {
      description: "Profil de recherche tel qu'enregistré sur le site : contrats, compétences, expérience, salaire, zones, seuils.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const rec = await stores.profiles.get(userId);
      if (!rec) return fail("Aucun profil en base");
      // Le domicile : seulement son nom, pas ses coordonnées.
      return json({ ...rec.profile, home: rec.home?.label ?? null, updatedAt: rec.updatedAt });
    },
  );

  return { server, close: () => prisma.$disconnect() };
}
