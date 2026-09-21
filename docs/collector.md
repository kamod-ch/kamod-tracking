# Collector (browser and server)

Framework-independent `Request`/`Response` handlers live in `@kamod-ch/tracking/server`.

## Browser path

- Resolve site via public ingest key (`/v1/collect/:publicKey`) or legacy `appId` in the body when `requirePublicKey: false`.
- The public key is not a secret. `Origin` / `Referer` checks reduce misconfiguration only.
- Registry-backed events only (`schema_version` required). Defaults: max **20** events and **32 KiB** per batch.
- Server `CollectorContext` and capture policy apply; client-supplied tenant/site/trust fields are rejected.
- Authenticated user references are never read from browser payloads.

## Server path

- `createServerCollectHandler` with bearer token or custom verifier.
- Business / trusted events must not use the browser endpoint.
- Outbox records map to stable `eventIdFromOutboxId(outboxId)` for replay-safe writes.
- Optional `OutboxEventWriter` hook — the SDK does not execute business transactions.

## Batch response

```json
{ "ok": true, "outcomes": [{ "event_id": "…", "status": "accepted", "duplicate": false }] }
```

Storage failures return **503** with `Retry-After` and roll back the batch write. Rate limits return **429** with `Retry-After`.

## Hono

`mountBrowserCollectOnHono` / `mountServerCollectOnHono` accept a minimal Hono-like app (no hard dependency in the core package).

## Rate limiting

`createMemoryRateLimiter` is **process-local** only. IP values are used for ephemeral abuse protection and are not stored in analytics. Forwarded headers are honored only when `trustedProxy` peer configuration matches.
