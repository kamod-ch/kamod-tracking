# Pixel / email-open tracking

## v0.1 decision: not implemented

After reviewing the **concrete consumers documented in this repository** (primarily **Devjobs.ch**: browser visibility impressions, apply/outbound events, server outbox for trusted facts), **no product requirement** mandates a 1×1 tracking pixel in `@kamod-ch/tracking` v0.1.

Therefore the SDK **does not** expose a pixel collector route, `pixel.request` event, or GIF endpoint. See [ADR 0010](./adr/0010-pixel-adapter-decision.md) for rationale, prohibited claims, and conditions under which a future bounded adapter could be added.

## What to use instead

| Need | Approach |
| ---- | -------- |
| Page / listing impressions | Browser client + visibility rules ([visibility-measurement.md](./visibility-measurement.md)) |
| Clicks / navigation | Registry events via browser collector |
| Verified apply / billing facts | Server outbox + bearer auth ([collector.md](./collector.md)) |
| Mail “opens” (future) | Design in **your app repo** with legal/privacy review; do not equate pixels with impressions or official reporting |

## Trust and reporting

Pixel-style requests (if ever added elsewhere) must **not** be interpreted as human impressions, applications, or official compensation evidence. Browser and pixel signals remain **untrusted** unless elevated by server-side design ([operational-guarantees.md](./operational-guarantees.md)).
