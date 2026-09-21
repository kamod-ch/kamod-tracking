export type UnloadHooks = {
  install(onUnload: () => void): void;
  remove(): void;
};

export const createUnloadHooks = (): UnloadHooks => {
  let handler: (() => void) | undefined;
  const wrapped = (): void => {
    handler?.();
  };

  return {
    install(onUnload) {
      handler = onUnload;
      const global = globalThis as typeof globalThis & {
        addEventListener?: (type: string, listener: () => void) => void;
      };
      global.addEventListener?.("pagehide", wrapped);
      global.addEventListener?.("visibilitychange", () => {
        const doc = (globalThis as { document?: { visibilityState?: string } }).document;
        if (doc?.visibilityState === "hidden") {
          wrapped();
        }
      });
    },
    remove() {
      handler = undefined;
      const global = globalThis as typeof globalThis & {
        removeEventListener?: (type: string, listener: () => void) => void;
      };
      global.removeEventListener?.("pagehide", wrapped);
    },
  };
};
