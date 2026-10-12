/**
 * Crée les clés des notifications navigateur (VAPID) et les écrit dans .env.
 * Ne remplace jamais des clés déjà présentes.
 *   pnpm setup:push
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateVapidKeys } from "@job-radar/notifications";

const envPath = path.resolve(import.meta.dirname, "../../../.env");
let content = readFileSync(envPath, "utf8");
const eol = content.includes("\r\n") ? "\r\n" : "\n";

const has = (key: string) => new RegExp(`^${key}=\\S+`, "m").test(content);
if (has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY")) {
  console.log("✔ Les clés VAPID existent déjà dans .env : rien à faire.");
  process.exit(0);
}

const keys = generateVapidKeys();
const set = (key: string, value: string) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  content = re.test(content) ? content.replace(re, `${key}=${value}`) : `${content.replace(/\s*$/, "")}${eol}${key}=${value}${eol}`;
};
if (!/^# --- Notifications navigateur/m.test(content)) {
  content = `${content.replace(/\s*$/, "")}${eol}${eol}# --- Notifications navigateur (générées par pnpm setup:push) ---${eol}`;
}
set("VAPID_PUBLIC_KEY", keys.publicKey);
set("VAPID_PRIVATE_KEY", keys.privateKey);
writeFileSync(envPath, content);
console.log("✔ Clés VAPID ajoutées à .env. Relance « pnpm dev » pour les prendre en compte.");
