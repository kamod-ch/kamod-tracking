const databaseUrl = process.env.TRACKING_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    "TRACKING_TEST_DATABASE_URL must be set for PostgreSQL integration tests. " +
      "Example: postgres://tracking:tracking@127.0.0.1:54329/tracking_test (see docs/postgres-adapter.md).",
  );
}

process.env.TRACKING_POSTGRES_TESTS_REQUIRED = "1";
