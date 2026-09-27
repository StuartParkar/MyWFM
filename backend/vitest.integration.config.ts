import { defineConfig } from "vitest/config";

/**
 * Real-SQL-Server integration tests, run separately from `npm test` via
 * `npm run test:integration` - see documentation/testing.md. Requires
 * backend/.env to point at a reachable SQL Server; these tests migrate and
 * seed it themselves (both idempotent) before running.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
