import {
  createEventRegistry,
  registerContentViewEvents,
  recordConsent,
  createMemoryConsentStore,
} from "@kamod-ch/tracking";
import {
  createMemoryBatchEnvelopeAcceptance,
  createResettableMemoryEnvelopeStore,
  createServerCollectHandler,
  eventIdFromOutboxId,
} from "@kamod-ch/tracking/server";

const collectorContext = {
  tenantId: "tenant_example",
  siteId: "site_example",
  measurementRuleVersion: "mr_v1",
  collectionPolicyVersion: "none",
  allowedBrowserIdentityModes: ["none"],
  browserIdentityMode: "none",
};

const site = {
  publicKey: "pk_example",
  tenantId: collectorContext.tenantId,
  siteId: collectorContext.siteId,
  appId: "app-example",
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
const handler = createServerCollectHandler({
  auth: { kind: "static-token", token: "server-secret", site },
  createContractOptions: () => ({
    appId: site.appId,
    registry,
    collector: collectorContext,
    envelopeStore: store,
    consents,
  }),
  batchAcceptance: createMemoryBatchEnvelopeAcceptance(store),
});

const body = {
  outboxId: "obx_demo_1",
  eventName: "content.view",
  schemaVersion: 1,
  occurredAt: "2026-09-21T12:00:00.000Z",
  subject: { objectType: "listing", objectId: "job_42" },
  properties: { path: "/jobs/42", content_type: "listing" },
  origin: "server",
};

const post = () =>
  handler(
    new Request("https://internal.example/v1/server-events", {
      method: "POST",
      headers: {
        authorization: "Bearer server-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );

const first = await post();
const second = await post();
if (first.status !== 202 || second.status !== 202) {
  throw new Error(`expected 202, got ${first.status} / ${second.status}`);
}
const expectedId = eventIdFromOutboxId(body.outboxId);
if (store.list().length !== 1) {
  throw new Error(`expected 1 stored envelope, got ${store.list().length}`);
}
if (store.list()[0]?.event_id !== expectedId) {
  throw new Error("event_id must be derived from outboxId");
}

const secondJson = await second.json();
if (secondJson.duplicate !== true) {
  throw new Error("second outbox replay should be marked duplicate");
}

console.log("server-outbox example: ok");
