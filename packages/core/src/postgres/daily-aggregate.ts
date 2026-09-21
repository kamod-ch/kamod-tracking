import type { Pool, PoolClient } from "pg";
import { DEFAULT_MAX_PRODUCER_SKEW_MS, selectBucketInstant } from "../aggregation/bucket-timestamp";
import {
  enumerateLocalDates,
  formatLocalDate,
  localDayUtcBounds,
} from "../aggregation/time-bucketing";
import type { AggregateRunResult, DailyCountAggregateJob } from "../aggregation/types";

export type RawWatermark = {
  readonly oldestReceivedAt: Date;
};

export const readRawWatermark = async (
  pool: Pick<Pool, "query">,
  scope: Pick<DailyCountAggregateJob, "tenantId" | "siteId" | "purpose">,
): Promise<RawWatermark | undefined> => {
  const result = await pool.query<{ oldest_received_at: Date }>(
    `SELECT oldest_received_at FROM tracking.raw_data_watermark
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3`,
    [scope.tenantId, scope.siteId, scope.purpose],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  return { oldestReceivedAt: row.oldest_received_at };
};

export const upsertRawWatermark = async (
  client: PoolClient,
  scope: Pick<DailyCountAggregateJob, "tenantId" | "siteId" | "purpose">,
  oldestReceivedAt: Date,
): Promise<void> => {
  await client.query(
    `INSERT INTO tracking.raw_data_watermark (tenant_id, site_id, purpose, oldest_received_at)
     VALUES ($1, $2, $3, $4::timestamptz)
     ON CONFLICT (tenant_id, site_id, purpose) DO UPDATE
       SET oldest_received_at = LEAST(tracking.raw_data_watermark.oldest_received_at, EXCLUDED.oldest_received_at),
           updated_at = (now() AT TIME ZONE 'utc')`,
    [scope.tenantId, scope.siteId, scope.purpose, oldestReceivedAt.toISOString()],
  );
};

const recomputeOneLocalDay = async (
  client: PoolClient,
  job: DailyCountAggregateJob,
  localDate: string,
  maxSkewMs: number,
): Promise<number> => {
  const { startUtc, endUtc } = localDayUtcBounds(localDate, job.timeZone);
  const includeSessionCounts = job.collectionPolicyMode === "session";

  await client.query(
    `DELETE FROM tracking.daily_aggregates
     WHERE tenant_id = $1 AND site_id = $2 AND local_date = $3::date
       AND time_zone = $4 AND aggregate_rule_version = $5`,
    [job.tenantId, job.siteId, localDate, job.timeZone, job.aggregateRuleVersion],
  );

  const events = await client.query<{
    event_name: string;
    subject_object_type: string;
    subject_object_id: string | null;
    session_id: string | null;
    occurred_at: Date;
    received_at: Date;
    occurred_at_trust: "producer" | "adjusted";
  }>(
    `SELECT event_name, subject_object_type, subject_object_id, session_id,
            occurred_at, received_at, occurred_at_trust
     FROM tracking.events
     WHERE tenant_id = $1 AND site_id = $2 AND purpose = $3
       AND received_at >= $4::timestamptz AND received_at < $5::timestamptz`,
    [job.tenantId, job.siteId, job.purpose, startUtc.toISOString(), endUtc.toISOString()],
  );

  type Key = string;
  const counts = new Map<Key, { eventCount: number; sessions: Set<string> }>();
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
    const key = `${row.event_name}\0${row.subject_object_type}\0${row.subject_object_id ?? ""}`;
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
    const [eventName, subjectType, subjectIdRaw] = key.split("\0");
    const subjectId = subjectIdRaw ?? "";
    await client.query(
      `INSERT INTO tracking.daily_aggregates (
         tenant_id, site_id, local_date, time_zone, aggregate_rule_version,
         event_name, subject_object_type, subject_object_id,
         event_count, session_count, computed_at
       ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)`,
      [
        job.tenantId,
        job.siteId,
        localDate,
        job.timeZone,
        job.aggregateRuleVersion,
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
  const watermark = await readRawWatermark(pool, job);
  const dates = enumerateLocalDates(job.localDateFrom, job.localDateTo);
  let daysProcessed = 0;
  let daysSkippedOutsideRaw = 0;
  let rowsWritten = 0;

  const client = await pool.connect();
  try {
    for (const localDate of dates) {
      const { endUtc } = localDayUtcBounds(localDate, job.timeZone);
      if (watermark && endUtc < watermark.oldestReceivedAt) {
        daysSkippedOutsideRaw += 1;
        continue;
      }
      await client.query("BEGIN");
      try {
        rowsWritten += await recomputeOneLocalDay(client, job, localDate, maxSkewMs);
        await client.query(
          `DELETE FROM tracking.aggregate_dirty_days
           WHERE tenant_id = $1 AND site_id = $2 AND local_date = $3::date AND time_zone = $4`,
          [job.tenantId, job.siteId, localDate, job.timeZone],
        );
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

  return { daysProcessed, daysSkippedOutsideRaw, rowsWritten };
};

export const markAggregateDirtyDay = async (
  pool: Pick<Pool, "query">,
  input: {
    readonly tenantId: string;
    readonly siteId: string;
    readonly localDate: string;
    readonly timeZone: string;
    readonly reason: "late_event" | "manual" | "purge_adjustment";
  },
): Promise<void> => {
  await pool.query(
    `INSERT INTO tracking.aggregate_dirty_days (tenant_id, site_id, local_date, time_zone, reason)
     VALUES ($1,$2,$3::date,$4,$5)
     ON CONFLICT (tenant_id, site_id, local_date, time_zone) DO UPDATE
       SET reason = EXCLUDED.reason, marked_at = (now() AT TIME ZONE 'utc')`,
    [input.tenantId, input.siteId, input.localDate, input.timeZone, input.reason],
  );
};
