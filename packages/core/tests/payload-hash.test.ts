import { describe, expect, it } from "vitest";
import { hashEnvelopePayload, stableStringify } from "../src/postgres/payload-hash";
import type { TrackingEventEnvelope } from "../src/core/envelope";

const sampleEnvelope = (overrides: Partial<TrackingEventEnvelope> = {}): TrackingEventEnvelope => ({
  event_id: "evt_1",
  schema_version: 1,
  event_name: "content.view",
  occurred_at: "2026-09-21T12:00:00.000Z",
  subject: { objectType: "none" },
  properties: { path: "/a" },
  tenant_id: "tenant_a",
  site_id: "site_1",
  received_at: "2026-09-21T12:00:01.000Z",
  producer: "browser",
  trust_class: "untrusted",
  measurement_rule_version: "mr_v1",
  collection_policy_version: "cp_v1",
  purpose: "analytics",
  consent: "granted",
  legalBasis: { kind: "unspecified" },
  occurred_at_trust: "producer",
  ...overrides,
});

describe("payload hash", () => {
  it("ignores JSON key order when hashing", () => {
    const left = stableStringify({ b: 1, a: { z: 1, y: 2 } });
    const right = stableStringify({ a: { y: 2, z: 1 }, b: 1 });
    expect(left).toBe(right);
  });

  it("excludes received_at from dedup hash", () => {
    const a = hashEnvelopePayload(sampleEnvelope({ received_at: "2026-09-21T12:00:01.000Z" }));
    const b = hashEnvelopePayload(sampleEnvelope({ received_at: "2026-09-21T13:00:00.000Z" }));
    expect(a.equals(b)).toBe(true);
  });

  it("detects payload content changes", () => {
    const a = hashEnvelopePayload(sampleEnvelope());
    const b = hashEnvelopePayload(sampleEnvelope({ properties: { path: "/b" } }));
    expect(a.equals(b)).toBe(false);
  });
});
