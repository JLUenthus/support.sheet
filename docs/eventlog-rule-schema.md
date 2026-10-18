# Event Log Analyzer – Datenvertrag (Rule-Schema)

Stand: Phase 13B (Schema-/Datenmodell-Hardening, keine fachliche Änderung).

Dieses Dokument beschreibt den kanonischen Datenvertrag der vier Regeldateien
unter `data/` sowie des Collector-JSON-Formats, das `eventlog.html` konsumiert.
Es ist reine Dokumentation – keine JSON-Schema-Validierungsbibliothek wird
eingeführt, da das Projekt aktuell keine entsprechende Infrastruktur besitzt.

## Grundprinzip

Jede der vier Regeldateien hat einen **eindeutigen Root-Key** und ein eigenes,
für ihren Regeltyp passendes Schema. Es gibt bewusst **kein** gemeinsames
Mega-Schema über alle vier Dateien – Event Rules, Correlation Rules,
Improvements und Known Harmless bleiben strukturell unterschiedliche Konzepte.

| Datei | Root-Key (neu) | Root-Key (Legacy-Fallback) |
|---|---|---|
| `data/eventlog-rules.json` | `eventRules` | `rules` |
| `data/correlation-rules.json` | `correlationRules` | `rules` |
| `data/improvement-rules.json` | `improvementRules` | `improvements` |
| `data/known-harmless.json` | `harmlessEvents` | `events` |

Der Legacy-Fallback existiert ausschließlich für den Fall, dass ein Client
noch eine ältere, per Service-Worker gecachte Fassung dieser Dateien ausliefert
(`data.eventRules || data.rules || []`-Muster in `eventlog.html`). Neu
erzeugte/gepflegte Dateien verwenden ausschließlich den neuen Key.

## 1. Event Rules (`data/eventlog-rules.json`)

```jsonc
{
  "version": "1.1",
  "lastUpdated": "2026-05-24",
  "eventRules": [
    {
      "id": "KERNEL_POWER_41",          // unverändert, stabile ID
      "name": "...",
      "category": "Absturz",             // Taxonomie unverändert (Phase 13C)
      "severity": "critical",            // critical | error | warning | info – unverändert
      "eventIds": [41],                  // IMMER Array, auch bei einer einzelnen ID
      "sources": ["Microsoft-Windows-Kernel-Power"], // IMMER Array
      "minCount": 1,                     // vormals "minOccurrences" (Bedeutung unverändert)
      "windowMinutes": 60,               // vormals "timeWindowMinutes" (optional, Bedeutung unverändert)
      "messageContains": ["..."],        // optional, unverändert
      "description": "...",
      "recommendations": [ /* siehe Abschnitt "Recommendations" */ ],
      "relatedEventIds": [1001, 1002],   // optional, unverändert
      "tags": ["crash"],                 // optional, unverändert
      "communityCount": 0,               // optional, unverändert (derzeit ungenutzt, siehe Phase 13D)
      "serverOnly": true                 // optional, unverändert
    }
  ]
}
```

## 2. Correlation Rules (`data/correlation-rules.json`)

Vier Regeltypen (`type`), unverändert in Bedeutung und Berechnung:
`correlation` (mit `operator: "AND"|"OR"` und `conditions[]`), `groupByProcess`,
`timeBurst`, `groupBySource`.

```jsonc
{
  "version": "1.0",
  "correlationRules": [
    {
      "id": "NETLOGON_NETWORK_CORRELATION",
      "type": "correlation",
      "operator": "AND",
      "severity": "error",
      "category": "Netzwerk",
      "conditions": [
        { "eventIds": [5719], "sources": ["NETLOGON"], "minCount": 1 },
        { "category": "Netzwerk", "minCount": 2 }
      ],
      "description": "...",
      "recommendations": [ /* ... */ ]
    },
    {
      "id": "APP_CRASH_LOOP",
      "type": "groupByProcess",
      "eventIds": [1000],               // vormals "eventId" (Singular) auf Rule-Ebene
      "minCount": 5,
      "severity": "critical",
      "category": "Stabilität"
    },
    {
      "id": "BURST_OF_ERRORS",
      "type": "timeBurst",
      "windowMinutes": 15,               // war bereits kanonisch, unverändert
      "minErrorsInWindow": 20            // eigenes Konzept, nicht mit minCount vereinheitlicht
    },
    {
      "id": "SINGLE_SOURCE_ERROR_FLOOD",
      "type": "groupBySource",
      "minCount": 20,
      "dominancePercent": 40             // eigenes Konzept, unverändert
    }
  ]
}
```

