# Example: browser collector + PostgreSQL batch adapter

**Primary SQL integration demo** for `@kamod-ch/tracking`: `createBrowserCollectHandler` wired to `createScopedPostgresBatchAcceptance`, with **`tracking.ops_site_counters`** updated from real ingest outcomes.

This is **not** a production deployable — it shows how a consumer mounts the collector in server code. Browser bundles still import `@kamod-ch/tracking/browser` only.

## Prerequisites

Same database as `pnpm test:postgres`:

```sh
docker compose -f docker-compose.tracking-test.yml up -d
export TRACKING_TEST_DATABASE_URL='postgres://tracking:tracking@127.0.0.1:54329/tracking_test'
```

## Run

```sh
pnpm install   # repo root
pnpm build:core
pnpm --filter @kamod-tracking/example-collector-postgres test
```

Or as part of the full gate: `pnpm verify:all`.

## What it proves

1. Public-key browser collect path persists inbox + raw rows in one transaction.
2. Duplicate replay increments `ingest_duplicate`.
3. Payload conflict returns **409** and increments `ingest_conflict`.
4. Ops counters are updated automatically (`recordOps: true` default on PG batch acceptance).

## Related examples

| Path                                                 | Role                                               |
| ---------------------------------------------------- | -------------------------------------------------- |
| [vanilla-browser](../vanilla-browser/)               | Memory transport — no PostgreSQL                   |
| [server-outbox-postgres](../server-outbox-postgres/) | Trusted server outbox + application worker pattern |

See [examples/README.md](../README.md).
