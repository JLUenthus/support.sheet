# support.sheet

Weiterentwicklung meines IT-Admin Cheatsheets für Troubleshooting, Scripts, Eventlog-Analyse und tägliche Support-Aufgaben.

support.sheet ist eine modulare Web-App für den IT-Alltag.  
Entstanden aus persönlichen OneNote-Notizen und typischen Support-Workflows im MSP-Umfeld.

Der Fokus liegt auf:
- schneller Fehlersuche
- wiederverwendbaren Befehlen
- strukturiertem Troubleshooting
- Eventlog-Analyse
- Offline-Nutzung
- einfacher Erweiterbarkeit

---

## Features

- Fuzzy Search mit Fuse.js
- Favoriten-System
- Recently Used Commands
- One-Click Copy
- Variable Commands
- Offline nutzbar als PWA
- Eventlog-Analyse
- JSON-basierte Datenstruktur
- Kein Framework notwendig

---

## Tech Stack

| Bereich | Technologie |
|---|---|
| Frontend | Vanilla JavaScript |
| Suche | Fuse.js |
| Storage | localStorage |
| Offline Support | Service Worker / PWA |
| Rendering | HTML Templates |
| Datenstruktur | JSON |

---

## Projektstruktur

```text
/css
  main.css
  toast.css
  variables.css
  recent.css
  favorites.css
  search.css

/js
  loader.js
  render.js
  toast.js
  variables.js
  recent.js
  favorites.js
  search.js

commands.json
sw.js
manifest.json
index.html
```

---

## Suche

Die Suche basiert auf Fuse.js und unterstützt:
- Tippfehler-Toleranz
- Live-Suche
- Suche über:
  - Commands
  - Beschreibungen
  - Tags

---

## Favoriten

Commands können als Favoriten gespeichert werden.

- Speicherung via localStorage
- Eigene Favoriten-Sektion
- Schneller Zugriff auf häufig genutzte Befehle

---

## Recently Used

Zuletzt verwendete Commands werden automatisch gespeichert:
- maximal 5 Einträge
- keine Duplikate
- neueste oben

---

## Variable Commands

Commands mit Variablen werden dynamisch ausgefüllt.

Beispiel:

```powershell
net user {username} /add
```

Beim Kopieren erscheint ein kleines Modal zur Eingabe der Werte.

---

## Progressive Web App (PWA)

support.sheet kann offline genutzt und installiert werden.

Features:
- Offline verfügbar
- Service Worker Cache
- Installierbar unter Chrome/Edge
- Optimiert für schnelle Nutzung im Support-Alltag

---

## Eventlog Analyzer

Der integrierte Eventlog Analyzer erkennt bekannte Windows-Probleme anhand definierter Regeln und gibt passende Lösungsvorschläge aus.

Beispiele:
- Kernel-Power Abstürze
- DNS Probleme
- AD / Netlogon Fehler
- RDS Lizenzprobleme
- VSS Fehler
- RAM / Disk Probleme

---

## Commands hinzufügen

Neue Commands werden zentral über `commands.json` verwaltet.

Beispiel:

```json
{
  "id": "dns-flush",
  "name": "DNS Cache leeren",
  "cmd": "ipconfig /flushdns",
  "desc": "Leert den lokalen DNS Cache.",
  "tags": ["network", "troubleshooting", "windows"]
}
```

---

## Security

Fokus auf sichere Frontend-Struktur:

- kein unsicheres innerHTML
- dynamische Inhalte via textContent
- JSON Validierung
- sichere externe Links
- defensive localStorage Nutzung

---

## Deployment

### GitHub Pages

1. Repository erstellen
2. Dateien hochladen
3. GitHub Pages aktivieren:
   - Settings
   - Pages
   - Branch: main
   - Root auswählen

Danach erreichbar unter:

```text
https://USERNAME.github.io/support-sheet
```

---

## Service Worker Updates

Nach Änderungen an gecachten Dateien:

```js
const CACHE_VERSION = '20260524-1200';
```

in `sw.js` erhöhen.

Dadurch werden alte Caches automatisch ersetzt.

---

## Ziel des Projekts

support.sheet entstand ursprünglich aus persönlichen IT-Notizen und einem OneNote-Cheatsheet.

Das Ziel:
- häufige Support-Aufgaben schneller lösen
- Wissen zentral bündeln
- Troubleshooting vereinfachen
- wiederkehrende Abläufe standardisieren

---

## Lizenz

Frei nutzbar für private und interne Zwecke.

Keine Gewähr für die Korrektheit der Inhalte – Befehle und Scripts immer zuerst in einer Testumgebung prüfen.