`conditions[].eventIds`/`conditions[].sources` sind jetzt durchgängig Arrays
(vormals in Teilen `eventId`/`source` als Singular-Feld, teils bereits Array –
diese Inkonsistenz war einer der Hauptbefunde der Analysephase). `minCount`
und `windowMinutes` waren in dieser Datei bereits kanonisch und wurden nicht
umbenannt.

## 3. Improvements (`data/improvement-rules.json`)

```jsonc
{
  "version": "1.0",
  "description": "...",
  "improvementRules": [
    {
      "id": "IMP_POWER_PLAN",
      "check": "powerPlan",              // unverändert – benennt die zu prüfende Metadaten-Kennzahl
      "allowedValues": ["balanced", "..."], // vormals "checkValues"
      "severity": "warning",
      "category": "Performance"
    },
    {
      "id": "IMP_UPTIME_HIGH",
      "check": "uptimeHours",
      "threshold": 720                   // vormals "checkThreshold"
    },
    {
      "id": "IMP_WINDOWS_VERSION",
      "check": "windowsBuild",
      "maxBuild": 19044                  // vormals "checkMaxBuild"
    },
    {
      "id": "IMP_NO_ENDPOINT_PROTECTION",
      "check": "endpointProtection",
      "expectedStatus": "none"           // neu in Phase 13C, siehe unten
    },
    {
      "id": "IMP_ENDPOINT_PROTECTION_UNKNOWN",
      "check": "endpointProtection",
      "expectedStatus": "unknown"        // neu in Phase 13C, siehe unten
    }
  ]
}
```

Drei fachlich unterschiedliche Schwellenwert-Konzepte bleiben bewusst getrennte
Felder (keine künstliche Vereinheitlichung, siehe Vorgabe Phase 13B Abschnitt 10):

| Feld (neu) | Feld (Legacy) | Bedeutung |
|---|---|---|
| `threshold` | `checkThreshold` | Ein Zahlenwert, der über-/unterschritten werden muss (Einheit ist implizit durch `check` bestimmt: Stunden, Prozent, Anzahl, Jahre, GB) |
| `maxBuild` | `checkMaxBuild` | Eine maximale Windows-Build-Nummer, ab der der Check greift |
| `allowedValues` | `checkValues` | Eine Liste erlaubter/erwarteter Werte (z.B. Energiepläne) |
| `expectedStatus` | – (neu, kein Legacy-Pendant) | Nur für `check: "endpointProtection"`: der `Metadata.SecurityProtection.protectionStatus`-Wert, bei dem diese konkrete Regel auslöst (`"none"` bzw. `"unknown"`) – ermöglicht zwei Regeln mit unterschiedlicher Severity für denselben zugrunde liegenden Zustand, siehe Abschnitt 6a |

Der Consumer in `eventlog.html` liest `imp.threshold ?? imp.checkThreshold`
(analog für die anderen beiden) – reine Lese-Kompatibilität, keine
Schreib-Migration nötig. `expectedStatus` hat kein Legacy-Pendant, da der
zugrunde liegende Check (`endpointProtection`) selbst neu in Phase 13C ist.

## 4. Known Harmless (`data/known-harmless.json`)

```jsonc
{
  "version": "1.0",
  "description": "...",
  "harmlessEvents": [
    {
      "eventIds": [11],                 // vormals "eventId" (Singular)
      "sources": ["disk"],              // vormals "source" (Singular)
      "label": "Festplattenfehler (generisch)",
      "reason": "...",
      "reduceSeverity": false,
      "affectsScore": false,
      "minCountForConcern": 3,
      "onlyHarmlessIfNoCorrelation": true,
      "correlationIds": ["DISK_AND_SYSTEM_ERRORS"],
      "excludeSources": ["SysMain", "Superfetch"]
    }
  ]
}
```

### Feldstatus (verifiziert gegen den tatsächlichen Code in `eventlog.html`)

