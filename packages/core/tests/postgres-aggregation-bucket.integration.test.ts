import { beforeEach, describe, expect, it } from "vitest";
import { formatLocalDate } from "../src/aggregation/time-bucketing";
import {
  markAggregateDirtyDay,
  readDirtyGeneration,
  runDailyCountAggregate,
  upsertRawWatermark,
} from "../src/postgres/daily-aggregate";
import { createScopedPostgresEnvelopeStore, seedTrackingSite } from "../src/postgres/scoped-store";
import type { TrackingEventEnvelope } from "../src/core/envelope";
import { postgresPool, registerPostgresIntegrationHooks } from "./postgres-test-fixture";

registerPostgresIntegrationHooks();

const scope = { tenantId: "tenant_bucket", siteId: "site_bucket" };
const zurich = "Europe/Zurich";
const utc = "UTC";
const rule = "daily_counts_v1";

const baseEnvelope = (overrides: Partial<TrackingEventEnvelope> = {}): TrackingEventEnvelope => ({
  event_id: overrides.event_id ?? `evt_${Math.random().toString(36).slice(2, 8)}`,
  schema_version: 1,
  event_name: "content.view",
  occurred_at: "2026-03-28T22:30:00.000Z",
  subject: { objectType: "article", objectId: "art_1" },
  properties: { path: "/a", content_type: "page" },
  tenant_id: scope.tenantId,
  site_id: scope.siteId,
  received_at: "2026-03-29T05:00:00.000Z",
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

const seedPolicy = async () => {
  const pool = postgresPool();
  await pool.query(
    `INSERT INTO tracking.site_data_policy (
       tenant_id, site_id, purpose, raw_retention_days, aggregate_retention_days,
       inbox_retention_days, late_event_backfill_days, collection_policy_mode
     ) VALUES ($1,$2,'analytics',90,365,30,14,'none')
     ON CONFLICT DO NOTHING`,
    [scope.tenantId, scope.siteId],
  );
  await pool.query(
    `INSERT INTO tracking.site_data_policy (
       tenant_id, site_id, purpose, raw_retention_days, aggregate_retention_days,
       inbox_retention_days, late_event_backfill_days, collection_policy_mode
     ) VALUES ($1,$2,'measurement',90,365,30,14,'none')
     ON CONFLICT DO NOTHING`,
    [scope.tenantId, scope.siteId],
  );
};

const seedWatermark = async () => {
  const pool = postgresPool();
  const client = await pool.connect();
  try {
    await upsertRawWatermark(
      client,
      { ...scope, purpose: "analytics" },
      new Date("2026-01-01T00:00:00.000Z"),
    );
    await upsertRawWatermark(
      client,
      { ...scope, purpose: "measurement" },
      new Date("2026-01-01T00:00:00.000Z"),
    );
  } finally {
    client.release();
  }
};

describe("postgres aggregation bucketing (integration)", () => {
  beforeEach(async () => {
    const pool = postgresPool();
    await pool.query("DELETE FROM tracking.daily_aggregates");
    await pool.query("DELETE FROM tracking.aggregate_dirty_days");
    await pool.query("DELETE FROM tracking.events");
    await pool.query("DELETE FROM tracking.event_inbox");
    await pool.query("DELETE FROM tracking.sites");
    await pool.query("DELETE FROM tracking.tenants");
    await seedTrackingSite(pool, { ...scope, appId: "app_bucket" });
    await seedPolicy();
  });

  it("assigns occurred-at civil day when producer time is within skew despite late receive", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(
      baseEnvelope({
        event_id: "evt_occurred_day",
        occurred_at: "2026-03-28T22:30:00.000Z",
        received_at: "2026-03-29T05:00:00.000Z",
      }),
    );
    await seedWatermark();
    const occurredLocal = formatLocalDate(new Date("2026-03-28T22:30:00.000Z"), zurich);
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: zurich,
      aggregateRuleVersion: rule,
      localDateFrom: occurredLocal,
      localDateTo: occurredLocal,
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    const receiveDay = formatLocalDate(new Date("2026-03-29T05:00:00.000Z"), zurich);
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: zurich,
      aggregateRuleVersion: rule,
      localDateFrom: receiveDay,
      localDateTo: receiveDay,
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    const rows = await pool.query<{ local_date: string; event_count: string }>(
      `SELECT local_date::text, event_count FROM tracking.daily_aggregates WHERE tenant_id = $1`,
      [scope.tenantId],
    );
    expect(rows.rows.some((row) => row.local_date.startsWith("2026-03-28"))).toBe(true);
    expect(
      rows.rows
        .filter((row) => row.local_date.startsWith("2026-03-28"))
        .reduce((sum, row) => sum + Number(row.event_count), 0),
    ).toBe(1);
    expect(rows.rows.some((row) => row.local_date.startsWith("2026-03-29"))).toBe(false);
  });

  it("handles Europe/Zurich DST day lengths", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(
      baseEnvelope({
        event_id: "evt_spring",
        occurred_at: "2026-03-29T12:00:00.000Z",
        received_at: "2026-03-29T12:05:00.000Z",
      }),
    );
    await store.acceptEnvelope(
      baseEnvelope({
        event_id: "evt_fall",
        occurred_at: "2026-10-25T12:00:00.000Z",
        received_at: "2026-10-25T12:05:00.000Z",
      }),
    );
    await seedWatermark();
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: zurich,
      aggregateRuleVersion: rule,
      localDateFrom: "2026-03-29",
      localDateTo: "2026-03-29",
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: zurich,
      aggregateRuleVersion: rule,
      localDateFrom: "2026-10-25",
      localDateTo: "2026-10-25",
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    const rows = await pool.query(
      `SELECT local_date::text FROM tracking.daily_aggregates WHERE tenant_id = $1`,
      [scope.tenantId],
    );
    expect(rows.rowCount).toBe(2);
  });

  it("keeps purposes and time zones in separate aggregate rows", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(
      baseEnvelope({
        event_id: "evt_a",
        purpose: "analytics",
        occurred_at: "2026-03-29T12:00:00.000Z",
        received_at: "2026-03-29T12:01:00.000Z",
      }),
    );
    await store.acceptEnvelope(
      baseEnvelope({
        event_id: "evt_m",
        purpose: "measurement",
        event_name: "devjobs.listing.view",
        occurred_at: "2026-03-29T12:00:00.000Z",
        received_at: "2026-03-29T12:01:00.000Z",
      }),
    );
    await seedWatermark();
    const day = "2026-03-29";
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: utc,
      aggregateRuleVersion: rule,
      localDateFrom: day,
      localDateTo: day,
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: utc,
      aggregateRuleVersion: rule,
      localDateFrom: day,
      localDateTo: day,
      purpose: "measurement",
      collectionPolicyMode: "none",
    });
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: zurich,
      aggregateRuleVersion: rule,
      localDateFrom: day,
      localDateTo: day,
      purpose: "analytics",
      collectionPolicyMode: "none",
    });
    const rows = await pool.query(
      `SELECT purpose, time_zone, event_count FROM tracking.daily_aggregates WHERE tenant_id = $1 ORDER BY purpose, time_zone`,
      [scope.tenantId],
    );
    expect(rows.rowCount).toBe(3);
  });

  it("splits rows by collection_policy_version under one bucket rule", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(
      baseEnvelope({
        event_id: "evt_cp1",
        occurred_at: "2026-03-29T12:00:00.000Z",
        received_at: "2026-03-29T12:01:00.000Z",
        collection_policy_version: "none",
      }),
    );
    await store.acceptEnvelope(
      baseEnvelope({
        event_id: "evt_cp2",
        occurred_at: "2026-03-29T12:00:00.000Z",
        received_at: "2026-03-29T12:01:00.000Z",
        collection_policy_version: "session",
      }),
    );
    await seedWatermark();
    const day = "2026-03-29";
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: utc,
      aggregateRuleVersion: rule,
      bucketRuleVersion: "bucket_instant_v1",
      localDateFrom: day,
      localDateTo: day,
      purpose: "analytics",
      collectionPolicyMode: "session",
    });
    const rows = await pool.query(
      `SELECT collection_policy_version, event_count
       FROM tracking.daily_aggregates WHERE tenant_id = $1 ORDER BY collection_policy_version`,
      [scope.tenantId],
    );
    expect(rows.rowCount).toBe(2);
  });

  it("stores allowlisted surface dimension only", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(
      baseEnvelope({
        event_id: "evt_surface_ok",
        properties: { path: "/jobs", content_type: "page", surface: "job-list" },
      }),
    );
    await store.acceptEnvelope(
      baseEnvelope({
        event_id: "evt_surface_bad",
        properties: { path: "/jobs", content_type: "page", surface: "random-high-cardinality" },
      }),
    );
    await seedWatermark();
    await runDailyCountAggregate(pool, {
      ...scope,
      timeZone: utc,
      aggregateRuleVersion: rule,
      localDateFrom: "2026-03-29",
      localDateTo: "2026-03-29",
      purpose: "analytics",
      collectionPolicyMode: "none",
      allowedSurfaces: ["job-list", "job-detail-modal"],
    });
    const rows = await pool.query(
      `SELECT surface, event_count FROM tracking.daily_aggregates WHERE tenant_id = $1 ORDER BY surface`,
      [scope.tenantId],
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows.find((row) => row.surface === "job-list")?.event_count).toBe("1");
    expect(rows.rows.find((row) => row.surface === "")?.event_count).toBe("1");
  });

  it("keeps dirty marker when generation advances during rebuild", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    await store.acceptEnvelope(baseEnvelope({ event_id: "evt_dirty" }));
    await seedWatermark();
    const localDate = "2026-03-29";
    await markAggregateDirtyDay(pool, {
      ...scope,
      purpose: "analytics",
      localDate,
      timeZone: utc,
      aggregateRuleVersion: rule,
      reason: "late_event",
    });
    expect(
      await readDirtyGeneration(pool, {
        ...scope,
        purpose: "analytics",
        localDate,
        timeZone: utc,
        aggregateRuleVersion: rule,
      }),
    ).toBe(1);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ dirty_generation: string }>(
        `SELECT dirty_generation FROM tracking.aggregate_dirty_days
         WHERE tenant_id = $1 AND site_id = $2 AND purpose = 'analytics'
           AND local_date = $3::date AND time_zone = $4 AND aggregate_rule_version = $5
         FOR UPDATE`,
        [scope.tenantId, scope.siteId, localDate, utc, rule],
      );
      const generation = Number(locked.rows[0]?.dirty_generation);
      await markAggregateDirtyDay(pool, {
        ...scope,
        purpose: "analytics",
        localDate,
        timeZone: utc,
        aggregateRuleVersion: rule,
        reason: "late_event",
      });
      await client.query(
        `DELETE FROM tracking.aggregate_dirty_days
         WHERE tenant_id = $1 AND site_id = $2 AND purpose = 'analytics'
           AND local_date = $3::date AND time_zone = $4 AND aggregate_rule_version = $5
           AND dirty_generation = $6`,
        [scope.tenantId, scope.siteId, localDate, utc, rule, generation],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    expect(
      await readDirtyGeneration(pool, {
        ...scope,
        purpose: "analytics",
        localDate,
        timeZone: utc,
        aggregateRuleVersion: rule,
      }),
    ).toBe(2);
  });
});
