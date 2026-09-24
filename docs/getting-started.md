# Getting started

Minimal path to a working first-party measurement pipeline with the **exported** APIs of `@kamod-ch/tracking` v0.1.

## Install and build

```sh
pnpm install
pnpm build
```

Consumers add the published package (or a packed tarball) and optional peers:

| Peer     | When                          |
| -------- | ----------------------------- |
| `preact` | `@kamod-ch/tracking/preact`   |
| `pg`     | `@kamod-ch/tracking/postgres` |

## Minimal server-side ingest (memory)

```ts
import {
  createMemoryConsentStore,
  createMemoryEventStore,
  createTrackingPipeline,
  recordConsent,
} from "@kamod-ch/tracking";

const consents = createMemoryConsentStore();
const pipeline = createTrackingPipeline({
  appId: "my-app",
  store: createMemoryEventStore(),
  consents,
});

recordConsent({
  store: consents,
  appId: "my-app",
  purpose: "analytics",
  state: "granted",
  recordedAt: new Date().toISOString(),
});

await pipeline.recordConversion({ appId: "my-app", name: "signup_verified" });
```

## Minimal browser client

Network sending is **off** until you call `configureCapture`. Consent must be **granted** per purpose before events leave the client.

```ts
import { createEventRegistry, registerContentViewEvents } from "@kamod-ch/tracking";
import { createBrowserTracker } from "@kamod-ch/tracking/browser";

const registry = createEventRegistry();
registerContentViewEvents(registry);

const tracker = createBrowserTracker({
  appId: "my-app",
  registry,
});

tracker.setConsent("analytics", "granted");
tracker.configureCapture({ identityMode: "none", enableNetworkSending: true });
await tracker.pageView({ path: "/home", content_type: "page" });
```

Runnable copy: [examples/vanilla-browser/demo.mjs](../examples/vanilla-browser/demo.mjs).

## Collector (HTTP)

Mount browser or server collectors from `@kamod-ch/tracking/server`. The **public site key** in the URL is an identifier, not a secret; it must still be paired with origin allow lists and rate limits on the server.

See [collector.md](./collector.md) and [examples/server-outbox-postgres](../examples/server-outbox-postgres/).

## Identity modes: `none`, `session`, `authenticated`

| Mode            | What the browser may emit                              | Typical use                                       |
| --------------- | ------------------------------------------------------ | ------------------------------------------------- |
| `none`          | No visitor id; optional in-tab view dedupe only        | Default; job impressions without pseudonymous ids |
| `session`       | Random site-scoped session id in tab storage           | Funnels within a tab/session; not a person count  |
| `authenticated` | No browser account ref; server may attach trusted refs | Logged-in flows via **server** outbox events      |

Details: [collection-policy.md](./collection-policy.md), ADR 0006.

**No person counts without an appropriate identity basis.** Session mode counts sessions, not people. Cross-tab or cross-device reach requires explicit product design outside this SDK’s defaults.

## Consent, revocation, storage, data minimization

- **Grant:** `setConsent("analytics", "granted")` and/or `adoptExternalConsent` after your CMP decision.
- **Revoke:** `setConsent("analytics", "denied")` or `revokeCapture("analytics")` — stops new capture, clears the outbound queue, clears SDK session keys, aborts in-flight fetches. Already accepted server rows are not deleted automatically.
- **Storage:** Session ids use host-chosen storage (e.g. `sessionStorage`). The SDK does not fingerprint.
- **Minimization:** Registry validators and sanitize helpers strip unknown/forbidden fields; collectors reject client-forged `tenant_id`, `producer`, etc.

## Event versioning and schema

- Each event has a `schema_version`; registry entries may define `readableUntil` for transitions.
- Producers must use names and versions registered for the app. See [event-registry.md](./event-registry.md).

## Retries, deduplication, `sendBeacon` limits

- **Browser:** At most three delivery attempts by default; permanent reject reasons do not retry. Unload may use `sendBeacon` — treated as best-effort; the server still dedupes on `event_id`.
- **Collector:** Duplicate `event_id` in a batch is accepted as duplicate; store remains idempotent.
- **Server outbox:** Stable `event_id` derived from `outboxId` — replay-safe. See `eventIdFromOutboxId` in `@kamod-ch/tracking/server`.
- **Postgres:** Inbox + scoped store enforce dedup and payload-hash conflict detection (ADR 0007).

Browser delivery is **not** a tamper-proof proof of usage. Untrusted browser events are labeled accordingly (`trust_class`).

## Retention, backfill, timezone

Configured per site in Postgres (`site_data_policy`): raw retention, aggregate retention, inbox retention, **late_event_backfill_days**. Daily aggregates use the site **IANA timezone** (e.g. `Europe/Zurich`) for `local_date`. See [aggregation.md](./aggregation.md).

## Trust and compliance expectations

- Public collector keys and browser payloads can be replayed or forged by motivated clients — design reports and billing around **server-trusted** events where needed.
- This SDK does **not** provide automatic official recognition (e.g. ProLitteris) of your own analytics numbers.
- Metering and rights-management products stay in **domain modules**; see [integration-contract.md](./integration-contract.md).

## Next steps

- [examples/README.md](../examples/README.md) — memory demos vs PostgreSQL collector example vs product wiring
- [operational-guarantees.md](./operational-guarantees.md) — transport, consent, session, rebuild semantics
- [observability.md](./observability.md) — Postgres ops counters tied to ingest/aggregation/retention outcomes
- [verify-matrix.md](./verify-matrix.md) — `pnpm verify` and `pnpm verify:all` (with Docker PostgreSQL)
- [preact-integration.md](./preact-integration.md) — provider, hooks, visibility job cards
- [postgres-adapter.md](./postgres-adapter.md) — migrations and scoped store
- [migrations.md](./migrations.md) — rollback notes
- [pixel-adapter.md](./pixel-adapter.md) — why v0.1 has no tracking pixel
- [implementation-status.md](./implementation-status.md) — what is in v0.1 vs open
- [devjobs-scope.md](./devjobs-scope.md) — Devjobs.ch integration boundaries
