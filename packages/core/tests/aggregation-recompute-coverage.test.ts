import { describe, expect, it } from "vitest";
import {
  canFullyRecomputeLocalDay,
  dayEndsBeforeRecomputeFloor,
  DEFAULT_RECOMPUTE_FLOOR_EPOCH,
} from "../src/aggregation/recompute-coverage";
import { localDayUtcBounds } from "../src/aggregation/time-bucketing";

describe("recompute coverage rules", () => {
  const tz = "Europe/Zurich";

  it("treats days ending at or before the retention floor as outside raw recompute", () => {
    const floor = new Date("2026-03-30T00:00:00.000Z");
    expect(dayEndsBeforeRecomputeFloor("2026-03-29", tz, floor)).toBe(true);
    expect(dayEndsBeforeRecomputeFloor("2026-03-30", tz, floor)).toBe(false);
  });

  it("rejects recompute when candidate window starts before the floor", () => {
    const { startUtc } = localDayUtcBounds("2026-03-31", tz);
    const floor = new Date(startUtc.getTime() + 60_000);
    expect(
      canFullyRecomputeLocalDay({
        localDate: "2026-03-31",
        timeZone: tz,
        recomputeCompleteFromReceivedAt: floor,
        maxProducerSkewMs: 7 * 24 * 60 * 60_000,
        gapDates: new Set(),
      }),
    ).toBe(false);
  });

  it("honours explicit coverage gap markers", () => {
    expect(
      canFullyRecomputeLocalDay({
        localDate: "2026-04-01",
        timeZone: tz,
        recomputeCompleteFromReceivedAt: DEFAULT_RECOMPUTE_FLOOR_EPOCH,
        maxProducerSkewMs: 7 * 24 * 60 * 60_000,
        gapDates: new Set(["2026-04-01"]),
      }),
    ).toBe(false);
  });
});
