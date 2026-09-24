import type { Pool } from "pg";
import type { OpsMetric } from "../aggregation/types";
import type { BatchEventOutcome } from "../server/batch-contract";

export type OpsCounterIncrement = {
  readonly tenantId: string;
  readonly siteId: string;
  readonly metric: OpsMetric;
  readonly delta?: number;
  readonly rejectReason?: string;
  readonly schemaVersion?: number;
};

const ALLOWED_REJECT_BUCKETS = new Set([
  "invalid-payload",
  "unknown-event",
  "unknown-version",
  "version-retired",
  "producer-not-allowed",
  "consent-denied",
  "payload-too-large",
  "payload-conflict",
  "unknown-app",
  "unknown-site",
  "forbidden-producer-field",
  "pii-rejected",
  "queue-full",
  "event-expired",
  "consent-revoked",
  "destroyed",
]);

const bucketRejectReason = (reason: string): string =>
  ALLOWED_REJECT_BUCKETS.has(reason) ? reason : "other";

/** Low-cardinality counters — never pass event_id, session_id, client IP, or raw payloads as labels. */
export const incrementOpsCounter = async (
  pool: Pick<Pool, "query">,
  input: OpsCounterIncrement,
): Promise<void> => {
  const delta = input.delta ?? 1;
  await pool.query(
    `INSERT INTO tracking.ops_site_counters (
       tenant_id, site_id, metric, reject_reason, schema_version, counter
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, site_id, metric, reject_reason, schema_version)
     DO UPDATE SET counter = tracking.ops_site_counters.counter + EXCLUDED.counter,
                   updated_at = (now() AT TIME ZONE 'utc')`,
    [
      input.tenantId,
      input.siteId,
      input.metric,
      input.rejectReason ?? "",
      input.schemaVersion ?? 0,
      delta,
    ],
  );
};

/** Sets an absolute gauge-style counter (dirty backlog, lag seconds snapshot). */
export const setOpsGaugeCounter = async (
  pool: Pick<Pool, "query">,
  input: Omit<OpsCounterIncrement, "delta"> & { readonly value: number },
): Promise<void> => {
  await pool.query(
    `INSERT INTO tracking.ops_site_counters (
       tenant_id, site_id, metric, reject_reason, schema_version, counter
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, site_id, metric, reject_reason, schema_version)
     DO UPDATE SET counter = EXCLUDED.counter,
                   updated_at = (now() AT TIME ZONE 'utc')`,
    [
      input.tenantId,
      input.siteId,
      input.metric,
      input.rejectReason ?? "",
      input.schemaVersion ?? 0,
      Math.max(0, Math.floor(input.value)),
    ],
  );
};

export const recordBatchIngestOps = async (
  pool: Pick<Pool, "query">,
  scope: { readonly tenantId: string; readonly siteId: string },
  outcomes: readonly BatchEventOutcome[],
): Promise<void> => {
  for (const outcome of outcomes) {
    if (outcome.status === "accepted") {
      await incrementOpsCounter(pool, {
        ...scope,
        metric: outcome.duplicate ? "ingest_duplicate" : "ingest_accepted",
      });
      continue;
    }
    if (outcome.reason === "payload-conflict") {
      await incrementOpsCounter(pool, { ...scope, metric: "ingest_conflict" });
      continue;
    }
    await incrementOpsCounter(pool, {
      ...scope,
      metric: "ingest_rejected",
      rejectReason: bucketRejectReason(outcome.reason),
    });
  }
};

export const recordIngestStorageFailureOps = async (
  pool: Pick<Pool, "query">,
  scope: { readonly tenantId: string; readonly siteId: string },
  batchEventCount: number,
): Promise<void> => {
  if (batchEventCount > 0) {
    await incrementOpsCounter(pool, {
      ...scope,
      metric: "ingest_storage_failed",
      delta: batchEventCount,
    });
  }
  await incrementOpsCounter(pool, { ...scope, metric: "ingest_retry" });
};

export const recordQueueDiscardOps = async (
  pool: Pick<Pool, "query">,
  scope: { readonly tenantId: string; readonly siteId: string },
  reason: string,
): Promise<void> => {
  await incrementOpsCounter(pool, {
    ...scope,
    metric: "queue_discard",
    rejectReason: bucketRejectReason(reason),
  });
};

export const syncDirtyBacklogOps = async (
  pool: Pick<Pool, "query">,
  scope: { readonly tenantId: string; readonly siteId: string },
): Promise<number> => {
  const row = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM tracking.aggregate_dirty_days
     WHERE tenant_id = $1 AND site_id = $2`,
    [scope.tenantId, scope.siteId],
  );
  const value = Number(row.rows[0]?.count ?? 0);
  await setOpsGaugeCounter(pool, { ...scope, metric: "dirty_backlog", value });
  return value;
};

export const recordAggregateLagOps = async (
  pool: Pick<Pool, "query">,
  scope: { readonly tenantId: string; readonly siteId: string },
  lagSeconds: number,
): Promise<void> => {
  await setOpsGaugeCounter(pool, {
    ...scope,
    metric: "aggregate_lag_seconds",
    value: lagSeconds,
  });
};

export const recordRetentionRunOps = async (
  pool: Pick<Pool, "query">,
  scope: { readonly tenantId: string; readonly siteId: string },
): Promise<void> => {
  await incrementOpsCounter(pool, { ...scope, metric: "retention_run" });
};
