# ADR 0007: PostgreSQL deduplication (V1)

## Status

Accepted

## Context

Browser delivery is best-effort with at most three retries. We need atomic accept semantics and idempotent retries without overwriting conflicting payloads.

PostgreSQL partitioned tables require partition keys in unique constraints. A monthly partitioned `events` table with `UNIQUE(event_id)` alone does **not** guarantee global deduplication across partitions.

## Decision

- **V1:** `tracking.events` is **not partitioned**. Primary key `(tenant_id, site_id, event_id)`.
- **Dedup register:** `tracking.event_inbox` is a separate **non-partitioned** table with the same primary key, holding `payload_hash` and `first_received_at`.
- Inbox insert and event insert run in **one transaction**. Rollback leaves no consumed inbox row.
- **Retry:** same `(tenant_id, site_id, event_id)` and identical `payload_hash` → success, duplicate.
- **Conflict:** same id, different `payload_hash` → reject, no update.
- **Hash input:** canonical JSON of envelope fields **excluding** `received_at` (key order normalized).
- **Timestamps:** stored as `timestamptz` in UTC. Calendar-day boundaries belong in aggregation, not ingest.
- **Dedup retention (V1):** inbox rows are retained without TTL. Supported client retry window is seconds-to-minutes; any future TTL job must use a window **longer** than the maximum retry horizon (documented minimum 30 days when TTL is introduced).

## Consequences

- Repositories are constructed with fixed `(tenantId, siteId)` and always bind both in SQL.
- Monthly partitioning may be added later with inbox remaining the global dedup authority.
