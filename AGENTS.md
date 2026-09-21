# kamod-tracking — agent notes

- **Package manager:** pnpm (`packageManager` in root `package.json`). The repo started empty; pnpm matches sibling Kamod libraries.
- **Package:** `@kamod-ch/tracking`. Public surface is the `exports` map only: `.`, `./browser`, `./preact`, `./server`. Do not export `./postgres` until it exists.
- **Root** is the event contract and config. It must import without DOM or Preact.
- **Preact** is an optional peer of `./preact` only. **PostgreSQL** is not a dependency yet.
- **Browser builds** must not contain Node-only modules, collector code, or secrets.
- **Audit** events are rejected here; use `@kamod-ch/otok-audit` in Otok apps.
- **Quality:** `pnpm verify` runs typecheck, oxlint, oxfmt-check, tests, build, and the packed-export consumer.
- Do not add empty dashboard/hosting projects. Do not publish from this workspace.
