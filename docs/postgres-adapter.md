# PostgreSQL adapter

Subpath: `@kamod-ch/tracking/postgres` (peer dependency: `pg`).

## Quick start (local test database)

```bash
cd kamod-tracking
docker compose -f docker-compose.tracking-test.yml up -d
export TRACKING_TEST_DATABASE_URL=postgres://tracking:tracking@127.0.0.1:54329/tracking_test
pnpm --filter @kamod-ch/tracking test:postgres
```

Apply migrations manually:

```bash
psql "$TRACKING_TEST_DATABASE_URL" -f packages/core/migrations/001_tracking_schema.sql
psql "$TRACKING_TEST_DATABASE_URL" -f packages/core/migrations/002_tracking_roles.sql
```

Or from Node:

```typescript
import { applyTrackingMigrations } from "@kamod-ch/tracking/postgres";
await applyTrackingMigrations(pool);
```

Migrations run through **`006_ops_outcome_metrics.sql`**. Rollback policy: [migrations.md](./migrations.md). Primary integration example: [examples/collector-postgres](../examples/collector-postgres/README.md). Observability: [observability.md](./observability.md).

## Scope safety

Construct a store with an explicit tenant and site. Queries always filter on both; passing a foreign site id returns `unknown-site`.

## Accept semantics

`acceptEnvelope(event)` runs inbox + event insert in one transaction.

## Batch collector storage

For browser/server collectors, bind a scoped batch adapter to the site registry scope (no `list()` scans):

```typescript
import {
  createPostgresBatchAcceptanceForScope,
  createPostgresBatchAcceptanceResolver,
} from "@kamod-ch/tracking/postgres";

const acceptBatch = createPostgresBatchAcceptanceForScope(pool, {
  tenantId: site.tenantId,
  siteId: site.siteId,
});

// or cache per scope:
const resolveBatch = createPostgresBatchAcceptanceResolver({ pool });
const batchAcceptance = resolveBatch({ tenantId: site.tenantId, siteId: site.siteId });
```

One transaction writes inbox + raw rows for all accepted events in the batch. Business rejects (`payload-conflict`, scope mismatch) are per-event outcomes; infrastructure errors roll back the whole batch attempt. Dedup hashes exclude `received_at` (see `dedupContentFromEnvelope`).

| Case                             | Result                     |
| -------------------------------- | -------------------------- |
| New event id                     | Stored, `duplicate: false` |
| Same id, same normalized payload | `duplicate: true` (retry)  |
| Same id, different payload       | `payload-conflict`         |
| Unknown tenant/site              | `unknown-site`             |

Parallel identical inserts produce one stored row.

## Dedup window

Inbox rows carry `purpose` (migration **005**) so retention can purge by purpose without joining `tracking.events`. Configure `inbox_retention_days` ≥ **30** (`validateSiteRetentionPolicy` / `MIN_INBOX_RETENTION_DAYS`). After that horizon, duplicate detection is best-effort only — do not claim unlimited exactly-once delivery for older client retries.
