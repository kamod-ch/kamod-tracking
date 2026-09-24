# Implementation status

Last reviewed against `packages/core` and `pnpm verify` (see [verify-matrix.md](./verify-matrix.md)).

## Implemented (v0.1)

- Typed event envelope (`event_id`, `schema_version`, `event_name`, `occurred_at`, business `subject`, registry-validated `properties`, optional `session`).
- Server-enriched fields from collector config (`tenant_id`, `site_id`, `received_at`, `producer`, `trust_class`, rule/policy versions).
- Runtime registry with field validators, producer allow-list, payload size limits, privacy class metadata, and `readableUntil` for schema transitions.
- Neutral core example `content.view` (v1/v2). Domain example: [examples/devjobs](../examples/devjobs/registry.ts).
- Serialization round-trip for stored envelopes. Unknown property keys rejected; forbidden producer authority fields rejected.
- Public `exports`: `.`, `./browser`, `./preact`, `./server`, `./postgres` (optional peer `pg`). Root import has no Preact runtime and no database driver.
- Capture policy: default identity mode `none`, network sending off until `configureCapture`. Modes `none` | `session` | `authenticated`. External consent via `adoptExternalConsent`. Revocation clears queue, session storage, and aborts fetches. See [collection-policy.md](./collection-policy.md) and ADR 0006.
- Memory store idempotent on `event_id`. Browser sends best-effort with bounded retries (default 3).
- Browser client: queue, collector batch transport, backoff / `Retry-After`, `capture` / `flush` / `destroy`, unload beacon path (delivery not verified). See [vanilla-browser-integration.md](./vanilla-browser-integration.md).
- Visibility: rule `visible_area_50pct_1s_v1`, observer + explicit `beginView` / `endView`. See [visibility-measurement.md](./visibility-measurement.md), ADR 0008.
- Preact adapter (`./preact`): `TrackingProvider`, hooks, job-list demo (`packages/core/src/examples/preact-job-demo.tsx`, [preact-integration.md](./preact-integration.md)).
- Server collectors: browser batch + trusted server outbox path, site registry, limits, rate limit, Hono mount helpers ([collector.md](./collector.md)). Fetch `Request` / `Response`, not a hosted product.
- PostgreSQL adapter: migrations through **006** (ops outcome metrics), scoped accept + dedup inbox (ADR 0007), daily aggregates, batched retention, **outcome-linked ops counters** ([observability.md](./observability.md), [postgres-adapter.md](./postgres-adapter.md), [aggregation.md](./aggregation.md), [migrations.md](./migrations.md), ADR 0009). **CI** job `postgres` runs `pnpm test:postgres` (five integration suites; fails if `TRACKING_TEST_DATABASE_URL` unset). Release gate: `pnpm verify:all` adds SQL example [examples/collector-postgres](../examples/collector-postgres/). Local: Docker compose + env URL in [verify-matrix.md](./verify-matrix.md).
- Operational guarantees documented: [operational-guarantees.md](./operational-guarantees.md) (transport, consent, session, rebuild).
- Documented runnable examples: [examples/README.md](../examples/README.md) — memory demos vs **collector-postgres** (PG batch adapter) vs product-owned outbox/workers.

## Open / out of scope for this repository

- **Tracking pixel / mail-open GIF adapter** — not implemented; no documented consumer requirement ([pixel-adapter.md](./pixel-adapter.md), ADR 0010).
- **Metering, billing, ProLitteris, and official usage certification** — integrate in product repos; not part of `@kamod-ch/tracking` core. See [integration-contract.md](./integration-contract.md) and [devjobs-scope.md](./devjobs-scope.md).
- **Hosted collector, dashboard, or operator UI** — SDK only (ADR 0004).
- **Cookie banner / CMP** — host app or separate privacy layer; SDK mirrors consent via `adoptExternalConsent` / `setConsent`.
- **Otok-specific collector plugin** — use Hono mounts or raw handlers until wired in an Otok app repo.
- **Person-level audience counts without identity basis** — not supported by design; see [getting-started.md](./getting-started.md).

## Integration boundaries

See [package-boundaries.md](./package-boundaries.md). Audit stays in `@kamod-ch/otok-audit` when that module is present.
