# ADR 0009: Aggregation, retention, and ops counters

## Status

Accepted.

## Decision

- Daily rollups are **generic event/subject counts** in PostgreSQL (`tracking.daily_aggregates`), keyed by explicit **IANA timezone** civil dates.
- Product KPIs stay outside core; jobs pass `aggregateRuleVersion` + scope.
- Bucketing uses `occurred_at` only within documented plausibility vs `received_at`.
- Recompute replaces one local day atomically; idempotent reruns.
- Raw retention updates `raw_data_watermark`; backfill outside raw availability skips days without nulling historical aggregates.
- Session distinct counts are optional and not unique visitors; mode `none` stores no session metric.
- Ops counters are site-level with bounded label cardinality.

## Consequences

- Operators configure retention per purpose; inbox TTL must remain retry-safe.
- Downstream BI joins aggregates to business definitions in app repos, not in `@kamod-ch/tracking` core.
