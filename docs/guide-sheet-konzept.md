# guide.sheet – Konzept & Architektur

**Status:** Planung  
**Erstellt:** 2026-07-16  
**Ziel:** Lokale, private Wissensdatenbank für IT-Guides und Tutorials – integriert in support.sheet, ohne Cloud, ohne Server, ohne Datenweitergabe.

---

## Idee

Neuer Bereich im support.sheet der persönliche IT-Guides, How-Tos und Tutorials verwaltet.
Inspiration: OneNote-Struktur, aber besser sortiert – mit Tags, Favoriten, Kategoriebaum, Kacheln-Übersicht und Volltextsuche.
Guides können lokal gespeichert, geteilt und gemergt werden – jeder hat seine eigene Datenbank, sensible Kundendaten bleiben privat.

---

## Navigation (geplant)

Neuer Gruppen-Tab **📚 guide.sheet** mit Unterseiten:

| Unterseite | Funktion |
|------------|----------|
| **Guides** | Kachel-Übersicht aller Guides, Suche, Filter, Kategoriebaum |
| **How-To** | Gefilterte Ansicht nur für Schritt-für-Schritt-Anleitungen |
| **Guide anlegen** | Editor: OneNote-Import oder neuen Guide erstellen |
| **Lokale DB verwalten** | Backup, Restore, Merge, Papierkorb, Statistik |

---

## Technische Kernfrage: Datenspeicherung

### Option A – File System Access API ✅ (empfohlen)
Browser-API die Zugriff auf einen lokalen Ordner erlaubt (einmalige Freigabe durch Benutzer).

```
C:\Temp\Guide.sheet\data\
  ├── _meta.json              ← DB-Metadaten, Version
  ├── guides\
  │   ├── guide-001\
  │   │   ├── meta.json       ← Titel, Tags, Kategorie, Erstellt, Geändert, Favorit
  │   │   ├── content.md      ← Inhalt als Markdown
  │   │   └── assets\         ← Screenshots, Bilder
  │   └── .trash-guide-002\   ← Gelöschte Guides (Präfix . = versteckt)
  └── categories.json         ← Kategoriebaum
```

**Vorteile:**
- Echtes Dateisystem – Guides können außerhalb auch bearbeitet werden
- Kein Cloud-Zwang, keine Datenweitergabe
- Merge funktioniert einfach durch Ordner kopieren
- Screenshots direkt als Dateien
- Backup = Ordner kopieren

**Nachteile:**
- Nur Chrome/Edge (kein Firefox, kein Safari)
- Benutzer muss Ordner einmalig freigeben
- Bei PWA-Neustart muss Ordner erneut freigegeben werden (oder per IndexedDB Handle cachen)

---

### Option B – IndexedDB / localStorage (Fallback)
Alles im Browser-Speicher – kein Dateisystem nötig.

**Vorteile:** Funktioniert in allen Browsern inkl. Firefox

**Nachteile:**
- Kein echter Dateiordner – Export/Import nur per JSON
- Browser kann Daten löschen (Storage-Druck)
- Bilder nur als Base64 gespeichert (aufgebläht)
- Merge komplizierter

---

### Empfehlung: Hybrid
- **Primär:** File System Access API (Chrome/Edge)
- **Fallback:** IndexedDB wenn File System API nicht verfügbar
- **Export:** Immer als ZIP (Ordnerstruktur + alle Assets)

---

## Datenstruktur: Guide-Ordner

```
guide-{timestamp}-{slug}\
  ├── meta.json
  ├── content.md
  └── assets\
      ├── screenshot-001.png
      └── screenshot-002.png
```

### meta.json

```json
{
  "id": "guide-1720000000000",
  "title": "Exchange Postfach migrieren",
  "category": "Exchange",
  "tags": ["exchange", "migration", "on-premises"],
  "created": "2026-07-16T10:00:00Z",
  "modified": "2026-07-16T10:00:00Z",
  "favorite": false,
  "type": "guide",
  "source": "onenote-import",
  "version": 1
}
```

