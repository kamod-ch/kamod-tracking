# Release notes — v0.1.0 (draft, not published)

**Package:** `@kamod-ch/tracking`  
**Status:** Internal verification complete; **do not publish or deploy** from this draft without explicit release approval.

## Highlights

- Consent-aware first-party analytics SDK with separated subpath exports (core, browser, preact, server, postgres).
- SSR-safe browser client; optional Preact adapter with visibility-based listing impressions.
- HTTP collectors for browser batches and trusted server outbox events; Hono mount helpers.
- Optional PostgreSQL adapter with deduping inbox, migrations, daily aggregates, retention, and ops counters.
- Documented examples and integration contract for domain apps (e.g. Devjobs).

## Breaking / stability

- Initial public API for Kamod consumers; semver applies from first publish.
- Event schemas are registry-defined; domain modules own event names and versions.

## Upgrade / install

```sh
pnpm add @kamod-ch/tracking
# optional:
pnpm add preact   # for @kamod-ch/tracking/preact
pnpm add pg       # for @kamod-ch/tracking/postgres
```

## Verification

See [verify-matrix.md](./verify-matrix.md) for commands, toolchain versions, bundle sizes, and E2E smoke results.

## Known limitations

- Browser events are untrusted; not suitable as sole billing or ProLitteris evidence.
- No hosted collector, dashboard, CMP, or metering in this package.
- Person-level reach requires explicit authenticated/server design — not default.

## Documentation entry points

- [getting-started.md](./getting-started.md)
- [implementation-status.md](./implementation-status.md)
- [devjobs-scope.md](./devjobs-scope.md)
