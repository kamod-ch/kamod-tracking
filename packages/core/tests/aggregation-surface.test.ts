import { describe, expect, it } from "vitest";
import { expandCandidateUtcBounds } from "../src/aggregation/bucket-timestamp";
import { resolveAllowlistedSurface } from "../src/aggregation/surface-dimension";
import { localDayUtcBounds } from "../src/aggregation/time-bucketing";

describe("aggregation surface dimension", () => {
  it("returns allowlisted surface from envelope payload properties", () => {
    const payload = {
      properties: { path: "/jobs", surface: "job-list" },
    };
    expect(resolveAllowlistedSurface(payload, ["job-list"])).toBe("job-list");
    expect(resolveAllowlistedSurface(payload, ["job-detail-modal"])).toBe("");
  });

  it("never promotes arbitrary property keys", () => {
    const payload = {
      properties: { listing_id: "listing_12345", surface: "listing_12345" },
    };
    expect(resolveAllowlistedSurface(payload, ["job-list"])).toBe("");
  });
});

describe("aggregation candidate bounds", () => {
  it("expands civil-day bounds by producer skew window", () => {
    const { startUtc, endUtc } = localDayUtcBounds("2026-03-29", "UTC");
    const expanded = expandCandidateUtcBounds(startUtc, endUtc, 86_400_000);
    expect(expanded.startUtc.getTime()).toBe(startUtc.getTime() - 86_400_000);
    expect(expanded.endUtc.getTime()).toBe(endUtc.getTime() + 86_400_000);
  });
});
