import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "extension/**/*.test.js"],
    // Les tests d'intégration (base réelle) se lancent à part : pnpm test:int
    exclude: ["**/*.int.test.ts", "**/node_modules/**"],
    environment: "node",
  },
});
