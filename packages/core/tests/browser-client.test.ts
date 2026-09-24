import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordConsent, createMemoryConsentStore } from "../src/core/consent";
import { createEventRegistry } from "../src/core/registry";
import { registerContentViewEvents } from "../src/core/events/content-view";
import {
  createBrowserTracker,
  createCollectorTransport,
  createMemoryTransport,
  type CollectorTransport,
} from "../src/browser";

const setup = (transport: CollectorTransport | ReturnType<typeof createMemoryTransport>) => {
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
  const collectorTransport =
    "sendBatch" in transport
      ? transport
      : ({
          async sendBatch(events) {
            const legacy = createMemoryTransport();
            await legacy.send(
              events.map((event) => ({
                id: event.event_id,
                appId: event.appId,
                name: event.event_name,
                purpose: event.purpose,
                collectedAt: event.occurred_at,
                properties: event.properties,
                origin: "browser",
                trust: "untrusted",
                consent: "granted",
                legalBasis: { kind: "unspecified" },
                receivedAt: event.occurred_at,
                timeBounds: {},
                subject: { type: "none" },
              })) as never,
            );
            return {
              delivery: "verified" as const,
              retryable: false,
              outcomes: events.map((event) => ({
                event_id: event.event_id,
                status: "accepted" as const,
                duplicate: false,
              })),
            };
          },
        } satisfies CollectorTransport);

  const tracker = createBrowserTracker({
    appId: "app-a",
    registry,
    consents,
    collectorTransport,
    ids: { eventId: () => "evt_stable", visitorId: () => "sid_1" },
    now: () => new Date("2026-09-21T12:00:00.000Z"),
    queue: { maxEvents: 2, maxBatchSize: 1 },
    maxRetries: 2,
  });
  tracker.configureCapture({ enableNetworkSending: true });
  return tracker;
};

describe("browser client transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the same event id across retries", async () => {
    let calls = 0;
    const transport: CollectorTransport = {
      async sendBatch(events) {
        calls += 1;
        if (calls === 1) {
          return { delivery: "failed", retryable: true, retryAfterSeconds: 1 };
        }
        expect(events[0]?.event_id).toBe("evt_stable");
        return {
          delivery: "verified",
          retryable: false,
          outcomes: [{ event_id: "evt_stable", status: "accepted", duplicate: false }],
        };
      },
    };
    const tracker = setup(transport);
    await tracker.capture({
      event_name: "content.view",
      schema_version: 1,
      event_id: "evt_stable",
      properties: { path: "/a", content_type: "page" },
    });
    await vi.waitFor(() => {
      expect(calls).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();
    expect(calls).toBe(2);
  });

  it("does not ack queue entries for foreign outcome ids", async () => {
    let sendCalls = 0;
    const transport: CollectorTransport = {
      async sendBatch(events) {
        sendCalls += 1;
        if (sendCalls === 1) {
          return {
            delivery: "verified",
            retryable: false,
            outcomes: [{ event_id: "evt_foreign", status: "accepted", duplicate: false }],
          };
        }
        return {
          delivery: "verified",
          retryable: false,
          outcomes: events.map((event) => ({
            event_id: event.event_id,
            status: "accepted" as const,
            duplicate: false,
          })),
        };
      },
    };
    const tracker = setup(transport);
    await tracker.capture({
      event_name: "content.view",
      schema_version: 1,
      event_id: "evt_real",
      properties: { path: "/a", content_type: "page" },
    });
    await vi.runAllTimersAsync();
    expect(sendCalls).toBeGreaterThanOrEqual(2);
  });

  it("retries after incomplete verified outcomes without immediate double send", async () => {
    let calls = 0;
    const transport: CollectorTransport = {
      async sendBatch(events) {
        calls += 1;
        if (calls === 1) {
          return {
            delivery: "verified",
            retryable: false,
            outcomes: [],
          };
        }
        return {
          delivery: "verified",
          retryable: false,
          outcomes: events.map((event) => ({
            event_id: event.event_id,
            status: "accepted" as const,
            duplicate: false,
          })),
        };
      },
    };
    const tracker = setup(transport);
    await tracker.capture({
      event_name: "content.view",
      schema_version: 1,
      event_id: "evt_gap",
      properties: { path: "/a", content_type: "page" },
    });
    await vi.waitFor(() => {
      expect(calls).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.runAllTimersAsync();
    expect(calls).toBe(2);
  });

  it("discards permanently invalid events without endless retry", async () => {
    const discards: string[] = [];
    const transport: CollectorTransport = {
      async sendBatch(events) {
        return {
          delivery: "verified",
          retryable: false,
          outcomes: events.map((event) => ({
            event_id: event.event_id,
            status: "rejected" as const,
            reason: "invalid-payload" as const,
          })),
        };
      },
    };
    const tracker = setup(transport);
    tracker.onDiscard(({ eventId }) => discards.push(eventId));
    await tracker.capture({
      event_name: "content.view",
      schema_version: 1,
      event_id: "evt_bad",
      properties: { path: "/a", content_type: "page" },
    });
    await vi.runAllTimersAsync();
    expect(discards).toContain("evt_bad");
  });

  it("drops events when the in-memory queue is full", async () => {
    const discards: string[] = [];
    const transport: CollectorTransport = {
      async sendBatch() {
        return { delivery: "failed", retryable: true };
      },
    };
    const tracker = setup(transport);
    tracker.configureCapture({ enableNetworkSending: false });
    tracker.onDiscard(({ reason }) => discards.push(reason));
    for (let i = 0; i < 4; i += 1) {
      await tracker.capture({
        event_name: "content.view",
        schema_version: 1,
        event_id: `evt_${i}`,
        properties: { path: `/p${i}`, content_type: "page" },
      });
    }
    expect(discards).toContain("queue-full");
  });

  it("clears the queue and stops sending after consent revoke during backoff", async () => {
    const transport: CollectorTransport = {
      async sendBatch() {
        return { delivery: "failed", retryable: true, retryAfterSeconds: 5 };
      },
    };
    const tracker = setup(transport);
    await tracker.capture({
      event_name: "content.view",
      schema_version: 1,
      event_id: "evt_revoke",
      properties: { path: "/a", content_type: "page" },
    });
    tracker.revokeCapture("analytics");
    await vi.advanceTimersByTimeAsync(5000);
    const after = await tracker.flush();
    expect(after.flushed).toBe(0);
  });

  it("treats beacon success as browser-accepted not verified", async () => {
    let beaconUsed = false;
    let beaconBody: BodyInit | null | undefined;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const transport = createCollectorTransport({
      endpoint: "https://collect.example",
      publicKey: "pk_test",
      sendBeacon: (_url, data) => {
        beaconUsed = true;
        beaconBody = data;
        return true;
      },
    });
    const tracker = setup(transport);
    tracker.configureCapture({ enableNetworkSending: false });
    await tracker.capture({
      event_name: "content.view",
      schema_version: 1,
      event_id: "evt_beacon",
      properties: { path: "/a", content_type: "page" },
    });
    tracker.configureCapture({ enableNetworkSending: true });
    await tracker.flush({ unload: true });
    expect(beaconUsed).toBe(true);
    expect(beaconBody).toBeInstanceOf(Blob);
    expect((beaconBody as Blob).type).toBe("application/json");
    vi.unstubAllGlobals();
  });

  it("destroy is idempotent and stops timers", async () => {
    const tracker = setup(createMemoryTransport());
    tracker.destroy();
    tracker.destroy();
    await expect(
      tracker.capture({
        event_name: "content.view",
        schema_version: 1,
        properties: { path: "/a", content_type: "page" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "capture-disabled" });
  });
});