| Feld | Status | Hinweis |
|---|---|---|
| `eventIds`, `sources` | **aktiv genutzt** | Primäres Match-Kriterium in `isHarmless()` |
| `excludeSources` | **aktiv genutzt** | Schließt Provider vom Harmless-Match aus (geprüft wird der Providername, nicht der Dienst- oder Programmname aus der Meldung) |
| `messageContains` | **aktiv genutzt** (Korrekturschritt Regeln und Darstellung) | Liste von Begriffen: der Eintrag gilt nur, wenn die Meldung mindestens einen davon nennt (Teilstring, ohne Groß-/Kleinschreibung, wie `messageContains` bei den Event Rules). Ausgewertet in `matchesHarmlessRule()`, damit auch in der `minCountForConcern`-Zählung. Fehlt das Feld, gilt wie bisher nur Event-ID und Quelle. Einziger Nutzer: ID 7023 (nur die Dienste SysMain und Superfetch sind harmlos). |
| `onlyHarmlessIfNoCorrelation` + `correlationIds` | **aktiv genutzt** | Kontext-Awareness: unterdrückt die Harmless-Markierung, wenn eine der referenzierten Correlations aktiv getriggert hat |
| `reduceSeverity` | ⚠️ **deklariert, aber im Code nicht gelesen** | Wird an keiner Stelle in `eventlog.html` ausgewertet. Nicht löschen, nicht implementieren – Phase 13D-Kandidat |
| `affectsScore` | ⚠️ **deklariert, aber im Code nicht gelesen** | Ist in allen 29 Einträgen `false`, wird nirgends ausgewertet. Phase 13D-Kandidat |
| `minCountForConcern` | ⚠️ **deklariert, aber im Code nicht durchgesetzt** | Kommentar in `isHarmless()` verweist darauf ("wird vom Aufrufer geprüft"), aber `renderEventTable()` (einziger Aufrufer) prüft es nicht. **Bewusst nicht in `minCount` umbenannt** – die Bedeutung ist eine andere ("ab wie vielen Vorkommen ist ein an sich harmloses Event NICHT MEHR harmlos"), nicht "ab wie vielen Vorkommen greift die Regel" wie bei `minCount` in den anderen drei Dateien. Eine Umbenennung würde eine Bedeutungsgleichheit suggerieren, die nicht besteht. Phase 13D-Kandidat für Umsetzung oder bewusste Entfernung |

> **Hinweis zum Stand:** Die Zeilen zu `reduceSeverity`, `affectsScore` und
> `minCountForConcern` beschreiben den Stand vor Phase 13D. Seit 13D werten
> `applyHarmlessSeverityReduction()` (`reduceSeverity`, Abbildung `SEVERITY_REDUCTION_MAP`),
> `isHarmless()` (`minCountForConcern`, `onlyHarmlessIfNoCorrelation`) und die beiden
> generischen Korrelationstypen `timeBurst`/`groupBySource` (`affectsScore: false`) diese Felder aus.
>
> **Korrekturschritt Regeln und Darstellung:** Der Eintrag für Windows Update gilt jetzt für die
> ID 19 (erfolgreiche Installation); die ID 20 ist laut Herstellerdokumentation ein Installationsfehler
> (`VISTA_MSG_INSTALL_FAILED`) und nicht harmlos.

`eventIds`/`sources` sind hier – anders als bei den Correlation-Conditions –
technisch immer genau einwertig (jeder Eintrag hat exakt eine Event-ID und
höchstens eine Quelle), die Array-Form ist reine Konsistenz mit dem übrigen
Schema, keine neue Mehrfachwert-Fähigkeit wird dadurch fachlich genutzt.

## 5. Recommendations (gemeinsame Struktur in allen drei Regeldateien mit Empfehlungen)

```jsonc
{
  "text": "...",
  "cmd": "...",       // optional
  "link": "...",      // optional, nur ein Vorkommen im gesamten Datenbestand
  "type": "diagnose" | "fix" | "maintenance",
  "risk": "low" | "medium" | "high"
}
```
Unverändert in Phase 13B.

## 6. Collector-Datenvertrag (offiziell dokumentiert, unverändert)

Die Collector-Skripte (`Get-EventLogCollector-Client.ps1` /
`-Server.ps1`) erzeugen und der Analyzer erwartet **PascalCase** als
offiziellen Standard:

```jsonc
{
  "Metadata": { "ComputerName": "...", "OS": "...", "...": "..." },
  "Summary":  { "Critical": 0, "Error": 0, "Warning": 0, "Info": 0, "Total": 0 },
  "Events": [
    {
      "TimeCreated": "2026-09-15T08:00:00",
      "Id": 1000,
      "Level": "Error",
      "LogName": "Application",
      "ProviderName": "...",
      "Category": "...",
      "Message": "..."
    }
  ]
}
```

`eventlog.html` akzeptiert zusätzlich lowercase (`data.Metadata || data.metadata`,
ebenso für `Summary`/`Events`) als **Legacy-Fallback** – dieser Fallback wird
in Phase 13B nicht entfernt. Das Event-Objekt-Feld `Id` wird **nicht** in
`EventId` umbenannt (kein Rename am Collector-Format in dieser Phase).

## 6b. Eingabe-Normalisierung (Sicherheitskorrektur der Ereignisdarstellung)

Die hochgeladene JSON gilt als nicht vertrauenswürdig: Ereignisfelder enthalten Text, den Dritte
kontrollieren (Benutzernamen, Providernamen, Meldungstexte). `normalizeCollectorData(raw)` in
`eventlog.html` bringt die Datei deshalb **vor jedem anderen Zugriff** auf das Erwartbare und liefert
`{ data: { Metadata, Summary, Events }, report: { skippedEvents, fixedFields } }`. Gültige
Collector-Dateien bleiben dabei unverändert. Ausgegeben werden Ereigniswerte zusätzlich ausschließlich
per `textContent`; die Normalisierung ist die zweite, unabhängige Schutzschicht.

