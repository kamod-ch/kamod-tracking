import { describe, expect, it } from "vitest";
import { recordConsent, createMemoryConsentStore } from "../src/core/consent";
import { createEventRegistry } from "../src/core/registry";
import { registerContentViewEvents } from "../src/core/events/content-view";
import {
  createBrowserCollectHandler,
  createFailingBatchAcceptance,
  createMemoryBatchEnvelopeAcceptance,
  createMemoryRateLimiter,
  createResettableMemoryEnvelopeStore,
  createServerCollectHandler,
  createStaticSiteRegistry,
  DEFAULT_MAX_BATCH_BYTES,
  DEFAULT_MAX_BATCH_EVENTS,
  eventIdFromOutboxId,
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

const setupBrowser = (store = createResettableMemoryEnvelopeStore()) => {
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
  const handler = createBrowserCollectHandler({
    sites: createStaticSiteRegistry([site]),
    registry,
    createContractOptions: () => ({
      appId: "app-a",
      registry,
      collector: collectorContext,
      envelopeStore: store,
      consents,
      clock: { now: () => new Date("2026-09-21T12:00:00.000Z") },
    }),
    batchAcceptance: createMemoryBatchEnvelopeAcceptance(store),
    requirePublicKey: false,
  });
  return { handler, store, registry };
};

const browserEvent = (overrides: Record<string, unknown> = {}) => ({
  appId: "app-a",
  event_id: "evt_browser_1",
  schema_version: 1,
  event_name: "content.view",
  occurred_at: "2026-09-21T12:00:00.000Z",
  subject: { objectType: "none" },
  properties: { path: "/docs", content_type: "article" },
  ...overrides,
});

describe("browser batch collector", () => {
  it("rejects forged server producer claims on the public browser path", async () => {
    const { handler } = setupBrowser();
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example",
        },
        body: JSON.stringify(browserEvent({ producer: "server", trust_class: "trusted" })),
      }),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { outcomes: { status: string; reason?: string }[] };
    expect(body.outcomes[0]?.status).toBe("rejected");
    expect(body.outcomes[0]?.reason).toBe("forbidden-producer-field");
  });

  it("rejects client-supplied tenant identifiers", async () => {
    const { handler } = setupBrowser();
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example",
        },
        body: JSON.stringify(browserEvent({ tenant_id: "tenant_evil" })),
      }),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { outcomes: { reason?: string }[] };
    expect(body.outcomes[0]?.reason).toBe("forbidden-producer-field");
  });

  it("rejects disallowed origins", async () => {
    const { handler } = setupBrowser();
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify(browserEvent()),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects oversized batch bodies before parsing", async () => {
    const { handler } = setupBrowser();
    const big = "x".repeat(DEFAULT_MAX_BATCH_BYTES + 1);
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example",
          "content-length": String(big.length + 100),
        },
        body: JSON.stringify({
          events: [browserEvent({ properties: { path: "/", content_type: big } })],
        }),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("rejects batches above the configured event count", async () => {
    const { handler } = setupBrowser();
    const events = Array.from({ length: DEFAULT_MAX_BATCH_EVENTS + 1 }, (_, index) =>
      browserEvent({ event_id: `evt_${index}` }),
    );
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example",
        },
        body: JSON.stringify({ appId: "app-a", events }),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("returns schema errors per event without echoing sensitive login fields", async () => {
    const { handler } = setupBrowser();
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example",
        },
        body: JSON.stringify(
          browserEvent({
            properties: { path: "/login", content_type: "page", password: "hunter2" },
          }),
        ),
      }),
    );
    expect(response.status).toBe(202);
    const text = await response.text();
    expect(text).not.toContain("hunter2");
    const body = JSON.parse(text) as { outcomes: { status: string; reason?: string }[] };
    expect(body.outcomes[0]?.status).toBe("rejected");
  });

  it("marks duplicate events in a batch as accepted duplicates", async () => {
    const { handler, store } = setupBrowser();
    const payload = { appId: "app-a", events: [browserEvent(), browserEvent()] };
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example",
        },
        body: JSON.stringify(payload),
      }),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      outcomes: { status: string; duplicate?: boolean }[];
    };
    expect(body.outcomes.filter((o) => o.status === "accepted")).toHaveLength(2);
    expect(store.list()).toHaveLength(1);
  });

  it("returns retryable storage errors without leaking payloads", async () => {
    const store = createResettableMemoryEnvelopeStore();
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
    const wrapped = createBrowserCollectHandler({
      sites: createStaticSiteRegistry([site]),
      registry,
      createContractOptions: () => ({
        appId: "app-a",
        registry,
        collector: collectorContext,
        envelopeStore: store,
        consents,
      }),
      batchAcceptance: createFailingBatchAcceptance(),
      requirePublicKey: false,
    });
    const response = await wrapped(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example",
        },
        body: JSON.stringify(browserEvent()),
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    const text = await response.text();
    expect(text).not.toContain("/docs");
  });

  it("returns Retry-After when rate limited", async () => {
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
    const store = createResettableMemoryEnvelopeStore();
    const rateHandler = createBrowserCollectHandler({
      sites: createStaticSiteRegistry([site]),
      registry,
      createContractOptions: () => ({
        appId: "app-a",
        registry,
        collector: collectorContext,
        envelopeStore: store,
        consents,
      }),
      batchAcceptance: createMemoryBatchEnvelopeAcceptance(store),
      rateLimiter: createMemoryRateLimiter({ maxRequests: 1, windowMs: 60_000 }),
      requirePublicKey: false,
    });
    const req = () =>
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example",
        },
        body: JSON.stringify(browserEvent({ event_id: `evt_${Math.random()}` })),
      });
    await rateHandler(req());
    const blocked = await rateHandler(req());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });
});

describe("server collector", () => {
  it("rejects browser-origin business events on the trusted server path", async () => {
    const store = createResettableMemoryEnvelopeStore();
    const registry = createEventRegistry();
    registerContentViewEvents(registry);
    const consents = createMemoryConsentStore();
    recordConsent({
      store: consents,
      appId: "app-a",
      purpose: "measurement",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });
    const handler = createServerCollectHandler({
      auth: { kind: "static-token", token: "secret-token", site },
      createContractOptions: () => ({
        appId: "app-a",
        registry,
        collector: collectorContext,
        envelopeStore: store,
        consents,
      }),
      batchAcceptance: createMemoryBatchEnvelopeAcceptance(store),
    });
    const response = await handler(
      new Request("https://internal.example/v1/server-events", {
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          outboxId: "obx_1",
          eventName: "content.view",
          schemaVersion: 1,
          occurredAt: "2026-09-21T12:00:00.000Z",
          subject: { objectType: "none" },
          properties: { path: "/success", content_type: "page" },
          origin: "browser",
        }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("derives stable event ids from outbox ids for replay-safe writes", () => {
    const a = eventIdFromOutboxId("obx_123");
    const b = eventIdFromOutboxId("obx_123");
    expect(a).toBe(b);
    expect(a.startsWith("obx_")).toBe(true);
  });
});
