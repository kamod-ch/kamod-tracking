-- V1 durable store: unpartitioned events + non-partitioned inbox dedup register.
-- See docs/adr/0007-postgres-dedup-inbox.md (global dedup is NOT provided by monthly partitioned UNIQUE(event_id) alone).

CREATE SCHEMA IF NOT EXISTS tracking;

CREATE TABLE IF NOT EXISTS tracking.tenants (
  tenant_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT tenants_pkey PRIMARY KEY (tenant_id)
);

CREATE TABLE IF NOT EXISTS tracking.sites (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  app_id text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT sites_pkey PRIMARY KEY (tenant_id, site_id),
  CONSTRAINT sites_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES tracking.tenants (tenant_id)
);

COMMENT ON TABLE tracking.sites IS 'Server-side site configuration bound to a tenant.';

CREATE TABLE IF NOT EXISTS tracking.event_inbox (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  event_id text NOT NULL,
  payload_hash bytea NOT NULL,
  first_received_at timestamptz NOT NULL,
  CONSTRAINT event_inbox_pkey PRIMARY KEY (tenant_id, site_id, event_id),
  CONSTRAINT event_inbox_site_fkey FOREIGN KEY (tenant_id, site_id) REFERENCES tracking.sites (tenant_id, site_id)
);

COMMENT ON TABLE tracking.event_inbox IS 'Dedup register: one row per accepted event id per site. Not partitioned in V1.';

CREATE TABLE IF NOT EXISTS tracking.events (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  event_id text NOT NULL,
  schema_version integer NOT NULL,
  event_name text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  producer text NOT NULL CHECK (producer IN ('browser', 'server')),
  trust_class text NOT NULL CHECK (trust_class IN ('untrusted', 'trusted')),
  measurement_rule_version text NOT NULL,
  collection_policy_version text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('necessary', 'analytics', 'measurement')),
  consent_state text NOT NULL CHECK (consent_state IN ('unknown', 'granted', 'denied')),
  legal_basis jsonb NOT NULL,
  occurred_at_trust text NOT NULL CHECK (occurred_at_trust IN ('producer', 'adjusted')),
  subject_object_type text NOT NULL,
  subject_object_id text,
  session_id text,
  payload jsonb NOT NULL,
  payload_hash bytea NOT NULL,
  CONSTRAINT events_pkey PRIMARY KEY (tenant_id, site_id, event_id),
  CONSTRAINT events_site_fkey FOREIGN KEY (tenant_id, site_id) REFERENCES tracking.sites (tenant_id, site_id),
  CONSTRAINT events_inbox_fkey FOREIGN KEY (tenant_id, site_id, event_id) REFERENCES tracking.event_inbox (tenant_id, site_id, event_id)
);

CREATE INDEX IF NOT EXISTS events_site_occurred_idx
  ON tracking.events (tenant_id, site_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_subject_occurred_idx
  ON tracking.events (tenant_id, site_id, subject_object_type, subject_object_id, occurred_at DESC)
  WHERE subject_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tracking.job_watermarks (
  tenant_id text NOT NULL,
  site_id text NOT NULL,
  job_name text NOT NULL,
  watermark timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT job_watermarks_pkey PRIMARY KEY (tenant_id, site_id, job_name),
  CONSTRAINT job_watermarks_site_fkey FOREIGN KEY (tenant_id, site_id) REFERENCES tracking.sites (tenant_id, site_id)
);

COMMENT ON TABLE tracking.job_watermarks IS 'Aggregation / batch job high-water marks (UTC).';
