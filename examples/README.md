# Examples

Runnable demos for **local learning** (memory) vs **integration verification** (PostgreSQL) vs **product wiring** (your app repo).

| Example                                                   | Purpose                                                      | Requires PostgreSQL |
| --------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| [vanilla-browser](./vanilla-browser/)                     | Memory transport + consent queue (**no DB**)                 | No                  |
| [preact-consent-visibility](./preact-consent-visibility/) | Preact export / SSR smoke                                    | No                  |
| [devjobs](./devjobs/)                                     | Domain registry on neutral core                              | No                  |
| [server-outbox-postgres](./server-outbox-postgres/)       | Trusted server outbox + domain worker (memory store)         | No                  |
| **[collector-postgres](./collector-postgres/)**           | **Browser collector + real PG batch adapter + ops counters** | **Yes**             |

## Quick start (memory only)

```sh
pnpm install
pnpm build:core
pnpm test:examples
```

## Full consumer install (with SQL)

Documented in [docs/postgres-adapter.md](../docs/postgres-adapter.md) and [docs/verify-matrix.md](../docs/verify-matrix.md):

```sh
docker compose -f docker-compose.tracking-test.yml up -d
export TRACKING_TEST_DATABASE_URL='postgres://tracking:tracking@127.0.0.1:54329/tracking_test'
pnpm verify:all
```

Production apps import `@kamod-ch/tracking/postgres` only in server/worker code; browser bundles use `@kamod-ch/tracking/browser` (see [package-boundaries.md](../docs/package-boundaries.md)).
