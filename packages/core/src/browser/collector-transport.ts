import type { BatchCollectResponse, BatchEventOutcome } from "../server/batch-contract";
import type { QueuedCollectorEvent } from "./event-queue";

export type DeliveryKind = "verified" | "browser-accepted" | "failed";

export type CollectorSendResult = {
  readonly delivery: DeliveryKind;
  readonly outcomes?: readonly BatchEventOutcome[];
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly httpStatus?: number;
};

export type SendBeaconFn = (url: string | URL, data?: BodyInit | null) => boolean;

export type CollectorTransport = {
  sendBatch(
    events: readonly QueuedCollectorEvent[],
    options?: { readonly unload?: boolean },
  ): Promise<CollectorSendResult>;
};

export type CollectorTransportOptions = {
  readonly endpoint: string;
  readonly publicKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly sendBeacon?: SendBeaconFn;
  readonly createAbortSignal?: () => AbortSignal;
};

export const COLLECTOR_JSON_CONTENT_TYPE = "application/json";

export const buildCollectUrl = (endpoint: string, publicKey?: string): string => {
  const trimmed = endpoint.replace(/\/+$/, "");
  if (publicKey) {
    return `${trimmed}/v1/collect/${publicKey}`;
  }
  return trimmed;
};

export const toCollectorBatchBody = (
  appId: string,
  events: readonly QueuedCollectorEvent[],
): string =>
  JSON.stringify({
    appId,
    events: events.map((event) => ({
      event_id: event.event_id,
      schema_version: event.schema_version,
      event_name: event.event_name,
      occurred_at: event.occurred_at,
      subject: event.subject,
      properties: event.properties,
      ...(event.session !== undefined ? { session: event.session } : {}),
    })),
  });

export const buildCollectorBeaconBody = (jsonBody: string): Blob =>
  new Blob([jsonBody], { type: COLLECTOR_JSON_CONTENT_TYPE });

export const bindNavigatorSendBeacon = (navigator: Pick<Navigator, "sendBeacon">): SendBeaconFn =>
  navigator.sendBeacon.bind(navigator);

export const parseRetryAfterHeader = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds;
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return undefined;
};

export const outcomesCoverBatch = (
  batch: readonly QueuedCollectorEvent[],
  outcomes: readonly BatchEventOutcome[],
): boolean => {
  const ids = new Set(outcomes.map((entry) => entry.event_id));
  return batch.every((event) => ids.has(event.event_id));
};

export const filterOutcomesToBatch = (
  batch: readonly QueuedCollectorEvent[],
  outcomes: readonly BatchEventOutcome[],
): BatchEventOutcome[] => {
  const allowed = new Set(batch.map((event) => event.event_id));
  return outcomes.filter((outcome) => allowed.has(outcome.event_id));
};

export const createCollectorTransport = (
  options: CollectorTransportOptions,
): CollectorTransport => {
  const url = buildCollectUrl(options.endpoint, options.publicKey);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sendBeacon = options.sendBeacon;

  return {
    async sendBatch(events, sendOptions) {
      if (events.length === 0) {
        return { delivery: "verified", retryable: false, outcomes: [] };
      }
      const body = toCollectorBatchBody(events[0]?.appId ?? "", events);

      if (sendOptions?.unload === true && sendBeacon) {
        const beaconBody = buildCollectorBeaconBody(body);
        const accepted = sendBeacon(url, beaconBody);
        return accepted
          ? { delivery: "browser-accepted", retryable: false }
          : { delivery: "failed", retryable: true };
      }

      if (typeof fetchImpl !== "function") {
        return { delivery: "failed", retryable: true };
      }

      const signal = options.createAbortSignal?.();
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body,
          keepalive: sendOptions?.unload === true,
          ...(signal !== undefined ? { signal } : {}),
        });
        const retryAfter = parseRetryAfterHeader(response.headers.get("retry-after"));
        let parsed: BatchCollectResponse | undefined;
        try {
          parsed = (await response.json()) as BatchCollectResponse;
        } catch {
          parsed = undefined;
        }

        if (response.status === 429 || response.status === 503) {
          return {
            delivery: "failed" as const,
            retryable: true as const,
            httpStatus: response.status,
            ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
          };
        }

        if (!response.ok) {
          const retryable = response.status >= 500;
          return {
            delivery: "failed" as const,
            retryable,
            httpStatus: response.status,
            ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
          };
        }

        if (parsed?.ok !== true || !Array.isArray(parsed.outcomes)) {
          return {
            delivery: "failed",
            retryable: true,
            httpStatus: response.status,
            ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
          };
        }

        if (!outcomesCoverBatch(events, parsed.outcomes)) {
          return {
            delivery: "failed",
            retryable: true,
            httpStatus: response.status,
            ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
          };
        }

        return {
          delivery: "verified",
          retryable: false,
          outcomes: filterOutcomesToBatch(events, parsed.outcomes),
          httpStatus: response.status,
        };
      } catch {
        return { delivery: "failed", retryable: true };
      }
    },
  };
};
