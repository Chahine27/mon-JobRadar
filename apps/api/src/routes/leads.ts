import type { LbbCompany, LbbSearch } from "@job-radar/source-connectors";
import type { FastifyInstance } from "fastify";
import { LeadFiltersSchema, ProfileSchema } from "@job-radar/shared";
import { z } from "zod";
import { requireAuth } from "../auth";
import { LEAD_STATUSES, type LeadInput, type LeadRow, type Stores } from "../stores";

export type LeadsOptions = {
  stores: Stores;
  /** Recherche La Bonne Boîte (absent = non configuré). */
  searchCompanies?: (params: LbbSearch) => Promise<LbbCompany[]>;
};

const INACTIVE = ["NOT_INTERESTED", "IGNORED"];

export function toLeadInput(c: LbbCompany): LeadInput {
  const hc = (n: number | null | undefined) => (n == null || Number.isNaN(n) || n <= 0 ? null : n);
  return {
    siret: c.siret,
    name: (c.company_name ?? "").trim() || "Entreprise sans nom",
    officeName: c.office_name?.trim() || null,
    naf: c.naf ?? null,
    nafLabel: c.naf_label ?? null,
    headcountMin: hc(c.headcount_min),
    headcountMax: hc(c.headcount_max),
    city: c.city ?? null,
    postcode: c.postcode ?? null,
    department: c.department_number ?? null,
    latitude: c.location?.lat ?? null,
    longitude: c.location?.lon ?? null,
    hiringPotential: typeof c.hiring_potential === "number" ? Math.round(c.hiring_potential * 10) / 10 : null,
    isHighPotential: c.is_high_potential === true,
    hasEmail: c.email === "yes",
  };
}

