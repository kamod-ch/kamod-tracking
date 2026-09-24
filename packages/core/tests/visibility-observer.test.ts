import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewLifecycle } from "../src/browser/view-lifecycle";
import {
  createVisibilityImpressionObserver,
  type IntersectionObserverEntryLike,
  type IntersectionObserverLike,
} from "../src/browser/visibility-observer";
import { VISIBILITY_MEASUREMENT_RULE_V1 } from "../src/browser/visibility-measurement-rule";

const fakeElement = (): Element => ({}) as Element;

type HarnessOptions = {
  readonly documentVisible?: () => boolean;
};

const createHarness = (options: HarnessOptions = {}) => {
  let nowMs = 0;
  let documentVisible = true;
  let ioCallback: ((entries: readonly IntersectionObserverEntryLike[]) => void) | undefined;
  const scheduled: Array<{ fn: () => void; atMs: number }> = [];
  const impressions: string[] = [];

  const io: IntersectionObserverLike = {
    observe() {},
    unobserve() {},
    disconnect() {},
  };

  const lifecycle = createViewLifecycle({ createViewId: () => "view_1" });
  lifecycle.beginView({ surface: "job-list" });

  const observer = createVisibilityImpressionObserver({
    lifecycle,
    rule: VISIBILITY_MEASUREMENT_RULE_V1,
    onImpression: ({ subjectKey }) => impressions.push(subjectKey),
    createIntersectionObserver: (callback) => {
      ioCallback = callback;
      return io;
    },
    getDocumentVisible: options.documentVisible ?? (() => documentVisible),
    now: () => nowMs,
    setTimer: (fn, delayMs) => {
      const atMs = nowMs + delayMs;
      scheduled.push({ fn, atMs });
      return {
        clear: () => {
          const index = scheduled.findIndex((entry) => entry.fn === fn);
          if (index >= 0) {
            scheduled.splice(index, 1);
          }
        },
      };
    },
  });

  const target = fakeElement();

  const emitRatio = (ratio: number, element: Element = target) => {
    ioCallback?.([{ target: element, intersectionRatio: ratio }]);
  };

  const advanceTo = (atMs: number) => {
    nowMs = atMs;
    const due = scheduled.filter((entry) => entry.atMs <= nowMs);
    scheduled.splice(0, scheduled.length, ...scheduled.filter((entry) => entry.atMs > nowMs));
    for (const entry of due) {
      entry.fn();
    }
  };

  const setDocumentVisible = (visible: boolean) => {
    documentVisible = visible;
  };

  return { observer, target, emitRatio, advanceTo, impressions, lifecycle, setDocumentVisible };
};

const qualifyAndConfirm = (
  h: ReturnType<typeof createHarness>,
  subjectKey: string,
  element?: Element,
) => {
  h.emitRatio(0.5, element ?? h.target);
  h.advanceTo(1000);
  h.observer.confirmImpression(subjectKey);
};

describe("visibility impression observer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires after 1000ms at 50% but not at 999ms", () => {
    const h = createHarness();
    h.observer.observe(h.target, { subjectKey: "job_a" });
    h.emitRatio(0.5);
    h.advanceTo(999);
    expect(h.impressions).toEqual([]);
    h.advanceTo(1000);
    h.observer.confirmImpression("job_a");
    expect(h.impressions).toEqual(["job_a"]);
  });

  it("does not count 49% visibility", () => {
    const h = createHarness();
    h.observer.observe(h.target, { subjectKey: "job_a" });
    h.emitRatio(0.49);
    h.advanceTo(5000);
    expect(h.impressions).toEqual([]);
  });

  it("resets the timer when visibility is interrupted", () => {
    const h = createHarness();
    h.observer.observe(h.target, { subjectKey: "job_a" });
    h.emitRatio(0.5);
    h.advanceTo(900);
    h.emitRatio(0.1);
    h.emitRatio(0.5);
    h.advanceTo(1800);
    expect(h.impressions).toEqual([]);
    h.advanceTo(1900);
    h.observer.confirmImpression("job_a");
    expect(h.impressions).toEqual(["job_a"]);
  });

  it("pauses while the document is hidden", () => {
    const h = createHarness();
    h.observer.observe(h.target, { subjectKey: "job_a" });
    h.emitRatio(0.5);
    h.advanceTo(500);
    h.setDocumentVisible(false);
    h.emitRatio(0.5);
    h.advanceTo(2000);
    expect(h.impressions).toEqual([]);
    h.setDocumentVisible(true);
    h.emitRatio(0.5);
    h.advanceTo(3000);
    h.observer.confirmImpression("job_a");
    expect(h.impressions).toEqual(["job_a"]);
  });

  it("does not count a remount of the same subject in the same view", () => {
    const h = createHarness();
    const first = h.observer.observe(h.target, { subjectKey: "job_a" });
    qualifyAndConfirm(h, "job_a");
    first.disconnect();
    const remounted = fakeElement();
    h.observer.observe(remounted, { subjectKey: "job_a" });
    h.emitRatio(0.5, remounted);
    h.advanceTo(3000);
    expect(h.impressions).toEqual(["job_a"]);
  });

  it("counts the same subject again after a new view begins", () => {
    const h = createHarness();
    h.observer.observe(h.target, { subjectKey: "job_a" });
    qualifyAndConfirm(h, "job_a");
    h.lifecycle.beginView({ surface: "job-detail", viewId: "view_2" });
    h.observer.observe(h.target, { subjectKey: "job_a" });
    h.emitRatio(0.5);
    h.advanceTo(2000);
    h.observer.confirmImpression("job_a");
    expect(h.impressions).toEqual(["job_a", "job_a"]);
  });

  it("clears pending timers when the view changes during qualification", () => {
    const h = createHarness();
    h.observer.observe(h.target, { subjectKey: "job_a" });
    h.emitRatio(0.5);
    h.advanceTo(500);
    h.lifecycle.beginView({ surface: "job-detail", viewId: "view_2" });
    h.advanceTo(5000);
    expect(h.impressions).toEqual([]);
  });

  it("skips ineligible targets such as promo cards without a job", () => {
    const h = createHarness();
    h.observer.observe(h.target, {
      subjectKey: "promo_1",
      eligible: () => false,
    });
    h.emitRatio(0.5);
    h.advanceTo(2000);
    expect(h.impressions).toEqual([]);
  });

  it("cleans up pending timers on disconnect", () => {
    const h = createHarness();
    const handle = h.observer.observe(h.target, { subjectKey: "job_a" });
    h.emitRatio(0.5);
    handle.disconnect();
    h.advanceTo(5000);
    expect(h.impressions).toEqual([]);
  });
});