### Alter-Farbkodierung (Ampel)

| Alter Inhalt (modified) | Farbe | Bedeutung |
|-------------------------|-------|-----------|
| < 6 Monate | 🟢 Grün | Aktuell |
| 6–12 Monate | 🟡 Orange | Prüfen empfohlen |
| > 12 Monate | 🔴 Rot | Wahrscheinlich veraltet |

Gilt für **Erstelldatum** (wie lange existiert der Guide) UND **Änderungsdatum** (wie lange nicht aktualisiert) – beides wird auf der Kachel angezeigt.

---

## Soft-Delete / Papierkorb

Löschen = Ordner umbenennen: `guide-001` → `.trash-guide-001`

- Normaler Filter: Ordner mit `.trash-` Präfix werden ausgeblendet
- Papierkorb-Ansicht: zeigt nur `.trash-` Ordner
- Endgültig löschen: Ordner physisch löschen
- Wiederherstellen: Präfix entfernen

---

## UI-Konzept

### Guides-Übersicht (Kacheln)

```
┌─────────────────────────────────────────────┐
│  🔍 Suche...    [Kategorie ▾] [Tags ▾] [★]  │
├──────────┬──────────────────────────────────┤
│          │  ┌──────────┐ ┌──────────┐       │
│ 📁 Exchange │ Exchange    │ AD Reset  │       │
│   └ Migration│ Migration  │           │       │
│   └ Preflight│ 🟢 vor 2W  │ 🟡 vor 8M │       │
│ 📁 Active D.│ └ Exchange  │ └ AD      │       │
│   └ Passwort│ ★ Favorit  │           │       │
│ 📁 Windows  │ ┌──────────┐ ┌──────────┐      │
│   └ ...     │ Postfach.. │ ...        │      │
└──────────┴──────────────────────────────────┘
```

### Kategoriebaum (links)
- Hierarchisch, aufklappbar wie OneNote
- Drag & Drop zum Umsortieren
- Kategorie hat eigene Farbe
- Anzahl Guides pro Kategorie

### Kachel
- Titel, Kategorie-Badge, Tags
- Alter-Ampel (Erstelldatum + Änderungsdatum)
- Favoriten-Stern
- Vorschau erste Zeile Content
- Klick → Guide öffnet sich

### Guide-Ansicht
- Markdown-Rendering (Fenced Code Blocks, Tabellen, Bilder)
- Sidebar bleibt sichtbar
- Bearbeiten-Button → Editor
- Versionierung: Änderungen werden als neue Version gespeichert

---

## OneNote-Import

