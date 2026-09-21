export const createAbortRegistry = () => {
  const controllers = new Set<AbortController>();

  return {
    createSignal(): AbortSignal {
      const controller = new AbortController();
      controllers.add(controller);
      return controller.signal;
    },
    releaseSignal(signal: AbortSignal): void {
      for (const controller of controllers) {
        if (controller.signal === signal) {
          controllers.delete(controller);
          return;
        }
      }
    },
    abortAll(): void {
      for (const controller of controllers) {
        controller.abort();
      }
      controllers.clear();
    },
  };
};

export type AbortRegistry = ReturnType<typeof createAbortRegistry>;
