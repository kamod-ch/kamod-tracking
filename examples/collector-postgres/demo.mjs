/**
 * Primary integration example: browser collect handler + PostgreSQL batch adapter + ops counters.
 * Requires TRACKING_TEST_DATABASE_URL (same as pnpm test:postgres).
 */
import pg from "pg";
import {
  createEventRegistry,
  registerContentViewEvents,
  recordConsent,
  createMemoryConsentStore,
} from "@kamod-ch/tracking";
import {
  applyTrackingMigrations,
  createScopedPostgresBatchAcceptance,
} from "@kamod-ch/tracking/postgres";
import { createBrowserCollectHandler, createStaticSiteRegistry } from "@kamod-ch/tracking/server";

const databaseUrl = process.env.TRACKING_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(
    "TRACKING_TEST_DATABASE_URL is required for collector-postgres example.\n" +
      "See docs/postgres-adapter.md and: pnpm verify:all",
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
await applyTrackingMigrations(pool, { includeRoles: false });

const collectorContext = {
  tenantId: "tenant_collector_ex",
  siteId: "site_collector_ex",
  measurementRuleVersion: "mr_v1",
  collectionPolicyVersion: "none",
  allowedBrowserIdentityModes: ["none"],
  browserIdentityMode: "none",
};

const site = {
  publicKey: "pk_collector_ex",
  tenantId: collectorContext.tenantId,
  siteId: collectorContext.siteId,
  appId: "app-collector-ex",
  collector: collectorContext,
  allowedOrigins: ["https://app.example"],
  browserIdentityMode: "none",
};

await pool.query("DELETE FROM tracking.ops_site_counters WHERE tenant_id = $1", [site.tenantId]);
await pool.query("DELETE FROM tracking.events WHERE tenant_id = $1", [site.tenantId]);
await pool.query("DELETE FROM tracking.event_inbox WHERE tenant_id = $1", [site.tenantId]);
await pool.query("DELETE FROM tracking.sites WHERE tenant_id = $1", [site.tenantId]);
await pool.query("DELETE FROM tracking.tenants WHERE tenant_id = $1", [site.tenantId]);
await pool.query(`INSERT INTO tracking.tenants (tenant_id, display_name) VALUES ($1, $2)`, [
  site.tenantId,
  "Example tenant",
]);
await pool.query(
  `INSERT INTO tracking.sites (tenant_id, site_id, app_id, public_ingest_key)
   VALUES ($1, $2, $3, $4)`,
  [site.tenantId, site.siteId, site.appId, site.publicKey],
);

const registry = createEventRegistry();
registerContentViewEvents(registry);
const consents = createMemoryConsentStore();
recordConsent({
  store: consents,
  appId: site.appId,
  purpose: "analytics",
  state: "granted",
  recordedAt: "2026-09-21T12:00:00.000Z",
});

const batchAcceptance = createScopedPostgresBatchAcceptance({
  pool,
  tenantId: site.tenantId,
  siteId: site.siteId,
});

const collect = createBrowserCollectHandler({
  sites: createStaticSiteRegistry([site]),
  registry,
  createContractOptions: () => ({
    appId: site.appId,
    registry,
    collector: collectorContext,
    envelopeStore: {
      append: async () => ({ duplicate: false }),
      get: async () => undefined,
      list: () => [],
    },
    consents,
    clock: { now: () => new Date("2026-09-21T12:00:00.000Z") },
  }),
  batchAcceptance,
  requirePublicKey: true,
});

const eventBody = {
  appId: site.appId,
  event_id: "evt_collector_pg_demo",
  schema_version: 1,
  event_name: "content.view",
  occurred_at: "2026-09-21T12:00:00.000Z",
  subject: { objectType: "listing", objectId: "job_demo" },
  properties: { path: "/jobs/demo", content_type: "listing" },
};

const post = () =>
  collect(
    new Request(`https://collect.example/v1/collect/${site.publicKey}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example",
      },
      body: JSON.stringify(eventBody),
    }),
  );

const first = await post();
const second = await post();
if (first.status !== 202 || second.status !== 202) {
  throw new Error(`expected 202, got ${first.status} / ${second.status}`);
}

const conflict = await collect(
  new Request(`https://collect.example/v1/collect/${site.publicKey}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example",
    },
    body: JSON.stringify({
      ...eventBody,
      properties: { path: "/other", content_type: "listing" },
    }),
  }),
);
const conflictJson = await conflict.json();
if (conflict.status !== 202) {
  throw new Error(`expected 202 with rejected outcome, got ${conflict.status}`);
}
const conflictOutcome = conflictJson.outcomes?.[0];
if (conflictOutcome?.status !== "rejected" || conflictOutcome.reason !== "payload-conflict") {
  throw new Error("expected payload-conflict outcome on property mismatch");
}

const ops = await pool.query(
  `SELECT metric, counter::text FROM tracking.ops_site_counters
   WHERE tenant_id = $1 AND site_id = $2 ORDER BY metric`,
  [site.tenantId, site.siteId],
);
const byMetric = Object.fromEntries(ops.rows.map((row) => [row.metric, Number(row.counter)]));
if (byMetric.ingest_accepted !== 1) {
  throw new Error(`expected ingest_accepted=1, got ${byMetric.ingest_accepted}`);
}
if (byMetric.ingest_duplicate !== 1) {
  throw new Error(`expected ingest_duplicate=1, got ${byMetric.ingest_duplicate}`);
}
if (byMetric.ingest_conflict !== 1) {
  throw new Error(`expected ingest_conflict=1, got ${byMetric.ingest_conflict}`);
}

await pool.end();
console.log("collector-postgres example: ok", byMetric);
