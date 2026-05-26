# Projektstruktur

Kein Build-System, keine versteckten Ordner. Was du siehst ist alles.

```
support.sheet/
│
├── index.html          ← Windows Admin (Hauptseite)
├── exchange.html       ← Exchange On-Prem & EXO
├── forti.html          ← Fortinet FG / FMG / FAZ
├── scripts.html        ← PowerShell Script-Bibliothek
├── eventlog.html       ← Event Log Analyzer
├── mitmachen.html      ← Befehle einreichen
├── tools.html          ← Einstellungen, Backup, PWA
│
├── nav.js              ← Navigation (Tab-Leiste, Logo-Dropdown, Ctrl+K)
├── sw.js               ← Service Worker (Offline-Cache)
├── manifest.json       ← PWA-Konfiguration
│
├── css/
│   ├── main.css        ← Alles: Layout, Design-Tokens, Cards, Buttons
│   ├── search.css      ← Suchfeld im Header
│   ├── toast.css       ← Toast-Benachrichtigungen
│   ├── variables.css   ← Variablen-Modal
│   ├── favorites.css   ← Favoriten-Stern und Favoriten-Section
│   ├── recent.css      ← Zuletzt verwendete Commands
│   └── tools.css       ← tools.html Seiten-Styles
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
│   └── settings-store.js ← getSettings() – wird überall gebraucht
│
├── data/
│   ├── commands.json           ← Alle Windows-Commands (127 Stück)
│   ├── exchange-commands.json  ← Exchange-Commands (45 Stück)
│   ├── forti-commands.json     ← Fortinet-Commands (78 Stück)
│   └── eventlog-rules.json     ← Regeln für den Log Analyzer
│
├── powershell/
│   ├── Get-SystemInventory.ps1
│   ├── Get-LocalAdmins.ps1
│   ├── Test-NetworkConnectivity.ps1
│   ├── Get-InstalledSoftware.ps1
│   ├── Set-PowerPlan-Win11.ps1
│   ├── Get-EventLogCollector-Client.ps1
│   └── Get-EventLogCollector-Server.ps1
│
└── docs/               ← Diese Dokumentation
```

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
