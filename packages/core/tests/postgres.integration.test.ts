import { beforeEach, describe, expect, it } from "vitest";
import type { TrackingEventEnvelope } from "../src/core/envelope";
import {
  acceptEnvelopeWithForcedEventFailure,
  countInboxRows,
  countStoredEvents,
  createScopedPostgresEnvelopeStore,
  seedTrackingSite,
} from "../src/postgres/scoped-store";
import { postgresPool, registerPostgresIntegrationHooks } from "./postgres-test-fixture";

registerPostgresIntegrationHooks();

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

describe("postgres adapter (integration)", () => {
  beforeEach(async () => {
    const pool = postgresPool();
    await pool.query("DELETE FROM tracking.events");
    await pool.query("DELETE FROM tracking.event_inbox");
    await pool.query("DELETE FROM tracking.sites");
    await pool.query("DELETE FROM tracking.tenants");
    await seedTrackingSite(pool, { ...scope, appId: "app_test" });
  });

  it("accepts parallel identical inserts as one stored event", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    const event = envelope({ event_id: "evt_parallel_1" });
    const results = await Promise.all([
      store.acceptEnvelope(event),
      store.acceptEnvelope(event),
      store.acceptEnvelope(event),
    ]);
    expect(results.filter((r) => r.ok).length).toBe(3);
    expect(await countStoredEvents(pool, scope)).toBe(1);
    expect(await countInboxRows(pool, scope)).toBe(1);
  });

  it("returns payload-conflict for the same id with different content", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    const first = await store.acceptEnvelope(envelope({ event_id: "evt_conflict" }));
    expect(first).toEqual({ ok: true, duplicate: false });
    const second = await store.acceptEnvelope(
      envelope({
        event_id: "evt_conflict",
        occurred_at: "2026-09-21T12:05:00.000Z",
      }),
    );
    expect(second).toEqual({ ok: false, reason: "payload-conflict" });
    expect(await countStoredEvents(pool, scope)).toBe(1);
  });

  it("rolls back inbox consumption when the transaction fails", async () => {
    const pool = postgresPool();
    const client = await pool.connect();
    try {
      await expect(
        acceptEnvelopeWithForcedEventFailure(client, scope, envelope({ event_id: "evt_tx_fail" })),
      ).rejects.toThrow("forced-event-insert-failure");
    } finally {
      client.release();
    }
    expect(await countInboxRows(pool, scope)).toBe(0);
    expect(await countStoredEvents(pool, scope)).toBe(0);
  });

  it("rejects foreign tenant/site scope", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({ pool, ...scope });
    const foreign = await store.acceptEnvelope(
      envelope({ tenant_id: "tenant_other", site_id: "site_other", event_id: "evt_foreign" }),
    );
    expect(foreign).toEqual({ ok: false, reason: "scope-mismatch" });

    await seedTrackingSite(pool, {
      tenantId: scope.tenantId,
      siteId: "site_other",
      appId: "app_other",
    });
    const wrongSite = await store.acceptEnvelope(
      envelope({ site_id: "site_other", event_id: "evt_wrong_site" }),
    );
    expect(wrongSite).toEqual({ ok: false, reason: "scope-mismatch" });
  });

  it("rejects events when the scoped site is not registered", async () => {
    const pool = postgresPool();
    const store = createScopedPostgresEnvelopeStore({
      pool,
      tenantId: scope.tenantId,
      siteId: "site_missing",
    });
    const result = await store.acceptEnvelope(
      envelope({ site_id: "site_missing", event_id: "evt_missing_site" }),
    );
    expect(result).toEqual({ ok: false, reason: "unknown-site" });
  });
});
