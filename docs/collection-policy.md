# Collection policy and identity modes

The SDK starts with **network sending disabled**. The host application must explicitly configure the allowed identity mode and enable sending (`configureCapture` on the browser tracker).

Browser-reported consent (`setConsent`, `adoptExternalConsent`) records **collection permission only**. It is not a verified legal consent record. The collector configures allowed identity modes independently (`CollectorContext.allowedBrowserIdentityModes`, `browserIdentityMode`). Server-side business processes need a separate documented purpose rule; do not treat analytics consent as legal basis for unrelated processing.

## Identity modes

| Mode             | Browser behavior                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none` (default) | No visitor or session identifiers. `event_id` identifies the event only. In-memory view state may dedupe page impressions within the current JS context; it is not persisted for recognition.                                 |
| `session`        | Random site-scoped session id in tab storage (`sessionStorage` recommended). Default limits: 30 minutes inactivity, 24 hours maximum age (configurable). Does not represent a person or a reliable cross-tab browser session. |
| `authenticated`  | No browser-emitted pseudonymous account reference. Trusted server events may attach internal pseudonymous refs from auth context.                                                                                             |

There is no `identify()` API, no fingerprinting, no IP+UA hashing, and no cross-project keys.

## External consent

Use `adoptExternalConsent({ purposes: { analytics: "granted" } })` to mirror an existing CMP or privacy layer. This library does not ship a cookie banner or jurisdiction automation.

## Revocation

`revokeCapture(purpose)` or `setConsent(purpose, "denied")`:

1. Stops new collection for that purpose (consent check on ingest).
2. Clears the unsent outbound queue.
3. Removes SDK session storage keys.
4. Aborts in-flight fetch sends where possible.

Already delivered beacons or server-side rows are **not** recalled; erasure is a separate server process.
