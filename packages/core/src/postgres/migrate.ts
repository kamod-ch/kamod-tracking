import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const migrationFiles = [
  "001_tracking_schema.sql",
  "002_tracking_roles.sql",
  "003_aggregation_retention.sql",
  "004_aggregate_dimensions.sql",
  "005_retention_recompute_boundary.sql",
  "006_ops_outcome_metrics.sql",
] as const;

const resolveMigrationsDir = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const relative of ["../../migrations", "../migrations"]) {
    const candidate = join(here, relative);
    if (existsSync(join(candidate, migrationFiles[0]))) {
      return candidate;
    }
  }
  throw new Error(`Could not locate tracking SQL migrations near ${here}`);
};

const migrationsDir = resolveMigrationsDir();

export const readMigrationSql = (fileName: (typeof migrationFiles)[number]): string =>
  readFileSync(join(migrationsDir, fileName), "utf8");

export const applyTrackingMigrations = async (
  pool: Pick<Pool, "query">,
  options: { readonly includeRoles?: boolean } = {},
): Promise<void> => {
  const includeRoles = options.includeRoles ?? true;
  const files = includeRoles
    ? migrationFiles
    : migrationFiles.filter((name) => name !== "002_tracking_roles.sql");
  await files.reduce<Promise<void>>(async (previous, file) => {
    await previous;
    await pool.query(readMigrationSql(file));
  }, Promise.resolve());
};

export const resetTrackingSchema = async (client: PoolClient): Promise<void> => {
  await client.query("DROP SCHEMA IF EXISTS tracking CASCADE");
};
