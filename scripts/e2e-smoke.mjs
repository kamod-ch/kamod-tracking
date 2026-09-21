import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEventRegistry,
  registerContentViewEvents,
  recordConsent,
  createMemoryConsentStore,
} from "@kamod-ch/tracking";
import {
  createBrowserCollectHandler,
  createMemoryBatchEnvelopeAcceptance,
  createResettableMemoryEnvelopeStore,
  createStaticSiteRegistry,
} from "@kamod-ch/tracking/server";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const run = (label, command) => {
  console.log(`\n[e2e] ${label}`);
  execSync(command, { cwd: repoRoot, stdio: "inherit" });
};

run("vanilla browser (consent + revoke)", "node examples/vanilla-browser/demo.mjs");
run("server outbox dedup", "node examples/server-outbox-postgres/outbox-demo.mjs");

const collectorContext = {
  tenantId: "tenant_e2e",
  siteId: "site_e2e",
  measurementRuleVersion: "mr_v1",
  collectionPolicyVersion: "none",
  allowedBrowserIdentityModes: ["none"],
  browserIdentityMode: "none",
};
const site = {
  publicKey: "pk_e2e",
  tenantId: collectorContext.tenantId,
  siteId: collectorContext.siteId,
  appId: "app-e2e",
  collector: collectorContext,
  allowedOrigins: ["https://app.example"],
  browserIdentityMode: "none",
};
const registry = createEventRegistry();
registerContentViewEvents(registry);
const consents = createMemoryConsentStore();
for (const purpose of ["analytics", "measurement"]) {
  recordConsent({
    store: consents,
    appId: site.appId,
    purpose,
    state: "granted",
    recordedAt: "2026-09-21T12:00:00.000Z",
  });
}
const store = createResettableMemoryEnvelopeStore();
const browserCollect = createBrowserCollectHandler({
  sites: createStaticSiteRegistry([site]),
  registry,
  createContractOptions: () => ({
    appId: site.appId,
    registry,
    collector: collectorContext,
    envelopeStore: store,
    consents,
  }),
  batchAcceptance: createMemoryBatchEnvelopeAcceptance(store),
  requirePublicKey: false,
});
const event = {
  appId: site.appId,
  event_id: "evt_e2e_dedup",
  schema_version: 1,
  event_name: "content.view",
  occurred_at: "2026-09-21T12:00:00.000Z",
  subject: { objectType: "listing", objectId: "job_card_1" },
  properties: { path: "/jobs/1", content_type: "listing" },
};
for (let i = 0; i < 2; i++) {
  const response = await browserCollect(
    new Request("https://collect.example/v1/collect/pk_e2e", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example" },
      body: JSON.stringify(event),
    }),
  );
  if (response.status !== 202) {
    throw new Error(`collector expected 202, got ${response.status}`);
  }
}
if (store.list().length !== 1) {
  throw new Error("duplicate event_id must not increase stored count");
}
console.log("[e2e] browser collector dedup: ok");

const browserMod = await import("@kamod-ch/tracking/browser");
browserMod.createBrowserTracker({
  appId: "ssr-check",
  storage: browserMod.createMemoryKeyValueStorage(),
  transport: browserMod.createMemoryTransport(),
});
console.log("[e2e] SSR-safe browser import: ok");

run(
  "Preact SSR, hydration, visibility job card",
  "pnpm --filter @kamod-ch/tracking exec vitest run tests/browser-ssr.test.ts tests/preact.test.tsx",
);

if (process.env.TRACKING_TEST_DATABASE_URL) {
  run(
    "PostgreSQL ingest + daily aggregate",
    "pnpm --filter @kamod-ch/tracking exec vitest run tests/postgres.integration.test.ts tests/postgres-aggregation.integration.test.ts",
  );
} else {
  console.log(
    "\n[e2e] PostgreSQL path skipped — set TRACKING_TEST_DATABASE_URL for full ingest → aggregate run",
  );
}

console.log("\n[e2e] smoke completed");
