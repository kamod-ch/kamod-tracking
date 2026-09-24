import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tests/postgres.integration.test.ts",
      "tests/postgres-aggregation.integration.test.ts",
      "tests/postgres-batch.integration.test.ts",
      "tests/postgres-aggregation-bucket.integration.test.ts",
      "tests/postgres-retention.integration.test.ts",
    ],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
});
