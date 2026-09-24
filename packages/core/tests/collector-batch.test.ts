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

  it("rejects forbidden Origin even when Referer matches allowlist", async () => {
    const { handler } = setupBrowser();
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          referer: "https://app.example/page",
        },
        body: JSON.stringify(browserEvent()),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("OPTIONS preflight returns Vary Origin and echoes allowed Origin", async () => {
    const { handler } = setupBrowser();
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "OPTIONS",
        headers: { origin: "https://app.example" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example");
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

  it("rejects missing event_id without using unknown as the outcome id", async () => {
    const { handler } = setupBrowser();
    const { event_id: _removed, ...withoutId } = browserEvent();
    void _removed;
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify(withoutId),
      }),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      outcomes: { event_id: string; status: string; reason?: string }[];
    };
    expect(body.outcomes[0]?.status).toBe("rejected");
    expect(body.outcomes[0]?.reason).toBe("invalid-payload");
    expect(body.outcomes[0]?.event_id).toBe("");
    expect(JSON.stringify(body)).not.toContain("unknown");
  });

  it("rejects payload-conflict when an existing id is reused with different content", async () => {
    const { handler, store } = setupBrowser();
    const first = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify(browserEvent()),
      }),
    );
    expect(first.status).toBe(202);
    expect(store.list()).toHaveLength(1);

    const second = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify(
          browserEvent({
            occurred_at: "2026-09-21T12:05:00.000Z",
            properties: { path: "/other", content_type: "article" },
          }),
        ),
      }),
    );
    expect(second.status).toBe(202);
    const body = (await second.json()) as {
      outcomes: { status: string; reason?: string }[];
    };
    expect(body.outcomes[0]?.status).toBe("rejected");
    expect(body.outcomes[0]?.reason).toBe("payload-conflict");
    expect(store.list()).toHaveLength(1);
  });

  it("rejects conflicting duplicate ids within one batch", async () => {
    const { handler, store } = setupBrowser();
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify({
          appId: "app-a",
          events: [
            browserEvent(),
            browserEvent({
              occurred_at: "2026-09-21T12:05:00.000Z",
              properties: { path: "/changed", content_type: "article" },
            }),
          ],
        }),
      }),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      outcomes: { status: string; reason?: string; duplicate?: boolean }[];
    };
    expect(body.outcomes[0]?.status).toBe("accepted");
    expect(body.outcomes[0]?.duplicate).toBe(false);
    expect(body.outcomes[1]?.status).toBe("rejected");
    expect(body.outcomes[1]?.reason).toBe("payload-conflict");
    expect(store.list()).toHaveLength(1);
  });

  it("accepts an identical retry after a stored event (lost ack)", async () => {
    const { handler, store } = setupBrowser();
    await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify(browserEvent()),
      }),
    );
    expect(store.list()).toHaveLength(1);
    const retry = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify(browserEvent()),
      }),
    );
    const body = (await retry.json()) as {
      outcomes: { status: string; duplicate?: boolean }[];
    };
    expect(body.outcomes[0]?.status).toBe("accepted");
    expect(body.outcomes[0]?.duplicate).toBe(true);
    expect(store.list()).toHaveLength(1);
  });

  it("preserves adapter rejections in mergeOutcomes", async () => {
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
    const handler = createBrowserCollectHandler({
      sites: createStaticSiteRegistry([site]),
      registry,
      createContractOptions: () => ({
        appId: "app-a",
        registry,
        collector: collectorContext,
        envelopeStore: store,
        consents,
      }),
      batchAcceptance: {
        async acceptBatch(envelopes) {
          return {
            ok: true as const,
            outcomes: envelopes.map((envelope) => ({
              event_id: envelope.event_id,
              status: "rejected" as const,
              reason: "invalid-payload" as const,
            })),
          };
        },
      },
      requirePublicKey: false,
    });
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify(browserEvent()),
      }),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      outcomes: { status: string; reason?: string }[];
    };
    expect(body.outcomes[0]?.status).toBe("rejected");
    expect(body.outcomes[0]?.reason).toBe("invalid-payload");
  });

  it("does not keep optimistic accepted when adapter outcomes are missing", async () => {
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
    const handler = createBrowserCollectHandler({
      sites: createStaticSiteRegistry([site]),
      registry,
      createContractOptions: () => ({
        appId: "app-a",
        registry,
        collector: collectorContext,
        envelopeStore: store,
        consents,
      }),
      batchAcceptance: {
        async acceptBatch() {
          return { ok: true as const, outcomes: [] };
        },
      },
      requirePublicKey: false,
    });
    const response = await handler(
      new Request("https://collect.example/v1/collect/pk_test", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify(browserEvent()),
      }),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      outcomes: { status: string; reason?: string }[];
    };
    expect(body.outcomes[0]?.status).toBe("rejected");
    expect(body.outcomes[0]?.reason).toBe("storage-error");
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

describe("server collector (legacy placement)", () => {
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
});
