import { describe, expect, it } from "vitest";
import { createVisibilityTimer } from "../src/browser/visibility-timer";
import { VISIBILITY_MEASUREMENT_RULE_V1 } from "../src/browser/visibility-measurement-rule";

describe("visibility timer", () => {
  const timer = () =>
    createVisibilityTimer({
      minVisibleRatio: VISIBILITY_MEASUREMENT_RULE_V1.minVisibleRatio,
      minVisibleMs: VISIBILITY_MEASUREMENT_RULE_V1.minVisibleMs,
    });

  it("does not qualify at 49% visible ratio", () => {
    const t = timer();
    expect(t.onVisibilityChange({ ratio: 0.49, documentVisible: true, atMs: 1000 })).toBe("idle");
  });

  it("qualifies at 50% for 1000ms uninterrupted", () => {
    const t = timer();
    expect(t.onVisibilityChange({ ratio: 0.5, documentVisible: true, atMs: 0 })).toBe("pending");
    expect(t.onVisibilityChange({ ratio: 0.5, documentVisible: true, atMs: 999 })).toBe("pending");
    expect(t.onVisibilityChange({ ratio: 0.5, documentVisible: true, atMs: 1000 })).toBe(
      "qualified",
    );
  });

  it("resets continuous time when visibility drops below threshold", () => {
    const t = timer();
    t.onVisibilityChange({ ratio: 0.5, documentVisible: true, atMs: 0 });
    t.onVisibilityChange({ ratio: 0.5, documentVisible: true, atMs: 900 });
    expect(t.onVisibilityChange({ ratio: 0.2, documentVisible: true, atMs: 901 })).toBe("idle");
    expect(t.onVisibilityChange({ ratio: 0.5, documentVisible: true, atMs: 1800 })).toBe("pending");
    expect(t.onVisibilityChange({ ratio: 0.5, documentVisible: true, atMs: 2800 })).toBe(
      "qualified",
    );
  });

  it("does not accumulate time while the document is hidden", () => {
    const t = timer();
    t.onVisibilityChange({ ratio: 0.5, documentVisible: true, atMs: 0 });
    expect(t.onVisibilityChange({ ratio: 0.5, documentVisible: false, atMs: 500 })).toBe("idle");
    expect(t.onVisibilityChange({ ratio: 0.5, documentVisible: true, atMs: 1500 })).toBe("pending");
    expect(t.onVisibilityChange({ ratio: 0.5, documentVisible: true, atMs: 2500 })).toBe(
      "qualified",
    );
  });
});
