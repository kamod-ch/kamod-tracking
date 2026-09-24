-- F07/F08: explicit recompute boundary (not MIN(received_at) proof), inbox purpose,
-- partial-day coverage gaps, retention purge checkpoints.

ALTER TABLE tracking.raw_data_watermark
  ADD COLUMN IF NOT EXISTS recompute_complete_from_received_at timestamptz;

UPDATE tracking.raw_data_watermark
SET recompute_complete_from_received_at = COALESCE(
  recompute_complete_from_received_at,
  oldest_received_at,
  '1970-01-01 00:00:00+00'::timestamptz
)
WHERE recompute_complete_from_received_at IS NULL;

ALTER TABLE tracking.raw_data_watermark
  ALTER COLUMN recompute_complete_from_received_at SET NOT NULL;

ALTER TABLE tracking.raw_data_watermark
  ALTER COLUMN oldest_received_at DROP NOT NULL;

COMMENT ON COLUMN tracking.raw_data_watermark.recompute_complete_from_received_at IS
  'Monotonic retention floor: raw with received_at below this may be purged. Full day recompute requires candidate window at/above this instant. Row is never deleted when events are empty.';

COMMENT ON COLUMN tracking.raw_data_watermark.oldest_received_at IS
  'Hint: MIN(received_at) of remaining raw rows. Informational only; not a completeness guarantee.';

CREATE TABLE IF NOT EXISTS tracking.raw_coverage_gaps (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('necessary', 'analytics', 'measurement')),
  time_zone text NOT NULL,
  local_date date NOT NULL,
  reason text NOT NULL CHECK (reason IN ('retention_partial', 'purge_adjustment')),
  marked_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT raw_coverage_gaps_pkey PRIMARY KEY (
    tenant_id,
    site_id,
    purpose,
    time_zone,
    local_date
  ),
  CONSTRAINT raw_coverage_gaps_site_fkey FOREIGN KEY (tenant_id, site_id)
    REFERENCES tracking.sites (tenant_id, site_id)
);

COMMENT ON TABLE tracking.raw_coverage_gaps IS
  'Civil days that must not be fully recomputed from raw (partial retention or bucket window loss).';

ALTER TABLE tracking.event_inbox
  ADD COLUMN IF NOT EXISTS purpose text;

UPDATE tracking.event_inbox i
SET purpose = e.purpose
FROM tracking.events e
WHERE i.tenant_id = e.tenant_id
  AND i.site_id = e.site_id
  AND i.event_id = e.event_id
  AND i.purpose IS NULL;

UPDATE tracking.event_inbox
SET purpose = 'analytics'
WHERE purpose IS NULL;

ALTER TABLE tracking.event_inbox
  ALTER COLUMN purpose SET NOT NULL;

ALTER TABLE tracking.event_inbox
  DROP CONSTRAINT IF EXISTS event_inbox_purpose_check;

ALTER TABLE tracking.event_inbox
  ADD CONSTRAINT event_inbox_purpose_check
  CHECK (purpose IN ('necessary', 'analytics', 'measurement'));

CREATE INDEX IF NOT EXISTS event_inbox_purpose_received_idx
  ON tracking.event_inbox (tenant_id, site_id, purpose, first_received_at);

CREATE TABLE IF NOT EXISTS tracking.retention_purge_checkpoint (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('necessary', 'analytics', 'measurement')),
  phase text NOT NULL CHECK (phase IN ('raw_events', 'inbox', 'aggregates')),
  last_cutoff timestamptz,
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT retention_purge_checkpoint_pkey PRIMARY KEY (tenant_id, site_id, purpose, phase),
  CONSTRAINT retention_purge_checkpoint_site_fkey FOREIGN KEY (tenant_id, site_id)
    REFERENCES tracking.sites (tenant_id, site_id)
);

COMMENT ON TABLE tracking.retention_purge_checkpoint IS
  'Resume cursor for batched retention jobs after interruption.';
