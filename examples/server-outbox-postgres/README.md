# Example: server outbox event + PostgreSQL adapter

## In-memory outbox (always runnable)

```sh
pnpm build:core
pnpm --filter @kamod-tracking/example-server-outbox-postgres test
```

`outbox-demo.mjs` posts the same `outboxId` twice to `createServerCollectHandler`; the envelope store keeps **one** row (`eventIdFromOutboxId`).

## PostgreSQL adapter

Optional peer `pg`. Import `@kamod-ch/tracking/postgres` only in server/worker code.

```sh
export TRACKING_TEST_DATABASE_URL='postgres://...'
pnpm --filter @kamod-ch/tracking test:postgres
pnpm --filter @kamod-ch/tracking exec vitest run tests/postgres-aggregation.integration.test.ts
```

Migrations live in `packages/core/migrations/`. See [docs/postgres-adapter.md](../../docs/postgres-adapter.md) and [docs/aggregation.md](../../docs/aggregation.md).
