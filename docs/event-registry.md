# Event registry

Registered events are validated at runtime. Properties must match the declared field list exactly.

- **Unknown property keys** inside `properties` are **rejected** (`invalid-payload`), not stored silently.
- **Unknown top-level producer fields** that try to set server authority (`tenant_id`, `trust_class`, …) are **rejected** (`forbidden-producer-field`).
- **Deprecated schema versions** stay **readable** until `readableUntil`; new writes after that timestamp are rejected (`version-retired`).

Devjobs-specific events live in `examples/devjobs/registry.ts`, not in the generic core.
