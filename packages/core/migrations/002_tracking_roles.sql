-- Optional least-privilege role for ingest workers.
-- Run as superuser after 001_tracking_schema.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tracking_ingest') THEN
    CREATE ROLE tracking_ingest NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA tracking TO tracking_ingest;

GRANT SELECT ON tracking.tenants, tracking.sites TO tracking_ingest;
GRANT SELECT, INSERT ON tracking.event_inbox, tracking.events TO tracking_ingest;
GRANT SELECT, INSERT, UPDATE ON tracking.job_watermarks TO tracking_ingest;

REVOKE ALL ON SCHEMA public FROM tracking_ingest;
