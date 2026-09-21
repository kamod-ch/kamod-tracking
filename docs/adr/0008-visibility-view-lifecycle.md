# ADR 0008: Visibility measurement and explicit view lifecycle

## Status

Accepted.

## Context

Listing impressions must reflect **actual viewability**, not mount or SSR. SPAs need a shared lifecycle for list, modal detail, and flows without patching browser history APIs.

## Decision

- Ship a framework-independent `IntersectionObserver` helper with documented rule **`visible_area_50pct_1s_v1`** (≥50% for 1s, tab visible, continuous timer resets on interrupt or hidden tab).
- Without `IntersectionObserver`, emit **no** visibility impressions (conservative).
- Deduplicate **one subject per explicit view** via `beginView` / `endView`; remounts in the same view do not re-count.
- Browser reports a claimed rule version; collector authority stays on `measurement_rule_version` at accept time.

## Consequences

- Host apps must call `beginView` / `endView` on navigation and wire card elements through the visibility helper after client mount.
- Job promo cards must gate capture with `eligible` (or omit `listing_id` events entirely).
