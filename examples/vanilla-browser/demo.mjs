import {
  createEventRegistry,
  registerContentViewEvents,
  recordConsent,
  createMemoryConsentStore,
} from "@kamod-ch/tracking";
import { createBrowserTracker, createMemoryKeyValueStorage } from "@kamod-ch/tracking/browser";

const appId = "example-vanilla";
const registry = createEventRegistry();
registerContentViewEvents(registry);
const consents = createMemoryConsentStore();
const batches = [];
const collectorTransport = {
  async sendBatch(events) {
    batches.push(events);
    return {
      delivery: "verified",
      retryable: false,
      outcomes: events.map((event) => ({
        event_id: event.event_id,
        status: "accepted",
        duplicate: false,
      })),
    };
  },
};

const tracker = createBrowserTracker({
  appId,
  registry,
  consents,
  collectorTransport,
  storage: createMemoryKeyValueStorage(),
  ids: { eventId: () => "evt_vanilla_demo", visitorId: () => "vis_unused" },
  now: () => new Date("2026-09-21T12:00:00.000Z"),
});

await tracker.pageView({ path: "/blocked", content_type: "page" });
await tracker.flush();
if (batches.length !== 0) {
  throw new Error("expected no sends before consent and configureCapture");
}

recordConsent({
  store: consents,
  appId,
  purpose: "analytics",
  state: "granted",
  recordedAt: "2026-09-21T12:00:00.000Z",
});
tracker.setConsent("analytics", "granted");
tracker.configureCapture({ identityMode: "none", enableNetworkSending: true });

await tracker.pageView({ path: "/jobs", content_type: "page" });
await tracker.flush();
if (batches.length !== 1) {
  throw new Error(`expected 1 batch after grant, got ${batches.length}`);
}

tracker.setConsent("analytics", "denied");
await tracker.pageView({ path: "/after-revoke", content_type: "page" });
await tracker.flush();
if (batches.length !== 1) {
  throw new Error("revoke should stop further browser sends");
}

console.log("vanilla-browser example: ok");
