import { describe, expect, it } from "vitest";

describe("browser module import is SSR-safe", () => {
  it("loads and constructs a tracker without touching window or document", async () => {
    const mod = await import("../src/browser");
    const tracker = mod.createBrowserTracker({
      appId: "app-a",
      storage: mod.createMemoryKeyValueStorage(),
      transport: mod.createMemoryTransport(),
    });
    expect(tracker.getConsent("analytics")).toBe("unknown");
    expect(typeof tracker.pageView).toBe("function");
    expect(typeof tracker.beginView).toBe("function");
    expect(mod.createViewLifecycle).toBeTypeOf("function");
    expect(mod.createVisibilityTimer).toBeTypeOf("function");
    expect(mod.createVisibilityImpressionObserver).toBeTypeOf("function");
    const lifecycle = mod.createViewLifecycle();
    lifecycle.beginView({ surface: "test" });
    expect(lifecycle.getState().surface).toBe("test");
  });
});
