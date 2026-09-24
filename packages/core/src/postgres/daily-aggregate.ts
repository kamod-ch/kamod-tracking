import type { Pool, PoolClient } from "pg";
import {
  BUCKET_INSTANT_RULE_V1,
  DEFAULT_MAX_PRODUCER_SKEW_MS,
  expandCandidateUtcBounds,
  selectBucketInstant,
} from "../aggregation/bucket-timestamp";
import {
  canFullyRecomputeLocalDay,
  dayEndsBeforeRecomputeFloor,
} from "../aggregation/recompute-coverage";
import {
  enumerateLocalDates,
  formatLocalDate,
  localDayUtcBounds,
} from "../aggregation/time-bucketing";
import { resolveAllowlistedSurface } from "../aggregation/surface-dimension";
import type {
  AggregateRunResult,
  AggregateScopeKey,
  DailyCountAggregateJob,
} from "../aggregation/types";
import { DEFAULT_RECOMPUTE_FLOOR_EPOCH } from "../aggregation/recompute-coverage";

import {
  ensureRecomputeBoundaryRow,
  readCoverageGapDates,
  readRecomputeBoundary,
} from "./retention";
import { recordAggregateLagOps, syncDirtyBacklogOps } from "./ops-metrics";

export type RawWatermark = {
  readonly oldestReceivedAt: Date | undefined;
  readonly recomputeCompleteFromReceivedAt: Date;
};

const aggregateScopeKey = (
  job: DailyCountAggregateJob,
  localDate: string,
  bucketRuleVersion: string,
): AggregateScopeKey => ({
  tenantId: job.tenantId,
  siteId: job.siteId,
  purpose: job.purpose,
  timeZone: job.timeZone,
  localDate,
  aggregateRuleVersion: job.aggregateRuleVersion,
  bucketRuleVersion,
});

const scopeAdvisoryLockKeys = (
  scope: AggregateScopeKey,
): { readonly k1: number; readonly k2: number } => {
  const text = [
    scope.tenantId,
    scope.siteId,
    scope.purpose,
    scope.timeZone,
    scope.localDate,
    scope.aggregateRuleVersion,
    scope.bucketRuleVersion,
  ].join("\0");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  const k1 = hash;
  const k2 = (hash ^ 0x9e3779b9) | 0;
  return { k1, k2 };
};

export const readRawWatermark = async (
  pool: Pick<Pool, "query">,
  scope: Pick<DailyCountAggregateJob, "tenantId" | "siteId" | "purpose">,
): Promise<RawWatermark | undefined> => {
  const boundary = await readRecomputeBoundary(pool, scope);
  const row = await pool.query<{ oldest_received_at: Date | null }>(
    `SELECT oldest_received_at FROM tracking.raw_data_watermark
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3`,
    [scope.tenantId, scope.siteId, scope.purpose],
  );
  if (row.rowCount === 0) {
    return undefined;
  }
  return {
    recomputeCompleteFromReceivedAt: boundary.recomputeCompleteFromReceivedAt,
    oldestReceivedAt: boundary.oldestRemainingReceivedAt,
  };
};

export const upsertRawWatermark = async (
  client: PoolClient,
  scope: Pick<DailyCountAggregateJob, "tenantId" | "siteId" | "purpose">,
  oldestReceivedAt: Date,
): Promise<void> => {
  await ensureRecomputeBoundaryRow(client, scope);
  await client.query(
    `INSERT INTO tracking.raw_data_watermark (
       tenant_id, site_id, purpose, oldest_received_at, recompute_complete_from_received_at
     ) VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz)
     ON CONFLICT (tenant_id, site_id, purpose) DO UPDATE
       SET oldest_received_at = LEAST(
             COALESCE(tracking.raw_data_watermark.oldest_received_at, EXCLUDED.oldest_received_at),
             EXCLUDED.oldest_received_at
           ),
           updated_at = (now() AT TIME ZONE 'utc')`,
    [
      scope.tenantId,
      scope.siteId,
      scope.purpose,
      oldestReceivedAt.toISOString(),
      DEFAULT_RECOMPUTE_FLOOR_EPOCH.toISOString(),
    ],
  );
};

type CountBucket = {
  eventCount: number;
  sessions: Set<string>;
};

