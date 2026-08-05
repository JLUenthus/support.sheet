# Projektstruktur

Kein Build-System, keine versteckten Ordner. Was du siehst ist alles.

```
support.sheet/
│
├── index.html          ← Startseite / Übersicht (Landingpage, verlinkt alle Bereiche)
├── windows.html        ← Windows Admin Commands (Teil von commands.sheet)
├── exchange.html       ← Exchange On-Prem & EXO (Teil von commands.sheet)
├── forti.html          ← Fortinet FG / FMG / FAZ (Teil von commands.sheet)
├── scripts.html        ← PowerShell Script-Bibliothek
├── eventlog.html       ← Log Analyzer
├── entra.html          ← Entra Sign-In Analyzer
├── har.html            ← HAR Analyzer
├── ticketassistent.html← KI-gestützter Ticketassistent
├── guides*.html        ← guide.sheet (Übersicht, Anlegen, Verwalten, Ansicht, How-To)
├── private.html        ← Privater Bereich (siehe „Weitere Bereiche" unten)
├── mitmachen.html      ← Befehle einreichen
├── tools.html          ← Einstellungen, Backup, PWA
│
├── nav.js              ← Navigation (Tab-Leiste, Gruppen-Dropdowns, Logo-Dropdown, Ctrl+K)
├── sw.js               ← Service Worker (Offline-Cache)
├── manifest.json       ← PWA-Konfiguration
│
├── css/
│   ├── main.css        ← Alles Globale: Layout, Design-Tokens, Cards, Buttons
│   ├── search.css      ← Suchfeld im Header
│   ├── toast.css       ← Toast-Benachrichtigungen
│   ├── variables.css   ← Variablen-Modal
│   ├── favorites.css   ← Favoriten-Stern und Favoriten-Section
│   ├── recent.css      ← Zuletzt verwendete Commands
│   ├── tools.css       ← tools.html Seiten-Styles
│   ├── guides.css      ← guide.sheet Seiten-Styles
│   ├── entra.css       ← Entra Analyzer Styles
│   └── har.css         ← HAR Analyzer Styles
│
├── js/
│   ├── loader.js         ← JSON laden und validieren
│   ├── render.js         ← Commands rendern, Kategorie-Gruppen, Filter-Bar
│   ├── search.js         ← Fuzzy-Suche (Fuse.js)
│   ├── variables.js      ← {Variablen} im Befehl erkennen und ersetzen
│   ├── favorites.js      ← Favoriten (localStorage)
│   ├── recent.js         ← Zuletzt verwendet (localStorage)
│   ├── toast.js          ← Benachrichtigungen
│   ├── tools.js          ← Einstellungen, Export, Import
│   ├── settings-store.js ← getSettings() – wird überall gebraucht
│   ├── guides*.js        ← guide.sheet Datenlayer + Seiten-Logik (eigene lokale DB, siehe unten)
│   ├── entra.js, har.js  ← Analyzer-Logik der jeweiligen Seite
│   └── fuse.min.js, marked.min.js, turndown.min.js,
│       mammoth.min.js, jszip.min.js, html-docx.min.js ← lokal eingebundene Bibliotheken
│
├── data/
│   ├── commands.json            ← Windows-Commands
│   ├── exchange-commands.json   ← Exchange-Commands
│   ├── forti-commands.json      ← Fortinet-Commands
│   ├── eventlog-rules.json, improvement-rules.json,
│   │   known-harmless.json, correlation-rules.json ← Regeln für den Log Analyzer
│   ├── entra-rules.json         ← Regeln für den Entra Analyzer
│   └── har-rules.json           ← Regeln für den HAR Analyzer
│
├── powershell/          ← Fertige .ps1 Skripte für scripts.html
│
└── docs/                ← Diese Dokumentation
```

---

## Weitere Bereiche (kurz)

Diese Bereiche haben eigene, teils umfangreichere Logik – hier nur der Überblick, keine Details:

- **Ticketassistent** (`ticketassistent.html`) – KI-gestützter Assistent zum Formulieren von Tickets.
- **guide.sheet** (`guides*.html`, `js/guides-*.js`, `css/guides.css`) – persönliche, lokale Wissensdatenbank mit eigener Datenhaltung (Ordner-Anbindung oder Browser-Datenbank) und eigenem Backup/Restore, getrennt von den Einstellungen in `tools.html`.
- **Analyzer** (`eventlog.html`, `entra.html`, `har.html`) – Log-/Sign-In-/HAR-Analyse: Datei hochladen, automatische Auswertung nach Regeln aus `/data/*-rules.json`.
- **Privater Bereich** (`private.html`) – kein öffentlicher Funktionsbereich des Repos, sondern ein privat eingebundener Bereich, den man auf Anfrage bekommt.

---

## Was liegt wo?

### Commands hinzufügen
Alle Commands liegen in `/data/*.json`.  
Für Windows: `data/commands.json`  
Für Exchange: `data/exchange-commands.json`  
Für Fortinet: `data/forti-commands.json`  

Einfach den passenden JSON-Eintrag ergänzen – kein HTML anfassen nötig.  
Details dazu in [adding-commands.md](adding-commands.md).

### Styles ändern
Design-Variablen (Farben, Abstände, Schriften) stehen ganz oben in `css/main.css` unter `:root { ... }`.  
Wenn du eine Farbe anpassen willst, dort ändern – gilt dann überall.

### Features
Jedes Feature hat eine eigene JS-Datei:
- Such-Logik → `js/search.js`
- Favoriten → `js/favorites.js`
- Einstellungen → `js/tools.js` + `js/settings-store.js`
- Navigation → `nav.js`

### Nicht anfassen ohne Grund
`sw.js` – der Service Worker. Wenn du dort etwas änderst ohne die `CACHE_VERSION` zu erhöhen, bekommen Nutzer keine Updates.  
`nav.js` – baut die komplette Navigation. Kleine Änderungen können die Tab-Leiste auf allen Seiten brechen.
