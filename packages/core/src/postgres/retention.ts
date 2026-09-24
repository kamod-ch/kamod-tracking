import type { Pool, PoolClient } from "pg";
import type { Purpose } from "../core/types";
import {
  DEFAULT_RECOMPUTE_FLOOR_EPOCH,
  localDatesAtRetentionCutoff,
  type RawRecomputeBoundary,
} from "../aggregation/recompute-coverage";
import type { SiteRetentionPolicy } from "../aggregation/types";
import { recordRetentionRunOps } from "./ops-metrics";

export const SUPPORTED_CLIENT_RETRY_HORIZON_DAYS = 30;
export const MIN_INBOX_RETENTION_DAYS = SUPPORTED_CLIENT_RETRY_HORIZON_DAYS;
export const DEFAULT_RAW_DELETE_BATCH_SIZE = 2_000;
export const DEFAULT_INBOX_DELETE_BATCH_SIZE = 2_000;
export const DEFAULT_AGGREGATE_DELETE_BATCH_SIZE = 5_000;

export type RetentionValidationIssue = {
  readonly field: "rawRetentionDays" | "inboxRetentionDays" | "aggregateRetentionDays";
  readonly message: string;
};

export const validateSiteRetentionPolicy = (
  policy: SiteRetentionPolicy,
): readonly RetentionValidationIssue[] => {
  const issues: RetentionValidationIssue[] = [];
  if (policy.rawRetentionDays !== null && policy.rawRetentionDays < 1) {
    issues.push({
      field: "rawRetentionDays",
      message: "rawRetentionDays must be at least 1 when set",
    });
  }
  if (policy.inboxRetentionDays !== null && policy.inboxRetentionDays < MIN_INBOX_RETENTION_DAYS) {
    issues.push({
      field: "inboxRetentionDays",
      message: `inboxRetentionDays must be at least ${MIN_INBOX_RETENTION_DAYS} (supported client retry/replay horizon)`,
    });
  }
  if (policy.aggregateRetentionDays !== null && policy.aggregateRetentionDays < 1) {
    issues.push({
      field: "aggregateRetentionDays",
      message: "aggregateRetentionDays must be at least 1 when set",
    });
  }
  return issues;
};

export type RetentionRunOptions = {
  readonly policy: SiteRetentionPolicy;
  readonly now?: Date;
  /** IANA zone used to mark partial civil days after raw purge. */
  readonly timeZoneForCoverage?: string;
  readonly rawDeleteBatchSize?: number;
  readonly inboxDeleteBatchSize?: number;
  readonly aggregateDeleteBatchSize?: number;
  readonly resumeFromCheckpoint?: boolean;
};

export type RetentionRunResult = {
  readonly eventsDeleted: number;
  readonly inboxDeleted: number;
  readonly aggregatesDeleted: number;
  readonly recomputeCompleteFromReceivedAt: string | undefined;
  readonly coverageGapsMarked: number;
  readonly validationIssues: readonly RetentionValidationIssue[];
  readonly status: "completed" | "rejected_invalid_policy";
};

