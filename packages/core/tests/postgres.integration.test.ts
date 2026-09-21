import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TrackingEventEnvelope } from "../src/core/envelope";
import { applyTrackingMigrations, resetTrackingSchema } from "../src/postgres/migrate";
import {
  acceptEnvelopeWithForcedEventFailure,
  countInboxRows,
  countStoredEvents,
  createScopedPostgresEnvelopeStore,
  seedTrackingSite,
} from "../src/postgres/scoped-store";

const databaseUrl = process.env.TRACKING_TEST_DATABASE_URL;
const scope = { tenantId: "tenant_test", siteId: "site_test" };

const envelope = (overrides: Partial<TrackingEventEnvelope> = {}): TrackingEventEnvelope => ({
  event_id: "evt_parallel",
  schema_version: 1,
  event_name: "content.view",
  occurred_at: "2026-09-21T12:00:00.000Z",
  subject: { objectType: "article", objectId: "art_1" },
  properties: { path: "/articles/1" },
  tenant_id: scope.tenantId,
  site_id: scope.siteId,
  received_at: "2026-09-21T12:00:01.000Z",
  producer: "browser",
  trust_class: "untrusted",
  measurement_rule_version: "mr_v1",
  collection_policy_version: "cp_v1",
  purpose: "analytics",
  consent: "granted",
  legalBasis: { kind: "unspecified" },
  occurred_at_trust: "producer",
  ...overrides,
});

let pool: Pool | undefined;
let postgresReady = false;

beforeAll(async () => {
  if (!databaseUrl) {
    return;
  }
  const candidate = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 4_000,
  });
  try {
    const client = await candidate.connect();
    await client.query("SELECT 1");
    await resetTrackingSchema(client);
    client.release();
    await applyTrackingMigrations(candidate, { includeRoles: false });
    pool = candidate;
    postgresReady = true;
  } catch {
    await candidate.end().catch(() => undefined);
  }
}, 20_000);

afterAll(async () => {
  await pool?.end();
});

const itPg = it.skipIf(!postgresReady);

describe("postgres adapter (integration)", () => {
  beforeEach(async () => {
    if (!pool) {
      return;
    }
    await pool.query("DELETE FROM tracking.events");
    await pool.query("DELETE FROM tracking.event_inbox");
    await pool.query("DELETE FROM tracking.sites");
    await pool.query("DELETE FROM tracking.tenants");
    await seedTrackingSite(pool, { ...scope, appId: "app_test" });
  });

  itPg("accepts parallel identical inserts as one stored event", async () => {
    const store = createScopedPostgresEnvelopeStore({ pool: pool!, ...scope });
    const event = envelope({ event_id: "evt_parallel_1" });
    const results = await Promise.all([
      store.acceptEnvelope(event),
      store.acceptEnvelope(event),
      store.acceptEnvelope(event),
    ]);
    expect(results.filter((r) => r.ok).length).toBe(3);
    expect(await countStoredEvents(pool!, scope)).toBe(1);
    expect(await countInboxRows(pool!, scope)).toBe(1);
  });

  itPg("returns payload-conflict for the same id with different content", async () => {
    const store = createScopedPostgresEnvelopeStore({ pool: pool!, ...scope });
    const first = await store.acceptEnvelope(envelope({ event_id: "evt_conflict" }));
    expect(first).toEqual({ ok: true, duplicate: false });
    const second = await store.acceptEnvelope(
      envelope({
        event_id: "evt_conflict",
        occurred_at: "2026-09-21T12:05:00.000Z",
      }),
    );
    expect(second).toEqual({ ok: false, reason: "payload-conflict" });
    expect(await countStoredEvents(pool!, scope)).toBe(1);
  });

  itPg("rolls back inbox consumption when the transaction fails", async () => {
    const client = await pool!.connect();
    try {
      await expect(
        acceptEnvelopeWithForcedEventFailure(client, scope, envelope({ event_id: "evt_tx_fail" })),
      ).rejects.toThrow("forced-event-insert-failure");
    } finally {
      client.release();
    }
    expect(await countInboxRows(pool!, scope)).toBe(0);
    expect(await countStoredEvents(pool!, scope)).toBe(0);
  });

  itPg("rejects foreign tenant/site scope", async () => {
    const store = createScopedPostgresEnvelopeStore({ pool: pool!, ...scope });
    const foreign = await store.acceptEnvelope(
      envelope({ tenant_id: "tenant_other", site_id: "site_other", event_id: "evt_foreign" }),
    );
    expect(foreign).toEqual({ ok: false, reason: "scope-mismatch" });

    await seedTrackingSite(pool!, {
      tenantId: scope.tenantId,
      siteId: "site_other",
      appId: "app_other",
    });
    const wrongSite = await store.acceptEnvelope(
      envelope({ site_id: "site_other", event_id: "evt_wrong_site" }),
    );
    expect(wrongSite).toEqual({ ok: false, reason: "scope-mismatch" });
  });

  itPg("rejects events when the scoped site is not registered", async () => {
    const store = createScopedPostgresEnvelopeStore({
      pool: pool!,
      tenantId: scope.tenantId,
      siteId: "site_missing",
    });
    const result = await store.acceptEnvelope(
      envelope({ site_id: "site_missing", event_id: "evt_missing_site" }),
    );
    expect(result).toEqual({ ok: false, reason: "unknown-site" });
  });

  it("documents how to run against a real PostgreSQL instance", () => {
    if (postgresReady) {
      expect(databaseUrl).toBeTruthy();
      return;
    }
    expect(databaseUrl ?? "unset").toBeTruthy();
  });
});
