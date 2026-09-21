import {
  resolveVisibilityMeasurementRule,
  type VisibilityMeasurementRule,
} from "./visibility-measurement-rule";
import type { ViewLifecycle } from "./view-lifecycle";

export type VisibilityImpressionCallback = (input: {
  readonly subjectKey: string;
  readonly claimedRuleVersion: string;
  readonly viewId: string;
  readonly surface: string;
}) => void;

export type VisibilityObserverHandle = {
  disconnect(): void;
};

export type VisibilityTargetOptions = {
  readonly subjectKey: string;
  /** When false, never emit an impression (e.g. promo cards without a job listing). */
  readonly eligible?: () => boolean;
  readonly onImpression?: VisibilityImpressionCallback;
};

export type IntersectionObserverLike = {
  observe(target: Element): void;
  unobserve(target: Element): void;
  disconnect(): void;
};

export type VisibilityImpressionObserverOptions = {
  readonly lifecycle: ViewLifecycle;
  readonly rule?: VisibilityMeasurementRule;
  readonly onImpression?: VisibilityImpressionCallback;
  readonly createIntersectionObserver?: (
    callback: (entries: readonly IntersectionObserverEntryLike[]) => void,
  ) => IntersectionObserverLike | undefined;
  readonly getDocumentVisible?: () => boolean;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, delayMs: number) => { clear(): void };
};

export type IntersectionObserverEntryLike = {
  readonly target: Element;
  readonly intersectionRatio: number;
};

type TargetState = {
  readonly subjectKey: string;
  readonly eligible?: () => boolean;
  readonly onImpression?: VisibilityImpressionCallback;
  ratio: number;
  pendingSinceMs: number | undefined;
  pendingTimeout: { clear(): void } | undefined;
};

/**
 * Framework-independent visibility helper. Does not touch browser globals unless factories are omitted at runtime.
 */
