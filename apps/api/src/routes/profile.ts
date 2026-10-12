import { ProfileSchema } from "@job-radar/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth";
import type { Stores } from "../stores";

const HomeSchema = z.object({
  label: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const PutProfileBody = z.object({
  profile: ProfileSchema,
  /** absent = inchangé, null = effacé */
  home: HomeSchema.nullable().optional(),
});

export type Geocoder = (query: string) => Promise<Array<{ label: string; lat: number; lng: number; precision: string }>>;

export async function profileRoutes(app: FastifyInstance, opts: { stores: Stores; geocoder?: Geocoder }) {
  const { stores } = opts;

  // Recherche d'adresse pour le point de départ (Géoplateforme, adresse fixe : pas de SSRF).
  app.get(
    "/api/geocode",
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const q = z.object({ q: z.string().trim().min(3).max(200) }).safeParse(request.query);
      if (!q.success) return reply.code(400).send({ error: "INVALID_QUERY" });
      if (!opts.geocoder) return reply.code(503).send({ error: "GEOCODER_UNAVAILABLE" });
      try {
        return { items: await opts.geocoder(q.data.q) };
      } catch {
        return reply.code(502).send({ error: "GEOCODER_FAILED", message: "Service d'adresses injoignable, réessaie plus tard." });
      }
    },
  );

  app.get("/api/profile", { preHandler: requireAuth }, async (request, reply) => {
    const record = await stores.profiles.get(request.userId!);
    if (!record) return reply.code(404).send({ error: "PROFILE_NOT_FOUND" });
    return record;
  });

  app.put("/api/profile", { preHandler: requireAuth }, async (request, reply) => {
    const body = PutProfileBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "INVALID_PROFILE",
        issues: body.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return stores.profiles.save(request.userId!, body.data.profile, body.data.home);
  });
}