1. In OneNote: Seite als `.one` oder als **Word (.docx)** exportieren
2. In guide.sheet: Datei in Upload-Zone ziehen
3. Konvertierung: DOCX → Markdown (Pandoc-ähnlich im Browser)
4. Bilder werden extrahiert und in `assets\` gespeichert
5. Vorschau + Bearbeitung vor dem Speichern

**Realistische Formate für Import:**
- `.md` / `.txt` – direkt, kein Konvertierungsaufwand
- `.docx` – machbar mit mammoth.js (bereits in support.sheet verfügbar!)
- `.html` – machbar, Turndown.js für HTML→MD
- `.one` – **nicht möglich** im Browser (proprietäres Format)

---

## Sharing & Merge

Jeder hat seine eigene Datenbank. Austausch funktioniert so:

### Export
- Einzelner Guide: ZIP mit `meta.json + content.md + assets\`
- Alle Guides einer Kategorie: ZIP
- Komplette DB: ZIP des gesamten `data\` Ordners

### Import / Merge
- ZIP einwerfen → Guides werden in DB eingespielt
- Bei Konflikten (gleiche ID, neuere Version): Dialog zeigt Unterschied
- Kundendaten bleiben lokal – nur bereinigte Guides werden geteilt

### Zukünftige Idee: „Guide-Pakete"
Öffentlich teilbare Guide-Sets ohne Kundendaten, ähnlich wie der bestehende `mitmachen.html` Prozess in support.sheet.

---

## Entscheidungen (getroffen)

| Thema | Entscheidung | Begründung |
|-------|-------------|------------|
| **Browser** | Primär Brave/Chrome/Edge (File System API), Firefox als Fallback (IndexedDB) | PWA läuft in Brave, Firefox-Zugriff wünschenswert |
| **Datenspeicherung** | File System Access API (Ordner-Freigabe) + IndexedDB Fallback | Lokale Dateien, kein Cloud-Zwang, echter Dateipfad |
| **Markdown-Editor** | Einfaches Textarea + Live-Vorschau + Toolbar | Schnell, funktional, keine 500KB Extra-Dependency |
| **Versionierung** | Nur `modified`-Timestamp | Reicht für den Use Case |
| **Bilder** | Als Dateien in `assets\` (nicht Base64) | Zukunftssicher, extern nutzbar, lesbar |
| **Kategorien** | Initiale Vorgaben + frei erweiterbar | Sofort nutzbar, flexibel |
| **Speicher** | File System API = Festplattenplatz, einmalige Ordner-Freigabe | Sicherste und sauberste Lösung |

---

## Datenspeicherung – Ablauf

### Erster Start (File System API)
1. guide.sheet öffnen → „Ordner auswählen" Button
2. Benutzer wählt `C:\Temp\Guide.sheet\data\` (oder beliebigen Pfad)
3. Browser fragt einmalig nach Berechtigung → Bestätigen
4. Handle wird in IndexedDB gecacht → bei erneutem Öffnen automatisch wiederhergestellt
5. Falls Berechtigung abgelaufen: ein Klick zum Wiederherstellen

### Firefox-Fallback (IndexedDB)
- File System API nicht verfügbar → automatisch auf IndexedDB umschalten
- Hinweis: „Eingeschränkter Modus – kein Dateizugriff. Export/Import per ZIP."
- Alle Funktionen bleiben nutzbar, nur kein echter Ordner

---

## Initiale Kategorien

```
📁 Exchange
📁 Active Directory
📁 Windows Client
📁 Windows Server
📁 Microsoft 365
📁 Netzwerk
📁 Sicherheit
📁 RDS / Terminalserver
📁 Kunden          ← persönliche Kundennotizen
📁 Allgemein
```

Jede Kategorie hat eine eigene Farbe (aus dem support.sheet Design-System).
Neue Kategorien können jederzeit hinzugefügt werden.
Unterkategorien sind möglich (eine Ebene tief, wie OneNote).

---

## Editor-Konzept

```
┌─────────────────────────────────────────────────────┐
│ Titel: [Exchange Postfach migrieren             ]   │
│ Kategorie: [Exchange ▾]  Tags: [migration] [+]     │
├──────────────────┬──────────────────────────────────┤
│ [B] [I] [Code]   │                                  │
│ [Bild] [Link]    │    Live-Vorschau                 │
│ [H1][H2][H3]     │                                  │
│                  │                                  │
│  Markdown-       │    Gerendertes Markdown          │
│  Textarea        │    mit Syntax-Highlighting       │
│                  │    und Bildern                   │
│                  │                                  │
└──────────────────┴──────────────────────────────────┘
│  [Abbrechen]          [Entwurf speichern] [Speichern]│
└─────────────────────────────────────────────────────┘
```

- Split-View: links schreiben, rechts Vorschau (toggle-bar)
- Toolbar: Fett, Kursiv, Code-Block, Heading, Bild einfügen, Link
- Bilder per Drag & Drop → werden in `assets\` gespeichert, Pfad automatisch ins MD eingesetzt
- Entwurf wird automatisch in IndexedDB gesichert (kein Datenverlust bei versehentlichem Schließen)

---

## Export & Import

### Zwei Export-Modi

#### Export 1 – Lesbar / Archiv (für Menschen)
Ziel: Jemand soll Guides lesen können **ohne guide.sheet installiert zu haben**.

**Format:** ZIP mit folgender Struktur:
```
guide-sheet-export-2026-07-16\
  ├── README.md                         ← Inhaltsverzeichnis aller Guides
  ├── Exchange\
  │   ├── Exchange-Postfach-migrieren.md
  │   ├── Exchange-Postfach-migrieren-assets\
  │   │   └── screenshot-001.png
  │   └── Exchange-Preflight.md
  └── Active-Directory\
      └── AD-Passwort-reset.md
