import { defineConfig } from "vitest/config";

/** Tests d'intégration : vraie base PostgreSQL (jobradar_test). Lancer avec « pnpm test:int ». */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.int.test.ts", "apps/*/src/**/*.int.test.ts"],
    globalSetup: ["packages/db/test/global-setup.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
