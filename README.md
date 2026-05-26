# support.sheet

Interaktives Nachschlagewerk für IT-Admins und MSP-Techniker.  
Befehle suchen, filtern, per Klick kopieren – komplett im Browser, kein Backend, kein Login.

🔗 **[→ https://jluenthus.github.io/support.sheet](https://jluenthus.github.io/support.sheet)**

---

## Was ist drin?

| Seite | Inhalt | Commands |
|-------|--------|----------|
| [Windows](index.html) | CMD, PowerShell, MSC-Konsolen, AD, Event Logs, Drucker | 127 |
| [Exchange](exchange.html) | On-Premises 2016/2019 & Exchange Online | 45 |
| [Fortinet](forti.html) | FortiGate, FortiManager, FortiAnalyzer CLI | 78 |
| [PS Scripts](scripts.html) | Fertige .ps1 Skripte zum Download | 7 |
| [Log Analyzer](eventlog.html) | Event Log JSON hochladen → automatische Analyse | – |
| [Mitmachen](mitmachen.html) | Commands einreichen, Feedback geben | – |
| [support.tools](tools.html) | Einstellungen, Backup/Restore, PWA, Cache | – |

---

## Features

- **Suche** – Fuzzy-Suche über alle Commands (Ctrl+K)
- **Kategorie-Filter** – Filter-Bar mit einem Klick
- **Favoriten** – Stern klicken, bleibt gespeichert
- **Zuletzt verwendet** – automatisch als Filter-Tag verfügbar
- **Variable Commands** – `{domain}`, `{server}`, `{username}` werden per Dialog ersetzt
- **Einstellungen** – Default-Werte einmalig speichern, werden automatisch vorbelegt
- **Backup/Restore** – Favoriten und Einstellungen als JSON exportieren/importieren
- **PWA** – als App installierbar, funktioniert offline
- **Event Log Analyzer** – Collector-Script ausführen, JSON hochladen, Fehlermuster werden automatisch erkannt

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
| `data/commands.json` | Windows-Commands |
| `data/exchange-commands.json` | Exchange-Commands |
| `data/forti-commands.json` | Fortinet-Commands |
| `data/eventlog-rules.json` | Log Analyzer Erkennungsregeln |

Mehr dazu in [docs/adding-commands.md](docs/adding-commands.md).

---

## Variable Commands

Platzhalter in geschweiften Klammern werden beim Kopieren per Dialog ersetzt:

```json
"cmd": "Unlock-ADAccount -Identity '{username}'"
```

`{domain}`, `{server}` und `{username}` werden automatisch aus den gespeicherten Einstellungen vorbelegt (support.tools).

---

## Deployen

Nach jedem Push auf `main` aktualisiert sich GitHub Pages automatisch.

Wichtig: nach Änderungen die `CACHE_VERSION` in `sw.js` aktualisieren damit Nutzer mit gecachter Version den Update-Hinweis bekommen:

```js
const CACHE_VERSION = '20260526-0900';
```

---

## Projektstruktur

```
support.sheet/
├── index.html / exchange.html / forti.html / scripts.html
├── eventlog.html / mitmachen.html / tools.html
├── nav.js              ← Navigation (alle Seiten)
├── sw.js               ← Service Worker (Offline-Cache)
├── css/                ← Styles
├── js/                 ← Feature-Module
│   ├── settings-store.js   ← getSettings() – geteilt
│   ├── loader.js / render.js / search.js
│   ├── variables.js / favorites.js / recent.js
│   ├── toast.js / tools.js
├── data/               ← Commands als JSON
├── powershell/         ← .ps1 Skripte
└── docs/               ← Projektdokumentation
```

Ausführlichere Dokumentation: [docs/](docs/)

---

## localStorage

| Key | Inhalt |
|-----|--------|
| `adminsheet_favorites` | Gespeicherte Favoriten |
| `adminsheet_recent_commands` | Zuletzt verwendete Commands |
| `supportsheet_settings` | Einstellungen (Domain, Server, Username) |

Alle Daten bleiben lokal auf dem Gerät. Kein Backend, kein Cloud-Sync.

---

## Lizenz

Frei verwendbar für private und kommerzielle Zwecke.  
Kein Gewähr für die Korrektheit der Befehle – immer in einer Testumgebung prüfen.