| Bereich | Regel |
|---|---|
| Datei | Kein JSON-Objekt, kein `Events`-Feld oder `Events` keine Liste: Fehlermeldung "Fehler beim Lesen: …", keine Darstellung (kein `alert`, keine halb gerenderte Oberfläche, Reste eines früheren Uploads werden entfernt) |
| `Events[]` | Nur Objekte; alles andere wird übersprungen (`skippedEvents`) |
| `Id` | Ganze Zahl 0 bis 4294967295. Zahlentext wird umgewandelt (`fixedFields`); HTML, Objekt, Liste, leer, Bruch oder negativ: das Ereignis wird übersprungen |
| `Level` | Erlaubt: `Critical`, `Error`, `Warning`, `Info`, `Information`, `Fehler`, `Kritisch`, `Warnung`. Alles andere (auch fehlend) wird zu `Unbekannt` (`fixedFields`). Der Collector liefert `Info`; `Information` kommt in älteren Exporten vor, beide zählen als Info (siehe Abschnitt "Level-Schlüssel") |
| Text (`TimeCreated`, `LogName`, `ProviderName`, `Category`, `Message`) | Text bleibt; Zahl oder Boolean wird zu Text, Objekt oder Liste zu leerem Text (`fixedFields`); `null` bleibt `null` |
| Unbekannte Ereignisfelder | werden nicht übernommen |
| `Metadata` | Nur bekannte Felder: Texte (`ComputerName`, `OS`, `BuildNumber`, …), Zahlen (`HoursCollected`, `RAM_GB`, `RAM_Used_GB`, `Uptime_Hours`, `AutostartCount`; Zahlentext wird umgewandelt, sonst verworfen), `DefenderRealtime` (nur Boolean oder `null`), `DetectedRoles` (Liste einfacher Werte als Text), `Disks` (nur `DeviceID`, `Size_GB`, `Free_GB`; ein einzelnes Objekt statt Liste ist der bekannte PowerShell-Fall und kein Fehler), `SecurityProtection` (`source`, `protectionStatus`, `providers[]` mit `name`, `type`, `state`) |
| `Summary` | Nur `Critical`, `Error`, `Warning`, `Info`, `Total` als Zahlen |
| Anzeige des Ergebnisses | Der Hinweis "n Ereignisse mit ungültigen Feldern übersprungen, m Felder bereinigt" erscheint nur, wenn etwas geändert wurde (`#el-normalize-note`) |

**Level-Schlüssel (Korrekturschritt Regeln und Darstellung):** `levelKey()` bildet `Info` auf den Schlüssel
`Information` ab. Pill "Info" (Zählung), Klick auf den Pill und `filterEvents()` benutzen denselben Schlüssel,
damit die Zählung und die angezeigten Zeilen übereinstimmen.

## 6a. Security Protection – `Metadata.SecurityProtection` (neu in Phase 13C)

Additive Erweiterung des Collector-Vertrags aus Abschnitt 6 – kein Rename,
kein Breaking Change. Fehlt das Feld (ältere Collector-JSON-Dateien vor
Collector-Version 1.4/1.3), verhält sich der Analyzer exakt wie vorher:
`protectionStatus` gilt dann implizit als `"unknown"`, niemals als `"none"`.

**Zweck:** `DefenderRealtime: false` bedeutet nicht automatisch "kein
Virenschutz" – ein System kann bewusst einen anderen Endpoint-Schutz
verwenden (ESET, Bitdefender, Sophos, SentinelOne, CrowdStrike, Trend Micro
u.a.). `SecurityProtection` bildet die tatsächliche, produktunabhängige
Schutzlage ab.

**Quelle:** WMI-Namespace `root\SecurityCenter2`, Klasse `AntiVirusProduct` –
dieselbe Datenquelle, aus der auch das Windows Sicherheitscenter (Action
Center) seine Anzeige "Viren- und Bedrohungsschutz" speist. Das ist eine
etablierte Windows-Provider-Information, **kein Raten anhand von
Prozessnamen**. Ergänzend/als Fallback: `Get-MpComputerStatus` (offiziell von
Microsoft dokumentiertes Cmdlet) für den Defender-eigenen Status.

```jsonc
{
  "Metadata": {
    "...": "...",
    "SecurityProtection": {
      "source": "SecurityCenter2",        // "SecurityCenter2" | "DefenderOnly" | "unavailable"
      "providers": [
        { "name": "Windows Defender",        "type": "defender",   "state": "inactive" },
        { "name": "ESET Endpoint Security",  "type": "thirdParty", "state": "active"   }
      ],
      "protectionStatus": "active"          // "active" | "none" | "unknown"
    }
  }
}
```

