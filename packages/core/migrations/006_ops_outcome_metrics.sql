-- Extend ops_site_counters.metric for outcome-linked observability (additive).

ALTER TABLE tracking.ops_site_counters
  DROP CONSTRAINT IF EXISTS ops_site_counters_metric_check;

ALTER TABLE tracking.ops_site_counters
  ADD CONSTRAINT ops_site_counters_metric_check CHECK (metric IN (
    'ingest_accepted',
    'ingest_duplicate',
    'ingest_conflict',
    'ingest_rejected',
    'ingest_storage_failed',
    'ingest_retry',
    'queue_discard',
    'aggregate_lag_seconds',
    'retention_run',
    'dirty_backlog',
    'unknown_schema_version'
  ));

COMMENT ON TABLE tracking.ops_site_counters IS
  'Low-cardinality site counters. reject_reason buckets validation outcomes only — never event_id, session_id, or IP.';
