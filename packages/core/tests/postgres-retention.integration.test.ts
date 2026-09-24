import { beforeEach, describe, expect, it } from "vitest";
import { runDailyCountAggregate, upsertRawWatermark } from "../src/postgres/daily-aggregate";
import {
  readRecomputeBoundary,
  runPurposeRetention,
  validateSiteRetentionPolicy,
} from "../src/postgres/retention";
import { createScopedPostgresEnvelopeStore, seedTrackingSite } from "../src/postgres/scoped-store";
import type { TrackingEventEnvelope } from "../src/core/envelope";
import { postgresPool, registerPostgresIntegrationHooks } from "./postgres-test-fixture";

registerPostgresIntegrationHooks();

const scope = { tenantId: "tenant_ret", siteId: "site_ret" };
const tz = "UTC";
const rule = "daily_counts_v1";

const envelope = (overrides: Partial<TrackingEventEnvelope> = {}): TrackingEventEnvelope => ({
  event_id: overrides.event_id ?? `evt_${Math.random().toString(36).slice(2, 8)}`,
  schema_version: 1,
  event_name: "content.view",
  occurred_at: "2026-04-10T12:00:00.000Z",
  subject: { objectType: "article", objectId: "art_1" },
  properties: { path: "/a" },
  tenant_id: scope.tenantId,
  site_id: scope.siteId,
  received_at: "2026-04-10T12:05:00.000Z",
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

describe("postgres retention without destroying historical metrics", () => {
  beforeEach(async () => {
    const pool = postgresPool();
    await pool.query("DELETE FROM tracking.retention_purge_checkpoint");
    await pool.query("DELETE FROM tracking.raw_coverage_gaps");
    await pool.query("DELETE FROM tracking.daily_aggregates");
    await pool.query("DELETE FROM tracking.raw_data_watermark");
    await pool.query("DELETE FROM tracking.events");
    await pool.query("DELETE FROM tracking.event_inbox");
    await pool.query("DELETE FROM tracking.sites");
    await pool.query("DELETE FROM tracking.tenants");
    await seedTrackingSite(pool, { ...scope, appId: "app_ret" });
  });

  it("rejects inbox retention below supported retry horizon", () => {
    const issues = validateSiteRetentionPolicy({
      ...scope,
      purpose: "analytics",
      rawRetentionDays: 30,
      aggregateRetentionDays: 365,
      inboxRetentionDays: 7,
      lateEventBackfillDays: 3,
      collectionPolicyMode: "none",
    });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("preserves aggregates on rebuild after full raw purge", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(envelope({ event_id: "evt_full", purpose: "analytics" }));
    const client = await pool.connect();
    try {
      await upsertRawWatermark(
        client,
        { ...scope, purpose: "analytics" },
        new Date("2026-04-01T00:00:00.000Z"),
      );
    } finally {
      client.release();
    }
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: tz,
      aggregateRuleVersion: rule,
      localDateFrom: "2026-04-10",
      localDateTo: "2026-04-10",
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    await pool.query(`DELETE FROM tracking.events WHERE tenant_id = $1`, [scope.tenantId]);
    await runPurposeRetention(pool, {
      policy: {
        ...scope,
        purpose: "analytics",
        rawRetentionDays: 1,
        aggregateRetentionDays: null,
        inboxRetentionDays: 30,
        lateEventBackfillDays: 3,
        collectionPolicyMode: "none",
      },
      now: new Date("2026-06-01T00:00:00.000Z"),
      timeZoneForCoverage: tz,
    });
    const rebuild = await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: tz,
      aggregateRuleVersion: rule,
      localDateFrom: "2026-04-10",
      localDateTo: "2026-04-10",
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    expect(rebuild.daysSkippedOutsideRaw).toBe(1);
    expect(rebuild.rowsWritten).toBe(0);
    const rows = await pool.query(
      `SELECT event_count FROM tracking.daily_aggregates WHERE tenant_id = $1`,
      [scope.tenantId],
    );
    expect(Number(rows.rows[0]?.event_count)).toBe(1);
    const boundary = await readRecomputeBoundary(pool, { ...scope, purpose: "analytics" });
    expect(boundary.oldestRemainingReceivedAt).toBeUndefined();
    expect(boundary.recomputeCompleteFromReceivedAt.getTime()).toBeGreaterThan(0);
  });

  it("purges inbox by purpose without joining events", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(
      envelope({ event_id: "evt_inbox", received_at: "2026-01-01T00:00:00.000Z" }),
    );
    await pool.query(`DELETE FROM tracking.events WHERE tenant_id = $1`, [scope.tenantId]);
    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tracking.event_inbox WHERE tenant_id = $1`,
      [scope.tenantId],
    );
    expect(before.rows[0]?.n).toBe(1);
    const result = await runPurposeRetention(pool, {
      policy: {
        ...scope,
        purpose: "analytics",
        rawRetentionDays: null,
        aggregateRetentionDays: null,
        inboxRetentionDays: 30,
        lateEventBackfillDays: 3,
        collectionPolicyMode: "none",
      },
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(result.inboxDeleted).toBe(1);
  });

  it("applies separate aggregate retention per purpose", async () => {
    const pool = postgresPool();
    await pool.query(
      `INSERT INTO tracking.daily_aggregates (
         tenant_id, site_id, purpose, local_date, time_zone,
         aggregate_rule_version, bucket_rule_version,
         measurement_rule_version, collection_policy_version, surface,
         event_name, subject_object_type, subject_object_id,
         event_count, session_count, computed_at
       ) VALUES
       ($1,$2,'analytics','2020-01-01', $3, $4, 'bucket_instant_v1', 'mr', 'none', '', 'content.view', 'none', '', 1, NULL, now()),
       ($1,$2,'measurement','2020-01-01', $3, $4, 'bucket_instant_v1', 'mr', 'none', '', 'content.view', 'none', '', 2, NULL, now())`,
      [scope.tenantId, scope.siteId, tz, rule],
    );
    await runPurposeRetention(pool, {
      policy: {
        ...scope,
        purpose: "analytics",
        rawRetentionDays: null,
        aggregateRetentionDays: 30,
        inboxRetentionDays: 30,
        lateEventBackfillDays: 3,
        collectionPolicyMode: "none",
      },
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    const rows = await pool.query(
      `SELECT purpose, event_count FROM tracking.daily_aggregates WHERE tenant_id = $1 ORDER BY purpose`,
      [scope.tenantId],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.purpose).toBe("measurement");
  });

  it("resumes batched raw purge idempotently via checkpoint cleanup", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    for (let i = 0; i < 5; i += 1) {
      await store.acceptEnvelope(
        envelope({
          event_id: `evt_batch_${i}`,
          received_at: `2026-01-0${i + 1}T00:00:00.000Z`,
        }),
      );
    }
    const first = await runPurposeRetention(pool, {
      policy: {
        ...scope,
        purpose: "analytics",
        rawRetentionDays: 30,
        aggregateRetentionDays: null,
        inboxRetentionDays: 30,
        lateEventBackfillDays: 3,
        collectionPolicyMode: "none",
      },
      now: new Date("2026-06-01T00:00:00.000Z"),
      rawDeleteBatchSize: 2,
    });
    const second = await runPurposeRetention(pool, {
      policy: {
        ...scope,
        purpose: "analytics",
        rawRetentionDays: 30,
        aggregateRetentionDays: null,
        inboxRetentionDays: 30,
        lateEventBackfillDays: 3,
        collectionPolicyMode: "none",
      },
      now: new Date("2026-06-01T00:00:00.000Z"),
      rawDeleteBatchSize: 2,
    });
    expect(first.eventsDeleted).toBeGreaterThan(0);
    expect(second.eventsDeleted).toBe(0);
    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tracking.events WHERE tenant_id = $1`,
      [scope.tenantId],
    );
    expect(remaining.rows[0]?.n).toBe(0);
  });

  it("marks partial civil day and preserves aggregates on incomplete rebuild", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(
      envelope({
        event_id: "evt_before_cutoff",
        received_at: "2026-04-10T08:00:00.000Z",
      }),
    );
    await store.acceptEnvelope(
      envelope({
        event_id: "evt_after_cutoff",
        received_at: "2026-04-10T14:00:00.000Z",
      }),
    );
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: tz,
      aggregateRuleVersion: rule,
      localDateFrom: "2026-04-10",
      localDateTo: "2026-04-10",
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    const purge = await runPurposeRetention(pool, {
      policy: {
        ...scope,
        purpose: "analytics",
        rawRetentionDays: 30,
        aggregateRetentionDays: null,
        inboxRetentionDays: 30,
        lateEventBackfillDays: 3,
        collectionPolicyMode: "none",
      },
      now: new Date("2026-05-10T12:00:00.000Z"),
      timeZoneForCoverage: tz,
    });
    expect(purge.coverageGapsMarked).toBe(1);
    const gaps = await pool.query(
      `SELECT local_date::text AS d FROM tracking.raw_coverage_gaps WHERE tenant_id = $1`,
      [scope.tenantId],
    );
    expect(gaps.rows[0]?.d.slice(0, 10)).toBe("2026-04-10");
    const rebuild = await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: tz,
      aggregateRuleVersion: rule,
      localDateFrom: "2026-04-10",
      localDateTo: "2026-04-10",
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    expect(rebuild.daysSkippedIncompleteCoverage).toBe(1);
    expect(rebuild.rowsWritten).toBe(0);
    const agg = await pool.query(
      `SELECT event_count FROM tracking.daily_aggregates WHERE tenant_id = $1`,
      [scope.tenantId],
    );
    expect(Number(agg.rows[0]?.event_count)).toBe(2);
  });

  it("applies raw retention per purpose independently", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(
      envelope({
        event_id: "evt_a",
        purpose: "analytics",
        received_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    await store.acceptEnvelope(
      envelope({
        event_id: "evt_m",
        purpose: "measurement",
        received_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    await runPurposeRetention(pool, {
      policy: {
        ...scope,
        purpose: "analytics",
        rawRetentionDays: 30,
        aggregateRetentionDays: null,
        inboxRetentionDays: 30,
        lateEventBackfillDays: 3,
        collectionPolicyMode: "none",
      },
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    const counts = await pool.query(
      `SELECT purpose, COUNT(*)::int AS n FROM tracking.events WHERE tenant_id = $1 GROUP BY purpose ORDER BY purpose`,
      [scope.tenantId],
    );
    expect(counts.rowCount).toBe(1);
    expect(counts.rows[0]?.purpose).toBe("measurement");
  });

  it("completes purge after simulated checkpoint (interrupted run)", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    for (let i = 0; i < 4; i += 1) {
      await store.acceptEnvelope(
        envelope({
          event_id: `evt_resume_${i}`,
          received_at: `2026-01-0${i + 1}T00:00:00.000Z`,
        }),
      );
    }
    const cutoff = new Date("2026-06-01T00:00:00.000Z");
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);
    await pool.query(
      `INSERT INTO tracking.retention_purge_checkpoint (tenant_id, site_id, purpose, phase, last_cutoff)
       VALUES ($1,$2,'analytics','raw_events',$3::timestamptz)`,
      [scope.tenantId, scope.siteId, cutoff.toISOString()],
    );
    await pool.query(
      `DELETE FROM tracking.events WHERE tenant_id = $1 AND received_at < $2::timestamptz`,
      [scope.tenantId, cutoff.toISOString()],
    );
    const resumed = await runPurposeRetention(pool, {
      policy: {
        ...scope,
        purpose: "analytics",
        rawRetentionDays: 30,
        aggregateRetentionDays: null,
        inboxRetentionDays: 30,
        lateEventBackfillDays: 3,
        collectionPolicyMode: "none",
      },
      now: new Date("2026-06-01T00:00:00.000Z"),
      rawDeleteBatchSize: 2,
    });
    expect(resumed.eventsDeleted).toBe(0);
    const checkpoint = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tracking.retention_purge_checkpoint WHERE tenant_id = $1`,
      [scope.tenantId],
    );
    expect(checkpoint.rows[0]?.n).toBe(0);
    const remaining = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tracking.events WHERE tenant_id = $1`,
      [scope.tenantId],
    );
    expect(remaining.rows[0]?.n).toBe(0);
  });
});
