# Aggregation, retention, and operations

Generic infrastructure lives in `@kamod-ch/tracking/postgres` and `src/aggregation/`. Core does **not** ship Devjobs KPIs (click rates, etc.) — apps define downstream consumers of `tracking.daily_aggregates`.

## Daily count jobs

`runDailyCountAggregate(pool, job)` parameters:

| Field                          | Meaning                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `tenantId`, `siteId`           | Scope                                                                                            |
| `timeZone`                     | IANA zone for civil-day boundaries (never server default)                                        |
| `localDateFrom`, `localDateTo` | Inclusive local dates (`YYYY-MM-DD`)                                                             |
| `aggregateRuleVersion`         | Versioned rollup recipe id                                                                       |
| `purpose`                      | Raw event purpose filter                                                                         |
| `collectionPolicyMode`         | `none` → no `session_count`; `session` → optional distinct `session_id` per bucket (not persons) |

Each local day is recomputed in one transaction: **delete** existing rows for that day + rule version, then **insert** fresh counts. Empty days after purge produce **no** aggregate rows.

## `occurred_at` vs `received_at`

Calendar bucketing uses `selectBucketInstant()`:

1. Trust `occurred_at` when `occurred_at_trust = adjusted`.
2. Otherwise use `occurred_at` only if `|occurred_at − received_at| ≤ maxProducerSkewMs` (default 7 days).
3. Else bucket by `received_at`.

Browser clocks outside the skew window must not shift business-day reporting.

## Late events & backfill

`site_data_policy.late_event_backfill_days` (default 3) defines the nominal recompute window. Events outside that window should call `markAggregateDirtyDay()` for targeted backfill.

`raw_data_watermark` stores the oldest remaining raw `received_at` per purpose. Recompute **skips** days entirely before that watermark and **does not** delete existing aggregate rows for those days (historical aggregates survive raw retention).

## Retention

Configured per site/purpose in `tracking.site_data_policy`:

- `raw_retention_days` — deletes from `tracking.events`
- `inbox_retention_days` — should be ≥ supported client retry horizon (see ADR 0007)
- `aggregate_retention_days` — deletes old `daily_aggregates` rows independently

Legal/evidence retention is **not** tied to analytics deletion in this schema.

## Ops metrics

`incrementOpsCounter()` updates low-cardinality counters (`ingest_accepted`, `ingest_duplicate`, `ingest_rejected`, `ingest_storage_failed`, `aggregate_lag_seconds`, `unknown_schema_version`). Optional `rejectReason` / `schemaVersion` buckets only — never event or subject ids.

## Migrations

Apply `003_aggregation_retention.sql` after `001` / `002` (included in `applyTrackingMigrations()`).
