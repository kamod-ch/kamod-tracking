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

## Scope safety

Construct a store with an explicit tenant and site. Queries always filter on both; passing a foreign site id returns `unknown-site`.

## Accept semantics

`acceptEnvelope(event)` runs inbox + event insert in one transaction.

| Case                             | Result                     |
| -------------------------------- | -------------------------- |
| New event id                     | Stored, `duplicate: false` |
| Same id, same normalized payload | `duplicate: true` (retry)  |
| Same id, different payload       | `payload-conflict`         |
| Unknown tenant/site              | `unknown-site`             |

Parallel identical inserts produce one stored row.

## Dedup window

V1 keeps inbox rows indefinitely. When adding TTL purge, use a retention period strictly greater than the supported retry window (see ADR 0007).