export const createVisibilityImpressionObserver = (
  options: VisibilityImpressionObserverOptions,
): {
  observe(target: Element, targetOptions: VisibilityTargetOptions): VisibilityObserverHandle;
  disconnectAll(): void;
} => {
  const rule = resolveVisibilityMeasurementRule(options.rule);
  const now = options.now ?? (() => Date.now());
  const getDocumentVisible =
    options.getDocumentVisible ??
    (() => {
      const doc = (globalThis as { document?: { visibilityState?: string } }).document;
      return doc?.visibilityState !== "hidden";
    });
  const setTimer =
    options.setTimer ??
    ((fn, delayMs) => {
      const id = setTimeout(fn, delayMs);
      return { clear: () => clearTimeout(id) };
    });

  const targets = new Map<Element, TargetState>();
  let documentListener: (() => void) | undefined;

  const isQualifiedSample = (ratio: number, documentVisible: boolean): boolean =>
    documentVisible && ratio >= rule.minVisibleRatio;

  const clearPending = (state: TargetState): void => {
    state.pendingTimeout?.clear();
    state.pendingTimeout = undefined;
    state.pendingSinceMs = undefined;
  };

  const scheduleQualificationCheck = (target: Element, state: TargetState): void => {
    if (state.pendingTimeout || state.pendingSinceMs === undefined) {
      return;
    }
    const atMs = now();
    const elapsed = atMs - state.pendingSinceMs;
    const remainingMs = rule.minVisibleMs - elapsed;
    if (remainingMs <= 0) {
      tryEmitImpression(target, state);
      return;
    }
    state.pendingTimeout = setTimer(() => {
      state.pendingTimeout = undefined;
      if (!isQualifiedSample(state.ratio, getDocumentVisible())) {
        clearPending(state);
        return;
      }
      tryEmitImpression(target, state);
    }, remainingMs);
  };

  const tryEmitImpression = (target: Element, state: TargetState): void => {
    if (!isQualifiedSample(state.ratio, getDocumentVisible())) {
      clearPending(state);
      return;
    }
    if (state.pendingSinceMs === undefined) {
      return;
    }
    const elapsed = now() - state.pendingSinceMs;
    if (elapsed < rule.minVisibleMs) {
      scheduleQualificationCheck(target, state);
      return;
    }
    if (state.eligible && !state.eligible()) {
      clearPending(state);
      return;
    }
    const active = options.lifecycle.getState();
    if (!active.viewId || !active.surface) {
      return;
    }
    if (!options.lifecycle.shouldCountSubject(state.subjectKey)) {
      clearPending(state);
      io?.unobserve(target);
      return;
    }
    options.lifecycle.markSubjectCounted(state.subjectKey);
    const payload = {
      subjectKey: state.subjectKey,
      claimedRuleVersion: rule.version,
      viewId: active.viewId,
      surface: active.surface,
    };
    const notify = state.onImpression ?? options.onImpression;
    notify?.(payload);
    clearPending(state);
    io?.unobserve(target);
  };

  const evaluateTarget = (target: Element, state: TargetState, ratio: number): void => {
    state.ratio = ratio;
    const documentVisible = getDocumentVisible();
    if (!isQualifiedSample(ratio, documentVisible)) {
      clearPending(state);
      return;
    }
    const atMs = now();
    if (state.pendingSinceMs === undefined) {
      state.pendingSinceMs = atMs;
    }
    const elapsed = atMs - state.pendingSinceMs;
    if (elapsed >= rule.minVisibleMs) {
      tryEmitImpression(target, state);
      return;
    }
    scheduleQualificationCheck(target, state);
  };

  const onIntersection = (entries: readonly IntersectionObserverEntryLike[]): void => {
    for (const entry of entries) {
      const state = targets.get(entry.target);
      if (!state) {
        continue;
      }
      evaluateTarget(entry.target, state, entry.intersectionRatio);
    }
  };

  const io = options.createIntersectionObserver?.(onIntersection);

  const onDocumentVisibilityChange = (): void => {
    if (getDocumentVisible()) {
      for (const [target, state] of targets) {
        evaluateTarget(target, state, state.ratio);
      }
      return;
    }
    for (const state of targets.values()) {
      clearPending(state);
    }
  };

  const ensureDocumentListener = (): void => {
    if (documentListener) {
      return;
    }
    const doc = (
      globalThis as {
        document?: {
          addEventListener?: (t: string, l: () => void) => void;
          removeEventListener?: (t: string, l: () => void) => void;
        };
      }
    ).document;
    if (typeof doc?.addEventListener !== "function") {
      return;
    }
    doc.addEventListener("visibilitychange", onDocumentVisibilityChange);
    documentListener = () => {
      doc.removeEventListener?.("visibilitychange", onDocumentVisibilityChange);
    };
  };

  const disconnectAll = (): void => {
    for (const state of targets.values()) {
      clearPending(state);
    }
    targets.clear();
    io?.disconnect();
    documentListener?.();
    documentListener = undefined;
  };

  return {
    observe(target, targetOptions) {
      if (!io) {
        return { disconnect() {} };
      }
      const state: TargetState = {
        subjectKey: targetOptions.subjectKey,
        ...(targetOptions.eligible !== undefined ? { eligible: targetOptions.eligible } : {}),
        ...(targetOptions.onImpression !== undefined
          ? { onImpression: targetOptions.onImpression }
          : {}),
        ratio: 0,
        pendingSinceMs: undefined,
        pendingTimeout: undefined,
      };
      targets.set(target, state);
      ensureDocumentListener();
      io.observe(target);
      return {
        disconnect() {
          const existing = targets.get(target);
          if (existing) {
            clearPending(existing);
            targets.delete(target);
          }
          io.unobserve(target);
        },
      };
    },
    disconnectAll,
  };
};

/** Default IO factory; returns undefined when `IntersectionObserver` is unavailable (no fallback counting). */
export const createDefaultIntersectionObserverFactory =
  (): VisibilityImpressionObserverOptions["createIntersectionObserver"] => (callback) => {
    const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    if (typeof IO !== "function") {
      return undefined;
    }
    return new IO(
      (entries) => {
        callback(entries);
      },
      { threshold: [0, 0.5, 1] },
    );
  };
