import { describe, expect, it } from "vitest";
import { recordConsent, createMemoryConsentStore } from "../src/core/consent";
import { createIngestHandler } from "../src/server";
import { createTrackingPipeline } from "../src/core/pipeline";
import { createMemoryEventStore } from "../src/core/store";

const setup = () => {
  const consents = createMemoryConsentStore();
  const store = createMemoryEventStore();
  const pipeline = createTrackingPipeline({
    appId: "app-a",
    store,
    consents,
    clock: { now: () => new Date("2026-09-21T12:00:00.000Z") },
    ids: { eventId: () => "evt_http", visitorId: () => "vis_http" },
  });
  recordConsent({
    store: consents,
    appId: "app-a",
    purpose: "analytics",
    state: "granted",
    recordedAt: "2026-09-21T12:00:00.000Z",
  });
  return { handler: createIngestHandler(pipeline), store };
};

describe("HTTP ingest", () => {
  it("rejects browser attempts to set trust_class or tenant_id", async () => {
    const { handler } = setup();
    const response = await handler(
      new Request("https://app.example/t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appId: "app-a",
          name: "page_view",
          trust_class: "trusted",
          tenant_id: "tenant_evil",
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, reason: "forbidden-producer-field" });
  });

  it("accepts browser beacons as untrusted and ignores client-supplied server origin", async () => {
    const { handler, store } = setup();
    const response = await handler(
      new Request("https://app.example/t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appId: "app-a",
          name: "page_view",
          origin: "server",
          accountId: "acct_stolen",
          properties: { path: "/docs?token=abc" },
        }),
      }),
    );
    expect(response.status).toBe(202);
    const events = store.list();
    expect(events).toHaveLength(1);
    expect(events[0]?.origin).toBe("browser");
    expect(events[0]?.trust).toBe("untrusted");
    expect(events[0]?.subject).toEqual({ type: "none" });
    expect(events[0]?.properties.path).toBe("/docs");
  });

  it("does not echo rejected PII back in the response body", async () => {
    const { handler } = setup();
    const response = await handler(
      new Request("https://app.example/t", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appId: "app-a",
          name: "page_view",
          properties: { email: "ada@example.com" },
        }),
      }),
    );
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain("ada@example.com");
    expect(JSON.parse(text)).toEqual({ ok: false, reason: "pii-rejected" });
  });
});
