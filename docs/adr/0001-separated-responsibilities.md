# 1. Separate responsibilities

Analytics, business outcomes, audit, and product metering are different jobs.

- **Analytics** lives in `@kamod-ch/tracking`: untrusted browser events and explicit collection permission.
- **Business outcomes** are recorded on the server (`recordConversion`). Browser reports are never trusted facts.
- **Audit** stays in an audit module (for Otok apps: `@kamod-ch/otok-audit`). Tracking ingest rejects audit-shaped events.
- **Metering / billing** is not this package. Do not overload tracking events as usage invoices.

The library does not infer a legal basis from consent.
