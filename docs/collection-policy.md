# Collection policy and identity modes

The SDK starts with **network sending disabled**. The host application must explicitly configure the allowed identity mode and enable sending (`configureCapture` on the browser tracker).

## Browser decision vs collector policy

| Layer                                                                               | Role                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Browser collection decision** (`setConsent`, `adoptExternalConsent`, CMP mirrors) | Records **collection permission** for a purpose (`analytics`, `measurement`, …). A purpose-wide `granted` is **not** proof of a specific visitor, legal basis, or that server-side processing is permitted. |
| **Collector / site policy** (`CollectorContext`, event registry)                    | Binds each event definition to a **fixed `collectionPurpose`**, allowed identity modes, and site scope. Browser payloads **cannot override** the registry purpose.                                          |

Types: `BrowserCollectionDecision`, `CollectorCollectionPolicy` in `@kamod-ch/tracking` core capture-policy module.

Browser-reported consent (`setConsent`, `adoptExternalConsent`) records **collection permission only**. It is not a verified legal consent record. The collector configures allowed identity modes independently (`CollectorContext.allowedBrowserIdentityModes`, `browserIdentityMode`). Server-side business processes need a separate documented purpose rule; do not treat analytics consent as legal basis for unrelated processing.

## Identity modes

| Mode             | Browser behavior                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none` (default) | No visitor or session identifiers. `event_id` identifies the event only. In-memory view state may dedupe page impressions within the current JS context; it is not persisted for recognition.                                                                                                                                                                        |
| `session`        | Random site-scoped session id in tab **`sessionStorage` only** (never silent `localStorage`). If tab storage is unavailable or throws, the SDK falls back to **in-memory** session state for that tracker instance. Default limits: 30 minutes inactivity, 24 hours maximum age (configurable). Does not represent a person or a reliable cross-tab browser session. |
| `authenticated`  | No browser-emitted pseudonymous account reference. Trusted server events may attach internal pseudonymous refs from auth context.                                                                                                                                                                                                                                    |

There is no `identify()` API, no fingerprinting, no IP+UA hashing, and no cross-project keys.

## External consent

Use `adoptExternalConsent({ purposes: { analytics: "granted" } })` to mirror an existing CMP or privacy layer. This library does not ship a cookie banner or jurisdiction automation.

## Revocation

`revokeCapture(purpose)` or `setConsent(purpose, "denied")`:

1. Stops new collection for that purpose (consent check on ingest, including after async validation).
2. Clears the unsent outbound queue and retry timers.
3. Removes SDK session storage keys and in-memory view / visibility state where applicable.
4. Aborts in-flight fetch sends where possible.

Already delivered beacons or server-side rows are **not** recalled; erasure is a separate server process.
