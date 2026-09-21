# Kamod Tracking

First-party product analytics SDK. This repository is a library, not a hosted service.

```ts
import {
  createMemoryConsentStore,
  createMemoryEventStore,
  createTrackingPipeline,
  recordConsent,
} from "@kamod-ch/tracking";
import { createBrowserTracker } from "@kamod-ch/tracking/browser";
import { createIngestHandler } from "@kamod-ch/tracking/server";

const consents = createMemoryConsentStore();
const pipeline = createTrackingPipeline({
  appId: "docs",
  store: createMemoryEventStore(),
  consents,
});

recordConsent({
  store: consents,
  appId: "docs",
  purpose: "analytics",
  state: "granted",
  recordedAt: new Date().toISOString(),
});

await pipeline.recordConversion({ appId: "docs", name: "signup_verified" });

const tracker = createBrowserTracker({ appId: "docs" });
tracker.setConsent("analytics", "granted");
await tracker.pageView({ path: "/docs" });

const collector = createIngestHandler(pipeline);
```

## Package surface

| Import                        | Status                                  |
| ----------------------------- | --------------------------------------- |
| `@kamod-ch/tracking`          | Event contract and config               |
| `@kamod-ch/tracking/browser`  | Browser client                          |
| `@kamod-ch/tracking/preact`   | Optional Preact adapter                 |
| `@kamod-ch/tracking/server`   | Collector (`Request` → `Response`)      |
| `@kamod-ch/tracking/postgres` | Optional PostgreSQL adapter (peer `pg`) |

See [docs/getting-started.md](docs/getting-started.md), [docs/package-boundaries.md](docs/package-boundaries.md), and [docs/adr](docs/adr).

## Local development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm check:exports
pnpm measure:bundle
pnpm e2e:smoke
# or
pnpm verify
```

Examples: [examples/](examples/). Documentation: [docs/getting-started.md](docs/getting-started.md), [docs/verify-matrix.md](docs/verify-matrix.md).

The folder started empty. **pnpm** (`packageManager` in the root `package.json`) is the package manager.
