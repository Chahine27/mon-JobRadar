// « prisma migrate dev » puis « prisma generate » : depuis Prisma 7, la migration ne régénère plus
// le client automatiquement, et le code ne voit pas les nouvelles tables sans cette 2ᵉ étape.
import { spawnSync } from "node:child_process";

const run = (args) => spawnSync("prisma", args, { stdio: "inherit", shell: true }).status ?? 1;

const code = run(["migrate", "dev", ...process.argv.slice(2)]);
process.exitCode = code !== 0 ? code : run(["generate"]);