const recomputeOneLocalDay = async (
  client: PoolClient,
  job: DailyCountAggregateJob,
  localDate: string,
  maxSkewMs: number,
  bucketRuleVersion: string,
): Promise<number> => {
  const scope = aggregateScopeKey(job, localDate, bucketRuleVersion);
  const { k1, k2 } = scopeAdvisoryLockKeys(scope);
  await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [k1, k2]);

  const { startUtc, endUtc } = localDayUtcBounds(localDate, job.timeZone);
  const candidate = expandCandidateUtcBounds(startUtc, endUtc, maxSkewMs);
  const includeSessionCounts = job.collectionPolicyMode === "session";

  const dirtyRow = await client.query<{ dirty_generation: string }>(
    `SELECT dirty_generation FROM tracking.aggregate_dirty_days
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3
       AND local_date = $4::date AND time_zone = $5 AND aggregate_rule_version = $6
     FOR UPDATE`,
    [
      scope.tenantId,
      scope.siteId,
      scope.purpose,
      scope.localDate,
      scope.timeZone,
      scope.aggregateRuleVersion,
    ],
  );
  const dirtyGenerationAtStart = dirtyRow.rows[0]?.dirty_generation;

  await client.query(
    `DELETE FROM tracking.daily_aggregates
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3 AND local_date = $4::date
       AND time_zone = $5 AND aggregate_rule_version = $6 AND bucket_rule_version = $7`,
    [
      scope.tenantId,
      scope.siteId,
      scope.purpose,
      scope.localDate,
      scope.timeZone,
      scope.aggregateRuleVersion,
      scope.bucketRuleVersion,
    ],
  );

  const events = await client.query<{
    event_name: string;
    subject_object_type: string;
    subject_object_id: string | null;
    session_id: string | null;
    occurred_at: Date;
    received_at: Date;
    occurred_at_trust: "producer" | "adjusted";
    measurement_rule_version: string;
    collection_policy_version: string;
    payload: unknown;
  }>(
    `SELECT event_name, subject_object_type, subject_object_id, session_id,
            occurred_at, received_at, occurred_at_trust,
            measurement_rule_version, collection_policy_version, payload
     FROM tracking.events
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3
       AND (
         (received_at >= $4::timestamptz AND received_at < $5::timestamptz)
         OR (occurred_at >= $4::timestamptz AND occurred_at < $5::timestamptz)
       )`,
    [
      job.tenantId,
      job.siteId,
      job.purpose,
      candidate.startUtc.toISOString(),
      candidate.endUtc.toISOString(),
    ],
  );

  const counts = new Map<string, CountBucket>();
  for (const row of events.rows) {
    const bucketInstant = selectBucketInstant({
      occurredAt: row.occurred_at,
      receivedAt: row.received_at,
      occurredAtTrust: row.occurred_at_trust,
      maxProducerSkewMs: maxSkewMs,
    });
    const bucketDate = formatLocalDate(bucketInstant, job.timeZone);
    if (bucketDate !== localDate) {
      continue;
    }
    const surface = resolveAllowlistedSurface(row.payload, job.allowedSurfaces);
    const key = [
      row.measurement_rule_version,
      row.collection_policy_version,
      surface,
      row.event_name,
      row.subject_object_type,
      row.subject_object_id ?? "",
    ].join("\0");
    const entry = counts.get(key) ?? { eventCount: 0, sessions: new Set() };
    entry.eventCount += 1;
    if (includeSessionCounts && row.session_id) {
      entry.sessions.add(row.session_id);
    }
    counts.set(key, entry);
  }

  let written = 0;
  const computedAt = new Date().toISOString();
  for (const [key, value] of counts) {
    const [
      measurementRuleVersion,
      collectionPolicyVersion,
      surface,
      eventName,
      subjectType,
      subjectId,
    ] = key.split("\0");
    await client.query(
      `INSERT INTO tracking.daily_aggregates (
         tenant_id, site_id, purpose, local_date, time_zone,
         aggregate_rule_version, bucket_rule_version,
         measurement_rule_version, collection_policy_version, surface,
         event_name, subject_object_type, subject_object_id,
         event_count, session_count, computed_at
       ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz)`,
      [
        scope.tenantId,
        scope.siteId,
        scope.purpose,
        scope.localDate,
        scope.timeZone,
        scope.aggregateRuleVersion,
        scope.bucketRuleVersion,
        measurementRuleVersion,
        collectionPolicyVersion,
        surface,
        eventName,
        subjectType,
        subjectId,
        value.eventCount,
        includeSessionCounts ? value.sessions.size : null,
        computedAt,
      ],
    );
    written += 1;
  }

  if (dirtyGenerationAtStart !== undefined) {
    await client.query(
      `DELETE FROM tracking.aggregate_dirty_days
       WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3
         AND local_date = $4::date AND time_zone = $5 AND aggregate_rule_version = $6
         AND dirty_generation = $7`,
      [
        scope.tenantId,
        scope.siteId,
        scope.purpose,
        scope.localDate,
        scope.timeZone,
        scope.aggregateRuleVersion,
        dirtyGenerationAtStart,
      ],
    );
  }

  return written;
};

/**
 * Replaces aggregates for each local day in range atomically per day. Idempotent.
 * Skips days before raw watermark without deleting existing aggregate rows.
 */
