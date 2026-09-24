-- F05/F06/F13: unique aggregate grain (purpose, zone, rule versions, allowlisted surface)
-- and generation-aware dirty-day markers.

ALTER TABLE tracking.daily_aggregates
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS measurement_rule_version text,
  ADD COLUMN IF NOT EXISTS collection_policy_version text,
  ADD COLUMN IF NOT EXISTS bucket_rule_version text,
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT '';

UPDATE tracking.daily_aggregates
SET
  purpose = COALESCE(purpose, 'analytics'),
  measurement_rule_version = COALESCE(measurement_rule_version, 'unknown'),
  collection_policy_version = COALESCE(collection_policy_version, 'none'),
  bucket_rule_version = COALESCE(bucket_rule_version, aggregate_rule_version),
  surface = COALESCE(surface, '')
WHERE purpose IS NULL
   OR measurement_rule_version IS NULL
   OR collection_policy_version IS NULL
   OR bucket_rule_version IS NULL;

ALTER TABLE tracking.daily_aggregates
  ALTER COLUMN purpose SET NOT NULL,
  ALTER COLUMN measurement_rule_version SET NOT NULL,
  ALTER COLUMN collection_policy_version SET NOT NULL,
  ALTER COLUMN bucket_rule_version SET NOT NULL;

ALTER TABLE tracking.daily_aggregates
  DROP CONSTRAINT IF EXISTS daily_aggregates_pkey;

ALTER TABLE tracking.daily_aggregates
  ADD CONSTRAINT daily_aggregates_pkey PRIMARY KEY (
    tenant_id,
    site_id,
    purpose,
    time_zone,
    local_date,
    aggregate_rule_version,
    bucket_rule_version,
    measurement_rule_version,
    collection_policy_version,
    surface,
    event_name,
    subject_object_type,
    subject_object_id
  );

CREATE INDEX IF NOT EXISTS daily_aggregates_scope_date_idx
  ON tracking.daily_aggregates (
    tenant_id,
    site_id,
    purpose,
    time_zone,
    local_date DESC,
    aggregate_rule_version,
    bucket_rule_version
  );

COMMENT ON COLUMN tracking.daily_aggregates.surface IS
  'Allowlisted view surface dimension (low cardinality). Empty string when not applicable or not allowlisted.';

COMMENT ON COLUMN tracking.daily_aggregates.bucket_rule_version IS
  'Version id of selectBucketInstant() policy used when assigning local_date.';

ALTER TABLE tracking.aggregate_dirty_days
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS aggregate_rule_version text,
  ADD COLUMN IF NOT EXISTS dirty_generation bigint NOT NULL DEFAULT 1;

UPDATE tracking.aggregate_dirty_days
SET
  purpose = COALESCE(purpose, 'analytics'),
  aggregate_rule_version = COALESCE(aggregate_rule_version, 'daily_counts_v1')
WHERE purpose IS NULL OR aggregate_rule_version IS NULL;

ALTER TABLE tracking.aggregate_dirty_days
  ALTER COLUMN purpose SET NOT NULL,
  ALTER COLUMN aggregate_rule_version SET NOT NULL;

ALTER TABLE tracking.aggregate_dirty_days
  DROP CONSTRAINT IF EXISTS aggregate_dirty_days_pkey;

ALTER TABLE tracking.aggregate_dirty_days
  ADD CONSTRAINT aggregate_dirty_days_pkey PRIMARY KEY (
    tenant_id,
    site_id,
    purpose,
    local_date,
    time_zone,
    aggregate_rule_version
  );

COMMENT ON COLUMN tracking.aggregate_dirty_days.dirty_generation IS
  'Incremented on each mark; rebuild deletes the row only when generation still matches.';

CREATE INDEX IF NOT EXISTS events_aggregate_candidate_received_idx
  ON tracking.events (tenant_id, site_id, purpose, received_at);

CREATE INDEX IF NOT EXISTS events_aggregate_candidate_occurred_idx
  ON tracking.events (tenant_id, site_id, purpose, occurred_at);

DROP INDEX IF EXISTS tracking.daily_aggregates_site_date_idx;
