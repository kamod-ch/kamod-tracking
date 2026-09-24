# Example: vanilla JavaScript (memory demo — no PostgreSQL)

Demonstrates consent-gated capture with `@kamod-ch/tracking/browser` and an **in-memory** collector transport. For the browser collector with a **real PostgreSQL batch adapter**, see [collector-postgres](../collector-postgres/README.md).

```sh
pnpm install   # from repo root
pnpm build:core
pnpm --filter @kamod-tracking/example-vanilla-browser test
```

See [docs/getting-started.md](../../docs/getting-started.md) and [docs/vanilla-browser-integration.md](../../docs/vanilla-browser-integration.md).
