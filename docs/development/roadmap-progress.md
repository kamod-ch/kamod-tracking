# Roadmap-Fortschritt: kamod-tracking Cursor-Prompts

Stand: 2026-10-18. Basis: [kamod-tracking-cursor-prompts.md](./kamod-tracking-cursor-prompts.md), Review-Commit `642128a`, Umsetzung überwiegend in `ce31c7d` (feat: hardening) plus Nacharbeit in diesem Lauf.

## Basis-Prompt (gemeinsamer Arbeitsauftrag)

| Aspekt                                   | Status      | Evidenz                                                         |
| ---------------------------------------- | ----------- | --------------------------------------------------------------- |
| Ein-Paket-Struktur, Exportgrenzen        | erledigt    | `packages/core/package.json` exports; `pnpm check:exports` grün |
| pnpm / Typecheck / Lint / Format / Tests | erledigt    | `pnpm verify` grün (2026-10-18)                                 |
| PostgreSQL-Integrationstests             | erledigt    | `pnpm test:postgres`: 5 Dateien, 34 Tests grün (Docker `54329`) |
| Release-Gate mit DB                      | erledigt    | `pnpm verify:all` grün nach Migrationspfad- und Demo-Fix        |
| Kein Push / Publish                      | eingehalten | —                                                               |

**Entscheidung (dieser Lauf):** Gebündelter `./postgres`-Export löste Migrationen unter `packages/migrations` statt `packages/core/migrations` — `resolveMigrationsDir()` in `migrate.ts`. Beispiel `collector-postgres` nutzt `seedTrackingSite` statt veralteter SQL-Spalten.

---

## Aufgabe 1 – Verifizierbare Ausgangslage und PostgreSQL-CI

| Feld                 | Inhalt                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | erledigt                                                                                                                                                                                                                                                                                                      |
| **Änderungen**       | Bereits in `main`: `docs/verify-matrix.md` formatiert; `AGENTS.md` / `docs/implementation-status.md` mit PostgreSQL-Export; CI-Job `postgres` mit Service-DB; `vitest.postgres.config.ts` inkl. 5 Suites; `require-postgres-test-env.mjs`; pnpm 11.25.0 gepinnt. Dieser Lauf: Oxfmt für `docs/development/*`. |
| **Prüfungen**        | `pnpm verify` OK; `pnpm test:postgres` OK; `.github/workflows/ci.yml` Job `postgres` → `pnpm test:postgres`                                                                                                                                                                                                   |
| **Probleme**         | Keine                                                                                                                                                                                                                                                                                                         |
| **Nächster Schritt** | —                                                                                                                                                                                                                                                                                                             |

---

## Aufgabe 2 – Collector-ACK, Event-ID und Duplikate (F01–F03)

| Feld                 | Inhalt                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**           | erledigt                                                                                                                                                     |
| **Änderungen**       | `browser-collector.ts`, `contract-ingest.ts`, `mergeOutcomes`; permanenter Konflikt `payload-conflict` im Vertrag                                            |
| **Prüfungen**        | `packages/core/tests/collector-batch.test.ts` (u. a. mergeOutcomes, fehlende ID, Batch-Duplikate); `contract-ingest.test.ts`; `postgres.integration.test.ts` |
| **Probleme**         | Keine                                                                                                                                                        |
| **Nächster Schritt** | —                                                                                                                                                            |

---

## Aufgabe 3 – Transaktionaler PostgreSQL-Batch und Scope (F04)

| Feld                 | Inhalt                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| **Status**           | erledigt                                                                                     |
| **Änderungen**       | `scoped-batch-acceptance.ts`, transaktionaler PG-Store; Memory-Batch Semantik angeglichen    |
| **Prüfungen**        | `postgres-batch.integration.test.ts` (9 Tests: Konkurrenz, Konflikt, Rollback, Scope, Retry) |
| **Probleme**         | Keine                                                                                        |
| **Nächster Schritt** | —                                                                                            |

---

## Aufgabe 4 – Browsertransport und Retry-Zustandsmaschine (F09–F11)

| Feld                 | Inhalt                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | erledigt                                                                                                                           |
| **Änderungen**       | Beacon JSON + Binding; Backoff/`Retry-After`; CORS/Preflight in `request-guards.ts`; Queue/Flush in `client.ts` / `event-queue.ts` |
| **Prüfungen**        | `browser-client.test.ts`, `collector-transport.test.ts`, `request-guards.test.ts`; E2E smoke                                       |
| **Probleme**         | Keine                                                                                                                              |
| **Nächster Schritt** | —                                                                                                                                  |

---

## Aufgabe 5 – Consent, Sessions und View-Lifecycle (F12)

