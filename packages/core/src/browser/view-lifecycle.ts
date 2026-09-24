/**
 * Explicit view lifecycle for SPA surfaces (list, modal detail, flow step).
 * No history patching — the host calls `beginView` / `endView` on navigation or refresh.
 */
export type ViewLifecycleState = {
  readonly viewId: string | undefined;
  readonly surface: string | undefined;
};

export type ViewLifecycle = {
  beginView(input: { readonly surface: string; readonly viewId?: string }): string;
  endView(): void;
  getState(): ViewLifecycleState;
  /** One impression per subject key within the active view. */
  shouldCountSubject(subjectKey: string): boolean;
  markSubjectCounted(subjectKey: string): void;
  onViewChange(listener: () => void): () => void;
  reset(): void;
};

export type ViewLifecycleOptions = {
  readonly createViewId?: () => string;
};

let defaultViewCounter = 0;

export const createViewLifecycle = (options: ViewLifecycleOptions = {}): ViewLifecycle => {
  const createViewId = options.createViewId ?? (() => `view_${++defaultViewCounter}`);
  let viewId: string | undefined;
  let surface: string | undefined;
  const countedSubjects = new Set<string>();
  const viewChangeListeners = new Set<() => void>();

  const notifyViewChange = (): void => {
    for (const listener of viewChangeListeners) {
      try {
        listener();
      } catch {
        // ignore host listener failures
      }
    }
  };

  const resetSubjects = (): void => {
    countedSubjects.clear();
  };

  return {
    beginView(input) {
      if (viewId !== undefined && surface === input.surface) {
        if (input.viewId === undefined || input.viewId === viewId) {
          return viewId;
        }
      }
      viewId = input.viewId ?? createViewId();
      surface = input.surface;
      resetSubjects();
      notifyViewChange();
      return viewId;
    },
    endView() {
      if (viewId === undefined && surface === undefined) {
        return;
      }
      viewId = undefined;
      surface = undefined;
      resetSubjects();
      notifyViewChange();
    },
    getState() {
      return { viewId, surface };
    },
    shouldCountSubject(subjectKey) {
      if (!viewId) {
        return false;
      }
      const key = `${viewId}:${subjectKey}`;
      return !countedSubjects.has(key);
    },
    markSubjectCounted(subjectKey) {
      if (!viewId) {
        return;
      }
      countedSubjects.add(`${viewId}:${subjectKey}`);
    },
    onViewChange(listener) {
      viewChangeListeners.add(listener);
      return () => viewChangeListeners.delete(listener);
    },
    reset() {
      viewId = undefined;
      surface = undefined;
      resetSubjects();
      notifyViewChange();
    },
  };
};
