import { describe, expect, it, vi } from "vitest";
import {
  createBrowserTracker,
  createMemoryKeyValueStorage,
  createMemoryTransport,
} from "../src/browser";
import { createEventRegistry, defineEvent } from "../src/core/registry";
import { registerContentViewEvents } from "../src/core/events/content-view";
import { createViewLifecycle } from "../src/browser/view-lifecycle";
import type { KeyValueStorage } from "../src/core/types";

const now = () => new Date("2026-09-21T12:00:00.000Z");

const registryWithPurpose = () => {
  const registry = createEventRegistry();
  registerContentViewEvents(registry);
  registry.register(
    defineEvent({
      event_name: "devjobs.listing.view",
      schema_version: 1,
      producers: ["browser"],
      privacyClass: "public",
      collectionPurpose: "measurement",
      maxPayloadBytes: 2048,
      fields: [
        { kind: "path", key: "path", required: true },
        { kind: "objectId", key: "listing_id", required: true },
        { kind: "string", key: "canton", maxLength: 8, required: true },
      ],
    }),
  );
  return registry;
};

describe("consent, sessions, and view lifecycle", () => {
  it("rejects forged browser purpose overrides against registry policy", async () => {
    const tracker = createBrowserTracker({
      appId: "app-a",
      registry: registryWithPurpose(),
      transport: createMemoryTransport(),
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_1" },
    });
    tracker.setConsent("measurement", "granted");
    const result = await tracker.capture({
      event_name: "devjobs.listing.view",
      schema_version: 1,
      purpose: "analytics",
      properties: { path: "/jobs", listing_id: "job_1", canton: "ZH" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid-payload");
    }
  });

  it("does not persist session ids in localStorage when sessionStorage is absent", async () => {
    const local = createMemoryKeyValueStorage();
    vi.stubGlobal("localStorage", local);
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "tab-a",
      identityMode: "session",
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_tab_a" },
    });
    tracker.setConsent("analytics", "granted");
    tracker.configureCapture({ enableNetworkSending: true });
    await tracker.pageView({ path: "/home" });
    expect(local.getItem("kamod-tracking:tab-a:sid")).toBeNull();
    expect(transport.sent[0]?.session).toEqual({ sessionId: "sid_tab_a" });
    vi.unstubAllGlobals();
  });

  it("isolates in-memory session fallback per tracker instance (two tabs)", async () => {
    const transportA = createMemoryTransport();
    const transportB = createMemoryTransport();
    const trackerA = createBrowserTracker({
      appId: "app-a",
      identityMode: "session",
      transport: transportA,
      now,
      ids: { eventId: () => "evt_a", visitorId: () => "sid_tab_a" },
    });
    const trackerB = createBrowserTracker({
      appId: "app-a",
      identityMode: "session",
      transport: transportB,
      now,
      ids: { eventId: () => "evt_b", visitorId: () => "sid_tab_b" },
    });
    trackerA.setConsent("analytics", "granted");
    trackerB.setConsent("analytics", "granted");
    trackerA.configureCapture({ enableNetworkSending: true });
    trackerB.configureCapture({ enableNetworkSending: true });
    await trackerA.pageView({ path: "/a" });
    await trackerB.pageView({ path: "/b" });
    expect(transportA.sent[0]?.session?.sessionId).toBe("sid_tab_a");
    expect(transportB.sent[0]?.session?.sessionId).toBe("sid_tab_b");
  });

  it("treats throwing storage getters as unavailable session storage", async () => {
    const throwingStorage: KeyValueStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      identityMode: "session",
      sessionStorage: throwingStorage,
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_mem" },
    });
    tracker.setConsent("analytics", "granted");
    tracker.configureCapture({ enableNetworkSending: true });
    const result = await tracker.pageView({ path: "/home" });
    expect(result.ok).toBe(true);
    expect(transport.sent[0]?.session).toEqual({ sessionId: "sid_mem" });
  });

  it("denies capture revoked during async validation", async () => {
    const registry = registryWithPurpose();
    const tracker = createBrowserTracker({
      appId: "app-a",
      registry,
      transport: createMemoryTransport(),
      now,
      ids: { eventId: () => "evt_revoke", visitorId: () => "sid_1" },
    });
    tracker.setConsent("measurement", "granted");
    const original = registry.validateProperties.bind(registry);
    vi.spyOn(registry, "validateProperties").mockImplementation((...args) => {
      tracker.revokeCapture("measurement");
      return original(...args);
    });
    const result = await tracker.capture({
      event_name: "devjobs.listing.view",
      schema_version: 1,
      properties: { path: "/jobs", listing_id: "job_1", canton: "ZH" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("consent-denied");
    }
  });

  it("does not resend queued events after re-grant", async () => {
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      registry: registryWithPurpose(),
      transport,
      now,
      ids: { eventId: () => "evt_q", visitorId: () => "sid_1" },
      queue: { maxBatchSize: 10 },
    });
    tracker.setConsent("analytics", "granted");
    tracker.configureCapture({ enableNetworkSending: false });
    await tracker.pageView({ path: "/queued" });
    tracker.revokeCapture("analytics");
    tracker.setConsent("analytics", "granted");
    tracker.configureCapture({ enableNetworkSending: true });
    await tracker.flush();
    expect(transport.sent).toHaveLength(0);
    await tracker.pageView({ path: "/fresh" });
    await tracker.flush();
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.properties.path).toBe("/fresh");
  });

  it("keeps identical beginView calls idempotent for dedupe state", () => {
    const lifecycle = createViewLifecycle({ createViewId: () => "view_stable" });
    const first = lifecycle.beginView({ surface: "job-list" });
    lifecycle.markSubjectCounted("job_1");
    const second = lifecycle.beginView({ surface: "job-list" });
    expect(second).toBe(first);
    expect(lifecycle.shouldCountSubject("job_1")).toBe(false);
  });

  it("only commits page impressions after successful capture", async () => {
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      identityMode: "none",
      registry: registryWithPurpose(),
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_1" },
    });
    tracker.setConsent("analytics", "granted");
    const denied = await tracker.pageView({ path: "/home" });
    expect(denied.ok).toBe(true);
    tracker.setConsent("analytics", "denied");
    const second = await tracker.pageView({ path: "/home" });
    expect(second.ok).toBe(false);
  });
});
