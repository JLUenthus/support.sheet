# Commands hinzufügen

Das ist der häufigste Anwendungsfall: du hast einen nützlichen Befehl und willst ihn ins Projekt aufnehmen.

Alle Commands liegen in JSON-Dateien im `/data` Ordner. Kein HTML, kein JavaScript – nur JSON editieren und fertig.

---

## Die Grundstruktur

Jeder Command sieht so aus:

```json
{
  "id": "network-dns-flush",
  "name": "DNS-Cache leeren",
  "cmd": "ipconfig /flushdns",
  "desc": "Lokalen DNS-Cache verwerfen. Nötig nach DNS-Änderungen oder wenn eine falsche Seite aufgerufen wird.",
  "tags": ["network", "windows", "quick"]
}
```

**Felder erklärt:**

| Feld | Pflicht | Erklärung |
|------|---------|-----------|
| `id` | ja | Eindeutige ID. Format: `kategorie-kurzname`. Nur Kleinbuchstaben und Bindestriche. |
| `name` | ja | Anzeigename – kurz und präzise. |
| `cmd` | ja | Der eigentliche Befehl. Genau so wie er in CMD/PowerShell eingegeben wird. |
| `desc` | ja | Kurze Beschreibung. Was macht der Befehl? Wann ist er nützlich? |
| `tags` | ja | Array mit Tags. Der **erste Tag** bestimmt die Kategorie-Gruppierung. |

---

## Wohin gehört der Command?

| Seite | Datei |
|-------|-------|
| Windows (CMD, PS, MSC) | `data/commands.json` |
| Exchange On-Prem / EXO | `data/exchange-commands.json` |
| Fortinet FG/FMG/FAZ | `data/forti-commands.json` |

Öffne die passende Datei und füge den neuen Eintrag im `commands`-Array ein:

```json
{
  "version": "2.0",
  "commands": [
    { ... bestehender Command ... },
    { ... bestehender Command ... },

    {
      "id": "network-mein-neuer-befehl",
      "name": "Mein neuer Befehl",
      "cmd": "netsh wlan show profiles",
      "desc": "Alle gespeicherten WLAN-Profile anzeigen.",
      "tags": ["network", "windows", "info"]
    }
  ]
}
```

---

## Tags

Es gibt keine festen Kategorien mehr. Die Gruppierung passiert automatisch über den **ersten Tag** eines Commands.

Vorhandene Tags in `commands.json`:

| Tag | Wofür |
|-----|-------|
| `msc` | MMC-Konsolen (compmgmt, diskmgmt, ...) |
| `system` | Systeminformationen, Diagnose |
| `network` | Netzwerk, DNS, IP |
| `powershell` | PowerShell-Befehle |
| `users` | Benutzer und Gruppen |
| `disk` | Datenträger, Reparatur |
| `process` | Prozesse und Dienste |
| `remote` | Remote Desktop, WinRM |
| `gpo` | Gruppenrichtlinien |
| `eventlog` | Event Log, Diagnose |
| `active-directory` | AD, Konten, Sync |
| `printer` | Drucker und Spooler |
| `quick` | Schnellbefehle (Einzeiler) |

**Ergänzungs-Tags** (werden zusätzlich gesetzt, beeinflussen die Suche):

| Tag | Bedeutung |
|-----|-----------|
| `admin` | Benötigt Admin-Rechte |
| `info` | Zeigt nur Informationen an, ändert nichts |
| `quick` | Kurzer Einzeiler |
| `diag` | Diagnose und Fehlersuche |
| `caution` | Vorsicht – kann etwas ändern oder löschen |
| `repair` | Reparatur-Befehl |
| `windows` | Windows-spezifisch |
| `server` | Nur auf Servern relevant |

Du kannst auch neue Tags erfinden – sie erscheinen dann automatisch in der Filter-Bar.

---

## Variable Commands

Manchmal ändert sich ein Teil des Befehls je nach Situation – z.B. ein Benutzername oder ein Servername. Dafür gibt es Variablen in geschweiften Klammern.

```json
{
  "id": "ad-konto-entsperren",
  "name": "Konto entsperren",
  "cmd": "Unlock-ADAccount -Identity '{username}'",
  "desc": "Gesperrtes AD-Konto entsperren. Username eingeben wenn der Dialog erscheint.",
  "tags": ["active-directory", "powershell", "admin"]
}
```

Wenn jemand auf "Kopieren" klickt, erscheint automatisch ein Dialog und fragt nach dem Wert für `{username}`. Der fertige Befehl wird dann mit dem eingegebenen Wert kopiert.

**Drei Variablen haben einen Sonderfall:**

| Variable | Wird vorbelegt aus |
|----------|--------------------|
| `{username}` | Einstellung "Default Username" in support.tools |
| `{server}` | Einstellung "Default Server" in support.tools |
| `{domain}` | Einstellung "Default Domain" in support.tools |

Das heißt: wer seine Domain einmalig in support.tools einträgt, muss sie nicht bei jedem Befehl neu eingeben.

**Mehrere Variablen gleichzeitig:**

```json
{
  "id": "remote-pssession-open",
  "name": "Remote-Session öffnen",
  "cmd": "Enter-PSSession -ComputerName {server} -Credential {domain}\\{username}",
  "desc": "Interaktive PowerShell-Session auf einem Remote-Server öffnen.",
  "tags": ["remote", "powershell", "admin"]
}
```

Der Dialog fragt dann nacheinander nach `server`, `domain` und `username`.

---

## Testen

1. Lokalen Webserver starten (`python -m http.server 8080`)
2. `index.html` (oder die jeweilige Seite) im Browser öffnen
3. Nach dem neuen Befehl suchen
4. Kopieren testen – erscheint der Variablen-Dialog korrekt?

Wenn die Seite den neuen Command nicht zeigt: Browser-Cache leeren (`Strg+Shift+R`) oder den lokalen Server neu starten.

---

## Häufige Fehler

**Komma vergessen:**  
JSON ist sehr pingelig. Nach jedem Eintrag außer dem letzten muss ein Komma stehen.

```json
{ ... },   ← Komma
{ ... },   ← Komma
{ ... }    ← kein Komma beim letzten
```

**ID nicht eindeutig:**  
Jede `id` muss einmalig sein. Einfach kurz durch die bestehende Datei scrollen ob die ID schon vergeben ist.

**Backslash in Befehlen:**  
In JSON müssen Backslashes verdoppelt werden:
```json
"cmd": "C:\\Windows\\System32\\compmgmt.msc"
```