| Feld                 | Inhalt                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Status**           | erledigt                                                                                                       |
| **Änderungen**       | `docs/collection-policy.md`, ADR 0006; Session Memory-Fallback; Visibility-Timer; Revoke während Capture       |
| **Prüfungen**        | `browser-client.test.ts`, `visibility-timer.test.ts`, `preact.test.tsx`, `examples/preact-consent-visibility/` |
| **Probleme**         | Keine                                                                                                          |
| **Nächster Schritt** | —                                                                                                              |

---

## Aufgabe 6 – Aggregatschema und eindeutige Zeitzuordnung (F05/F06/F13)

| Feld                 | Inhalt                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| **Status**           | erledigt                                                                                                |
| **Änderungen**       | Migration `004_aggregate_dimensions.sql`; Bucket-Regeln in `daily-aggregate.ts`; Dirty-Day-Generationen |
| **Prüfungen**        | `postgres-aggregation.integration.test.ts`, `postgres-aggregation-bucket.integration.test.ts`           |
| **Probleme**         | Keine                                                                                                   |
| **Nächster Schritt** | —                                                                                                       |

---

## Aufgabe 7 – Retention ohne Zerstörung historischer Kennzahlen (F07/F08)

| Feld                 | Inhalt                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| **Status**           | erledigt                                                                                        |
| **Änderungen**       | Migration `005_retention_recompute_boundary.sql`; `retention.ts` Inbox-Purge und Purpose-Scopes |
| **Prüfungen**        | `postgres-retention.integration.test.ts` (8 Tests)                                              |
| **Probleme**         | Keine                                                                                           |
| **Nächster Schritt** | —                                                                                               |

---

## Aufgabe 8 – Vertrauenswürdige Serverevents und Outbox (F14)

| Feld                 | Inhalt                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Status**           | erledigt                                                                                                                 |
| **Änderungen**       | `server-collector.ts` Validierung vor Outbox-Writer; `examples/server-outbox-postgres/` mit Domaintransaktion und Worker |
| **Prüfungen**        | `server-collector.test.ts`; `pnpm --filter @kamod-tracking/example-server-outbox-postgres test` in `test:examples`       |
| **Probleme**         | Keine                                                                                                                    |
| **Nächster Schritt** | —                                                                                                                        |

---

## Aufgabe 9 – Releasefähige Beispiele, Dokumentation und Betriebsdaten

| Feld                 | Inhalt                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**           | erledigt                                                                                                                                                                                                                                               |
| **Änderungen**       | README, `implementation-status.md`, `observability.md`, `operational-guarantees.md`, `examples/README.md`; Migration `006_ops_outcome_metrics.sql`. **Dieser Lauf:** `migrate.ts` Pfad für dist; `examples/collector-postgres/demo.mjs` Schema-konform |
| **Prüfungen**        | `pnpm verify:all` grün; `collector-postgres` Demo; `check:exports`; SSR-Tests in verify                                                                                                                                                                |
| **Probleme**         | Keine (nach Fixes)                                                                                                                                                                                                                                     |
| **Nächster Schritt** | —                                                                                                                                                                                                                                                      |

---

## Aufgabe 10 – Optionaler Pixeladapter

| Feld                 | Inhalt                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | erledigt (Entscheidung: kein Pixel in v0.1)                                                                                |
| **Änderungen**       | [ADR 0010](../adr/0010-pixel-adapter-decision.md), [pixel-adapter.md](../pixel-adapter.md); kein `pixel.request`-Collector |
| **Prüfungen**        | Dokumentierte Consumer-Analyse (Devjobs: kein dokumentierter Pixel-Bedarf)                                                 |
| **Probleme**         | Keine                                                                                                                      |
| **Nächster Schritt** | Bei konkretem Consumer neues ADR + begrenzter Eingang                                                                      |

---

## Abschlussbericht (2026-10-18)

### Änderungen in diesem Lauf

1. `packages/core/src/postgres/migrate.ts` — Migrationsverzeichnis für `src/` und `dist/` auflösbar.
2. `examples/collector-postgres/demo.mjs` — `seedTrackingSite` statt falscher DDL.
3. `docs/development/roadmap-progress.md` (diese Datei).
4. Oxfmt auf `docs/development/kamod-tracking-cursor-prompts.md`.

### Prüfergebnisse

| Befehl                                                          | Ergebnis                                          |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `pnpm verify`                                                   | Erfolg                                            |
| `pnpm test:postgres` (URL → `127.0.0.1:54329`)                  | 34/34 Tests                                       |
| `pnpm verify:all`                                               | Erfolg                                            |
| `pnpm --filter @kamod-tracking/example-collector-postgres test` | `ingest_accepted/duplicate/conflict` wie erwartet |

### Offene Punkte

- Keine blockierten Pflichtaufgaben. Pixel bewusst nicht implementiert (Aufgabe 10).
- Lokale PostgreSQL-Tests erfordern Docker (`docker-compose.tracking-test.yml`, Port **54329**).
- CI nutzt Node 22; lokale Node 24.x — in `verify-matrix.md` dokumentiert.
