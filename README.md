# support.sheet

Interaktives Nachschlagewerk für IT-Admins und MSP-Techniker.  
Befehle suchen, filtern, per Klick kopieren – komplett im Browser, kein Backend, kein Login.

🔗 **[→ https://jluenthus.github.io/support.sheet](https://jluenthus.github.io/support.sheet)**

---

## Was ist drin?

| Seite | Inhalt | Commands |
|-------|--------|----------|
| [Windows](index.html) | CMD, PowerShell, MSC-Konsolen, AD, Netzwerk, DHCP, Hyper-V, RDS, Zertifikate, Winget u.v.m. | 185 |
| [Exchange](exchange.html) | On-Premises 2016/2019 & Exchange Online | 45 |
| [Fortinet](forti.html) | FortiGate, FortiManager, FortiAnalyzer CLI | 78 |
| [PS Scripts](scripts.html) | Fertige .ps1 Skripte zum Download | 9 |
| [Log Analyzer](eventlog.html) | Event Log JSON hochladen → automatische Analyse mit Correlation Engine | – |
| [Mitmachen](mitmachen.html) | Commands einreichen, Feedback geben | – |
| [support.tools](tools.html) | Einstellungen, Backup/Restore, PWA, Dokumentation | – |

---

## Features

- **Suche** – Fuzzy-Suche über alle Commands (Ctrl+K)
- **Kategorie-Filter** – 20 Kategorien, Filter-Bar mit einem Klick
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
| `data/commands.json` | Windows-Commands (185) |
| `data/exchange-commands.json` | Exchange-Commands (45) |
| `data/forti-commands.json` | Fortinet-Commands (78) |
| `data/eventlog-rules.json` | Log Analyzer Erkennungsregeln |
| `data/correlation-rules.json` | Correlation Engine Regeln (19) |
| `data/improvement-rules.json` | Proaktive Systemchecks (12) |
| `data/known-harmless.json` | Bekannte harmlose Events |

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
├── index.html / exchange.html / forti.html / scripts.html
├── eventlog.html / mitmachen.html / tools.html
├── nav.js              ← Navigation (alle Seiten)
├── sw.js               ← Service Worker (Offline-Cache)
├── fonts/              ← Lokal gehostete Schriften (DSGVO-konform)
├── css/                ← Styles
├── js/                 ← Feature-Module
│   ├── settings-store.js   ← getSettings() – geteilt
│   ├── loader.js / render.js / search.js
│   ├── variables.js / favorites.js / recent.js
│   ├── toast.js / tools.js / fuse.min.js
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
Kein Gewähr für die Korrektheit der Befehle – immer in einer Testumgebung prüfen.
