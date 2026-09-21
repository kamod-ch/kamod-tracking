import { describe, expect, it } from "vitest";
import { withBestEffortRetries } from "../src/browser";
import type { DeliveryResult, TrackingEvent, Transport } from "../src/core/types";

const event = { id: "evt_1" } as TrackingEvent;

describe("best-effort retries", () => {
  it("retries a failed send up to three times and stops after success", async () => {
    let calls = 0;
    const inner: Transport = {
      async send(): Promise<DeliveryResult> {
        calls += 1;
        if (calls < 3) {
          return { accepted: 0, dropped: 1, guarantee: "best-effort" };
        }
        return { accepted: 1, dropped: 0, guarantee: "best-effort" };
      },
    };
    const result = await withBestEffortRetries(inner, 3).send([event]);
    expect(calls).toBe(3);
    expect(result).toEqual({ accepted: 1, dropped: 0, guarantee: "best-effort" });
  });

  it("does not retry beyond the cap", async () => {
    let calls = 0;
    const inner: Transport = {
      async send(): Promise<DeliveryResult> {
        calls += 1;
        throw new Error("offline");
      },
    };
    const result = await withBestEffortRetries(inner, 3).send([event]);
    expect(calls).toBe(3);
    expect(result.guarantee).toBe("best-effort");
    expect(result.accepted).toBe(0);
  });
});
