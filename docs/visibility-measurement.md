# Visibility measurement and view lifecycle

## Measurement rule (V1)

| Version                    | Rule                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `visible_area_50pct_1s_v1` | Target intersects the viewport at **≥ 50%** for **1 uninterrupted second** while `document.visibilityState !== "hidden"`. |

The browser sends a **claimed** rule version on qualified impressions. That is not proof of viewability. The collector assigns the site’s authoritative `measurement_rule_version` when accepting events.

Configure the tracker/collector with the same rule id (e.g. `measurementRuleVersion: "visible_area_50pct_1s_v1"`) for visibility-based listing impressions.

If `IntersectionObserver` is unavailable, the SDK **does not** infer visibility (no “all rendered cards count” fallback).

## View lifecycle (explicit, no history patches)

SPAs must open and close views explicitly:

- **`beginView({ surface })`** — e.g. `job-list`, `job-detail-modal`, `apply-flow`. Starts a new in-memory dedupe scope.
- **`endView()`** — closes the surface when leaving or unmounting a route shell.

Within one view, each **subject key** (e.g. `listing_id`) may produce **at most one** qualified impression. Remounting the same card in the same view does not count again. A new navigation (`beginView` again) or intentional refresh may start a new view and allow another impression.

In identity mode **`none`**, view lifecycle state stays in memory only and is not persisted for recognition.

## Integration pattern

```typescript
import {
  createBrowserTracker,
  createVisibilityImpressionObserver,
  createDefaultIntersectionObserverFactory,
  VISIBILITY_MEASUREMENT_RULE_V1,
} from "@kamod-ch/tracking/browser";

const tracker = createBrowserTracker({ appId, registry /* … */ });
tracker.beginView({ surface: "job-list" });

const visibility = createVisibilityImpressionObserver({
  lifecycle: tracker.getViewLifecycle(),
  createIntersectionObserver: createDefaultIntersectionObserverFactory(),
  onImpression: ({ subjectKey }) => {
    if (!listingId) return; // promo / non-job cards
    void tracker.capture({
      event_name: "devjobs.listing.view",
      schema_version: 1,
      properties: { path, listing_id: subjectKey, canton },
    });
  },
});

const handle = visibility.observe(cardElement, {
  subjectKey: listingId,
  eligible: () => Boolean(listingId),
});

// on unmount: handle.disconnect(); tracker.endView();
```

Do **not** record listing impressions on render, prefetch, or SSR-only markup. Use the visibility helper after mount in the browser.

List and modal/detail flows should use **separate** `surface` values and call `beginView` when switching context.
