import { describe, expect, it } from "vitest";
import { selectBucketInstant } from "../src/aggregation/bucket-timestamp";

describe("aggregation bucket timestamp", () => {
  it("uses occurred_at when producer skew is within bounds", () => {
    const occurred = new Date("2026-09-21T10:00:00.000Z");
    const received = new Date("2026-09-21T10:00:05.000Z");
    expect(
      selectBucketInstant({
        occurredAt: occurred,
        receivedAt: received,
        occurredAtTrust: "producer",
        maxProducerSkewMs: 60_000,
      }).toISOString(),
    ).toBe(occurred.toISOString());
  });

  it("falls back to received_at when browser time is implausible", () => {
    const occurred = new Date("2026-01-01T00:00:00.000Z");
    const received = new Date("2026-09-21T12:00:00.000Z");
    expect(
      selectBucketInstant({
        occurredAt: occurred,
        receivedAt: received,
        occurredAtTrust: "producer",
        maxProducerSkewMs: 86_400_000,
      }).toISOString(),
    ).toBe(received.toISOString());
  });
});
