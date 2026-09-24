/**
 * Short-lived in-memory impression keys for `none` mode.
 * Not persisted and not used as a visitor identifier.
 */
export const createViewImpressionState = () => {
  const seen = new Set<string>();

  return {
    canRecordPageImpression(path: string): boolean {
      const key = path.trim() || "/";
      return !seen.has(key);
    },
    commitPageImpression(path: string): void {
      const key = path.trim() || "/";
      seen.add(key);
    },
    shouldRecordPageImpression(path: string): boolean {
      const key = path.trim() || "/";
      if (seen.has(key)) {
        return false;
      }
      return true;
    },
    reset() {
      seen.clear();
    },
  };
};

export type ViewImpressionState = ReturnType<typeof createViewImpressionState>;
