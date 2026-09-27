import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Single-level on purpose: tests/integration/** needs a real, reachable SQL
    // Server and runs separately via `npm run test:integration` (see
    // vitest.integration.config.ts) so plain `npm test` stays portable and
    // dependency-free everywhere, per documentation/testing.md.
    include: ["tests/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
