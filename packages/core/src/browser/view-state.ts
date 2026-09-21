/**
 * Short-lived in-memory impression keys for `none` mode.
 * Not persisted and not used as a visitor identifier.
 */
export const createViewImpressionState = () => {
  const seen = new Set<string>();

  return {
    shouldRecordPageImpression(path: string): boolean {
      const key = path.trim() || "/";
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    },
    reset() {
      seen.clear();
    },
  };
};

export type ViewImpressionState = ReturnType<typeof createViewImpressionState>;
