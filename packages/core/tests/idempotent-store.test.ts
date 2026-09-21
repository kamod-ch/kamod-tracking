import { describe, expect, it } from "vitest";
import { recordConsent, createMemoryConsentStore } from "../src/core/consent";
import { createTrackingPipeline } from "../src/core/pipeline";
import { createMemoryEventStore } from "../src/core/store";

const ids = { eventId: () => "evt_dup", visitorId: () => "vis_1" };
const clock = { now: () => new Date("2026-09-21T12:00:00.000Z") };

describe("idempotent store", () => {
  it("accepts a retried event id without storing it twice", async () => {
    const consents = createMemoryConsentStore();
    const store = createMemoryEventStore();
    const pipeline = createTrackingPipeline({ appId: "app-a", store, consents, clock, ids });
    recordConsent({
      store: consents,
      appId: "app-a",
      purpose: "analytics",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });

    const first = await pipeline.ingest({
      id: "evt_dup",
      appId: "app-a",
      name: "cta_click",
      origin: "browser",
    });
    const second = await pipeline.ingest({
      id: "evt_dup",
      appId: "app-a",
      name: "cta_click",
      origin: "browser",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(store.list()).toHaveLength(1);
    expect(store.get("evt_dup")?.id).toBe("evt_dup");
  });
});
