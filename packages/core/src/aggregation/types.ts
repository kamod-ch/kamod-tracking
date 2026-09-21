/** Generic daily-count rollup job — no product-specific KPIs in core. */
export type DailyCountAggregateJob = {
  readonly tenantId: string;
  readonly siteId: string;
  readonly timeZone: string;
  readonly aggregateRuleVersion: string;
  readonly localDateFrom: string;
  readonly localDateTo: string;
  readonly purpose: "necessary" | "analytics" | "measurement";
  readonly collectionPolicyMode: "none" | "session" | "authenticated";
  readonly maxProducerSkewMs?: number;
};

export type AggregateRunResult = {
  readonly daysProcessed: number;
  readonly daysSkippedOutsideRaw: number;
  readonly rowsWritten: number;
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
  | "ingest_rejected"
  | "ingest_storage_failed"
  | "aggregate_lag_seconds"
  | "unknown_schema_version";