```

**Eigenschaften:**
- Ordnerstruktur = Kategorien, Dateinamen = Guide-Titel (lesbar)
- Bildpfade relativ im MD – direkt öffenbar in VS Code, GitHub, Obsidian
- `README.md` als Inhaltsverzeichnis mit Titel, Kategorie, Tags, Alter
- Keine guide.sheet Metadaten-JSON – reines Markdown

---

#### Export 2 – Merge-Paket (für guide.sheet)
Ziel: Kollege kann importieren und Guides werden sauber gemergt.

**Format:** ZIP mit `_package.json` als Erkennungsmerkmal:
```
guide-sheet-package-jan-lukas-2026-07-16\
  ├── _package.json           ← Paket-Metadaten + Herkunft
  ├── guides\
  │   └── guide-{id}\
  │       ├── meta.json
  │       ├── content.md
  │       └── assets\
  └── categories.json
```

**`_package.json`:**
```json
{
  "version": "1.0",
  "exportedAt": "2026-07-16T10:00:00Z",
  "exportedBy": "jan-lukas",
  "guideCount": 12,
  "tool": "guide.sheet"
}
```

---

### Import & Merge-Logik

guide.sheet erkennt automatisch ob es ein Merge-Paket oder ein lesbares Archiv ist.

#### Konflikt-Behandlung

| Situation | Verhalten |
|-----------|-----------|
| Gleiche ID, gleicher Inhalt | Überspringen |
| Gleiche ID, importierter neuer | Dialog: Ersetzen / Behalten / Beide |
| Gleiche ID, eigener neuer | Eigener bleibt, Kopie angelegt |
| Neue ID | Direkt importiert |

#### Import-Tag
Jeder importierte Guide bekommt automatisch ein Tag:
```
import:2026-07-16:jan-lukas
```
- Sichtbar auf Kachel und in Guide-Ansicht
- Filterbar: „Alle Guides von jan-lukas"
- Bleibt auch nach Bearbeitung erhalten (Herkunft nachvollziehbar)

---

### Export-Dialog

```
┌─────────────────────────────────────┐
│ 📤 Export                           │
│ Was: ○ Alle  ○ Kategorie  ○ Auswahl │
│ Format:                             │
│ ◉ Lesbar / Archiv (Markdown + ZIP)  │
│ ○ Merge-Paket (für guide.sheet)     │
│ Dein Name: [jan-lukas             ] │
│              [Abbrechen][Exportieren]│
└─────────────────────────────────────┘
```

> **Hinweis:** Keine automatische Filterung von Kundendaten.
> Zukünftig: Guides mit Tag `kunde:*` können automatisch ausgeschlossen werden.

---

## Navigation & Struktur (final)

### Haupt-Navigation (Tab-Leiste)
Gruppen-Tab `📚 guide.sheet` analog zum Analyzer-Tab mit Dropdown:

```
⚡ Windows | 📧 Exchange | 🔥 Fortinet | 💚 PS Scripts | 🎫 Ticket | 📋 Analyzer ▾ | 📚 guide.sheet ▾ | 🤝 Mitmachen | ⚙️ tools
                                                                                            ↓
                                                                               ┌─────────────────────┐
                                                                               │ 📚 Guides           │
                                                                               │ 📋 How-To           │
                                                                               │ ✏️ Guide anlegen    │
                                                                               │ 🗄️ Lokale DB        │
                                                                               └─────────────────────┘
