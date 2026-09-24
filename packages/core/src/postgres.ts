export { applyTrackingMigrations, readMigrationSql, resetTrackingSchema } from "./postgres/migrate";
export {
  hashEnvelopePayload,
  stableStringify,
  dedupContentFromEnvelope,
  payloadHashesEqual,
} from "./postgres/payload-hash";
export type { DedupEnvelopeContent } from "./postgres/payload-hash";
export {
  acceptEnvelopeWithForcedEventFailure,
  countInboxRows,
  countStoredEvents,
  createScopedPostgresEnvelopeStore,
  seedTrackingSite,
} from "./postgres/scoped-store";
export {
  createPostgresBatchAcceptanceForScope,
  createPostgresBatchAcceptanceResolver,
  createScopedPostgresBatchAcceptance,
  resolvePostgresBatchAcceptanceForSite,
} from "./postgres/scoped-batch-acceptance";
export type {
  PostgresBatchAcceptanceResolver,
  ScopedPostgresBatchAcceptanceOptions,
} from "./postgres/scoped-batch-acceptance";
export type {
  PostgresAcceptResult,
  PostgresScope,
  ScopedPostgresEnvelopeStore,
  ScopedPostgresStoreOptions,
} from "./postgres/scoped-store";
export {
  markAggregateDirtyDay,
  readDirtyGeneration,
  runDailyCountAggregate,
  readRawWatermark,
  upsertRawWatermark,
} from "./postgres/daily-aggregate";
export {
  runPurposeRetention,
  refreshRawWatermark,
  readRecomputeBoundary,
  validateSiteRetentionPolicy,
  MIN_INBOX_RETENTION_DAYS,
  SUPPORTED_CLIENT_RETRY_HORIZON_DAYS,
} from "./postgres/retention";
export type {
  RetentionRunOptions,
  RetentionRunResult,
  RetentionValidationIssue,
} from "./postgres/retention";
export {
  incrementOpsCounter,
  recordAggregateLagOps,
  recordBatchIngestOps,
  recordIngestStorageFailureOps,
  recordQueueDiscardOps,
  recordRetentionRunOps,
  setOpsGaugeCounter,
  syncDirtyBacklogOps,
} from "./postgres/ops-metrics";
export type { OpsCounterIncrement } from "./postgres/ops-metrics";
export type {
  AggregateRunResult,
  AggregateScopeKey,
  DailyCountAggregateJob,
  OpsMetric,
  SiteRetentionPolicy,
} from "./aggregation/types";
export {
  BUCKET_INSTANT_RULE_V1,
  DEFAULT_MAX_PRODUCER_SKEW_MS,
  expandCandidateUtcBounds,
  selectBucketInstant,
} from "./aggregation/bucket-timestamp";
export { resolveAllowlistedSurface } from "./aggregation/surface-dimension";
export type { BucketTimestampInput } from "./aggregation/bucket-timestamp";
export {
  canFullyRecomputeLocalDay,
  dayEndsBeforeRecomputeFloor,
  localDatesAtRetentionCutoff,
} from "./aggregation/recompute-coverage";
export type { RawRecomputeBoundary } from "./aggregation/recompute-coverage";
export {
  enumerateLocalDates,
  formatLocalDate,
  localDayUtcBounds,
  zonedLocalDateTimeToUtc,
} from "./aggregation/time-bucketing";
