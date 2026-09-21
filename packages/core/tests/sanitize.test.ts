import { describe, expect, it } from "vitest";
import {
  sanitizeForLog,
  sanitizePath,
  sanitizeProperties,
  sanitizeUrl,
} from "../src/core/sanitize";

describe("payload sanitization", () => {
  it("keeps path and origin+pathname, dropping query and hash", () => {
    expect(sanitizePath("/pricing?utm=1#x")).toBe("/pricing");
    expect(sanitizeUrl("https://user:secret@example.com/a?token=abc#frag")).toBeUndefined();
    expect(sanitizeUrl("https://example.com/a/b?q=1#z")).toBe("https://example.com/a/b");
  });

  it("rejects emails, tokens, and blocked form-like keys", () => {
    expect(sanitizeProperties({ email: "a@b.c" }).ok).toBe(false);
    expect(sanitizeProperties({ token: "secret" }).ok).toBe(false);
    expect(sanitizeProperties({ form: "name=Ada" }).ok).toBe(false);
    expect(sanitizeProperties({ note: "contact a@b.c" }).ok).toBe(false);
    expect(sanitizeProperties({ authorization: "Bearer abc" }).ok).toBe(false);
  });

  it("accepts bounded non-personal properties", () => {
    const result = sanitizeProperties({ plan: "pro", path: "/app?x=1" });
    expect(result).toEqual({ ok: true, properties: { plan: "pro", path: "/app" } });
  });

  it("redacts unsanitary values from log objects", () => {
    const logged = sanitizeForLog({ email: "a@b.c", plan: "pro" });
    expect(logged).toEqual({ redacted: true });
  });
});