export const runDailyCountAggregate = async (
  pool: Pick<Pool, "connect" | "query">,
  job: DailyCountAggregateJob,
): Promise<AggregateRunResult> => {
  const maxSkewMs = job.maxProducerSkewMs ?? DEFAULT_MAX_PRODUCER_SKEW_MS;
  const bucketRuleVersion = job.bucketRuleVersion ?? BUCKET_INSTANT_RULE_V1;
  const boundary = await readRecomputeBoundary(pool, job);
  const gapDates = await readCoverageGapDates(pool, {
    tenantId: job.tenantId,
    siteId: job.siteId,
    purpose: job.purpose,
    timeZone: job.timeZone,
    localDateFrom: job.localDateFrom,
    localDateTo: job.localDateTo,
  });
  const dates = enumerateLocalDates(job.localDateFrom, job.localDateTo);
  let daysProcessed = 0;
  let daysSkippedOutsideRaw = 0;
  let daysSkippedIncompleteCoverage = 0;
  let rowsWritten = 0;
  let daysStillDirty = 0;

  const client = await pool.connect();
  try {
    for (const localDate of dates) {
      if (
        dayEndsBeforeRecomputeFloor(
          localDate,
          job.timeZone,
          boundary.recomputeCompleteFromReceivedAt,
        )
      ) {
        daysSkippedOutsideRaw += 1;
        continue;
      }
      if (
        !canFullyRecomputeLocalDay({
          localDate,
          timeZone: job.timeZone,
          recomputeCompleteFromReceivedAt: boundary.recomputeCompleteFromReceivedAt,
          maxProducerSkewMs: maxSkewMs,
          gapDates,
        })
      ) {
        daysSkippedIncompleteCoverage += 1;
        continue;
      }
      await client.query("BEGIN");
      try {
        rowsWritten += await recomputeOneLocalDay(
          client,
          job,
          localDate,
          maxSkewMs,
          bucketRuleVersion,
        );
        const stillDirty = await client.query(
          `SELECT 1 FROM tracking.aggregate_dirty_days
           WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3
             AND local_date = $4::date AND time_zone = $5 AND aggregate_rule_version = $6`,
          [
            job.tenantId,
            job.siteId,
            job.purpose,
            localDate,
            job.timeZone,
            job.aggregateRuleVersion,
          ],
        );
        if ((stillDirty.rowCount ?? 0) > 0) {
          daysStillDirty += 1;
        }
        await client.query("COMMIT");
        daysProcessed += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }

  const dirtyBacklog = await syncDirtyBacklogOps(pool, {
    tenantId: job.tenantId,
    siteId: job.siteId,
  });
  const lagRow = await pool.query<{ lag_seconds: string }>(
    `SELECT COALESCE(
       EXTRACT(EPOCH FROM (
         (now() AT TIME ZONE 'utc') - MIN(marked_at)
       ))::bigint,
       0
     )::text AS lag_seconds
     FROM tracking.aggregate_dirty_days
     WHERE tenant_id = $1 AND site_id = $2`,
    [job.tenantId, job.siteId],
  );
  await recordAggregateLagOps(
    pool,
    {
      tenantId: job.tenantId,
      siteId: job.siteId,
    },
    Number(lagRow.rows[0]?.lag_seconds ?? 0),
  );
  void dirtyBacklog;

  return {
    daysProcessed,
    daysSkippedOutsideRaw,
    daysSkippedIncompleteCoverage,
    rowsWritten,
    daysStillDirty,
    recomputeCompleteFromReceivedAt: boundary.recomputeCompleteFromReceivedAt.toISOString(),
  };
};

export const markAggregateDirtyDay = async (
  pool: Pick<Pool, "query">,
  input: {
    readonly tenantId: string;
    readonly siteId: string;
    readonly purpose: DailyCountAggregateJob["purpose"];
    readonly localDate: string;
    readonly timeZone: string;
    readonly aggregateRuleVersion: string;
    readonly reason: "late_event" | "manual" | "purge_adjustment";
  },
): Promise<void> => {
  await pool.query(
    `INSERT INTO tracking.aggregate_dirty_days (
       tenant_id, site_id, purpose, local_date, time_zone, aggregate_rule_version, reason, dirty_generation
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,1)
     ON CONFLICT (tenant_id, site_id, purpose, local_date, time_zone, aggregate_rule_version) DO UPDATE
       SET reason = EXCLUDED.reason,
           marked_at = (now() AT TIME ZONE 'utc'),
           dirty_generation = tracking.aggregate_dirty_days.dirty_generation + 1`,
    [
      input.tenantId,
      input.siteId,
      input.purpose,
      input.localDate,
      input.timeZone,
      input.aggregateRuleVersion,
      input.reason,
    ],
  );
};

export const readDirtyGeneration = async (
  pool: Pick<Pool, "query">,
  input: {
    readonly tenantId: string;
    readonly siteId: string;
    readonly purpose: DailyCountAggregateJob["purpose"];
    readonly localDate: string;
    readonly timeZone: string;
    readonly aggregateRuleVersion: string;
  },
): Promise<number | undefined> => {
  const row = await pool.query<{ dirty_generation: string }>(
    `SELECT dirty_generation FROM tracking.aggregate_dirty_days
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3
       AND local_date = $4::date AND time_zone = $5 AND aggregate_rule_version = $6`,
    [
      input.tenantId,
      input.siteId,
      input.purpose,
      input.localDate,
      input.timeZone,
      input.aggregateRuleVersion,
    ],
  );
  const value = row.rows[0]?.dirty_generation;
  return value !== undefined ? Number(value) : undefined;
};