const retentionAdvisoryLockKeys = (scope: {
  tenantId: string;
  siteId: string;
  purpose: Purpose;
}): { readonly k1: number; readonly k2: number } => {
  const text = `retention:${scope.tenantId}:${scope.siteId}:${scope.purpose}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return { k1: hash, k2: (hash ^ 0x85ebca6b) | 0 };
};

export const readRecomputeBoundary = async (
  pool: Pick<Pool, "query">,
  scope: Pick<SiteRetentionPolicy, "tenantId" | "siteId" | "purpose">,
): Promise<RawRecomputeBoundary> => {
  const row = await pool.query<{
    recompute_complete_from_received_at: Date;
    oldest_received_at: Date | null;
  }>(
    `SELECT recompute_complete_from_received_at, oldest_received_at
     FROM tracking.raw_data_watermark
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3`,
    [scope.tenantId, scope.siteId, scope.purpose],
  );
  const found = row.rows[0];
  if (!found) {
    return {
      recomputeCompleteFromReceivedAt: DEFAULT_RECOMPUTE_FLOOR_EPOCH,
      oldestRemainingReceivedAt: undefined,
    };
  }
  return {
    recomputeCompleteFromReceivedAt: found.recompute_complete_from_received_at,
    oldestRemainingReceivedAt: found.oldest_received_at ?? undefined,
  };
};

export const ensureRecomputeBoundaryRow = async (
  client: PoolClient,
  scope: Pick<SiteRetentionPolicy, "tenantId" | "siteId" | "purpose">,
): Promise<void> => {
  await client.query(
    `INSERT INTO tracking.raw_data_watermark (
       tenant_id, site_id, purpose, oldest_received_at, recompute_complete_from_received_at
     ) VALUES ($1,$2,$3,NULL,$4::timestamptz)
     ON CONFLICT (tenant_id, site_id, purpose) DO NOTHING`,
    [scope.tenantId, scope.siteId, scope.purpose, DEFAULT_RECOMPUTE_FLOOR_EPOCH.toISOString()],
  );
};

export const syncOldestRemainingHint = async (
  client: PoolClient,
  scope: Pick<SiteRetentionPolicy, "tenantId" | "siteId" | "purpose">,
): Promise<void> => {
  await ensureRecomputeBoundaryRow(client, scope);
  await client.query(
    `UPDATE tracking.raw_data_watermark w
     SET oldest_received_at = sub.oldest,
         updated_at = (now() AT TIME ZONE 'utc')
     FROM (
       SELECT MIN(received_at) AS oldest FROM tracking.events
       WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3
     ) sub
     WHERE w.tenant_id = $1 AND w.site_id = $2 AND w.purpose = $3`,
    [scope.tenantId, scope.siteId, scope.purpose],
  );
};

export const advanceRecomputeFloorAfterPurge = async (
  client: PoolClient,
  scope: Pick<SiteRetentionPolicy, "tenantId" | "siteId" | "purpose">,
  purgeCutoff: Date,
  timeZoneForCoverage: string | undefined,
): Promise<number> => {
  await ensureRecomputeBoundaryRow(client, scope);
  await client.query(
    `UPDATE tracking.raw_data_watermark
     SET recompute_complete_from_received_at = GREATEST(
           recompute_complete_from_received_at,
           $4::timestamptz
         ),
         updated_at = (now() AT TIME ZONE 'utc')
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3`,
    [scope.tenantId, scope.siteId, scope.purpose, purgeCutoff.toISOString()],
  );
  await syncOldestRemainingHint(client, scope);

  if (!timeZoneForCoverage) {
    return 0;
  }
  let marked = 0;
  for (const localDate of localDatesAtRetentionCutoff(purgeCutoff, timeZoneForCoverage)) {
    await client.query(
      `INSERT INTO tracking.raw_coverage_gaps (
         tenant_id, site_id, purpose, time_zone, local_date, reason
       ) VALUES ($1,$2,$3,$4,$5::date,'retention_partial')
       ON CONFLICT DO NOTHING`,
      [scope.tenantId, scope.siteId, scope.purpose, timeZoneForCoverage, localDate],
    );
    marked += 1;
  }
  return marked;
};

const upsertCheckpoint = async (
  client: PoolClient,
  scope: Pick<SiteRetentionPolicy, "tenantId" | "siteId" | "purpose">,
  phase: "raw_events" | "inbox" | "aggregates",
  lastCutoff: Date | null,
): Promise<void> => {
  await client.query(
    `INSERT INTO tracking.retention_purge_checkpoint (tenant_id, site_id, purpose, phase, last_cutoff)
     VALUES ($1,$2,$3,$4,$5::timestamptz)
     ON CONFLICT (tenant_id, site_id, purpose, phase) DO UPDATE
       SET last_cutoff = EXCLUDED.last_cutoff,
           updated_at = (now() AT TIME ZONE 'utc')`,
    [scope.tenantId, scope.siteId, scope.purpose, phase, lastCutoff?.toISOString() ?? null],
  );
};

const clearCheckpoint = async (
  client: PoolClient,
  scope: Pick<SiteRetentionPolicy, "tenantId" | "siteId" | "purpose">,
  phase: "raw_events" | "inbox" | "aggregates",
): Promise<void> => {
  await client.query(
    `DELETE FROM tracking.retention_purge_checkpoint
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3 AND phase = $4`,
    [scope.tenantId, scope.siteId, scope.purpose, phase],
  );
};

export const readCoverageGapDates = async (
  pool: Pick<Pool, "query">,
  input: {
    readonly tenantId: string;
    readonly siteId: string;
    readonly purpose: Purpose;
    readonly timeZone: string;
    readonly localDateFrom: string;
    readonly localDateTo: string;
  },
): Promise<ReadonlySet<string>> => {
  const rows = await pool.query<{ local_date: string }>(
    `SELECT local_date::text AS local_date FROM tracking.raw_coverage_gaps
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3 AND time_zone = $4
       AND local_date >= $5::date AND local_date <= $6::date`,
    [
      input.tenantId,
      input.siteId,
      input.purpose,
      input.timeZone,
      input.localDateFrom,
      input.localDateTo,
    ],
  );
  return new Set(rows.rows.map((row) => row.local_date.slice(0, 10)));
};

export const runPurposeRetention = async (
  pool: Pick<Pool, "connect" | "query">,
  options: RetentionRunOptions,
): Promise<RetentionRunResult> => {
  const policy = options.policy;
  const validationIssues = validateSiteRetentionPolicy(policy);
  if (validationIssues.length > 0) {
    return {
      eventsDeleted: 0,
      inboxDeleted: 0,
      aggregatesDeleted: 0,
      recomputeCompleteFromReceivedAt: undefined,
      coverageGapsMarked: 0,
      validationIssues,
      status: "rejected_invalid_policy",
    };
  }

  const now = options.now ?? new Date();
  const rawBatch = options.rawDeleteBatchSize ?? DEFAULT_RAW_DELETE_BATCH_SIZE;
  const inboxBatch = options.inboxDeleteBatchSize ?? DEFAULT_INBOX_DELETE_BATCH_SIZE;
  const aggregateBatch = options.aggregateDeleteBatchSize ?? DEFAULT_AGGREGATE_DELETE_BATCH_SIZE;
  const timeZoneForCoverage = options.timeZoneForCoverage;

  let eventsDeleted = 0;
  let inboxDeleted = 0;
  let aggregatesDeleted = 0;
  let coverageGapsMarked = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { k1, k2 } = retentionAdvisoryLockKeys(policy);
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [k1, k2]);

    if (policy.rawRetentionDays !== null && policy.rawRetentionDays > 0) {
      const cutoff = daysAgoUtc(policy.rawRetentionDays, now);
      await upsertCheckpoint(client, policy, "raw_events", cutoff);
      for (;;) {
        const deleted = await client.query(
          `DELETE FROM tracking.events e
           WHERE e.ctid IN (
             SELECT ctid FROM tracking.events
             WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3 AND received_at < $4::timestamptz
             LIMIT $5
           )`,
          [policy.tenantId, policy.siteId, policy.purpose, cutoff.toISOString(), rawBatch],
        );
        const count = deleted.rowCount ?? 0;
        eventsDeleted += count;
        if (count < rawBatch) {
          break;
        }
      }
      coverageGapsMarked += await advanceRecomputeFloorAfterPurge(
        client,
        policy,
        cutoff,
        timeZoneForCoverage,
      );
      await clearCheckpoint(client, policy, "raw_events");
    }

    if (policy.inboxRetentionDays !== null && policy.inboxRetentionDays > 0) {
      const cutoff = daysAgoUtc(policy.inboxRetentionDays, now);
      await upsertCheckpoint(client, policy, "inbox", cutoff);
      for (;;) {
        const deleted = await client.query(
          `DELETE FROM tracking.event_inbox i
           WHERE i.ctid IN (
             SELECT ctid FROM tracking.event_inbox
             WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3
               AND first_received_at < $4::timestamptz
             LIMIT $5
           )`,
          [policy.tenantId, policy.siteId, policy.purpose, cutoff.toISOString(), inboxBatch],
        );
        const count = deleted.rowCount ?? 0;
        inboxDeleted += count;
        if (count < inboxBatch) {
          break;
        }
      }
      await clearCheckpoint(client, policy, "inbox");
    }

    if (policy.aggregateRetentionDays !== null && policy.aggregateRetentionDays > 0) {
      const cutoffDate = formatUtcDate(daysAgoUtc(policy.aggregateRetentionDays, now));
      await upsertCheckpoint(client, policy, "aggregates", null);
      for (;;) {
        const deleted = await client.query(
          `DELETE FROM tracking.daily_aggregates a
           WHERE a.ctid IN (
             SELECT ctid FROM tracking.daily_aggregates
             WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3 AND local_date < $4::date
             LIMIT $5
           )`,
          [policy.tenantId, policy.siteId, policy.purpose, cutoffDate, aggregateBatch],
        );
        const count = deleted.rowCount ?? 0;
        aggregatesDeleted += count;
        if (count < aggregateBatch) {
          break;
        }
      }
      await clearCheckpoint(client, policy, "aggregates");
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const boundary = await readRecomputeBoundary(pool, policy);
  await recordRetentionRunOps(pool, {
    tenantId: policy.tenantId,
    siteId: policy.siteId,
  });
  return {
    eventsDeleted,
    inboxDeleted,
    aggregatesDeleted,
    recomputeCompleteFromReceivedAt: boundary.recomputeCompleteFromReceivedAt.toISOString(),
    coverageGapsMarked,
    validationIssues: [],
    status: "completed",
  };
};

const daysAgoUtc = (days: number, now: Date): Date =>
  new Date(now.getTime() - days * 24 * 60 * 60_000);

const formatUtcDate = (instant: Date): string => instant.toISOString().slice(0, 10);

/** @deprecated Use syncOldestRemainingHint after ingest; never deletes the boundary row. */
export const refreshRawWatermark = syncOldestRemainingHint;
