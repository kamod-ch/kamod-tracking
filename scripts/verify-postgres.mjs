import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const databaseUrl = process.env.TRACKING_TEST_DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error(
    "verify:all requires TRACKING_TEST_DATABASE_URL (PostgreSQL integration is mandatory).\n" +
      "  docker compose -f docker-compose.tracking-test.yml up -d\n" +
      "  export TRACKING_TEST_DATABASE_URL='postgres://tracking:tracking@127.0.0.1:54329/tracking_test'\n" +
      "See docs/verify-matrix.md",
  );
  process.exit(1);
}

console.log("\n[verify:all] PostgreSQL integration tests");
execSync("pnpm test:postgres", { cwd: repoRoot, stdio: "inherit" });

console.log("\n[verify:all] collector-postgres example");
execSync("pnpm --filter @kamod-tracking/example-collector-postgres test", {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log("\n[verify:all] completed");
