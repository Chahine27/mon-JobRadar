/**
 * Remplit la base avec le minimum pour démarrer :
 *  - ton compte (email + mot de passe du .env)
 *  - ton profil par défaut
 *  - la configuration des sources et des notifications
 * On peut le relancer sans risque : rien n'est dupliqué, ton profil existant n'est pas écrasé.
 */
import path from "node:path";
import { config } from "dotenv";
import { hash } from "@node-rs/argon2";
import { DEFAULT_PROFILE, ProfileSchema } from "@job-radar/shared";
import { createPrismaClient } from "../src/client";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const email = process.env.SEED_USER_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_USER_PASSWORD ?? "";

if (!email) throw new Error("SEED_USER_EMAIL manquant dans .env");
if (password.length < 12) {
  throw new Error("SEED_USER_PASSWORD manquant ou trop court dans .env (12 caractères minimum)");
}

const prisma = createPrismaClient();

async function main() {
  const profile = ProfileSchema.parse(DEFAULT_PROFILE);
  const passwordHash = await hash(password);

  const user = await prisma.user.upsert({
    where: { email: email! },
    update: { passwordHash },
    create: { email: email!, passwordHash },
  });

  await prisma.profile.upsert({
    where: { userId: user.id },
    update: {}, // ne jamais écraser un profil modifié depuis l'interface
    create: { userId: user.id, data: profile },
  });

  const sources = [
    { source: "france-travail", intervalMinutes: 30, enabled: true },
    { source: "adzuna", intervalMinutes: 60, enabled: false },
    { source: "company-careers", intervalMinutes: 30, enabled: false },
    { source: "jooble", intervalMinutes: 1440, enabled: false },
    ...["linkedin", "hellowork", "wttj", "indeed"].map((provider) => ({
      source: `jobscraper:${provider}`,
      intervalMinutes: 1440,
      enabled: false,
    })),
  ];
  for (const s of sources) {
    await prisma.sourceState.upsert({ where: { source: s.source }, update: {}, create: s });
  }

  await prisma.notificationSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", emailTo: process.env.NOTIFY_EMAIL_TO || email! },
  });

  console.log(`✔ Compte prêt : ${user.email}`);
  console.log(`✔ Profil, ${sources.length} sources et réglages de notification en place`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
