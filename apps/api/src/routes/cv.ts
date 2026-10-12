import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CV_RULES_VERSION, hashOf } from "@job-radar/cv-tailor";
import { type CvEngine, renderCvHtml, renderPdf } from "@job-radar/cv-render";
import { countToValidate, type CvMaster, CvMasterSchema, CvOverridesSchema, EMPTY_OVERRIDES, TEMPLATE_IDS, TemplateIdSchema, type TemplateId, validateVariant } from "@job-radar/shared";
import { CV_SKILLS } from "@job-radar/skills";
import type { FastifyInstance } from "fastify";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { requireAuth } from "../auth";
import { createCvService } from "../cv";
import type { Stores, TailoredCvRow } from "../stores";

export type CvRoutesOptions = {
  stores: Stores;
  /** Fichier de départ (data/cv/cv-master.seed.yaml). */
  seedPath: string;
  aiModel?: string | undefined;
  /** Navigateur pour l'ajustement à une page et le PDF. Absent → pas de PDF. */
  engine?: CvEngine | undefined;
  /** Bouton « Ouvrir le dossier » (explorateur Windows). */
  openFolder?: ((dir: string) => void) | undefined;
};

const IdParams = z.object({ id: z.string().min(1).max(64) });
const TemplateQuery = z.object({ template: TemplateIdSchema });
const RefParams = z.object({ ref: z.string().min(1).max(130) });
const TEMPLATE_LABELS: Record<TemplateId, string> = { "une-colonne": "Une colonne", "deux-colonnes": "Deux colonnes" };

const issuesOf = (e: z.ZodError) => e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));

