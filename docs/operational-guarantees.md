# Operational guarantees (v0.1)

What `@kamod-ch/tracking` **does** and **does not** promise. Product SLAs (uptime, RPO/RTO) are defined in consuming apps, not this SDK.

## Transport (browser → collector)

| Topic            | Guarantee                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery         | **Best-effort** with bounded client retries (default 3). Successful HTTP **202** means the collector accepted the batch attempt; use per-event `outcomes` for storage truth.                       |
| Unload / beacon  | Events may be sent via `sendBeacon` on page hide; response bodies are **not** validated on that path (fire-and-forget).                                                                            |
| Idempotency      | Same `event_id` + same normalized payload → **duplicate** outcome, not a second fact row. Different payload → **payload-conflict** (409 on server outbox path; rejected outcome on browser batch). |
| Retry-After      | Collector may return **429** / **503** with `Retry-After`; client backs off and retries **queued** events only.                                                                                    |
| Forged authority | Browser payloads cannot set `tenant_id`, `site_id`, `producer`, `trust_class`, or account identifiers. Server path rejects `browser` producer claims.                                              |

## Consent and capture

| Topic        | Guarantee                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default      | Network sending **off** until `configureCapture({ enableNetworkSending: true })`.                                                                                                 |
| Purposes     | Event `collectionPurpose` comes from the **registry**; browser cannot override purpose strings.                                                                                   |
| Revocation   | Denying consent clears the unsent queue for that purpose, drops in-flight retry state, and clears session storage (no silent re-send after re-grant of queued pre-revoke events). |
| External CMP | Host apps drive consent via `adoptExternalConsent` / `setConsent`; the SDK does not ship a banner.                                                                                |

## Session identity

| Mode            | Guarantee                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `none`          | No `session_id` on envelopes; aggregates omit session counts when policy mode is `none`.                                    |
| `session`       | Ephemeral `session_id` in memory or safe storage — **not** a person identifier; no `localStorage` fallback for session ids. |
| `authenticated` | Pseudonymous account refs only from **server** context, never from browser JSON.                                            |

Session distinct counts in `daily_aggregates.session_count` are **not** unique visitors across days.

## Aggregation rebuild

| Topic            | Guarantee                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Atomicity        | One civil day + scope key recomputed in a single transaction (advisory lock).                                                          |
| Retention floor  | Days at or before `recompute_complete_from_received_at` are **skipped**; existing aggregate rows are **not** deleted when raw is gone. |
| Partial coverage | Days in `raw_coverage_gaps` or with incomplete candidate windows are skipped (`daysSkippedIncompleteCoverage`).                        |
| Dirty markers    | Successful rebuild clears a dirty marker only if `dirty_generation` unchanged; otherwise the day stays dirty.                          |
| Historical KPIs  | Raw purge + skipped rebuild **preserve** previously computed aggregates outside full raw coverage.                                     |

## Inbox / exactly-once language

Inbox dedup is reliable while `event_inbox` rows exist (configure `inbox_retention_days` ≥ **30**). After inbox TTL purge, retries are **best-effort** only — do not claim unlimited exactly-once delivery beyond the documented retry horizon.

## Logging

Collector JSON responses and debug logs use `sanitizeForLog` — no raw payloads, JWTs, emails, client IPs, or session ids in SDK log fields. Wire your own structured logging in the app layer; use [observability.md](./observability.md) for Postgres ops counters.
