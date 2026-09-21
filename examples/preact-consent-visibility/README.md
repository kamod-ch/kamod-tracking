# Example: Preact, explicit consent, job-card visibility

Preact is an **optional peer** (`>=10.0.0`). Import only `@kamod-ch/tracking/preact` in UI bundles.

## Source references

- Demo UI: `packages/core/src/examples/preact-job-demo.tsx`
- Automated coverage: `packages/core/tests/preact.test.tsx` (consent gate, `networkSendingEnabled`, visibility impression after 50% / 1s rule, SSR render without throwing)

## Run checks from repo root

```sh
pnpm build:core
pnpm --filter @kamod-ch/tracking exec vitest run tests/preact.test.tsx tests/browser-ssr.test.ts
```

## Integration sketch

1. Build `createBrowserTracker` with your domain registry and `initialCapture.sendingEnabled: false`.
2. Wrap the tree in `TrackingProvider` with `networkSendingEnabled={false}` until CMP grant.
3. After grant: `tracker.setConsent("analytics", "granted")`, `tracker.configureCapture({ sendingEnabled: true, identityMode: "none" })`, set provider `networkSendingEnabled={true}`.
4. Use `useVisibilityImpressionRef` (or manual `beginView` / observer) on job cards — see [docs/preact-integration.md](../../docs/preact-integration.md).

No Preact code runs in `@kamod-ch/tracking` root or `./browser` builds.
