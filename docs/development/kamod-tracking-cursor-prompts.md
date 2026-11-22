# kamod-tracking – Repository-Review und neue Cursor-Prompts

Stand: 24. September 2026. Ersetzt die bisherigen Greenfield-Prompts vollständig.

## Entscheidung

`kamod-ch/kamod-tracking` bleibt die gemeinsame Tracking-Bibliothek. Es gibt bereits eine belastbare strukturelle Grundlage; ein Neubau würde vorhandene Arbeit duplizieren. Vor produktiven Arbeitgeberkennzahlen müssen jedoch die unten beschriebenen Erfassungs-, Speicher- und Aggregationsfehler behoben werden. Die nächste Phase ist Hardening, danach Devjobs-Integration, danach optionale Integrationen.

Geprüfter Stand: [Commit 642128a](https://github.com/kamod-ch/kamod-tracking/tree/642128a12728dc3787a20b3cd9dc755d8c85d9e4), Branch `main`, Paket `@kamod-ch/tracking` 0.1.0. Dies ist eine Quellcodeanalyse mit lokalen Prüfungen, keine Bestätigung einer produktiven Installation oder eines npm-Releases. Am Repository wurden im Rahmen dieses Reviews keine Quellcodeänderungen vorgenommen.

## Was tatsächlich vorhanden ist

| Bereich      | Vorhanden                                                                 | Konsequenz                                                          |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Paket        | Ein Paket mit Exports `.`, `/browser`, `/preact`, `/server`, `/postgres`  | Diese Grenzen weiterführen; keine fünf neuen Repositories erzeugen  |
| Vertrag      | Registry, versionierte Events, Envelope, Producer- und Identity-Prüfung   | Bestehende Typen härten                                             |
| Browser      | Client, Queue, Consent, Transport, Retry, View-Lifecycle und Sichtbarkeit | Zustands- und Transportfehler korrigieren                           |
| Preact       | Provider und Hooks, SSR-/Hydration-Tests                                  | In Devjobs integrieren, keine zweite Tracking-Implementierung bauen |
| Collector    | Browser-/Server-Handler, Site-Registry, Limits, Rate-Limiter              | Persistenzbestätigung und Scope konsequent durchziehen              |
| PostgreSQL   | Migrationen, mandantenbezogener Store, Inbox, Payload-Hash                | Echten transaktionalen Batchadapter ergänzen                        |
| Verarbeitung | Tagesaggregation, Retention, Dirty Days, Betriebszähler                   | SQL und Wiederberechnungsgrenzen korrigieren                        |
| Devjobs      | Beispielregistry mit `devjobs.listing.view` und `devjobs.apply.click`     | Fachvertrag gezielt erweitern                                       |
| Outbox       | Schnittstelle und deterministische Event-ID                               | Anwendung muss ihre transaktionale Outbox selbst implementieren     |

## Verifikation

Lokale Umgebung: Node 24.19.0, pnpm 11.19.0; deklariertes `packageManager` ist pnpm 11.25.0. CI nutzt Node 22. Diese Abweichung bei Reproduktionen berücksichtigen.

| Prüfung                                 | Ergebnis                                               |
| --------------------------------------- | ------------------------------------------------------ |
| Installation mit eingefrorenem Lockfile | Erfolgreich                                            |
| `pnpm typecheck`                        | Erfolgreich                                            |
| `pnpm lint` / Oxlint                    | Erfolgreich mit Warnungen                              |
| `pnpm format:check` / Oxfmt             | Fehlgeschlagen: `docs/verify-matrix.md`                |
| `pnpm test`                             | 23 Testdateien, 92 Tests erfolgreich                   |
| `pnpm build`                            | Erfolgreich                                            |
| `pnpm test:examples`                    | Erfolgreich                                            |
| `pnpm check:exports`                    | Gepacktes Consumer-Paket erfolgreich geprüft           |
| `pnpm e2e:smoke`                        | Erfolgreich, PostgreSQL-Pfad ausdrücklich übersprungen |
| PostgreSQL-Integration                  | Nicht ausgeführt; keine Testdatenbank verfügbar        |

Die beiden PostgreSQL-Testdateien werden ohne `TRACKING_TEST_DATABASE_URL` aus dem normalen Testlauf ausgeschlossen. Das separate `test:postgres`-Script erfasst am geprüften Stand nur eine davon. Der [GitHub-CI-Lauf zum Commit](https://github.com/kamod-ch/kamod-tracking/actions/runs/35645267811) scheiterte am Formatcheck; nachfolgende Tests/Build wurden dort übersprungen. Ein erfolgreicher lokaler Unit-Testlauf belegt deshalb noch keinen funktionierenden PostgreSQL-Gesamtpfad.

## Befunde und Priorität

Die Pfade beziehen sich auf den oben verlinkten Commit. „Reproduziert“ bedeutet gegen den lokal gebauten Export ausgeführt. „Quellcode“ bedeutet direkt aus der Implementierung abgeleitet; SQL-Befunde wurden nicht gegen eine laufende Datenbank getestet.

| ID  | Priorität | Befund und Auswirkung                                                                                                                                                                                       | Evidenz                                                                                                                             |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| F01 | P0        | `mergeOutcomes` berücksichtigt nur akzeptierte Speicherergebnisse. Eine Ablehnung des Adapters wird durch ein zuvor optimistisch erzeugtes `accepted` ersetzt. Client kann ungespeicherte Events verwerfen. | Reproduziert: Adapter lehnt ab, Store bleibt leer, HTTP 202 meldet accepted. `server/browser-collector.ts`                          |
| F02 | P0        | Fehlende Event-ID wird zum gültigen Wert `unknown`. Verschiedene Events kollidieren.                                                                                                                        | Reproduziert: Event ohne ID wird unter `unknown` gespeichert. `readEventId`                                                         |
| F03 | P0        | Vorabprüfung auf vorhandene Event-ID gibt das bestehende Envelope zurück bzw. akzeptiert sofort als Duplikat, bevor neuer Inhalt vollständig geprüft und verglichen wird.                                   | Reproduziert: gleiche ID mit geändertem Pfad wird als Duplikat akzeptiert. `core/contract-ingest.ts`, `server/browser-collector.ts` |
| F04 | P0        | Memory-Batch meldet unterschiedliche Payloads derselben ID als akzeptiert. Optionales `reset` ist keine PostgreSQL-Transaktion; Snapshot referenziert zudem das veränderbare Array.                         | Quellcode: `server/memory-batch.ts`. PostgreSQL-Store bietet einzelne Eventtransaktionen, keinen passenden echten Batchadapter.     |
| F05 | P0        | Abfrage selektiert nach Empfangstag, Zuordnung danach nach Ereignistag. Ein später eingetroffenes Event kann in beiden Tagesläufen fehlen.                                                                  | Quellcode: `postgres/daily-aggregate.ts`; zulässiger Producer-Zeitversatz standardmässig sieben Tage.                               |
| F06 | P0        | Aggregatschlüssel und Löschpfade unterscheiden Zwecke nicht; Zeitzone fehlt im Primärschlüssel. Wiederberechnung oder Retention eines Zwecks kann andere Ergebnisse überschreiben/löschen.                  | Quellcode: Migration `003_aggregation_retention.sql`, `daily-aggregate.ts`, `retention.ts`                                          |
| F07 | P0        | Retention löscht den Watermark bei leerem Rohbestand. Späterer Rebuild kann historische Aggregate leeren. Auch teilweise gelöschte Tage sind nicht ausreichend geschützt.                                   | Quellcode: `refreshRawWatermark`, `runDailyCountAggregate`                                                                          |
| F08 | P1        | Inbox-Purge verlangt per Join ein existierendes Raw-Event und gleichzeitig per `NOT EXISTS` dessen Abwesenheit. Die Bedingung kann nicht erfüllt werden.                                                    | Quellcode: `postgres/retention.ts`                                                                                                  |
| F09 | P1        | Native Beacon-Nutzlast ist ein String und erhält `text/plain`; Collector akzeptiert JSON-Content-Type. SDK übergibt die native Methode zudem ungebunden.                                                    | Quellcode: `browser/collector-transport.ts`, `browser/client.ts`; String-Request-Content-Type lokal bestätigt                       |
| F10 | P1        | Preflight wählt erste erlaubte Origin; tatsächliche Antworten haben keine CORS-Freigabe. Verbotene Origin kann über erlaubten Referer überstimmt werden.                                                    | Fehlender Header reproduziert; übrige Pfade aus `server/request-guards.ts`                                                          |
| F11 | P1        | Flush-finally startet sofort weiter, auch nachdem Retry geplant und Events wieder eingereiht wurden. Unvollständige Outcomes können Events verlieren, da Batch bereits aus Queue entnommen ist.             | Quellcode: `browser/client.ts`, `browser/event-queue.ts`; Regressionstests nötig                                                    |
| F12 | P1        | Consent-Store auf Collector-Seite ist appId/purpose-bezogen, kein Nachweis der einzelnen Browserentscheidung. Tab-Session fällt auf localStorage zurück.                                                    | Quellcode: `core/contract-ingest.ts`, `browser/client.ts`. Policy und Besucherentscheidung explizit trennen.                        |
| F13 | P1        | Dirty-Day-Löschung berücksichtigt parallele neu eintreffende Events/Regelversionen nicht ausreichend. Tages-Sessions sind nicht zu Zeitraum-Unique-Sessions addierbar.                                      | Quellcode: `postgres/daily-aggregate.ts`, Migration 003                                                                             |
| F14 | P1        | Server-Outbox-Sonderpfad delegiert an Writer vor der zentralen Vertragsvalidierung. Authentifizierter Site-Scope muss auch dort verbindlich geprüft werden.                                                 | Quellcode: `server/server-collector.ts`                                                                                             |
| F15 | P2        | `AGENTS.md` beschreibt PostgreSQL noch als zukünftigen Export; README startet mit älterem Ingest-Handler.                                                                                                   | Dokumentation widerspricht vorhandenem Paket                                                                                        |

Weitere gezielte Prüfungen: View-Wechsel bei laufendem Sichtbarkeitstimer, erneute Beobachtung bereits gezählter DOM-Elemente, Consent-Widerruf während asynchroner Capture-Validierung. Diese sind Testaufträge, keine in diesem Review reproduzierten Browserfehler.

## Zielvertrag

1. `accepted` bedeutet nachweislich persistiert; `duplicate` bedeutet identische kanonische Nutzlast im selben Tenant-/Site-Scope. Abweichender Inhalt derselben ID ist ein permanenter Konflikt.
2. Scope kommt aus Site-Konfiguration bzw. Serverauthentisierung. Public Key ist Routinginformation, kein Geheimnis. Browserdaten bleiben untrusted.
3. Browser-SDK, Collector und Persistenz teilen dieselbe Registry, Purpose-/Identity-Policy und Versionsregeln. Neue öffentliche APIs erst nach Implementierung dokumentieren.
4. Für Speicherfehler gilt: kein unverdientes ACK; stabiles Event-ID-Replay; atomare Persistenz des gültigen Batchanteils. Fachlich ungültige Events erhalten einzelne permanente Ablehnungen.
5. Der kanonische Payload-Hash enthält unveränderliche Eventdaten und deren Versionierung. Veränderliche Server-Empfangszeit darf identische Retries nicht zu Konflikten machen. Schema dafür ausdrücklich dokumentieren.
6. Aggregation verwendet eine einmal eindeutig bestimmte Bucket-Zeit. Schlüssel enthalten Scope, Zweck, Zeitzone, Aggregations- und Messregelversion sowie tatsächlich ausgewertete Dimensionen.
7. Rebuilds laufen nur mit nachweislich vollständiger Rohdatenabdeckung. Eine beständige Retention-Grenze bleibt auch bei leerer Tabelle erhalten.
8. Es gibt keine Garantie, dass jede Browseraktion erfasst wird. Beacon-Annahme ist kein Persistenznachweis. Das Dashboard zeigt Datenqualität und Stand der Verarbeitung.

## Cursor: gemeinsamer Arbeitsauftrag

Diesen Block zu Beginn des Arbeitsdialogs verwenden, dann die nummerierten Prompts nacheinander ausführen. Bei neuerem HEAD zuerst prüfen, welche Befunde bereits behoben sind. Keine bereits korrekte Implementierung zurückbauen.

```text
Arbeite im vorhandenen Repository kamod-ch/kamod-tracking. Grundlage ist der Review
von Commit 642128a12728dc3787a20b3cd9dc755d8c85d9e4. Prüfe zuerst aktuellen HEAD,
AGENTS.md, package.json, Lockfile, Exports und betroffene Tests.
Erhalte die bestehende Ein-Paket-Struktur und öffentliche Exportgrenzen.
Nutze die tatsächlichen APIs; keine erfundenen Kamod-Imports. Preact bleibt Preact.
Nutze pnpm, TypeScript, Oxlint und Oxfmt nach Repositorykonventionen.
Arbeite pro Prompt in einem überschaubaren Änderungssatz. Ergänze Regressionstests
für die konkreten Fehler; führe betroffene Tests, Typecheck, Lint und Formatcheck aus.
Für SQL-Änderungen sind echte PostgreSQL-Integrationstests Pflicht.
Migrationen für vorhandene Installationen additiv gestalten. Nicht stillschweigend
angewandte Migrationen ändern. Fehlende Datenbank oder Zugang klar melden.
Schliesse mit Änderung, Prüfergebnis, offenen Grenzen und Migrationshinweisen ab.
Keine Veröffentlichung oder Produktivmigration als Nebenwirkung.
```

### Prompt 1 – Verifizierbare Ausgangslage und PostgreSQL-CI

```text
Korrigiere die Verifikationsbasis. Reproduziere den Formatfehler in
docs/verify-matrix.md und formatiere nur betroffene Dateien mit Oxfmt.
Aktualisiere AGENTS.md und Implementierungsstatus anhand der tatsächlichen Exports;
PostgreSQL ist bereits vorhanden. Entferne keine bestehende Funktion deswegen.
Richte einen separaten CI-Job mit temporärer PostgreSQL-Service-Datenbank,
Migrationen und TRACKING_TEST_DATABASE_URL ein. Stelle sicher, dass sowohl
postgres.integration.test.ts als auch postgres-aggregation.integration.test.ts
ausgeführt werden; korrigiere test:postgres entsprechend.
Kein Datenbankjob darf bei fehlender Konfiguration als Erfolg mit Skip erscheinen.
Behalte den schnellen Unit-Testjob. Pinne eine tatsächlich verfügbare und zum
Lockfile passende pnpm-Version konsistent; dokumentiere Node-Testmatrix.
Abnahme: beide SQL-Testdateien nachweislich ausgeführt; Fehler brechen CI ab.
```

### Prompt 2 – Collector-ACK, Event-ID und Duplikate

```text
Behebe F01–F03 in browser-collector und contract-ingest.
Fehlende/ungültige IDs ablehnen, niemals "unknown" als gespeicherte ID erzeugen.
Validiere den neuen Inhalt auch bei bereits vorhandener ID; entferne vorzeitige
Duplikat-Erfolge. Identische Retries behalten ihre ID. Abweichende Payload erhält
einen expliziten permanenten Konfliktgrund im öffentlichen Vertrag.
mergeOutcomes muss Ablehnungen unverändert erhalten. Fehlende oder widersprüchliche
Adapter-Outcomes dürfen niemals zu einem optimistischen accepted werden.
Definiere die Zuordnung bei mehrfacher gleicher ID innerhalb eines Batches eindeutig.
Fange Storage-Ausnahmen ohne Payload-Leak als retryable Fehler ab.
Abnahme: fehlende ID, geänderte Payload, Adapter-Reject, fehlendes Outcome,
gleiche IDs innerhalb eines Batches und identischer Retry nach verlorenem ACK.
Die ersten drei Fälle müssen die bekannten Fehlverhalten reproduzieren und beheben.
```

### Prompt 3 – Transaktionaler PostgreSQL-Batch und Scope

```text
Implementiere auf Basis von scoped-store.ts einen echten PostgreSQL-Adapter für
BatchEnvelopeAcceptance. Entwirf zuerst die kleinste passende öffentliche API.
Keine Memory-Batch-Abstraktion um PostgreSQL legen und keine list()-Vollscans.
Resolver/Factory muss den aus der Site-Registry ermittelten Scope binden können;
prüfe jedes Envelope gegen genau diesen Scope. Inbox und Raw-Events des gültigen
Batchanteils in einer Transaktion schreiben. Dauerhafte fachliche Ablehnungen als
Outcomes zurückgeben; Infrastrukturfehler rollen den gesamten gültigen Anteil zurück.
Kanonischen Hash stabil für Retries gestalten, Empfangszeit nicht hineinmischen.
Gleiche ID in anderem Tenant/Site darf unabhängig existieren.
Memory-Adapter muss dieselbe Duplikat-/Konfliktsemantik bieten; Snapshot kopieren.
Abnahme mit PostgreSQL: Konkurrenz gleicher IDs, Payload-Konflikt, gemischter Batch,
Rollback beim zweiten Insert, falscher Scope, Wiederholung nach Commit/ACK-Verlust.
```

### Prompt 4 – Browsertransport und Retry-Zustandsmaschine

```text
Behebe F09–F11 in collector-transport.ts, client.ts, event-queue.ts und request-guards.ts.
Nutze ein mit dem Collector kompatibles Beacon-Format, z.B. JSON-Blob mit passendem
Content-Type, und binde die native Methode an navigator. API-Typen entsprechend ändern.
Beacon-Erfolg bleibt ausdrücklich browser-accepted, nie verified/persisted.
Implementiere echten Backoff mit Retry-After: ein fehlgeschlagener Batch darf nicht
über finally sofort wieder versandt werden. Keine parallelen Flush-Schleifen.
Validiere die Antwort vollständig; fehlende Outcomes kontrolliert erneut versuchen,
fremde IDs dürfen Queue-Einträge nicht bestätigen. Retry/Alter/Queue bleiben begrenzt.
Bei explizit verbotener Origin kein Referer-Fallback; Preflight und tatsächliche
Antworten verwenden nur die angefragte erlaubte Origin und Vary: Origin.
Keine pauschale CORS-Freigabe. Same-Origin bleibt empfohlener Betriebspfad.
Abnahme: Fake-Timer für Retry-After, fehlerhafte Antwort, native Beacon-Bindung,
reale Browserprüfung Content-Type/CORS, Origin-Referer-Konflikt, Widerruf während Retry.
```

### Prompt 5 – Consent, Sessions und View-Lifecycle

```text
Trenne in Typen und Dokumentation serverseitige Collection-Policy von individueller
Browser-Entscheidung. Ein appId/purpose-weites granted ist kein Besuchernachweis.
Ordne erlaubten Purpose serverseitig einer Eventdefinition/Site-Policy zu;
Browserangaben dürfen diese Zuordnung nicht frei verändern.
Führe keine dauerhafte User-ID als vermeintliche Lösung ein. Default identityMode none.
Optionaler Sessionmodus bleibt tabbezogen; wenn sessionStorage nicht verfügbar ist,
falle auf Memory zurück, niemals stillschweigend auf localStorage.
Fange auch werfende Storage-Getter ab. Bei Widerruf Queue, Timer und Session löschen;
Capture nach asynchroner Validierung erneut gegen aktuellen Consentzustand prüfen.
Prüfe Visibility-Timer bei View-Wechsel, erneuter Beobachtung und Consentwechsel.
Eine neue View invalidiert alte Timer; identische beginView-Aufrufe nicht ungewollt
mehrfach zählen. Markiere Impression erst nach erfolgreicher lokaler Annahme.
Abnahme: zwei Tabs, blockierter Storage, SSR, revoke während capture, Navigation bei
laufendem Timer, virtuelle Liste, erneutes granted ohne Nachsenden alter Ereignisse.
```

### Prompt 6 – Aggregatschema und eindeutige Zeitzuordnung

```text
Behebe F05/F06/F13. Entwirf eine additive Migration nach Migration 003.
Tagesaggregate müssen tenant, site, purpose, time_zone, aggregate_rule_version,
measurement_rule_version und die unterstützten Dimensionen eindeutig unterscheiden.
Prüfe, ob unterschiedliche Collection-Policies getrennt ausgewiesen werden müssen.
Für Devjobs wird mindestens eine allowlist-basierte surface-Dimension benötigt;
keine beliebigen JSON-Properties zu hochkardinalen Dimensionen machen.
Bestimme bucket_at mit versionierter Regel eindeutig. Nutze beim Rebuild dieselbe
Auswahlregel wie beim Ingest; keine reine received_at-Tagesabfrage mit nachträglicher
occurred_at-Zuordnung. Index-/Backfillstrategie für vorhandene Daten dokumentieren.
Serialisiere Rebuilds desselben Aggregatschlüssels. Dirty-Marker generationsbezogen
bestätigen, sodass parallel eintreffende Events nicht unbemerkt sauber markiert werden.
Abnahme in PostgreSQL: Ereignis vor Mitternacht/Empfang danach, mehrere Tage verspätet,
Europe/Zurich-Sommerzeitwechsel, zwei Purposes, zwei Zonen, Regelwechsel und Konkurrenz.
```

### Prompt 7 – Retention ohne Zerstörung historischer Kennzahlen

```text
Behebe F07/F08. Ersetze MIN(received_at) als Vollständigkeitsbeweis durch eine explizite,
beständige Grenze, ab wann Rohdaten für Wiederberechnung vollständig sein können.
Beachte Ankunftsfenster/Bucket-Zuordnung: ein teilweise gelöschter Tag darf nicht als
vollständig gelten. Leere Raw-Tabelle darf die Retention-Grenze nicht zurücksetzen.
Rebuild ausserhalb vollständiger Abdeckung muss alte Aggregate erhalten und einen
sichtbaren Status liefern, statt sie auf null zu setzen.
Korrigiere Inbox-Purge: benötigte Purpose-/Scope-Metadaten müssen nach Raw-Löschung
noch verfügbar sein. Wähle eine additive Migration mit sicherem Altbestandsverhalten.
Inbox-Aufbewahrung mindestens so lang wie unterstützter Replay-/Retry-Horizont;
nach Ablauf keine unbegrenzte Exactly-once-Garantie behaupten.
Aggregate zweckbezogen löschen, Retentionwerte validieren und grosse Löschungen in
begrenzten Batches ausführen. Konkurrenz mit Rebuild ausdrücklich koordinieren.
Abnahme: kompletter Raw-Purge plus Rebuild, teilweise gelöschter Tag, Inbox-Expiry,
zwei Purposes mit verschiedenen Fristen, Wiederaufnahme nach unterbrochenem Purge.
```

### Prompt 8 – Vertrauenswürdige Serverevents und Outbox

```text
Harte server-collector.ts und den Outbox-Sonderpfad. Authentisierung legt den Scope
fest; Registry, Producer, Purpose, Subject und Site-Zuordnung werden auch bei
custom outboxWriter vor dessen Aufruf validiert. Writer darf ungültige Events nicht
durch die Nebenroute erhalten. Permanente Validierungsfehler nicht als retryable
Storagefehler tarnen. Rejected Adapter-Outcomes korrekt an Aufrufer zurückgeben.
Erhalte eventIdFromOutboxId. Zeige im Beispiel eine echte Domaintransaktion, die
Geschäftsobjekt und Outboxeintrag atomar schreibt, mit Worker-Lease, Retry und
Quarantäne dauerhaft ungültiger Einträge. Application-Outbox bleibt beim Consumer.
Abnahme: gefälschter Browserproducer, Token für falsche Site, unregistriertes Event,
Domainrollback, Workerabsturz nach Commit und doppeltes Replay.
```

### Prompt 9 – Releasefähige Beispiele, Dokumentation und Betriebsdaten

```text
Aktualisiere README, AGENTS, Implementierungsstatus und Beispiele nach den behobenen
Pfaden. Hauptbeispiel zeigt aktuellen Browsercollector mit echtem PG-Batchadapter.
Trenne Memory-Demo, PostgreSQL-Integration und produktiven Consumer klar.
Verbinde vorhandene Betriebszähler mit echten Outcomes: accepted, duplicate,
conflict, rejected, storage_error, retry, queue_discard, aggregation_lag,
retention_run und dirty_backlog. Keine Rohpayloads, IPs oder Session-IDs in Logs.
Eine Zählerfunktion allein gilt nicht als integrierte Observability.
Dokumentiere unterstützte Transport-, Consent-, Session- und Rebuildgarantien.
Führe vollständige Verify-Matrix inklusive echter Datenbank aus. Prüfe gepackte
Exports, Browser-Bundlegrenzen und SSR. Ergänze Migrations-/Rollbackhinweise.
Abnahme: dokumentierte reproduzierbare Consumer-Installation und grüner CI-Lauf
mit SQL-Jobs; keine still übersprungenen Pflichtpfade.
```

### Prompt 10 – Optionaler Pixeladapter, erst nach dem Kern

```text
Entscheide anhand eines konkreten Consumers, ob ein Pixeladapter nötig ist.
Falls ja: implementiere ihn ausschliesslich als weiteren begrenzten Eingang für
ein eigenes pixel.request-Event. Wiederverwende Registry, Scope, Limits und Storage.
Keine Pixelanforderung als sichtbare Impression, Mensch, Bewerbung oder offiziellen
Vergütungsnachweis deklarieren. Keine allgemeine Property-Payload in Queryparametern,
keine personenbezogenen Daten, keine persistenten IDs als Default.
Berücksichtige Caches, Mail-Proxies, Prefetch, Bots, Blocker und Replay. Kennzeichne
Messmethode und Vertrauensklasse in Auswertungen. No-store ist keine Zustellgarantie.
Wenn kein konkreter Anwendungsfall vorliegt, dokumentiere die Entscheidung und
implementiere keinen vorsorglichen Pixel.
```

## Reihenfolge und Freigabekriterien

Prompts 1–3 sichern Annahme und Speicherung. Prompts 4–5 sichern Browserverhalten. Prompts 6–7 sichern Kennzahlen und Historie. Prompt 8 sichert Geschäftsvorgänge. Prompt 9 ist Voraussetzung für den produktiven Consumer; Prompt 10 bleibt optional.

Produktive Arbeitgeberreports erst nach Regressionstests, PostgreSQL-End-to-End-Prüfung und erfolgreichem Restore-/Replay-Test. Bis dahin können UI und API gegen eindeutig markierte Fixtures entwickelt werden. Bestehende historische Daten nicht nachträglich als verlässlich deklarieren: Messbeginn und bekannte Lücken sichtbar machen.

## Grenzen gegenüber einer ProLitteris-Alternative

Die Bibliothek sammelt und normalisiert Events. Verteilung, Berechtigte, Werkregister, Abrechnungen, Audit und Regeln einer eigenen Vergütungsplattform gehören in eine separate fachliche Metering-Anwendung. Eine offizielle ProLitteris-Anbindung ist ein eigener Adapter nach den dann verifizierten Vorgaben. Weder Pixel noch eigene Analytics-Events belegen automatisch Anerkennung oder Vergütungsfähigkeit. Dieses Review prüft keine aktuellen ProLitteris-Vertragsbedingungen.
