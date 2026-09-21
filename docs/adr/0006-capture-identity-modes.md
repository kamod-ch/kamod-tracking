# ADR 0006: Capture identity modes

## Status

Accepted

## Context

Analytics SDKs often conflate consent UI, legal basis, and visitor stitching. We need explicit capture policy with bounded identity modes and no default network activity.

## Decision

- Default identity mode: `none`. Default network sending: off.
- Modes: `none`, `session`, `authenticated` (browser vs server responsibilities as documented).
- Consent bridge via `adoptExternalConsent`; no first-party banner or geo automation.
- Revocation clears queue, session keys, and aborts fetches; does not delete already transmitted data.
- Collector enforces `allowedBrowserIdentityModes` independently of browser consent signals.

## Consequences

- Legacy `visitorIdentity: "app-scoped"` maps to `session` with session storage instead of persistent visitor ids in payloads.
- Applications must call `configureCapture({ enableNetworkSending: true })` before events leave the browser.
