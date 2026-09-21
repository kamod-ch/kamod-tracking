# Preact integration (`@kamod-ch/tracking/preact`)

Preact **10.x** is an optional peer (`>=10.0.0`). The core package does not depend on Preact.

## Who owns the client?

**Default:** your app creates `createBrowserTracker(...)` once (client-only bootstrap) and passes it to `<TrackingProvider client={...}>`. You call `client.destroy()` when the app shell unmounts.

**Alternative:** `useBrowserTrackingClient(options, { destroyOnUnmount: true })` creates the client after mount; the hook owns teardown. Use this when you do not want a global singleton, still without sharing state across SSR requests.

The provider **never** recreates the client when consent or `networkSendingEnabled` props change — it only syncs policy via `configureCapture` / `setConsent` / `revokeCapture`.

## SSR rules

- Do not keep one shared tracker on `globalThis` for all requests.
- Hooks run effects only after mount — **no events during `renderToString`**.
- Do not emit random ids into HTML; create the client after hydration (or pass a per-request client only on the client bundle).
- Initialise collectors and `configureCapture({ enableNetworkSending: true })` after consent is known.

## API

| Export                                                              | Purpose                                   |
| ------------------------------------------------------------------- | ----------------------------------------- |
| `TrackingProvider`                                                  | Context + shared visibility observer      |
| `useTrackingClient`                                                 | `BrowserClient`                           |
| `useCapture`                                                        | Stable `capture()` wrapper                |
| `usePageView(path)`                                                 | Page view after mount                     |
| `useViewSurface(surface)`                                           | `beginView` / `endView` for list vs modal |
| `useVisibleImpression(ref, { subjectKey, eligible, onImpression })` | Qualified listing impressions             |
| `useBrowserTrackingClient`                                          | Lazy client after mount                   |

Legacy alias: `useTracker` → `useTrackingClient`.

## Example

See `packages/core/src/examples/preact-job-demo.tsx` (fictional listings, memory transport). Run via Vitest in `packages/core/tests/preact.test.tsx`.

```tsx
// Monorepo source: packages/core/src/examples/preact-job-demo.tsx
import { DemoApp } from "../examples/preact-job-demo";
import { createBrowserTracker, createMemoryTransport } from "@kamod-ch/tracking/browser";

const client = createBrowserTracker({
  appId: "demo",
  transport: createMemoryTransport(),
  registry,
});

export function App() {
  return (
    <DemoApp
      client={client}
      networkSendingEnabled={consent.analytics}
      analyticsConsent={consent.analytics ? "granted" : "denied"}
    />
  );
}
```

For visibility-based job impressions, open a surface (`useViewSurface`) and wire cards with `useVisibleImpression` + `eligible: () => listing.is_job`.

Pure JavaScript without Preact: [`docs/vanilla-browser-integration.md`](./vanilla-browser-integration.md).
