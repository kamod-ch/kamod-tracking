import { describe, expect, it } from "vitest";
import {
  formatLocalDate,
  localDayUtcBounds,
  zonedLocalDateTimeToUtc,
} from "../src/aggregation/time-bucketing";

describe("Europe/Zurich day boundaries", () => {
  const tz = "Europe/Zurich";

  it("maps UTC instant to local civil date", () => {
    expect(formatLocalDate(new Date("2026-03-28T23:30:00.000Z"), tz)).toBe("2026-03-29");
    expect(formatLocalDate(new Date("2026-10-25T00:30:00.000Z"), tz)).toBe("2026-10-25");
  });

  it("uses shorter DST day length", () => {
    const springForward = localDayUtcBounds("2026-03-29", tz);
    const hours = (springForward.endUtc.getTime() - springForward.startUtc.getTime()) / 3_600_000;
    expect(hours).toBe(23);
  });

  it("uses longer fall-back day length", () => {
    const fallBack = localDayUtcBounds("2026-10-25", tz);
    const hours = (fallBack.endUtc.getTime() - fallBack.startUtc.getTime()) / 3_600_000;
    expect(hours).toBe(25);
  });

  it("resolves local midnight to UTC", () => {
    const winter = zonedLocalDateTimeToUtc("2026-01-15", "00:00:00", tz);
    expect(winter.toISOString()).toBe("2026-01-14T23:00:00.000Z");
    const summer = zonedLocalDateTimeToUtc("2026-07-15", "00:00:00", tz);
    expect(summer.toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });
});