| Feld | Bedeutung |
|---|---|
| `source` | `SecurityCenter2` = vollständige Provider-Liste verfügbar (Windows-Client-SKUs). `DefenderOnly` = SecurityCenter2 nicht verfügbar (typisch: Windows Server), nur der offiziell dokumentierte Defender-Status ist bekannt. `unavailable` = keine Aussage möglich (weder SecurityCenter2 noch Defender-Cmdlet lieferten ein Ergebnis). |
| `providers[].name` | Vom Provider selbst gemeldeter Produktname (`displayName`), keine geratene Zuordnung. |
| `providers[].type` | `defender` oder `thirdParty` – Unterscheidung ausschließlich anhand des vom Provider selbst gemeldeten Namens, keine feinere AV/EDR-Klassifizierung (siehe Design-Entscheidung unten). |
| `providers[].state` | `active` oder `inactive` – Best-effort-Interpretation des von Microsoft nicht offiziell dokumentierten `productState`-Bitmasks (Bit `0x1000`), seit Jahren in der Windows-Admin-Community etabliertes Verfahren. |
| `protectionStatus` | `active` = mindestens ein Provider aktiv (Defender oder Drittanbieter, auch bei mehreren Providern – die Anzahl ergibt sich aus der Länge von `providers`, kein eigener Status dafür nötig). `none` = SecurityCenter2 konnte ALLE registrierten Provider abfragen, keiner ist aktiv – belastbare Aussage. `unknown` = keine ausreichende Datenlage (z.B. Server ohne SecurityCenter2 und Defender inaktiv/nicht lesbar) – **es wird nie aus fehlenden Daten auf "kein Schutz" geschlossen**. |

**Design-Entscheidung (bewusste Vereinfachung ggü. der ursprünglichen Skizze):**
Auf ein granulareres `type: "antivirus"|"edr"|"endpoint"` wurde verzichtet,
da SecurityCenter2 diese Unterscheidung nicht liefert und eine Zuordnung nur
über eine gepflegte Produktnamen-Liste möglich wäre – das wäre wieder "raten"
und pro Hersteller wartungsintensiv. `defender`/`thirdParty` ist die einzige
Unterscheidung, die sich direkt und zuverlässig aus der Datenquelle ergibt.

## Ausdrücklich unverändert in Phase 13B / 13C

Rule-IDs, Severity-Werte (die Originalwerte `rule.severity` selbst – zur
*angezeigten* Severity siehe Phase 13D unten), Schwellenwerte (Zahlenwerte
selbst, mit Ausnahme der in Phase 13C bewusst auf eine 24h-Rate normierten
`errorCount`/`appCrashCount`-Checks, siehe Abschlussbericht Phase 13C),
Correlation-Algorithmen (AND/OR/groupByProcess/timeBurst/groupBySource – die
grundsätzliche Match-Logik, nicht die Score-Formel, siehe Phase 13D),
Kategorie-Taxonomie, Event-Rule-Engine (Matching-Logik in `analyzeEvents()`),
Collector-Output-Felder (additive Erweiterung um `Metadata.SecurityProtection`
ausgenommen, siehe 6a).

**Hinweis:** Correlation-Score-Berechnung, Harmless-Auswertungslogik
(`isHarmless()`) und Priorisierungslogik (`renderPriority()`) wurden in
**Phase 13D** gezielt gehärtet (siehe folgender Abschnitt) – die Aussage
"unverändert" bezog sich auf den Stand nach 13B/13C und gilt für diese drei
Bereiche nicht mehr uneingeschränkt fort.

## Phase 13D – Rule Engine & Root-Cause-Härtung

Ziel dieser Phase: die Ebenen Event → Finding → Correlation → Recommendation
sowie die parallelen Ebenen System-Metadata → Improvement und Known-Harmless →
Modifikator sauber trennen, ohne bestehende korrekte Ergebnisse unnötig zu
verändern. Details und Begründungen siehe Abschlussbericht Phase 13D; dieser
Abschnitt dokumentiert den resultierenden Datenvertrag/die Semantik.

### Known Harmless – `isHarmless(event, allEventsForContext)`

Liefert jetzt immer ein strukturiertes Ergebnis statt "Match-Objekt oder
null":

```jsonc
{
  "matched": true,           // true, wenn eine Harmless-Regel überhaupt zutrifft
  "rule": { /* der komplette Harmless-Eintrag aus known-harmless.json */ },
  "harmless": true,          // Endergebnis nach allen Modifikatoren
  "reason": "...",
  "reduceSeverity": false,
  "affectsScore": true,
  "thresholdReached": false
}
```

