# Kamod Tracking

First-party product analytics SDK (library only — not a hosted collector or dashboard).

## Consumer install (reproducible)

```sh
git clone <repo>
cd kamod-tracking
pnpm install          # pnpm 11.25.0 (see packageManager)
pnpm verify           # typecheck, lint, format, unit tests, examples (memory), build, exports, bundle, e2e smoke
```

**With PostgreSQL** (required for SQL integration release gate):

```sh
docker compose -f docker-compose.tracking-test.yml up -d
export TRACKING_TEST_DATABASE_URL='postgres://tracking:tracking@127.0.0.1:54329/tracking_test'
pnpm verify:all       # verify + pnpm test:postgres + collector-postgres example
```

CI runs the same split: job `quality` → `pnpm verify`; job `postgres` → `pnpm test:postgres` (see [docs/verify-matrix.md](docs/verify-matrix.md)).

## Package surface

| Import                        | Role                                     |
| ----------------------------- | ---------------------------------------- |
| `@kamod-ch/tracking`          | Event contract, registry, consent stores |
| `@kamod-ch/tracking/browser`  | Browser client (no Node / no `pg`)       |
| `@kamod-ch/tracking/preact`   | Optional Preact adapter                  |
| `@kamod-ch/tracking/server`   | Collectors (`Request` → `Response`)      |
| `@kamod-ch/tracking/postgres` | Optional PostgreSQL adapter (peer `pg`)  |

## Examples

| Tier                       | Path                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Memory demos               | [examples/vanilla-browser](examples/vanilla-browser/), [examples/server-outbox-postgres](examples/server-outbox-postgres/) |
| **PostgreSQL integration** | **[examples/collector-postgres](examples/collector-postgres/)** — browser collector + PG batch adapter + ops counters      |
| Product consumer           | Your app repo — mount handlers, run workers, own outbox tables                                                             |

Index: [examples/README.md](examples/README.md).

## Documentation

- [Getting started](docs/getting-started.md)
- [Operational guarantees](docs/operational-guarantees.md) — transport, consent, session, rebuild
- [Observability](docs/observability.md) — ops counters tied to outcomes
- [Migrations / rollback](docs/migrations.md)
- [Implementation status](docs/implementation-status.md)
- [Verify matrix](docs/verify-matrix.md)

## Local commands

```sh
pnpm typecheck
pnpm test              # unit (PostgreSQL tests excluded without env)
pnpm test:postgres     # requires TRACKING_TEST_DATABASE_URL
pnpm build
pnpm check:exports     # packed tarball + browser bundle guard
pnpm measure:bundle
```
