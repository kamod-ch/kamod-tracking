# kamod-tracking — agent notes

- **Package manager:** pnpm **11.25.0** (`packageManager` in root `package.json`; CI pins the same via `PNPM_VERSION`).
- **Package:** `@kamod-ch/tracking`. Public surface is the `exports` map only: `.`, `./browser`, `./preact`, `./server`, `./postgres` (optional peer `pg`).
- **Root** is the event contract and config. It must import without DOM or Preact.
- **Preact** is an optional peer of `./preact` only. **PostgreSQL** is an optional peer of `./postgres` only (`pg`), not a root dependency.
- **Browser builds** must not contain Node-only modules, collector code, or secrets.
- **Audit** events are rejected here; use `@kamod-ch/otok-audit` in Otok apps.
- **Quality:** CI job `quality` runs `pnpm verify` (typecheck, oxlint, oxfmt-check, unit tests, memory examples, build, `check:exports`, bundle measure, e2e smoke). CI job `postgres` runs `pnpm test:postgres` — **must not** skip when URL is missing (`require-postgres-test-env.mjs`). Local SQL release gate: `pnpm verify:all` (verify + postgres tests + [examples/collector-postgres](examples/collector-postgres/)).
- **Observability:** PostgreSQL batch acceptance records ingest ops counters by default; see [docs/observability.md](docs/observability.md). Do not log raw payloads, IPs, or session ids.
- **Examples:** Memory vs PG vs product consumer — [examples/README.md](examples/README.md). Primary SQL path: `collector-postgres`.
- Do not add empty dashboard/hosting projects. Do not publish from this workspace.
