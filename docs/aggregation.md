# Aggregation, retention, and operations

Generic infrastructure lives in `@kamod-ch/tracking/postgres` and `src/aggregation/`. Core does **not** ship Devjobs KPIs (click rates, etc.) — apps define downstream consumers of `tracking.daily_aggregates`.

## Aggregate grain (migration 004)

Each row in `tracking.daily_aggregates` is uniquely keyed by:

| Column                                                   | Role                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| `tenant_id`, `site_id`                                   | Scope                                                               |
| `purpose`                                                | Consent / retention partition (`analytics`, `measurement`, …)       |
| `time_zone`                                              | IANA zone used for `local_date`                                     |
| `local_date`                                             | Civil calendar day of the bucket instant                            |
| `aggregate_rule_version`                                 | Rollup recipe id (counts, dimensions included)                      |
| `bucket_rule_version`                                    | Version of `selectBucketInstant()` (e.g. `bucket_instant_v1`)       |
| `measurement_rule_version`                               | From stored events (rule changes keep separate rows)                |
| `collection_policy_version`                              | From stored events (`none`, `session`, …) — **not** interchangeable |
| `surface`                                                | Allowlisted low-cardinality view surface (empty when unused)        |
| `event_name`, `subject_object_type`, `subject_object_id` | Subject dimensions                                                  |

Devjobs (and similar apps) pass `allowedSurfaces` on `runDailyCountAggregate()`; only values in that list are persisted. Arbitrary JSON properties must **not** become dimensions.

## Daily count jobs

`runDailyCountAggregate(pool, job)` parameters:

| Field                          | Meaning                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `tenantId`, `siteId`           | Scope                                                                                            |
| `timeZone`                     | IANA zone for civil-day boundaries (never server default)                                        |
| `localDateFrom`, `localDateTo` | Inclusive local dates (`YYYY-MM-DD`)                                                             |
| `aggregateRuleVersion`         | Versioned rollup recipe id                                                                       |
| `bucketRuleVersion`            | Optional; defaults to `bucket_instant_v1`                                                        |
| `purpose`                      | Raw event purpose filter                                                                         |
| `collectionPolicyMode`         | `none` → no `session_count`; `session` → optional distinct `session_id` per bucket (not persons) |
| `allowedSurfaces`              | Optional allowlist for `surface` column                                                          |

Each local day is recomputed in one transaction under an **advisory lock** for the aggregate scope key (same tenant/site/purpose/date/zone/rule/bucket versions). **Delete** rows for that slice, then **insert** fresh counts. Empty days after purge produce **no** aggregate rows.

## `occurred_at` vs `received_at`

Calendar bucketing uses `selectBucketInstant()` (`bucket_rule_version`):

1. Trust `occurred_at` when `occurred_at_trust = adjusted`.
2. Otherwise use `occurred_at` only if `|occurred_at − received_at| ≤ maxProducerSkewMs` (default 7 days).
3. Else bucket by `received_at`.

Rebuild queries load **candidate events** where `received_at` **or** `occurred_at` falls in the civil day interval expanded by `maxProducerSkewMs`, then apply the same rule in application code. There is **no** ingest path that selects by `received_at` day only and re-labels with `occurred_at` afterward.

## Late events, dirty days, and concurrency

`site_data_policy.late_event_backfill_days` (default 3) defines the nominal recompute window. Events outside that window should call `markAggregateDirtyDay()` (includes `purpose` and `aggregateRuleVersion`).

Dirty markers carry a monotonic **`dirty_generation`**. A successful rebuild deletes the marker **only if** the generation still matches the value observed at the start of the transaction. If new late events bump the generation during rebuild, the day remains dirty (`daysStillDirty` in the job result).

`raw_data_watermark.recompute_complete_from_received_at` is the **monotonic retention floor** (explicit completeness boundary). It advances when raw rows are purged and is **never removed** when the events table is empty. `oldest_received_at` is an informational `MIN(received_at)` hint only.

Recompute **skips** civil days that end at or before the floor (`daysSkippedOutsideRaw`) or lack full candidate coverage (`daysSkippedIncompleteCoverage`) and **does not delete** existing aggregate rows for those days.

`tracking.raw_coverage_gaps` marks civil days with partial retention / bucket loss (e.g. purge cutoff splitting a local day in `timeZoneForCoverage`).

## Backfill and indexes (existing deployments)

1. Apply **`005_retention_recompute_boundary.sql`** after `004` (recompute floor, inbox `purpose`, coverage gaps, purge checkpoints).
2. Apply **`004_aggregate_dimensions.sql`** after `003` (additive column backfill + primary key replacement).
3. **Existing `daily_aggregates` rows** receive default `purpose = analytics`, `measurement_rule_version = unknown`, `collection_policy_version = none`, `bucket_rule_version = aggregate_rule_version`, `surface = ''`. Re-run rollups per purpose/time zone/rule to populate correct grains.
4. New indexes: `events_aggregate_candidate_received_idx`, `events_aggregate_candidate_occurred_idx`, `daily_aggregates_scope_date_idx`.
5. Schedule backfill jobs **serially per aggregate scope key** (same lock as online rebuild) to avoid double-writers.

## Retention

Configured per site/purpose in `tracking.site_data_policy`. Validated by `validateSiteRetentionPolicy()`:

- `raw_retention_days` — batched delete from `tracking.events`; advances `recompute_complete_from_received_at` (never resets on empty raw)
- `inbox_retention_days` — **minimum 30 days** (supported client retry/replay horizon); purged by `event_inbox.purpose` without joining `events`. After expiry, dedup is best-effort only — not unlimited exactly-once.
- `aggregate_retention_days` — batched purpose-scoped delete from `daily_aggregates`

`runPurposeRetention(pool, { policy, timeZoneForCoverage, … })` takes an advisory lock per purpose (coordinates with aggregate rebuild locks). Checkpoints in `retention_purge_checkpoint` support resume after interruption.

Legal/evidence retention is **not** tied to analytics deletion in this schema.

## Ops metrics

Integrated counters in `tracking.ops_site_counters` — see [observability.md](./observability.md). PostgreSQL batch acceptance records `ingest_accepted`, `ingest_duplicate`, `ingest_conflict`, `ingest_rejected`, `ingest_storage_failed`, and `ingest_retry` from real outcomes. Aggregation jobs update `dirty_backlog` and `aggregate_lag_seconds`; retention jobs increment `retention_run`. Wire `queue_discard` from browser `onDiscard` in the app layer via `recordQueueDiscardOps()`.

`incrementOpsCounter()` remains available for `unknown_schema_version` and custom buckets — never pass event ids, session ids, IPs, or raw payloads as labels.

## Migrations

Apply migrations in order through **`006_ops_outcome_metrics.sql`** (included in `applyTrackingMigrations()`). Rollback: [migrations.md](./migrations.md).
