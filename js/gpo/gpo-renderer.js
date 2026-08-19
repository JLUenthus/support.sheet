// ============================================================
// gpo-renderer.js – rendert das normalisierte Datenmodell und die
// Findings aus gpo-analyzer.js: Uebersicht (Zahlen-Grid + Ampel-
// Zeile, Konzept Abschnitt 4), Konflikt-Liste (Abschnitt 5),
// Redundanz-Liste (Abschnitt 6) und GPO-Hygiene (Hygiene-Checks +
// Security-Filter- + WMI-Filter-Findings, Abschnitt 8/9/10). Jeder
// Finding-Typ hat einen eigenen Karten-Builder, alle laufen ueber
// dieselbe CARD_BUILDERS-Dispatch-Tabelle - keine separate
// Verzweigung pro Liste. Regel-Texte (Name/Beschreibung/Empfehlung)
// kommen ausschliesslich aus finding.rule (data/gpo/rules.json via
// gpo-analyzer.js), nichts davon ist hier hart verdrahtet.
//
// "Auffaelligkeiten" in Zahlen-Grid/Ampel-Zeile zaehlt bewusst nur
// hygiene + security-filter. WMI-Filter-Findings sind reine
// Darstellung ohne Bewertung (Konzept Abschnitt 10) und wuerden als
// "Auffaelligkeit" mitgezaehlt faelschlich alarmistisch wirken -
// sie erscheinen trotzdem im GPO-Hygiene-Bereich, tragen aber nicht
// zur Ampel-Zahl bei.
// ============================================================
window.GpoRenderer = (function() {

  const MISSING_IMPACT = {
    'gpos.json': 'Keine Konfliktanalyse, keine Einstellungs-/Security-/WMI-Filter-Auswertung, keine GPO-Liste möglich.',
    'links.json': 'Kein Link-Baum, keine Enforced-/Block-Inheritance-Auswertung, "Unverknüpfte GPOs" nicht bestimmbar.',
    'filters.json': 'Security Filtering nicht auswertbar (z.B. Server-OU mit Benutzerfilter).',
    'wmi-filters.json': 'WMI-Filter-Namen und -Queries nicht auflösbar, nur die GUID bleibt sichtbar.',
    'metadata.json': 'Domänen-Name und Erstellungszeitpunkt des Snapshots fehlen.',
  };

  // Fester Hinweistext aus dem Konzept, Abschnitt 5/6 - jetzt der "Was"-
  // Baustein von buildFindingBody() (Roadmap Abschnitt 1.6).
  const CONFLICT_DESC  = 'Diese Einstellung wird von mehreren GPOs unterschiedlich definiert.';
  const REDUNDANT_DESC = 'Diese Einstellung wird von mehreren GPOs identisch definiert.';

  // Fester "Naechster Schritt"-Hinweis fuer Konflikte UND Mehrfach-
  // definitionen (Roadmap Abschnitt 1.6: "der feste Hinweis auf gpresult/
  // rsop.msc") - ersetzt das vorherige, laengere finding.hint aus
  // gpo-analyzer.js (dessen "Potenzieller Konflikt"-Einleitung jetzt
  // redundant waere, da die Bewertung diese Unterscheidung bereits ueber
  // scopeExplanation trifft).
  const SCOPE_CHECK_HINT = 'Effektive Richtlinie mit gpresult /h oder rsop.msc prüfen.';

  // Fallback-Text fuer den Fall, dass eine Regel (aktuell nur
  // WMI_FILTER_ASSIGNED) keine recommendations hinterlegt hat - "Naechster
  // Schritt" darf laut Roadmap Abschnitt 1.6 nie leer/fehlend sein.
  const NO_ACTION_HINT = 'Keine Aktion erforderlich – dient nur der Übersicht.';

  // V2.5.1 Hardening: "links.json fehlt komplett" (dataQuality.
  // linksFileMissing) ist NICHT dasselbe wie "links.json vorhanden, aber
  // leer" - Letzteres darf weiterhin ehrlich "0 Verknuepfungen"/"keine
  // Verknuepfung gefunden" zeigen. Nur der erste Fall bekommt diesen
  // neutralen Hinweis, an allen drei betroffenen Stellen (GPO Explorer,
  // GPO-Detailansicht, Scope-Visualisierung) im selben Wortlaut, damit sie
  // nicht auseinanderlaufen. renderNumGrid() (V2.1) traf dieselbe
  // Unterscheidung bereits korrekt und blieb hier unveraendert.
  const LINKS_FILE_MISSING_NOTE = 'Verknüpfungsdaten im Snapshot nicht vorhanden.';

  // Hygiene-Kategorisierung nach data/gpo/rules.json's "bucket"-Feld
  // (gpo-analyzer.js unveraendert, nur Anzeige - siehe .md/todo/
  // GPO_Analyzer_Roadmap_vor_v2_v2_spaeter.md, Abschnitt 1.3). Reihenfolge
  // hier ist gleichzeitig die Anzeige-Reihenfolge der Abschnitte.
  const BUCKET_ORDER = ['kritisch', 'pruefen', 'wartung', 'struktur', 'information'];
  const BUCKET_LABELS = {
    kritisch: '🔴 Kritisch',
    pruefen: '🟡 Prüfen',
    wartung: '🕒 Wartung',
    struktur: '🌳 Struktur',
    information: 'ℹ️ Information',
  };

  // Severity-basiertes Badge fuer Hygiene-Findings (statt vorher immer
  // fest "⚠") - notwendig, seit GPO_VERY_OLD von "warning" auf "info"
  // herabgestuft wurde (Abschnitt 1.4): sonst wuerde die weniger
  // alarmistische Einstufung im JSON von der UI ignoriert.
  const HYGIENE_SEVERITY_ICONS = { critical: '🔴', warning: '⚠', info: 'ℹ️' };

  // Sichtbare Labels je scopeRelation (gpo-analyzer.js, Prompt 2 /
  // .md/todo/GPO_Analyzer_Roadmap_vor_v2_v2_spaeter.md, Abschnitt 1.2).
  // "Redundant" taucht hier bewusst nirgends mehr auf - der Roadmap-Begriff
  // ist "Mehrfachdefinition".
  const REDUNDANT_SCOPE_LABELS = {
    overlap: '🔵 Identische Mehrfachdefinition',
    none: '🔵 Mehrfachdefinition ohne direkten Konflikt',
    mixed: '🔵 Mehrfachdefinition (gemischter Scope)',
    unknown: '🔵 Mehrfachdefinition (Scope unklar)',
  };

  // Labels fuer die Paar-fuer-Paar-Aufschluesselung bei scopeRelation
  // "mixed" (siehe buildRedundantCard()).
  const PAIR_RESULT_LABELS = {
    overlap: 'überlappt',
    none: 'getrennt',
    unknown: 'nicht sicher bestimmbar',
    mixed: 'teilweise überlappend',
  };

  // Verknuepfung mit dem Command-System (Konzept Abschnitt 15) - dieselben
  // vier Befehle fuer Konflikt- und Hygiene-Findings, aus data/commands.json
  // wiederverwendet statt hier dupliziert.
  const DIAGNOSE_COMMAND_IDS = [
    'gpo-gpo-status-anzeigen',              // gpresult /r
    'gpo-gpo-report-als-html',               // gpresult /h
    'gpo-rsop-anzeigen',                     // rsop.msc
    'gpo-richtlinien-sofort-aktualisieren',  // gpupdate /force
  ];

  // Finding-Typ-Filter (V2.2) - Mehrfachauswahl-Chips statt Radio-Gruppe,
  // damit Kombinationen wie "nur Konflikte + Mehrfachdefinitionen" moeglich
  // sind (Roadmap Abschnitt 2.2, Beispiel 3).
  const TYPE_FILTER_OPTIONS = [
    { key: 'conflict', label: 'Konflikte' },
    { key: 'redundant', label: 'Mehrfachdefinitionen' },
    { key: 'hygiene', label: 'Hygiene' },
    { key: 'security-filter', label: 'Security Filter' },
    { key: 'wmi-filter', label: 'WMI Filter' },
  ];

  const CONFLICT_STATUS_OPTIONS = [
    { key: 'all', label: 'Alle' },
    { key: 'real', label: 'Echte Konflikte' },
    { key: 'potential', label: 'Potenzielle Konflikte' },
  ];

  function freshTypeFilter() {
    const obj = {};
    TYPE_FILTER_OPTIONS.forEach(opt => { obj[opt.key] = true; });
    return obj;
  }

  let _model = null;
  let _findings = [];
  let _diagnoseCommands = [];
  let _missingFiles = [];
  const _state = {
    conflictQuery: '',
    redundantQuery: '',
    explorerQuery: '',
    // Alle drei unten reine Darstellungs-Filter (V2.2) - beeinflussen nur,
    // was renderConflictList()/renderRedundantList()/renderHygieneList()
    // anzeigen, nie die Findings selbst oder analyze().
    typeFilter: freshTypeFilter(),
    conflictStatusFilter: 'all',
    bucketFilter: 'all',
    // GPO-Explorer-Sortierung (V2.6.1) - Standard: auffaelligste/aelteste
    // GPOs zuerst (siehe sortExplorerGpos()).
    explorerSort: { column: 'findings', direction: 'desc' },
    // GPO-Status-Filter: 'all' | 'active' | 'disabled' - reiner
    // Darstellungs-Filter wie explorerQuery, wirkt NACH der Namenssuche und
    // VOR der bestehenden Sortierung (siehe renderExplorerList()). 'all' ist
    // Standard und muss die Liste unveraendert lassen.
    explorerStatusFilter: 'all',
  };

  // Finding -> bereits gerenderte Karte (Konflikt-/Redundanz-/Hygiene-Liste).
  // Erlaubt der Prioritaeten-Liste (V2.1 Dashboard), beim Klick direkt zur
  // bestehenden Karte zu springen und sie aufzuklappen, statt eine zweite
  // Kartendarstellung zu bauen. Wird in renderOverview() pro Snapshot-Load
  // geleert, in renderConflictList()/renderRedundantList()/renderHygieneList()
  // beim Bauen der jeweiligen Karten befuellt.
  const _findingCardMap = new Map();

  let _diagnoseCommandsPromise = null;
  function loadDiagnoseCommands() {
    if (!_diagnoseCommandsPromise) {
      _diagnoseCommandsPromise = fetch('./data/commands.json')
        .then(r => r.json())
        .then(data => (data.commands || []).filter(c => DIAGNOSE_COMMAND_IDS.includes(c.id)))
        .catch(() => []);
    }
    return _diagnoseCommandsPromise;
  }

  async function renderOverview(model, findings, missingFiles) {
    _model = model;
    _findings = findings || [];
    _diagnoseCommands = await loadDiagnoseCommands();
    _missingFiles = missingFiles || [];
    _state.conflictQuery = '';
    _state.redundantQuery = '';
    _state.explorerQuery = '';
    _state.typeFilter = freshTypeFilter();
    _state.conflictStatusFilter = 'all';
    _state.bucketFilter = 'all';
    _state.explorerSort = { column: 'findings', direction: 'desc' };
    _state.explorerStatusFilter = 'all';
    _findingCardMap.clear();
    resetSearchInputs();

    renderMissingHint(_missingFiles);
    renderExecutiveDashboard();
    renderIntegrityPanel();
    renderNumGrid();
    renderAmpelRow();
    renderMaintenancePanel();
    renderFilterBar();
    updateSectionVisibility();
    renderConflictList();
    renderRedundantList();
    renderHygieneList();
    renderPriorityList();
    renderExplorerList();
    renderOuTree();
    renderBsiCoverage();
    closeGpoDetail();
    document.getElementById('gpo-results').className = 'gpo-results-visible';
  }

  // Nur bei Konflikt- und Hygiene-Findings (Konzept Abschnitt 15) - reines
  // Anzeigen/Kopieren der Befehle, keine Bewertung. Wiederverwendet
  // createCommandCard() (js/render.js) 1:1 wie die echten Command-Grids auf
  // windows.html. Anders als die Live-Vorschau in mitmachen.html (dortiger
  // Bug: Stern/Kopieren schrieben auf einen noch nicht gespeicherten
  // Preview-Command) sind das hier echte, bereits in data/commands.json
  // persistierte Befehle mit stabiler ID - Stern/Kopieren duerfen hier ganz
  // normal funktionieren, das landet korrekt in denselben Favoriten-/
  // Recent-Keys wie auf windows.html.
  function buildDiagnoseSection() {
    if (!_diagnoseCommands.length) return null;
    const template = document.getElementById('command-template');
    if (!template || typeof createCommandCard !== 'function') return null;

    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Weiterführende Diagnose';
    wrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'gpo-diagnose-grid';
    _diagnoseCommands.forEach(cmd => grid.appendChild(createCommandCard(template, cmd)));
    wrap.appendChild(grid);

    return wrap;
  }

  function resetSearchInputs() {
    const conflictSearch = document.getElementById('gpo-conflict-search');
    if (conflictSearch) conflictSearch.value = '';
    const redundantSearch = document.getElementById('gpo-redundant-search');
    if (redundantSearch) redundantSearch.value = '';
    const explorerSearch = document.getElementById('gpo-explorer-search');
    if (explorerSearch) explorerSearch.value = '';
    const explorerStatusFilter = document.getElementById('gpo-explorer-status-filter');
    if (explorerStatusFilter) explorerStatusFilter.value = 'all';
  }

  // ── Fehlende-Datei-Hinweis ─────────────────────────────────
  function renderMissingHint(missingFiles) {
    const hint = document.getElementById('gpo-missing-hint');
    hint.replaceChildren();

    if (!missingFiles.length) {
      hint.hidden = true;
      return;
    }
    hint.hidden = false;

    const title = document.createElement('div');
    title.className = 'gpo-missing-title';
    title.textContent = '⚠️ Fehlende Datei(en) im ZIP – Analyzer läuft eingeschränkt weiter:';
    hint.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'gpo-missing-list';
    missingFiles.forEach(filename => {
      const li = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = filename;
      li.appendChild(code);
      const impact = MISSING_IMPACT[filename];
      if (impact) li.append(' – ' + impact);
      list.appendChild(li);
    });
    hint.appendChild(list);
  }

  // ── Executive Dashboard (V3.4) ──────────────────────────────
  // Reine Zusammenfuehrung bereits vorhandener Zahlen (GPO-Status,
  // Findings-Typen, Computer-Population) in einer kompakten Kopfsektion -
  // keine neue fachliche Berechnung, keine Prozent-/Score-Verdichtung
  // (siehe Auftrag: ausdrueklich nur absolute Zahlen, kein "X von Y").
  // Alle Zahlen kommen aus bereits vorhandenen Funktionen/Feldern
  // (countByType(), gpoExplorerStatusCategory(), evaluateComputerCoverage())
  // - dieser Block fuegt nur Anzeige hinzu, keine neue Zaehl-/Bewertungslogik.
  function buildKpiTile(label, value, anchor) {
    const item = document.createElement('a');
    item.className = 'gpo-num-item';
    item.href = anchor;
    const val = document.createElement('div');
    val.className = 'gpo-num-value';
    val.textContent = value;
    const lbl = document.createElement('div');
    lbl.className = 'gpo-num-label';
    lbl.textContent = label;
    item.append(val, lbl);
    return item;
  }

  // Nutzt dieselbe Klassifizierung wie der GPO-Explorer-Statusfilter
  // (gpoExplorerStatusCategory(), s.u.) - keine zweite Interpretation von
  // gpo.status. "Unbekannt" erscheint nur, wenn es tatsaechlich GPOs ohne
  // eindeutigen Status gibt, sonst staende dauerhaft eine bedeutungslose
  // Null-Kachel da.
  function renderDashboardGpoTiles() {
    const grid = document.getElementById('gpo-kpi-gpo-grid');
    if (!grid) return;
    grid.replaceChildren();

    const gpos = _model.gpos || [];
    let active = 0, disabled = 0, unknown = 0;
    gpos.forEach(g => {
      const cat = gpoExplorerStatusCategory(g);
      if (cat === 'active') active++;
      else if (cat === 'disabled') disabled++;
      else unknown++;
    });

    grid.appendChild(buildKpiTile('GPOs gesamt', gpos.length, '#gpo-explorer-section'));
    grid.appendChild(buildKpiTile('Aktiv', active, '#gpo-explorer-section'));
    grid.appendChild(buildKpiTile('Deaktiviert', disabled, '#gpo-explorer-section'));
    if (unknown > 0) grid.appendChild(buildKpiTile('Unbekannter Status', unknown, '#gpo-explorer-section'));
  }

  // Ausschliesslich die bereits vorhandenen countByType()-Zahlen (dieselbe
  // Quelle wie renderFilterBar()/renderAmpelRow()) - keine neue Aggregation.
  function renderDashboardFindingsTiles() {
    const grid = document.getElementById('gpo-kpi-findings-grid');
    if (!grid) return;
    grid.replaceChildren();

    grid.appendChild(buildKpiTile('Findings gesamt', _findings.length, '#gpo-overview-section'));
    grid.appendChild(buildKpiTile('Konflikte', countByType('conflict'), '#gpo-conflict-section'));
    grid.appendChild(buildKpiTile('Mehrfachdefinitionen', countByType('redundant'), '#gpo-redundant-section'));
    grid.appendChild(buildKpiTile('Hygiene', countByType('hygiene'), '#gpo-hygiene-section'));
    grid.appendChild(buildKpiTile('Security-Filter', countByType('security-filter'), '#gpo-hygiene-section'));
    grid.appendChild(buildKpiTile('WMI-Filter', countByType('wmi-filter'), '#gpo-hygiene-section'));
  }

  // Computer-Population: greift ausschliesslich auf die bereits fuer die
  // BSI-Coverage berechneten Kategorie-Totale zurueck (evaluateComputerCoverage(),
  // bsi-mapping.js) statt eine eigene Zaehllogik ueber model.computers zu
  // bauen - die Kategorie-Totale sind je Requirement identisch (dieselbe
  // Computer-Population), ein beliebiges Requirement (hier NTLM) reicht
  // deshalb als Quelle. computersFileMissing wird exakt wie in
  // renderBsiCoverage() behandelt (dieselbe _model.dataQuality-Quelle,
  // dieselbe Fallback-Aussage) statt eine zweite Pruefung zu erfinden.
  function renderDashboardComputerTiles() {
    const grid = document.getElementById('gpo-kpi-computer-grid');
    const missingHint = document.getElementById('gpo-kpi-computer-missing');
    if (!grid || !missingHint) return;
    grid.replaceChildren();

    const dataQuality = _model.dataQuality || {};
    if (dataQuality.computersFileMissing) {
      grid.hidden = true;
      missingHint.hidden = false;
      missingHint.textContent = 'Keine computers.json im Snapshot vorhanden. Computer-Population kann für diesen Snapshot nicht ausgewertet werden.';
      return;
    }
    if (!window.GpoBsiMapping || typeof window.GpoBsiMapping.evaluateComputerCoverage !== 'function') {
      grid.hidden = true;
      missingHint.hidden = false;
      missingHint.textContent = 'BSI-Coverage-Modul nicht verfügbar.';
      return;
    }
    grid.hidden = false;
    missingHint.hidden = true;

    const coverage = window.GpoBsiMapping.evaluateComputerCoverage(_model);
    const ntlmId = window.GpoBsiMapping.REQUIREMENT_IDS.NTLM_LM_LEVEL;
    const reference = coverage[ntlmId];
    if (!reference) return;

    grid.appendChild(buildKpiTile('Domain Controllers', reference.categories.domain_controllers.total, '#gpo-bsi-section'));
    grid.appendChild(buildKpiTile('Member Server', reference.categories.member_servers.total, '#gpo-bsi-section'));
    grid.appendChild(buildKpiTile('Clients', reference.categories.clients.total, '#gpo-bsi-section'));
    grid.appendChild(buildKpiTile('Unknown', reference.unknown, '#gpo-bsi-section'));
  }

  // Neutraler Verweis auf die bestehende, detaillierte BSI-Coverage-Ansicht -
  // bewusst keine eigene Verdichtungszahl/kein Prozentwert, nur die Anzahl
  // der bereits bestehenden Requirements (BSI_REQUIREMENT_ORDER, s.u.), die
  // strukturell unabhaengig von computers.json feststeht.
  function renderDashboardBsiLink() {
    const link = document.getElementById('gpo-kpi-bsi-link');
    if (!link) return;
    link.textContent = '🛡️ BSI-Coverage verfügbar für ' + BSI_REQUIREMENT_ORDER.length + ' Requirements →';
  }

  function renderExecutiveDashboard() {
    renderDashboardGpoTiles();
    renderDashboardFindingsTiles();
    renderDashboardComputerTiles();
    renderDashboardBsiLink();
  }

  // ── Snapshot-Integritaet ────────────────────────────────────
  // Eigenstaendiger Status ueber die Belastbarkeit der Analyse (Konzept/
  // .md/todo/GPO_Analyzer_Pre_Real_Data_Hardening.md, Abschnitt 9/10) -
  // getrennt von renderMissingHint() (welche DATEIEN im ZIP fehlen) und
  // bewusst KEIN Finding mit Severity, sondern reine Datenqualitaets-
  // Aussage ueber einzelne GPO-Reports.
  function renderIntegrityPanel() {
    const panel = document.getElementById('gpo-integrity-panel');
    if (!panel) return;
    panel.replaceChildren();

    const total = _model.gpos.length;
    const failed = _model.gpos.filter(g => g.parseStatus === 'failed');
    const partial = _model.gpos.filter(g => g.parseStatus === 'partial');

    if (!failed.length && !partial.length) {
      panel.className = 'gpo-integrity-panel gpo-integrity-panel--ok';
      const title = document.createElement('div');
      title.textContent = '✓ Snapshot vollständig';
      const sub = document.createElement('div');
      sub.className = 'gpo-integrity-sub';
      sub.textContent = total + '/' + total + ' GPOs gelesen';
      panel.append(title, sub);
      return;
    }

    panel.className = 'gpo-integrity-panel gpo-integrity-panel--warn';

    const title = document.createElement('div');
    title.className = 'gpo-integrity-title';
    title.textContent = '⚠ Snapshot teilweise auswertbar';
    panel.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'gpo-integrity-sub';
    sub.textContent = (failed.length + partial.length) + ' GPO(s) mit Einschränkungen';
    panel.appendChild(sub);

    const list = document.createElement('ul');
    list.className = 'gpo-integrity-list';
    if (failed.length) {
      const li = document.createElement('li');
      li.textContent = failed.length + ' GPO-Report(s) konnten nicht gelesen werden: '
        + failed.map(g => g.name).join(', ');
      list.appendChild(li);
    }
    if (partial.length) {
      const li = document.createElement('li');
      li.textContent = partial.length + ' GPO(s) nur teilweise auswertbar: '
        + partial.map(g => g.name).join(', ');
      list.appendChild(li);
    }
    panel.appendChild(list);
  }

  // ── Zahlen-Grid + Ampel-Zeile ──────────────────────────────
  function countByType(type) {
    return _findings.filter(f => f.type === type).length;
  }

  // Konflikte werden nach conflictLevel getrennt gezaehlt (Roadmap
  // .md/todo/GPO_Analyzer_Roadmap_vor_v2_v2_spaeter.md, Abschnitt 1.1/2.1:
  // "echte" vs. "potenzielle" Konflikte statt einer einzigen Zahl).
  function countByConflictLevel(level) {
    return _findings.filter(f => f.type === 'conflict' && f.conflictLevel === level).length;
  }

  // Hygiene + Security-Filter zaehlen als "Auffaelligkeit", WMI-Filter
  // bewusst nicht (siehe Kommentar am Dateianfang).
  function anomalyCount() {
    return _findings.filter(f => f.type === 'hygiene' || f.type === 'security-filter').length;
  }

  // Dashboard-Kompaktuebersicht (V2.1, .md/todo/GPO_Analyzer_Roadmap...
  // Abschnitt 2.1): nur noch die reinen Bestandszahlen des Snapshots (GPOs,
  // Verknuepfungen). Konflikt-/Redundanz-/Pruefungs-Zahlen stehen nur noch
  // in renderAmpelRow() - vorher standen dieselben Zahlen redundant in
  // beiden Bloecken.
  function renderNumGrid() {
    const grid = document.getElementById('gpo-num-grid');
    grid.replaceChildren();

    // null = "nicht bestimmbar" (links.json fehlte im ZIP) statt einer
    // falschen Zahl - siehe .md/todo/GPO_Analyzer_Pre_Real_Data_Hardening.md,
    // Abschnitt 8: eine fehlende Links-Datei darf nicht als "0 Verknuepfungen"
    // dargestellt werden.
    const linksFileMissing = _model.dataQuality && _model.dataQuality.linksFileMissing;

    [
      ['GPOs', _model.gpos.length],
      ['Verknüpfungen', linksFileMissing ? null : _model.links.length],
    ].forEach(([label, value]) => {
      const item = document.createElement('a');
      item.className = 'gpo-num-item';
      item.href = '#gpo-tree-section';
      const val = document.createElement('div');
      val.className = 'gpo-num-value';
      val.textContent = value === null ? '–' : value;
      const lbl = document.createElement('div');
      lbl.className = 'gpo-num-label';
      lbl.textContent = label;
      item.appendChild(val);
      item.appendChild(lbl);
      grid.appendChild(item);
    });
  }

  // Findings-Uebersicht (V2.1 Dashboard): die einzige Stelle, an der
  // Konflikt-/Mehrfachdefinitions-/Pruefungs-Zahlen erscheinen. Jede Kachel
  // springt zur zugehoerigen Sektion (Anker) - echtes Klick-zu-Filter kommt
  // erst mit der Filter-Infrastruktur aus V2.2 (siehe Roadmap).
  // Kachel-Klicks setzen jetzt zusaetzlich den passenden Filter (V2.2) -
  // der Anker-Sprung aus V2.1 bleibt (href unveraendert), es kommt nur ein
  // weiterer Listener dazu, kein zweiter, paralleler Klick-Mechanismus.
  // V2.7.2: sehr kurze Erklaerungszeile je Karte - erzeugt bewusst KEINE neue
  // fachliche Aussage, sondern spiegelt nur die bereits vorhandene Severity-
  // Einstufung dieser Gruppe in ein Handlungswort (critical -> "direkt",
  // warning -> "manuell/bei Bedarf", info -> "zur Info", identisch zu den
  // bereits bestehenden Texten SCOPE_CHECK_HINT/POTENTIAL_CONFLICT_NOTE bzw.
  // dem konstant "info"-Severity-Feld bei Mehrfachdefinitionen in
  // gpo-analyzer.js). Bei 0 ersetzt "Keine gefunden" den Hinweis, statt eine
  // Handlungsaufforderung fuer eine leere Gruppe stehen zu lassen.
  function ampelHint(count, nonZeroHint) {
    return count === 0 ? 'Keine gefunden' : nonZeroHint;
  }

  // V2.7.1/V2.7.2: severityKey treibt nur die CSS-Modifier-Klasse (Farbgebung
  // aus bestehenden Severity-Farben) - Zahl/Anchor/Klick-Handler bleiben
  // exakt wie zuvor. count === 0 bekommt bewusst KEINE Alarm-Farbe (gruen/
  // Haekchen statt rot/gelb/blau), damit das Dashboard bei 0 Findings
  // beruhigend statt kaputt wirkt (Anforderung "muss auch bei 0 Findings
  // sinnvoll aussehen").
  function renderAmpelRow() {
    const row = document.getElementById('gpo-ampel-row');
    row.replaceChildren();

    [
      ['🔴', countByConflictLevel('real'), 'Echte Konflikte', '#gpo-conflict-section', 'critical',
        ampelHint(countByConflictLevel('real'), 'Direkt prüfen'),
        () => { setExclusiveTypeFilter('conflict'); _state.conflictStatusFilter = 'real'; applyFilters(); }],
      ['🟡', countByConflictLevel('potential'), 'Potenzielle Konflikte', '#gpo-conflict-section', 'warning',
        ampelHint(countByConflictLevel('potential'), 'Manuell prüfen'),
        () => { setExclusiveTypeFilter('conflict'); _state.conflictStatusFilter = 'potential'; applyFilters(); }],
      ['🔵', countByType('redundant'), 'Mehrfachdefinitionen', '#gpo-redundant-section', 'info',
        ampelHint(countByType('redundant'), 'Zur Info'),
        () => { setExclusiveTypeFilter('redundant'); applyFilters(); }],
      ['⚠', anomalyCount(), 'Prüfungen', '#gpo-hygiene-section', 'warning',
        ampelHint(anomalyCount(), 'Bei Bedarf prüfen'),
        () => { setExclusiveTypeFilter('hygiene', 'security-filter'); applyFilters(); }],
    ].forEach(([icon, count, label, anchor, severityKey, hint, onClick]) => {
      const isZero = count === 0;

      const pill = document.createElement('a');
      pill.className = 'gpo-ampel-pill ' + (isZero ? 'gpo-ampel-pill--zero' : 'gpo-ampel-pill--' + severityKey);
      pill.href = anchor;

      const top = document.createElement('span');
      top.className = 'gpo-ampel-top';
      const iconEl = document.createElement('span');
      iconEl.className = 'gpo-ampel-icon';
      iconEl.textContent = isZero ? '✓' : icon;
      const countEl = document.createElement('span');
      countEl.className = 'gpo-ampel-count';
      countEl.textContent = count;
      top.append(iconEl, countEl);

      const labelEl = document.createElement('span');
      labelEl.className = 'gpo-ampel-label';
      labelEl.textContent = label;

      const hintEl = document.createElement('span');
      hintEl.className = 'gpo-ampel-hint';
      hintEl.textContent = hint;

      pill.append(top, labelEl, hintEl);
      pill.addEventListener('click', onClick);
      row.appendChild(pill);
    });
  }

  // ── Wartungsampel (V2.6.2) ───────────────────────────────────
  // Eigene, optisch zurueckhaltende Zeile getrennt von der roten/gelben
  // Ampel-Zeile - Wartung transportiert keine Dringlichkeit im selben Sinn
  // wie Konflikte/Pruefungen. Zahlen ausschliesslich aus bereits
  // vorhandenen Findings mit rule.bucket === "wartung" (rules.json,
  // unveraendert) - keine neue Analyse, kein neuer Schwellenwert.
  //
  // Hinweis: aktuell traegt in rules.json nur GPO_VERY_OLD den Bucket
  // "wartung" (GPO_NO_SETTINGS ist "information", GPO_NO_LINKS ist
  // "struktur") - die Aufschluesselung zeigt deshalb zurzeit nur "sehr alt"
  // als Unterkategorie, nicht die im Roadmap-Beispiel zusaetzlich
  // genannten "ohne Einstellungen"/"ohne Verknuepfung". Das ist beabsichtigt
  // (strikt nur bucket === "wartung", kein Reklassifizieren bestehender
  // Regeln) und wird im Abschlussbericht dokumentiert statt eigenmaechtig
  // rules.json anzupassen.
  const MAINTENANCE_SHORT_LABELS = { GPO_VERY_OLD: 'sehr alt' };

  function maintenanceShortLabel(f) {
    return MAINTENANCE_SHORT_LABELS[f.rule.id] || resolveRuleText(f.rule.name, f.detail) || f.rule.id;
  }

  function collectMaintenanceFindings() {
    return _findings.filter(f => f.rule && f.rule.bucket === 'wartung');
  }

  function renderMaintenancePanel() {
    const container = document.getElementById('gpo-maintenance-panel');
    if (!container) return;
    container.replaceChildren();

    const items = collectMaintenanceFindings();
    if (!items.length) return;

    const countByLabel = new Map();
    items.forEach(f => {
      const label = maintenanceShortLabel(f);
      countByLabel.set(label, (countByLabel.get(label) || 0) + 1);
    });

    // Wiederverwendet .gpo-ampel-pill (bereits neutral/gedaempft, keine
    // Rot-/Gelbfaerbung) statt einer zweiten Pill-Optik - "zurueckhaltend"
    // entsteht hier durch die eigene Zeile + das nicht-alarmierende Icon,
    // nicht durch eine neue Farbdefinition.
    const pill = document.createElement('a');
    pill.className = 'gpo-ampel-pill';
    pill.href = '#gpo-hygiene-section';
    pill.textContent = '🧹 ' + items.length + ' ' + (items.length === 1 ? 'GPO' : 'GPOs') + ' zur Prüfung vorgeschlagen';
    // Derselbe Mechanismus wie die bestehenden Bucket-Kacheln (V2.1/V2.2,
    // siehe renderHygieneList()) - keine zweite Filterlogik.
    pill.addEventListener('click', () => {
      setExclusiveTypeFilter('hygiene', 'security-filter', 'wmi-filter');
      _state.bucketFilter = 'wartung';
      applyFilters();
    });
    container.appendChild(pill);

    const breakdown = document.createElement('div');
    breakdown.className = 'gpo-maintenance-breakdown';
    breakdown.textContent = 'davon: ' + [...countByLabel.entries()].map(([label, count]) => count + ' ' + label).join(', ');
    container.appendChild(breakdown);
  }

  // ── Filter-Leiste (V2.2) ─────────────────────────────────────
  // Reine Darstellungs-Filterung auf den bereits von analyze() berechneten
  // Findings - keine erneute Analyse, keine Datenaenderung. passesFilters()
  // ist die einzige Stelle, an der die Filterlogik steht; alle drei Listen
  // (Konflikt/Redundanz/Hygiene) rufen dieselbe Funktion auf statt sie
  // eigenstaendig zu duplizieren.
  function passesFilters(f) {
    if (!_state.typeFilter[f.type]) return false;
    if (f.type === 'conflict' && _state.conflictStatusFilter !== 'all' && f.conflictLevel !== _state.conflictStatusFilter) {
      return false;
    }
    if (['hygiene', 'security-filter', 'wmi-filter'].includes(f.type) && _state.bucketFilter !== 'all') {
      if (!f.rule || f.rule.bucket !== _state.bucketFilter) return false;
    }
    return true;
  }

  // V2.5.1: minimale Filter-Korrektur, damit genau EIN Finding (Klick auf
  // einen Prioritaeten-Eintrag) sichtbar wird - spiegelt exakt dieselben
  // drei Bedingungen wie passesFilters() oben, dreht aber nur die
  // Bedingung(en) um, die dieses eine Finding gerade ausblenden. Anders als
  // setExclusiveTypeFilter() (Dashboard-/Bucket-Kacheln) werden andere
  // bereits aktive Typen NICHT abgewaehlt - der Nutzer soll seinen
  // bestehenden Filter nicht mehr als noetig verlieren. Aendert _state.*
  // direkt, keine zweite/parallele Filterauswertung.
  function ensureFindingPassesFilter(f) {
    if (!_state.typeFilter[f.type]) {
      _state.typeFilter[f.type] = true;
    }
    if (f.type === 'conflict' && _state.conflictStatusFilter !== 'all' && f.conflictLevel !== _state.conflictStatusFilter) {
      _state.conflictStatusFilter = f.conflictLevel;
    }
    if (['hygiene', 'security-filter', 'wmi-filter'].includes(f.type) && _state.bucketFilter !== 'all') {
      const bucket = f.rule && f.rule.bucket;
      if (!bucket || bucket !== _state.bucketFilter) {
        _state.bucketFilter = bucket || 'all';
      }
    }
  }

  function setExclusiveTypeFilter(...types) {
    TYPE_FILTER_OPTIONS.forEach(opt => { _state.typeFilter[opt.key] = types.includes(opt.key); });
  }

  function isAllTypesActive() {
    return TYPE_FILTER_OPTIONS.every(opt => _state.typeFilter[opt.key]);
  }

  // Blendet ganze Abschnitte aus, wenn ihr Finding-Typ komplett abgewaehlt
  // ist (statt eine leere Sektion mit Leer-Text stehen zu lassen) - zeigt
  // stattdessen den Seiten-weiten Hinweis, wenn dadurch WIRKLICH nichts
  // mehr uebrig bleibt (kein leerer Bildschirm, Roadmap Abschnitt 2.2).
  function updateSectionVisibility() {
    const conflictSection = document.getElementById('gpo-conflict-section');
    const redundantSection = document.getElementById('gpo-redundant-section');
    const hygieneSection = document.getElementById('gpo-hygiene-section');
    const emptyState = document.getElementById('gpo-filter-empty-state');

    const showConflict = _state.typeFilter.conflict;
    const showRedundant = _state.typeFilter.redundant;
    const showHygiene = _state.typeFilter.hygiene || _state.typeFilter['security-filter'] || _state.typeFilter['wmi-filter'];

    if (conflictSection) conflictSection.hidden = !showConflict;
    if (redundantSection) redundantSection.hidden = !showRedundant;
    if (hygieneSection) hygieneSection.hidden = !showHygiene;
    if (emptyState) emptyState.hidden = showConflict || showRedundant || showHygiene;
  }

  // Wird bei jeder Filter-Aenderung aufgerufen - rendert nur die Filter-
  // Leiste selbst und die drei bestehenden Listen neu (aus den bereits
  // vorhandenen _findings), ruft nie analyze() erneut auf. Zahlen-Grid/
  // Ampel-Zeile/Prioritaeten-Liste bleiben bewusst unveraendert (zeigen
  // weiterhin die tatsaechlichen Gesamtzahlen des Snapshots, nicht die
  // gerade gefilterte Ansicht).
  function applyFilters() {
    updateSectionVisibility();
    renderFilterBar();
    // Verworfene DOM-Referenzen aus dem vorherigen Filterstand nicht
    // stehen lassen (V2.5.1) - die drei Listen unten tragen ihre aktuell
    // gerenderten Karten sofort wieder ein.
    _findingCardMap.clear();
    renderConflictList();
    renderRedundantList();
    renderHygieneList();
  }

  function buildFilterSelect(options, currentValue, onChange) {
    const select = document.createElement('select');
    select.className = 'gpo-filter-select';
    options.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.key;
      o.textContent = opt.label;
      if (opt.key === currentValue) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', (e) => onChange(e.target.value));
    return select;
  }

  // V2.7.4: reine Anzeige-Ummantelung um buildFilterSelect() (unveraendert)
  // - haengt nur ein kleines Feldlabel davor ("Status"/"Bucket"), damit auf
  // einen Blick klar ist, welches Select welchen Filter setzt, statt zwei
  // nebeneinanderstehende, anfangs identisch beschriftete "Alle"-Dropdowns
  // zu haben. Keine neue Werte-/Change-Logik, onChange bleibt exakt wie
  // uebergeben.
  function buildLabeledSelect(labelText, options, currentValue, onChange) {
    const wrap = document.createElement('span');
    wrap.className = 'gpo-filter-select-wrap';
    const label = document.createElement('span');
    label.className = 'gpo-filter-select-label';
    label.textContent = labelText;
    wrap.append(label, buildFilterSelect(options, currentValue, onChange));
    return wrap;
  }

  // Zweites Filterfeld ist kontextabhaengig ("Konfliktstatus: falls
  // vorhanden"): Konfliktstatus nur sichtbar, wenn Konflikte ueberhaupt
  // angezeigt werden, Bucket-Filter nur, wenn mindestens einer der
  // Bucket-tragenden Typen angezeigt wird.
  // V2.7.4: reine Darstellungs-Gruppierung ("Finding-Typ"/"Optionen"/
  // "Ergebnis") um dieselben drei Bereiche - passesFilters()/
  // ensureFindingPassesFilter()/_state und alle Klick-Handler bleiben exakt
  // wie zuvor, hier aendert sich ausschliesslich Beschriftung/Optik.
  function renderFilterBar() {
    const typeRow = document.getElementById('gpo-filter-type-row');
    const secondaryRow = document.getElementById('gpo-filter-secondary-row');
    const secondaryGroup = document.getElementById('gpo-filter-secondary-group');
    if (!typeRow || !secondaryRow) return;
    typeRow.replaceChildren();
    secondaryRow.replaceChildren();

    // "Alle" bleibt fachlich ein normaler Typ-Filter-Reset (dieselben drei
    // _state-Zuweisungen wie zuvor), bekommt aber eine eigene CSS-Klasse
    // und - nur wenn es tatsaechlich etwas zurueckzusetzen gibt - ein
    // Reset-Icon, damit er als Reset-Aktion schnell auffindbar ist statt
    // wie ein gleichwertiger Typ-Chip zwischen den anderen unterzugehen.
    const allActive = isAllTypesActive() && _state.conflictStatusFilter === 'all' && _state.bucketFilter === 'all';
    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'gpo-filter-chip gpo-filter-chip--reset' + (allActive ? ' gpo-filter-chip--active' : '');
    allChip.textContent = (allActive ? '' : '↺ ') + 'Alle';
    allChip.addEventListener('click', () => {
      _state.typeFilter = freshTypeFilter();
      _state.conflictStatusFilter = 'all';
      _state.bucketFilter = 'all';
      applyFilters();
    });
    typeRow.appendChild(allChip);

    TYPE_FILTER_OPTIONS.forEach(opt => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'gpo-filter-chip' + (_state.typeFilter[opt.key] ? ' gpo-filter-chip--active' : '');
      chip.textContent = opt.label;
      chip.addEventListener('click', () => {
        _state.typeFilter[opt.key] = !_state.typeFilter[opt.key];
        applyFilters();
      });
      typeRow.appendChild(chip);
    });

    if (_state.typeFilter.conflict) {
      secondaryRow.appendChild(buildLabeledSelect('Status', CONFLICT_STATUS_OPTIONS, _state.conflictStatusFilter, (val) => {
        _state.conflictStatusFilter = val;
        applyFilters();
      }));
    }

    if (_state.typeFilter.hygiene || _state.typeFilter['security-filter'] || _state.typeFilter['wmi-filter']) {
      const bucketOptions = [{ key: 'all', label: 'Alle' }].concat(BUCKET_ORDER.map(b => ({ key: b, label: BUCKET_LABELS[b] })));
      secondaryRow.appendChild(buildLabeledSelect('Bucket', bucketOptions, _state.bucketFilter, (val) => {
        _state.bucketFilter = val;
        applyFilters();
      }));
    }

    // "Optionen"-Gruppe nur anzeigen, wenn tatsaechlich mindestens ein
    // Select gerendert wurde - sonst bliebe eine leere Ueberschrift stehen.
    if (secondaryGroup) secondaryGroup.hidden = secondaryRow.children.length === 0;

    // V2.6.3: macht sichtbar, wie viele Findings die aktuelle Chip-/Select-
    // Kombination ergibt - ueber dieselbe passesFilters()-Funktion wie die
    // drei Listen selbst, keine zweite Zaehllogik. Bewusst klein/gedaempft
    // gestaltet (siehe CSS), damit es nicht mit den grossen, fett
    // gesetzten Dashboard-Gesamtzahlen (Zahlen-Grid/Ampel-Zeile, bleiben
    // unveraendert) verwechselt wird.
    const resultCountEl = document.getElementById('gpo-filter-result-count');
    if (resultCountEl) {
      const count = _findings.filter(passesFilters).length;
      resultCountEl.textContent = count + ' ' + (count === 1 ? 'Ergebnis' : 'Ergebnisse');
    }
  }

  // ── Prioritaeten-Liste (V2.1 Dashboard) ─────────────────────
  // Reine Anzeige-Priorisierung ueber bereits vorhandene Felder, keine neue
  // Analyse-Logik: echte Konflikte > potenzielle Konflikte > Hygiene-/
  // Security-Filter-Findings im Bucket "kritisch" > alle uebrigen Hygiene-/
  // Security-Filter-Findings (Roadmap: Prioritaet 1-4). Maximal 5 Eintraege.
  function priorityIcon(f) {
    if (f.type === 'conflict') return f.conflictLevel === 'real' ? '🔴' : '🟡';
    if (f.rule && f.rule.bucket === 'kritisch') return '🔴';
    return HYGIENE_SEVERITY_ICONS[f.severity] || '⚠';
  }

  function priorityLabel(f) {
    if (f.type === 'conflict') return splitSettingKey(f.settingKey).name;
    const ruleName = resolveRuleText(f.rule && f.rule.name, f.detail) || 'Prüfung';
    return ruleName + ' – ' + f.gpoName;
  }

  function priorityAnchor(f) {
    return f.type === 'conflict' ? '#gpo-conflict-section' : '#gpo-hygiene-section';
  }

  function collectPriorityFindings() {
    const realConflicts = _findings.filter(f => f.type === 'conflict' && f.conflictLevel === 'real');
    const potentialConflicts = _findings.filter(f => f.type === 'conflict' && f.conflictLevel === 'potential');
    const criticalChecks = _findings.filter(f => ['hygiene', 'security-filter'].includes(f.type) && f.rule && f.rule.bucket === 'kritisch');
    const otherChecks = _findings.filter(f => ['hygiene', 'security-filter'].includes(f.type) && !(f.rule && f.rule.bucket === 'kritisch'));

    const items = [];
    [realConflicts, potentialConflicts, criticalChecks, otherChecks].forEach(group => {
      group.forEach(f => { if (items.length < 5) items.push(f); });
    });
    return items;
  }

  // Springt bevorzugt direkt zur bereits gerenderten Karte in der jeweiligen
  // Liste (ueber _findingCardMap) und klappt sie auf - dieselbe Karte, keine
  // zweite Darstellung. Ist sie nicht (mehr) im DOM (z.B. durch die
  // Setting-Suche herausgefiltert), uebernimmt der native Anker-Sprung zur
  // Sektion.
  function buildPriorityItem(f) {
    const iconChar = priorityIcon(f);
    // V2.7.1: linker Akzentstreifen je Schwere - dieselbe Zuordnung wie
    // explorerFindingsBadgeInfo() (PRIORITY_ICON_SEVERITY_CLASS, V2.6.1),
    // keine zweite Severity-Einstufung.
    const severityClass = PRIORITY_ICON_SEVERITY_CLASS[iconChar] || 'info';

    const item = document.createElement('a');
    item.className = 'gpo-priority-item gpo-priority-item--' + severityClass;
    item.href = priorityAnchor(f);

    const icon = document.createElement('span');
    icon.className = 'gpo-priority-icon';
    icon.textContent = iconChar;

    const label = document.createElement('span');
    label.className = 'gpo-priority-label';
    label.textContent = priorityLabel(f);

    item.append(icon, label);

    // V2.5.1: die Prioritaetenliste selbst bleibt filterunabhaengig (zeigt
    // immer die echten Top-5) - erst der Klick gleicht den bestehenden
    // Filterzustand minimal ab, damit GENAU dieses Finding sichtbar wird,
    // ueber dieselbe passesFilters()/applyFilters()-Infrastruktur wie die
    // Filter-Leiste selbst. Kein Filterwechsel, wenn das Finding ohnehin
    // schon sichtbar ist.
    item.addEventListener('click', (e) => {
      e.preventDefault();

      if (!passesFilters(f)) {
        ensureFindingPassesFilter(f);
        applyFilters();
      }

      const card = _findingCardMap.get(f);
      if (card && card.isConnected) {
        const body = card.querySelector('.gpo-finding-body');
        const expand = card.querySelector('.gpo-finding-expand');
        if (body) body.classList.add('open');
        if (expand) expand.classList.add('open');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        const target = document.querySelector(item.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    return item;
  }

  // V2.7.1: Ebene 4 der Dashboard-Hierarchie ("Was sollte ich zuerst
  // ansehen?") - bleibt immer sichtbar, auch bei 0 Findings, statt bei
  // leerer Liste komplett zu verschwinden (Anforderung "Dashboard muss auch
  // bei 0 Findings sinnvoll aussehen"). collectPriorityFindings() selbst ist
  // unveraendert (weiterhin dieselbe Top-5-Priorisierung, keine neue Logik).
  function renderPriorityList() {
    const container = document.getElementById('gpo-priority-list');
    if (!container) return;
    container.replaceChildren();

    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Was sollte ich zuerst ansehen?';
    container.appendChild(title);

    const items = collectPriorityFindings();
    if (!items.length) {
      const ok = document.createElement('div');
      ok.className = 'gpo-priority-ok';
      ok.textContent = '✅ Keine dringenden Probleme gefunden.';
      container.appendChild(ok);
      return;
    }

    items.forEach(f => container.appendChild(buildPriorityItem(f)));
  }

  // ── Gemeinsame Helfer fuer Konflikt-/Redundanz-Karten ──────
  function splitSettingKey(settingKey) {
    const idx = settingKey.lastIndexOf(' > ');
    if (idx === -1) return { category: null, name: settingKey };
    return { category: settingKey.slice(0, idx), name: settingKey.slice(idx + 3) };
  }

  function linksForGpo(gpoId) {
    return (_model.links || []).filter(l => l.gpoId === gpoId);
  }

  function gpoById(gpoId) {
    return (_model.gpos || []).find(g => g.id === gpoId);
  }

  function buildDetailSection(finding, category) {
    const wrap = document.createElement('div');
    wrap.className = 'gpo-detail';

    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Details';
    wrap.appendChild(title);

    if (category) {
      const catRow = document.createElement('div');
      catRow.className = 'gpo-detail-row';
      catRow.textContent = 'Pfad: ' + category;
      wrap.appendChild(catRow);
    }

    finding.entries.forEach(entry => {
      const gpoDetail = document.createElement('div');
      gpoDetail.className = 'gpo-detail-gpo';

      const gpoTitle = document.createElement('div');
      gpoTitle.className = 'gpo-detail-gpo-title';
      gpoTitle.textContent = entry.gpoName;
      gpoDetail.appendChild(gpoTitle);

      gpoDetail.appendChild(buildLinkList(entry.gpoId, finding.type));
      // V3.0 Effective Scope: GPO-Name steht bereits in gpoTitle direkt
      // darueber, deshalb ohne labelPrefix.
      const detailGpo = gpoById(entry.gpoId);
      if (detailGpo) appendScopeConstraintNote(gpoDetail, detailGpo);

      wrap.appendChild(gpoDetail);
    });

    return wrap;
  }

  // Gruppenbezeichnung je Finding-Typ fuer den "0 Links"-Hinweistext in
  // buildLinkList() unten - dieselbe Formulierung bis auf dieses eine Wort
  // fuer Konflikt- und Mehrfachdefinitions-Karten (Textkorrektur vor
  // V2.7.6, siehe Analyse "Server- RDS Konfiguration"/Loopback-Gruppe).
  const UNLINKED_GROUP_LABELS = { conflict: 'Konfliktgruppe', redundant: 'Mehrfachdefinitions-Gruppe' };

  // Link-Liste einer einzelnen GPO - genutzt von buildDetailSection() (hier)
  // UND vom GPO-Detail-Panel (V2.3, buildGpoDetailLinks()), damit die
  // enforced/blockInheritance/deaktiviert-Darstellung nicht zweimal steht.
  // findingType (optional): 'conflict'/'redundant', wenn diese Zelle
  // innerhalb einer Konflikt-/Mehrfachdefinitions-Karte steht - steuert
  // ausschliesslich den Text im "0 Links"-Fall unten, keine Logikaenderung.
  // buildGpoDetailLinks() (GPO-Detailansicht, kein Finding-Kontext) ruft
  // ohne dieses Argument auf und bekommt weiterhin den generischen Text.
  function buildLinkList(gpoId, findingType) {
    // links.json fehlte komplett - "Keine Verknuepfung gefunden." waere hier
    // eine erfundene Aussage ueber genau diese GPO statt einer tatsaechlich
    // ermittelten (V2.5.2). Deckt beide verbliebenen Aufrufer ab
    // (buildDetailSection() fuer Konflikt-/Redundanz-Karten,
    // buildEntryRowList() fuer "Beteiligte GPOs") - buildGpoDetailLinks()
    // (V2.3) prueft linksFileMissing bereits selbst und erreicht diese
    // Funktion in dem Fall gar nicht erst.
    if (_model.dataQuality && _model.dataQuality.linksFileMissing) {
      const missing = document.createElement('div');
      missing.className = 'gpo-detail-no-link';
      missing.textContent = LINKS_FILE_MISSING_NOTE;
      return missing;
    }

    const links = linksForGpo(gpoId);
    if (!links.length) {
      const noLink = document.createElement('div');
      noLink.className = 'gpo-detail-no-link';
      // Innerhalb einer Konflikt-/Mehrfachdefinitions-Karte waere "Keine
      // Verknuepfung gefunden." missverstaendlich: die GPO ist trotzdem
      // Gruppenmitglied (Gruppenbildung erfolgt ueber settingKey+Wert,
      // nicht ueber Scope - siehe groupSettingsByKeyAndScope() in
      // gpo-analyzer.js), nur der Overlap mit den anderen beteiligten GPOs
      // ist mangels eigener Links nicht bestimmbar (determineScopeOverlap()
      // liefert in diesem Fall 'unknown', nicht 'none'). Ausserhalb eines
      // Finding-Kontexts (findingType undefined, z.B. GPO-Detailansicht)
      // bleibt der bisherige, generische Text unveraendert.
      const groupLabel = UNLINKED_GROUP_LABELS[findingType];
      noLink.textContent = groupLabel
        ? 'Diese GPO ist Teil der ' + groupLabel + '. Ihr eigener Zielbereich überlappt nicht nachweisbar mit den anderen beteiligten GPOs (keine Verknüpfung vorhanden).'
        : 'Keine Verknüpfung gefunden.';
      return noLink;
    }

    // enforced/blockInheritance/linkEnabled je Link statt eines GPO-weiten
    // Badges: dieselbe GPO kann an einem Ziel enforced sein und an einem
    // anderen nicht (siehe .md/todo/GPO_Analyzer_Pre_Real_Data_Hardening.md,
    // Abschnitt 4/5) - ein GPO-Level-Badge wuerde das falsch als globale
    // Eigenschaft darstellen.
    const linkList = document.createElement('ul');
    linkList.className = 'gpo-detail-link-list';
    links.forEach(l => {
      const li = document.createElement('li');
      li.textContent = '[' + l.targetType + '] ' + l.target + ' (Reihenfolge ' + l.order + ')'
        + (l.enforced ? ' 🔒 enforced' : '')
        + (l.blockInheritance ? ' 🚫 block inheritance' : '')
        + (l.linkEnabled === false ? ' ⛔ deaktiviert' : '');
      linkList.appendChild(li);
    });
    return linkList;
  }

  // ── Effective Scope (V3.0, Option A) ─────────────────────────
  // Reine Anzeige-Ergaenzung auf Basis bereits vorhandener Felder
  // (gpo.securityFilter/gpo.wmiFilter) - KEINE Aenderung an
  // determineScopeOverlap()/aggregateOverlapResults()/computeGroupOverlap()/
  // groupSettingsByKeyAndScope()/analyzeSettingConflicts(), kein neuer
  // Finding-Typ, kein Eintrag in _findings (siehe V3-Architektur-Review:
  // "Effective Scope" = bestehender OU-Scope + sichtbarer, NICHT
  // auflösbarer Einschraenkungshinweis).
  //
  // Standard-Trustee-Erkennung: nutzt hasNonDefaultSecurityFilter()/
  // isDefaultSecurityFilterTrustee() (weiter unten, OU-Baum-Badge) als
  // einzige Quelle - kein zweiter, eigener Abgleich hier. Ursprünglich
  // (V3.0) prüfte diese Funktion nur die englische Bezeichnung
  // ("authenticated users$") und erkannte die deutsche Standard-Bezeichnung
  // "Authentifizierte Benutzer" nicht, wodurch der Hinweis faelschlich bei
  // allen 82/82 echten GPOs erschien. Seit dem Locale-Fix vergleicht sie
  // zuerst sprachunabhaengig gegen die SID S-1-5-11, nur ohne SID gegen eine
  // feste, kurze Namensliste - der Hinweis erscheint jetzt nur noch, wenn
  // tatsaechlich ein vom Standard abweichender Trustee vorhanden ist, und
  // nennt auch nur diese abweichenden Trustees (harmlose Standard-Eintraege
  // wie "Authentifizierte Benutzer" werden aus der Auflistung entfernt,
  // damit sie neben einer echten Einschraenkung nicht mit aufgelistet
  // werden). looksLikeComputerTrustee() (gpo-analyzer.js) beantwortet eine
  // andere Frage (Computer- vs. Benutzer-Zielgruppe fuer die Server-/RDS-
  // Hygiene-Regel) und wird hier weiterhin NICHT herangezogen.
  function buildSecurityFilterConstraintNote(gpo) {
    const filters = gpo.securityFilter || [];
    if (!filters.length) return null;
    if (!hasNonDefaultSecurityFilter(gpo)) return null;
    const trustees = filters.filter(f => !isDefaultSecurityFilterTrustee(f)).map(f => f.trustee).filter(Boolean).join(', ') || 'unbekannt';
    return 'Zusätzlich eingeschränkt durch Security-Filter „' + trustees + '“ – welche Computer/Benutzer '
      + 'das konkret betrifft, ist aus dem Snapshot nicht bestimmbar.';
  }

  function buildWmiFilterConstraintNote(gpo) {
    if (!gpo.wmiFilter) return null;
    const wmiName = gpo.wmiFilter.name || gpo.wmiFilter.id || 'unbekannt';
    return 'Zusätzlich eingeschränkt durch WMI-Filter „' + wmiName + '“ – nicht auflösbar.';
  }

  // Gemeinsam genutzte Hilfsfunktion (siehe buildSecurityFilterConstraintNote()/
  // buildWmiFilterConstraintNote() oben fuer die einzelnen Texte) - liefert
  // null, wenn keine Einschraenkung vorliegt, sonst ein Array aus einer oder
  // zwei Zeilen. Verwendet an drei Stellen (buildScopeVisualization(),
  // buildEntryRowList()/buildDetailSection(), openGpoDetail()) statt die
  // Pruef-Logik zu duplizieren.
  function buildScopeConstraintNote(gpo) {
    const notes = [buildSecurityFilterConstraintNote(gpo), buildWmiFilterConstraintNote(gpo)].filter(Boolean);
    return notes.length ? notes : null;
  }

  // DOM-Hilfsfunktion fuer die zwei Stellen, an denen Security- UND WMI-
  // Filter-Hinweis gemeinsam relevant sind (Scope-Visualisierung, "Beteiligte
  // GPOs"). Selbe Optik wie der bestehende LINKS_FILE_MISSING_NOTE-Hinweis
  // (.gpo-detail-no-link: klein, gedaempft, kursiv) - bewusst KEIN gruenes/
  // neutrales Styling, das nach "geprueft und in Ordnung" aussehen koennte.
  // labelPrefix ist optional: in der Scope-Visualisierung stehen mehrere GPOs
  // nebeneinander ohne eigene Namens-Ueberschrift (analog zum bestehenden
  // "⛔ {Name}: ..."-Muster bei missingLinkGpos direkt darueber) - an den
  // anderen beiden Stellen steht der GPO-Name bereits daneben/darueber und
  // labelPrefix bleibt leer.
  function appendScopeConstraintNote(container, gpo, labelPrefix) {
    const notes = buildScopeConstraintNote(gpo);
    if (!notes) return;
    notes.forEach(text => {
      const row = document.createElement('div');
      row.className = 'gpo-detail-no-link';
      row.textContent = (labelPrefix ? labelPrefix + ': ' : '') + text;
      container.appendChild(row);
    });
  }

  // ── Scope-Visualisierung (V2.5) ─────────────────────────────
  // Reine Darstellung auf dem bestehenden ouTree-/Link-Modell (gpo-parser.js)
  // - keine zweite Scope-Berechnung, keine neue Analyse-Logik. Sucht den
  // Pfad von der Domain-Wurzel zu einem Ziel innerhalb des bereits
  // vorhandenen _model.ouTree per einfacher Tiefensuche (reine Anzeige-
  // Traversierung, kein neues Modell).
  function findOuTreePath(target) {
    const roots = _model.ouTree || [];
    function search(node, path) {
      const nextPath = path.concat([node]);
      if (node.target === target) return nextPath;
      for (const child of (node.children || [])) {
        const found = search(child, nextPath);
        if (found) return found;
      }
      return null;
    }
    for (const root of roots) {
      const found = search(root, []);
      if (found) return found;
    }
    return null;
  }

  // Baut fuer die an einem Konflikt beteiligten GPOs einen reduzierten
  // Ausschnitt des bestehenden OU-Baums (nur die Zweige, die zu einer
  // ihrer Verknuepfungen fuehren) statt des kompletten Struktur-Baums -
  // zeigt genau, worauf sich "Zielbereiche ueberlappen sich" bezieht.
  // Site-Verknuepfungen sind bewusst NICHT Teil von ouTree (gpo-parser.js)
  // und werden deshalb separat als Hinweiszeile gefuehrt, nicht in den Baum
  // gezwungen. Security-/WMI-Filter fliessen bewusst nicht ein (Roadmap
  // Abschnitt 2.5: "bleiben ausdruecklich ausserhalb").
  function buildScopeVisualization(finding) {
    // links.json fehlte komplett - "GPO X: keine Verknuepfung gefunden" fuer
    // jede beteiligte GPO waere hier eine erfundene Einzel-Aussage statt
    // einer tatsaechlich ermittelten (V2.5.1). Ein einziger, snapshotweiter
    // Hinweis statt der ueblichen Pro-GPO-Aufschluesselung.
    if (_model.dataQuality && _model.dataQuality.linksFileMissing) {
      const container = document.createElement('div');
      container.className = 'gpo-scope-viz';

      const title = document.createElement('div');
      title.className = 'gpo-finding-sub-title';
      title.textContent = 'Scope-Visualisierung';
      container.appendChild(title);

      const row = document.createElement('div');
      row.className = 'gpo-detail-row';
      row.textContent = LINKS_FILE_MISSING_NOTE + ' Zielbereiche der beteiligten GPOs können nicht dargestellt werden.';
      container.appendChild(row);

      const caveat = document.createElement('div');
      caveat.className = 'gpo-scope-viz-caveat';
      caveat.textContent = 'Security- und WMI-Filter werden in dieser Darstellung nicht berücksichtigt.';
      container.appendChild(caveat);

      return container;
    }

    const gpoIds = finding.entries.map(e => e.gpoId);
    const gpoNameById = new Map(finding.entries.map(e => [e.gpoId, e.gpoName]));

    const targetAssignments = new Map(); // target -> [{gpoId, gpoName, link}]
    const pathsByTarget = new Map();     // target -> ouTree-Pfad (Wurzel..Ziel)
    const siteNotes = [];                // GPOs mit Site-Verknuepfung
    const gpoHasAnyLink = new Set();

    gpoIds.forEach(gpoId => {
      const gpoName = gpoNameById.get(gpoId);
      linksForGpo(gpoId).forEach(l => {
        gpoHasAnyLink.add(gpoId);
        if (l.targetType === 'site') {
          siteNotes.push({ gpoId, gpoName, link: l });
          return;
        }
        if (!targetAssignments.has(l.target)) targetAssignments.set(l.target, []);
        targetAssignments.get(l.target).push({ gpoId, gpoName, link: l });
        if (!pathsByTarget.has(l.target)) {
          const path = findOuTreePath(l.target);
          if (path) pathsByTarget.set(l.target, path);
        }
      });
    });

    // "Gemeinsame" Knoten = Knoten, die im Pfad von mindestens zwei
    // verschiedenen beteiligten GPOs liegen - ausschliesslich ueber AKTIVE
    // Links berechnet (linkEnabled !== false), exakt dieselbe Aktiv-
    // Definition wie activeLinksForGpo() in gpo-analyzer.js, damit die
    // Hervorhebung nicht mehr "ueberlappend" markiert als der Analyzer
    // selbst zugrunde legt.
    const pathTargetsByGpo = new Map();
    targetAssignments.forEach((assignees, target) => {
      const path = pathsByTarget.get(target);
      if (!path) return;
      assignees.forEach(a => {
        if (a.link.linkEnabled === false) return;
        if (!pathTargetsByGpo.has(a.gpoId)) pathTargetsByGpo.set(a.gpoId, new Set());
        path.forEach(n => pathTargetsByGpo.get(a.gpoId).add(n.target));
      });
    });
    const nodeGpoCount = new Map();
    pathTargetsByGpo.forEach(targetsSet => {
      targetsSet.forEach(t => nodeGpoCount.set(t, (nodeGpoCount.get(t) || 0) + 1));
    });
    const sharedNodeTargets = new Set([...nodeGpoCount].filter(([, c]) => c >= 2).map(([t]) => t));

    const includedNodeTargets = new Set();
    pathsByTarget.forEach(path => path.forEach(n => includedNodeTargets.add(n.target)));

    const container = document.createElement('div');
    container.className = 'gpo-scope-viz';

    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Scope-Visualisierung';
    container.appendChild(title);

    const roots = (_model.ouTree || []).filter(r => includedNodeTargets.has(r.target));
    if (roots.length) {
      const treeWrap = document.createElement('div');
      treeWrap.className = 'gpo-scope-tree';
      roots.forEach(r => treeWrap.appendChild(
        buildScopeTreeNode(r, includedNodeTargets, targetAssignments, sharedNodeTargets)
      ));
      container.appendChild(treeWrap);
    }

    if (siteNotes.length) {
      const siteWrap = document.createElement('div');
      siteWrap.className = 'gpo-scope-viz-site-note';
      siteNotes.forEach(s => {
        const row = document.createElement('div');
        row.className = 'gpo-detail-row';
        row.textContent = '📡 ' + s.gpoName + ' ist über eine Site-Verknüpfung eingebunden ('
          + s.link.target + ') - nicht Teil der OU-Hierarchie, Zielbereich nicht sicher bestimmbar.';
        siteWrap.appendChild(row);
      });
      container.appendChild(siteWrap);
    }

    const missingLinkGpos = gpoIds.filter(id => !gpoHasAnyLink.has(id));
    if (missingLinkGpos.length) {
      const missingWrap = document.createElement('div');
      missingWrap.className = 'gpo-scope-viz-site-note';
      missingLinkGpos.forEach(id => {
        const row = document.createElement('div');
        row.className = 'gpo-detail-row';
        row.textContent = '⛔ ' + gpoNameById.get(id) + ': keine Verknüpfung vorhanden – Overlap nicht bestimmbar.';
        missingWrap.appendChild(row);
      });
      container.appendChild(missingWrap);
    }

    // V3.0 Effective Scope: pro beteiligter GPO ein sichtbarer, nicht
    // aufloesbarer Einschraenkungshinweis (Security-/WMI-Filter) - zusaetzlich
    // zur bestehenden generischen Caveat-Zeile unten, die unveraendert bleibt.
    const constraintWrap = document.createElement('div');
    constraintWrap.className = 'gpo-scope-viz-site-note';
    gpoIds.forEach(gpoId => {
      const gpo = gpoById(gpoId);
      if (gpo) appendScopeConstraintNote(constraintWrap, gpo, gpoNameById.get(gpoId));
    });
    if (constraintWrap.children.length) container.appendChild(constraintWrap);

    const caveat = document.createElement('div');
    caveat.className = 'gpo-scope-viz-caveat';
    caveat.textContent = 'Security- und WMI-Filter werden in dieser Darstellung nicht berücksichtigt.';
    container.appendChild(caveat);

    return container;
  }

  function buildScopeTreeNode(node, includedNodeTargets, targetAssignments, sharedNodeTargets) {
    const wrap = document.createElement('div');
    wrap.className = 'gpo-scope-tree-node' + (sharedNodeTargets.has(node.target) ? ' gpo-scope-tree-node--shared' : '');

    const header = document.createElement('div');
    header.className = 'gpo-scope-tree-node-header';
    const icon = document.createElement('span');
    icon.textContent = node.targetType === 'domain' ? '🏛️' : '📁';
    const name = document.createElement('span');
    name.className = 'gpo-scope-tree-node-name';
    name.textContent = node.name || node.target;
    header.append(icon, name);
    if (node.blockInheritance) {
      const badge = document.createElement('span');
      badge.className = 'gpo-scope-tree-badge';
      badge.textContent = '🚫 Block Inheritance';
      header.appendChild(badge);
    }
    wrap.appendChild(header);

    (targetAssignments.get(node.target) || []).forEach(a => {
      const gpoRow = document.createElement('div');
      gpoRow.className = 'gpo-scope-tree-gpo' + (a.link.linkEnabled === false ? ' gpo-scope-tree-gpo--disabled' : '');
      gpoRow.textContent = '📌 ' + a.gpoName
        + (a.link.enforced ? ' 🔒 enforced' : '')
        + (a.link.linkEnabled === false ? ' ⛔ deaktiviert' : '');
      wrap.appendChild(gpoRow);
    });

    const children = (node.children || []).filter(c => includedNodeTargets.has(c.target));
    if (children.length) {
      const childWrap = document.createElement('div');
      childWrap.className = 'gpo-scope-tree-children';
      children.forEach(c => childWrap.appendChild(
        buildScopeTreeNode(c, includedNodeTargets, targetAssignments, sharedNodeTargets)
      ));
      wrap.appendChild(childWrap);
    }

    return wrap;
  }

  // "Beteiligte GPOs" (V2.4): pro GPO Wert UND Ziel-/Link-Fakten zusammen
  // zeigen, statt Wert hier und Link-Details erst weiter unten in "Details"
  // getrennt zu haben - der Techniker soll direkt sehen, welche GPO welchen
  // Wert setzt UND worauf sie verknuepft ist, ohne zu scrollen. Nutzt
  // buildLinkList() (bereits vorhanden, V2.3) wieder statt Scope-/Link-
  // Fakten neu zu interpretieren, und .gpo-detail-gpo (bereits vorhanden)
  // fuer die optische Box je GPO statt einer neuen CSS-Klasse.
  function buildEntryRowList(finding) {
    const wrap = document.createElement('div');
    wrap.className = 'gpo-entry-row-list';
    finding.entries.forEach(entry => {
      const group = document.createElement('div');
      group.className = 'gpo-detail-gpo';

      const row = document.createElement('div');
      row.className = 'gpo-entry-row';
      const gpoLabel = document.createElement('span');
      gpoLabel.className = 'gpo-entry-gpo';
      gpoLabel.textContent = 'GPO: ' + entry.gpoName;
      const arrow = document.createElement('span');
      arrow.className = 'gpo-entry-arrow';
      arrow.textContent = '→';
      const value = document.createElement('code');
      value.className = 'gpo-entry-value';
      value.textContent = entry.value || '(leer)';
      row.append(gpoLabel, arrow, value);
      group.appendChild(row);

      group.appendChild(buildLinkList(entry.gpoId, finding.type));
      // V3.0 Effective Scope: GPO-Name steht bereits in gpoLabel ("GPO: ...")
      // direkt darueber, deshalb ohne labelPrefix.
      const entryGpo = gpoById(entry.gpoId);
      if (entryGpo) appendScopeConstraintNote(group, entryGpo);
      wrap.appendChild(group);
    });
    return wrap;
  }

  function makeExpandable(header, body, expand) {
    header.addEventListener('click', () => {
      const isOpen = body.classList.toggle('open');
      expand.classList.toggle('open', isOpen);
    });
  }

  // Nur noch die reinen Empfehlungs-Zeilen, ohne eigene Ueberschrift - die
  // Ueberschrift "Naechster Schritt" liefert jetzt zentral buildFindingBody()
  // (Roadmap Abschnitt 1.6), nicht mehr jede Karte einzeln.
  function buildRecommendationRows(rule) {
    if (!rule || !rule.recommendations || !rule.recommendations.length) return null;
    const wrap = document.createElement('div');
    rule.recommendations.forEach(rec => {
      const p = document.createElement('div');
      p.className = 'gpo-detail-row';
      p.textContent = rec.text;
      wrap.appendChild(p);
    });
    return wrap;
  }

  function buildDefinedInList(finding) {
    const wrap = document.createElement('div');
    wrap.className = 'gpo-redundant-defined-in';
    const label = document.createElement('span');
    label.className = 'gpo-finding-sub-title';
    label.textContent = 'Definiert in';
    wrap.appendChild(label);
    const gpoNames = document.createElement('div');
    gpoNames.className = 'gpo-redundant-gpo-list';
    gpoNames.textContent = finding.entries.map(e => e.gpoName).join(', ');
    wrap.appendChild(gpoNames);
    return wrap;
  }

  function buildScopePairsList(pairs) {
    const pairList = document.createElement('ul');
    pairList.className = 'gpo-redundant-scope-pairs';
    pairs.forEach(p => {
      const li = document.createElement('li');
      const label = PAIR_RESULT_LABELS[p.result] || p.result;
      li.textContent = p.gpoAName + ' ↔ ' + p.gpoBName + ': ' + label;
      pairList.appendChild(li);
    });
    return pairList;
  }

  // ── Vereinheitlichte Finding-Textstruktur (Roadmap Abschnitt 1.6) ──
  // Jede Karte bekommt exakt drei, immer in dieser Reihenfolge vorhandene
  // Abschnitte: "Was" (was wurde gefunden), "Bewertung" (warum relevant),
  // "Naechster Schritt" (konkrete Empfehlung). Gemeinsam ist nur diese
  // Textstruktur und die Dispatch-Stelle hier - welche Daten je Typ in
  // welchen Abschnitt einfliessen, entscheidet resolveFindingSections()
  // pro finding.type, die Datenform selbst bleibt je Typ unterschiedlich.
  function buildFindingBody(finding) {
    const sections = resolveFindingSections(finding);

    const body = document.createElement('div');
    body.className = 'gpo-finding-body';

    // V2.7.5: "kind" liefert nur den CSS-Hook fuer die optische Trennung
    // Tatsache/Einordnung/Handlungsempfehlung (siehe .gpo-body-section--was/
    // --bewertung/--next-step in gpo.css) - welcher Inhalt in welchen
    // Abschnitt einfliesst, entscheidet unveraendert resolveFindingSections()/
    // appendBodyContent() weiter unten, hier aendert sich nichts an Text,
    // Reihenfolge oder Struktur.
    body.appendChild(buildBodySection('Was', sections.was, 'was'));
    body.appendChild(buildBodySection('Bewertung', sections.bewertung, 'bewertung'));
    body.appendChild(buildBodySection('Nächster Schritt', sections.naechsterSchritt, 'next-step'));

    return body;
  }

  function buildBodySection(title, content, kind) {
    const wrap = document.createElement('div');
    wrap.className = 'gpo-body-section gpo-body-section--' + kind;
    const titleEl = document.createElement('div');
    titleEl.className = 'gpo-finding-sub-title';
    titleEl.textContent = title;
    wrap.appendChild(titleEl);
    appendBodyContent(wrap, content);
    return wrap;
  }

  // content darf ein String, ein DOM-Node, oder ein Array aus beidem sein -
  // haelt die einzelnen resolve*Sections()-Funktionen frei von wiederholtem
  // DOM-Boilerplate fuer den Fall, dass ein Abschnitt mehrere Bausteine
  // kombiniert (z.B. Konflikt-"Was" = Fliesstext + Entry-Liste).
  function appendBodyContent(wrap, content) {
    if (!content) return;
    if (Array.isArray(content)) {
      content.forEach(c => appendBodyContent(wrap, c));
      return;
    }
    if (typeof content === 'string') {
      const p = document.createElement('p');
      p.className = 'gpo-finding-desc';
      p.textContent = content;
      wrap.appendChild(p);
      return;
    }
    wrap.appendChild(content);
  }

  function resolveFindingSections(finding) {
    switch (finding.type) {
      case 'conflict': return resolveConflictSections(finding);
      case 'redundant': return resolveRedundantSections(finding);
      case 'hygiene': return resolveHygieneSections(finding);
      case 'security-filter': return resolveSecurityFilterSections(finding);
      case 'wmi-filter': return resolveWmiFilterSections(finding);
      default: return { was: null, bewertung: null, naechsterSchritt: null };
    }
  }

  // Fester Zusatzhinweis nur fuer "potential" (V2.4) - ergaenzt die
  // bestehende scopeExplanation (wird NICHT ersetzt/neu formuliert), macht
  // aber zusaetzlich unmissverstaendlich klar, dass es sich um eine
  // Datenluecke im Snapshot handelt, nicht um ein Analyse-Versagen.
  const POTENTIAL_CONFLICT_NOTE = 'Der tatsächliche Scope-Overlap konnte anhand der vorhandenen Snapshot-Daten nicht sicher bestimmt werden.';

  function resolveConflictSections(finding) {
    const bewertung = [finding.scopeExplanation || ''];
    if (finding.conflictLevel === 'potential') {
      bewertung.push(POTENTIAL_CONFLICT_NOTE);
    }

    return {
      was: [CONFLICT_DESC, buildEntryRowList(finding)],
      bewertung,
      naechsterSchritt: SCOPE_CHECK_HINT,
    };
  }

  function resolveRedundantSections(finding) {
    const value = finding.entries[0] ? finding.entries[0].value : '';
    const was = [
      REDUNDANT_DESC + ' Wert: ' + (value || '(leer)'),
      buildDefinedInList(finding),
    ];

    // "mixed" bekommt explizit die Paar-fuer-Paar-Aufschluesselung, nicht
    // nur das Label - genau die Untergruppen, die sich ueberlappen bzw.
    // nicht, sollen fuer den Techniker sichtbar sein.
    const bewertung = [finding.scopeExplanation || ''];
    if (finding.scopeRelation === 'mixed' && (finding.scopePairs || []).length) {
      bewertung.push(buildScopePairsList(finding.scopePairs));
    }

    return { was, bewertung, naechsterSchritt: SCOPE_CHECK_HINT };
  }

  function resolveHygieneSections(finding) {
    const rule = finding.rule || {};
    const was = 'GPO: ' + finding.gpoName;

    const bewertung = [resolveRuleText(rule.description, finding.detail) || ''];

    if (finding.detail && finding.detail.modified) {
      const modifiedLabel = (finding.detail.modified || '').replace('T', ' ').substring(0, 16);
      bewertung.push('Zuletzt geändert: ' + modifiedLabel
        + (finding.detail.ageYears != null ? ' (vor ' + finding.detail.ageYears + '+ Jahren)' : ''));
    }

    // GPO_NO_LINKS: "gar kein Link" und "Link vorhanden, aber deaktiviert"
    // sehen sonst identisch aus (beide nutzen dieselbe rule.description) -
    // beim GPMC-Abgleich wuerde ein Techniker einen vorhandenen (nur
    // deaktivierten) Link sonst als Diskrepanz zum Tool missverstehen.
    if (finding.detail && finding.detail.linkStatus === 'disabled') {
      const count = finding.detail.disabledLinkCount || 0;
      bewertung.push('Verknüpfung vorhanden, aber deaktiviert (' + count + (count === 1 ? ' Link).' : ' Links).'));
    } else if (finding.detail && finding.detail.linkStatus === 'none') {
      bewertung.push('Keine Verknüpfung vorhanden.');
    }

    return {
      was,
      bewertung,
      naechsterSchritt: buildRecommendationRows(rule) || NO_ACTION_HINT,
    };
  }

  function resolveSecurityFilterSections(finding) {
    const rule = finding.rule || {};
    const was = [
      'Verknüpft mit: [' + finding.targetType + '] ' + finding.target,
      'Security Filter: ' + (finding.securityFilter || []).map(f => f.trustee).join(', '),
    ];

    return {
      was,
      bewertung: rule.description || '',
      naechsterSchritt: buildRecommendationRows(rule) || NO_ACTION_HINT,
    };
  }

  // Reine Fakten-Darstellung eines WMI-Filters (Name/Id + Query) - genutzt
  // vom WMI-Filter-Finding (hier) UND vom GPO-Detail-Panel (V2.3,
  // buildGpoDetailWmiFilter()), damit dieselbe Darstellung nicht zweimal
  // gebaut wird. Liefert ein Array aus String/Node, direkt konsumierbar
  // von appendBodyContent().
  function buildWmiFilterFacts(wmiFilter) {
    const facts = ['Filter: ' + (wmiFilter.name || wmiFilter.id || 'unbekannt')];
    if (wmiFilter.query) {
      const queryRow = document.createElement('div');
      queryRow.className = 'gpo-detail-row';
      const code = document.createElement('code');
      code.className = 'gpo-entry-value';
      code.textContent = wmiFilter.query;
      queryRow.appendChild(code);
      facts.push(queryRow);
    }
    return facts;
  }

  function resolveWmiFilterSections(finding) {
    const rule = finding.rule || {};
    const wmiFilter = finding.wmiFilter || {};

    return {
      was: buildWmiFilterFacts(wmiFilter),
      bewertung: rule.description || '',
      naechsterSchritt: buildRecommendationRows(rule) || NO_ACTION_HINT,
    };
  }

  // Einzige Verzweigung nach finding.type fuer die Kartendarstellung -
  // Konflikt-/Redundanz-/Hygiene-/Security-Filter-/WMI-Filter-Listen
  // rufen alle denselben buildFindingCard() auf, keine separate
  // Dispatch-Logik pro Liste. Function-Deklarationen sind gehoisted,
  // daher duerfen die Builder hier referenziert werden, obwohl sie
  // erst weiter unten im Modul definiert sind.
  const CARD_BUILDERS = {
    conflict: buildConflictCard,
    redundant: buildRedundantCard,
    hygiene: buildHygieneCard,
    'security-filter': buildSecurityFilterCard,
    'wmi-filter': buildWmiFilterCard,
  };

  function buildFindingCard(finding) {
    const builder = CARD_BUILDERS[finding.type];
    return builder ? builder(finding) : null;
  }

  // ── Konflikt-Liste (Konzept Abschnitt 5) ────────────────────
  // conflictLevel "real" vs. "potential" (gpo-analyzer.js,
  // determineScopeOverlap()) laeuft weiterhin ueber denselben Karten-
  // Aufbau, bekommt aber ein sichtbares Label welcher der beiden Zustaende
  // vorliegt (Roadmap .md/todo/GPO_Analyzer_Roadmap_vor_v2_v2_spaeter.md,
  // Abschnitt 1.1/2.1).
  function buildConflictCard(finding) {
    const { category, name } = splitSettingKey(finding.settingKey);
    const isReal = finding.conflictLevel === 'real';

    // V2.7.5: der linke Rand unterschied bisher NICHT zwischen echt/
    // potenziell (beide waren rot) - nur das kleine Badge tat es. Jetzt
    // folgt der Rand derselben, bereits vorhandenen Farbe wie das Badge
    // (kritisch=rot, potenziell=gelb/amber, dieselben Variablen wie
    // .gpo-sev-pill--critical/--warning) - macht "potenziell = unsicher"
    // schon beim Ueberfliegen der Liste sichtbar, ohne eine neue Farbe
    // einzufuehren oder finding.conflictLevel selbst zu aendern.
    const card = document.createElement('div');
    card.className = 'gpo-finding-card gpo-finding-card--conflict '
      + (isReal ? 'gpo-finding-card--conflict-real' : 'gpo-finding-card--conflict-potential');

    const header = document.createElement('div');
    header.className = 'gpo-finding-header';

    const badge = document.createElement('span');
    badge.className = 'gpo-sev-pill ' + (isReal ? 'gpo-sev-pill--critical' : 'gpo-sev-pill--warning');
    badge.textContent = isReal ? '🔴 Echter Konflikt' : '🟡 Potenzieller Konflikt';

    const title = document.createElement('span');
    title.className = 'gpo-finding-title';
    title.textContent = name;

    const scopeBadge = document.createElement('span');
    scopeBadge.className = 'gpo-scope-badge';
    scopeBadge.textContent = finding.scope || '';

    const expand = document.createElement('span');
    expand.className = 'gpo-finding-expand';
    expand.textContent = '▼';

    header.append(badge, title, scopeBadge, expand);

    const body = buildFindingBody(finding);
    body.appendChild(buildDetailSection(finding, category));
    body.appendChild(buildScopeVisualization(finding));

    const diagnoseSection = buildDiagnoseSection();
    if (diagnoseSection) body.appendChild(diagnoseSection);

    makeExpandable(header, body, expand);
    card.append(header, body);
    return card;
  }

  function renderConflictList() {
    const list  = document.getElementById('gpo-conflict-list');
    const empty = document.getElementById('gpo-conflict-empty');
    const countEl = document.getElementById('gpo-conflict-count');
    list.replaceChildren();

    const conflicts = _findings.filter(f => f.type === 'conflict');

    if (!conflicts.length) {
      countEl.textContent = 0;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const q = _state.conflictQuery.toLowerCase();
    let filtered = conflicts.filter(passesFilters);
    if (q) filtered = filtered.filter(f => f.settingKey.toLowerCase().includes(q));
    countEl.textContent = filtered.length;

    if (!filtered.length) {
      const noMatch = document.createElement('div');
      noMatch.className = 'gpo-empty';
      noMatch.textContent = 'Keine Findings für diese Auswahl.';
      list.appendChild(noMatch);
      return;
    }

    filtered.forEach(f => {
      const card = buildFindingCard(f);
      _findingCardMap.set(f, card);
      list.appendChild(card);
    });
  }

  // ── Redundanz-Liste (Konzept Abschnitt 6) ───────────────────
  // scopeRelation ("overlap"|"none"|"mixed"|"unknown", gpo-analyzer.js
  // Prompt 2) bestimmt Label und - bei "mixed" - eine explizite Paar-fuer-
  // Paar-Aufschluesselung statt nur des Labels (Roadmap .md/todo/
  // GPO_Analyzer_Roadmap_vor_v2_v2_spaeter.md, Abschnitt 1.2).
  function buildRedundantCard(finding) {
    const { category, name } = splitSettingKey(finding.settingKey);

    const card = document.createElement('div');
    card.className = 'gpo-finding-card gpo-finding-card--redundant';

    const header = document.createElement('div');
    header.className = 'gpo-finding-header';

    const badge = document.createElement('span');
    badge.className = 'gpo-sev-pill gpo-sev-pill--info';
    badge.textContent = REDUNDANT_SCOPE_LABELS[finding.scopeRelation] || REDUNDANT_SCOPE_LABELS.unknown;

    const title = document.createElement('span');
    title.className = 'gpo-finding-title';
    title.textContent = name;

    const scopeBadge = document.createElement('span');
    scopeBadge.className = 'gpo-scope-badge';
    scopeBadge.textContent = finding.scope || '';

    const expand = document.createElement('span');
    expand.className = 'gpo-finding-expand';
    expand.textContent = '▼';

    header.append(badge, title, scopeBadge, expand);

    const body = buildFindingBody(finding);
    body.appendChild(buildDetailSection(finding, category));

    makeExpandable(header, body, expand);
    card.append(header, body);
    return card;
  }

  function renderRedundantList() {
    const list  = document.getElementById('gpo-redundant-list');
    const empty = document.getElementById('gpo-redundant-empty');
    const countEl = document.getElementById('gpo-redundant-count');
    list.replaceChildren();

    const redundants = _findings.filter(f => f.type === 'redundant');

    if (!redundants.length) {
      countEl.textContent = 0;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const q = _state.redundantQuery.toLowerCase();
    let filtered = redundants.filter(passesFilters);
    if (q) filtered = filtered.filter(f => f.settingKey.toLowerCase().includes(q));
    countEl.textContent = filtered.length;

    if (!filtered.length) {
      const noMatch = document.createElement('div');
      noMatch.className = 'gpo-empty';
      noMatch.textContent = 'Keine Findings für diese Auswahl.';
      list.appendChild(noMatch);
      return;
    }

    filtered.forEach(f => {
      const card = buildFindingCard(f);
      _findingCardMap.set(f, card);
      list.appendChild(card);
    });
  }

  // rules.json darf einen "{years}"-Platzhalter enthalten (aktuell nur
  // GPO_VERY_OLD, Abschnitt 1.4) statt den Schwellwert hart zu schreiben -
  // wird hier aus finding.detail.thresholdYears aufgeloest, das der
  // Analyzer bereits pro Finding mitliefert.
  function resolveRuleText(text, detail) {
    if (!text) return text;
    if (detail && detail.thresholdYears != null) {
      return text.replace(/\{years\}/g, detail.thresholdYears);
    }
    return text;
  }

  // ── GPO-Hygiene: Hygiene- + Security-Filter- + WMI-Filter-Findings
  // (Konzept Abschnitt 8, 9, 10) ───────────────────────────────
  function buildHygieneCard(finding) {
    const rule = finding.rule || {};

    const card = document.createElement('div');
    card.className = 'gpo-finding-card gpo-finding-card--hygiene';

    const header = document.createElement('div');
    header.className = 'gpo-finding-header';

    const badge = document.createElement('span');
    const severity = finding.severity || rule.severity || 'warning';
    badge.className = 'gpo-sev-pill gpo-sev-pill--' + severity;
    badge.textContent = (HYGIENE_SEVERITY_ICONS[severity] || '⚠') + ' ' + (resolveRuleText(rule.name, finding.detail) || 'Hygiene');

    const title = document.createElement('span');
    title.className = 'gpo-finding-title';
    title.textContent = finding.gpoName;

    const expand = document.createElement('span');
    expand.className = 'gpo-finding-expand';
    expand.textContent = '▼';

    header.append(badge, title, expand);

    const body = buildFindingBody(finding);

    const diagnoseSection = buildDiagnoseSection();
    if (diagnoseSection) body.appendChild(diagnoseSection);

    makeExpandable(header, body, expand);
    card.append(header, body);
    return card;
  }

  function buildSecurityFilterCard(finding) {
    const rule = finding.rule || {};

    const card = document.createElement('div');
    card.className = 'gpo-finding-card gpo-finding-card--security-filter';

    const header = document.createElement('div');
    header.className = 'gpo-finding-header';

    const badge = document.createElement('span');
    badge.className = 'gpo-sev-pill gpo-sev-pill--security-filter';
    badge.textContent = '🟡 ' + (rule.name || 'Security Filter');

    const title = document.createElement('span');
    title.className = 'gpo-finding-title';
    title.textContent = finding.gpoName;

    const expand = document.createElement('span');
    expand.className = 'gpo-finding-expand';
    expand.textContent = '▼';

    header.append(badge, title, expand);

    const body = buildFindingBody(finding);

    makeExpandable(header, body, expand);
    card.append(header, body);
    return card;
  }

  function buildWmiFilterCard(finding) {
    const rule = finding.rule || {};

    const card = document.createElement('div');
    card.className = 'gpo-finding-card gpo-finding-card--wmi-filter';

    const header = document.createElement('div');
    header.className = 'gpo-finding-header';

    const badge = document.createElement('span');
    badge.className = 'gpo-sev-pill gpo-sev-pill--wmi-filter';
    badge.textContent = '🔍 ' + (rule.name || 'WMI-Filter');

    const title = document.createElement('span');
    title.className = 'gpo-finding-title';
    title.textContent = finding.gpoName;

    const expand = document.createElement('span');
    expand.className = 'gpo-finding-expand';
    expand.textContent = '▼';

    header.append(badge, title, expand);

    const body = buildFindingBody(finding);

    makeExpandable(header, body, expand);
    card.append(header, body);
    return card;
  }

  // Gruppiert nach rule.bucket statt einer flachen Liste (Roadmap .md/todo/
  // GPO_Analyzer_Roadmap_vor_v2_v2_spaeter.md, Abschnitt 1.3) - leere
  // Abschnitte werden ausgeblendet, Reihenfolge folgt BUCKET_ORDER. Findings
  // ohne (bekanntes) bucket-Feld landen in einem Sicherheitsnetz-Abschnitt
  // statt kommentarlos zu verschwinden - sollte bei vollstaendig gepflegten
  // Regeln nicht vorkommen.
  function renderHygieneList() {
    const list  = document.getElementById('gpo-hygiene-list');
    const empty = document.getElementById('gpo-hygiene-empty');
    const countEl = document.getElementById('gpo-hygiene-count');
    list.replaceChildren();

    const allHygieneFindings = _findings.filter(f => ['hygiene', 'security-filter', 'wmi-filter'].includes(f.type));

    if (!allHygieneFindings.length) {
      countEl.textContent = 0;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const hygieneFindings = allHygieneFindings.filter(passesFilters);
    countEl.textContent = hygieneFindings.length;

    if (!hygieneFindings.length) {
      const noMatch = document.createElement('div');
      noMatch.className = 'gpo-empty';
      noMatch.textContent = 'Keine Findings für diese Auswahl.';
      list.appendChild(noMatch);
      return;
    }

    const grouped = new Set();

    function renderBucketSection(bucketKey, label, items) {
      if (!items.length) return;
      items.forEach(f => grouped.add(f));

      const section = document.createElement('div');
      section.className = 'gpo-hygiene-bucket';

      const title = document.createElement('div');
      title.className = 'gpo-hygiene-bucket-title';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      const countSpan = document.createElement('span');
      countSpan.className = 'gpo-section-count';
      countSpan.textContent = items.length;
      title.append(labelSpan, ' ', countSpan);
      section.appendChild(title);

      // Bucket-Titel klickbar (V2.2, "analog fuer die Bucket-Kacheln"):
      // schraenkt den Finding-Typ auf die Bucket-tragenden Typen ein und
      // setzt den Bucket-Filter genau auf diesen Bucket - ergibt z.B.
      // "nur kritische Hygiene-Findings". "sonstige" hat keinen gueltigen
      // Bucket-Filterwert und bleibt deshalb nicht klickbar.
      if (bucketKey !== 'sonstige') {
        title.classList.add('gpo-hygiene-bucket-title--clickable');
        title.addEventListener('click', () => {
          setExclusiveTypeFilter('hygiene', 'security-filter', 'wmi-filter');
          _state.bucketFilter = bucketKey;
          applyFilters();
        });
      }

      items.forEach(f => {
        const card = buildFindingCard(f);
        if (card) {
          _findingCardMap.set(f, card);
          section.appendChild(card);
        }
      });

      list.appendChild(section);
    }

    BUCKET_ORDER.forEach(bucket => {
      const items = hygieneFindings.filter(f => (f.rule && f.rule.bucket) === bucket);
      renderBucketSection(bucket, BUCKET_LABELS[bucket], items);
    });

    const ungrouped = hygieneFindings.filter(f => !grouped.has(f));
    renderBucketSection('sonstige', '❔ Sonstige', ungrouped);
  }

  // ── Struktur-Baum (Konzept Abschnitt 11) ────────────────────
  // "Standard: erste Ebene aufgeklappt, Rest eingeklappt" - nur die
  // Domain-Root-Knoten (depth 0) starten offen, alle OUs darunter zu.
  function renderOuTree() {
    const container = document.getElementById('gpo-tree-container');
    const empty = document.getElementById('gpo-tree-empty');
    container.replaceChildren();

    const tree = _model.ouTree || [];
    if (!tree.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    tree.forEach(node => container.appendChild(buildOuNode(node, 0)));
  }

  function buildOuNode(node, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'gpo-tree-node';
    wrap.style.marginLeft = (depth * 20) + 'px';

    const header = document.createElement('div');
    header.className = 'gpo-tree-node-header';

    const expand = document.createElement('span');
    expand.className = 'gpo-tree-expand';

    const icon = document.createElement('span');
    icon.className = 'gpo-tree-node-icon';
    icon.textContent = node.targetType === 'domain' ? '🏛️' : '📁';

    const name = document.createElement('span');
    name.className = 'gpo-tree-node-name';
    name.textContent = node.name || node.target;

    header.append(expand, icon, name);

    if (node.blockInheritance) {
      const badge = makeTreeBadge('🚫', 'Block Inheritance');
      badge.classList.add('gpo-tree-node-block-badge');
      header.appendChild(badge);
    }

    const body = document.createElement('div');
    body.className = 'gpo-tree-node-body';

    const sortedLinks = [...(node.gpoLinks || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    sortedLinks.forEach(gl => {
      const gpo = gpoById(gl.gpoId);
      if (!gpo) return;
      body.appendChild(buildOuGpoRow(gpo, gl, node));
    });

    (node.children || []).forEach(child => {
      body.appendChild(buildOuNode(child, depth + 1));
    });

    const isExpanded = depth === 0;
    body.classList.toggle('open', isExpanded);
    expand.classList.toggle('open', isExpanded);
    expand.textContent = isExpanded ? '▼' : '▶';

    header.addEventListener('click', () => {
      const nowOpen = body.classList.toggle('open');
      expand.classList.toggle('open', nowOpen);
      expand.textContent = nowOpen ? '▼' : '▶';
    });

    wrap.append(header, body);
    return wrap;
  }

  function buildOuGpoRow(gpo, gpoLink, node) {
    const row = document.createElement('div');
    row.className = 'gpo-tree-gpo-row';
    row.tabIndex = 0;

    const nameEl = document.createElement('span');
    nameEl.className = 'gpo-tree-gpo-name';
    nameEl.textContent = gpo.name;
    row.appendChild(nameEl);

    const badges = document.createElement('span');
    badges.className = 'gpo-tree-gpo-badges';
    if (gpoLink.enforced) badges.appendChild(makeTreeBadge('🔒', 'Enforced'));
    if (node.blockInheritance) badges.appendChild(makeTreeBadge('🚫', 'Block Inheritance'));
    if (gpo.wmiFilter) badges.appendChild(makeTreeBadge('🔍', 'WMI-Filter: ' + (gpo.wmiFilter.name || gpo.wmiFilter.id)));
    if (hasNonDefaultSecurityFilter(gpo)) {
      badges.appendChild(makeTreeBadge('👤', 'Security Filter: ' + gpo.securityFilter.map(f => f.trustee).join(', ')));
    }
    row.appendChild(badges);

    row.addEventListener('click', () => openGpoDetail(gpo.id));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGpoDetail(gpo.id); }
    });

    return row;
  }

  function makeTreeBadge(icon, title) {
    const span = document.createElement('span');
    span.className = 'gpo-tree-badge';
    span.title = title;
    span.textContent = icon;
    return span;
  }

  // "Standard" = ausschliesslich Authenticated Users - alles darueber
  // hinaus ist ein vom Standard abweichender Filter und wird markiert.
  //
  // Locale-Fix: der vorherige Abgleich prüfte nur die englische Bezeichnung
  // ("authenticated users$") und erkannte die deutsche Standard-Bezeichnung
  // "Authentifizierte Benutzer" nicht - dadurch wurde in der echten
  // (deutschsprachigen) 82-GPO-Domäne bei 82/82 GPOs bzw. allen 236 OU-
  // Baum-Zeilen fälschlich "vom Standard abweichend" erkannt, seit dieses
  // Badge existiert (vor V3.0). Kein neuer Typvergleich, sondern derselbe
  // exakte Abgleich, jetzt sprachunabhängig: zuerst gegen die wohlbekannte,
  // feste Windows-SID S-1-5-11 (Authenticated Users) - kein Namensvergleich,
  // kein Raten. Nur wenn trusteeSid fehlt, faellt der Vergleich auf eine
  // feste, kurze Liste bekannter Standardnamen zurueck (exakter Vergleich,
  // keine Teilstring-/Musteranerkennung). "Domain Users"/"Domänen-Benutzer"
  // (RID 513) und andere Gruppen bleiben bewusst NICHT Teil dieser Liste -
  // nur die eine bekannte "Authenticated Users"-Konstante gilt als Standard.
  const AUTHENTICATED_USERS_SID = 'S-1-5-11';
  const AUTHENTICATED_USERS_NAMES = ['authenticated users', 'authentifizierte benutzer'];

  function isDefaultSecurityFilterTrustee(filter) {
    if (filter.trusteeSid) return filter.trusteeSid.trim().toUpperCase() === AUTHENTICATED_USERS_SID;
    return AUTHENTICATED_USERS_NAMES.includes((filter.trustee || '').trim().toLowerCase());
  }

  function hasNonDefaultSecurityFilter(gpo) {
    const filters = gpo.securityFilter || [];
    if (!filters.length) return false;
    return !filters.every(isDefaultSecurityFilterTrustee);
  }

  // ── GPO-Detailansicht (Klick auf eine GPO im Baum) ──────────
  // Zeigt Metadaten, Einstellungen und alle Findings, die genau diese
  // GPO betreffen - gefiltert aus denselben _findings wie die Konflikt-/
  // Redundanz-/Hygiene-Listen, ueber denselben buildFindingCard()-
  // Dispatch wie dort (keine separate Kartendarstellung hier).
  function findingInvolvesGpo(finding, gpoId) {
    if (finding.gpoId === gpoId) return true;
    if (finding.entries) return finding.entries.some(e => e.gpoId === gpoId);
    return false;
  }

  function formatDate(iso) {
    if (!iso) return '–';
    return iso.replace('T', ' ').substring(0, 16);
  }

  // Gemeinsame numerische Basis fuer Alters-Berechnungen aus gpo.modified
  // (kein neues Analyse-Feld, keine Regel/kein Finding) - genutzt von
  // computeAgeLabel() (GPO-Detailansicht, "Alter: N Jahre") UND
  // formatRelativeModified()/explorerSortValue() (V2.6.1 GPO-Explorer-
  // Tabelle), damit dieselbe Datums-Arithmetik nicht mehrfach steht.
  // null = Datum fehlt/ungueltig ("nicht bestimmbar", nicht 0).
  function ageInDays(gpo) {
    if (!gpo.modified) return null;
    const modifiedDate = new Date(gpo.modified);
    if (isNaN(modifiedDate.getTime())) return null;
    return (Date.now() - modifiedDate.getTime()) / (24 * 3600 * 1000);
  }

  // Dieselbe Formel wie GPO_VERY_OLD in gpo-analyzer.js, hier aber
  // unabhaengig vom dortigen Schwellwert als reine Tatsache dargestellt
  // (V2.3 GPO-Detailansicht).
  function computeAgeLabel(gpo) {
    const days = ageInDays(gpo);
    if (days == null) return '–';
    const years = Math.floor(days / 365.25);
    return years + (years === 1 ? ' Jahr' : ' Jahre');
  }

  // Relative Formatierung fuer die GPO-Explorer-Tabelle (V2.6.1, Spalte
  // "Zuletzt geaendert") - "vor N Jahren" wie im Auftrag vorgegeben, mit
  // Tage-/Monate-Abstufung fuer kuerzlich geaenderte GPOs statt eines
  // unschoenen "vor 0 Jahren".
  function formatRelativeModified(gpo) {
    const days = ageInDays(gpo);
    if (days == null) return '–';
    if (days < 1) return 'heute';
    if (days < 30) {
      const d = Math.floor(days);
      return 'vor ' + d + (d === 1 ? ' Tag' : ' Tagen');
    }
    const months = Math.floor(days / 30.44);
    if (months < 12) return 'vor ' + months + (months === 1 ? ' Monat' : ' Monaten');
    const years = Math.floor(days / 365.25);
    return 'vor ' + years + (years === 1 ? ' Jahr' : ' Jahren');
  }

  function buildGpoDetailMeta(gpo) {
    const wrap = document.createElement('div');
    [
      ['Status', gpo.status || '–'],
      ['Erstellt', formatDate(gpo.created)],
      ['Geändert', formatDate(gpo.modified)],
      ['Alter', computeAgeLabel(gpo)],
      ['Computer Configuration', gpo.computerEnabled ? 'aktiviert' : 'deaktiviert'],
      ['User Configuration', gpo.userEnabled ? 'aktiviert' : 'deaktiviert'],
    ].forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'gpo-detail-row';
      row.textContent = label + ': ' + value;
      wrap.appendChild(row);
    });

    // Datenqualitaets-Hinweis direkt an der GPO, nicht als Finding - siehe
    // renderIntegrityPanel() fuer die Gesamtuebersicht ueber alle GPOs.
    if (gpo.parseStatus === 'failed') {
      const row = document.createElement('div');
      row.className = 'gpo-detail-row gpo-detail-row--warn';
      row.textContent = '⚠ Report nicht lesbar: ' + (gpo.reportError || 'unbekannter Fehler');
      wrap.appendChild(row);
    } else if (gpo.parseStatus === 'partial') {
      const row = document.createElement('div');
      row.className = 'gpo-detail-row gpo-detail-row--warn';
      row.textContent = '⚠ Nur teilweise auswertbar: ' + (gpo.parseWarnings || []).join(' ');
      wrap.appendChild(row);
    }

    return wrap;
  }

  // Verknuepfungen/Security Filtering/WMI Filter/Einstellungen als
  // eigene <details> statt einer einzigen, langen Liste (Roadmap V2.3:
  // "Informationen gruppieren", "keine riesige Tabelle mit allen Daten auf
  // einmal") - nutzt <details>/<summary> statt eines eigenen JS-Toggle-
  // Mechanismus, da dafuer keine zusaetzliche Verdrahtung noetig ist.
  function buildGpoDetailLinks(gpo) {
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.className = 'gpo-finding-sub-title';
    details.appendChild(summary);

    // links.json fehlte komplett - "Verknuepfungen (0)"/"Keine Verknuepfung
    // gefunden" waeren hier erfundene Aussagen ueber diese GPO statt einer
    // tatsaechlich ermittelten (V2.5.1). buildLinkList() bleibt fuer den
    // Fall "Datei vorhanden, aber leer" unveraendert (zeigt dort weiterhin
    // ehrlich "Keine Verknuepfung gefunden.").
    if (_model.dataQuality && _model.dataQuality.linksFileMissing) {
      summary.textContent = 'Verknüpfungen';
      const row = document.createElement('div');
      row.className = 'gpo-detail-no-link';
      row.textContent = LINKS_FILE_MISSING_NOTE;
      details.appendChild(row);
      return details;
    }

    const links = linksForGpo(gpo.id);
    summary.textContent = 'Verknüpfungen (' + links.length + ')';
    details.appendChild(buildLinkList(gpo.id));
    return details;
  }

  // null, wenn kein (vom Standard abweichender oder nicht) Security Filter
  // vorhanden ist - Abschnitt wird dann in openGpoDetail() gar nicht erst
  // angehaengt (weniger, aber relevantere Abschnitte statt einer leeren
  // Box, siehe UX-Vorgabe "ruhiger als GPMC").
  function buildGpoDetailSecurityFilter(gpo) {
    const filters = gpo.securityFilter || [];
    if (!filters.length) return null;

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.className = 'gpo-finding-sub-title';
    summary.textContent = 'Security Filtering (' + filters.length + ')';
    details.appendChild(summary);

    filters.forEach(f => {
      const row = document.createElement('div');
      row.className = 'gpo-detail-row';
      row.textContent = f.trustee + (f.permission ? ' (' + f.permission + ')' : '');
      details.appendChild(row);
    });

    // V3.0 Effective Scope: nur der Security-Filter-Teil des Hinweises (nicht
    // die kombinierte buildScopeConstraintNote()), da dieser Abschnitt
    // ausschliesslich Security Filtering betrifft.
    const secNote = buildSecurityFilterConstraintNote(gpo);
    if (secNote) {
      const noteRow = document.createElement('div');
      noteRow.className = 'gpo-detail-no-link';
      noteRow.textContent = secNote;
      details.appendChild(noteRow);
    }

    return details;
  }

  // null, wenn kein WMI-Filter zugewiesen ist - siehe Kommentar an
  // buildGpoDetailSecurityFilter().
  function buildGpoDetailWmiFilter(gpo) {
    if (!gpo.wmiFilter) return null;

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.className = 'gpo-finding-sub-title';
    summary.textContent = 'WMI Filter';
    details.appendChild(summary);
    appendBodyContent(details, buildWmiFilterFacts(gpo.wmiFilter));

    // V3.0 Effective Scope: nur der WMI-Teil des Hinweises, siehe Kommentar
    // an buildGpoDetailSecurityFilter().
    const wmiNote = buildWmiFilterConstraintNote(gpo);
    if (wmiNote) {
      const noteRow = document.createElement('div');
      noteRow.className = 'gpo-detail-no-link';
      noteRow.textContent = wmiNote;
      details.appendChild(noteRow);
    }

    return details;
  }

  function buildGpoDetailSettings(gpo) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.className = 'gpo-finding-sub-title';
    summary.textContent = 'Einstellungen (' + (gpo.settings || []).length + ')';
    details.appendChild(summary);

    if (!gpo.settings || !gpo.settings.length) {
      const noneRow = document.createElement('div');
      noneRow.className = 'gpo-detail-row';
      noneRow.textContent = 'Keine konfigurierten Einstellungen.';
      details.appendChild(noneRow);
      return details;
    }

    const list = document.createElement('div');
    list.className = 'gpo-entry-row-list';
    gpo.settings.forEach(s => {
      const row = document.createElement('div');
      row.className = 'gpo-entry-row';
      const label = document.createElement('span');
      label.className = 'gpo-entry-gpo';
      label.textContent = '[' + s.scope + '] ' + s.key;
      const value = document.createElement('code');
      value.className = 'gpo-entry-value';
      value.textContent = s.value || '(leer)';
      row.append(label, value);
      list.appendChild(row);
    });
    details.appendChild(list);
    return details;
  }

  // Genutzt von buildGpoDetailFindings() (hier) UND vom GPO-Explorer
  // (V2.3 Badge, V2.6.1 Sortierung/Faerbung) - dieselbe Ermittlung "welche
  // Findings betreffen diese GPO" nicht mehrfach implementieren.
  function relatedFindingsForGpo(gpo) {
    return _findings.filter(f => findingInvolvesGpo(f, gpo.id));
  }

  function buildGpoDetailFindings(gpo) {
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Findings zu dieser GPO';
    wrap.appendChild(title);

    const related = relatedFindingsForGpo(gpo);
    if (!related.length) {
      const noneRow = document.createElement('div');
      noneRow.className = 'gpo-detail-row';
      noneRow.textContent = 'Keine Findings für diese GPO.';
      wrap.appendChild(noneRow);
      return wrap;
    }

    related.forEach(f => {
      const card = buildFindingCard(f);
      if (card) wrap.appendChild(card);
    });
    return wrap;
  }

  function openGpoDetail(gpoId) {
    const gpo = gpoById(gpoId);
    if (!gpo) return;

    const panel = document.getElementById('gpo-detail-panel');
    const title = document.getElementById('gpo-detail-panel-title');
    const body  = document.getElementById('gpo-detail-panel-body');

    title.textContent = gpo.name;
    body.replaceChildren();
    body.appendChild(buildGpoDetailMeta(gpo));
    body.appendChild(buildGpoDetailLinks(gpo));
    const secFilterDetails = buildGpoDetailSecurityFilter(gpo);
    if (secFilterDetails) body.appendChild(secFilterDetails);
    const wmiDetails = buildGpoDetailWmiFilter(gpo);
    if (wmiDetails) body.appendChild(wmiDetails);
    body.appendChild(buildGpoDetailSettings(gpo));
    body.appendChild(buildGpoDetailFindings(gpo));

    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeGpoDetail() {
    const panel = document.getElementById('gpo-detail-panel');
    if (panel) panel.hidden = true;
  }

  // ── GPO Explorer (V2.3, sortierbare Admin-Tabelle seit V2.6.1) ──────
  // Durchsuch-/sortierbare Tabelle aller GPOs, ein weiterer Einstiegspunkt
  // in dieselbe GPO-Detailansicht (openGpoDetail()) wie der OU-Baum - kein
  // eigenes Detail-System, keine neue Analyse. Alter/Findings-Anzahl sind
  // reine Ableitungen aus model/findings (ageInDays(), relatedFindingsForGpo()),
  // kein neues Feld.
  const LINKS_FILE_MISSING_SHORT = 'nicht vorhanden';

  // Kurzform der priorityIcon()-Zuordnung (V2.1) als CSS-Farbklasse -
  // dieselbe Prioritaet (real > potential > kritisch-Bucket > sonstiges),
  // keine zweite Severity-Einstufung.
  const PRIORITY_ICON_SEVERITY_CLASS = { '🔴': 'critical', '🟡': 'warning', '⚠': 'warning', 'ℹ️': 'info' };

  const EXPLORER_COLUMNS = [
    { key: 'name', label: 'Name', defaultDirection: 'asc' },
    { key: 'status', label: 'Status', defaultDirection: 'asc' },
    { key: 'modified', label: 'Zuletzt geändert', defaultDirection: 'desc' },
    { key: 'links', label: 'Verknüpfungen', defaultDirection: 'desc' },
    { key: 'findings', label: 'Findings', defaultDirection: 'desc' },
  ];

  function explorerLinksLabel(gpo) {
    if (_model.dataQuality && _model.dataQuality.linksFileMissing) return LINKS_FILE_MISSING_SHORT;
    return String(linksForGpo(gpo.id).length);
  }

  // V2.7.3: "sehr alt" liest ausschliesslich, ob der Analyzer fuer genau
  // diese GPO bereits das bestehende GPO_VERY_OLD-Finding erzeugt hat
  // (gpo-analyzer.js, VERY_OLD_THRESHOLD_YEARS unveraendert) - keine neue
  // Altersgrenze, keine neue Analyse, reine Ablesung eines bereits
  // vorhandenen Fakts. "aging" ist eine rein optische Zwischenstufe (kein
  // Finding, keine Regel, kein neuer Schwellenwert): sie nutzt denselben
  // Jahres-Uebergang (12 Monate), den formatRelativeModified() (V2.6.1)
  // bereits fuer die Text-Granularitaet verwendet, nur zusaetzlich als
  // dezente Farbabstufung. Beide Stufen faerben ausschliesslich das
  // Datum selbst (--dim), nie die Findings-Badge-Farbe - Alter und
  // Findings bleiben getrennte visuelle Kanaele.
  function isVeryOldGpo(gpo) {
    return relatedFindingsForGpo(gpo).some(f => f.rule && f.rule.id === 'GPO_VERY_OLD');
  }

  function explorerAgeTier(gpo) {
    if (isVeryOldGpo(gpo)) return 'very-old';
    const days = ageInDays(gpo);
    if (days != null && days >= 365) return 'aging';
    return 'normal';
  }

  // Ein Badge pro GPO statt einem pro Finding-Typ (sonst pro Zeile
  // potenziell 5 Badges) - Icon/Farbe folgen derselben Prioritaet wie die
  // Prioritaetenliste des Dashboards (real > potential > kritisch-Bucket >
  // sonstiges), ueber dieselbe priorityIcon()-Funktion (V2.1), keine
  // zweite Icon-/Severity-Zuordnung.
  function explorerFindingsBadgeInfo(gpo) {
    const related = relatedFindingsForGpo(gpo);
    if (!related.length) return null;
    const worst = related.find(f => f.type === 'conflict' && f.conflictLevel === 'real')
      || related.find(f => f.type === 'conflict' && f.conflictLevel === 'potential')
      || related.find(f => ['hygiene', 'security-filter'].includes(f.type) && f.rule && f.rule.bucket === 'kritisch')
      || related[0];
    const icon = priorityIcon(worst);
    return { count: related.length, icon, severityClass: PRIORITY_ICON_SEVERITY_CLASS[icon] || 'info' };
  }

  // Rohwert je Spalte fuer den Sortiervergleich - null bedeutet "nicht
  // bestimmbar" (z.B. Alter ohne gueltiges gpo.modified, Verknuepfungen bei
  // fehlender links.json) und sortiert in compareSortValues() immer ans
  // Ende, unabhaengig von der Sortierrichtung.
  function explorerSortValue(gpo, column) {
    switch (column) {
      case 'name': return (gpo.name || '').toLowerCase();
      case 'status': return gpo.status === 'AllSettingsEnabled' ? 'aktiv' : 'deaktiviert';
      case 'modified': return ageInDays(gpo);
      case 'links': return (_model.dataQuality && _model.dataQuality.linksFileMissing) ? null : linksForGpo(gpo.id).length;
      case 'findings': return relatedFindingsForGpo(gpo).length;
      default: return null;
    }
  }

  function compareSortValues(a, b, dir) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'string') return a.localeCompare(b) * dir;
    return (a - b) * dir;
  }

  // Standard-Sortierung: Findings absteigend, bei Gleichstand Alter
  // absteigend (auffaelligste/aelteste GPOs zuerst) - bei allen anderen
  // Spalten Name als stabiler Tiebreak, damit die Reihenfolge bei
  // Gleichstand nicht "springt".
  function sortExplorerGpos(gpos) {
    const { column, direction } = _state.explorerSort;
    const dir = direction === 'asc' ? 1 : -1;

    return [...gpos].sort((gpoA, gpoB) => {
      let cmp = compareSortValues(explorerSortValue(gpoA, column), explorerSortValue(gpoB, column), dir);
      if (cmp !== 0) return cmp;
      if (column === 'findings') {
        cmp = compareSortValues(ageInDays(gpoA), ageInDays(gpoB), -1);
        if (cmp !== 0) return cmp;
      }
      return (gpoA.name || '').localeCompare(gpoB.name || '');
    });
  }

  function buildExplorerTableHead() {
    const thead = document.createElement('thead');
    const row = document.createElement('tr');
    EXPLORER_COLUMNS.forEach(col => {
      const th = document.createElement('th');
      th.className = 'gpo-explorer-th';
      th.scope = 'col';
      const isActive = _state.explorerSort.column === col.key;
      th.textContent = col.label + (isActive ? (_state.explorerSort.direction === 'asc' ? ' ▲' : ' ▼') : '');
      if (isActive) {
        th.classList.add('gpo-explorer-th--active');
        th.setAttribute('aria-sort', _state.explorerSort.direction === 'asc' ? 'ascending' : 'descending');
      }
      th.addEventListener('click', () => {
        if (_state.explorerSort.column === col.key) {
          _state.explorerSort.direction = _state.explorerSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          _state.explorerSort.column = col.key;
          _state.explorerSort.direction = col.defaultDirection;
        }
        renderExplorerList();
      });
      row.appendChild(th);
    });
    thead.appendChild(row);
    return thead;
  }

  // Gleiches Interaktionsmuster wie buildOuGpoRow() im OU-Baum: klick-
  // und tastaturbedienbare Zeile, oeffnet ueber openGpoDetail() dieselbe,
  // einzige GPO-Detailansicht - kein zweites Detail-System fuer den
  // Explorer. parseStatus-Warnung (failed/partial) bleibt als Icon+Tooltip
  // an der Name-Zelle erhalten, statt beim Tabellenumbau verlorenzugehen -
  // "Status" (Spalte) ist ausschliesslich gpo.status (aktiv/deaktiviert).
  // V2.7.3: jede Zelle traegt zusaetzlich data-label = EXPLORER_COLUMNS-
  // Label (dieselbe Beschriftung wie der Tabellenkopf, keine zweite
  // Textquelle) - genutzt von der mobilen Karten-Darstellung (CSS
  // ::before, siehe gpo.css), Desktop-Tabelle ignoriert das Attribut.
  function buildExplorerRow(gpo) {
    const row = document.createElement('tr');
    row.className = 'gpo-explorer-row';
    row.tabIndex = 0;

    const nameCell = document.createElement('td');
    nameCell.className = 'gpo-explorer-cell gpo-explorer-cell--name';
    nameCell.dataset.label = EXPLORER_COLUMNS[0].label;
    if (gpo.parseStatus === 'failed' || gpo.parseStatus === 'partial') {
      const warnIcon = document.createElement('span');
      warnIcon.className = 'gpo-explorer-warn-icon';
      warnIcon.textContent = '⚠';
      warnIcon.title = gpo.parseStatus === 'failed' ? 'Report nicht lesbar' : 'Nur teilweise auswertbar';
      nameCell.appendChild(warnIcon);
    }
    nameCell.append(gpo.name);

    const statusCell = document.createElement('td');
    statusCell.className = 'gpo-explorer-cell';
    statusCell.dataset.label = EXPLORER_COLUMNS[1].label;
    statusCell.textContent = gpo.status === 'AllSettingsEnabled' ? 'aktiv' : 'deaktiviert';

    // Alter (V2.7.3): faerbt ausschliesslich diese Zelle (--dim, siehe
    // explorerAgeTier()) und bleibt damit optisch vollstaendig getrennt von
    // der Findings-Badge-Farbe weiter unten - eine alte GPO ohne Findings
    // bekommt hier NIE eine Findings-Farbe (rot/gelb/tuerkis).
    const modifiedCell = document.createElement('td');
    const ageTier = explorerAgeTier(gpo);
    modifiedCell.className = 'gpo-explorer-cell gpo-explorer-cell--age-' + ageTier;
    modifiedCell.dataset.label = EXPLORER_COLUMNS[2].label;
    if (ageTier === 'very-old') {
      const ageIcon = document.createElement('span');
      ageIcon.className = 'gpo-explorer-age-icon';
      ageIcon.textContent = '🕒';
      ageIcon.title = 'Sehr alt - siehe Wartungshinweis im Dashboard';
      modifiedCell.appendChild(ageIcon);
    }
    modifiedCell.append(formatRelativeModified(gpo));
    modifiedCell.title = formatDate(gpo.modified);

    const linksCell = document.createElement('td');
    linksCell.className = 'gpo-explorer-cell';
    linksCell.dataset.label = EXPLORER_COLUMNS[3].label;
    linksCell.textContent = explorerLinksLabel(gpo);

    const findingsCell = document.createElement('td');
    findingsCell.className = 'gpo-explorer-cell';
    findingsCell.dataset.label = EXPLORER_COLUMNS[4].label;
    const badgeInfo = explorerFindingsBadgeInfo(gpo);
    if (badgeInfo) {
      const badge = document.createElement('span');
      badge.className = 'gpo-explorer-badge gpo-explorer-badge--' + badgeInfo.severityClass;
      badge.textContent = badgeInfo.icon + ' ' + badgeInfo.count;
      findingsCell.appendChild(badge);
    } else {
      findingsCell.textContent = '–';
    }

    row.append(nameCell, statusCell, modifiedCell, linksCell, findingsCell);

    row.addEventListener('click', () => openGpoDetail(gpo.id));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGpoDetail(gpo.id); }
    });

    return row;
  }

  // Klassifiziert eine GPO fuer den Status-Filter anhand von gpo.status
  // (bereits vorhandenes Feld, 1:1 aus dem Collector/gpo-parser.js - keine
  // neue Statuslogik). gpo.status ist der GpoStatus-Enum-Wert aus dem
  // GroupPolicy-PowerShell-Modul und kennt genau 4 Werte:
  // 'AllSettingsEnabled' (aktiv) sowie 'AllSettingsDisabled'/
  // 'UserSettingsDisabled'/'ComputerSettingsDisabled' (jeweils
  // deaktiviert). Die bestehende Status-TEXT-Anzeige pro Zeile
  // (statusCell.textContent, siehe buildExplorerRow()) bleibt bewusst
  // unveraendert (weiterhin binaer "aktiv"/"deaktiviert") - dieser Helper
  // ist ausschliesslich fuer die Filter-Menge zustaendig und unterscheidet
  // zusaetzlich 'unknown' fuer den (in den echten Snapshots nicht
  // vorkommenden, aber nicht auszuschliessenden) Fall eines fehlenden/
  // nicht erkannten status-Werts - eine solche GPO darf nicht
  // stillschweigend "aktiv" oder "deaktiviert" zugeordnet werden und
  // erscheint deshalb ausschliesslich unter "Alle", nie unter "Aktiv"
  // oder "Deaktiviert".
  const GPO_DISABLED_STATUS_VALUES = ['AllSettingsDisabled', 'UserSettingsDisabled', 'ComputerSettingsDisabled'];
  function gpoExplorerStatusCategory(gpo) {
    if (gpo.status === 'AllSettingsEnabled') return 'active';
    if (GPO_DISABLED_STATUS_VALUES.indexOf(gpo.status) !== -1) return 'disabled';
    return 'unknown';
  }

  function renderExplorerList() {
    const list = document.getElementById('gpo-explorer-list');
    const empty = document.getElementById('gpo-explorer-empty');
    const countEl = document.getElementById('gpo-explorer-count');
    if (!list || !empty || !countEl) return;
    list.replaceChildren();

    const gpos = _model.gpos || [];
    countEl.textContent = gpos.length;

    if (!gpos.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const q = _state.explorerQuery.toLowerCase();
    let filtered = q ? gpos.filter(g => (g.name || '').toLowerCase().includes(q)) : gpos;

    // Statusfilter (nach der Namenssuche, vor der bestehenden Sortierung -
    // reine Mengen-Einschraenkung, AND-verknuepft mit der Suche). 'all'
    // laesst die Menge unveraendert, damit der Ausgangszustand exakt
    // erhalten bleibt.
    if (_state.explorerStatusFilter !== 'all') {
      filtered = filtered.filter(g => gpoExplorerStatusCategory(g) === _state.explorerStatusFilter);
    }

    if (!filtered.length) {
      const noMatch = document.createElement('div');
      noMatch.className = 'gpo-empty';
      noMatch.textContent = 'Keine GPOs gefunden.';
      list.appendChild(noMatch);
      return;
    }

    const sorted = sortExplorerGpos(filtered);

    const table = document.createElement('table');
    table.className = 'gpo-explorer-table';
    table.appendChild(buildExplorerTableHead());
    const tbody = document.createElement('tbody');
    sorted.forEach(gpo => tbody.appendChild(buildExplorerRow(gpo)));
    table.appendChild(tbody);
    list.appendChild(table);
  }

  // ── BSI-Coverage (Computer-Kategorie-Aggregation) ───────────
  // Reine Darstellung von window.GpoBsiMapping.evaluateComputerCoverage() -
  // keine neue Berechnung, keine neue Klassifikation hier. Bewusste Scope-
  // Grenze dieses Schritts: kein Drill-down auf einzelne GPOs/Computer,
  // obwohl die Daten dafuer in evidence vorlaegen - das ist eine spaetere
  // Erweiterung, keine hier offene Luecke. Es gibt aktuell KEINEN GPO-
  // zentrierten BSI-Bereich in der UI (die BSI-Foundation-v1-Ergebnisse aus
  // evaluate() waren bisher nur in Testberichten sichtbar) - dieser
  // Abschnitt zeigt ausschliesslich die Computer-Kategorie-Sicht.
  //
  // Coverage != Compliance: "covered" heisst nur "fuer diesen Computer-
  // Bereich existiert eine eindeutig auswertbare GPO-Konfiguration" - NICHT
  // "die Anforderung ist erfuellt" (ein Computer kann covered UND
  // nicht_erfuellt gleichzeitig sein, siehe echter 82-GPO-Fall NTLM/Domain
  // Controllers). Der tatsaechliche BSI-Status wird in dieser Ansicht nicht
  // dargestellt (kein Drill-down), deshalb bewusst neutrale statt gruen/rote
  // Farbgebung fuer "covered" - eine gruene Zahl neben "covered" wuerde
  // sonst wie eine Erfuellt-Aussage wirken, obwohl sie das nicht ist.
  const BSI_REQUIREMENT_LABELS = {
    'BSI-SYS.2.2.3-NTLM-LM-LEVEL': 'NTLM',
    'BSI-APP.2.2-SECURE-CHANNEL': 'Secure Channel',
    'BSI-SYS.2.2.3-SMB-SIGNING': 'SMB-Signierung',
  };
  const BSI_CATEGORY_LABELS = {
    domain_controllers: 'Domain Controllers',
    member_servers: 'Member Server',
    clients: 'Clients',
  };
  const BSI_CATEGORY_ORDER = ['domain_controllers', 'member_servers', 'clients'];
  const BSI_REQUIREMENT_ORDER = ['BSI-SYS.2.2.3-NTLM-LM-LEVEL', 'BSI-APP.2.2-SECURE-CHANNEL', 'BSI-SYS.2.2.3-SMB-SIGNING'];

  function renderBsiCoverage() {
    const container = document.getElementById('gpo-bsi-container');
    if (!container) return;
    container.replaceChildren();

    const intro = document.createElement('div');
    intro.className = 'gpo-bsi-intro';
    intro.textContent = 'Coverage zeigt nur, ob für einen Computer-Bereich eine eindeutig auswertbare GPO-Konfiguration vorliegt – nicht, ob die Anforderung erfüllt ist. Diese Ansicht zeigt ausschließlich die Computer-Kategorie-Aggregation für die drei bestehenden BSI-Requirements, kein Drill-down auf einzelne GPOs oder Computer.';
    container.appendChild(intro);

    if (!window.GpoBsiMapping || typeof window.GpoBsiMapping.evaluateComputerCoverage !== 'function') {
      const empty = document.createElement('div');
      empty.className = 'gpo-empty';
      empty.textContent = 'BSI-Coverage-Modul nicht verfügbar.';
      container.appendChild(empty);
      return;
    }

    const dataQuality = _model.dataQuality || {};
    if (dataQuality.computersFileMissing) {
      const empty = document.createElement('div');
      empty.className = 'gpo-empty';
      empty.textContent = 'Keine computers.json im Snapshot vorhanden. Computer-basierte Coverage kann für diesen Snapshot nicht ausgewertet werden.';
      container.appendChild(empty);
      return;
    }

    const coverage = window.GpoBsiMapping.evaluateComputerCoverage(_model);

    // Zeilenbezogener Covered-vs-Compliance-Hinweis: ausschliesslich aus den
    // bereits vorhandenen, GPO-zentrierten evaluate()-Ergebnissen abgeleitet
    // (dort liegen scopeCategory + coverage + status bereits gemeinsam pro
    // Eintrag vor - keine neue Berechnung, kein erneutes Auswerten von GPO-
    // Settings/Links/Filtern). evaluateComputerCoverage()'s eigene, neuere
    // Computer-Instanz-Aggregation verwirft den pro-Computer ermittelten
    // Status dagegen vollstaendig (siehe aggregateComputerCoverage() -
    // "result.status" wird dort nirgends gelesen) - deshalb ist dieser
    // Hinweis nur fuer "domain_controllers" moeglich, wo evaluate() ueber
    // addScopeCoverage() weiterhin echte scopeCategory-Eintraege mit Status
    // liefert. Fuer member_servers/clients gibt es aktuell keine
    // vorhandene Datenquelle dafuer (siehe Bericht) - der Hinweis bleibt
    // dort bewusst immer aus, statt etwas Neues zu berechnen oder zu raten.
    const gpoCentricByRequirement = (typeof window.GpoBsiMapping.evaluate === 'function')
      ? window.GpoBsiMapping.evaluate(_model, _findings)
      : {};

    const grid = document.createElement('div');
    grid.className = 'gpo-bsi-grid';
    BSI_REQUIREMENT_ORDER.forEach(requirementId => {
      if (coverage[requirementId]) {
        grid.appendChild(buildBsiRequirementCard(requirementId, coverage[requirementId], gpoCentricByRequirement[requirementId] || []));
      }
    });
    container.appendChild(grid);
  }

  function buildBsiRequirementCard(requirementId, req, gpoCentricEntries) {
    const card = document.createElement('div');
    card.className = 'gpo-bsi-requirement-card';

    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = BSI_REQUIREMENT_LABELS[requirementId] || requirementId;
    card.appendChild(title);

    BSI_CATEGORY_ORDER.forEach(catKey => {
      const cat = req.categories[catKey];
      if (cat) card.appendChild(buildBsiCategoryRow(BSI_CATEGORY_LABELS[catKey], cat, catKey, gpoCentricEntries));
    });

    const unknownLine = document.createElement('div');
    unknownLine.className = 'gpo-bsi-unknown-line';
    unknownLine.textContent = 'Unknown: ' + req.unknown + ' – Computer ohne eindeutige Kategorie, nicht in Domain Controllers/Member Server/Clients eingerechnet.';
    card.appendChild(unknownLine);

    return card;
  }

  // "Covered" bei mindestens einem vorhandenen Eintrag dieser Kategorie,
  // dessen bereits vorhandener status != 'erfuellt' ist ("mindestens
  // einer reicht" - Test G: keine Aussage ueber ALLE covered-Faelle der
  // Zeile). Absichtlich .some(), nicht .every() oder eine Mehrheitsregel.
  function bsiCoveredNonCompliantEntries(gpoCentricEntries, catKey) {
    return gpoCentricEntries.filter(e => e.scopeCategory === catKey && e.coverage === 'covered' && e.status && e.status !== 'erfuellt');
  }

  function buildBsiCategoryRow(label, cat, catKey, gpoCentricEntries) {
    const row = document.createElement('div');
    row.className = 'gpo-bsi-category-row';

    const nameEl = document.createElement('div');
    nameEl.className = 'gpo-bsi-category-name';
    nameEl.textContent = label;
    const totalEl = document.createElement('span');
    totalEl.className = 'gpo-bsi-category-total';
    totalEl.textContent = cat.total + ' Computer';
    nameEl.appendChild(totalEl);

    const nonCompliantCovered = bsiCoveredNonCompliantEntries(gpoCentricEntries, catKey);
    if (nonCompliantCovered.length > 0) {
      const infoIcon = document.createElement('span');
      infoIcon.className = 'gpo-bsi-info-icon';
      infoIcon.textContent = 'ⓘ';
      infoIcon.tabIndex = 0;
      infoIcon.title = 'Covered bedeutet hier nur, dass die GPO-Coverage eindeutig auswertbar ist. Der zugrunde liegende BSI-Status ist für mindestens einen erfassten Fall „prüfen“ oder „nicht erfüllt“, nicht automatisch „erfüllt“.';
      infoIcon.setAttribute('aria-label', infoIcon.title);
      nameEl.appendChild(infoIcon);
    }
    row.appendChild(nameEl);

    const stats = document.createElement('div');
    stats.className = 'gpo-bsi-category-stats';
    [
      ['covered', 'Covered', cat.covered],
      ['not_covered', 'Not covered', cat.not_covered],
      ['not_determinable', 'Not determinable', cat.not_determinable],
    ].forEach(([key, statLabel, value]) => {
      const stat = document.createElement('span');
      stat.className = 'gpo-bsi-stat gpo-bsi-stat--' + key;
      stat.textContent = statLabel + ': ' + value;
      stats.appendChild(stat);
    });
    row.appendChild(stats);

    return row;
  }

  // ── Suchfelder + Detail-Panel (einmalig verdrahtet, nicht bei jedem
  // Render) ────────────────────────────────────────────────────
  function initSearchInputs() {
    const conflictSearch = document.getElementById('gpo-conflict-search');
    if (conflictSearch) {
      conflictSearch.addEventListener('input', (e) => {
        _state.conflictQuery = e.target.value.trim();
        renderConflictList();
      });
    }
    const redundantSearch = document.getElementById('gpo-redundant-search');
    if (redundantSearch) {
      redundantSearch.addEventListener('input', (e) => {
        _state.redundantQuery = e.target.value.trim();
        renderRedundantList();
      });
    }
    const explorerSearch = document.getElementById('gpo-explorer-search');
    if (explorerSearch) {
      explorerSearch.addEventListener('input', (e) => {
        _state.explorerQuery = e.target.value.trim();
        renderExplorerList();
      });
    }
    const explorerStatusFilter = document.getElementById('gpo-explorer-status-filter');
    if (explorerStatusFilter) {
      explorerStatusFilter.addEventListener('change', (e) => {
        _state.explorerStatusFilter = e.target.value;
        renderExplorerList();
      });
    }
    const detailClose = document.getElementById('gpo-detail-panel-close');
    if (detailClose) detailClose.addEventListener('click', closeGpoDetail);
  }

  document.addEventListener('DOMContentLoaded', initSearchInputs);

  return { renderOverview };
})();
