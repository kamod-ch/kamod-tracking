import { Pool } from "pg";
import { afterAll, beforeAll } from "vitest";
import { applyTrackingMigrations, resetTrackingSchema } from "../src/postgres/migrate";

let pool: Pool | undefined;

export const postgresPool = (): Pool => {
  if (!pool) {
    throw new Error("PostgreSQL test pool is not initialized.");
  }
  return pool;
};

export const resetPostgresTestData = async (): Promise<void> => {
  await postgresPool().query(
    "TRUNCATE TABLE tracking.tenants, tracking.aggregate_dirty_days CASCADE",
  );
};

export const registerPostgresIntegrationHooks = (): void => {
  beforeAll(async () => {
    const databaseUrl = process.env.TRACKING_TEST_DATABASE_URL?.trim();
    if (!databaseUrl) {
      throw new Error(
        "TRACKING_TEST_DATABASE_URL is required (see docs/postgres-adapter.md and pnpm test:postgres).",
      );
    }
    const candidate = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 4_000,
    });
    const client = await candidate.connect();
    try {
      await client.query("SELECT 1");
      await resetTrackingSchema(client);
    } finally {
      client.release();
    }
    await applyTrackingMigrations(candidate, { includeRoles: false });
    pool = candidate;
  }, 20_000);

  afterAll(async () => {
    await pool?.end();
    pool = undefined;
  });
};
