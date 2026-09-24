import { describe, expect, it } from "vitest";
import { recordConsent, createMemoryConsentStore } from "../src/core/consent";
import { createEventRegistry } from "../src/core/registry";
import { registerContentViewEvents } from "../src/core/events/content-view";
import {
  createMemoryBatchEnvelopeAcceptance,
  createResettableMemoryEnvelopeStore,
  createServerCollectHandler,
  eventIdFromOutboxId,
  statusForServerCollectReject,
} from "../src/server";

const collectorContext = {
  tenantId: "tenant_a",
  siteId: "site_1",
  measurementRuleVersion: "mr_v1",
  collectionPolicyVersion: "cp_v1",
  allowedBrowserIdentityModes: ["none"] as const,
  browserIdentityMode: "none" as const,
};

const site = {
  publicKey: "pk_test",
  tenantId: "tenant_a",
  siteId: "site_1",
  appId: "app-a",
  collector: collectorContext,
  allowedOrigins: ["https://app.example"],
  browserIdentityMode: "none" as const,
};

const otherSite = {
  ...site,
  siteId: "site_other",
  appId: "app-other",
  publicKey: "pk_other",
};

const setupServer = (options: {
  store?: ReturnType<typeof createResettableMemoryEnvelopeStore>;
  outboxWriter?: import("../src/server/outbox").OutboxEventWriter;
  authSite?: typeof site;
  token?: string;
}) => {
  const store = options.store ?? createResettableMemoryEnvelopeStore();
  const registry = createEventRegistry();
  registerContentViewEvents(registry);
  const consents = createMemoryConsentStore();
  recordConsent({
    store: consents,
    appId: "app-a",
    purpose: "analytics",
    state: "granted",
    recordedAt: "2026-09-21T12:00:00.000Z",
  });
  const authSite = options.authSite ?? site;
  const handler = createServerCollectHandler({
    auth: { kind: "static-token", token: options.token ?? "secret-token", site: authSite },
    createContractOptions: () => ({
      appId: authSite.appId,
      registry,
      collector: collectorContext,
      envelopeStore: store,
      consents,
      clock: { now: () => new Date("2026-09-21T12:00:00.000Z") },
    }),
    batchAcceptance: createMemoryBatchEnvelopeAcceptance(store),
    ...(options.outboxWriter !== undefined ? { outboxWriter: options.outboxWriter } : {}),
  });
  return { handler, store, registry };
};

const outboxBody = (overrides: Record<string, unknown> = {}) => ({
  outboxId: "obx_1",
  eventName: "content.view",
  schemaVersion: 1,
  occurredAt: "2026-09-21T12:00:00.000Z",
  subject: { objectType: "none" },
  properties: { path: "/jobs/1", content_type: "listing" },
  ...overrides,
});

const postServer = (
  handler: ReturnType<typeof createServerCollectHandler>,
  body: unknown,
  token = "secret-token",
) =>
  handler(
    new Request("https://internal.example/v1/server-events", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );

describe("server collector trusted outbox path", () => {
  it("rejects browser-origin claims on the trusted server path", async () => {
    const { handler } = setupServer({});
    const response = await postServer(handler, outboxBody({ origin: "browser" }));
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.reason).toBe("producer-not-allowed");
  });

  it("rejects bearer token that does not match configured site", async () => {
    const { handler } = setupServer({});
    const response = await postServer(handler, outboxBody(), "wrong-token");
    expect(response.status).toBe(401);
  });

  it("rejects forged appId for authenticated site scope", async () => {
    const { handler } = setupServer({});
    const response = await postServer(handler, outboxBody({ appId: "app-other" }));
    expect(response.status).toBe(statusForServerCollectReject("unknown-app"));
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.reason).toBe("unknown-app");
  });

  it("rejects unregistered events before storage or outbox writer", async () => {
    const writes: unknown[] = [];
    const { handler } = setupServer({
      outboxWriter: {
        async write(input) {
          writes.push(input);
          return { ok: true, eventId: input.envelope.event_id, duplicate: false };
        },
      },
    });
    const response = await postServer(
      handler,
      outboxBody({ eventName: "employer.plan_upgraded", schemaVersion: 1 }),
    );
    expect(response.status).toBe(statusForServerCollectReject("unknown-event"));
    expect(writes).toHaveLength(0);
  });

  it("does not map permanent validation failures to retryable storage errors", async () => {
    const { handler } = setupServer({});
    const response = await postServer(handler, outboxBody({ schemaVersion: 99 }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.retryable).toBeUndefined();
    expect(json.reason).toBe("unknown-version");
  });

  it("returns rejected adapter outcomes to callers", async () => {
    const store = createResettableMemoryEnvelopeStore();
    const { handler } = setupServer({ store });
    const first = await postServer(handler, outboxBody({ outboxId: "obx_conflict" }));
    expect(first.status).toBe(202);
    const second = await postServer(
      handler,
      outboxBody({
        outboxId: "obx_conflict",
        properties: { path: "/other", content_type: "listing" },
      }),
    );
    expect(second.status).toBe(409);
    const json = await second.json();
    expect(json.ok).toBe(false);
    expect(json.reason).toBe("payload-conflict");
  });

  it("marks duplicate replay with stable eventIdFromOutboxId", async () => {
    const { handler } = setupServer({});
    const first = await postServer(handler, outboxBody({ outboxId: "obx_replay" }));
    const second = await postServer(handler, outboxBody({ outboxId: "obx_replay" }));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstJson = await first.json();
    const secondJson = await second.json();
    expect(firstJson.eventId).toBe(eventIdFromOutboxId("obx_replay"));
    expect(secondJson.duplicate).toBe(true);
  });

  it("passes only validated envelopes to custom outboxWriter", async () => {
    const writes: import("../src/server/outbox").ValidatedOutboxWriteInput[] = [];
    const { handler } = setupServer({
      outboxWriter: {
        async write(input) {
          writes.push(input);
          return { ok: true, eventId: input.envelope.event_id, duplicate: false };
        },
      },
    });
    const response = await postServer(handler, outboxBody());
    expect(response.status).toBe(202);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.envelope.producer).toBe("server");
    expect(writes[0]?.envelope.site_id).toBe(site.siteId);
  });

  it("surfaces writer storage failures as retryable 503 only for storage-error", async () => {
    const { handler } = setupServer({
      outboxWriter: {
        async write() {
          return { ok: false, reason: "storage-error", retryable: true };
        },
      },
    });
    const response = await postServer(handler, outboxBody({ outboxId: "obx_store_fail" }));
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.retryable).toBe(true);
  });

  it("rejects wrong site_id claim even with valid token", async () => {
    const { handler } = setupServer({ authSite: site });
    const response = await postServer(handler, outboxBody({ siteId: otherSite.siteId }));
    expect(response.status).toBe(400);
  });
});

describe("eventIdFromOutboxId", () => {
  it("derives stable ids", () => {
    expect(eventIdFromOutboxId("obx_123")).toBe(eventIdFromOutboxId("obx_123"));
    expect(eventIdFromOutboxId("obx_123").startsWith("obx_")).toBe(true);
  });
});
