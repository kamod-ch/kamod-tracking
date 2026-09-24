import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
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
