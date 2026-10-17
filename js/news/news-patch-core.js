// ============================================================
// News Curator – Patchday-Bericht: reine Logik
// ============================================================
// Kein DOM- und kein localStorage-Zugriff, damit Datumslogik, Prompt-Aufbau und
// Vorverarbeitung ohne Browser testbar sind (siehe module.exports unten). Alle
// Werte (Datum, Patchday) berechnet die App, nicht die KI. Datumsteile kommen
// aus der lokalen Zeit, nicht aus toISOString() (das liefert UTC und verschiebt
// rund um Mitternacht den Tag).
//
// Bewusst eigenständig und getrennt vom CVE-Code (news-cve-core.js,
// news-cve-report-core.js): Die Datumsfunktionen unterscheiden sich im Fall
// "heute ist Patchday". Kleine, reine Funktionen aus dem CVE-Code sind hier
// kopiert (normalizeLineEndings, stripOuterCodeFence, countMarkdownTables,
// hasTabSeparatedTables); tests/news-patch-core.test.js vergleicht Original und
// Kopie auf denselben Eingaben, damit sie nicht auseinanderlaufen.
(function () {
  const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const PATCHDAY_OFFSETS = [0, 1, 2];   // 0 = aktueller Patchday, 1 und 2 = die zwei davor

  // Startwerte (anpassbar). Ein leeres Detailfeld heißt "alle unterstützten Versionen".
  const DEFAULT_PRODUCTS = [
    { id: 'windows-11',   name: 'Windows 11',            details: [] },
    { id: 'windows-10',   name: 'Windows 10',            details: ['soweit noch Updates erscheinen'] },
    { id: 'server-2016',  name: 'Windows Server 2016',   details: [] },
    { id: 'server-2019',  name: 'Windows Server 2019',   details: [] },
    { id: 'server-2022',  name: 'Windows Server 2022',   details: [] },
    { id: 'server-2025',  name: 'Windows Server 2025',   details: [] },
    { id: 'm365-apps',    name: 'Microsoft 365 Apps',    details: [] },
    { id: 'exchange',     name: 'Exchange Server',       details: [] },
    { id: 'sql-server',   name: 'SQL Server',            details: [] },
    { id: 'dotnet',       name: '.NET',                  details: [] },
    { id: 'edge',         name: 'Microsoft Edge',        details: [] },
  ];

  // Einstufungsregeln: eigene Konstante, damit sie an einer Stelle anpassbar sind. Wird für {{ROLLOUT_RULES}} eingesetzt.
  const PATCH_ROLLOUT_RULES = `- 🔴 Zurückhalten oder nur Pilot: von Microsoft bestätigtes Problem mit hoher Auswirkung (Anmeldung, Netzwerk, Start des Systems, Dienste, Datenverlust) ohne Workaround in häufigen Szenarien.
- 🟡 Mit Vorsicht ausrollen: bestätigtes Problem mit Workaround oder nur in Sonderkonfigurationen, oder nicht bestätigte Meldungen aus mehreren unabhängigen Quellen.
- 🟢 Normal ausrollen: keine bestätigten Probleme, die die übliche Umgebung betreffen.
- ⚪ Nicht prüfbar: keine Quelle abrufbar oder Updates noch nicht veröffentlicht.`;

  // Single Source für den Patchday-Prompt. Platzhalter in doppelten geschweiften Klammern. Wird unverändert in eine externe KI
  // eingefügt, daher wortwörtlich, nicht umformuliert. Bewusst getrennt vom CVE-Template in news-cve-core.js.
  const PATCH_PROMPT_TEMPLATE = `Erstelle einen Patchday-Bericht für meine Microsoft-Umgebung.

HARTE VORAUSSETZUNG
Du brauchst Websuche bzw. Internetzugriff. Wenn du keine Websuche nutzen kannst, antworte ausschließlich mit "Keine Websuche verfügbar, Bericht nicht erstellt." und erstelle keinen Bericht. Nenne niemals KB-Nummern, Build-Nummern, CVE-Zahlen oder Termine aus dem Gedächtnis.

KONTEXT
- Heutiges Datum: {{TODAY}} (verwende dieses Datum, rate es nicht)
- Patchday: {{PATCHDAY}} ({{MONTH_LABEL}})
- Vorheriger Patchday: {{PREV_PATCHDAY}}
- Nächster Patchday: {{NEXT_PATCHDAY}}

PRODUKTLISTE
Prüfe genau diese Produkte:
{{PRODUCT_LIST}}

RECHERCHE
1. Suche pro Produkt die Updates zum Patchday {{PATCHDAY}}: Name des Updates, KB-Nummer, Build bzw. Version, Veröffentlichungsdatum. Bei Windows pro Version getrennt (z. B. 24H2), bei Windows Server pro Servergeneration. Prüfe das Veröffentlichungsdatum jedes Updates. Als Update zu diesem Patchday gilt nur, was am {{PATCHDAY}} erschienen ist. Updates aus Vormonaten gehören nicht in die Updateübersicht. Außerplanmäßige Updates (Out-of-Band), die seit dem {{PATCHDAY}} erschienen sind, nimmst du mit Datum und Kennzeichnung "Out-of-Band" auf.
2. Sind die Veröffentlichungen zum Patchday noch nicht abrufbar (zum Beispiel weil der Patchday heute ist und die Quellen noch nicht aktualisiert wurden), schreibe das ausdrücklich ("Noch nicht veröffentlicht oder nicht abrufbar") und verwende keine Daten des Vormonats als aktuelle.
3. Suche die bekannten Probleme (Known Issues) zu diesen Updates und die noch offenen Probleme früherer Monate. Bevorzuge Primärquellen von Microsoft: Windows release health, Microsoft-Support-Artikel (KB), Security Update Guide, Microsoft Learn (Exchange-Server-Updates, Microsoft-365-Apps-Versionshinweise, SQL-Server-Updates). Nutze Sekundärquellen (Fachpresse, Blogs, Foren) nur ergänzend oder wenn keine Primärquelle erreichbar ist. Kennzeichne in der Quellenliste jede Quelle mit (Primär) oder (Sekundär). Angaben, die nur auf einer Sekundärquelle beruhen, erhalten im Text den Zusatz "(Sekundärquelle, gegenprüfen)". Behaupte keine Primärquelle, wenn die Angabe aus Presse oder Community stammt.
4. Unterscheide klar zwischen "Von Microsoft bestätigt" (steht in einer Microsoft-Quelle, mit dem dort genannten Status) und "Gemeldet, nicht von Microsoft bestätigt" (Presse, Foren, Community). Erfinde keinen Status. Übernimm den Status mit den Worten der Quelle (z. B. untersucht, bestätigt, Workaround verfügbar, behoben).
5. Nenne bei jedem Problem die betroffenen Versionen bzw. Voraussetzungen (z. B. nur Domain Controller, nur RDS, nur bestimmte Hardware oder Konfiguration), wenn die Quelle sie nennt, dazu Workaround oder Fix, wenn es einen gibt. Schreibe nicht "alle Systeme betroffen", wenn die Quelle Einschränkungen nennt.
6. Offene Probleme aus Vormonaten bleiben im Bericht, solange nicht belegt ist, dass sie behoben sind. Die Spalte "Seit" nennt den Monat der ersten Meldung.
7. Nenne für die Sicherheitslage pro Produkt nur Kennzahlen aus dem Security Update Guide (Zahl der CVEs, Zahl Critical, Zahl der als ausgenutzt markierten Lücken). Keine Einzelanalyse einzelner CVEs, dafür gibt es einen eigenen CVE-Bericht. Nenne die Quelle der Kennzahlen.
8. Widersprechen sich Quellen, nenne den Widerspruch im jeweiligen Abschnitt.
9. Kannst du für ein Produkt keine Quelle tatsächlich prüfen, schreibst du "Nicht prüfbar: Quelle nicht abrufbar." Der Satz "Keine bekannten Probleme gefunden." ist nur erlaubt, wenn du mindestens eine Quelle wirklich geprüft hast. Nenne diese Quelle dann in einem Halbsatz.

QUALITÄTSREGELN
- Nenne nur KB-Nummern, Builds, Daten und Probleme, die du in einer abgerufenen Quelle gesehen hast. Keine erfundenen oder geschätzten Werte.
- Felder, die du nicht verifizieren kannst, schreibst du als "n/a".
- Keine Tracking-Parameter (utm_*, trk) in URLs. Jede Quelle genau einmal als [Titel](URL), keine zusätzlichen Quellenverweise oder Quellen-Chips hinter Sätzen.
- Jede im Text verlinkte Quelle steht auch in der Quellenliste. Die Quellenliste enthält nur Quellen, auf die sich der Bericht tatsächlich stützt.
- Gib keine Nummernbereiche an, nenne nur einzeln gesehene KB-Nummern.
- Kurze, sachliche Sätze. Keine Gedankenstriche im Fließtext.

ROLLOUT-EINSTUFUNG
Die Einstufung bewertet nur das Stabilitätsrisiko des Updates. Aktiv ausgenutzte Sicherheitslücken nennst du getrennt im Hinweis, sie senken die Dringlichkeit nicht. Das Alter eines offenen Problems senkt die Einstufung nicht. Stufe wörtlich nach diesen Kriterien ein:
{{ROLLOUT_RULES}}

AUFBAU DES BERICHTS (genau diese Reihenfolge, als Markdown mit echten Markdown-Tabellen)
1. Titelzeile: "# Patchday-Bericht – {{MONTH_LABEL}}"
2. Zeile: "Erstellt: {{TODAY}} | Patchday: {{PATCHDAY}} | Nächster Patchday: {{NEXT_PATCHDAY}}"
3. Absatz "Hinweis zur Datenqualität:" mit 1 bis 3 Sätzen: wie recherchiert wurde, welche Quellen nicht erreichbar waren, welche Angaben auf Sekundärquellen beruhen (mit Namen), dass "n/a" nicht verifizierte Felder markiert und dass Updates, Builds und Probleme vor dem Rollout gegen Windows release health, die KB-Artikel und den Security Update Guide zu prüfen sind.
4. "## Zusammenfassung": Stichpunkte, wichtigste zuerst: bestätigte Probleme mit hoher Auswirkung, Zahl der als ausgenutzt markierten Lücken, größte Änderungen. Letzter Stichpunkt: Produkte ohne bekannte Probleme, getrennt davon Produkte, die nicht prüfbar waren. Schreibe keine Beschriftung wie "Letzter Punkt" davor.
5. "## Updateübersicht": Tabelle Produkt | Update | KB | Build/Version | Veröffentlicht | Art (Sicherheit, Nicht-Sicherheit, Out-of-Band).
6. Pro Produkt aus meiner Liste ein Abschnitt "## Produkt". Inhalt: höchstens fünf Stichpunkte zu den wichtigsten Änderungen, eine Zeile mit den Kennzahlen aus dem Security Update Guide, dann "Bekannte Probleme" als Tabelle Problem | Betroffen | Status laut Quelle | Bestätigung (Von Microsoft bestätigt, Gemeldet nicht bestätigt) | Workaround oder Fix | Seit | Quelle. Gibt es nichts und hast du eine Quelle geprüft, schreibst du genau: "Keine bekannten Probleme gefunden." mit der geprüften Quelle in einem Halbsatz. Konntest du keine Quelle prüfen, schreibst du genau: "Nicht prüfbar: Quelle nicht abrufbar."
7. "## Rollout-Hinweise": Tabelle Einstufung | Produkt | Hinweis | Begründung, sortiert von 🔴 über 🟡 und 🟢 bis ⚪. Jedes Problem aus den Produktabschnitten mit Bestätigung "Von Microsoft bestätigt" und hoher Auswirkung kommt in mindestens einer Zeile vor.
8. "## Quellen": Liste mit Titel, URL und (Primär) oder (Sekundär). Nicht erreichbare Quellen vermerken.

AUSGABE
Gib ausschließlich den Bericht aus, ohne Einleitung und ohne Schlussbemerkung, als normalen Markdown-Text (nicht in einem Codeblock).`;

  // ── Datumslogik (lokale Zeit) ────────────────────────────────
  function pad2(n) { return String(n).padStart(2, '0'); }
  function formatISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

  function isValidISODate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
  }
  // Date oder "YYYY-MM-DD" -> Date um 00:00 lokaler Zeit (Uhrzeit und Zeitzone der Eingabe spielen keine Rolle).
  function toLocalDate(input) {
    // Kein instanceof: ein Date aus einem anderen Fenster (iframe) wäre sonst "ungültig".
    if (Object.prototype.toString.call(input) === '[object Date]' && !isNaN(input.getTime())) return new Date(input.getFullYear(), input.getMonth(), input.getDate());
    if (isValidISODate(input)) { const [y, m, d] = input.split('-').map(Number); return new Date(y, m - 1, d); }
    throw new Error('Ungültiges Datum: ' + String(input));
  }

  // Zweiter Dienstag des Monats (month 0-11, Überlauf wird von Date aufgelöst: -1 = Dezember des Vorjahres).
  function secondTuesday(year, month) {
    const first = new Date(year, month, 1);
    const firstTuesday = 1 + ((2 - first.getDay() + 7) % 7);
    return new Date(year, month, firstTuesday + 7);
  }
  function patchdayBefore(d) { return secondTuesday(d.getFullYear(), d.getMonth() - 1); }

  // Letzter Patchday am oder vor heute.
  function currentPatchdayDate(today) {
    const t = toLocalDate(today);
    const pd = secondTuesday(t.getFullYear(), t.getMonth());
    return t.getTime() >= pd.getTime() ? pd : patchdayBefore(pd);
  }
  function currentPatchday(today) { return formatISODate(currentPatchdayDate(today)); }
  // Der Patchday davor.
  function previousPatchday(today) { return formatISODate(patchdayBefore(currentPatchdayDate(today))); }
  // Erster Patchday nach heute (streng: am Patchday selbst ist es der des Folgemonats).
  function nextPatchday(today) {
    const t = toLocalDate(today);
    const pd = secondTuesday(t.getFullYear(), t.getMonth());
    return formatISODate(t.getTime() < pd.getTime() ? pd : secondTuesday(t.getFullYear(), t.getMonth() + 1));
  }
  // "2026-10-13" -> "Oktober 2026"
  function monthLabel(patchday) {
    const d = toLocalDate(patchday);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  }
  // Ganze Tage von a bis b über die lokalen Kalenderkomponenten (Sommerzeit verschiebt nichts).
  function daysBetween(a, b) {
    const x = toLocalDate(a), y = toLocalDate(b);
    return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86400000);
  }
  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
  // "Heute ist Patchday" / "Letzter Patchday vor N Tagen" und "Nächster Patchday in N Tagen"
  function patchdayHint(today) {
    const since = daysBetween(currentPatchday(today), today);
    const until = daysBetween(today, nextPatchday(today));
    const next = `Nächster Patchday in ${plural(until, 'Tag', 'Tagen')}`;
    return since === 0 ? `Heute ist Patchday. ${next}.` : `Letzter Patchday vor ${plural(since, 'Tag', 'Tagen')}. ${next}.`;
  }

  // Alle Datumswerte für Anzeige und Prompt. offset 0 = aktueller Patchday, 1 und 2 = die zwei davor. "Nächster Patchday" ist immer
  // der nächste nach heute, auch bei einem nachträglich gewählten älteren Patchday.
  function getDates(now, offset) {
    const o = PATCHDAY_OFFSETS.includes(offset) ? offset : 0;
    const today = formatISODate(toLocalDate(now));
    let chosen = currentPatchdayDate(now);
    for (let i = 0; i < o; i++) chosen = patchdayBefore(chosen);
    const patchday = formatISODate(chosen);
    return {
      today, offset: o, patchday, monthLabel: monthLabel(patchday),
      prevPatchday: formatISODate(patchdayBefore(chosen)),
      nextPatchday: nextPatchday(now),
      daysSince: daysBetween(currentPatchday(now), today),
      daysUntil: daysBetween(today, nextPatchday(now)),
    };
  }
  // Auswahl für die Einstellungen: [{ offset, patchday }]
  function patchdayChoices(now) {
    return PATCHDAY_OFFSETS.map(o => ({ offset: o, patchday: getDates(now, o).patchday }));
  }

  // ── Einstellungen ────────────────────────────────────────────
  function defaultSettings() {
    return {
      version: 1,
      patchdayOffset: 0,
      products: DEFAULT_PRODUCTS.map(p => ({ id: p.id, name: p.name, enabled: true, details: p.details.slice() })),
    };
  }
  function cleanText(value) { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; }

  // Liest beliebigen JSON-Inhalt (auch kaputten/fremden) und liefert immer gültige Einstellungen. Nichts davon wird hier gespeichert,
  // ein Überschreiben passiert erst durch eine Nutzeraktion.
  function normalizeSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.products)) return defaultSettings();
    const seenIds = new Set();
    const products = [];
    raw.products.forEach((p, i) => {
      if (!p || typeof p !== 'object') return;
      const name = cleanText(p.name);
      if (!name) return;
      let id = cleanText(p.id) || ('product-' + (i + 1));
      while (seenIds.has(id)) id += '-x';
      seenIds.add(id);
      const details = [];
      (Array.isArray(p.details) ? p.details : []).forEach(x => {
        const t = cleanText(x);
        if (t && !details.some(y => y.toLowerCase() === t.toLowerCase())) details.push(t);
      });
      products.push({ id, name, enabled: p.enabled !== false, details });
    });
    const offset = Number(raw.patchdayOffset);
    return { version: 1, patchdayOffset: PATCHDAY_OFFSETS.includes(offset) ? offset : 0, products };
  }

  // ── Prompt ───────────────────────────────────────────────────
  // Nutzereingaben (Produktnamen und Details) werden als Text eingesetzt: Zeilenumbrüche zusammengezogen (keine eingeschleusten
  // Prompt-Zeilen) und "{{"/"}}" entschärft, damit nach dem Einsetzen garantiert kein Platzhalter-Rest im Text steht.
  function safeInline(text) { return cleanText(text).replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }'); }

  function buildProductList(products) {
    return products
      .filter(p => p.enabled)
      .map(p => {
        const details = (p.details || []).map(safeInline).filter(Boolean);
        return `- ${safeInline(p.name)}: ${details.length ? details.join(', ') : 'alle unterstützten Versionen'}`;
      })
      .join('\n');
  }
  function countActive(settings) { return settings.products.filter(p => p.enabled).length; }

  // Ein einziger Durchlauf über das Template: eingesetzte Werte werden nicht erneut nach Platzhaltern durchsucht.
  function fillTemplate(template, values) {
    return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => (key in values ? values[key] : match));
  }

  function buildPatchPrompt(settings, now) {
    const s = normalizeSettings(settings);
    const activeCount = countActive(s);
    const dates = getDates(now, s.patchdayOffset);
    if (activeCount === 0) return { prompt: null, activeCount, totalCount: s.products.length, dates };
    const prompt = fillTemplate(PATCH_PROMPT_TEMPLATE, {
      TODAY: dates.today,
      PATCHDAY: dates.patchday,
      MONTH_LABEL: dates.monthLabel,
      PREV_PATCHDAY: dates.prevPatchday,
      NEXT_PATCHDAY: dates.nextPatchday,
      PRODUCT_LIST: buildProductList(s.products),
      ROLLOUT_RULES: PATCH_ROLLOUT_RULES,
    });
    return { prompt, activeCount, totalCount: s.products.length, dates };
  }

  // "Patchday 13.10.2026 (Oktober 2026), 11 von 11 Produkten aktiv"
  function formatSummary(settings, now) {
    const s = normalizeSettings(settings);
    const d = getDates(now, s.patchdayOffset);
    const [y, m, day] = d.patchday.split('-');
    return `Patchday ${day}.${m}.${y} (${d.monthLabel}), ${countActive(s)} von ${s.products.length} Produkten aktiv`;
  }

  // ── Kopien kleiner, reiner Funktionen aus news-cve-report-core.js (Vergleichstest: tests/news-patch-core.test.js) ──
  // \r\n und einzelnes \r -> \n. Muss als allererstes passieren: aus einer Textarea kommt LF, beim Lesen einer Datei bleibt CRLF stehen.
  function normalizeLineEndings(text) {
    return String(text == null ? '' : text).replace(/\r\n|\r/g, '\n');
  }
  // Entfernt eine Umzäunung (``` oder ~~~, auch länger), die den GESAMTEN Text umschließt.
  function stripOuterCodeFence(text) {
    const lines = text.split('\n');
    if (lines.length < 2) return text;
    const open = /^(`{3,}|~{3,})[ \t]*[\w+-]*[ \t]*$/.exec(lines[0]);
    if (!open) return text;
    const fence = open[1];
    const ch = fence[0];
    const closes = line => {
      const m = /^(`{3,}|~{3,})[ \t]*$/.exec(line);
      return !!m && m[1][0] === ch && m[1].length >= fence.length;
    };
    if (!closes(lines[lines.length - 1])) return text;
    for (let i = 1; i < lines.length - 1; i++) {
      if (closes(lines[i])) return text;
    }
    return lines.slice(1, -1).join('\n');
  }
  const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  function countMarkdownTables(text) {
    const lines = text.split('\n');
    let count = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].includes('|') && lines[i + 1].includes('|') && TABLE_SEPARATOR.test(lines[i + 1])) count++;
    }
    return count;
  }
  function hasTabSeparatedTables(text) {
    const lines = text.split('\n');
    const tabs = line => (line.match(/\t/g) || []).length;
    for (let i = 0; i < lines.length - 1; i++) {
      if (tabs(lines[i]) >= 2 && tabs(lines[i + 1]) >= 2) return true;
    }
    return false;
  }

  // ── Einfügen: Vorverarbeitung ────────────────────────────────
  const REQUIRED_MARKERS = ['Patchday-Bericht', 'Rollout-Hinweise', 'Quellen'];

  // Marker zählen als vorhanden, wenn eine Zeile (ohne führende #, *, Leerraum) damit beginnt.
  function findMissingMarkers(text) {
    const lines = text.split('\n').map(l => l.replace(/^[#*\s]+/, ''));
    return REQUIRED_MARKERS.filter(marker => !lines.some(l => l.startsWith(marker)));
  }
  // Eindeutige KB-Nummern (nur gezählt, nicht auf Existenz geprüft).
  function countKbNumbers(text) {
    const matches = text.match(/KB\d{6,8}/g) || [];
    return { total: matches.length, unique: new Set(matches).size };
  }

  // Monat und Jahr aus der Titelzeile, Patchday aus "Patchday: JJJJ-MM-TT" (nicht aus "Nächster/Vorheriger Patchday:"),
  // jeweils mit Rückfall auf den gewählten Patchday.
  function parseMetadata(text, fallbackPatchday) {
    const lines = text.split('\n');
    const titleLine = lines.find(l => l.includes('Patchday-Bericht')) || lines.find(l => l.trim()) || '';
    const titleMatch = new RegExp('Patchday-Bericht\\s*[–—-]\\s*(' + MONTH_NAMES.join('|') + ')\\s+(\\d{4})').exec(titleLine);
    const pdMatch = /(?<!Nächster )(?<!Vorheriger )Patchday:\s*(\d{4}-\d{2}-\d{2})/.exec(text);
    const fromText = !!pdMatch && isValidISODate(pdMatch[1]);
    const patchday = fromText ? pdMatch[1] : (isValidISODate(fallbackPatchday) ? fallbackPatchday : '');
    return {
      patchday,
      month: titleMatch ? `${titleMatch[1]} ${titleMatch[2]}` : (patchday ? monthLabel(patchday) : ''),
      monthFromText: !!titleMatch,
      patchdayFromText: fromText,
    };
  }

  // Gesamtablauf in der vorgegebenen Reihenfolge. status: 'empty' | 'no-search' | 'ok'. Warnungen blockieren nie selbst;
  // 'tabs' verlangt in der UI eine ausdrückliche Bestätigung.
  function preprocessReport(raw, fallbackPatchday) {
    let text = normalizeLineEndings(raw);                // 1 Zeilenenden
    text = text.trim();                                   // 2 trimmen
    if (!text) return { status: 'empty', text: '', warnings: [] };
    text = stripOuterCodeFence(text).trim();              // 3 umschließenden Codeblock entfernen
    if (!text) return { status: 'empty', text: '', warnings: [] };
    if (/^[\s>*_#]*Keine Websuche verfügbar/.test(text)) { // 4 ablehnen
      return {
        status: 'no-search', text: '', warnings: [],
        message: 'Die KI hatte keine Websuche. Websuche aktivieren und den Prompt erneut ausführen.',
      };
    }
    const warnings = [];
    if (hasTabSeparatedTables(text) && countMarkdownTables(text) === 0) { // 5 Tabellen als Text
      warnings.push({
        code: 'tabs',
        message: 'Die Tabellen wurden als Text eingefügt. Bitte den Kopieren-Button der KI-Antwort verwenden statt Text zu markieren.',
      });
    }
    const missing = findMissingMarkers(text);             // 6 weiche Strukturprüfung
    if (missing.length) warnings.push({ code: 'structure', message: 'Struktur unvollständig, es fehlen: ' + missing.join(', ') + '.' });
    const kb = countKbNumbers(text);                      // 7 KB-Zählung
    if (kb.unique === 0) warnings.push({ code: 'no-kb', message: 'Im Text wurde keine KB-Nummer gefunden (es wird nur gezählt, nicht auf Existenz geprüft).' });
    const meta = parseMetadata(text, fallbackPatchday);
    if (!meta.monthFromText || !meta.patchdayFromText) {
      warnings.push({ code: 'meta-fallback', message: 'Monat oder Patchday waren im Text nicht lesbar, es wird der gewählte Patchday verwendet.' });
    }
    return { status: 'ok', text, warnings, meta, kb };
  }

  // ── Datenmodell ──────────────────────────────────────────────
  function formatLocalDateTime(d) {
    return `${formatISODate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function buildReportRecord(prepared, now) {
    return {
      id: newId(),
      patchday: prepared.meta.patchday,
      month: prepared.meta.month,
      importedAt: formatLocalDateTime(now),
      kbCount: prepared.kb.unique,
      markdown: prepared.text,
    };
  }

  // Liest beliebigen gespeicherten Inhalt (auch kaputten) und liefert immer ein gültiges Array. Nichts davon wird hier gespeichert.
  function normalizeReports(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    raw.forEach(r => {
      if (!r || typeof r !== 'object' || typeof r.markdown !== 'string' || !r.markdown) return;
      let id = typeof r.id === 'string' && r.id ? r.id : newId();
      while (seen.has(id)) id += '-x';
      seen.add(id);
      const patchday = isValidISODate(r.patchday) ? r.patchday : '';
      out.push({
        id,
        patchday,
        month: typeof r.month === 'string' && r.month ? r.month.slice(0, 60) : (patchday ? monthLabel(patchday) : ''),
        importedAt: typeof r.importedAt === 'string' ? r.importedAt : '',
        kbCount: Number.isFinite(r.kbCount) ? r.kbCount : countKbNumbers(r.markdown).unique,
        markdown: r.markdown,
      });
    });
    return out;
  }

  // "2026-10-13" -> "Patchday-Bericht_2026-10.md"
  function reportFileName(patchday) {
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(typeof patchday === 'string' ? patchday : '');
    return `Patchday-Bericht_${m ? m[1] + '-' + m[2] : 'unbekannt'}.md`;
  }

  const api = {
    MONTH_NAMES, PATCHDAY_OFFSETS, DEFAULT_PRODUCTS, PATCH_PROMPT_TEMPLATE, PATCH_ROLLOUT_RULES, REQUIRED_MARKERS,
    formatISODate, isValidISODate, secondTuesday, currentPatchday, previousPatchday, nextPatchday, monthLabel, daysBetween, patchdayHint,
    getDates, patchdayChoices,
    defaultSettings, normalizeSettings, buildProductList, buildPatchPrompt, formatSummary, countActive, safeInline,
    normalizeLineEndings, stripOuterCodeFence, countMarkdownTables, hasTabSeparatedTables,
    findMissingMarkers, countKbNumbers, parseMetadata, preprocessReport, buildReportRecord, normalizeReports, reportFileName, formatLocalDateTime,
  };
  if (typeof window !== 'undefined') window.NewsPatchCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
