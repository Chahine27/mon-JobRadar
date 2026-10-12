import { describe, expect, it } from "vitest";
import { createPrismaClient } from "./client";

describe("createPrismaClient", () => {
  it("refuse de démarrer sans DATABASE_URL", () => {
    expect(() => createPrismaClient("")).toThrow(/DATABASE_URL/);
  });
});
