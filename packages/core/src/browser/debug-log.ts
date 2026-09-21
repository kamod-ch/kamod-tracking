export type DebugLogger = {
  log(message: string, meta?: Record<string, string | number | boolean>): void;
};

export const createDebugLogger = (enabled: boolean): DebugLogger => ({
  log(message, meta) {
    if (!enabled) {
      return;
    }
    if (meta) {
      console.debug("[kamod-tracking]", message, meta);
      return;
    }
    console.debug("[kamod-tracking]", message);
  },
});
