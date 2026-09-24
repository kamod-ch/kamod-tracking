import { expandCandidateUtcBounds } from "./bucket-timestamp";
import { formatLocalDate, localDayUtcBounds } from "./time-bucketing";

export type RawRecomputeBoundary = {
  readonly recomputeCompleteFromReceivedAt: Date;
  readonly oldestRemainingReceivedAt: Date | undefined;
};

export type LocalCoverageGap = {
  readonly timeZone: string;
  readonly localDate: string;
  readonly reason: "retention_partial" | "purge_adjustment";
};

/** Default floor when no watermark row exists yet. */
export const DEFAULT_RECOMPUTE_FLOOR_EPOCH = new Date("1970-01-01T00:00:00.000Z");

/**
 * A civil day is fully recomputable only when the expanded candidate window does not
 * require raw rows with received_at before the retention floor, and no gap marker exists.
 */
export const canFullyRecomputeLocalDay = (input: {
  readonly localDate: string;
  readonly timeZone: string;
  readonly recomputeCompleteFromReceivedAt: Date;
  readonly maxProducerSkewMs: number;
  readonly gapDates: ReadonlySet<string>;
}): boolean => {
  if (input.gapDates.has(input.localDate)) {
    return false;
  }
  const { startUtc, endUtc } = localDayUtcBounds(input.localDate, input.timeZone);
  const candidate = expandCandidateUtcBounds(startUtc, endUtc, input.maxProducerSkewMs);
  if (candidate.startUtc.getTime() < input.recomputeCompleteFromReceivedAt.getTime()) {
    return false;
  }
  if (
    input.recomputeCompleteFromReceivedAt.getTime() > startUtc.getTime() &&
    input.recomputeCompleteFromReceivedAt.getTime() < endUtc.getTime()
  ) {
    return false;
  }
  return true;
};

/** Mark the civil day containing `instant` when retention cutoff splits that day. */
export const localDatesAtRetentionCutoff = (cutoff: Date, timeZone: string): string[] => {
  const primary = formatLocalDate(cutoff, timeZone);
  const { startUtc, endUtc } = localDayUtcBounds(primary, timeZone);
  if (cutoff.getTime() > startUtc.getTime() && cutoff.getTime() < endUtc.getTime()) {
    return [primary];
  }
  return [];
};

export const dayEndsBeforeRecomputeFloor = (
  localDate: string,
  timeZone: string,
  floor: Date,
): boolean => {
  const { endUtc } = localDayUtcBounds(localDate, timeZone);
  return endUtc.getTime() <= floor.getTime();
};
