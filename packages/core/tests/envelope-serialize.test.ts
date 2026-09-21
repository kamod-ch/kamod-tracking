import { describe, expect, it } from "vitest";
import { deserializeTrackingEvent, serializeTrackingEvent } from "../src/core/serialize";
import type { TrackingEventEnvelope } from "../src/core/envelope";

const sample: TrackingEventEnvelope = {
  event_id: "evt_1",
  schema_version: 2,
  event_name: "content.view",
  occurred_at: "2026-09-21T11:00:00.000Z",
  subject: { objectType: "content", objectId: "doc_1" },
  properties: { path: "/jobs", content_type: "listing", section: "search" },
  tenant_id: "tenant_a",
  site_id: "site_a",
  received_at: "2026-09-21T12:00:00.000Z",
  producer: "browser",
  trust_class: "untrusted",
  measurement_rule_version: "mr-1",
  collection_policy_version: "cp-1",
  purpose: "analytics",
  consent: "granted",
  legalBasis: { kind: "unspecified" },
  occurred_at_trust: "producer",
};

describe("envelope serialization", () => {
  it("round-trips registered events without losing envelope fields", () => {
    const serialized = serializeTrackingEvent(sample);
    const parsed = deserializeTrackingEvent(JSON.parse(JSON.stringify(serialized)));
    expect(parsed).toEqual(sample);
  });
});
