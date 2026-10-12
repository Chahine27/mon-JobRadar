import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Le .env est à la racine du monorepo.
config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Pas d'erreur si absent : `prisma generate` n'en a pas besoin.
    url: process.env.DATABASE_URL ?? "",
  },
});
