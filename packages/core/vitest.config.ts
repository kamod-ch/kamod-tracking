import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    exclude: process.env.TRACKING_TEST_DATABASE_URL
      ? ["**/node_modules/**", "**/dist/**"]
      : [
          "**/node_modules/**",
          "**/dist/**",
          "tests/postgres.integration.test.ts",
          "tests/postgres-aggregation.integration.test.ts",
        ],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
});
