import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // All suites intentionally share one database/schema. Running test files in
    // parallel races schema resets/migrations and lets one suite erase another's data.
    fileParallelism: false,
    include: [
      "tests/postgres.integration.test.ts",
      "tests/postgres-aggregation.integration.test.ts",
      "tests/postgres-batch.integration.test.ts",
      "tests/postgres-aggregation-bucket.integration.test.ts",
      "tests/postgres-retention.integration.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["./tests/postgres-integration.setup.ts"],
  },
});
