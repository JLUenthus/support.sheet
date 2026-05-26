# Mitmachen

Kein formales Prozess, keine Bürokratie. Aber ein paar Regeln helfen dabei, dass das Projekt wartbar bleibt.

---

## Das Wichtigste vorab

Das Projekt ist absichtlich einfach gehalten. Kein Framework, kein Build-System, kein TypeScript.  
Wer mitmacht, sollte das respektieren – auch wenn man persönlich React oder Vite bevorzugt.

---

## Commands einreichen

Der einfachste Weg mitzumachen: neuen Command vorschlagen.  
Dafür gibt es die Seite `mitmachen.html` – dort kann man Befehle per Mail einreichen, komplett mit JSON-Vorschau.

Wer direkt in die JSON-Datei einträgt: siehe [adding-commands.md](adding-commands.md).

---

## Code-Regeln

### Kein `innerHTML` für dynamische Inhalte

Wenn Daten aus JSON, localStorage oder Nutzereingaben kommen, immer `textContent` verwenden:

```js
// Falsch
element.innerHTML = cmd.name;

// Richtig
element.textContent = cmd.name;
```

Der Grund ist simpel: `innerHTML` mit externen Daten ist ein Sicherheitsproblem.  
Bei statischen Strings (eigene Templates, Icons) ist `innerHTML` in Ordnung.

### Vanilla JS

Keine neuen Bibliotheken einbauen ohne Rücksprache. Das Projekt nutzt bewusst kein Framework.  
Fuse.js für die Suche ist die einzige externe Abhängigkeit – und die wird per CDN geladen, nicht installiert.

### Keine globalen Refactors

Wenn du `render.js` oder `nav.js` anfassen willst: kurz beschreiben was du vor hast und warum.  
Diese Dateien hängen an allem. Eine kleine unbemerkte Änderung kann die Seite auf allen Geräten brechen.

### localStorage Keys nicht umbenennen

Es gibt Nutzer die Favoriten und Einstellungen gespeichert haben. Wenn ein Key umbenannt wird, sind diese Daten weg.

Bestehende Keys:
- `adminsheet_favorites`
- `adminsheet_recent_commands`
- `supportsheet_settings`

### Kleine Änderungen bevorzugen

Lieber fünf kleine Commits als einen großen der alles auf einmal ändert.  
Wenn etwas kaputt geht, ist es so viel einfacher zurückzugehen.

---

## sw.js nicht vergessen

Nach jeder Änderung die deployt werden soll: `CACHE_VERSION` in `sw.js` aktualisieren.

```js
const CACHE_VERSION = '20260526-0900'; // Datum und Uhrzeit
```

Wenn das vergessen wird, bekommen Nutzer die gecachte alte Version – auch wenn GitHub Pages schon aktuell ist.

---

## Was man gerne ändern darf

- Commands in `/data/*.json` ergänzen oder korrigieren
- Beschreibungen verbessern
- Tippfehler fixen
- Neue PowerShell-Skripte in `/powershell/` hinzufügen
- `eventlog-rules.json` um neue Erkennungsregeln erweitern
- Diese Dokumentation verbessern

---

## Was man besser abstimmt

- Neue Seiten anlegen
- Neue localStorage Keys einführen
- `nav.js` oder `render.js` größer umbauen
- Das Farbschema oder die Design-Tokens ändern
- Externe Bibliotheken hinzufügen
