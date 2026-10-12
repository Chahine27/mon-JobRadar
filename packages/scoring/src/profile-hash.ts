import { createHash } from "node:crypto";
import type { Profile } from "@job-radar/shared";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Empreinte du profil : si elle change, les scores doivent être recalculés. */
export function hashProfile(profile: Profile): string {
  return createHash("sha256").update(JSON.stringify(stable(profile))).digest("hex").slice(0, 16);
}
