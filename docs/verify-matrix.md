# Verification matrix (v0.1.0)

Recorded after local `pnpm verify` and `pnpm verify:all` with Docker PostgreSQL.

## Toolchain

| Component  | Version                                            |
| ---------- | -------------------------------------------------- |
| Node.js    | `>=20` (package engine); CI uses **22**            |
| pnpm       | **11.25.0** (`packageManager` + CI `PNPM_VERSION`) |
| TypeScript | 5.9.x (lockfile-resolved)                          |
| Vitest     | 3.2.x                                              |
| Oxlint     | ^1.69.0 (warnings only, no errors)                 |
| Oxfmt      | ^0.54.0                                            |
| Package    | `@kamod-ch/tracking` 0.1.0                         |

### Node test matrix

| Context                          | Node   | PostgreSQL        |
| -------------------------------- | ------ | ----------------- |
| CI `quality`                     | 22     | excluded          |
| CI `postgres`                    | 22     | service container |
| Local unit (`pnpm test`)         | 20–24+ | excluded          |
| Local SQL (`pnpm test:postgres`) | 20–24+ | **required**      |
| Release gate (`pnpm verify:all`) | 20–24+ | **required**      |

Public exports (packed tarball): `.`, `./browser`, `./preact`, `./server`, `./postgres`.

## CI jobs (`.github/workflows/ci.yml`)

| Job        | Command / scope                                                                 |
| ---------- | ------------------------------------------------------------------------------- |
| `quality`  | `pnpm verify` — no PostgreSQL                                                   |
| `postgres` | `TRACKING_TEST_DATABASE_URL` → `pnpm test:postgres` (all SQL integration files) |

The `postgres` job **must not** succeed when the database URL is missing or tests are skipped; `scripts/require-postgres-test-env.mjs` exits non-zero.

PostgreSQL integration files (`vitest.postgres.config.ts`):

- `postgres.integration.test.ts`
- `postgres-batch.integration.test.ts`
- `postgres-aggregation.integration.test.ts`
- `postgres-aggregation-bucket.integration.test.ts`
- `postgres-retention.integration.test.ts`

## Commands (local)

| Step                | Command                                | PostgreSQL                        |
| ------------------- | -------------------------------------- | --------------------------------- |
| Typecheck           | `pnpm typecheck`                       | no                                |
| Lint                | `pnpm lint`                            | no                                |
| Format              | `pnpm format:check`                    | no                                |
| Unit tests          | `pnpm test`                            | excluded                          |
| Memory examples     | `pnpm test:examples`                   | no                                |
| Build               | `pnpm build`                           | no                                |
| Packed consumer     | `pnpm check:exports`                   | no                                |
| Bundle size         | `pnpm measure:bundle`                  | no                                |
| E2E smoke           | `pnpm e2e:smoke`                       | optional URL runs `test:postgres` |
| SQL integration     | `pnpm test:postgres`                   | **required**                      |
| SQL example         | `examples/collector-postgres/demo.mjs` | **required** for `verify:all`     |
| Full gate (no DB)   | `pnpm verify`                          | no                                |
| Full gate (with DB) | `pnpm verify:all`                      | **required**                      |

## Bundle sizes (`pnpm measure:bundle`)

Minified ESM in `packages/core/dist` (gzip via Node `zlib.gzipSync`). Reproduce: `pnpm measure:bundle` (runs `build:core` first).

| Entry         | Typical gzip (see script output) |
| ------------- | -------------------------------- |
| `index.js`    | ~7 KiB                           |
| `browser.js`  | ~13 KiB                          |
| `preact.js`   | ~13 KiB                          |
| `server.js`   | ~9 KiB                           |
| `postgres.js` | ~6 KiB                           |

`pnpm check:exports` validates packed tarball imports and **browser bundle guard** (no `pg` / Node builtins in `./browser`).

SSR: `tests/browser-ssr.test.ts` + Preact tests in `pnpm e2e:smoke`.

## PostgreSQL verification

```sh
docker compose -f docker-compose.tracking-test.yml up -d
export TRACKING_TEST_DATABASE_URL='postgres://tracking:tracking@127.0.0.1:54329/tracking_test'
pnpm verify:all
```

Migrations applied in-test via `applyTrackingMigrations` through **`006_ops_outcome_metrics.sql`**. Rollback notes: [migrations.md](./migrations.md).

## Peer dependencies (declared)

| Peer     | Range                 |
| -------- | --------------------- |
| `preact` | `>=10.0.0` (optional) |
| `pg`     | `>=8.11.0` (optional) |
