import { beforeEach, describe, expect, it } from "vitest";
import { formatLocalDate } from "../src/aggregation/time-bucketing";
import {
  markAggregateDirtyDay,
  readRawWatermark,
  runDailyCountAggregate,
  upsertRawWatermark,
} from "../src/postgres/daily-aggregate";
import { incrementOpsCounter } from "../src/postgres/ops-metrics";
import { runPurposeRetention } from "../src/postgres/retention";
import { createScopedPostgresEnvelopeStore, seedTrackingSite } from "../src/postgres/scoped-store";
import type { TrackingEventEnvelope } from "../src/core/envelope";
import { postgresPool, registerPostgresIntegrationHooks } from "./postgres-test-fixture";

registerPostgresIntegrationHooks();

const scope = { tenantId: "tenant_agg", siteId: "site_agg" };
const tz = "Europe/Zurich";

const envelope = (overrides: Partial<TrackingEventEnvelope> = {}): TrackingEventEnvelope => ({
  event_id: overrides.event_id ?? `evt_${Math.random().toString(36).slice(2, 8)}`,
  schema_version: 1,
  event_name: "content.view",
  occurred_at: "2026-03-29T12:00:00.000Z",
  subject: { objectType: "article", objectId: "art_1" },
  properties: { path: "/a" },
  tenant_id: scope.tenantId,
  site_id: scope.siteId,
  received_at: "2026-03-29T12:05:00.000Z",
  producer: "browser",
  trust_class: "untrusted",
  measurement_rule_version: "mr_v1",
  collection_policy_version: "none",
  purpose: "analytics",
  consent: "granted",
  legalBasis: { kind: "unspecified" },
  occurred_at_trust: "producer",
  ...overrides,
});

