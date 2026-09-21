# Vanilla browser integration (CMS / publisher)

No Preact required. Import `@kamod-ch/tracking/browser` only in the client bundle.

```javascript
import {
  createBrowserTracker,
  createCollectorTransport,
  createVisibilityImpressionObserver,
  createDefaultIntersectionObserverFactory,
  VISIBILITY_MEASUREMENT_RULE_V1,
} from "@kamod-ch/tracking/browser";

const tracker = createBrowserTracker({
  appId: "site_devjobs",
  registry,
  endpoint: "https://collect.example",
  publicKey: "pk_demo",
});

// After CMP grant:
tracker.setConsent("analytics", "granted");
tracker.configureCapture({ enableNetworkSending: true });

tracker.beginView({ surface: "job-list" });

const visibility = createVisibilityImpressionObserver({
  lifecycle: tracker.getViewLifecycle(),
  createIntersectionObserver: createDefaultIntersectionObserverFactory(),
});

document.querySelectorAll("[data-job-card]").forEach((element) => {
  const listingId = element.getAttribute("data-listing-id");
  if (!listingId) return;
  visibility.observe(element, {
    subjectKey: listingId,
    eligible: () => element.getAttribute("data-is-job") === "true",
    onImpression: () => {
      void tracker.capture({
        event_name: "devjobs.listing.view",
        schema_version: 1,
        properties: {
          path: location.pathname,
          listing_id: listingId,
          canton: element.getAttribute("data-canton") ?? "",
        },
      });
    },
  });
});

// On SPA navigation away:
tracker.endView();
visibility.disconnectAll();
```

Configure the collector with `measurementRuleVersion: VISIBILITY_MEASUREMENT_RULE_V1.version` so accepted events carry the authoritative rule id.

Do not call `capture` on SSR output or on mere DOM insert — use the visibility helper after mount.
