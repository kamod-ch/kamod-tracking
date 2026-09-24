# ADR 0010: No pixel adapter in v0.1

## Status

Accepted — **no implementation** in `@kamod-ch/tracking` v0.1.

## Context

Prompt 10 asked for an optional pixel adapter only after the measurement kernel is stable, and only if a **concrete consumer** requires it. A pixel route is often proposed for:

- Email / notification “open” tracking (1×1 GIF)
- Legacy analytics compatibility
- Environments without JavaScript

Pixels interact badly with measurement integrity: CDN and mailbox caches, link prefetch, security scanners, ad blockers, bot traffic, and trivial replay of signed URLs. They are easily mistaken for **page impressions**, **unique people**, **job applications**, or **official compensation evidence** (e.g. publisher levies).

## Concrete consumer review

| Consumer | Stated measurement needs (this repo) | Pixel need |
| -------- | ------------------------------------ | ---------- |
| **Devjobs.ch** ([devjobs-scope.md](../devjobs-scope.md), [examples/devjobs](../../examples/devjobs/)) | Listing impressions via visibility + consent; apply/outbound clicks in browser; trusted facts via **server outbox**; employer metrics from aggregates | **None documented** — no newsletter open tracking, no mail-template pixel requirement in app or SDK docs |
| **Generic core** (`content.view`) | Browser + server collectors | No pixel path |

Production Devjobs wiring is described in the Devjobs app repo; nothing there is referenced from kamod-tracking as a blocking pixel use case. **ProLitteris / certified reporting** is explicitly out of scope for the SDK.

## Decision

**Do not ship a precautionary pixel adapter in v0.1.**

Integrators should use:

1. **Browser collector** — consent-gated, registry-validated events (`createBrowserCollectHandler`).
2. **Server outbox** — trusted business facts with auth-bound scope (`createServerCollectHandler`).
3. **App-owned mail analytics** — if email opens must be measured later, implement in the **product repo** with explicit legal review; do not treat a pixel as a substitute for visibility-based impressions or server-verified apply events.

## If a future consumer requires a pixel (criteria)

Implement **only** when a product documents a specific flow (e.g. “transactional mail open signal for employer campaign X”) and accepts limitations below. The adapter must be a **separate, bounded entry** — not an extension of the browser batch JSON API.

### Allowed shape (hypothetical)

- **Single registry event** e.g. `pixel.request` (schema_version fixed), `producer: pixel`, **not** reusing `content.view` or Devjobs impression events.
- **Query parameters:** only an opaque **`request token`** (or similar) mapped server-side to `{ tenant, site, campaign id, mail send id }` — **no** general property bag, **no** PII, **no** persistent visitor id in the URL by default.
- **Reuse:** same `SiteRegistry` / public key path segment, `prepareContractEnvelope` + registry validation, collector **rate limits**, Postgres batch acceptance (or scoped store), ops counters, consent rules for the event’s `collectionPurpose`.
- **Response:** transparent 1×1 GIF (or PNG) with `Cache-Control: no-store` (and related headers) — documented as **anti-cache hint only**, not proof of delivery to a human.
- **Stored envelope fields:** explicit low trust (e.g. `trust_class: untrusted`, measurement method / channel property such as `measurement_channel: pixel` in registry-defined properties only), so aggregates and downstream BI do not mix pixel hits with visibility impressions or server-trusted conversions.
- **Replay:** token single-use or short TTL + dedup on derived `event_id`; expect duplicate hits from scanners and prefetch.

### Prohibited claims (always)

Do **not** document or imply that pixel hits represent:

- Visible listing impressions (use visibility lifecycle).
- Unique humans or sessions (unless a separate, consented design exists — not via URL ids).
- Job applications or employer billing truth (use server outbox).
- Official ProLitteris / levy / “certified” usage proof.

### Operational expectations

Document in product ops: blockers drop requests; Apple Mail Privacy Protection and similar proxies distort opens; `no-store` does not stop all intermediaries from caching; bots inflate counts.

## Consequences

- Smaller attack surface and no mixed-trust ingest path in v0.1.
- Email/campaign teams must plan server-side token tables and privacy review in their repo before any future pixel ADR amendment.
- Revisit this ADR when Devjobs (or another named consumer) adds a written requirement with legal sign-off.
