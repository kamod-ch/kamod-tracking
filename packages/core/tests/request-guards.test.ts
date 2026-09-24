import { describe, expect, it } from "vitest";
import {
  corsHeadersForCollectResponse,
  corsPreflightResponse,
  isOriginAllowed,
} from "../src/server/request-guards";

const allowed = ["https://app.example"];

describe("request guards CORS and origin", () => {
  it("does not fall back to Referer when Origin is present but forbidden", () => {
    const request = new Request("https://collect.example/v1/collect/pk", {
      headers: {
        origin: "https://evil.example",
        referer: "https://app.example/page",
      },
    });
    expect(isOriginAllowed(request, allowed)).toBe(false);
  });

  it("allows Referer-only match when Origin header is absent", () => {
    const request = new Request("https://collect.example/v1/collect/pk", {
      headers: { referer: "https://app.example/page" },
    });
    expect(isOriginAllowed(request, allowed)).toBe(true);
  });

  it("preflight reflects allowed Origin and Vary", () => {
    const request = new Request("https://collect.example/v1/collect/pk", {
      method: "OPTIONS",
      headers: { origin: "https://app.example" },
    });
    const response = corsPreflightResponse(request, allowed);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("preflight rejects disallowed Origin without wildcard", () => {
    const request = new Request("https://collect.example/v1/collect/pk", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    const response = corsPreflightResponse(request, allowed);
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("collect response CORS mirrors request Origin when allowed", () => {
    const request = new Request("https://collect.example/v1/collect/pk", {
      method: "POST",
      headers: { origin: "https://app.example" },
    });
    const headers = corsHeadersForCollectResponse(request, allowed);
    expect(headers["access-control-allow-origin"]).toBe("https://app.example");
    expect(headers.vary).toBe("Origin");
  });
});
