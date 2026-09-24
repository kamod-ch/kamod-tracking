# Observability (PostgreSQL ops counters)

Counters live in `tracking.ops_site_counters`. They are **wired from real ingest, aggregation, and retention outcomes** in the PostgreSQL adapter — calling `incrementOpsCounter()` alone is not considered integrated observability.

## Metrics

| Metric                   | Source                                               | Notes                                                                                    |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ingest_accepted`        | PG batch acceptance                                  | New stored event (non-duplicate).                                                        |
| `ingest_duplicate`       | PG batch acceptance                                  | Same id + payload replay.                                                                |
| `ingest_conflict`        | PG batch acceptance                                  | Same id, different payload.                                                              |
| `ingest_rejected`        | PG batch acceptance                                  | Validation / scope rejects; bucketed by low-cardinality `reject_reason`.                 |
| `ingest_storage_failed`  | PG batch acceptance                                  | Transaction rollback; delta = batch size.                                                |
| `ingest_retry`           | PG batch acceptance                                  | Incremented with each storage failure (collector/client may retry).                      |
| `queue_discard`          | **Your worker** via `recordQueueDiscardOps()`        | Wire from `tracker.onDiscard()` in the app (browser queue full, expiry, consent revoke). |
| `aggregate_lag_seconds`  | `runDailyCountAggregate()`                           | Gauge: seconds since oldest dirty-day marker (0 when none).                              |
| `dirty_backlog`          | `runDailyCountAggregate()` + `syncDirtyBacklogOps()` | Gauge: row count in `aggregate_dirty_days`.                                              |
| `retention_run`          | `runPurposeRetention()`                              | One increment per completed retention job (per purpose policy run).                      |
| `unknown_schema_version` | Manual / app hook                                    | Use when rejecting unsupported schema versions at the edge.                              |

## Automatic wiring

- `createScopedPostgresBatchAcceptance({ recordOps: true })` (default) → ingest\_\* metrics after each batch commit or storage failure.
- `runDailyCountAggregate()` → updates `dirty_backlog` and `aggregate_lag_seconds`.
- `runPurposeRetention()` → increments `retention_run` on successful completion.

## Browser queue discards

The browser client does not connect to PostgreSQL. In production, forward discards to your backend and call:

```typescript
import { recordQueueDiscardOps } from "@kamod-ch/tracking/postgres";

tracker.onDiscard(({ reason }) => {
  void recordQueueDiscardOps(pool, { tenantId, siteId }, reason);
});
```

Allowed `reject_reason` buckets for `queue_discard`: `queue-full`, `event-expired`, `consent-revoked`, `destroyed`, or `other`.

## Cardinality rules

Never use `event_id`, `session_id`, client IP, or raw JSON properties as counter labels. Only `reject_reason` and optional `schema_version` (integer) are stored.

## Example

See [examples/collector-postgres](../examples/collector-postgres/) — browser collect against real PG batch adapter and asserts `ingest_accepted`, `ingest_duplicate`, and `ingest_conflict`.
