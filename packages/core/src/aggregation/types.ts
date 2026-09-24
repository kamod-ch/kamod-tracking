/** Generic daily-count rollup job — no product-specific KPIs in core. */
export type DailyCountAggregateJob = {
  readonly tenantId: string;
  readonly siteId: string;
  readonly timeZone: string;
  readonly aggregateRuleVersion: string;
  /** Version of `selectBucketInstant()` used for civil-day assignment. */
  readonly bucketRuleVersion?: string;
  readonly localDateFrom: string;
  readonly localDateTo: string;
  readonly purpose: "necessary" | "analytics" | "measurement";
  readonly collectionPolicyMode: "none" | "session" | "authenticated";
  readonly maxProducerSkewMs?: number;
  /** Allowlisted `surface` values from event payload (e.g. Devjobs view surfaces). */
  readonly allowedSurfaces?: readonly string[];
};

export type AggregateScopeKey = {
  readonly tenantId: string;
  readonly siteId: string;
  readonly purpose: DailyCountAggregateJob["purpose"];
  readonly timeZone: string;
  readonly localDate: string;
  readonly aggregateRuleVersion: string;
  readonly bucketRuleVersion: string;
};

export type AggregateRunResult = {
  readonly daysProcessed: number;
  readonly daysSkippedOutsideRaw: number;
  readonly daysSkippedIncompleteCoverage: number;
  readonly rowsWritten: number;
  readonly daysStillDirty: number;
  readonly recomputeCompleteFromReceivedAt?: string;
};

export type SiteRetentionPolicy = {
  readonly tenantId: string;
  readonly siteId: string;
  readonly purpose: "necessary" | "analytics" | "measurement";
  readonly rawRetentionDays: number | null;
  readonly aggregateRetentionDays: number | null;
  readonly inboxRetentionDays: number | null;
  readonly lateEventBackfillDays: number;
  readonly collectionPolicyMode: "none" | "session" | "authenticated";
};

export type OpsMetric =
  | "ingest_accepted"
  | "ingest_duplicate"
  | "ingest_conflict"
  | "ingest_rejected"
  | "ingest_storage_failed"
  | "ingest_retry"
  | "queue_discard"
  | "aggregate_lag_seconds"
  | "retention_run"
  | "dirty_backlog"
  | "unknown_schema_version";