Bei keinem Match: `{ matched: false, harmless: false }`.

- **`minCountForConcern`** (Abschnitt 5): wird jetzt tatsächlich durchgesetzt.
  Zählt, wie oft ein Event über den gesamten `allEventsForContext`-Datensatz
  (nicht nur die aktuell gefilterte Ansicht) auf dieselbe Harmless-Regel
  matcht. Ab Erreichen der Schwelle: `harmless:false`,
  `thresholdReached:true`. Ohne zweiten Parameter (Legacy-Aufrufe) wird die
  Schwelle bewusst nicht geprüft – kein Absturz, keine Fehlklassifikation.
- **`onlyHarmlessIfNoCorrelation` + `correlationIds`**: unverändert (Kontext-
  Awareness über `_corrResults`), jetzt Teil des strukturierten Ergebnisses.
- **`reduceSeverity`**: siehe `applyHarmlessSeverityReduction()` unten.
- **`affectsScore`**: siehe Correlation-Score-Abschnitt unten.

### `reduceSeverity` → `effectiveSeverity` (Abschnitt 7)

Feste Mapping-Treppe (keine dynamische Berechnung):

| `rule.severity` | `effectiveSeverity` bei `reduceSeverity:true` |
|---|---|
| critical | warning |
| error | info |
| warning | info |
| info | info |

`applyHarmlessSeverityReduction(findings, allEventsForContext)` läuft nach
`correlateEvents()` (benötigt `_corrResults` für die Kontext-Awareness) und
setzt `finding.effectiveSeverity`, **ohne** `rule.severity` zu verändern. Ein
Finding wird nur abgeschwächt, wenn **alle** seine gematchten Events durch
eine aktive `harmless && reduceSeverity`-Klassifikation gedeckt sind. Anzeige
(Findings-Karten, Priorisierung) verwendet `effectiveSeverity ?? rule.severity`;
Rohdaten/Exports der Rule-Definition bleiben unangetastet. Aktuell haben alle
29 Harmless-Einträge `reduceSeverity:false` – der Mechanismus hat auf die
bestehenden Daten daher **keine sichtbare Auswirkung**, ist aber vorhanden und
getestet (siehe `tests/eventlog-engine.test.html`).

### `affectsScore` (Abschnitt 8)