describe("postgres aggregation (integration)", () => {
  beforeEach(async () => {
    const pool = postgresPool();
    await pool.query("DELETE FROM tracking.daily_aggregates");
    await pool.query("DELETE FROM tracking.aggregate_dirty_days");
    await pool.query("DELETE FROM tracking.raw_data_watermark");
    await pool.query("DELETE FROM tracking.ops_site_counters");
    await pool.query("DELETE FROM tracking.events");
    await pool.query("DELETE FROM tracking.event_inbox");
    await pool.query("DELETE FROM tracking.sites");
    await pool.query("DELETE FROM tracking.tenants");
    await seedTrackingSite(pool, { ...scope, appId: "app_agg" });
    await pool.query(
      `INSERT INTO tracking.site_data_policy (
         tenant_id, site_id, purpose, raw_retention_days, aggregate_retention_days,
         inbox_retention_days, late_event_backfill_days, collection_policy_mode
       ) VALUES ($1,$2,'analytics',30,365,30,3,'session')`,
      [scope.tenantId, scope.siteId],
    );
  });

  it("rolls up daily counts and recomputes idempotently", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(envelope({ event_id: "evt_1" }));
    await store.acceptEnvelope(
      envelope({ event_id: "evt_2", subject: { objectType: "article", objectId: "art_1" } }),
    );
    const client = await pool.connect();
    try {
      await upsertRawWatermark(
        client,
        { ...scope, purpose: "analytics" },
        new Date("2026-03-01T00:00:00.000Z"),
      );
    } finally {
      client.release();
    }

    const job = {
      ...scope,
      timeZone: tz,
      aggregateRuleVersion: "daily_counts_v1",
      localDateFrom: "2026-03-29",
      localDateTo: "2026-03-29",
      purpose: "analytics" as const,
      collectionPolicyMode: "session" as const,
    };
    const first = await runDailyCountAggregate(pool, job);
    expect(first.rowsWritten).toBeGreaterThan(0);
    const second = await runDailyCountAggregate(pool, job);
    expect(second.rowsWritten).toBe(first.rowsWritten);

    const rows = await pool.query(
      `SELECT event_count, session_count FROM tracking.daily_aggregates
       WHERE tenant_id = $1 AND site_id = $2 AND local_date = '2026-03-29'::date`,
      [scope.tenantId, scope.siteId],
    );
    expect(Number(rows.rows[0]?.event_count)).toBe(2);
  });

  it("clears a day when purge removed all underlying events", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(envelope({ event_id: "evt_purge" }));
    const client = await pool.connect();
    try {
      await upsertRawWatermark(
        client,
        { ...scope, purpose: "analytics" },
        new Date("2026-03-01T00:00:00.000Z"),
      );
    } finally {
      client.release();
    }
    const job = {
      ...scope,
      timeZone: tz,
      aggregateRuleVersion: "daily_counts_v1",
      localDateFrom: "2026-03-29",
      localDateTo: "2026-03-29",
      purpose: "analytics" as const,
      collectionPolicyMode: "none" as const,
    };
    await runDailyCountAggregate(pool, job);
    await pool.query(`DELETE FROM tracking.events WHERE tenant_id = $1 AND site_id = $2`, [
      scope.tenantId,
      scope.siteId,
    ]);
    await runDailyCountAggregate(pool, job);
    const rows = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tracking.daily_aggregates WHERE tenant_id = $1 AND site_id = $2`,
      [scope.tenantId, scope.siteId],
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("skips backfill outside raw watermark without deleting historical aggregates", async () => {
    const pool = postgresPool();
    await pool.query(
      `INSERT INTO tracking.daily_aggregates (
         tenant_id, site_id, purpose, local_date, time_zone,
         aggregate_rule_version, bucket_rule_version,
         measurement_rule_version, collection_policy_version, surface,
         event_name, subject_object_type, subject_object_id, event_count, session_count, computed_at
       ) VALUES ($1,$2,'analytics','2026-01-01'::date,$3,'daily_counts_v1','bucket_instant_v1','mr_v1','none','','content.view','article','art_old',5,NULL,now())`,
      [scope.tenantId, scope.siteId, tz],
    );
    const client = await pool.connect();
    try {
      await upsertRawWatermark(
        client,
        { ...scope, purpose: "analytics" },
        new Date("2026-03-01T00:00:00.000Z"),
      );
    } finally {
      client.release();
    }
    const result = await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: tz,
      aggregateRuleVersion: "daily_counts_v1",
      localDateFrom: "2026-01-01",
      localDateTo: "2026-01-02",
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    expect(result.daysSkippedOutsideRaw).toBeGreaterThan(0);
    const preserved = await pool.query(
      `SELECT event_count FROM tracking.daily_aggregates
       WHERE tenant_id = $1 AND subject_object_id = 'art_old'`,
      [scope.tenantId],
    );
    expect(Number(preserved.rows[0]?.event_count)).toBe(5);
  });

  it("marks dirty days for late events", async () => {
    const pool = postgresPool();
    const localDate = formatLocalDate(new Date("2026-03-28T23:00:00.000Z"), tz);
    await markAggregateDirtyDay(pool, {
      ...scope,
      purpose: "analytics",
      localDate,
      timeZone: tz,
      aggregateRuleVersion: "daily_counts_v1",
      reason: "late_event",
    });
    const row = await pool.query(
      `SELECT reason FROM tracking.aggregate_dirty_days WHERE tenant_id = $1`,
      [scope.tenantId],
    );
    expect(row.rows[0]?.reason).toBe("late_event");
  });

  it("increments ops counters without high-cardinality labels", async () => {
    const pool = postgresPool();
    await incrementOpsCounter(pool, {
      ...scope,
      metric: "ingest_accepted",
    });
    await incrementOpsCounter(pool, {
      ...scope,
      metric: "ingest_rejected",
      rejectReason: "invalid-payload",
    });
    const rows = await pool.query(
      `SELECT metric, counter FROM tracking.ops_site_counters WHERE tenant_id = $1 ORDER BY metric`,
      [scope.tenantId],
    );
    expect(rows.rowCount).toBe(2);
  });

  it("retention advances recompute floor without deleting boundary when raw is empty", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(
      envelope({ event_id: "evt_old", received_at: "2026-01-01T00:00:00.000Z" }),
    );
    await store.acceptEnvelope(
      envelope({ event_id: "evt_new", received_at: "2026-06-01T00:00:00.000Z" }),
    );
    const result = await runPurposeRetention(pool, {
      policy: {
        ...scope,
        purpose: "analytics",
        rawRetentionDays: 30,
        aggregateRetentionDays: null,
        inboxRetentionDays: 30,
        lateEventBackfillDays: 3,
        collectionPolicyMode: "none",
      },
      now: new Date("2026-06-15T00:00:00.000Z"),
      timeZoneForCoverage: tz,
    });
    expect(result.status).toBe("completed");
    const boundary = await readRawWatermark(pool, { ...scope, purpose: "analytics" });
    expect(boundary?.recomputeCompleteFromReceivedAt.toISOString()).toBe(
      "2026-05-16T00:00:00.000Z",
    );
    expect(boundary?.oldestReceivedAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    const row = await pool.query(
      `SELECT 1 FROM tracking.raw_data_watermark WHERE tenant_id = $1 AND purpose = 'analytics'`,
      [scope.tenantId],
    );
    expect(row.rowCount).toBe(1);
  });
});
