import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

const migrationFiles = [
  "001_tracking_schema.sql",
  "002_tracking_roles.sql",
  "003_aggregation_retention.sql",
] as const;

export const readMigrationSql = (fileName: (typeof migrationFiles)[number]): string =>
  readFileSync(join(migrationsDir, fileName), "utf8");

export const applyTrackingMigrations = async (
  pool: Pick<Pool, "query">,
  options: { readonly includeRoles?: boolean } = {},
): Promise<void> => {
  const includeRoles = options.includeRoles ?? true;
  const files = includeRoles ? migrationFiles : [migrationFiles[0]];
  await files.reduce<Promise<void>>(async (previous, file) => {
    await previous;
    await pool.query(readMigrationSql(file));
  }, Promise.resolve());
};

export const resetTrackingSchema = async (client: PoolClient): Promise<void> => {
  await client.query("DROP SCHEMA IF EXISTS tracking CASCADE");
};
