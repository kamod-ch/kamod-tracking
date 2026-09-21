/**
 * Documented visibility measurement rules. The browser reports a claimed rule version only;
 * the collector maps accepted events to the site’s authoritative `measurement_rule_version`.
 */
export type VisibilityMeasurementRule = {
  readonly version: string;
  /** Minimum intersection ratio (0–1) of the observed target. */
  readonly minVisibleRatio: number;
  /** Uninterrupted visible duration at or above `minVisibleRatio` while the document is visible. */
  readonly minVisibleMs: number;
  readonly requiresDocumentVisible: true;
};

/** Default: ≥50% visible area for 1 continuous second while the tab is visible. */
export const VISIBILITY_MEASUREMENT_RULE_V1: VisibilityMeasurementRule = {
  version: "visible_area_50pct_1s_v1",
  minVisibleRatio: 0.5,
  minVisibleMs: 1000,
  requiresDocumentVisible: true,
};

export const DEFAULT_VISIBILITY_MEASUREMENT_RULE = VISIBILITY_MEASUREMENT_RULE_V1;

export const resolveVisibilityMeasurementRule = (
  rule: VisibilityMeasurementRule = DEFAULT_VISIBILITY_MEASUREMENT_RULE,
): VisibilityMeasurementRule => ({
  version: rule.version,
  minVisibleRatio: rule.minVisibleRatio,
  minVisibleMs: rule.minVisibleMs,
  requiresDocumentVisible: true,
});