```

### Innerhalb guide.sheet – Sidebar links
Jede Unterseite hat eine **linke Sidebar** die zwei Bereiche vereint:

```
┌─────────────────┬────────────────────────────────────┐
│ NAVIGATION      │                                    │
│ ─────────────── │                                    │
│ 📚 Guides       │         Hauptinhalt                │
│ 📋 How-To       │                                    │
│ ✏️ Anlegen      │                                    │
│ 🗄️ Verwalten    │                                    │
│                 │                                    │
│ KATEGORIEN      │                                    │
│ ─────────────── │                                    │
│ 📁 Exchange     │                                    │
│   └ Migration   │                                    │
│ 📁 Active Dir.  │                                    │
│ 📁 Windows      │                                    │
│ 📁 M365         │                                    │
│ 📁 Netzwerk     │                                    │
│ 📁 Kunden       │                                    │
│ + Neu           │                                    │
└─────────────────┴────────────────────────────────────┘
```

- Sidebar ist auf allen 4 Unterseiten identisch
- Aktive Seite und aktive Kategorie sind hervorgehoben
- Kategorien klappbar (Unterkategorien eine Ebene tief)
- Sidebar kann auf kleinen Bildschirmen eingeklappt werden

---

| Thema | Entscheidung |
|-------|-------------|
| **Ordner-Freigabe** | Einmaliger Klick bei jedem PWA-Start – akzeptabel |
| **Kategorien** | Nur in `meta.json` – Ordner flach, kein Unterordner-Chaos |
| **Speicherort** | Lokaler Ordner, empfohlen `C:\Temp\Guide.sheet\data\` |
| **Netzlaufwerk** | Nicht vorgesehen – privat, lokal, eine Person |
| **Backup** | Manuell: Ordner kopieren, fertig |

### Ordner-Freigabe Flow (PWA-Start)
```
PWA startet
    ↓
Handle in IndexedDB vorhanden?
    ├── JA → queryPermission()
    │         ├── granted → direkt weiter
    │         └── prompt  → ein Klick „Zugriff bestätigen" → weiter
    └── NEIN → „Ordner auswählen" Button → einmalige Auswahl → weiter
```

### Empfohlene Ordnerstruktur auf Disk
```
C:\Temp\Guide.sheet\
  └── data\
      ├── _meta.json              ← DB-Version, Handle-Info
      ├── categories.json         ← Kategoriebaum
      ├── guide-1720000000000\    ← flach, kein Unterordner
      │   ├── meta.json
      │   ├── content.md
      │   └── assets\
      ├── guide-1720000000001\
      │   ├── meta.json
      │   ├── content.md
      │   └── assets\
      └── .trash-guide-old\       ← Soft-Delete Präfix
```

### Was noch bedacht werden muss (intern, kein Blocker)
- Dateiname-Kollisionen beim lesbaren Export → Suffix `_2` generieren
- DOCX-Import Erwartung: nie 100% perfekt, immer Nacharbeit nötig
- Bildpfade im MD immer mit `/` (nicht `\`) für Browser-Rendering
- Kein Auto-Sync wenn Datei extern bearbeitet → manueller Reload-Button reicht
- `.gitignore` Eintrag für `data\` Ordner – Pflicht in der Doku

---

1. **Phase 1 – Shell:** `guides.html` mit Navigation, leere Unterseiten, nav.js
2. **Phase 2 – Datenhaltung:** File System Access API + IndexedDB Fallback
3. **Phase 3 – Guides-Übersicht:** Kachelansicht, Kategoriebaum, Suche, Ampel
4. **Phase 4 – Guide-Ansicht:** Markdown-Rendering, Bilder, Metadaten
5. **Phase 5 – Editor:** Neuen Guide erstellen, bearbeiten, speichern
6. **Phase 6 – Import:** DOCX-Import (mammoth.js), MD-Import, Vorschau
7. **Phase 7 – Export:** Lesbares Archiv + Merge-Paket, Export-Dialog
8. **Phase 8 – Verwaltung:** Papierkorb, Merge, Import-Tags, Statistik
