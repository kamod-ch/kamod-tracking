import { describe, expect, it } from "vitest";
import { recordConsent, createMemoryConsentStore } from "../src/core/consent";
import { createMemoryEnvelopeStore } from "../src/core/envelope-store";
import { createTrackingPipeline } from "../src/core/pipeline";
import { createEventRegistry, registerContentViewEvents } from "../src/index";
import { createMemoryEventStore } from "../src/core/store";

const collector = {
  tenantId: "tenant_devjobs",
  siteId: "site_devjobs",
  measurementRuleVersion: "mr-2026-09",
  collectionPolicyVersion: "cp-2026-09",
};

const clock = { now: () => new Date("2026-09-21T12:00:00.000Z") };

const setup = () => {
  const consents = createMemoryConsentStore();
  const registry = createEventRegistry();
  registerContentViewEvents(registry);
  const envelopeStore = createMemoryEnvelopeStore();
  const pipeline = createTrackingPipeline({
    appId: "site_devjobs",
    store: createMemoryEventStore(),
    consents,
    registry,
    collector,
    envelopeStore,
    clock,
    ids: { eventId: () => "evt_contract", visitorId: () => "vis_1" },
  });
  recordConsent({
    store: consents,
    appId: "site_devjobs",
    purpose: "analytics",
    state: "granted",
    recordedAt: "2026-09-21T12:00:00.000Z",
  });
  return { pipeline, envelopeStore };
};

describe("contract ingest", () => {
  it("stores envelope fields from trusted collector config, not the browser body", async () => {
    const { pipeline, envelopeStore } = setup();
    const result = await pipeline.ingest({
      appId: "site_devjobs",
      name: "content.view",
      schemaVersion: 2,
      origin: "browser",
      collectedAt: "2026-09-21T11:59:00.000Z",
      businessSubject: { objectType: "content", objectId: "doc_1" },
      properties: { path: "/jobs/zurich", content_type: "listing", section: "search" },
      rawProducerRecord: {
        trust_class: "trusted",
        tenant_id: "tenant_evil",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("forbidden-producer-field");
    }

    const allowed = await pipeline.ingest({
      appId: "site_devjobs",
      name: "content.view",
      schemaVersion: 2,
      origin: "browser",
      id: "evt_contract",
      collectedAt: "2026-09-21T11:59:00.000Z",
      businessSubject: { objectType: "content", objectId: "doc_1" },
      properties: { path: "/jobs/zurich", content_type: "listing", section: "search" },
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.envelope?.trust_class).toBe("untrusted");
      expect(allowed.envelope?.tenant_id).toBe("tenant_devjobs");
      expect(allowed.envelope?.received_at).toBe("2026-09-21T12:00:00.000Z");
      expect(allowed.envelope?.measurement_rule_version).toBe("mr-2026-09");
      expect(envelopeStore.list()).toHaveLength(1);
    }
  });

  it("deduplicates on event_id for identical retries", async () => {
    const { pipeline, envelopeStore } = setup();
    const payload = {
      appId: "site_devjobs",
      name: "content.view",
      schemaVersion: 1,
      origin: "browser" as const,
      id: "evt_contract",
      properties: { path: "/about", content_type: "page" },
    };
    const first = await pipeline.ingest(payload);
    const second = await pipeline.ingest(payload);
    expect(first.ok && second.ok).toBe(true);
    expect(envelopeStore.list()).toHaveLength(1);
  });

  it("rejects missing event ids instead of minting storage ids", async () => {
    const consents = createMemoryConsentStore();
    const registry = createEventRegistry();
    registerContentViewEvents(registry);
    const envelopeStore = createMemoryEnvelopeStore();
    const pipeline = createTrackingPipeline({
      appId: "site_devjobs",
      store: createMemoryEventStore(),
      consents,
      registry,
      collector,
      envelopeStore,
      clock,
    });
    recordConsent({
      store: consents,
      appId: "site_devjobs",
      purpose: "analytics",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });
    const result = await pipeline.ingest({
      appId: "site_devjobs",
      name: "content.view",
      schemaVersion: 1,
      origin: "browser",
      properties: { path: "/about", content_type: "page" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid-payload");
    }
  });

  it("returns payload-conflict when the same id carries different content", async () => {
    const { pipeline, envelopeStore } = setup();
    const first = await pipeline.ingest({
      appId: "site_devjobs",
      name: "content.view",
      schemaVersion: 1,
      origin: "browser",
      id: "evt_contract",
      properties: { path: "/about", content_type: "page" },
    });
    expect(first.ok).toBe(true);
    const second = await pipeline.ingest({
      appId: "site_devjobs",
      name: "content.view",
      schemaVersion: 1,
      origin: "browser",
      id: "evt_contract",
      properties: { path: "/jobs", content_type: "page" },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("payload-conflict");
    }
    expect(envelopeStore.list()).toHaveLength(1);
  });
});
