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
- PostgreSQL adapter: migrations, scoped accept + dedup inbox (ADR 0007), daily aggregates, retention, raw watermark, ops counters ([postgres-adapter.md](./postgres-adapter.md), [aggregation.md](./aggregation.md), ADR 0009). Integration tests when `TRACKING_TEST_DATABASE_URL` is set.
- Packed tarball consumer check: `pnpm check:exports`.
- Documented runnable examples under [examples/](../examples/) (vanilla browser, server outbox, devjobs registry). Preact consent + visibility: core tests + demo source (see [examples/preact-consent-visibility](../examples/preact-consent-visibility/README.md)).

## Open / out of scope for this repository

- **Metering, billing, ProLitteris, and official usage certification** — integrate in product repos; not part of `@kamod-ch/tracking` core. See [integration-contract.md](./integration-contract.md) and [devjobs-scope.md](./devjobs-scope.md).
- **Hosted collector, dashboard, or operator UI** — SDK only (ADR 0004).
- **Cookie banner / CMP** — host app or separate privacy layer; SDK mirrors consent via `adoptExternalConsent` / `setConsent`.
- **Otok-specific collector plugin** — use Hono mounts or raw handlers until wired in an Otok app repo.
- **Person-level audience counts without identity basis** — not supported by design; see [getting-started.md](./getting-started.md).

## Integration boundaries

See [package-boundaries.md](./package-boundaries.md). Audit stays in `@kamod-ch/otok-audit` when that module is present.
