-- Daily aggregates, dirty-day backfill markers, retention policy, raw availability, ops counters.

CREATE TABLE IF NOT EXISTS tracking.site_data_policy (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('necessary', 'analytics', 'measurement')),
  raw_retention_days integer,
  aggregate_retention_days integer,
  inbox_retention_days integer,
  late_event_backfill_days integer NOT NULL DEFAULT 3,
  collection_policy_mode text NOT NULL DEFAULT 'none'
    CHECK (collection_policy_mode IN ('none', 'session', 'authenticated')),
  CONSTRAINT site_data_policy_pkey PRIMARY KEY (tenant_id, site_id, purpose),
  CONSTRAINT site_data_policy_site_fkey FOREIGN KEY (tenant_id, site_id)
    REFERENCES tracking.sites (tenant_id, site_id)
);

COMMENT ON TABLE tracking.site_data_policy IS
  'Per-purpose retention and aggregation policy. Legal/evidence retention is out of scope here.';

CREATE TABLE IF NOT EXISTS tracking.raw_data_watermark (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('necessary', 'analytics', 'measurement')),
  oldest_received_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT raw_data_watermark_pkey PRIMARY KEY (tenant_id, site_id, purpose),
  CONSTRAINT raw_data_watermark_site_fkey FOREIGN KEY (tenant_id, site_id)
    REFERENCES tracking.sites (tenant_id, site_id)
);

COMMENT ON TABLE tracking.raw_data_watermark IS
  'Oldest raw event still available per purpose; backfill aborts outside this window without nulling historical aggregates.';

CREATE TABLE IF NOT EXISTS tracking.daily_aggregates (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  local_date date NOT NULL,
  time_zone text NOT NULL,
  aggregate_rule_version text NOT NULL,
  event_name text NOT NULL,
  subject_object_type text NOT NULL,
  subject_object_id text NOT NULL DEFAULT '',
  event_count bigint NOT NULL,
  session_count bigint,
  computed_at timestamptz NOT NULL,
  CONSTRAINT daily_aggregates_pkey PRIMARY KEY (
    tenant_id,
    site_id,
    local_date,
    aggregate_rule_version,
    event_name,
    subject_object_type,
    subject_object_id
  ),
  CONSTRAINT daily_aggregates_site_fkey FOREIGN KEY (tenant_id, site_id)
    REFERENCES tracking.sites (tenant_id, site_id)
);

COMMENT ON COLUMN tracking.daily_aggregates.session_count IS
  'Distinct session_id in bucket when collection_policy_mode=session. Not a person count; do not sum across days as unique visitors.';

CREATE INDEX IF NOT EXISTS daily_aggregates_site_date_idx
  ON tracking.daily_aggregates (tenant_id, site_id, local_date DESC);

CREATE TABLE IF NOT EXISTS tracking.aggregate_dirty_days (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  local_date date NOT NULL,
  time_zone text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('late_event', 'manual', 'purge_adjustment')),
  marked_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT aggregate_dirty_days_pkey PRIMARY KEY (tenant_id, site_id, local_date, time_zone)
);

CREATE TABLE IF NOT EXISTS tracking.ops_site_counters (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  metric text NOT NULL CHECK (metric IN (
    'ingest_accepted',
    'ingest_duplicate',
    'ingest_rejected',
    'ingest_storage_failed',
    'aggregate_lag_seconds',
    'unknown_schema_version'
  )),
  reject_reason text NOT NULL DEFAULT '',
  schema_version integer NOT NULL DEFAULT 0,
  counter bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT ops_site_counters_pkey PRIMARY KEY (
    tenant_id,
    site_id,
    metric,
    reject_reason,
    schema_version
  ),
  CONSTRAINT ops_site_counters_site_fkey FOREIGN KEY (tenant_id, site_id)
    REFERENCES tracking.sites (tenant_id, site_id)
);

COMMENT ON TABLE tracking.ops_site_counters IS
  'Low-cardinality operational counters per site. No event_id or subject labels.';
