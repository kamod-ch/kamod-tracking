import { describe, expect, it } from "vitest";
import {
  createBrowserTracker,
  createMemoryKeyValueStorage,
  createMemoryTransport,
} from "../src/browser";

const now = () => new Date("2026-09-21T12:00:00.000Z");

const enableSending = (tracker: ReturnType<typeof createBrowserTracker>) => {
  tracker.configureCapture({ enableNetworkSending: true });
};

describe("browser identity", () => {
  it("does not create a visitor or session id by default even after collection is granted", async () => {
    const storage = createMemoryKeyValueStorage();
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      sessionStorage: storage,
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "vis_a" },
    });

    tracker.setConsent("analytics", "granted");
    enableSending(tracker);
    const allowed = await tracker.pageView({ path: "/home" });
    expect(allowed.ok).toBe(true);
    expect(storage.getItem("kamod-tracking:app-a:sid")).toBeNull();
    expect(storage.getItem("kamod-tracking:app-a:vid")).toBeNull();
    expect(transport.sent[0]?.subject).toEqual({ type: "none" });
    expect(transport.sent[0]?.session).toBeUndefined();
  });

  it("scopes session ids to appId and does not write one before consent", async () => {
    const storage = createMemoryKeyValueStorage();
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      identityMode: "session",
      sessionStorage: storage,
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_a" },
    });

    const denied = await tracker.pageView({ path: "/home" });
    expect(denied.ok).toBe(false);
    expect(storage.getItem("kamod-tracking:app-a:sid")).toBeNull();

    tracker.setConsent("analytics", "granted");
    enableSending(tracker);
    const allowed = await tracker.pageView({ path: "/home" });
    expect(allowed.ok).toBe(true);
    expect(storage.getItem("kamod-tracking:app-a:sid")).toContain("sid_a");
    expect(storage.getItem("kamod-tracking:app-b:sid")).toBeNull();
    expect(transport.sent[0]?.session).toEqual({ sessionId: "sid_a" });
    expect(transport.sent[0]?.subject).toEqual({ type: "none" });
    expect(transport.sent[0]?.legalBasis).toEqual({ kind: "unspecified" });
  });

  it("does not share session ids across app ids in the same storage", async () => {
    const storage = createMemoryKeyValueStorage();
    let n = 0;
    const sequential = {
      eventId: () => `evt_${++n}`,
      visitorId: () => `sid_${++n}`,
    };
    const a = createBrowserTracker({
      appId: "app-a",
      identityMode: "session",
      sessionStorage: storage,
      ids: sequential,
      now,
      transport: createMemoryTransport(),
    });
    const b = createBrowserTracker({
      appId: "app-b",
      identityMode: "session",
      sessionStorage: storage,
      ids: sequential,
      now,
      transport: createMemoryTransport(),
    });
    a.setConsent("analytics", "granted");
    b.setConsent("analytics", "granted");
    a.configureCapture({ enableNetworkSending: true });
    b.configureCapture({ enableNetworkSending: true });
    await a.pageView({ path: "/" });
    await b.pageView({ path: "/" });
    expect(storage.getItem("kamod-tracking:app-a:sid")).not.toBe(
      storage.getItem("kamod-tracking:app-b:sid"),
    );
  });

  it("accepts legacy visitorIdentity app-scoped as session mode", async () => {
    const storage = createMemoryKeyValueStorage();
    const transport = createMemoryTransport();
    const tracker = createBrowserTracker({
      appId: "app-a",
      visitorIdentity: "app-scoped",
      sessionStorage: storage,
      transport,
      now,
      ids: { eventId: () => "evt_1", visitorId: () => "sid_legacy" },
    });
    tracker.setConsent("analytics", "granted");
    enableSending(tracker);
    await tracker.pageView({ path: "/" });
    expect(transport.sent[0]?.session?.sessionId).toBe("sid_legacy");
  });

  it("does not expose an identify API that could link anonymous and signed-in subjects", () => {
    const tracker = createBrowserTracker({
      appId: "app-a",
      storage: createMemoryKeyValueStorage(),
      transport: createMemoryTransport(),
    });
    expect("identify" in tracker).toBe(false);
    expect(typeof tracker.pageView).toBe("function");
    expect(typeof tracker.track).toBe("function");
    expect(typeof tracker.getConsent).toBe("function");
    expect(typeof tracker.setConsent).toBe("function");
    expect(typeof tracker.configureCapture).toBe("function");
    expect(typeof tracker.adoptExternalConsent).toBe("function");
    expect(typeof tracker.revokeCapture).toBe("function");
  });
});
