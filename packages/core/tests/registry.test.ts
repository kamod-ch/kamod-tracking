import { describe, expect, it } from "vitest";
import { contentViewV1, createEventRegistry, registerContentViewEvents } from "../src/index";

describe("event registry", () => {
  it("rejects unknown property keys instead of storing them silently", () => {
    const registry = createEventRegistry();
    registerContentViewEvents(registry);
    const result = registry.validateProperties("content.view", 2, {
      path: "/jobs",
      content_type: "listing",
      section: "search",
      document_title: "secret",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid-payload");
      expect(result.errors?.some((error) => error.code === "unknown")).toBe(true);
    }
  });

  it("rejects manipulated payloads and unknown schema versions", () => {
    const registry = createEventRegistry();
    registry.register(contentViewV1);
    expect(
      registry.validateProperties("content.view", 99, { path: "/", content_type: "x" }).ok,
    ).toBe(false);
    const ok = registry.validateProperties("content.view", 1, {
      path: "/docs?utm=1",
      content_type: "article",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.properties.path).toBe("/docs");
    }
  });

  it("keeps retired versions readable but not writable after readableUntil", () => {
    const registry = createEventRegistry();
    registry.register({
      ...contentViewV1,
      readableUntil: "2020-01-01T00:00:00.000Z",
    });
    expect(registry.isReadable("content.view", 1, new Date("2019-01-01T00:00:00.000Z"))).toBe(true);
    expect(registry.isReadable("content.view", 1, new Date("2021-01-01T00:00:00.000Z"))).toBe(
      false,
    );
  });
});
