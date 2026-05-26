# Architektur

Kein Framework, kein Build-Schritt, keine Magie. Das Projekt ist eine Sammlung von HTML-, CSS- und JS-Dateien die zusammenarbeiten.

---

## Wie eine Seite startet

Am Beispiel von `index.html`:

1. Browser lädt `index.html`
2. CSS-Dateien werden geladen (Layout, Farben, Komponenten)
3. JavaScript-Dateien werden in Reihenfolge geladen
4. `render.js` wartet auf `DOMContentLoaded` und startet dann:
   - `loadCommands()` lädt `data/commands.json`
   - Commands werden nach Kategorie gruppiert und als Kacheln gerendert
   - Filter-Bar und Suche werden initialisiert
5. `nav.js` baut Tab-Leiste, Logo-Dropdown und Profil-Status ein

---

## Die JS-Dateien

### `settings-store.js`

Wird als erstes geladen. Enthält nur eine Funktion: `getSettings()`.  
Liest die gespeicherten Einstellungen (Domain, Server, Username) aus localStorage.  
Muss vor `variables.js` geladen sein, damit Variablen-Felder vorbelegt werden können.

### `loader.js`

Lädt die JSON-Datei und gibt ein sauberes Array zurück.  
Validiert dass jeder Command `id`, `name` und `cmd` hat.  
Commands ohne diese Pflichtfelder werden übersprungen.  
Stellt auch `getAllTags()`, `groupByTag()` und `filterByTags()` zur Verfügung.

### `toast.js`

Zeigt kurze Benachrichtigungen unten rechts.  
Wird geladen bevor andere Module die Funktion `showToast()` aufrufen könnten.  
Wenn mehrere Toasts schnell hintereinander kommen, ersetzt der neue den alten – kein Stapeln.

### `variables.js`

Erkennt `{platzhalter}` in einem Befehl und zeigt ein Modal in dem der Nutzer die Werte eingibt.  
Liest bei bekannten Variablen (`{domain}`, `{server}`, `{username}`) Vorschlagswerte aus `getSettings()`.  
Der Nutzer kann die Werte immer überschreiben – nichts ist Pflicht.  
Validiert Eingaben: `&&`, Sonderzeichen die Command Injection ermöglichen könnten, werden abgelehnt.

### `recent.js`

Speichert die zuletzt kopierten Commands in localStorage (max. 5, neueste oben).  
Jeder Eintrag enthält die Herkunfts-Seite (`page`), damit Cross-Page Commands erkannt werden.  
`renderRecent()` aktualisiert nur den Zähler im Filter-Button – die eigentliche Anzeige übernimmt `render.js`.

### `favorites.js`

Speichert Favoriten-IDs in localStorage.  
`isFavorite(cmd)`, `toggleFavorite(cmd)` – damit kann jedes Modul den Favoriten-Status abfragen.  
`renderFavorites(allCommands)` filtert die geladenen Commands nach gespeicherten IDs.

### `search.js`

Fuzzy-Suche auf Basis von Fuse.js.  
Gewichtung: `cmd` (60%) → `tags` (30%) → `desc` (10%).  
`initSearch(commands)` baut den Suchindex auf.  
`runSearch(query)` filtert und rendert. Respektiert den aktiven Kategorie-Filter.  
Der Clear-Button (×) im Suchfeld wird von `search.js` gesteuert.

### `render.js`

Das zentrale Stück. Hier passiert das meiste:

- `CATEGORY_MAP` – definiert Label, Farbe und Icon für jeden Tag
- `getPrimaryTag(cmd)` – findet den ersten bekannten Tag eines Commands
- `renderFilterBar(commands)` – baut die Kategorie-Buttons dynamisch
- `renderCommandGroups(commands)` – gruppiert nach Tag, rendert Section-Header + 3-spaltiges Grid
- `renderCommandGroupsRecent(commands)` – spezielles Render für den Recent-Filter (flach, mit Page-Badge)
- `copyToClipboard()` / `execCommandFallback()` – Clipboard-Handling mit HTTPS/HTTP Fallback

`_allCommands` ist eine Modulvariable die nach dem ersten Laden gesetzt wird und von anderen Modulen genutzt werden kann.

### `tools.js`

Verwaltet die lokale Einstellungs-Seite `tools.html`.  
`saveSettings()` schreibt in localStorage.  
`exportData()` erstellt eine JSON-Datei zum Herunterladen.  
`importData(file)` liest eine Backup-Datei und schreibt die Daten zurück.  
Abhängig von `settings-store.js` für `getSettings()`.

### `nav.js`

Läuft auf jeder Seite und baut die gemeinsame Navigation.  
Setzt eine `page-{id}` Klasse auf `<body>` (für seitenspezifisches CSS wie die H1-Farbe).  
Baut Tab-Leiste, Logo-Dropdown, Profil-Status-Link, Update-Banner und Scroll-to-Top.  
Ctrl+K fokussiert das Suchfeld. ESC leert es.

---

## Datenfluss

```
JSON-Datei (data/*.json)
    ↓
loader.js → loadCommands()
    ↓
render.js → _allCommands gesetzt
    ├── renderFilterBar()     → Kategorie-Buttons
    ├── renderCommandGroups() → Kacheln im Grid
    ├── initSearch()          → Fuse.js Index aufbauen
    └── renderFavorites()     → Favoriten-Section

Nutzer klickt "Kopieren"
    ↓
variables.js → copyWithVariables()
    ├── Keine {variablen} → direkt kopieren
    └── {variablen} gefunden → Modal anzeigen
                                 ↓
                             getSettings() → Felder vorbelegen
                                 ↓
                             Nutzer gibt Werte ein
                                 ↓
                             copyToClipboard(resolved)
                                 ↓
                             addRecent() → localStorage
                             showToast() → "Kopiert!"
```

---

## localStorage

Das Projekt schreibt in drei Keys:

| Key | Inhalt | Schreibt |
|-----|--------|---------|
| `adminsheet_favorites` | Array von Command-IDs | `favorites.js` |
| `adminsheet_recent_commands` | Array von Command-Objekten mit Page-Info | `recent.js` |
| `supportsheet_settings` | Objekt mit defaultDomain, defaultServer, defaultUsername, Tags | `tools.js` |

Kein anderes Modul schreibt in diese Keys. Export und Import laufen über `tools.js`.

---

## Service Worker

`sw.js` cached alle HTML-, CSS-, JS- und JSON-Dateien beim ersten Aufruf.  
Strategie: HTML-Seiten werden immer frisch vom Server geladen (Network First), alles andere kommt aus dem Cache (Cache First).  
Wenn `CACHE_VERSION` sich ändert, löscht der neue Service Worker den alten Cache und holt alles neu.  
Nutzer sehen den grünen Update-Banner wenn ein neuer Service Worker wartet.
