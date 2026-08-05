# Getting Started

## Was ist support.sheet?

support.sheet ist ein internes Nachschlagewerk für IT-Admins und MSP-Techniker.  
Im Kern (**commands.sheet**) findest du Windows-Befehle, Exchange-PowerShell, Fortinet-CLI-Kommandos und fertige Skripte – alles auf einen Klick kopierbar.

Daneben gibt es ein paar weitere Bereiche, kurz zusammengefasst:

- **Ticketassistent** – KI-gestützter Assistent, der beim Formulieren von Tickets hilft.
- **guide.sheet** – deine persönliche, lokale IT-Wissensdatenbank für eigene Guides und How-Tos.
- **Analyzer** (Log Analyzer, Entra Analyzer, HAR Analyzer) – lädt Logs/Exports hoch und wertet sie automatisch nach Regeln aus.
- **Privater Bereich** – kein öffentlicher Teil des Repos, sondern ein privat eingebundener Bereich, den man auf Anfrage bekommt.

Das Projekt läuft komplett im Browser. Es gibt keinen zentralen Server, keine Datenbank, kein Login.  
Alle Daten (Favoriten, Einstellungen, Guides) werden lokal auf deinem Gerät gespeichert.

---

## Für wen ist das?

Für jeden der regelmäßig mit Windows-Servern, Exchange, Active Directory oder Fortinet arbeitet und keine Lust hat, jedes Mal in alten Notizen zu suchen.

Auch Kollegen ohne Entwicklungserfahrung können Commands einreichen oder die Seite offline nutzen.

---

## Lokal starten

Du brauchst keinen Node, kein npm, kein Build-System. Ein einfacher lokaler Webserver reicht.

**Option 1 – Python (empfohlen):**
```bash
cd /pfad/zum/projekt
python -m http.server 8080
```
Dann im Browser: `http://localhost:8080`

**Option 2 – VS Code Live Server:**  
Rechtsklick auf `index.html` → "Open with Live Server"

**Warum überhaupt ein Webserver?**  
Weil der Browser `fetch()` Aufrufe von `file://` blockiert. Die JSON-Dateien in `/data` werden per fetch geladen – ohne lokalen Server funktioniert das nicht.

---

## GitHub Pages

Das Projekt läuft auf GitHub Pages:  
**https://jluenthus.github.io/support.sheet**

Nach jedem Push auf den `main`-Branch ist die Seite automatisch aktualisiert.

Wenn du Änderungen deployst, denk daran die `CACHE_VERSION` in `sw.js` zu aktualisieren:
```js
const CACHE_VERSION = '20260526-0900'; // Datum/Uhrzeit anpassen
```
Nur so bekommen Nutzer mit gecachter Version den Update-Hinweis.

---

## Erste Schritte

1. Repo klonen oder ZIP herunterladen
2. Lokalen Webserver starten (siehe oben)
3. `index.html` im Browser aufrufen – das ist die Startseite mit Kacheln zu allen Bereichen
4. Für Änderungen an Windows-Commands: `/data/commands.json` bearbeiten
5. Änderungen pushen → GitHub Pages aktualisiert sich automatisch

Mehr dazu in [adding-commands.md](adding-commands.md).
