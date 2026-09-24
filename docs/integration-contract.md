# Integration contract for domain modules

`@kamod-ch/tracking` is the **measurement kernel**: envelopes, consent-aware capture policy, collectors, optional Postgres storage, and optional Preact bindings. Product features (Devjobs listings, employer studio, billing, ProLitteris) integrate through the contracts below — they do **not** live inside the core package.

## Responsibilities

| Layer                                | Owns                                                                                                                  | Does not own                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Core SDK**                         | Event schema, registry validation, browser/server collectors, deduping store adapters, aggregation jobs               | Business UI, hosting, CMP, legal interpretation         |
| **Domain module** (e.g. Devjobs)     | Event names, `subject` / properties for listings and apply flows, when to emit server events, employer-facing reports | Reimplementing dedup, envelope shape, or Postgres inbox |
| **Metering / ProLitteris / billing** | Usage contracts, invoices, third-party reporting                                                                      | Inside `@kamod-ch/tracking` v0.1                        |

## How a domain module integrates

1. **Register events** in a module-local registry (extend or compose `createEventRegistry()`). Example: [examples/devjobs/registry.ts](../examples/devjobs/registry.ts).
2. **Browser:** construct `createBrowserTracker` with that registry, wire consent from your privacy layer, enable capture only after grant, use visibility hooks or `beginView`/`endView` for listing impressions ([preact-integration.md](./preact-integration.md)).
3. **Collector:** deploy `@kamod-ch/tracking/server` handlers with a `SiteRegistry` row per public key; map `tenant_id` / `site_id` server-side — never from the browser payload.
4. **Trusted business facts:** emit via **server outbox** (`createServerCollectHandler`) with bearer auth — scope comes from auth, not the payload. Registry/producer/purpose/subject are validated before `OutboxEventWriter` or storage. Derive ids from your outbox primary key (`eventIdFromOutboxId`). Keep business transactions and application outbox tables in your service; workers deliver validated envelopes (see `examples/server-outbox-postgres/domain-outbox-worker.mjs`).
5. **Persistence:** optional `@kamod-ch/tracking/postgres` migrations + `createScopedPostgresEnvelopeStore`; run daily aggregate jobs from your worker/cron.
6. **Read models:** domain apps query `tracking.daily_aggregates` or project envelopes into their own tables — the SDK does not ship employer dashboards.

**Pixel / email-open GIF:** not part of v0.1 — no concrete consumer requirement in this repo ([pixel-adapter.md](./pixel-adapter.md)).

## Metering stays outside the core

- **Included:** counting events, session-scoped rollups, ops counters on the Postgres adapter, consent-gated capture.
- **Excluded:** subscription metering, Stripe usage records, ProLitteris levies, “certified” impression certificates, cross-publisher reconciliation.

If Devjobs needs billable job views, the **billing module** consumes aggregates or server-trusted events via its own APIs — not by extending the tracking package with payment logic.

## Versioning and compatibility

- Domain modules pin a **schema_version** per event and document breaking changes in their repo.
- Core semver applies to envelope and collector contracts; run `pnpm verify` and domain registry tests before upgrading.

## Reference implementations

| Example                       | Path                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Vanilla JS browser            | [examples/vanilla-browser](../examples/vanilla-browser/)                                                                        |
| Preact + consent + visibility | [examples/preact-consent-visibility](../examples/preact-consent-visibility/) + `packages/core/src/examples/preact-job-demo.tsx` |
| Server outbox + Postgres      | [examples/server-outbox-postgres](../examples/server-outbox-postgres/)                                                          |
| Devjobs event names           | [examples/devjobs](../examples/devjobs/)                                                                                        |

Production Devjobs wiring lives in the Devjobs app repository (`tracking-integration.md` there).
