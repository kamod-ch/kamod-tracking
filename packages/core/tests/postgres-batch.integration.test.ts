import { beforeEach, describe, expect, it } from "vitest";
import type { TrackingEventEnvelope } from "../src/core/envelope";
import {
  createPostgresBatchAcceptanceForScope,
  createScopedPostgresBatchAcceptance,
} from "../src/postgres/scoped-batch-acceptance";
import { countInboxRows, countStoredEvents, seedTrackingSite } from "../src/postgres/scoped-store";
import { postgresPool, registerPostgresIntegrationHooks } from "./postgres-test-fixture";

registerPostgresIntegrationHooks();

const scope = { tenantId: "tenant_batch", siteId: "site_batch" };
const otherScope = { tenantId: "tenant_batch", siteId: "site_other" };

const envelope = (overrides: Partial<TrackingEventEnvelope> = {}): TrackingEventEnvelope => ({
  event_id: "evt_batch_1",
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

describe("postgres batch acceptance (integration)", () => {
  beforeEach(async () => {
    const pool = postgresPool();
    await pool.query("DELETE FROM tracking.events");
    await pool.query("DELETE FROM tracking.event_inbox");
    await pool.query("DELETE FROM tracking.sites");
    await pool.query("DELETE FROM tracking.tenants");
    await seedTrackingSite(pool, { ...scope, appId: "app_batch" });
    await seedTrackingSite(pool, { ...otherScope, appId: "app_other" });
  });

  it("accepts concurrent identical batches as one stored row", async () => {
    const pool = postgresPool();
    const batch = createScopedPostgresBatchAcceptance({ pool, ...scope });
    const event = envelope({ event_id: "evt_parallel_batch" });
    const results = await Promise.all([
      batch.acceptBatch([event]),
      batch.acceptBatch([event]),
      batch.acceptBatch([event]),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.outcomes[0]?.status).toBe("accepted");
      }
    }
    expect(await countStoredEvents(pool, scope)).toBe(1);
    expect(await countInboxRows(pool, scope)).toBe(1);
  });

  it("returns payload-conflict for the same id with different content", async () => {
    const pool = postgresPool();
    const batch = createScopedPostgresBatchAcceptance({ pool, ...scope });
    const first = await batch.acceptBatch([envelope({ event_id: "evt_conflict_batch" })]);
    expect(first.ok).toBe(true);
    const second = await batch.acceptBatch([
      envelope({
        event_id: "evt_conflict_batch",
        occurred_at: "2026-09-21T12:05:00.000Z",
      }),
    ]);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.outcomes[0]?.status).toBe("rejected");
      if (second.outcomes[0]?.status === "rejected") {
        expect(second.outcomes[0].reason).toBe("payload-conflict");
      }
    }
    expect(await countStoredEvents(pool, scope)).toBe(1);
  });

  it("handles mixed batches with per-event rejects and one commit for accepted rows", async () => {
    const pool = postgresPool();
    const batch = createScopedPostgresBatchAcceptance({ pool, ...scope });
    const result = await batch.acceptBatch([
      envelope({ event_id: "evt_ok_1" }),
      envelope({ event_id: "evt_bad_scope", tenant_id: "tenant_evil", site_id: "site_evil" }),
      envelope({ event_id: "evt_ok_2" }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcomes[0]?.status).toBe("accepted");
      expect(result.outcomes[1]?.status).toBe("rejected");
      expect(result.outcomes[2]?.status).toBe("accepted");
    }
    expect(await countStoredEvents(pool, scope)).toBe(2);
    expect(await countInboxRows(pool, scope)).toBe(2);
  });

  it("rolls back the whole batch on infrastructure failure mid-write", async () => {
    const pool = postgresPool();
    const batch = createScopedPostgresBatchAcceptance({ pool, ...scope });
    const broken = envelope({
      event_id: "evt_infra_fail",
      producer: "not-a-producer" as TrackingEventEnvelope["producer"],
    });
    const result = await batch.acceptBatch([envelope({ event_id: "evt_before_fail" }), broken]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("storage-error");
    }
    expect(await countStoredEvents(pool, scope)).toBe(0);
    expect(await countInboxRows(pool, scope)).toBe(0);
  });

  it("rejects envelopes outside the bound scope via outcomes", async () => {
    const pool = postgresPool();
    const batch = createPostgresBatchAcceptanceForScope(pool, scope);
    const result = await batch.acceptBatch([
      envelope({ site_id: otherScope.siteId, event_id: "evt_wrong_site" }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcomes[0]?.status).toBe("rejected");
      if (result.outcomes[0]?.status === "rejected") {
        expect(result.outcomes[0].reason).toBe("unknown-app");
      }
    }
    expect(await countStoredEvents(pool, otherScope)).toBe(0);
  });

  it("allows the same event id on another site independently", async () => {
    const pool = postgresPool();
    const batchA = createPostgresBatchAcceptanceForScope(pool, scope);
    const batchB = createPostgresBatchAcceptanceForScope(pool, otherScope);
    const sharedId = "evt_cross_site";
    const a = await batchA.acceptBatch([envelope({ event_id: sharedId, site_id: scope.siteId })]);
    const b = await batchB.acceptBatch([
      envelope({ event_id: sharedId, site_id: otherScope.siteId }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(await countStoredEvents(pool, scope)).toBe(1);
    expect(await countStoredEvents(pool, otherScope)).toBe(1);
  });

  it("accepts an identical retry after commit (lost ack)", async () => {
    const pool = postgresPool();
    const batch = createScopedPostgresBatchAcceptance({ pool, ...scope });
    const event = envelope({ event_id: "evt_retry_ack" });
    const first = await batch.acceptBatch([event]);
    expect(first.ok).toBe(true);
    if (first.ok) {
      const outcome = first.outcomes[0];
      expect(outcome?.status).toBe("accepted");
      if (outcome?.status === "accepted") {
        expect(outcome.duplicate).toBe(false);
      }
    }
    const retry = await batch.acceptBatch([event]);
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      const outcome = retry.outcomes[0];
      expect(outcome?.status).toBe("accepted");
      if (outcome?.status === "accepted") {
        expect(outcome.duplicate).toBe(true);
      }
    }
    expect(await countStoredEvents(pool, scope)).toBe(1);
  });

  it("resolves duplicate ids within one batch (first wins, second duplicate)", async () => {
    const pool = postgresPool();
    const batch = createScopedPostgresBatchAcceptance({ pool, ...scope });
    const result = await batch.acceptBatch([
      envelope({ event_id: "evt_in_batch_dup" }),
      envelope({ event_id: "evt_in_batch_dup" }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const first = result.outcomes[0];
      const second = result.outcomes[1];
      expect(first?.status).toBe("accepted");
      expect(second?.status).toBe("accepted");
      if (first?.status === "accepted") {
        expect(first.duplicate).toBe(false);
      }
      if (second?.status === "accepted") {
        expect(second.duplicate).toBe(true);
      }
    }
    expect(await countStoredEvents(pool, scope)).toBe(1);
  });

  it("records ingest ops counters from batch outcomes", async () => {
    const pool = postgresPool();
    await pool.query("DELETE FROM tracking.ops_site_counters WHERE tenant_id = $1", [
      scope.tenantId,
    ]);
    const batch = createScopedPostgresBatchAcceptance({ pool, ...scope });
    const event = envelope({ event_id: "evt_ops_metrics" });
    const first = await batch.acceptBatch([event]);
    expect(first.ok).toBe(true);
    const retry = await batch.acceptBatch([event]);
    expect(retry.ok).toBe(true);
    const conflict = await batch.acceptBatch([
      envelope({ event_id: "evt_ops_metrics", properties: { path: "/x", content_type: "x" } }),
    ]);
    expect(conflict.ok).toBe(true);
    if (conflict.ok) {
      expect(conflict.outcomes[0]?.status).toBe("rejected");
    }
    const rows = await pool.query(
      `SELECT metric, counter::text FROM tracking.ops_site_counters
       WHERE tenant_id = $1 AND site_id = $2`,
      [scope.tenantId, scope.siteId],
    );
    const metrics = Object.fromEntries(rows.rows.map((row) => [row.metric, Number(row.counter)]));
    expect(metrics.ingest_accepted).toBe(1);
    expect(metrics.ingest_duplicate).toBe(1);
    expect(metrics.ingest_conflict).toBe(1);
  });
});