/** Distance à vol d'oiseau en km (formule de haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export async function leadRoutes(app: FastifyInstance, opts: LeadsOptions) {
  const { stores } = opts;
  app.addHook("preHandler", requireAuth);

  app.get("/api/leads", async (request, reply) => {
    const q = z
      .object({
        status: z.enum([...LEAD_STATUSES, "active", "all"]).default("active"),
        sort: z.enum(["potential", "distance"]).default("potential"),
        /**
         * hint = La Bonne Boîte connaît un email (« email sur la fiche ») ; missing = ni email ni note (encore à chercher) ;
         * noted = pas d'email mais une note (recherche déjà faite : site, formulaire, introuvable) ; set = email saisi.
         */
        email: z.enum(["any", "hint", "missing", "noted", "set"]).default("any"),
        /** Recherche dans le nom de l'entreprise (sans tenir compte des accents ni de la casse). */
        q: z.string().trim().max(100).default(""),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    const { status, sort, email, limit, offset } = q.data;
    const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const needle = plain(q.data.q);

    const rec = await stores.profiles.get(request.userId!);
    if (!rec) return reply.code(404).send({ error: "PROFILE_NOT_FOUND" });
    const { place, departments, distanceKm: radius } = rec.profile.spontaneous;
    const depts = departments.length ? departments : rec.profile.locations.map((l) => l.department);

    // Seulement les entreprises de la zone de recherche actuelle (les autres restent en base avec leur suivi).
    const inZone = (await stores.leads.list())
      .map((l) => ({
        ...l,
        distanceKm:
          place && l.latitude != null && l.longitude != null
            ? Math.round(distanceKm(place, { lat: l.latitude, lng: l.longitude }) * 10) / 10
            : null,
      }))
      .filter((l) => (place ? l.distanceKm !== null && l.distanceKm <= radius : l.department !== null && depts.includes(l.department)))
      .filter((l) => (status === "all" ? true : status === "active" ? !INACTIVE.includes(l.status) : l.status === status))
      .filter((l) => !needle || plain(l.name).includes(needle))
      .filter((l) =>
        email === "hint" ? l.hasEmail && !l.contactEmail
        : email === "missing" ? !l.contactEmail && !l.notes
        : email === "noted" ? !l.contactEmail && !!l.notes
        : email === "set" ? !!l.contactEmail
        : true,
      );

    const potential = (l: { hiringPotential: number | null }) => l.hiringPotential ?? -1;
    inZone.sort((a, b) =>
      sort === "distance" && place
        ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || potential(b) - potential(a)
        : potential(b) - potential(a) || a.name.localeCompare(b.name),
    );

    return {
      items: inZone.slice(offset, offset + limit),
      total: inZone.length,
      lastRefreshAt: await stores.leads.lastRefreshAt(),
      configured: Boolean(opts.searchCompanies),
    };
  });

  app.post(
    "/api/leads/refresh",
    { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!opts.searchCompanies) return reply.code(409).send({ error: "NOT_CONFIGURED", message: "Identifiants France Travail absents de .env." });
      const rec = await stores.profiles.get(request.userId!);
      if (!rec) return reply.code(404).send({ error: "PROFILE_NOT_FOUND" });
      const { romes, distanceKm, place, departments } = rec.profile.spontaneous;
      // Zone propre aux candidatures spontanées : un lieu + rayon, sinon des départements,
      // sinon les zones du profil. Le point de départ des offres n'est PAS utilisé ici.
      const depts = departments.length ? departments : rec.profile.locations.map((l) => l.department);
      const around = place ? `${distanceKm} km autour de ${place.label}` : `départements ${depts.join(", ")}`;
      try {
        const companies = await opts.searchCompanies({
          romes,
          maxResults: 100,
          ...(place ? { point: { lat: place.lat, lng: place.lng, distanceKm } } : { departments: depts }),
        });
        const res = await stores.leads.upsertMany(companies.map(toLeadInput), new Date());
        return { ...res, found: companies.length, around };
      } catch (err) {
        return reply.code(502).send({ error: "LBB_FAILED", message: err instanceof Error ? err.message : "Erreur La Bonne Boîte" });
      }
    },
  );

  app.get("/api/leads/settings", async (request, reply) => {
    const rec = await stores.profiles.get(request.userId!);
    if (!rec) return reply.code(404).send({ error: "PROFILE_NOT_FOUND" });
    return rec.profile.spontaneous;
  });

  app.put("/api/leads/settings", async (request, reply) => {
    const body = ProfileSchema.shape.spontaneous.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "INVALID_SETTINGS",
        issues: body.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const rec = await stores.profiles.get(request.userId!);
    if (!rec) return reply.code(404).send({ error: "PROFILE_NOT_FOUND" });
    // Les filtres de la page ont leur propre route : un réglage de zone ne doit pas les écraser (copie périmée).
    const saved = await stores.profiles.save(request.userId!, { ...rec.profile, spontaneous: { ...body.data, filters: rec.profile.spontaneous.filters } }, undefined);
    return saved.profile.spontaneous;
  });

  app.put("/api/leads/filters", async (request, reply) => {
    const body = LeadFiltersSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_FILTERS" });
    const rec = await stores.profiles.get(request.userId!);
    if (!rec) return reply.code(404).send({ error: "PROFILE_NOT_FOUND" });
    const saved = await stores.profiles.save(request.userId!, { ...rec.profile, spontaneous: { ...rec.profile.spontaneous, filters: body.data } }, undefined);
    return saved.profile.spontaneous.filters;
  });

  /**
   * Emails trouvés par une IA avec recherche web (réponse JSON collée par l'utilisateur), rangés par SIRET.
   * Un email déjà saisi n'est remplacé que si `overwrite` ; la page source est notée pour pouvoir vérifier.
   */
  app.post("/api/leads/emails", async (request, reply) => {
    const body = z
      .object({
        items: z
          .array(
            z.object({
              siret: z.string().trim().regex(/^\d{9,14}$/),
              email: z.string().trim().max(200).nullable(),
              source: z.string().trim().max(500).nullable().optional(),
              site: z.string().trim().max(500).nullable().optional(),
              contactUrl: z.string().trim().max(500).nullable().optional(),
            }),
          )
          .min(1)
          .max(100),
        overwrite: z.boolean().default(false),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY", message: "JSON incomplet : il faut au moins un SIRET." });
    const bySiret = new Map((await stores.leads.list()).map((l) => [l.siret, l]));
    const res = { updated: 0, notFound: 0, unknown: 0, invalid: 0, kept: 0, linksOnly: 0, leads: [] as LeadRow[] };
    const http = (v: string | null | undefined) => (v && /^https?:\/\//i.test(v) ? v : null);
    /** Ajoute des lignes aux notes sans doublon (2 000 caractères max). */
    const withNotes = (notes: string | null, lines: Array<string | null>) => {
      const add = lines.filter((x): x is string => !!x && !(notes ?? "").includes(x));
      return add.length ? [notes, ...add].filter(Boolean).join("\n").slice(0, 2000) : notes;
    };
    for (const item of body.data.items) {
      const lead = bySiret.get(item.siret);
      if (!lead) {
        res.unknown++;
        continue;
      }
      const site = http(item.site);
      const form = http(item.contactUrl);
      const links = [site ? `Site : ${site}` : null, form ? `Candidature / contact : ${form}` : null];
      if (!item.email) {
        res.notFound++;
        // Pas d'email : le site ou le formulaire de candidature est noté pour postuler à la main, sinon « introuvable ».
        // Une note la sort de « Sans email, encore à chercher » : le prompt suivant cherche d'autres entreprises.
        if (site || form) res.linksOnly++;
        else if (lead.contactEmail) continue;
        const found = site || form ? links : [`Aucun email trouvé par l'IA (${new Date().toLocaleDateString("fr-FR")})`];
        const row = await stores.leads.update(lead.id, { notes: withNotes(lead.notes, found) });
        if (row) res.leads.push(row);
        continue;
      }
      const email = item.email.toLowerCase();
      if (!z.email().safeParse(email).success) {
        res.invalid++;
        continue;
      }
      if (lead.contactEmail && lead.contactEmail !== email && !body.data.overwrite) {
        res.kept++;
        continue;
      }
      const source = http(item.source);
      const notes = withNotes(lead.notes, [source ? `Email ${email} trouvé sur ${source}` : null, ...links]);
      const row = await stores.leads.update(lead.id, { contactEmail: email, notes });
      if (row) res.leads.push(row);
      res.updated++;
    }
    return res;
  });

  app.patch("/api/leads/:id", async (request, reply) => {
    const body = z
      .object({
        status: z.enum(LEAD_STATUSES).optional(),
        notes: z.string().max(2000).nullable().optional(),
        contactEmail: z
          .string()
          .trim()
          .max(200)
          .refine((v) => v === "" || z.email().safeParse(v).success)
          .nullable()
          .optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "INVALID_BODY", message: "Adresse email invalide." });
    const data: { status?: LeadRow["status"]; notes?: string | null; contactEmail?: string | null } = {};
    if (body.data.status) data.status = body.data.status;
    if (body.data.notes !== undefined) data.notes = body.data.notes?.trim() || null;
    if (body.data.contactEmail !== undefined) data.contactEmail = body.data.contactEmail?.trim().toLowerCase() || null;
    const row = await stores.leads.update((request.params as { id: string }).id, data);
    if (!row) return reply.code(404).send({ error: "LEAD_NOT_FOUND" });
    return row;
  });
}
