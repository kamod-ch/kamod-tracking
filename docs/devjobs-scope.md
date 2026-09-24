# Devjobs.ch — usable in v0.1 vs outside the tracking package

## Usable now with `@kamod-ch/tracking` v0.1

- **Event registry pattern** for job listings (impression, detail view, apply click, outbound) aligned with collector validation.
- **Browser measurement** with explicit analytics consent, configurable identity mode (`none` / `session`), and visibility-based listing impressions via Preact hooks or vanilla lifecycle APIs.
- **Public collector endpoint** with site key, origin allow list, rate limits, and batch ingest.
- **Server outbox** for trusted events (e.g. business conversions) with idempotent `event_id` from outbox ids.
- **PostgreSQL** path: migrations, deduping inbox, `daily_aggregates` for employer-facing ratios when the app runs aggregate jobs and exposes its own APIs/UI.
- **In-memory / test** pipelines for unit and integration tests without a database.

Devjobs app integration (concrete routes, UI, env vars) is documented in the Devjobs repository under `docs/tracking-integration.md`.

## Still outside this SDK version (product / other repos)

| Capability                                              | Why outside                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **ProLitteris / levies / official publisher reporting** | Legal and product workflow, not envelope ingest                                |
| **Metering and plan enforcement**                       | Billing domain; may _read_ aggregates but does not belong in the tracking core |
| **Hosted analytics dashboard**                          | Devjobs employer studio and ops views are app code                             |
| **Cookie banner / jurisdiction automation**             | Host CMP; SDK mirrors consent only                                             |
| **Person-level unique reach**                           | Not provided without explicit authenticated/server identity design             |
| **Self-certifying analytics as legally binding**        | SDK explicitly treats browser events as untrusted for proof purposes           |
| **Email / notification open pixel (1×1 GIF)**           | No concrete Devjobs or core requirement in v0.1 — see [pixel-adapter.md](./pixel-adapter.md) / ADR 0010 |
| **Automatic data erasure across Postgres + CDN**        | Erasure jobs and policies are operational product concerns                     |

## Recommended split for Devjobs

1. **Tracking repo** — keep generic; Devjobs-specific event definitions stay in `examples/devjobs` or the Devjobs app registry.
2. **Devjobs app** — mounts collectors, sets `DATABASE_URL`, runs aggregation cron, serves `/api/analytics/*` to employers.
3. **Future billing / ProLitteris** — separate modules that consume `daily_aggregates` or audited server events; do not fork the SDK.
