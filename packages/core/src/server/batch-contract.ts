import type { IngestRejectReason } from "../core/types";

export const DEFAULT_MAX_BATCH_EVENTS = 20;
export const DEFAULT_MAX_BATCH_BYTES = 32 * 1024;

export type CollectorLimits = {
  readonly maxBatchEvents?: number;
  readonly maxBatchBytes?: number;
};

export const resolveCollectorLimits = (
  limits: CollectorLimits | undefined,
): Required<CollectorLimits> => ({
  maxBatchEvents: limits?.maxBatchEvents ?? DEFAULT_MAX_BATCH_EVENTS,
  maxBatchBytes: limits?.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES,
});

export type BatchEventOutcome =
  | {
      readonly event_id: string;
      readonly status: "accepted";
      readonly duplicate: boolean;
    }
  | {
      readonly event_id: string;
      readonly status: "rejected";
      readonly reason: IngestRejectReason;
    };

export type BatchCollectResponse =
  | { readonly ok: true; readonly outcomes: readonly BatchEventOutcome[] }
  | {
      readonly ok: false;
      readonly reason: "invalid-payload" | "payload-too-large" | "storage-error" | "rate-limited";
      readonly retryable?: boolean;
    };

export type BatchEnvelopeAcceptance = {
  acceptBatch(
    envelopes: readonly import("../core/envelope").TrackingEventEnvelope[],
  ): Promise<
    | { readonly ok: true; readonly outcomes: readonly BatchEventOutcome[] }
    | { readonly ok: false; readonly retryable: true; readonly reason: "storage-error" }
  >;
};
