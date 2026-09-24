import { describe, expect, it, vi } from "vitest";
import {
  bindNavigatorSendBeacon,
  buildCollectorBeaconBody,
  COLLECTOR_JSON_CONTENT_TYPE,
  createCollectorTransport,
  filterOutcomesToBatch,
  outcomesCoverBatch,
  parseRetryAfterHeader,
} from "../src/browser/collector-transport";
import type { QueuedCollectorEvent } from "../src/browser/event-queue";

const queued = (id: string): QueuedCollectorEvent => ({
  event_id: id,
  appId: "app-a",
  schema_version: 1,
  event_name: "content.view",
  occurred_at: "2026-09-21T12:00:00.000Z",
  subject: { objectType: "none" },
  properties: { path: "/", content_type: "page" },
  purpose: "analytics",
  enqueuedAtMs: 0,
  retryAttempt: 0,
});

describe("collector transport", () => {
  it("parseRetryAfterHeader accepts delta seconds and HTTP dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T12:00:00.000Z"));
    expect(parseRetryAfterHeader("12")).toBe(12);
    expect(parseRetryAfterHeader("Wed, 21 Sep 2026 12:00:30 GMT")).toBe(30);
    vi.useRealTimers();
  });

  it("beacon uses JSON Blob with collector content type", async () => {
    let payload: BodyInit | null | undefined;
    const transport = createCollectorTransport({
      endpoint: "https://collect.example",
      publicKey: "pk_test",
      sendBeacon: (_url, data) => {
        payload = data;
        return true;
      },
    });
    const result = await transport.sendBatch([queued("evt_1")], { unload: true });
    expect(result).toEqual({ delivery: "browser-accepted", retryable: false });
    expect(payload).toBeInstanceOf(Blob);
    expect((payload as Blob).type).toBe(COLLECTOR_JSON_CONTENT_TYPE);
  });

  it("bindNavigatorSendBeacon preserves native this binding", () => {
    let called = false;
    const navigatorLike = {
      sendBeacon(url: string, data?: BodyInit | null) {
        called = url === "https://x.test" && data instanceof Blob;
        return true;
      },
    };
    const bound = bindNavigatorSendBeacon(navigatorLike as Navigator);
    bound("https://x.test", buildCollectorBeaconBody("{}"));
    expect(called).toBe(true);
  });

  it("fetch path fails retryable when outcomes omit batch ids", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, outcomes: [] }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    const transport = createCollectorTransport({
      endpoint: "https://collect.example",
      fetchImpl,
    });
    const result = await transport.sendBatch([queued("evt_missing")]);
    expect(result.delivery).toBe("failed");
    expect(result.retryable).toBe(true);
  });

  it("filters foreign outcome ids from verified responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          outcomes: [
            { event_id: "evt_1", status: "accepted", duplicate: false },
            { event_id: "evt_foreign", status: "accepted", duplicate: false },
          ],
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    const transport = createCollectorTransport({
      endpoint: "https://collect.example",
      fetchImpl,
    });
    const batch = [queued("evt_1")];
    const result = await transport.sendBatch(batch);
    expect(result.delivery).toBe("verified");
    expect(outcomesCoverBatch(batch, result.outcomes ?? [])).toBe(true);
    expect(filterOutcomesToBatch(batch, result.outcomes ?? []).map((o) => o.event_id)).toEqual([
      "evt_1",
    ]);
  });

  it("maps 429 to retryable with Retry-After", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, reason: "rate-limited" }), {
        status: 429,
        headers: { "retry-after": "7" },
      }),
    );
    const transport = createCollectorTransport({
      endpoint: "https://collect.example",
      fetchImpl,
    });
    const result = await transport.sendBatch([queued("evt_1")]);
    expect(result).toMatchObject({ delivery: "failed", retryable: true, retryAfterSeconds: 7 });
  });
});
