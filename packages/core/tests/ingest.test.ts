import { describe, expect, it } from "vitest";
import { isAuditEvent } from "../src/core/audit-boundary";
import { recordConsent, createMemoryConsentStore } from "../src/core/consent";
import { createTrackingPipeline } from "../src/core/pipeline";
import { createMemoryEventStore } from "../src/core/store";
import type { IdFactory } from "../src/core/types";

const ids: IdFactory = {
  eventId: () => "evt_1",
  visitorId: () => "vis_1",
};

const clock = { now: () => new Date("2026-09-21T12:00:00.000Z") };

const createPipeline = () => {
  const consents = createMemoryConsentStore();
  const store = createMemoryEventStore();
  const pipeline = createTrackingPipeline({
    appId: "app-a",
    store,
    consents,
    clock,
    ids,
  });
  return { pipeline, store, consents };
};

describe("tracking ingest", () => {
  it("marks browser events untrusted and server conversions trusted", async () => {
    const { pipeline, consents } = createPipeline();
    recordConsent({
      store: consents,
      appId: "app-a",
      purpose: "analytics",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });
    recordConsent({
      store: consents,
      appId: "app-a",
      purpose: "measurement",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });

    const page = await pipeline.pageView({ appId: "app-a", path: "/home?ref=1" });
    const conversion = await pipeline.recordConversion({
      appId: "app-a",
      name: "signup_verified",
      accountId: "acct_9",
    });

    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.event.origin).toBe("browser");
      expect(page.event.trust).toBe("untrusted");
      expect(page.event.properties.path).toBe("/home");
      expect(page.guarantee).toBe("best-effort");
    }
    expect(conversion.ok).toBe(true);
    if (conversion.ok) {
      expect(conversion.event.origin).toBe("server");
      expect(conversion.event.trust).toBe("trusted");
      expect(conversion.event.subject).toEqual({ type: "account", accountId: "acct_9" });
    }
  });

  it("does not infer a legal basis from granted consent", async () => {
    const { pipeline, consents } = createPipeline();
    recordConsent({
      store: consents,
      appId: "app-a",
      purpose: "analytics",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });

    const result = await pipeline.track({ appId: "app-a", name: "cta_click" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.consent).toBe("granted");
      expect(result.event.legalBasis).toEqual({ kind: "unspecified" });
    }
  });

  it("rejects analytics events without collection permission", async () => {
    const { pipeline } = createPipeline();
    const result = await pipeline.track({ appId: "app-a", name: "cta_click" });
    expect(result).toEqual({ ok: false, reason: "consent-denied" });
  });

  it("rejects audit-shaped events instead of storing them", async () => {
    const { pipeline, consents, store } = createPipeline();
    recordConsent({
      store: consents,
      appId: "app-a",
      purpose: "analytics",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });

    expect(isAuditEvent({ name: "audit.user.update" })).toBe(true);
    const result = await pipeline.ingest({
      appId: "app-a",
      name: "audit.user.update",
      origin: "server",
    });
    expect(result).toEqual({ ok: false, reason: "audit-event" });
    expect(store.list()).toEqual([]);
  });

  it("refuses automatic anonymous-to-account linking", async () => {
    const { pipeline, consents } = createPipeline();
    recordConsent({
      store: consents,
      appId: "app-a",
      purpose: "analytics",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });

    const result = await pipeline.ingest({
      appId: "app-a",
      name: "cta_click",
      origin: "browser",
      visitorId: "vis_1",
      accountId: "acct_9",
    });
    expect(result).toEqual({ ok: false, reason: "identity-link-forbidden" });
  });

  it("keeps time bounds and origin explicit on stored events", async () => {
    const { pipeline, consents } = createPipeline();
    recordConsent({
      store: consents,
      appId: "app-a",
      purpose: "measurement",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });

    const result = await pipeline.recordConversion({
      appId: "app-a",
      name: "signup_verified",
      timeBounds: {
        windowStart: "2026-09-01T00:00:00.000Z",
        windowEnd: "2026-09-30T23:59:59.000Z",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.collectedAt).toBe("2026-09-21T12:00:00.000Z");
      expect(result.event.receivedAt).toBe("2026-09-21T12:00:00.000Z");
      expect(result.event.timeBounds).toEqual({
        windowStart: "2026-09-01T00:00:00.000Z",
        windowEnd: "2026-09-30T23:59:59.000Z",
      });
    }
  });
});
