const databaseUrl = process.env.TRACKING_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(
    "TRACKING_TEST_DATABASE_URL must be set for pnpm test:postgres.\n" +
      "Example: postgres://tracking:tracking@127.0.0.1:54329/tracking_test\n" +
      "See docs/postgres-adapter.md and docker-compose.tracking-test.yml.",
  );
  process.exit(1);
}
