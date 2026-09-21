# Verification matrix (v0.1.0)

Recorded on **2026-09-21** after `pnpm verify` in `kamod-tracking` (exit code 0).

## Toolchain

| Component | Version |
| --------- | ------- |
| Node.js   | v24.18.0 |
| pnpm      | 11.25.0 (`packageManager` in root `package.json`) |
| TypeScript | 5.9.3 |
| Vitest    | 3.2.7 |
| Oxlint    | ^1.69.0 (warnings only, no errors) |
| Oxfmt     | ^0.54.0 |
| Package   | `@kamod-ch/tracking` 0.1.0 |

Engine requirement: Node `>=20` (`packages/core/package.json`).

## Commands

| Step | Command | Result |
| ---- | ------- | ------ |
| Typecheck | `pnpm typecheck` | pass |
| Lint | `pnpm lint` | pass (oxlint warnings) |
| Format | `pnpm format:check` | pass |
| Unit/integration tests | `pnpm test` | **92** tests, **23** files, pass |
| Examples | `pnpm test:examples` | devjobs registry, vanilla browser, server outbox, preact export smoke — pass |
| Build | `pnpm build` | tsup ESM + DTS, pass |
| Packed consumer | `pnpm check:exports` | tarball import of `.`, `./browser`, `./server`, `./postgres`; browser bundle guard — pass |
| Bundle size | `pnpm measure:bundle` | see below |
| E2E smoke | `pnpm e2e:smoke` | memory flows + Preact SSR/visibility tests — pass |

Full gate: `pnpm verify`.

## Bundle sizes (`pnpm measure:bundle`)

Minified ESM in `packages/core/dist` (gzip via Node `zlib.gzipSync`):

| Entry | Raw bytes | Gzip bytes |
| ----- | --------- | ---------- |
| `index.js` | 31 063 | 6 926 |
| `browser.js` | 59 981 | 12 731 |
| `preact.js` | 61 986 | 13 470 |
| `server.js` | 39 521 | 8 843 |
| `postgres.js` | 23 908 | 5 812 |

Reproduce: `pnpm measure:bundle` (runs `build:core` first).

## E2E smoke coverage (`pnpm e2e:smoke`)

| Flow | Mechanism |
| ---- | --------- |
| Consent → send → revoke stops browser | `examples/vanilla-browser/demo.mjs` |
| Server outbox replay dedup | `examples/server-outbox-postgres/outbox-demo.mjs` |
| Collector duplicate `event_id` | inline in `scripts/e2e-smoke.mjs` |
| SSR-safe `@kamod-ch/tracking/browser` import | inline in `scripts/e2e-smoke.mjs` |
| Preact consent gate + visibility job card | `vitest run tests/browser-ssr.test.ts tests/preact.test.tsx` |
| PostgreSQL ingest → daily aggregate | **skipped** unless `TRACKING_TEST_DATABASE_URL` is set; then runs `tests/postgres.integration.test.ts` and `tests/postgres-aggregation.integration.test.ts` |

## Optional PostgreSQL verification

```sh
export TRACKING_TEST_DATABASE_URL='postgres://...'
pnpm test:postgres
pnpm --filter @kamod-ch/tracking exec vitest run tests/postgres-aggregation.integration.test.ts
pnpm e2e:smoke   # includes PG integration when env is set
```

## Peer dependencies (declared)

| Peer | Range |
| ---- | ----- |
| `preact` | `>=10.0.0` (optional) |
| `pg` | `>=8.11.0` (optional) |
