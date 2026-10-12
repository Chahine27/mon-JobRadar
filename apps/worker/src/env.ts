import path from "node:path";
import { config } from "dotenv";
import { AdzunaSource, FranceTravailSource, JoobleSource, createJobScraperSources, type JoobleQuotaStore } from "@job-radar/source-connectors";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

export function franceTravailFromEnv() {
  return new FranceTravailSource({
    clientId: process.env.FRANCE_TRAVAIL_CLIENT_ID?.trim(),
    clientSecret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET?.trim(),
  });
}

export function adzunaFromEnv() {
  return new AdzunaSource({ appId: process.env.ADZUNA_APP_ID?.trim(), appKey: process.env.ADZUNA_APP_KEY?.trim() });
}

export function joobleFromEnv(quota: JoobleQuotaStore) {
  return new JoobleSource({ apiKey: process.env.JOOBLE_API_KEY?.trim(), quota });
}

export function jobScraperFromEnv(enabled = process.env.JOBSCRAPER_ENABLED?.trim() === "true") {
  return createJobScraperSources({
    enabled,
    ...(process.env.JOBSCRAPER_PATH?.trim() ? { path: process.env.JOBSCRAPER_PATH.trim() } : {}),
    ...(process.env.JOBSCRAPER_PYTHON?.trim() ? { python: process.env.JOBSCRAPER_PYTHON.trim() } : {}),
    // Valeur invalide ou trop courte : délai par défaut du connecteur (comme la validation de l'API).
    ...(Number(process.env.JOBSCRAPER_TIMEOUT_MS) >= 1000 ? { timeoutMs: Number(process.env.JOBSCRAPER_TIMEOUT_MS) } : {}),
  });
}
