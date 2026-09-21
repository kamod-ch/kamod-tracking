import { describe, expect, it, vi } from "vitest";
import {
  createBrowserTracker,
  createMemoryKeyValueStorage,
  createMemoryTransport,
  resolveBrowserSessionId,
} from "../src/browser";
import { DEFAULT_SESSION_LIMITS } from "../src/core/capture-policy";
import { createMemoryConsentStore, recordConsent } from "../src/core/consent";
import { createTrackingPipeline } from "../src/core/pipeline";
import { createMemoryEventStore } from "../src/core/store";
import type { DeliveryResult, Transport } from "../src/core/types";

const now = () => new Date("2026-09-21T12:00:00.000Z");

const enableAnalytics = (tracker: ReturnType<typeof createBrowserTracker>) => {
  tracker.setConsent("analytics", "granted");
  tracker.configureCapture({ enableNetworkSending: true });
};

describe("capture policy and identity modes", () => {
  it("does not send over the network until the host enables sending", async () => {
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_1" },
    });
    tracker.setConsent("analytics", "granted");
    const result = await tracker.pageView({ path: "/home" });
    expect(result.ok).toBe(true);
    expect(transport.sent).toHaveLength(0);
    expect(tracker.getCapturePolicy().networkSendingEnabled).toBe(false);
  });

  it("keeps none mode free of session and visitor continuity in payloads", async () => {
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      identityMode: "none",
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_1" },
    });
    enableAnalytics(tracker);
    await tracker.pageView({ path: "/home" });
    expect(transport.sent[0]?.subject).toEqual({ type: "none" });
    expect(transport.sent[0]?.session).toBeUndefined();
  });

  it("deduplicates page impressions in none mode using in-memory view state only", async () => {
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      identityMode: "none",
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_1" },
    });
    enableAnalytics(tracker);
    await tracker.pageView({ path: "/home" });
    const second = await tracker.pageView({ path: "/home" });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("duplicate-impression");
    }
    expect(transport.sent).toHaveLength(1);
  });

  it("uses session mode with tab storage and no visitor subject", async () => {
    const storage = createMemoryKeyValueStorage();
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      identityMode: "session",
      sessionStorage: storage,
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_tab" },
    });
    enableAnalytics(tracker);
    await tracker.pageView({ path: "/home" });
    expect(storage.getItem("kamod-tracking:app-a:sid")).toContain("sid_tab");
    expect(transport.sent[0]?.session).toEqual({ sessionId: "sid_tab" });
    expect(transport.sent[0]?.subject).toEqual({ type: "none" });
  });

  it("rotates session ids after inactivity", () => {
    const storage = createMemoryKeyValueStorage();
    const t0 = Date.parse("2026-09-21T12:00:00.000Z");
    storage.setItem(
      "kamod-tracking:app-a:sid",
      JSON.stringify({
        sessionId: "sid_old",
        createdAtMs: t0,
        lastActivityAtMs: t0,
      }),
    );
    const afterIdle = t0 + DEFAULT_SESSION_LIMITS.inactivityMs + 1;
    const next = resolveBrowserSessionId({
      storage,
      storageKey: "kamod-tracking:app-a:sid",
      ids: { eventId: () => "evt", visitorId: () => "sid_new" },
      nowMs: afterIdle,
    });
    expect(next).toBe("sid_new");
  });

  it("clears the unsent queue and session storage on revoke", async () => {
    let resolveSend: ((value: DeliveryResult) => void) | undefined;
    const blockingTransport: Transport = {
      send() {
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      },
    };
    const storage = createMemoryKeyValueStorage();
    let eventSeq = 0;
    const tracker = createBrowserTracker({
      appId: "app-a",
      identityMode: "session",
      sessionStorage: storage,
      transport: blockingTransport,
      now,
      ids: {
        eventId: () => `evt_${++eventSeq}`,
        visitorId: () => "sid_1",
      },
    });
    enableAnalytics(tracker);
    void tracker.pageView({ path: "/home" });
    expect(storage.getItem("kamod-tracking:app-a:sid")).not.toBeNull();
    tracker.revokeCapture("analytics");
    expect(storage.getItem("kamod-tracking:app-a:sid")).toBeNull();
    const blocked = await tracker.pageView({ path: "/other" });
    expect(blocked.ok).toBe(false);
    resolveSend?.({ accepted: 0, dropped: 1, guarantee: "best-effort" });
  });

  it("adopts consent snapshots from an external CMP without building a banner", () => {
    const tracker = createBrowserTracker({
      appId: "app-a",
      transport: createMemoryTransport(),
      now,
    });
    tracker.adoptExternalConsent({
      recordedAt: "2026-09-21T12:00:00.000Z",
      purposes: { analytics: "granted", measurement: "denied" },
    });
    expect(tracker.getConsent("analytics")).toBe("granted");
    expect(tracker.getConsent("measurement")).toBe("denied");
  });

  it("continues session resolution when storage throws", async () => {
    const storage = createMemoryKeyValueStorage();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      identityMode: "session",
      sessionStorage: storage,
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_fallback" },
    });
    enableAnalytics(tracker);
    const result = await tracker.pageView({ path: "/home" });
    expect(result.ok).toBe(true);
    expect(transport.sent[0]?.session).toEqual({ sessionId: "sid_fallback" });
  });

  it("rejects browser session payloads when collector policy is none", async () => {
    const consents = createMemoryConsentStore();
    recordConsent({
      store: consents,
      appId: "app-a",
      purpose: "analytics",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });
    const pipeline = createTrackingPipeline({
      appId: "app-a",
      store: createMemoryEventStore(),
      consents,
      identityMode: "none",
      collectorPolicy: {
        browserIdentityMode: "none",
        allowedBrowserIdentityModes: ["none"],
      },
    });
    const result = await pipeline.ingest({
      appId: "app-a",
      name: "page_view",
      origin: "browser",
      purpose: "analytics",
      session: { sessionId: "sid_1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("identity-not-allowed");
    }
  });
});
