/**
 * Aggregation bucketing timestamp policy (see docs/aggregation.md).
 *
 * - Primary bucket axis: `occurred_at` when producer time is trusted within plausibility vs `received_at`.
 * - Otherwise bucket by `received_at` (ingest/server clock).
 * - `received_at` and `occurred_at` are never interchangeable without this check.
 */
export type BucketTimestampInput = {
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly occurredAtTrust: "producer" | "adjusted";
  readonly maxProducerSkewMs: number;
};

export const selectBucketInstant = (input: BucketTimestampInput): Date => {
  if (input.occurredAtTrust === "adjusted") {
    return input.occurredAt;
  }
  const skewMs = Math.abs(input.receivedAt.getTime() - input.occurredAt.getTime());
  if (skewMs <= input.maxProducerSkewMs) {
    return input.occurredAt;
  }
  return input.receivedAt;
};

export const DEFAULT_MAX_PRODUCER_SKEW_MS = 7 * 24 * 60 * 60_000;

/** Version id persisted on aggregate rows; bump when bucketing policy changes. */
export const BUCKET_INSTANT_RULE_V1 = "bucket_instant_v1";

export const expandCandidateUtcBounds = (
  startUtc: Date,
  endUtc: Date,
  maxProducerSkewMs: number,
): { readonly startUtc: Date; readonly endUtc: Date } => ({
  startUtc: new Date(startUtc.getTime() - maxProducerSkewMs),
  endUtc: new Date(endUtc.getTime() + maxProducerSkewMs),
});
