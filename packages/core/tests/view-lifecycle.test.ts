import { describe, expect, it } from "vitest";
import { createViewLifecycle } from "../src/browser/view-lifecycle";

describe("view lifecycle", () => {
  it("dedupes subjects within one view but allows a new view after navigation", () => {
    const lifecycle = createViewLifecycle({ createViewId: () => "view_a" });
    lifecycle.beginView({ surface: "job-list" });
    expect(lifecycle.shouldCountSubject("job_1")).toBe(true);
    lifecycle.markSubjectCounted("job_1");
    expect(lifecycle.shouldCountSubject("job_1")).toBe(false);

    lifecycle.beginView({ surface: "job-list", viewId: "view_b" });
    expect(lifecycle.shouldCountSubject("job_1")).toBe(true);
  });

  it("clears dedupe state on endView", () => {
    const lifecycle = createViewLifecycle();
    lifecycle.beginView({ surface: "modal" });
    lifecycle.markSubjectCounted("job_1");
    lifecycle.endView();
    expect(lifecycle.getState().viewId).toBeUndefined();
    lifecycle.beginView({ surface: "modal" });
    expect(lifecycle.shouldCountSubject("job_1")).toBe(true);
  });

  it("does not count without an active view", () => {
    const lifecycle = createViewLifecycle();
    expect(lifecycle.shouldCountSubject("job_1")).toBe(false);
  });

  it("treats repeated beginView on the same surface as idempotent", () => {
    const lifecycle = createViewLifecycle({ createViewId: () => "view_x" });
    const id = lifecycle.beginView({ surface: "list" });
    lifecycle.markSubjectCounted("job_1");
    expect(lifecycle.beginView({ surface: "list" })).toBe(id);
    expect(lifecycle.shouldCountSubject("job_1")).toBe(false);
  });
});
