import { describe, expect, it } from "vitest";
import { createMemoryConsentStore, readConsentState, recordConsent } from "../src/core/consent";

describe("consent vs legal basis", () => {
  it("records collection permission without inferring a legal basis", () => {
    const store = createMemoryConsentStore();
    const record = recordConsent({
      store,
      appId: "app-a",
      purpose: "analytics",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });

    expect(record.state).toBe("granted");
    expect(record.legalBasis).toEqual({ kind: "unspecified" });
    expect(readConsentState(store, "app-a", "analytics")).toBe("granted");
  });

  it("stores an application-declared legal basis only when supplied explicitly", () => {
    const store = createMemoryConsentStore();
    const record = recordConsent({
      store,
      appId: "app-a",
      purpose: "analytics",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
      legalBasis: { kind: "declared", code: "legitimate-interest" },
    });

    expect(record.state).toBe("granted");
    expect(record.legalBasis).toEqual({ kind: "declared", code: "legitimate-interest" });
  });

  it("does not treat a grant as a legal evaluation of another purpose", () => {
    const store = createMemoryConsentStore();
    recordConsent({
      store,
      appId: "app-a",
      purpose: "analytics",
      state: "granted",
      recordedAt: "2026-09-21T12:00:00.000Z",
    });

    expect(readConsentState(store, "app-a", "measurement")).toBe("unknown");
  });
});