/** « Chahine Mehadji » → « MEHADJI_CHAHINE » (le nom que voit le recruteur). */
export function cvFileBase(fullName: string): string {
  const clean = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
  const parts = fullName.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.at(-1)! : "";
  return [last, parts.slice(0, parts.length > 1 ? -1 : 1).join(" ")].filter(Boolean).map(clean).join("_") || "CV";
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const folderName = (company: string | null, d: Date) => `${(company ?? "Entreprise").replace(/[\\/:*?"<>|.]+/g, " ").replace(/\s+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "Entreprise"}_${localDate(d)}`;

export async function cvRoutes(app: FastifyInstance, opts: CvRoutesOptions) {
  const { stores } = opts;
  const cv = createCvService(stores, { aiModel: opts.aiModel, engine: opts.engine });
  app.addHook("preHandler", requireAuth);

  const masterReply = (m: CvMaster | null, updatedAt: Date | null) => {
    const parsed = m ? CvMasterSchema.safeParse(m) : null;
    return { master: m, updatedAt, toValidate: m ? countToValidate(m) : 0, issues: parsed && !parsed.success ? issuesOf(parsed.error) : [] };
  };

  // ───── CV complet ─────
  app.get("/api/cv-master", async (request) => {
    const rec = await stores.cvMasters.get(request.userId!);
    return masterReply(rec?.master ?? null, rec?.updatedAt ?? null);
  });

  app.put("/api/cv-master", async (request, reply) => {
    const body = z.object({ master: CvMasterSchema }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_CV_MASTER", issues: issuesOf(body.error) });
    const rec = await stores.cvMasters.save(request.userId!, body.data.master, hashOf(body.data.master));
    return masterReply(rec.master, rec.updatedAt);
  });

  // Importe le fichier de départ, seulement si la base est vide : ne réécrit jamais un CV complet existant.
  app.post("/api/cv-master/import-seed", async (request, reply) => {
    if (await stores.cvMasters.get(request.userId!)) return reply.code(409).send({ error: "CV_MASTER_EXISTS", message: "Ton CV complet existe déjà : l'import ne le remplace pas." });
    let raw: unknown;
    try {
      raw = parseYaml(await readFile(opts.seedPath, "utf8"));
    } catch (e) {
      const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
      return reply.code(missing ? 404 : 400).send({
        error: missing ? "SEED_NOT_FOUND" : "SEED_UNREADABLE",
        message: missing ? `Fichier de départ introuvable : ${opts.seedPath}` : `Fichier de départ illisible : ${(e as Error).message}`,
      });
    }
    const parsed = CvMasterSchema.safeParse(raw);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_CV_MASTER", message: "Le fichier de départ est incohérent.", issues: issuesOf(parsed.error) });
    const rec = await stores.cvMasters.save(request.userId!, parsed.data, hashOf(parsed.data));
    return masterReply(rec.master, rec.updatedAt);
  });

  app.post("/api/cv-master/variants/:ref/validate", async (request, reply) => {
    const params = RefParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_REF" });
    const rec = await stores.cvMasters.get(request.userId!);
    if (!rec) return reply.code(404).send({ error: "NO_CV_MASTER" });
    const master = structuredClone(rec.master);
    if (!validateVariant(master, params.data.ref)) return reply.code(404).send({ error: "VARIANT_NOT_FOUND" });
    const parsed = CvMasterSchema.safeParse(master);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_CV_MASTER", issues: issuesOf(parsed.error) });
    const saved = await stores.cvMasters.save(request.userId!, parsed.data, hashOf(parsed.data));
    return masterReply(saved.master, saved.updatedAt);
  });

  app.get("/api/cv/templates", async (request) => {
    const ats = (await stores.cvMasters.get(request.userId!))?.master.atsTemplate ?? "une-colonne";
    return { templates: TEMPLATE_IDS.map((id) => ({ id, label: TEMPLATE_LABELS[id], role: id === ats ? "ats" : "email" })) };
  });

  /** Dictionnaire des compétences (étiquettes de la page /cv). */
  app.get("/api/cv/skills", async () => ({ skills: CV_SKILLS.map((s) => ({ id: s.id, label: s.label })) }));

  // ───── CV adapté à une offre ─────
  /** Offre + CV complet valide, ou réponse d'erreur déjà envoyée (null). */
  const context = async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return void reply.code(400).send({ error: "INVALID_ID" });
    const job = await stores.jobs.get(params.data.id);
    if (!job) return void reply.code(404).send({ error: "JOB_NOT_FOUND" });
    const m = await cv.master(request.userId!);
    if ("error" in m) {
      return void reply.code(409).send({
        error: m.error,
        message: m.error === "NO_CV_MASTER" ? "Remplis d'abord ton CV complet (page « CV complet »)." : "Ton CV complet est incohérent : corrige-le sur la page « CV complet ».",
      });
    }
    return { job, master: m.master, masterHash: m.hash, jobCv: await cv.jobForCv(request.userId!, job) };
  };
  const cvReply = (row: TailoredCvRow | null, stale: string[]) => ({ cv: row, stale: stale.length > 0, staleReasons: stale, rulesVersion: CV_RULES_VERSION, pdfAvailable: !!opts.engine });

  app.get("/api/jobs/:id/cv", async (request, reply) => {
    const q = TemplateQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "INVALID_TEMPLATE" });
    const ctx = await context(request, reply);
    if (!ctx) return reply;
    const row = await stores.tailoredCvs.get(ctx.job.id, q.data.template);
    return cvReply(row, row ? cv.staleReasons(row, ctx.masterHash, ctx.jobCv) : []);
  });

  /** Calcule (ou recalcule) le brouillon en gardant les choix manuels encore valables. */
  const saveDraft = async (ctx: NonNullable<Awaited<ReturnType<typeof context>>>, template: TemplateId, overrides: typeof EMPTY_OVERRIDES, validated: boolean) => {
    const draft = await cv.compute(ctx.master, ctx.jobCv, template, overrides);
    return stores.tailoredCvs.save({
      jobId: ctx.job.id,
      template,
      draft,
      overrides,
      rulesVersion: draft.rulesVersion,
      masterHash: draft.masterHash,
      jobHash: draft.jobHash,
      status: validated ? "VALIDATED" : "DRAFT",
    });
  };

  app.post("/api/jobs/:id/cv", async (request, reply) => {
    const body = z.object({ template: TemplateIdSchema }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_TEMPLATE" });
    const ctx = await context(request, reply);
    if (!ctx) return reply;
    const prev = await stores.tailoredCvs.get(ctx.job.id, body.data.template);
    return cvReply(await saveDraft(ctx, body.data.template, prev?.overrides ?? EMPTY_OVERRIDES, false), []);
  });

  // Choix manuels (jamais de texte libre) et « Valider ».
  app.put("/api/jobs/:id/cv", async (request, reply) => {
    const body = z.object({ template: TemplateIdSchema, overrides: CvOverridesSchema, validated: z.boolean().default(false) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_OVERRIDES", issues: issuesOf(body.error) });
    const ctx = await context(request, reply);
    if (!ctx) return reply;
    return cvReply(await saveDraft(ctx, body.data.template, body.data.overrides, body.data.validated), []);
  });

  app.get("/api/jobs/:id/cv/preview", async (request, reply) => {
    const q = TemplateQuery.safeParse(request.query);
    const params = IdParams.safeParse(request.params);
    if (!q.success || !params.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const row = await stores.tailoredCvs.get(params.data.id, q.data.template);
    if (!row) return reply.code(404).send({ error: "CV_NOT_FOUND" });
    return reply.type("text/html; charset=utf-8").send(renderCvHtml(row.draft.sections));
  });

  // Contrôles + PDF d'un modèle ou des deux. Rien n'est écrit si un contrôle bloque.
  app.post("/api/jobs/:id/cv/pdf", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = z.object({ templates: z.array(TemplateIdSchema).min(1).max(2) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_TEMPLATES" });
    if (!opts.engine) return reply.code(503).send({ error: "NO_BROWSER", message: "Création de PDF indisponible (navigateur non configuré)." });
    const ctx = await context(request, reply);
    if (!ctx) return reply;
    const kit = await stores.letterKits.get(request.userId!);
    // Dossier du point 6 de « CV & lettre », sinon celui des lettres (point 5).
    const root = (kit?.cvFolder || kit?.pdfFolder || "").trim().replace(/^"+|"+$/g, "");
    if (!kit || !root) return reply.code(400).send({ error: "NO_PDF_FOLDER", message: "Choisis où enregistrer les CV dans « CV & lettre » (point 6, ou le dossier des lettres au point 5)." });
    const templates = [...new Set(body.data.templates)];
    const rows = new Map<TemplateId, TailoredCvRow>();
    for (const t of templates) {
      const row = await stores.tailoredCvs.get(ctx.job.id, t);
      if (!row || row.status === "DRAFT") return reply.code(409).send({ error: "NOT_VALIDATED", message: `Valide d'abord le CV « ${TEMPLATE_LABELS[t]} » à l'écran.` });
      if (cv.staleReasons(row, ctx.masterHash, ctx.jobCv).length) return reply.code(409).send({ error: "STALE", message: `Le CV « ${TEMPLATE_LABELS[t]} » est à refaire : régénère-le puis valide-le.` });
      rows.set(t, row);
    }

    const now = new Date();
    const folder = kit.cvSubfolder ? join(root, folderName(ctx.job.company, now)) : root;
    const base = cvFileBase(ctx.master.identity.fullName);
    const ats = ctx.master.atsTemplate;
    const email = TEMPLATE_IDS.find((t) => t !== ats)!;
    const atsRow = rows.get(ats) ?? (await stores.tailoredCvs.get(ctx.job.id, ats));
    const emailRow = rows.get(email) ?? (await stores.tailoredCvs.get(ctx.job.id, email));
    const inFolder = (r: TailoredCvRow | null) => !!r?.pdfPath && dirname(r.pdfPath) === folder && existsSync(r.pdfPath);
    // Suffixe « _ATS » seulement si les deux modèles finissent dans le même dossier.
    const bothHere = templates.length === 2 || (templates[0] === ats ? inFolder(emailRow) : inFolder(atsRow));
    const fileOf = (t: TemplateId) => join(folder, `${base}${t === ats && bothHere ? "_ATS" : ""}.pdf`);
    /** « Garder l'ancien » : nouveau nom libre (_2, _3…) au lieu d'écraser. */
    const free = (file: string) => {
      if (kit.cvReplace || !existsSync(file)) return file;
      let i = 2;
      while (existsSync(file.replace(/\.pdf$/, `_${i}.pdf`))) i++;
      return file.replace(/\.pdf$/, `_${i}.pdf`);
    };
    const target = new Map(templates.map((t) => [t, free(fileOf(t))]));

    const results: Array<{ template: TemplateId; ok: boolean; path: string | null; checks: TailoredCvRow["draft"]["checks"]; warnings: string[] }> = [];
    const pdfs = new Map<TemplateId, Buffer>();
    for (const t of templates) {
      const row = rows.get(t)!;
      const fitted = await cv.compute(ctx.master, ctx.jobCv, t, row.overrides);
      const { pdf, draft } = await renderPdf(fitted, opts.engine);
      await stores.tailoredCvs.save({ ...row, draft, status: row.status });
      const ok = draft.checks.every((c) => c.ok === true);
      if (ok) pdfs.set(t, pdf);
      results.push({ template: t, ok, path: ok ? target.get(t)! : null, checks: draft.checks, warnings: draft.warnings });
    }
    if (pdfs.size === 0) return reply.code(422).send({ error: "CHECKS_FAILED", message: "Un contrôle bloque l'export : rien n'a été enregistré.", results, folder: null });

    await mkdir(folder, { recursive: true });
    // Le CV ATS déjà exporté sans suffixe dans ce dossier prend « _ATS » : l'autre modèle ne l'écrase pas.
    if (!pdfs.has(ats) && kit.cvReplace && atsRow?.pdfPath === join(folder, `${base}.pdf`) && existsSync(atsRow.pdfPath)) {
      await rename(atsRow.pdfPath, fileOf(ats));
      await stores.tailoredCvs.markExported(ctx.job.id, ats, fileOf(ats), atsRow.exportedAt ?? now);
    }
    for (const [t, pdf] of pdfs) {
      await writeFile(target.get(t)!, pdf);
      await stores.tailoredCvs.markExported(ctx.job.id, t, target.get(t)!, now);
    }
    return { results, folder };
  });

  app.post("/api/jobs/:id/cv/open-folder", async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "INVALID_ID" });
    const paths = await Promise.all(TEMPLATE_IDS.map((t) => stores.tailoredCvs.get(params.data.id, t)));
    const path = paths.map((r) => r?.pdfPath).find((p): p is string => !!p && existsSync(p));
    if (!path) return reply.code(404).send({ error: "NO_PDF", message: "Aucun CV exporté pour cette offre." });
    if (!opts.openFolder) return reply.code(503).send({ error: "UNAVAILABLE" });
    opts.openFolder(dirname(path));
    return { folder: dirname(path) };
  });
}