Bewusst **eng** angewendet: nur die beiden generischen "Rauschvolumen"-
Correlation-Typen `timeBurst` und `groupBySource` schließen Events aus, die
`isHarmless(event, events).harmless && !affectsScore` sind – sie zählen die
generische Critical/Error-Menge, unabhängig von konkreten Event-IDs. Die
ID-/Bedingungs-spezifischen Typen `groupByProcess` und `correlation`
(AND/OR) filtern **nicht**, da eine künftige oder bestehende Regel eine
Event-ID absichtlich gezielt auswerten können muss, auch wenn dieselbe ID in
`known-harmless.json` steht (Vorgabe: "Es muss möglich bleiben, dass eine
andere Regel/Correlation dasselbe Event benötigt"). Events werden dabei
**nicht** aus `events` gelöscht – die Filterung passiert nur lokal innerhalb
der beiden betroffenen Correlation-Typ-Blöcke.

**Bekannte Verhaltensänderung:** `SINGLE_SOURCE_ERROR_FLOOD` (groupBySource)
kann für Datensätze, die zusätzlich ein `affectsScore:false`-Event enthalten
(z.B. `KERNEL_POWER_41`, Event-ID 41), einen leicht höheren Score liefern als
vor Phase 13D, weil dieses Event nicht mehr in den Nenner der
Dominanzberechnung einfließt. Siehe Abschlussbericht Phase 13D, "Vorher/
Nachher".

### Finding-Threshold ≠ Harmless-Threshold (Abschnitt 10)

Zwei konkrete, in der Analysephase gefundene Zahlenpaare wurden untersucht:

| Event | Finding-Schwelle | Harmless-Schwelle (`minCountForConcern`) | Bewertung |
|---|---|---|---|
| 1014 (DNS-Timeout) | `DNS_FAIL_1014`: 3 Vorkommen | 5 Vorkommen | **Bewusst unterschiedlich, nicht harmonisiert.** Die Finding-Schwelle beantwortet "tritt DNS-Timeout gerade gehäuft/relevant auf" (niedrige Reaktionsschwelle, damit eine beginnende Häufung früh sichtbar wird), die Harmless-Schwelle beantwortet "ist die GESAMT-Anzahl im analysierten Zeitraum niedrig genug, um es pauschal als Boot-Rauschen abzutun" (bewusst höhere, konservativere Schwelle). Beide können gleichzeitig zutreffen (z.B. 3–4 Vorkommen: Finding aktiv, Event individuell noch als "meist harmlos" markiert) – das ist kein Widerspruch, sondern zwei verschiedene Fragen an dieselben Rohdaten. |
| 4625 (fehlgeschlagene Anmeldung) | `ACCOUNT_LOCKOUT_REPEATED`: 3 Vorkommen (kombiniert über 4740+4625) | 10 Vorkommen (nur 4625 einzeln) | **Bewusst unterschiedlich, nicht harmonisiert.** Die Finding-Schwelle zählt eine KOMBINIERTE, niedrigere Menge (bereits 2×4625 + 1×4740 lösen aus – ein Muster, das auf einen aktiven Sperr-Vorgang hindeutet), die Harmless-Schwelle zählt AUSSCHLIESSLICH isolierte 4625-Ereignisse ohne jede Sperrung – vereinzelte Tippfehler beim Passwort sind bei bis zu 10 Vorkommen weiterhin normal. Unterschiedliche Fragestellungen, unterschiedliche Zahlenbasis (kombinierte ID-Menge vs. einzelne ID). |

Vorgabe befolgt: "Nicht automatisch eine der Zahlen angleichen" – beide Fälle
wurden als fachlich unterschiedliche, nicht-widersprüchliche Aussagen
identifiziert und bewusst unverändert gelassen.

### Correlation Score – Normalisierung (Abschnitt 12/13)

Jeder der vier Correlation-Typen berechnet weiterhin seinen eigenen
`rawScore` mit seiner spezifischen Formel (unverändert). Neu:
`normalizeCorrelationScore(rawScore)` rundet und deckelt **einheitlich** auf
`[0, 98]` für alle vier Typen. Vorher deckelten `groupByProcess`/
`groupBySource`/`correlation` bereits bei 98, `timeBurst` aber erst bei 100 –
diese Inkonsistenz ist behoben. 98 (nicht 100) bleibt bewusst die Obergrenze,
damit nie ein Wert erscheint, der als "100% sicher" gelesen werden könnte.

Der Score ist und bleibt eine **interne Konfidenz-/Relevanzbewertung**, keine
mathematische Wahrscheinlichkeit. UI zeigt weiterhin nur die Zahl (mit
Tooltip "Konfidenz-Score der Correlation-Engine (heuristischer Wert)"), nie
mit "%"-Suffix. Der Export verwendet `confidenceScore` (Zahl, kein
String mit "%") statt des vorherigen `score: "87%"` – die vorherige
%-Formatierung im Export suggerierte fälschlich eine Wahrscheinlichkeit.

### `correlateEvents(events)` (Abschnitt 14)

Der zweite Parameter `findings` wurde ersatzlos entfernt – ein Audit des
gesamten Funktionskörpers ergab keine einzige Verwendung. Aufrufer:
`correlateEvents(events)`.

### Root-Cause-Konsolidierung (Abschnitt 11, Option A gewählt)

Die vormals hartkodierte, separate `ROOT_CAUSE_CHAINS`/`detectChains()`-
Mechanik (reine "kommen alle X Event-IDs irgendwo im Datensatz vor"-Prüfung,
ohne Score, nur als Timeline-Banner sichtbar) wurde vollständig entfernt:

- 3 der 4 Chains dupliziereten bereits bestehende, besser parametrisierte
  Correlation-Regeln mit echten `minCount`-Schwellen: "Login-Flood →
  Kontosperrung" (`ACCOUNT_LOCKOUT_PATTERN`/`SECURITY_BRUTE_FORCE`),
  "WLAN-Drop → AAD-Fehler" (`WLAN_DROP_AAD_CASCADE`), "AAD Token-Fehler →
  App-Absturz" (`AAD_TOKEN_AND_SERVICE_CRASH`).
- Die eine fachlich neue Chain ("DNS-Fehler → Login-Fehler", ein dritter Hop
  über die bestehende `KERBEROS_DC_DNS_PROBLEM`-Correlation hinaus) wurde als
  reguläre Correlation-Regel `DNS_DC_LOGIN_CHAIN` in `correlation-rules.json`
  übernommen (`type:"correlation"`, `operator:"AND"`, 3 Bedingungen
  `eventIds:[1014]`/`eventIds:[5719],sources:["NETLOGON"]`/`eventIds:[4625]`,
  je `minCount:1` – exakt die ursprüngliche Chain-Semantik).

Ergebnis: nur noch **eine** Quelle für Correlations/Root-Cause-Muster
(`data/correlation-rules.json`), mit echter Score-Berechnung statt einer
reinen Ja/Nein-Bannerprüfung.

### Priorisierung (Abschnitt 2/3)

`renderPriority(findings, correlations, meta, sum)` (Signatur erweitert um
`correlations`). Der frühere hartkodierte Rule-ID-Allowlist-Ansatz (u.a. mit
zwei nachweislich toten Prüfungen, siehe Abschlussbericht Phase 13D) wurde
durch einen generischen, severity-basierten Scan ersetzt:

1. Findings mit `effectiveSeverity === 'critical'`
2. Correlations mit `severity === 'critical'`
3. Findings mit `effectiveSeverity === 'error'`
4. Correlations mit `severity === 'error'`
5. Wesentliche Systemzustände direkt aus Metadata/Summary (niedriger
   Speicherplatz, viele Gesamt-Fehler, hohe Uptime) – unverändert aus 13C.

Improvements fließen **nicht** ein (Vorgabe Abschnitt 3/17) – ein
info-Improvement erscheint nie als kritischer Prioritäts-Schritt.

### Event-Überlappungen (Abschnitt 15)

Keine pauschale Deduplication eingeführt. Mehrere Findings für dieselbe
Event-ID (z.B. 1000 in `APP_CRASH_1000`/`OFFICE_RDS_LICENSE`, 7031/7034 in
`SERVICE_CRASH`/`SERVICE_TIMEOUT_CHAIN`/`RAM_PRESSURE_SERVICE_CRASH`, 5719 in
mehreren Netzwerk-Regeln) bleiben bestehen, da unterschiedliche Kontext-
Bedingungen (Source, Kombination mit anderen IDs) unterschiedliche,
legitime Ursachenhypothesen darstellen. Correlations fassen bereits heute
zusammenhängende Muster zusammen (z.B. `DISK_AND_SYSTEM_ERRORS` für
7000/7001/7023/7031 in Kombination mit Disk-Fehlern); eine tiefergehende
"UI erklärt Zusammenhänge zwischen Findings" bleibt ein offener Punkt für
eine spätere Phase (siehe Abschlussbericht Phase 13D, "Offene Punkte").

### Recommendation-Semantik (Abschnitt 16)

Klarstellung ohne Code-/Datenänderung: `type: "fix"` bedeutet "vorgeschlagene
Maßnahme zur Behebung/Änderung", **nicht** "Problem nach Ausführung
garantiert behoben". Die Risiko-Einstufung (`risk: low/medium/high`) bleibt
die primäre Sicherheitsleitplanke; sie wurde für alle Improvement-
Recommendations stichprobenartig gegengeprüft (siehe Abschlussbericht Phase
13D) – destruktive/weitreichende Befehle (`DISM ...ResetBase`, erzwungene
Neustarts) sind bereits durchgängig korrekt als `risk:"high"` markiert.

## Build-Aktualität (Systemübersicht, nur auf Klick)

Zusatzfunktion in der Systemübersicht: eine Kachel "📦 Build-Aktualität" direkt
unter "🖥️ Betriebssystem" (`buildBuildFreshnessTile()` in `eventlog.html`),
die `meta.BuildNumber` gegen die aktuell bekannten Windows-Build-Generationen
abgleicht.

- **Datenquelle:** `https://endoflife.date/api/windows.json` – eine freie,
  öffentliche, community-gepflegte JSON-API (**nicht** offiziell Microsoft),
  live per `fetch()` erreichbar (kein CORS-Problem, kein Backend nötig,
  verifiziert). Aus allen `latest`-Feldern wird eine absteigend sortierte,
  deduplizierte Liste aller je bekannten Build-Nummern gebildet.
- **Auslösung:** ausdrücklich **nur auf Klick** (Nutzerentscheidung) – kein
  automatischer Request beim Laden der Seite. Ergebnis wird 24h in
  `localStorage` gecacht, damit wiederholte Klicks nicht jedes Mal erneut
  anfragen.
- **Berechnung:** "Generationen zurück" = Anzahl der bekannten Build-Nummern,
  die größer als `meta.BuildNumber` sind. Der Collector erfasst nur die
  Feature-Update-Build-Nummer, nicht die monatliche UBR-Patch-Revision –
  gezählt werden daher Feature-Update-Generationen (23H2→24H2→25H2→…), keine
  Cumulative-Update-Stände.
- **Ampel:** 0 = 🟢 "Aktuell", 1–5 = 🟡 "N Feature-Update(s) veraltet", ≥6 =
  🔴 "N Feature-Updates veraltet".
- **Unbekannt (grau, kein Ampelfarbwechsel):** wenn `meta.BuildNumber` fehlt
  (Button deaktiviert, kein Klick möglich) oder der Live-Abgleich fehlschlägt
  (offline/API nicht erreichbar – erneuter Klick möglich). Es wird nie aus
  einem fehlgeschlagenen Abgleich auf "veraltet" geschlossen.
- Sendet **keine** Event-/Kunden-/Metadaten an endoflife.date – nur die
  öffentliche Build-Liste wird abgerufen.
