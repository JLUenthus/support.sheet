# support.sheet

Interaktives Nachschlagewerk für IT-Admins und MSP-Techniker.  
Befehle suchen, filtern, per Klick kopieren – komplett im Browser, kein Backend, kein Login.

Mittlerweile mehr als nur Commands: Log-/Sign-In-/HAR-Analyzer, ein Ticketassistent und guide.sheet für eigene Notizen sind mit drin.

🔗 **[→ https://jluenthus.github.io/support.sheet](https://jluenthus.github.io/support.sheet)**

---

## Was ist drin?

`index.html` ist die Startseite – ein Kachel-Grid, das auf alles unten verlinkt.

| Seite | Inhalt | Commands |
|-------|--------|----------|
| [Windows](windows.html) | CMD, PowerShell, MSC-Konsolen, AD, Netzwerk, DHCP, Hyper-V, RDS, Zertifikate, Winget u.v.m. | 241 |
| [Exchange](exchange.html) | On-Premises 2016/2019 & Exchange Online | 69 |
| [Fortinet](forti.html) | FortiGate, FortiManager, FortiAnalyzer CLI | 78 |
| [PS Scripts](scripts.html) | Fertige .ps1 Skripte zum Download | 9 |
| [Log Analyzer](eventlog.html) | Event Log JSON hochladen → automatische Analyse mit Correlation Engine | – |
| [Entra Analyzer](entra.html) | Sign-In Logs als CSV hochladen, Fehlermuster erkennen | – |
| [HAR Analyzer](har.html) | Browser-Sessions/Auth-Flows aus HAR-Export analysieren | – |
| [Ticketassistent](ticketassistent.html) | KI-gestützt Tickets formulieren | – |
| [guide.sheet](guides.html) | Eigene Guides anlegen und lokal verwalten | – |
| [Mitmachen](mitmachen.html) | Commands einreichen, Feedback geben | – |
| [support.tools](tools.html) | Einstellungen, Backup/Restore, PWA, Dokumentation | – |

Dazu ein privater Bereich (`private.html`) – kein öffentlicher Teil des Repos, den bekommt man auf Anfrage.

Windows, Exchange und Fortinet stehen in der Navigation unter einer gemeinsamen Gruppe (commands.sheet).

---

## Features

- **Suche** – Fuzzy-Suche über alle Commands (Ctrl+K)
- **Kategorie-Filter** – 21 Kategorien, Filter-Bar mit einem Klick
- **Shell-Badge** – CMD / PowerShell / EMS / EXO / Shortcut automatisch erkannt
- **Favoriten** – Stern klicken, bleibt gespeichert
- **Zuletzt verwendet** – Cross-Page, automatisch als Filter verfügbar
- **Variable Commands** – `{domain}`, `{server}`, `{username}` werden per Dialog ersetzt
- **Default-Werte** – einmalig in support.tools speichern, automatisch vorbelegt
- **Backup/Restore** – Favoriten und Einstellungen als JSON exportieren/importieren
- **PWA** – als App installierbar, funktioniert komplett offline
- **Keine externen Abhängigkeiten** – Google Fonts und Fuse.js lokal gehostet, DSGVO-konform

---

## Event Log Analyzer

Collector-Script ausführen → JSON hochladen → automatische Analyse:

- **Systemübersicht** – RAM, CPU, Uptime, Laufwerke mit Farbkodierung
- **🎯 Wahrscheinliche Hauptursachen** – Correlation Engine mit 19 Regeln
- **💡 Optimierungsvorschläge** – 12 proaktive Checks (Defender, BitLocker, PowerPlan, RAM...)
- **Analyseergebnis** – Findings mit gruppierten Empfehlungen (Diagnose / Fix / Wartung)
- **Empfohlene Reihenfolge** – Priorisierungslogik
- **Export** – Findings inkl. Root Causes als JSON

---

## Lokal starten

Kein Build-System, kein npm. Nur ein lokaler Webserver:

```bash
python -m http.server 8080
```

Dann im Browser: `http://localhost:8080`

> Ein Webserver ist nötig weil die JSON-Dateien per `fetch()` geladen werden – `file://` blockiert das.

---

## Commands ergänzen

Alle Commands liegen in `/data/*.json`. Einfach einen Eintrag hinzufügen:

```json
{
  "id": "network-dns-flush",
  "name": "DNS-Cache leeren",
  "cmd": "ipconfig /flushdns",
  "desc": "Lokalen DNS-Cache verwerfen. Nötig nach DNS-Änderungen.",
  "tags": ["network", "windows", "quick"]
}
```

| Datei | Inhalt |
|-------|--------|
| `data/commands.json` | Windows-Commands (241) |
| `data/exchange-commands.json` | Exchange-Commands (69) |
| `data/forti-commands.json` | Fortinet-Commands (78) |
| `data/eventlog-rules.json` | Log Analyzer Erkennungsregeln |
| `data/correlation-rules.json` | Correlation Engine Regeln (19) |
| `data/improvement-rules.json` | Proaktive Systemchecks (12) |
| `data/known-harmless.json` | Bekannte harmlose Events |
| `data/entra-rules.json` | Entra Analyzer Erkennungsregeln |
| `data/har-rules.json` | HAR Analyzer Erkennungsregeln |

Gilt nur für Windows/Exchange/Fortinet. guide.sheet-Einträge legt man über den Editor in `guides-create.html` an, keine JSON-Datei.

Mehr dazu in [docs/adding-commands.md](docs/adding-commands.md).

---

## Variable Commands

Platzhalter in geschweiften Klammern werden beim Kopieren per Dialog ersetzt:

```json
"cmd": "Unlock-ADAccount -Identity '{username}'"
```

`{domain}`, `{server}` und `{username}` werden automatisch aus den gespeicherten Einstellungen vorbelegt (support.tools).

---

## Projektstruktur

```
support.sheet/
├── index.html          ← Startseite / Kachel-Übersicht
├── windows.html / exchange.html / forti.html / scripts.html
├── eventlog.html / entra.html / har.html
├── ticketassistent.html / guides*.html / private.html
├── mitmachen.html / tools.html
├── nav.js              ← Navigation (alle Seiten)
├── sw.js               ← Service Worker (Offline-Cache)
├── fonts/              ← Lokal gehostete Schriften (DSGVO-konform)
├── css/                ← Styles
├── js/                 ← Feature-Module
│   ├── settings-store.js   ← getSettings() – geteilt
│   ├── loader.js / render.js / search.js
│   ├── variables.js / favorites.js / recent.js
│   ├── toast.js / tools.js / fuse.min.js
│   ├── guides*.js          ← guide.sheet, eigene lokale Datenhaltung
│   └── entra.js / har.js   ← Analyzer-Logik
├── data/               ← Commands + Analyzer-Regeln als JSON
├── powershell/         ← 9 fertige .ps1 Skripte
└── docs/               ← Projektdokumentation
```

Ausführlichere Dokumentation: [docs/](docs/)

---

## PowerShell Scripts

| Script | Zweck |
|--------|-------|
| `Get-SystemInventory.ps1` | Vollständiges System-Inventar |
| `Get-LocalAdmins.ps1` | Lokale Admins auflisten |
| `Get-InstalledSoftware.ps1` | Installierte Software exportieren |
| `Test-NetworkConnectivity.ps1` | Netzwerkkonnektivität testen |
| `Set-PowerPlan-Win11.ps1` | Energieplan optimieren |
| `Set-BraveDebloat.ps1` | Brave Browser härten |
| `Get-EventLogCollector-Client.ps1` | Event Logs sammeln (Client) |
| `Get-EventLogCollector-Server.ps1` | Event Logs sammeln (Server) |
| `Exchange-PreflightCheck.ps1` | Exchange vor Neustart prüfen |

---

## localStorage

| Key | Inhalt |
|-----|--------|
| `adminsheet_favorites` | Gespeicherte Favoriten |
| `adminsheet_recent_commands` | Zuletzt verwendete Commands |
| `supportsheet_settings` | Einstellungen (Domain, Server, Username) |

Alle Daten bleiben lokal auf dem Gerät. Kein Backend, kein Cloud-Sync, keine externen Server.

guide.sheet nutzt kein localStorage, sondern eine eigene lokale Datenbank (Ordner-Anbindung oder IndexedDB) mit eigenem Backup – siehe [docs/project-structure.md](docs/project-structure.md).

---

## Deployen

Nach jedem Push auf `main` aktualisiert sich GitHub Pages automatisch.

`CACHE_VERSION` in `sw.js` aktualisieren damit Nutzer mit gecachter Version den Update-Hinweis bekommen:

```js
const CACHE_VERSION = '20260603-0900';
```

---

## Lizenz

Frei verwendbar für private und kommerzielle Zwecke.  
Kein Gewähr für die Korrektheit der Befehle. Immer in einer Testumgebung prüfen.
Bugs und Fehler gerne melden.
