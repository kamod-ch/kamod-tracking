import type { VisibilityMeasurementRule } from "./visibility-measurement-rule";

export type VisibilityTimerState = "idle" | "pending" | "qualified";

export type VisibilityTimer = {
  onVisibilityChange(input: {
    readonly ratio: number;
    readonly documentVisible: boolean;
    readonly atMs: number;
  }): VisibilityTimerState;
  reset(): void;
};

/**
 * Tracks uninterrupted qualified visibility. Background or sub-threshold time does not accumulate.
 */
export const createVisibilityTimer = (
  rule: Pick<VisibilityMeasurementRule, "minVisibleRatio" | "minVisibleMs">,
): VisibilityTimer => {
  let pendingSinceMs: number | undefined;

  const isQualified = (ratio: number, documentVisible: boolean): boolean =>
    documentVisible && ratio >= rule.minVisibleRatio;

  return {
    onVisibilityChange(input) {
      if (!isQualified(input.ratio, input.documentVisible)) {
        pendingSinceMs = undefined;
        return "idle";
      }
      if (pendingSinceMs === undefined) {
        pendingSinceMs = input.atMs;
      }
      const elapsed = input.atMs - pendingSinceMs;
      if (elapsed >= rule.minVisibleMs) {
        return "qualified";
      }
      return "pending";
    },
    reset() {
      pendingSinceMs = undefined;
    },
  };
};
