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
  // V4.9: hoechstens ein aktiver RSoP-/gpresult-Bericht pro geladenem
  // Snapshot (Auftrag Abschnitt 18) - wird bei jedem neuen Snapshot-Upload
  // in renderOverview() zurueckgesetzt, ein neuer RSoP-Upload ersetzt einen
  // vorherigen. Reine Anzeigedaten, keine Rueckwirkung auf _model/_findings.
  let _rsopReport = null;
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
    // V4.8: reine Darstellungsfilter fuer die GPO-Arbeitsliste in "Pruefen &
    // Aufraeumen" - dieselbe Rolle wie explorerQuery/explorerStatusFilter,
    // veraendern nie _findings oder die bestehende Gruppierungslogik
    // (resolveGpoActionCategory()).
    cleanupQuery: '',
    cleanupGroupFilter: 'all',
    cleanupStatusFilter: 'all',
    cleanupSort: 'findings',
  };

  // Finding -> bereits gerenderte Karte (Konflikt-/Redundanz-/Hygiene-Liste).
  // Erlaubt der Prioritaeten-Liste (V2.1 Dashboard), beim Klick direkt zur
  // bestehenden Karte zu springen und sie aufzuklappen, statt eine zweite
  // Kartendarstellung zu bauen. Wird in renderOverview() pro Snapshot-Load
  // geleert, in renderConflictList()/renderRedundantList()/renderHygieneList()
  // beim Bauen der jeweiligen Karten befuellt.
  const _findingCardMap = new Map();

  // V4.1: Cache fuer den settingKey->requirementId-Index (siehe
  // getBsiSettingKeyIndex() weiter unten) - pro Snapshot-Load einmal
  // berechnet statt bei jeder einzelnen Finding-Karte erneut ueber alle
  // GPOs zu laufen. Wird in renderOverview() geleert.
  let _bsiSettingKeyIndexCache = null;

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
    _state.cleanupQuery = '';
    _state.cleanupGroupFilter = 'all';
    _state.cleanupStatusFilter = 'all';
    _state.cleanupSort = 'findings';
    _rsopReport = null;
    _bsiSettingKeyIndexCache = null;
    _findingCardMap.clear();
    resetSearchInputs();

    renderMissingHint(_missingFiles);
    renderExecutiveDashboard();
    renderTwentySecondOverview();
    renderReferenceEngine();
    renderMicrosoftBaselineComparison();
    renderOverviewSummary();
    renderIntegrityPanel();
    renderNumGrid();
    renderAmpelRow();
    renderMaintenancePanel();
    renderFindingsSummaryTiles();
    renderFilterBar();
    updateSectionVisibility();
    renderConflictList();
    renderRedundantList();
    renderHygieneList();
    renderPriorityList();
    renderActionView();
    renderGpoCleanupView();
    renderEffectivePolicyView();
    resetRsopUploadZone();
    renderRsopResult();
    hideRsopError();
    renderExplorerList();
    renderOuTree();
    renderBsiCoverage();
    renderDataBasisSection();
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
    const cleanupSearch = document.getElementById('gpo-cleanup-search');
    if (cleanupSearch) cleanupSearch.value = '';
    const cleanupSortSelect = document.getElementById('gpo-cleanup-sort-select');
    if (cleanupSortSelect) cleanupSortSelect.value = 'findings';
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
  // V4.3: optionaler modifierClass-Parameter (z.B. fuer die staerker
  // hervorgehobene Findings-Gesamtzahl) - rein optisch, bestehende Aufrufe
  // ohne 4. Argument verhalten sich exakt wie zuvor.
  function buildKpiTile(label, value, anchor, modifierClass) {
    const item = document.createElement('a');
    item.className = 'gpo-num-item' + (modifierClass ? ' ' + modifierClass : '');
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

    grid.appendChild(buildKpiTile('Findings gesamt', _findings.length, '#gpo-findings-section', 'gpo-num-item--total'));
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
    const link = document.getElementById('gpo-kpi-computer-link');
    if (!grid || !missingHint) return;
    grid.replaceChildren();

    const dataQuality = _model.dataQuality || {};
    if (dataQuality.computersFileMissing) {
      grid.hidden = true;
      missingHint.hidden = false;
      missingHint.textContent = 'Keine computers.json im Snapshot vorhanden. Computer-Population kann für diesen Snapshot nicht ausgewertet werden.';
      // V3.8: bei fehlender computers.json fuehrt der Link zur Datenbasis
      // (dort steht bereits, welche Dateien vorhanden sind) statt zur
      // dann leeren BSI-Computer-Ansicht.
      if (link) { link.href = '#gpo-databasis-section'; link.textContent = 'Datenbasis prüfen →'; }
      return;
    }
    if (!window.GpoBsiMapping || typeof window.GpoBsiMapping.evaluateComputerCoverage !== 'function') {
      grid.hidden = true;
      missingHint.hidden = false;
      missingHint.textContent = 'BSI-Coverage-Modul nicht verfügbar.';
      if (link) { link.href = '#gpo-databasis-section'; link.textContent = 'Datenbasis prüfen →'; }
      return;
    }
    grid.hidden = false;
    missingHint.hidden = true;
    if (link) { link.href = '#gpo-bsi-section'; link.textContent = 'BSI-Coverage ansehen →'; }

    const coverage = window.GpoBsiMapping.evaluateComputerCoverage(_model);
    const ntlmId = window.GpoBsiMapping.REQUIREMENT_IDS.NTLM_LM_LEVEL;
    const reference = coverage[ntlmId];
    if (!reference) return;

    grid.appendChild(buildKpiTile('Domain Controllers', reference.categories.domain_controllers.total, '#gpo-bsi-section'));
    grid.appendChild(buildKpiTile('Member Server', reference.categories.member_servers.total, '#gpo-bsi-section'));
    grid.appendChild(buildKpiTile('Clients', reference.categories.clients.total, '#gpo-bsi-section'));
    grid.appendChild(buildKpiTile('Unknown', reference.unknown, '#gpo-bsi-section'));
  }

  // V3.8: BSI-Coverage-Einstieg als kompakte Karte statt Einzeiler - zeigt
  // ausschliesslich die Anzahl (BSI_REQUIREMENT_ORDER.length) und Namen
  // (BSI_REQUIREMENT_LABELS) der bereits bestehenden Requirement-
  // Konstanten, keine eigene Verdichtungszahl/kein Prozentwert, kein neuer
  // Coverage-/Compliance-Wert. "Covered" wird hier bewusst nicht erwaehnt -
  // die massgebliche Coverage/Compliance-Unterscheidung bleibt
  // ausschliesslich in der verlinkten BSI-Coverage-Ansicht selbst.
  function renderDashboardBsiLink() {
    const container = document.getElementById('gpo-dashboard-bsi-card');
    if (!container) return;
    container.replaceChildren();

    const count = document.createElement('div');
    count.className = 'gpo-dashboard-bsi-count';
    count.textContent = BSI_REQUIREMENT_ORDER.length + ' Requirements analysiert';
    container.appendChild(count);

    const list = document.createElement('ul');
    list.className = 'gpo-dashboard-bsi-list';
    BSI_REQUIREMENT_ORDER.forEach(requirementId => {
      const li = document.createElement('li');
      li.textContent = BSI_REQUIREMENT_LABELS[requirementId] || requirementId;
      list.appendChild(li);
    });
    container.appendChild(list);

    const link = document.createElement('a');
    link.className = 'gpo-kpi-bsi-link';
    link.href = '#gpo-bsi-section';
    link.textContent = 'BSI-Coverage ansehen →';
    container.appendChild(link);
  }

  function renderExecutiveDashboard() {
    renderDashboardGpoTiles();
    renderDashboardFindingsTiles();
    renderDashboardComputerTiles();
    renderDashboardBsiLink();
  }

  function renderMicrosoftBaselineStatus() {
    const container = document.getElementById('gpo-microsoft-baseline-status');
    const zone = document.getElementById('gpo-baseline-upload-zone');
    if (!container || !window.GpoBaselineImporter) return;
    const state = window.GpoBaselineImporter.getState();
    container.replaceChildren();
    if (zone) zone.classList.toggle('gpo-baseline-upload-zone--done', state.status === 'loaded');
    if (state.status === 'empty') return;
    if (state.status === 'loading') {
      const text = document.createElement('div'); text.className = 'gpo-baseline-status-message'; text.textContent = 'Baseline wird eingelesen …'; container.appendChild(text); return;
    }
    if (state.status === 'error') {
      const err = document.createElement('div'); err.className = 'gpo-baseline-status-message gpo-baseline-status-message--error'; err.textContent = state.error || 'Microsoft-Baseline konnte nicht verarbeitet werden.'; container.appendChild(err); return;
    }
    const heading = document.createElement('div'); heading.className = 'gpo-baseline-status-heading';
    const strong = document.createElement('strong'); strong.textContent = 'Baseline importiert';
    const version = document.createElement('span'); version.textContent = state.baselineVersion || state.fileName || '';
    heading.append(strong, version); container.appendChild(heading);
    const facts = document.createElement('div'); facts.className = 'gpo-baseline-facts';
    [['GPOs', state.gpoCount], ['Settings importiert', state.settings.length], ['eindeutig vergleichbar', state.settings.filter(s => s.comparability === 'comparable').length], ['nicht eindeutig vergleichbar', state.notComparable.length]].forEach(([label, value]) => {
      const row = document.createElement('div'); const l = document.createElement('span'); l.textContent = label; const v = document.createElement('strong'); v.textContent = String(value); row.append(l, v); facts.appendChild(row);
    });
    container.appendChild(facts);
    const source = document.createElement('div'); source.className = 'gpo-baseline-source'; source.textContent = 'Quelle: ' + (state.fileName || 'Baseline-ZIP') + (state.sha256 ? ' · SHA-256: ' + state.sha256 : ''); container.appendChild(source);
    if (state.notComparable.length) {
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Nicht eindeutig vergleichbare Inhalte anzeigen (' + state.notComparable.length + ')'; details.appendChild(summary);
      const list = document.createElement('ul'); list.className = 'gpo-baseline-unmapped-list';
      state.notComparable.slice(0, 25).forEach(item => { const li = document.createElement('li'); li.textContent = (item.gpoName || item.gpoId || '') + ' · ' + (item.type || 'Extension') + ' · ' + (item.reason || 'nicht eindeutig abbildbar'); list.appendChild(li); });
      details.appendChild(list); container.appendChild(details);
    }
  }

  // V5.0: Gemeinsame Referenzstruktur als reine technische Adapter-Schicht.
  // BSI wird ausschliesslich aus den bereits verifizierten BSI-Konstanten und
  // dem bestehenden Evidence-Index gespeist. Microsoft/CIS sind hier bewusst
  // nur als vorbereitete Standards registriert; ihre Regeln werden erst in
  // V5.1/V5.2 ergänzt. Keine neue Compliance-Berechnung, kein Score.
  function renderReferenceEngine() {
    const grid = document.getElementById('gpo-reference-grid');
    if (!grid || !window.GpoReferenceEngine) return;

    const bsiSettingIndex = getBsiSettingKeyIndex();
    const settingKeysByRequirement = {};
    Object.keys(bsiSettingIndex).forEach(settingKey => {
      const requirementId = bsiSettingIndex[settingKey];
      if (!settingKeysByRequirement[requirementId]) settingKeysByRequirement[requirementId] = [];
      settingKeysByRequirement[requirementId].push(settingKey);
    });

    const bsiRequirements = BSI_REQUIREMENT_ORDER.map(requirementId => {
      const info = BSI_REQUIREMENT_INFO[requirementId] || {};
      return {
        id: requirementId,
        label: BSI_REQUIREMENT_LABELS[requirementId] || requirementId,
        title: BSI_REQUIREMENT_LABELS[requirementId] || requirementId,
        buildingBlock: info.bausteinLabel || null,
        requirementNumber: info.anforderungNr || null,
        description: info.anforderung || null,
        recommendation: info.empfehlung || null,
        sourceLabel: info.sourceLabel || null,
        sourceUrl: info.sourceUrl || null,
        settingKeys: settingKeysByRequirement[requirementId] || [],
      };
    });

    window.GpoReferenceEngine.registerRequirements('bsi', bsiRequirements);
    const catalog = window.GpoReferenceEngine.getCatalog();
    grid.replaceChildren();

    catalog.forEach(standard => {
      const card = document.createElement('article');
      card.className = 'gpo-reference-card';

      const header = document.createElement('div');
      header.className = 'gpo-reference-card-header';
      const title = document.createElement('div');
      title.className = 'gpo-reference-card-title';
      title.textContent = standard.label;
      const state = document.createElement('span');
      state.className = 'gpo-reference-state gpo-reference-state--' + standard.state;
      state.textContent = standard.state === 'active' ? 'Hinterlegt' : 'Vorbereitet';
      header.append(title, state);
      card.appendChild(header);

      const desc = document.createElement('p');
      desc.className = 'gpo-reference-card-desc';
      desc.textContent = standard.description;
      card.appendChild(desc);

      if (standard.requirements.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'gpo-reference-empty';
        empty.textContent = 'Noch keine Anforderungen / Controls hinterlegt. Die gemeinsame Struktur ist vorbereitet; die fachliche Einbindung erfolgt in einem eigenen Schritt.';
        card.appendChild(empty);
      } else {
        const count = document.createElement('div');
        count.className = 'gpo-reference-count';
        count.textContent = standard.requirements.length + ' ' + (standard.requirements.length === 1 ? 'Anforderung' : 'Anforderungen') + ' hinterlegt';
        card.appendChild(count);

        const list = document.createElement('div');
        list.className = 'gpo-reference-requirements';
        standard.requirements.forEach(requirement => {
          const item = document.createElement('div');
          item.className = 'gpo-reference-requirement';

          const itemTitle = document.createElement('div');
          itemTitle.className = 'gpo-reference-requirement-title';
          itemTitle.textContent = (requirement.requirementNumber ? requirement.requirementNumber + ' · ' : '') + requirement.label;
          item.appendChild(itemTitle);

          if (requirement.buildingBlock) {
            const block = document.createElement('div');
            block.className = 'gpo-reference-meta';
            block.textContent = requirement.buildingBlock;
            item.appendChild(block);
          }

          if (requirement.sourceUrl) {
            const source = document.createElement('a');
            source.className = 'gpo-kpi-bsi-link';
            source.href = requirement.sourceUrl;
            source.target = '_blank';
            source.rel = 'noopener noreferrer';
            source.textContent = 'Offizielle Quelle öffnen →';
            item.appendChild(source);
          }

          const mapping = document.createElement('div');
          mapping.className = 'gpo-reference-meta';
          mapping.textContent = requirement.settingKeys.length > 0
            ? requirement.settingKeys.length + ' eindeutige Setting-Zuordnung' + (requirement.settingKeys.length === 1 ? '' : 'en') + ' aus bestehender BSI-Evidenz'
            : 'Keine eindeutige Setting-Zuordnung aus der bestehenden Evidenz hinterlegt';
          item.appendChild(mapping);

          list.appendChild(item);
        });
        card.appendChild(list);
      }

      grid.appendChild(card);
    });
    renderMicrosoftBaselineStatus();
  }

  // V5.1-D: Microsoft-Baseline gegen den bereits geladenen Snapshot vergleichen.
  // Reine Setting-Ebene: keine Gewinner-GPO, kein Score, keine Prozentwerte.
  function baselineComparableValue(value) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value).trim();
  }

  function collectMicrosoftBaselineComparison() {
    const baseline = window.GpoReferenceEngine && window.GpoReferenceEngine.getBaseline
      ? window.GpoReferenceEngine.getBaseline() : null;
    if (!baseline) return null;

    const baselineGroups = new Map();
    (baseline.settings || []).forEach(setting => {
      if (setting.comparability !== 'comparable') return;
      const key = (setting.scope || '') + '::' + setting.settingKey;
      if (!baselineGroups.has(key)) baselineGroups.set(key, []);
      baselineGroups.get(key).push(setting);
    });

    const snapshotGroups = new Map();
    (_model.gpos || []).forEach(gpo => {
      (gpo.settings || []).forEach(setting => {
        const key = (setting.scope || '') + '::' + setting.key;
        if (!snapshotGroups.has(key)) snapshotGroups.set(key, []);
        snapshotGroups.get(key).push({
          gpoId: gpo.id,
          gpoName: gpo.name,
          value: setting.value,
        });
      });
    });

    const results = [];
    baselineGroups.forEach((baselineEntries, key) => {
      const first = baselineEntries[0];
      const baselineValues = Array.from(new Set(baselineEntries.map(s => baselineComparableValue(s.value)).filter(v => v !== null)));
      const snapshotEntries = snapshotGroups.get(key) || [];
      const snapshotValues = Array.from(new Set(snapshotEntries.map(s => baselineComparableValue(s.value)).filter(v => v !== null)));
      let status;
      if (baselineValues.length !== 1) status = 'not_comparable';
      else if (snapshotEntries.length === 0) status = 'missing';
      else if (snapshotValues.length !== 1) status = 'not_comparable';
      else status = snapshotValues[0] === baselineValues[0] ? 'match' : 'deviation';

      results.push({
        status,
        scope: first.scope,
        settingKey: first.settingKey,
        name: first.name,
        category: first.category,
        baselineValue: baselineValues.length === 1 ? baselineValues[0] : null,
        baselineGpos: Array.from(new Set(baselineEntries.map(s => s.gpoName).filter(Boolean))),
        snapshotValues,
        snapshotGpos: Array.from(new Set(snapshotEntries.map(s => s.gpoName).filter(Boolean))),
        snapshotGpoIds: Array.from(new Set(snapshotEntries.map(s => s.gpoId).filter(Boolean))),
      });
    });

    results.sort((a, b) => {
      const order = { deviation: 0, not_comparable: 1, missing: 2, match: 3 };
      return (order[a.status] - order[b.status]) || a.settingKey.localeCompare(b.settingKey);
    });

    const summary = { total: results.length, match: 0, deviation: 0, missing: 0, not_comparable: 0, baselineNotComparable: Number(baseline.notComparableCount || 0) };
    results.forEach(r => { summary[r.status]++; });
    return { results, summary, baseline };
  }

  function renderMicrosoftBaselineComparison() {
    const empty = document.getElementById('gpo-microsoft-baseline-compare-empty');
    const content = document.getElementById('gpo-microsoft-baseline-compare-content');
    const summaryEl = document.getElementById('gpo-microsoft-baseline-compare-summary');
    const listEl = document.getElementById('gpo-microsoft-baseline-compare-list');
    const filterEl = document.getElementById('gpo-microsoft-baseline-compare-filter');
    const searchEl = document.getElementById('gpo-microsoft-baseline-compare-search');
    const countEl = document.getElementById('gpo-microsoft-baseline-compare-result-count');
    if (!empty || !content || !summaryEl || !listEl) return;

    const comparison = collectMicrosoftBaselineComparison();
    if (!comparison) {
      empty.hidden = false;
      content.hidden = true;
      return;
    }
    empty.hidden = true;
    content.hidden = false;

    const s = comparison.summary;
    summaryEl.replaceChildren();
    const oldNote = summaryEl.parentElement.querySelector('.gpo-baseline-compare-note');
    if (oldNote) oldNote.remove();
    [
      ['Importiert', comparison.baseline.settings.length, 'total'],
      ['Vergleichsgruppen', s.total, 'total'],
      ['✓ Übereinstimmung', s.match, 'match'],
      ['⚠ Abweichung', s.deviation, 'deviation'],
      ['ℹ Nicht vorhanden', s.missing, 'missing'],
      ['? Nicht vergleichbar', s.not_comparable, 'not_comparable'],
    ].forEach(([label, value, kind]) => {
      const item = document.createElement('div');
      item.className = 'gpo-baseline-compare-stat gpo-baseline-compare-stat--' + kind;
      const valueEl = document.createElement('strong'); valueEl.textContent = String(value);
      const labelEl = document.createElement('span'); labelEl.textContent = label;
      item.append(valueEl, labelEl); summaryEl.appendChild(item);
    });
    const baselineNote = document.createElement('div');
    baselineNote.className = 'gpo-baseline-compare-note';
    baselineNote.textContent = String(s.baselineNotComparable) + ' Baseline-Inhalte sind bereits beim Import als nicht eindeutig vergleichbar gekennzeichnet und werden nicht in die Vergleichsgruppen einbezogen.';
    summaryEl.parentElement.insertBefore(baselineNote, summaryEl.nextSibling);

    const missingNote = document.createElement('div');
    missingNote.className = 'gpo-baseline-compare-guidance';
    missingNote.innerHTML = '<strong>ℹ „Nicht vorhanden“ ist kein Handlungsurteil.</strong> Es bedeutet nur, dass das entsprechende Setting im geladenen Snapshot nicht gefunden wurde. Die ' + String(s.missing) + ' Einträge sollten deshalb einzeln weiter geprüft werden; je nach Umgebung ist ein fehlendes Snapshot-Setting nicht automatisch problematisch. Die Zahlen oben sind bewusst <strong>keine Compliance-Quote und kein Score</strong>.';
    summaryEl.parentElement.insertBefore(missingNote, summaryEl.nextSibling);

    const findFindingForResult = (result) => {
      const candidates = (_findings || []).filter(f => {
        if (!f || f.settingKey !== result.settingKey) return false;
        if (!result.snapshotGpoIds.length) return true;
        return result.snapshotGpoIds.some(id => findingInvolvesGpo(f, id));
      });
      return candidates[0] || null;
    };

    const renderList = () => {
      const filter = filterEl ? filterEl.value : 'all';
      const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
      const filtered = comparison.results.filter(r => {
        if (filter !== 'all' && r.status !== filter) return false;
        if (!query) return true;
        return [r.settingKey, r.name, r.category, r.scope, ...r.baselineGpos, ...r.snapshotGpos].filter(Boolean).join(' ').toLowerCase().includes(query);
      });
      listEl.replaceChildren();
      const cap = 20;
      filtered.slice(0, cap).forEach(r => {
        const article = document.createElement('article'); article.className = 'gpo-baseline-compare-row gpo-baseline-compare-row--' + r.status;
        const top = document.createElement('div'); top.className = 'gpo-baseline-compare-row-top';
        const status = document.createElement('span'); status.className = 'gpo-baseline-compare-badge gpo-baseline-compare-badge--' + r.status;
        status.textContent = ({match:'✓ Übereinstimmung', deviation:'⚠ Abweichung', missing:'ℹ Nicht vorhanden', not_comparable:'? Nicht vergleichbar'})[r.status];
        const scope = document.createElement('span'); scope.className = 'gpo-reference-meta'; scope.textContent = r.scope || 'Scope unbekannt';
        top.append(status, scope); article.appendChild(top);
        const title = document.createElement('div'); title.className = 'gpo-baseline-compare-setting'; title.textContent = r.settingKey; article.appendChild(title);
        const values = document.createElement('div'); values.className = 'gpo-baseline-compare-values';
        const base = document.createElement('div'); base.innerHTML = '<span>Microsoft</span><strong></strong>'; base.querySelector('strong').textContent = r.baselineValue === null ? 'nicht eindeutig' : r.baselineValue;
        const snap = document.createElement('div'); snap.innerHTML = '<span>Snapshot</span><strong></strong>'; snap.querySelector('strong').textContent = r.snapshotValues.length ? r.snapshotValues.join(' · ') : 'nicht vorhanden';
        values.append(base, snap); article.appendChild(values);
        const source = document.createElement('div'); source.className = 'gpo-baseline-compare-meta';
        const msLine = document.createElement('div');
        msLine.append(document.createTextNode('Microsoft-GPO: ' + (r.baselineGpos.length ? r.baselineGpos.join(', ') : 'unbekannt')));
        source.appendChild(msLine);
        const snapLine = document.createElement('div');
        snapLine.append(document.createTextNode('Snapshot-GPO: '));
        if (r.snapshotGpoIds.length) {
          r.snapshotGpoIds.forEach((id, index) => {
            if (index) snapLine.appendChild(document.createTextNode(', '));
            const gpo = gpoById(id);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gpo-baseline-compare-link';
            button.textContent = gpo ? gpo.name : (r.snapshotGpos[index] || id);
            button.addEventListener('click', () => openGpoDetail(id));
            snapLine.appendChild(button);
          });
        } else {
          snapLine.appendChild(document.createTextNode('keine'));
        }
        source.appendChild(snapLine);
        const finding = findFindingForResult(r);
        if (finding) {
          const findingLine = document.createElement('div');
          findingLine.className = 'gpo-baseline-compare-finding-link';
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'gpo-baseline-compare-link';
          button.textContent = 'Finding öffnen →';
          button.addEventListener('click', () => jumpToFindingCard(finding, '#gpo-findings-section'));
          findingLine.appendChild(button);
          source.appendChild(findingLine);
        }
        article.appendChild(source);
        listEl.appendChild(article);
      });
      if (filtered.length > cap) { const more = document.createElement('div'); more.className = 'gpo-baseline-compare-more'; more.textContent = 'Weitere ' + (filtered.length - cap) + ' Einträge über Filter/Suche eingrenzen.'; listEl.appendChild(more); }
      if (!filtered.length) { const none = document.createElement('div'); none.className = 'gpo-baseline-compare-empty'; none.textContent = 'Keine Einträge für diese Auswahl.'; listEl.appendChild(none); }
      if (countEl) countEl.textContent = filtered.length + ' von ' + comparison.results.length + ' Einträgen';
    };
    renderList();
    if (filterEl && !filterEl.dataset.bound) { filterEl.dataset.bound = '1'; filterEl.addEventListener('change', renderList); }
    if (searchEl && !searchEl.dataset.bound) { searchEl.dataset.bound = '1'; searchEl.addEventListener('input', renderList); }
  }

  // V4.7: kompakte Textzusammenfassung ("Kurzueberblick") zwischen den
  // Zahlen-Kacheln und der Handlungssicht - ausschliesslich bereits
  // vorhandene absolute Zahlen (GPO-/Findings-Anzahl, BSI_REQUIREMENT_ORDER)
  // sowie die bereits in V4.4 etablierte resolveActionCategory()-Einstufung
  // (hier nur gezaehlt, nicht neu berechnet). Keine Prozentwerte, keine
  // Gesamtbewertung - reine Umformulierung bereits angezeigter Zahlen in
  // Fliesstext.
  // V5.0.1: bewusst sehr kompakter 20-Sekunden-Einstieg.
  // Ausschliesslich bereits vorhandene absolute Zahlen; keine Prozentwerte,
  // Scores oder neue Bewertung. Die Links fuehren direkt in bestehende
  // Arbeitsbereiche.
  function renderTwentySecondOverview() {
    const facts = document.getElementById('gpo-20sec-facts');
    if (!facts) return;
    facts.replaceChildren();

    let actionCount = 0, reviewCount = 0;
    _findings.forEach(f => {
      const cat = resolveActionCategory(f);
      if (cat === 'action') actionCount++;
      else if (cat === 'review') reviewCount++;
    });

    const gpos = (_model.gpos || []).length;
    const active = (_model.gpos || []).filter(g => gpoExplorerStatusCategory(g) === 'active').length;
    const disabled = (_model.gpos || []).filter(g => gpoExplorerStatusCategory(g) === 'disabled').length;

    const makeFact = (label, value, detail, href) => {
      const item = document.createElement(href ? 'a' : 'div');
      item.className = 'gpo-20sec-fact';
      if (href) item.href = href;
      const labelEl = document.createElement('span');
      labelEl.className = 'gpo-20sec-fact-label';
      labelEl.textContent = label;
      const valueEl = document.createElement('strong');
      valueEl.className = 'gpo-20sec-fact-value';
      valueEl.textContent = value;
      const detailEl = document.createElement('span');
      detailEl.className = 'gpo-20sec-fact-detail';
      detailEl.textContent = detail;
      item.append(labelEl, valueEl, detailEl);
      facts.appendChild(item);
    };

    makeFact('GPO-Bestand', String(gpos), active + ' aktiv · ' + disabled + ' deaktiviert', '#gpo-explorer-section');
    makeFact('Findings', String(_findings.length), actionCount + ' Handlungsbedarf · ' + reviewCount + ' Prüfung', '#gpo-findings-section');
    makeFact('BSI', String(BSI_REQUIREMENT_ORDER.length), 'Requirements analysiert', '#gpo-bsi-section');

    const dataQuality = _model.dataQuality || {};
    if (dataQuality.computersFileMissing) {
      makeFact('Computer', '—', 'keine computers.json im Snapshot', '#gpo-databasis-section');
    } else if (window.GpoBsiMapping && typeof window.GpoBsiMapping.evaluateComputerCoverage === 'function') {
      const coverage = window.GpoBsiMapping.evaluateComputerCoverage(_model);
      const ntlmId = window.GpoBsiMapping.REQUIREMENT_IDS.NTLM_LM_LEVEL;
      const reference = coverage[ntlmId];
      if (reference) {
        const dc = reference.categories.domain_controllers.total;
        const ms = reference.categories.member_servers.total;
        const clients = reference.categories.clients.total;
        makeFact('Computer', String(dc + ms + clients + reference.unknown), dc + ' DC · ' + ms + ' Server · ' + clients + ' Clients · ' + reference.unknown + ' Unknown', '#gpo-bsi-section');
      }
    }
  }

  function renderOverviewSummary() {
    const list = document.getElementById('gpo-overview-summary');
    if (!list) return;
    list.replaceChildren();

    let actionCount = 0, reviewCount = 0;
    _findings.forEach(f => {
      const cat = resolveActionCategory(f);
      if (cat === 'action') actionCount++;
      else if (cat === 'review') reviewCount++;
    });

    const gpoCount = (_model.gpos || []).length;
    const items = [
      gpoCount + ' ' + (gpoCount === 1 ? 'GPO wurde' : 'GPOs wurden') + ' analysiert.',
      _findings.length + ' ' + (_findings.length === 1 ? 'Befund wurde' : 'Befunde wurden') + ' gefunden.',
      actionCount + ' ' + (actionCount === 1 ? 'Befund ist' : 'Befunde sind') + ' als Handlungsbedarf eingeordnet.',
      reviewCount + ' weitere ' + (reviewCount === 1 ? 'Befund erfordert' : 'Befunde erfordern') + ' eine Prüfung.',
      'BSI-Coverage ist für ' + BSI_REQUIREMENT_ORDER.length + ' Requirements verfügbar.',
    ];

    items.forEach(text => {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
  }

  // V3.7: kompakte Zusammenfassung am Kopf des neuen "Findings"-
  // Hauptbereichs (Auftrag Punkt 6) - wiederverwendet buildKpiTile()/
  // countByType() 1:1 wie die Dashboard-Findings-Kacheln oben, keine neue
  // Zaehlung, nur eine zweite Anzeige-Stelle naeher an den Detaillisten.
  function renderFindingsSummaryTiles() {
    const grid = document.getElementById('gpo-findings-summary-grid');
    if (!grid) return;
    grid.replaceChildren();

    grid.appendChild(buildKpiTile('Konflikte', countByType('conflict'), '#gpo-conflict-section'));
    grid.appendChild(buildKpiTile('Mehrfachdefinitionen', countByType('redundant'), '#gpo-redundant-section'));
    grid.appendChild(buildKpiTile('Hygiene', countByType('hygiene'), '#gpo-hygiene-section'));
    grid.appendChild(buildKpiTile('Security-Filter', countByType('security-filter'), '#gpo-hygiene-section'));
    grid.appendChild(buildKpiTile('WMI-Filter', countByType('wmi-filter'), '#gpo-hygiene-section'));
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

  // ── Handlungsbedarf-Ansicht (V4.4 Executive Dashboard) ──────
  // Gruppiert ALLE Findings (nicht nur Top-5 wie die Prioritaeten-Liste
  // oben) in drei feste, immer sichtbare Kategorien - ausschliesslich ueber
  // bereits vorhandene Felder (finding.conflictLevel, rule.bucket aus
  // rules.json). Keine neue Risikoberechnung, kein Scoring, keine
  // "Gewinner-GPO"-Logik. Bewusst eine EIGENSTAENDIGE Klassifizierung statt
  // Wiederverwendung von priorityIcon()/collectPriorityFindings() weiter
  // oben: jene Funktion behandelt den Bucket "pruefen" (aktuell nur
  // SECURITY_FILTER_SERVER_OU_USER_FILTER) nicht gesondert (faellt auf
  // HYGIENE_SEVERITY_ICONS[severity] zurueck, aktuell 'info' -> ℹ️), waehrend
  // diese Ansicht "pruefen" explizit als 🟡 einordnet - passend zum eigenen
  // Namen des Buckets und den Beispielen im Auftrag. Die bestehende
  // Prioritaeten-Liste bleibt davon unveraendert (Auftrag: bestehendes
  // Dashboard nicht antasten).
  function resolveActionCategory(finding) {
    if (finding.type === 'conflict') {
      return finding.conflictLevel === 'real' ? 'action' : 'review';
    }
    if (finding.rule) {
      if (finding.rule.bucket === 'kritisch') return 'action';
      if (finding.rule.bucket === 'pruefen') return 'review';
    }
    // Konservativer Standardfall: Mehrfachdefinitionen (identische Werte,
    // keine Mehrdeutigkeit), WMI-Filter-Hinweise sowie Hygiene-/Security-
    // Filter-Findings in den Buckets wartung/struktur/information - alles,
    // was ohne eine neue fachliche Einstufung nicht eindeutig hoeher
    // eingeordnet werden kann.
    return 'info';
  }

  const ACTION_CATEGORY_META = {
    action: { icon: '🔴', title: 'Handlungsbedarf', severityClass: 'critical' },
    review: { icon: '🟡', title: 'Prüfung erforderlich', severityClass: 'warning' },
    info: { icon: 'ℹ️', title: 'Hinweise', severityClass: 'info' },
  };
  const ACTION_CATEGORY_ORDER = ['action', 'review', 'info'];
  const ACTION_TYPE_LABELS = {
    conflict: 'Konflikt',
    redundant: 'Mehrfachdefinition',
    hygiene: 'Hygiene',
    'security-filter': 'Security-Filter',
    'wmi-filter': 'WMI-Filter',
  };
  // Kompakte Auswahl je Kategorie - dieselbe Obergrenze (5), die bereits die
  // bestehende Prioritaeten-Liste verwendet (collectPriorityFindings()),
  // keine neue Zahl erfunden. Keine Umsortierung: die Findings erscheinen in
  // derselben Reihenfolge wie in _findings (Auftrag Abschnitt 8: keine
  // kuenstliche Priorisierung, wenn keine belastbare Rangfolge existiert).
  const ACTION_VIEW_MAX_PER_CATEGORY = 5;

  function collectActionBuckets() {
    const buckets = { action: [], review: [], info: [] };
    _findings.forEach(f => buckets[resolveActionCategory(f)].push(f));
    return buckets;
  }

  // Kurzbeschreibung je Finding-Typ - dieselben Konstanten/Funktionen, die
  // resolveFindingSections() bereits fuer "Was"/"Bewertung" verwendet
  // (CONFLICT_DESC/REDUNDANT_DESC/resolveRuleText/rule.description), keine
  // zweite Textformulierung.
  function actionShortDescription(finding) {
    if (finding.type === 'conflict') return CONFLICT_DESC;
    if (finding.type === 'redundant') return REDUNDANT_DESC;
    const rule = finding.rule || {};
    if (finding.type === 'hygiene') return resolveRuleText(rule.description, finding.detail) || '';
    return rule.description || '';
  }

  function actionTitle(finding) {
    if (finding.type === 'conflict' || finding.type === 'redundant') {
      return splitSettingKey(finding.settingKey).name;
    }
    const rule = finding.rule || {};
    return resolveRuleText(rule.name, finding.detail) || finding.gpoName || '';
  }

  function actionScopeLabel(finding) {
    const count = finding.entries.length;
    return count + (count === 1 ? ' GPO betroffen' : ' GPOs betroffen');
  }

  function actionAnchor(finding) {
    if (finding.type === 'conflict') return '#gpo-conflict-section';
    if (finding.type === 'redundant') return '#gpo-redundant-section';
    return '#gpo-hygiene-section';
  }

  // Kompakte BSI-Bezug-Zeile - dieselbe, bereits in getBsiSettingKeyIndex()/
  // BSI_REQUIREMENT_INFO (V4.1/V3.5.3) hinterlegte, verifizierte Zuordnung,
  // nur kuerzer dargestellt als das ausfuehrliche buildFindingBsiContext().
  // Kein neuer BSI-Abgleich, keine neue Empfehlung. Ohne Treffer wird
  // bewusst nichts angezeigt (kein "Kein BSI-Bezug" pro Eintrag - das wuerde
  // die kompakte Ansicht bei ueberwiegend nicht gemappten Findings ueberladen;
  // die vollstaendige Karte zeigt diesen Fall bereits explizit an).
  function actionBsiRefLine(finding) {
    const requirementId = finding.settingKey ? getBsiSettingKeyIndex().get(finding.settingKey) : undefined;
    const info = requirementId ? BSI_REQUIREMENT_INFO[requirementId] : null;
    if (!requirementId || !info) return null;

    const bausteinCode = (info.bausteinLabel || '').split(' – ')[0] || info.bausteinLabel || '';
    const label = BSI_REQUIREMENT_LABELS[requirementId] || requirementId;

    const link = document.createElement('a');
    link.className = 'gpo-kpi-bsi-link gpo-action-bsi-ref';
    link.href = '#gpo-bsi-section';
    link.textContent = '🛡️ BSI-Bezug: ' + label + (bausteinCode ? ' – ' + bausteinCode : '')
      + (info.anforderungNr ? ' ' + info.anforderungNr : '');
    return link;
  }

  // Gemeinsamer Sprung-zu-Karte-Helfer - dieselbe Logik wie zuvor inline in
  // buildPriorityItem() (V2.1), nur einmal extrahiert, damit die neue
  // Handlungsbedarf-Ansicht keine zweite Kopie desselben Ablaufs bekommt.
  function jumpToFindingCard(finding, anchorHref) {
    if (!passesFilters(finding)) {
      ensureFindingPassesFilter(finding);
      applyFilters();
    }
    const card = _findingCardMap.get(finding);
    if (card && card.isConnected) {
      const body = card.querySelector('.gpo-finding-body');
      const expand = card.querySelector('.gpo-finding-expand');
      if (body) body.classList.add('open');
      if (expand) expand.classList.add('open');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      const target = document.querySelector(anchorHref);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function buildActionEntry(finding) {
    const category = resolveActionCategory(finding);
    const meta = ACTION_CATEGORY_META[category];
    const anchor = actionAnchor(finding);

    const card = document.createElement('div');
    card.className = 'gpo-action-entry gpo-action-entry--' + meta.severityClass;

    const typeLine = document.createElement('div');
    typeLine.className = 'gpo-action-entry-type';
    typeLine.textContent = meta.icon + ' ' + (ACTION_TYPE_LABELS[finding.type] || finding.type);
    card.appendChild(typeLine);

    const title = document.createElement('div');
    title.className = 'gpo-action-entry-title';
    title.textContent = actionTitle(finding);
    card.appendChild(title);

    if (finding.type === 'conflict' || finding.type === 'redundant') {
      const scopeLine = document.createElement('div');
      scopeLine.className = 'gpo-action-entry-scope';
      scopeLine.textContent = actionScopeLabel(finding);
      card.appendChild(scopeLine);
    } else {
      const gpoRow = buildGpoRefRow(finding.gpoId, finding.gpoName);
      gpoRow.classList.add('gpo-action-entry-scope');
      card.appendChild(gpoRow);
    }

    const shortDesc = actionShortDescription(finding);
    if (shortDesc) {
      const descEl = document.createElement('div');
      descEl.className = 'gpo-action-entry-desc';
      descEl.textContent = shortDesc;
      card.appendChild(descEl);
    }

    const sections = resolveFindingSections(finding);
    if (sections.naechsterSchritt) {
      const nextWrap = document.createElement('div');
      nextWrap.className = 'gpo-action-entry-next';
      const label = document.createElement('strong');
      label.textContent = 'Nächster Schritt: ';
      nextWrap.appendChild(label);
      appendBodyContent(nextWrap, sections.naechsterSchritt);
      card.appendChild(nextWrap);
    }

    const bsiLine = actionBsiRefLine(finding);
    if (bsiLine) card.appendChild(bsiLine);

    const detailsLink = document.createElement('a');
    detailsLink.href = anchor;
    detailsLink.className = 'gpo-kpi-bsi-link gpo-action-entry-details-link';
    detailsLink.textContent = 'Details anzeigen →';
    detailsLink.addEventListener('click', (e) => {
      e.preventDefault();
      jumpToFindingCard(finding, anchor);
    });
    card.appendChild(detailsLink);

    return card;
  }

  function buildActionCategorySection(categoryKey, findings) {
    const meta = ACTION_CATEGORY_META[categoryKey];
    const section = document.createElement('div');
    section.className = 'gpo-action-category';

    const heading = document.createElement('div');
    heading.className = 'gpo-action-category-title';
    heading.textContent = meta.icon + ' ' + meta.title;
    section.appendChild(heading);

    if (!findings.length) {
      const empty = document.createElement('div');
      empty.className = 'gpo-action-entry-empty';
      empty.textContent = 'Keine Befunde in dieser Kategorie.';
      section.appendChild(empty);
      return section;
    }

    const shown = findings.slice(0, ACTION_VIEW_MAX_PER_CATEGORY);
    shown.forEach(f => section.appendChild(buildActionEntry(f)));

    if (findings.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'gpo-action-more-hint';
      more.textContent = '+ ' + (findings.length - shown.length) + ' weitere in dieser Kategorie – siehe „Alle Findings anzeigen“.';
      section.appendChild(more);
    }

    return section;
  }

  // V4.4: "Was sollte ich mir zuerst anschauen?" im Executive Dashboard -
  // wird bewusst NICHT aus renderExecutiveDashboard() heraus aufgerufen,
  // sondern erst danach in renderOverview() (wie renderPriorityList()), weil
  // "Details anzeigen" ueber _findingCardMap auf die bereits gerenderten
  // Finding-Karten aus renderConflictList()/renderRedundantList()/
  // renderHygieneList() zugreift - diese muessen zuerst existieren.
  function renderActionView() {
    const container = document.getElementById('gpo-action-view');
    if (!container) return;
    container.replaceChildren();

    const buckets = collectActionBuckets();
    const grid = document.createElement('div');
    grid.className = 'gpo-action-grid';
    ACTION_CATEGORY_ORDER.forEach(key => {
      grid.appendChild(buildActionCategorySection(key, buckets[key]));
    });
    container.appendChild(grid);

    const allLink = document.createElement('a');
    allLink.href = '#gpo-findings-section';
    allLink.className = 'gpo-kpi-bsi-link gpo-action-all-link';
    allLink.textContent = 'Alle Findings anzeigen →';
    container.appendChild(allLink);

    const disclaimer = document.createElement('div');
    disclaimer.className = 'gpo-action-disclaimer';
    disclaimer.textContent = 'Grundlage ist ausschließlich der hochgeladene Snapshot. Die tatsächliche effektive Richtlinie kann insbesondere bei komplexen GPO-Verknüpfungen erst mit gpresult /h bzw. rsop.msc sicher beurteilt werden.';
    container.appendChild(disclaimer);
  }

  // ── GPO-zentrierte Pruef-/Aufraeumsicht (V4.5 Executive Dashboard) ──
  // Im Unterschied zu renderActionView() (V4.4, Finding-zentriert) wird hier
  // je GPO gebuendelt, welche bereits vorhandenen Findings sie betreffen -
  // ueber relatedFindingsForGpo()/findingInvolvesGpo() (bestehend, V2.3
  // GPO-Detailpanel), keine neue Zuordnungslogik. Eine GPO landet in genau
  // einer der vier Gruppen (hoechste Prioritaet gewinnt):
  //  - 'flagged' (🔴 Auffaellige GPOs): mind. ein Konflikt-Finding ODER ein
  //    Hygiene-/Security-Filter-Finding mit rule.bucket 'kritisch' ODER
  //    "mehrere relevante Findings" (Volumen-Schwelle, siehe
  //    GPO_FLAGGED_FINDING_THRESHOLD - reine Anzeige-Schwelle, keine neue
  //    Risikoberechnung).
  //  - 'redundant' (🟡 Mehrfachdefinitionen): mind. ein Redundant-Finding,
  //    sofern nicht bereits 'flagged'.
  //  - 'hygiene' (🧹 GPO-Hygiene): mind. ein Hygiene-/Security-Filter-/WMI-
  //    Filter-Finding (jeder verbleibende Bucket) - Security-/WMI-Filter
  //    werden hier bewusst NICHT automatisch 'flagged' (siehe Bericht:
  //    rule.bucket ist bei beiden aktuell 'pruefen'/'information', nie
  //    'kritisch' - konsistent mit der bereits in V4.4 etablierten
  //    Einstufung und der bestehenden gemeinsamen Rendering-Sektion
  //    #gpo-hygiene-section).
  //  - 'hint' (ℹ️ Prüfhinweis): Auffangbecken fuer nicht eindeutig
  //    zuordenbare Faelle (z.B. fehlendes rule/type), verhindert
  //    Informationsverlust statt eine neue Einstufung zu erfinden.
  const GPO_FLAGGED_FINDING_THRESHOLD = 3;

  function resolveGpoActionCategory(findings) {
    const hasConflict = findings.some(f => f.type === 'conflict');
    const hasCriticalHygiene = findings.some(f =>
      (f.type === 'hygiene' || f.type === 'security-filter') && f.rule && f.rule.bucket === 'kritisch');
    if (hasConflict || hasCriticalHygiene || findings.length >= GPO_FLAGGED_FINDING_THRESHOLD) return 'flagged';
    if (findings.some(f => f.type === 'redundant')) return 'redundant';
    if (findings.some(f => ['hygiene', 'security-filter', 'wmi-filter'].includes(f.type))) return 'hygiene';
    return 'hint';
  }

  const GPO_CLEANUP_CATEGORY_META = {
    flagged:   { icon: '🔴', title: 'Auffällige GPOs' },
    redundant: { icon: '🟡', title: 'Mehrfach / redundant definierte Einstellungen' },
    hygiene:   { icon: '🧹', title: 'GPO-Hygiene' },
    hint:      { icon: 'ℹ️', title: 'GPOs mit Prüfhinweis' },
  };
  const GPO_CLEANUP_CATEGORY_ORDER = ['flagged', 'redundant', 'hygiene', 'hint'];
  const GPO_CLEANUP_MAX_VISIBLE = 5;
  // V4.8: pro aufgeklappter GPO zusaetzlich begrenzt (grosse Einzel-GPOs mit
  // vielen Findings duerfen keine riesige Karte mehr ergeben, Auftrag
  // Abschnitt 13) - dieselbe "Weitere anzeigen"-Mechanik wie auf GPO-Ebene,
  // hier fuer die Finding-Zeilen innerhalb einer Karte.
  const GPO_CLEANUP_FINDINGS_MAX_VISIBLE = 10;

  // Generischer "max N sichtbar, danach aufklappbar"-Baustein - dieselbe
  // Mechanik, die vorher zweimal fast identisch fuer die GPO-Liste je
  // Kategorie existierte; jetzt auch fuer die Finding-Liste innerhalb einer
  // Karte wiederverwendet (Auftrag Abschnitt 19.6: keine parallele zweite
  // Logik).
  function appendExpandable(container, items, buildItem, maxVisible, labelSingular, labelPlural) {
    const shown = items.slice(0, maxVisible);
    const rest = items.slice(maxVisible);
    shown.forEach(item => container.appendChild(buildItem(item)));
    if (!rest.length) return;

    const restWrap = document.createElement('div');
    restWrap.hidden = true;
    rest.forEach(item => restWrap.appendChild(buildItem(item)));
    container.appendChild(restWrap);

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'gpo-kpi-bsi-link gpo-cleanup-more-btn';
    moreBtn.textContent = 'Weitere ' + rest.length + ' ' + (rest.length === 1 ? labelSingular : labelPlural) + ' anzeigen →';
    moreBtn.addEventListener('click', () => {
      restWrap.hidden = false;
      moreBtn.remove();
    });
    container.appendChild(moreBtn);
  }

  // V4.8: dieselben drei bereits vorhandenen, fachlich neutralen
  // Sortierschluessel wie im GPO-Explorer (Anzahl/Name/Status) - keine neue
  // Risiko-/Scoreberechnung. 'findings' bleibt der bisherige Standard
  // (Anzahl absteigend, Name als Tie-Breaker), unveraendert gegenueber V4.5.
  const CLEANUP_STATUS_SORT_ORDER = { active: 0, disabled: 1, unknown: 2 };
  function sortCleanupItems(items, sortKey) {
    const sorted = items.slice();
    sorted.sort((a, b) => {
      if (sortKey === 'name') return a.gpo.name.localeCompare(b.gpo.name);
      if (sortKey === 'status') {
        const diff = CLEANUP_STATUS_SORT_ORDER[gpoExplorerStatusCategory(a.gpo)] - CLEANUP_STATUS_SORT_ORDER[gpoExplorerStatusCategory(b.gpo)];
        return diff !== 0 ? diff : a.gpo.name.localeCompare(b.gpo.name);
      }
      return b.findings.length - a.findings.length || a.gpo.name.localeCompare(b.gpo.name);
    });
    return sorted;
  }

  // Suche (GPO-Name) und Statusfilter sind reine Darstellungsfilter -
  // dieselbe Rolle wie explorerQuery/explorerStatusFilter im GPO-Explorer
  // (Auftrag Abschnitt 7/8: "duerfen nicht die zugrunde liegenden Findings
  // veraendern") - beide schraenken nur ein, WELCHE GPOs ueberhaupt in die
  // Gruppierung einfliessen, resolveGpoActionCategory() selbst bleibt
  // unveraendert.
  function collectGpoCleanupGroups() {
    const groups = { flagged: [], redundant: [], hygiene: [], hint: [] };
    const q = _state.cleanupQuery.toLowerCase();
    (_model.gpos || []).forEach(gpo => {
      if (q && !(gpo.name || '').toLowerCase().includes(q)) return;
      if (_state.cleanupStatusFilter !== 'all' && gpoExplorerStatusCategory(gpo) !== _state.cleanupStatusFilter) return;
      const related = relatedFindingsForGpo(gpo);
      if (!related.length) return;
      const category = resolveGpoActionCategory(related);
      groups[category].push({ gpo, findings: related });
    });
    GPO_CLEANUP_CATEGORY_ORDER.forEach(key => {
      groups[key] = sortCleanupItems(groups[key], _state.cleanupSort);
    });
    return groups;
  }

  // "Auffaellig" bewusst nicht als Aussage ueber die GPO selbst formuliert
  // (Auftrag Abschnitt 2: nicht "Diese GPO ist fehlerhaft" behaupten).
  function gpoCleanupSummaryLine(count) {
    return count + (count === 1 ? ' relevanter Befund' : ' relevante Befunde');
  }

  // Bestehende Status-Kategorie (gpoExplorerStatusCategory(), V2.7) wird nur
  // angezeigt, nicht neu bewertet - 'unknown' bleibt bewusst unsichtbar
  // (siehe Kommentar dort: darf nicht stillschweigend aktiv/deaktiviert
  // zugeordnet werden). "Deaktiviert" bekommt ausschliesslich den im
  // Auftrag vorgegebenen neutralen Text, keine Loeschempfehlung.
  function gpoCleanupStatusLine(gpo) {
    const category = gpoExplorerStatusCategory(gpo);
    if (category === 'active') return 'Aktiv';
    if (category === 'disabled') return 'Deaktiviert – prüfen, ob die GPO noch benötigt wird.';
    return null;
  }

  // Eine Zeile pro Finding innerhalb der GPO-Karte - reine Wiederverwendung
  // der V4.4-Textbausteine (ACTION_TYPE_LABELS/actionShortDescription()/
  // actionAnchor()/jumpToFindingCard()), keine zweite Textformulierung.
  // Redundant-Findings bekommen zusaetzlich Wert + Anzahl betroffener GPOs
  // (Auftrag Abschnitt 2, Gruppe 2), aus finding.entries - bereits
  // vorhandenes Feld.
  function buildGpoCleanupFindingRow(finding) {
    const row = document.createElement('div');
    row.className = 'gpo-cleanup-finding-row';

    const label = document.createElement('span');
    label.className = 'gpo-cleanup-finding-label';
    let text = (ACTION_TYPE_LABELS[finding.type] || finding.type) + ': ' + actionTitle(finding);
    if (finding.type === 'redundant') {
      const value = finding.entries[0] ? finding.entries[0].value : '';
      text += ' (Wert: ' + (value || '(leer)') + ', ' + finding.entries.length + ' GPOs betroffen)';
    } else if (finding.type === 'conflict') {
      text += ' (' + finding.entries.length + ' GPOs betroffen)';
    }
    label.textContent = text;
    row.appendChild(label);

    const desc = actionShortDescription(finding);
    if (desc) {
      const descEl = document.createElement('span');
      descEl.className = 'gpo-cleanup-finding-desc';
      descEl.textContent = ' – ' + desc;
      row.appendChild(descEl);
    }

    const link = document.createElement('a');
    link.href = actionAnchor(finding);
    link.className = 'gpo-kpi-bsi-link gpo-cleanup-finding-link';
    link.textContent = 'Details anzeigen →';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      jumpToFindingCard(finding, actionAnchor(finding));
    });
    row.appendChild(link);

    const bsiLine = actionBsiRefLine(finding);
    if (bsiLine) {
      bsiLine.classList.add('gpo-cleanup-bsi-ref');
      row.appendChild(bsiLine);
    }

    return row;
  }

  // Kompakte Aufschluesselung der vorhandenen Finding-Typen je GPO (Auftrag
  // Abschnitt 2/13, z.B. "Konflikte: 1 · Mehrfachdefinitionen: 11") - reine
  // Zaehlung von finding.type innerhalb der bereits vorhandenen
  // findings-Liste dieser GPO, analog zu countByType(), keine neue
  // Fachlogik.
  const CLEANUP_BREAKDOWN_TYPE_ORDER = ['conflict', 'redundant', 'hygiene', 'security-filter', 'wmi-filter'];
  // Dieselben Zaehl-Bezeichnungen wie renderDashboardFindingsTiles() (Plural
  // "Konflikte"/"Mehrfachdefinitionen" statt des Einzahl-Typlabels
  // ACTION_TYPE_LABELS, das fuer einzelne Finding-Zeilen gedacht ist) -
  // konsistentes Vokabular fuer Anzahlen im gesamten Dashboard.
  const CLEANUP_BREAKDOWN_LABELS = {
    conflict: 'Konflikte',
    redundant: 'Mehrfachdefinitionen',
    hygiene: 'Hygiene',
    'security-filter': 'Security-Filter',
    'wmi-filter': 'WMI-Filter',
  };
  function buildGpoTypeBreakdown(findings) {
    const counts = {};
    findings.forEach(f => { counts[f.type] = (counts[f.type] || 0) + 1; });
    const wrap = document.createElement('div');
    wrap.className = 'gpo-cleanup-breakdown';
    CLEANUP_BREAKDOWN_TYPE_ORDER.forEach(type => {
      if (!counts[type]) return;
      const item = document.createElement('span');
      item.className = 'gpo-cleanup-breakdown-item';
      item.textContent = (CLEANUP_BREAKDOWN_LABELS[type] || type) + ': ' + counts[type];
      wrap.appendChild(item);
    });
    return wrap;
  }

  // V4.8: GPO-Karte zeigt zunaechst nur Name/Status/Gesamtzahl/Typ-
  // Aufschluesselung (immer sichtbar) - die einzelnen Finding-Zeilen
  // (bestehend, buildGpoCleanupFindingRow() unveraendert) erscheinen erst
  // nach Klick auf "Findings anzeigen" (Auftrag Abschnitt 1/2/13: GPO ->
  // Anzahl/Arten -> aufklappen -> einzelne Findings). "GPO oeffnen" bleibt
  // unabhaengig vom Aufklapp-Zustand immer erreichbar.
  function buildGpoCleanupCard(entry) {
    const { gpo, findings } = entry;
    const card = document.createElement('div');
    card.className = 'gpo-cleanup-card';

    const header = document.createElement('div');
    header.className = 'gpo-cleanup-card-header';
    header.appendChild(buildGpoRefElement(gpo.id, gpo.name));
    card.appendChild(header);

    const statusLine = gpoCleanupStatusLine(gpo);
    if (statusLine) {
      const statusEl = document.createElement('div');
      statusEl.className = 'gpo-cleanup-status';
      statusEl.textContent = statusLine;
      card.appendChild(statusEl);
    }

    const summary = document.createElement('div');
    summary.className = 'gpo-cleanup-summary';
    summary.textContent = gpoCleanupSummaryLine(findings.length);
    card.appendChild(summary);

    card.appendChild(buildGpoTypeBreakdown(findings));

    const findingsBody = document.createElement('div');
    findingsBody.className = 'gpo-cleanup-finding-list';
    findingsBody.hidden = true;
    appendExpandable(findingsBody, findings, buildGpoCleanupFindingRow, GPO_CLEANUP_FINDINGS_MAX_VISIBLE, 'Finding', 'Findings');

    const actions = document.createElement('div');
    actions.className = 'gpo-cleanup-card-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'gpo-kpi-bsi-link gpo-cleanup-toggle-btn';
    toggleBtn.textContent = 'Findings anzeigen';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.addEventListener('click', () => {
      const willOpen = findingsBody.hidden;
      findingsBody.hidden = !willOpen;
      toggleBtn.textContent = willOpen ? 'Findings ausblenden' : 'Findings anzeigen';
      toggleBtn.setAttribute('aria-expanded', String(willOpen));
    });
    actions.appendChild(toggleBtn);

    const openLink = document.createElement('a');
    openLink.href = '#gpo-tree-section';
    openLink.className = 'gpo-kpi-bsi-link gpo-cleanup-open-link';
    openLink.textContent = 'GPO öffnen →';
    openLink.addEventListener('click', (e) => {
      e.preventDefault();
      openGpoDetail(gpo.id);
    });
    actions.appendChild(openLink);

    card.appendChild(actions);
    card.appendChild(findingsBody);

    return card;
  }

  // "Weitere X GPOs anzeigen" statt Link zu einer neuen Seite (Auftrag
  // Abschnitt 6/11: keine neue Detailansicht) - blendet einfach die bereits
  // gebauten, restlichen Karten in derselben Gruppe ein. Anzahl je Gruppe
  // (Auftrag Abschnitt 4) steht direkt in der Ueberschrift.
  function buildGpoCleanupCategorySection(categoryKey, items) {
    const meta = GPO_CLEANUP_CATEGORY_META[categoryKey];
    const section = document.createElement('div');
    section.className = 'gpo-cleanup-category';

    const heading = document.createElement('div');
    heading.className = 'gpo-action-category-title';
    heading.textContent = meta.icon + ' ' + meta.title + ' · ' + items.length + (items.length === 1 ? ' GPO' : ' GPOs');
    section.appendChild(heading);

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'gpo-action-entry-empty';
      empty.textContent = 'Keine GPOs in dieser Kategorie.';
      section.appendChild(empty);
      return section;
    }

    appendExpandable(section, items, buildGpoCleanupCard, GPO_CLEANUP_MAX_VISIBLE, 'GPO', 'GPOs');
    return section;
  }

  const CLEANUP_SORT_NOTE_LABELS = {
    findings: 'Anzahl der vorhandenen Befunde',
    name: 'GPO-Name',
    status: 'Status (Aktiv vor Deaktiviert)',
  };

  // Markiert den jeweils aktiven Filter-/Sortier-Button optisch - reiner
  // Anzeigezustand, spiegelt nur _state.cleanupGroupFilter/
  // cleanupStatusFilter/cleanupSort wider (in initSearchInputs() gesetzt).
  function updateCleanupToolbarState() {
    document.querySelectorAll('#gpo-cleanup-group-filter [data-group]').forEach(btn => {
      btn.classList.toggle('gpo-cleanup-filter-btn--active', btn.dataset.group === _state.cleanupGroupFilter);
    });
    document.querySelectorAll('#gpo-cleanup-status-filter [data-status]').forEach(btn => {
      btn.classList.toggle('gpo-cleanup-filter-btn--active', btn.dataset.status === _state.cleanupStatusFilter);
    });
  }

  // Auftrag Abschnitt 7: "wenn die Suche aktiv ist, muss klar erkennbar
  // sein, dass eine Filterung stattfindet" - reine Anzeige der bereits
  // berechneten Trefferzahl, dieselbe Rolle wie #gpo-filter-result-count
  // bei der Findings-Filterleiste.
  function renderCleanupResultCount(totalShown) {
    const el = document.getElementById('gpo-cleanup-result-count');
    if (!el) return;
    const isFiltered = !!_state.cleanupQuery || _state.cleanupStatusFilter !== 'all' || _state.cleanupGroupFilter !== 'all';
    el.textContent = isFiltered
      ? totalShown + ' ' + (totalShown === 1 ? 'GPO gefunden (gefiltert)' : 'GPOs gefunden (gefiltert)')
      : totalShown + ' ' + (totalShown === 1 ? 'GPO gesamt' : 'GPOs gesamt');
  }

  function renderGpoCleanupView() {
    const container = document.getElementById('gpo-cleanup-view');
    if (!container) return;
    container.replaceChildren();
    updateCleanupToolbarState();

    const groups = collectGpoCleanupGroups();
    const visibleKeys = _state.cleanupGroupFilter === 'all' ? GPO_CLEANUP_CATEGORY_ORDER : [_state.cleanupGroupFilter];
    const totalShown = visibleKeys.reduce((sum, key) => sum + groups[key].length, 0);
    renderCleanupResultCount(totalShown);

    const grid = document.createElement('div');
    grid.className = 'gpo-action-grid gpo-cleanup-grid';
    visibleKeys.forEach(key => {
      grid.appendChild(buildGpoCleanupCategorySection(key, groups[key]));
    });
    container.appendChild(grid);

    const sortNote = document.createElement('div');
    sortNote.className = 'gpo-action-disclaimer';
    sortNote.textContent = 'Sortiert nach ' + (CLEANUP_SORT_NOTE_LABELS[_state.cleanupSort] || CLEANUP_SORT_NOTE_LABELS.findings) + '.';
    container.appendChild(sortNote);

    const allLink = document.createElement('a');
    allLink.href = '#gpo-findings-section';
    allLink.className = 'gpo-kpi-bsi-link gpo-action-all-link';
    allLink.textContent = 'Alle relevanten Findings anzeigen →';
    container.appendChild(allLink);
  }

  // ── Pruefvorstufe fuer die effektive Richtlinie (V4.6 Executive
  // Dashboard) ─────────────────────────────────────────────────
  // Baut KEINE Effective-Policy-Engine - unterscheidet ausschliesslich
  // zwischen drei bereits aus bestehenden Feldern ableitbaren Zustaenden
  // (Auftrag Abschnitt 3):
  //  - 'derivable' (✓ Aus Snapshot ableitbar): reine Konfigurationstatsache,
  //    z.B. "identischer Wert, kein Widerspruch im Snapshot" oder
  //    "eindeutiger Wert erkannt" (bsi-mapping.js coverage==='covered').
  //  - 'undeterminable' (? Effektive Richtlinie nicht abschliessend
  //    bestimmbar): jeder Konflikt (der Analyzer ermittelt nie eine
  //    Gewinner-GPO, siehe RSOP_HINT-Kommentar in gpo-analyzer.js) sowie
  //    jeder Computer-Coverage-Eintrag mit coverage==='not_determinable'.
  //  - 'external' (🔎 Effektive Richtlinie pruefen): zusaetzlicher, immer
  //    berechtigter Hinweis, dass selbst eine erkannte Konfiguration ohne
  //    gpresult/RSOP nicht als effektiv wirksam gilt (Auftrag Abschnitt 1/13).
  // Ein Eintrag kann mehrere Zustaende gleichzeitig zeigen (Auftrag
  // Abschnitt 17, Secure-Channel-Beispiel: ✓ UND ? zusammen).
  const EFFECTIVE_STATE_META = {
    derivable:      { icon: '✓', label: 'Aus Snapshot ableitbar' },
    undeterminable: { icon: '?', label: 'Effektive Richtlinie nicht abschließend bestimmbar' },
    external:       { icon: '🔎', label: 'Effektive Richtlinie prüfen' },
  };
  const EFFECTIVE_VIEW_MAX_VISIBLE = 5;

  function buildEffectiveStateBadge(stateKey) {
    const meta = EFFECTIVE_STATE_META[stateKey];
    const badge = document.createElement('span');
    badge.className = 'gpo-effective-badge gpo-effective-badge--' + stateKey;
    badge.textContent = meta.icon + ' ' + meta.label;
    return badge;
  }

  // Konflikt/Redundanz: dieselben Kurzbeschreibungs-/Naechster-Schritt-/BSI-
  // Textbausteine wie in renderActionView() (V4.4), hier zusaetzlich mit
  // Konfigurierende-GPOs-/Erkannte-Werte-Listen aus finding.entries
  // (bestehendes Feld, keine neue Berechnung) und explizitem
  // Zustands-Badge statt der V4.4-Kategorie-Einordnung.
  function buildEffectiveEntriesGpoList(finding) {
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Konfigurierende GPOs';
    wrap.appendChild(title);
    const list = document.createElement('ul');
    list.className = 'gpo-effective-list';
    finding.entries.forEach(e => {
      const li = document.createElement('li');
      li.appendChild(buildGpoRefElement(e.gpoId, e.gpoName));
      list.appendChild(li);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function buildEffectiveValuesList(finding) {
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Erkannte Werte';
    wrap.appendChild(title);
    const list = document.createElement('ul');
    list.className = 'gpo-effective-list';
    const values = Array.from(new Set(finding.entries.map(e => e.value)));
    values.forEach(v => {
      const li = document.createElement('li');
      li.textContent = v || '(leer)';
      list.appendChild(li);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function buildEffectiveFindingEntry(finding) {
    const card = document.createElement('div');
    card.className = 'gpo-effective-entry';

    const title = document.createElement('div');
    title.className = 'gpo-effective-entry-title';
    title.textContent = (ACTION_TYPE_LABELS[finding.type] || finding.type) + ': ' + actionTitle(finding);
    card.appendChild(title);

    const badges = document.createElement('div');
    badges.className = 'gpo-effective-badges';
    if (finding.type === 'conflict') {
      badges.appendChild(buildEffectiveStateBadge('undeterminable'));
    } else if (finding.type === 'redundant') {
      badges.appendChild(buildEffectiveStateBadge('derivable'));
      badges.appendChild(buildEffectiveStateBadge('external'));
    } else {
      badges.appendChild(buildEffectiveStateBadge('external'));
    }
    card.appendChild(badges);

    const desc = actionShortDescription(finding);
    if (desc) {
      const descEl = document.createElement('div');
      descEl.className = 'gpo-action-entry-desc';
      descEl.textContent = desc;
      card.appendChild(descEl);
    }
    if (finding.type === 'redundant') {
      const noConflictNote = document.createElement('div');
      noConflictNote.className = 'gpo-action-entry-desc';
      noConflictNote.textContent = 'Kein widersprüchlicher Wert im Snapshot festgestellt.';
      card.appendChild(noConflictNote);
    }

    if (finding.scopeExplanation) {
      const scopeEl = document.createElement('div');
      scopeEl.className = 'gpo-action-entry-desc';
      scopeEl.textContent = finding.scopeExplanation;
      card.appendChild(scopeEl);
    }

    if (finding.type === 'conflict' || finding.type === 'redundant') {
      card.appendChild(buildEffectiveEntriesGpoList(finding));
      card.appendChild(buildEffectiveValuesList(finding));
    } else {
      const gpoRow = buildGpoRefRow(finding.gpoId, finding.gpoName);
      gpoRow.classList.add('gpo-action-entry-scope');
      card.appendChild(gpoRow);
    }

    const sections = resolveFindingSections(finding);
    if (sections.naechsterSchritt) {
      const nextWrap = document.createElement('div');
      nextWrap.className = 'gpo-action-entry-next';
      const label = document.createElement('strong');
      label.textContent = 'Nächster Schritt: ';
      nextWrap.appendChild(label);
      appendBodyContent(nextWrap, sections.naechsterSchritt);
      card.appendChild(nextWrap);
    }

    const bsiLine = actionBsiRefLine(finding);
    if (bsiLine) card.appendChild(bsiLine);

    const detailsLink = document.createElement('a');
    detailsLink.href = actionAnchor(finding);
    detailsLink.className = 'gpo-kpi-bsi-link gpo-action-entry-details-link';
    detailsLink.textContent = 'Finding öffnen →';
    detailsLink.addEventListener('click', (e) => {
      e.preventDefault();
      jumpToFindingCard(finding, actionAnchor(finding));
    });
    card.appendChild(detailsLink);

    return card;
  }

  // Reihenfolge Konflikt -> Redundant -> Security-Filter -> WMI-Filter,
  // jeweils in bestehender _findings-Reihenfolge - keine neue Priorisierung
  // (Auftrag Abschnitt 16, Punkt "wenn eine belastbare Priorisierung nicht
  // moeglich ist, nicht kuenstlich priorisieren").
  function collectEffectiveFindings() {
    const conflicts = _findings.filter(f => f.type === 'conflict');
    const redundants = _findings.filter(f => f.type === 'redundant');
    const securityFilters = _findings.filter(f => f.type === 'security-filter');
    const wmiFilters = _findings.filter(f => f.type === 'wmi-filter');
    return conflicts.concat(redundants, securityFilters, wmiFilters);
  }

  // Computer-Coverage-Eintraege (bestehend, evaluateComputerCoverage() V3.5.1)
  // - not_covered wird bewusst ausgeblendet (dort existiert keine
  // konfigurierende, erreichende GPO - fuer eine "effektive Richtlinie
  // pruefen"-Ansicht nichts zu pruefen). not_determinable zuerst (staerkster
  // Bezug zum Seitenzweck), dann covered - keine neue Risikoberechnung, nur
  // Sortierung bereits vorhandener Zustaende.
  function collectEffectiveComputerEntries() {
    if (!window.GpoBsiMapping || typeof window.GpoBsiMapping.evaluateComputerCoverage !== 'function') return [];
    if (_model.dataQuality && _model.dataQuality.computersFileMissing) return [];

    const coverage = window.GpoBsiMapping.evaluateComputerCoverage(_model);
    const items = [];
    BSI_REQUIREMENT_ORDER.forEach(requirementId => {
      const req = coverage[requirementId];
      if (!req) return;
      (req.computers || []).forEach(entry => {
        if (entry.coverage === 'not_covered') return;
        items.push({ requirementId, entry });
      });
    });
    items.sort((a, b) => {
      if (a.entry.coverage === b.entry.coverage) return 0;
      return a.entry.coverage === 'not_determinable' ? -1 : 1;
    });
    return items;
  }

  // Wiederverwendet buildBsiComputerRow() (V3.5.3, bestehendes aufklappbares
  // <details>-Element mit DN/Kategorie/OS/reason/reachingGpoIds/
  // configuringGpoIds/values) unveraendert - keine zweite Detailansicht,
  // nur ein Requirement-Label + BSI-Grundlage-Link zusaetzlich davor.
  function buildEffectiveComputerEntry(item) {
    const wrap = document.createElement('div');
    wrap.className = 'gpo-effective-computer-entry';

    const label = document.createElement('div');
    label.className = 'gpo-effective-entry-title';
    label.textContent = BSI_REQUIREMENT_LABELS[item.requirementId] || item.requirementId;
    wrap.appendChild(label);

    const badges = document.createElement('div');
    badges.className = 'gpo-effective-badges';
    badges.appendChild(buildEffectiveStateBadge(item.entry.coverage === 'not_determinable' ? 'undeterminable' : 'derivable'));
    if (item.entry.coverage === 'covered') badges.appendChild(buildEffectiveStateBadge('external'));
    wrap.appendChild(badges);

    wrap.appendChild(buildBsiComputerRow(item.entry));

    const info = BSI_REQUIREMENT_INFO[item.requirementId];
    if (info) {
      const bsiLink = document.createElement('a');
      bsiLink.className = 'gpo-kpi-bsi-link gpo-action-bsi-ref';
      bsiLink.href = '#gpo-bsi-section';
      const bausteinCode = (info.bausteinLabel || '').split(' – ')[0] || info.bausteinLabel || '';
      bsiLink.textContent = '🛡️ BSI-Grundlage: ' + (BSI_REQUIREMENT_LABELS[item.requirementId] || item.requirementId)
        + (bausteinCode ? ' – ' + bausteinCode : '') + (info.anforderungNr ? ' ' + info.anforderungNr : '');
      wrap.appendChild(bsiLink);
    }

    return wrap;
  }

  // Generischer "max N sichtbar, danach aufklappbar" Baustein - dieselbe
  // Mechanik wie buildGpoCleanupCategorySection() (V4.5), hier fuer eine
  // einzelne, flache Liste statt vier Kategorien.
  function buildEffectiveSubList(items, buildEntry, emptyText, moreLabelSingular, moreLabelPlural) {
    const wrap = document.createElement('div');
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'gpo-action-entry-empty';
      empty.textContent = emptyText;
      wrap.appendChild(empty);
      return wrap;
    }

    const shown = items.slice(0, EFFECTIVE_VIEW_MAX_VISIBLE);
    const rest = items.slice(EFFECTIVE_VIEW_MAX_VISIBLE);
    shown.forEach(item => wrap.appendChild(buildEntry(item)));

    if (rest.length) {
      const restWrap = document.createElement('div');
      restWrap.hidden = true;
      rest.forEach(item => restWrap.appendChild(buildEntry(item)));
      wrap.appendChild(restWrap);

      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'gpo-kpi-bsi-link gpo-cleanup-more-btn';
      moreBtn.textContent = 'Weitere ' + rest.length + ' ' + (rest.length === 1 ? moreLabelSingular : moreLabelPlural) + ' anzeigen →';
      moreBtn.addEventListener('click', () => {
        restWrap.hidden = false;
        moreBtn.remove();
      });
      wrap.appendChild(moreBtn);
    }

    return wrap;
  }

  function renderEffectivePolicyView() {
    const container = document.getElementById('gpo-effective-view');
    if (!container) return;
    container.replaceChildren();

    // Auftrag Abschnitt 13: deutlich sichtbarer, nicht versteckbarer Hinweis.
    const warning = document.createElement('div');
    warning.className = 'gpo-effective-warning';
    warning.textContent = 'Wichtig: GPO-Coverage bedeutet nicht automatisch, dass eine Einstellung auf dem Zielsystem tatsächlich wirksam ist. Die effektive Richtlinie kann erst unter Berücksichtigung der tatsächlichen GPO-Anwendung eindeutig beurteilt werden.';
    container.appendChild(warning);

    const findingsTitle = document.createElement('div');
    findingsTitle.className = 'gpo-finding-sub-title';
    findingsTitle.textContent = 'Findings';
    container.appendChild(findingsTitle);
    container.appendChild(buildEffectiveSubList(
      collectEffectiveFindings(), buildEffectiveFindingEntry,
      'Keine relevanten Findings vorhanden.', 'Finding', 'Findings'
    ));

    const computerTitle = document.createElement('div');
    computerTitle.className = 'gpo-finding-sub-title';
    computerTitle.textContent = 'Computer';
    container.appendChild(computerTitle);
    container.appendChild(buildEffectiveSubList(
      collectEffectiveComputerEntries(), buildEffectiveComputerEntry,
      _model.dataQuality && _model.dataQuality.computersFileMissing
        ? 'Keine Computerdaten im Snapshot vorhanden (computers.json fehlt).'
        : 'Keine relevanten Computer-Einträge vorhanden.',
      'Computer', 'Computer'
    ));

    // Auftrag Abschnitt 10: praktischer gpresult/RSOP-Hinweis - stellt
    // ausdruecklich klar, dass der Analyzer diese Information nicht selbst
    // besitzt.
    const gpresultBlock = document.createElement('div');
    gpresultBlock.className = 'gpo-effective-gpresult';
    const gpresultTitle = document.createElement('div');
    gpresultTitle.className = 'gpo-finding-sub-title';
    gpresultTitle.textContent = 'Für die endgültige Prüfung';
    gpresultBlock.appendChild(gpresultTitle);
    const gpresultIntro = document.createElement('div');
    gpresultIntro.className = 'gpo-action-entry-desc';
    gpresultIntro.textContent = 'Verwende auf dem betroffenen Windows-System beispielsweise:';
    gpresultBlock.appendChild(gpresultIntro);
    const gpresultList = document.createElement('ul');
    gpresultList.className = 'gpo-effective-list';
    [['gpresult /h gpresult.html'], ['rsop.msc']].forEach(cmd => {
      const li = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = cmd[0];
      li.appendChild(code);
      gpresultList.appendChild(li);
    });
    gpresultBlock.appendChild(gpresultList);
    const gpresultChecklistIntro = document.createElement('div');
    gpresultChecklistIntro.className = 'gpo-action-entry-desc';
    gpresultChecklistIntro.textContent = 'Danach sollte der Administrator insbesondere prüfen:';
    gpresultBlock.appendChild(gpresultChecklistIntro);
    const checklist = document.createElement('ul');
    checklist.className = 'gpo-effective-list';
    [
      'welche GPOs tatsächlich angewendet wurden',
      'welche GPOs herausgefiltert wurden',
      'welcher Wert effektiv gilt',
      'welche Vererbung / Priorität wirksam war',
    ].forEach(text => {
      const li = document.createElement('li');
      li.textContent = text;
      checklist.appendChild(li);
    });
    gpresultBlock.appendChild(checklist);
    container.appendChild(gpresultBlock);

    const links = document.createElement('div');
    links.className = 'gpo-action-all-link';
    const allFindingsLink = document.createElement('a');
    allFindingsLink.href = '#gpo-findings-section';
    allFindingsLink.className = 'gpo-kpi-bsi-link';
    allFindingsLink.textContent = 'Alle Findings anzeigen →';
    const allBsiLink = document.createElement('a');
    allBsiLink.href = '#gpo-bsi-section';
    allBsiLink.className = 'gpo-kpi-bsi-link gpo-effective-second-link';
    allBsiLink.textContent = 'BSI-Coverage ansehen →';
    links.append(allFindingsLink, allBsiLink);
    container.appendChild(links);
  }

  // ── RSoP-/gpresult-Vergleich (V4.9) ─────────────────────────
  // Liest ausschliesslich einen hochgeladenen Bericht ein (window.GpoRsop,
  // eigenstaendiges Modul) und stellt ihn gegen das bereits geladene
  // Snapshot-Modell dar - keine neue Effective-Policy-Berechnung, keine
  // Gewinner-GPO ausserhalb dessen, was der RSoP-Bericht selbst als
  // Precedence ausweist. Nur drei Kategorien gelten als zuverlaessig
  // eindeutig zuordenbar (siehe Bericht): Account Policies, Security
  // Options, User Rights Assignment (jeweils per Namensabgleich, identisch
  // zur bereits im Collector verifizierten Namensauflösung) sowie
  // Administrative-Template-Settings aus HTML-Berichten (gpmc_settingName/
  // -Path, best effort - ein Nicht-Treffer fuehrt nie zu einer falschen
  // "Abweichung"-Aussage, sondern bleibt schlicht unverglichen).
  // Auftrag Abschnitt 18: "Beim erneuten Snapshot-Upload: RSoP-Zustand
  // zurücksetzen, RSoP-Anzeige leeren" - dazu gehoert auch die
  // Upload-Zone selbst (sonst zeigt sie nach einem neuen Snapshot-Upload
  // weiterhin faelschlich den vorherigen "✅ Datei"-Erfolgszustand).
  function resetRsopUploadZone() {
    const zone = document.getElementById('gpo-rsop-upload-zone');
    if (!zone) return;
    zone.classList.remove('gpo-rsop-upload-zone--done');
    const textEl = zone.querySelector('.gpo-rsop-upload-text');
    if (textEl) textEl.textContent = 'RSoP-XML oder gpresult-HTML hier ablegen oder klicken';
    const input = document.getElementById('gpo-rsop-file-input');
    if (input) input.value = '';
  }

  function showRsopError(message) {
    const el = document.getElementById('gpo-rsop-error');
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
  }
  function hideRsopError() {
    const el = document.getElementById('gpo-rsop-error');
    if (el) el.hidden = true;
  }

  function matchRsopGpoForSnapshotGpo(gpo) {
    if (!_rsopReport) return null;
    const targetId = window.GpoRsop.normalizeGuid(gpo.id);
    if (targetId) {
      const byId = _rsopReport.gpos.find(g => g.id === targetId);
      if (byId) return byId;
    }
    // Name-Fallback nur bei eindeutigem Treffer (Auftrag Abschnitt 6: "Wenn
    // eine GPO nur anhand eines Namens zugeordnet werden koennte und dabei
    // Mehrdeutigkeit besteht: keine eindeutige Zuordnung, nicht raten").
    const nameMatches = _rsopReport.gpos.filter(g => g.name && g.name.toLowerCase() === (gpo.name || '').toLowerCase());
    return nameMatches.length === 1 ? nameMatches[0] : null;
  }

  const RSOP_GPO_STATE_META = {
    match:   { icon: '✓', label: 'Übereinstimmung' },
    unclear: { icon: '?', label: 'Nicht vergleichbar' },
    missing: { icon: 'ℹ', label: 'Nicht im RSoP ausgewiesen' },
  };

  // Klassifizierung ausschliesslich aus bereits vorhandenen Feldern
  // (Zuordnung per GUID/Name, RSoP-eigenes "applied") - keine neue
  // Ursachenermittlung. "abweichend" (⚠) bleibt fuer echte Wert-Vergleiche
  // reserviert (siehe resolveSettingComparisonState()), nicht fuer reine
  // GPO-Praesenz - deckt sich mit dem woertlichen RSoP-Abschnitt-7-Beispiel
  // ("? Im RSoP nicht als angewendet ausgewiesen").
  function resolveRsopGpoState(rsopGpo) {
    if (!rsopGpo) return 'missing';
    return rsopGpo.applied ? 'match' : 'unclear';
  }

  function collectRsopGpoComparison() {
    const items = (_model.gpos || []).map(gpo => {
      const rsopGpo = matchRsopGpoForSnapshotGpo(gpo);
      return { gpo, rsopGpo, state: resolveRsopGpoState(rsopGpo) };
    });
    items.sort((a, b) => a.gpo.name.localeCompare(b.gpo.name));
    return items;
  }

  function buildRsopGpoRow(item) {
    const row = document.createElement('div');
    row.className = 'gpo-rsop-gpo-row';

    const meta = RSOP_GPO_STATE_META[item.state];
    const badge = document.createElement('span');
    badge.className = 'gpo-effective-badge gpo-rsop-badge--' + item.state;
    badge.textContent = meta.icon + ' ' + meta.label;
    row.appendChild(badge);

    row.appendChild(buildGpoRefElement(item.gpo.id, item.gpo.name));

    if (item.rsopGpo && item.rsopGpo.securityFilters && item.rsopGpo.securityFilters.length) {
      const sf = document.createElement('span');
      sf.className = 'gpo-rsop-gpo-detail';
      sf.textContent = 'RSoP-Sicherheitsfilter: ' + item.rsopGpo.securityFilters.join(', ');
      row.appendChild(sf);
    }
    // Nur bereits vom RSoP selbst ausgewiesene Flags anzeigen (Auftrag
    // Abschnitt 10/15) - keine konstruierte Grundaussage.
    if (item.rsopGpo && item.state === 'unclear') {
      const flags = [];
      if (item.rsopGpo.filterAllowed === false) flags.push('FilterAllowed: false');
      if (item.rsopGpo.accessDenied === true) flags.push('AccessDenied: true');
      if (item.rsopGpo.isValid === false) flags.push('IsValid: false');
      if (flags.length) {
        const flagsEl = document.createElement('span');
        flagsEl.className = 'gpo-rsop-gpo-detail';
        flagsEl.textContent = 'RSoP-Information: ' + flags.join(', ') + '. Weitere Prüfung erforderlich.';
        row.appendChild(flagsEl);
      }
    }

    return row;
  }

  function renderRsopGpoComparison(container) {
    const items = collectRsopGpoComparison();
    const counts = { match: 0, unclear: 0, missing: 0 };
    items.forEach(i => { counts[i.state]++; });

    const summary = document.createElement('div');
    summary.className = 'gpo-rsop-gpo-summary';
    summary.textContent = 'GPOs  ✓ ' + counts.match + ' übereinstimmend  ⋅  ? ' + counts.unclear + ' nicht vergleichbar  ⋅  ℹ ' + counts.missing + ' nicht im RSoP ausgewiesen';
    container.appendChild(summary);

    const relevant = items.filter(i => i.state !== 'missing');
    const list = document.createElement('div');
    list.className = 'gpo-rsop-gpo-list';
    if (!relevant.length) {
      const empty = document.createElement('div');
      empty.className = 'gpo-action-entry-empty';
      empty.textContent = 'Keine der Snapshot-GPOs konnte im RSoP-Bericht eindeutig zugeordnet werden.';
      list.appendChild(empty);
    } else {
      appendExpandable(list, relevant, buildRsopGpoRow, GPO_CLEANUP_MAX_VISIBLE, 'GPO', 'GPOs');
    }
    container.appendChild(list);

    if (counts.missing) {
      const allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = 'gpo-kpi-bsi-link gpo-cleanup-more-btn';
      allBtn.textContent = 'Alle GPOs anzeigen (inkl. „nicht im RSoP ausgewiesen") →';
      allBtn.addEventListener('click', () => {
        list.replaceChildren();
        appendExpandable(list, items, buildRsopGpoRow, GPO_CLEANUP_MAX_VISIBLE, 'GPO', 'GPOs');
        allBtn.remove();
      });
      container.appendChild(allBtn);
    }
  }

  // Findet passende RSoP-Settings zu einem Snapshot-settingKey - exakter
  // Stringvergleich, sowohl auf dem vollen Key als auch (Fallback) auf dem
  // reinen Namen nach dem letzten " > " (Auftrag/Bericht: manche echten
  // Snapshots fuehren category=null, RSoP-HTML liefert dagegen immer einen
  // Kategoriepfad - der Namens-Fallback erlaubt trotzdem einen Treffer,
  // ohne dass ein Nicht-Treffer je als "Abweichung" fehlinterpretiert
  // werden koennte).
  function findRsopSettingsForKey(settingKey) {
    if (!_rsopReport || !settingKey) return [];
    const bareKey = settingKey.split(' > ').pop();
    const matches = _rsopReport.settings.filter(s => {
      const bareS = s.key.split(' > ').pop();
      return s.key === settingKey || bareS === bareKey;
    });
    matches.sort((a, b) => (a.precedence || 1) - (b.precedence || 1));
    return matches;
  }

  function resolveSettingComparisonState(snapshotValues, rsopEffectiveValue) {
    if (rsopEffectiveValue === null || rsopEffectiveValue === undefined) return 'missing';
    if (!snapshotValues.length) return 'missing';
    // Redundant-Findings haben per Definition >=2 entries, aber (im
    // identischen Fall) nur EINEN tatsaechlichen Wert - erst nach
    // Deduplizierung laesst sich das feststellen. Bleiben nach Dedup
    // mehrere unterschiedliche Werte (= Konflikt), waere ein einzelnes
    // ✓/⚠ eine neue Bewertung ueber "welcher GPO-Wert galt" - deshalb
    // dann neutral ("nicht vergleichbar"), keine Gewinner-Aussage.
    const uniqueValues = Array.from(new Set(snapshotValues
      .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
      .map(v => String(v).trim())));
    if (uniqueValues.length === 1) {
      return uniqueValues[0] === String(rsopEffectiveValue).trim() ? 'match' : 'mismatch';
    }
    return 'unclear';
  }

  const RSOP_SETTING_STATE_META = {
    match:    { icon: '✓', label: 'Übereinstimmung' },
    mismatch: { icon: '⚠', label: 'Abweichung' },
    unclear:  { icon: '?', label: 'Nicht vergleichbar' },
    missing:  { icon: 'ℹ', label: 'Nicht im RSoP ausgewiesen' },
  };

  function buildRsopSettingCard(finding) {
    const card = document.createElement('div');
    card.className = 'gpo-effective-entry';

    const title = document.createElement('div');
    title.className = 'gpo-effective-entry-title';
    title.textContent = actionTitle(finding);
    card.appendChild(title);

    const rsopMatches = findRsopSettingsForKey(finding.settingKey);
    const effective = rsopMatches[0] || null;
    const snapshotValues = (finding.entries || []).map(e => e.value);
    const state = resolveSettingComparisonState(snapshotValues, effective ? effective.value : null);
    const meta = RSOP_SETTING_STATE_META[state];

    const badge = document.createElement('span');
    badge.className = 'gpo-effective-badge gpo-rsop-badge--' + state;
    badge.textContent = meta.icon + ' ' + meta.label;
    card.appendChild(badge);

    const snapshotBlock = document.createElement('div');
    snapshotBlock.className = 'gpo-action-entry-desc';
    snapshotBlock.textContent = 'Snapshot-Evidenz: ' + (snapshotValues.length ? snapshotValues.join(', ') : '(kein Wert)');
    card.appendChild(snapshotBlock);

    const rsopBlock = document.createElement('div');
    rsopBlock.className = 'gpo-action-entry-desc';
    rsopBlock.textContent = effective
      ? 'RSoP-Evidenz: ' + effective.value + (effective.precedence ? ' (RSoP-Precedence: ' + effective.precedence + ')' : '')
      : 'RSoP enthält keine verwertbare Information zu diesem Setting.';
    card.appendChild(rsopBlock);

    if (rsopMatches.length > 1) {
      const others = document.createElement('div');
      others.className = 'gpo-action-entry-desc';
      others.textContent = 'Weitere RSoP-Definitionen: ' + rsopMatches.slice(1).map(m => m.value + (m.precedence ? ' (Precedence ' + m.precedence + ')' : '')).join(', ');
      card.appendChild(others);
    }

    const bsiLine = actionBsiRefLine(finding);
    if (bsiLine) card.appendChild(bsiLine);

    const detailsLink = document.createElement('a');
    detailsLink.href = actionAnchor(finding);
    detailsLink.className = 'gpo-kpi-bsi-link gpo-action-entry-details-link';
    detailsLink.textContent = 'Finding öffnen →';
    detailsLink.addEventListener('click', (e) => {
      e.preventDefault();
      jumpToFindingCard(finding, actionAnchor(finding));
    });
    card.appendChild(detailsLink);

    return card;
  }

  // Fokus bewusst auf bereits vorhandene Findings begrenzt (Konflikt/
  // Mehrfachdefinition) statt eine vollstaendige Settings-Liste zu zeigen -
  // deckt sich mit "Konkreter Fokus: vorhandene Findings" und der
  // bestehenden V4.8-Kompaktdarstellung.
  function collectRsopRelevantFindings() {
    return _findings.filter(f => f.type === 'conflict' || f.type === 'redundant');
  }

  function renderRsopSettingComparison(container) {
    const findings = collectRsopRelevantFindings();
    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Setting-Vergleich (Konflikte & Mehrfachdefinitionen)';
    container.appendChild(title);
    container.appendChild(buildEffectiveSubList(
      findings, buildRsopSettingCard,
      'Keine Konflikte oder Mehrfachdefinitionen vorhanden.', 'Finding', 'Findings'
    ));
  }

  function renderRsopSummary(container) {
    const r = _rsopReport;
    const notAvailable = 'Nicht im Bericht enthalten.';
    const summary = document.createElement('div');
    summary.className = 'gpo-rsop-summary';

    const rows = [
      ['Computer', r.computer || notAvailable],
      ['Domäne', r.domain || notAvailable],
      ['Benutzer', r.user || notAvailable],
      ['Reporttyp', r.reportType === 'xml' ? 'RSoP-XML' : 'gpresult-HTML'],
      ['Erstellt', r.generatedAt || notAvailable],
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'gpo-rsop-summary-row';
      const l = document.createElement('span');
      l.className = 'gpo-rsop-summary-label';
      l.textContent = label + ':';
      const v = document.createElement('span');
      v.textContent = value;
      row.append(l, v);
      summary.appendChild(row);
    });
    container.appendChild(summary);

    if (!r.computer) {
      const warn = document.createElement('div');
      warn.className = 'gpo-rsop-computer-warning';
      warn.textContent = 'Computer konnte aus dem RSoP-Bericht nicht eindeutig bestimmt werden.';
      container.appendChild(warn);
    } else {
      const title = document.createElement('div');
      title.className = 'gpo-rsop-computer-title';
      title.textContent = 'RSoP für: ' + r.computer;
      container.insertBefore(title, summary);
    }
  }

  function renderRsopResult() {
    const container = document.getElementById('gpo-rsop-result');
    if (!container) return;
    container.replaceChildren();
    if (!_rsopReport) return;

    renderRsopSummary(container);

    // Auftrag Abschnitt 16: Transparenz-Kopfzeile Snapshot/RSoP/Computer/
    // Vergleich - ausschliesslich bereits bekannte Zustaende, keine
    // kuenstlichen Nullen.
    const transparency = document.createElement('div');
    transparency.className = 'gpo-rsop-transparency';
    ['GPO-Snapshot: ✓ geladen', 'RSoP / gpresult: ✓ geladen', 'Vergleich: ✓ durchgeführt'].forEach(text => {
      const span = document.createElement('span');
      span.textContent = text;
      transparency.appendChild(span);
    });
    container.appendChild(transparency);

    renderRsopGpoComparison(container);
    renderRsopSettingComparison(container);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'gpo-kpi-bsi-link gpo-cleanup-more-btn';
    clearBtn.textContent = 'RSoP-Bericht entfernen';
    clearBtn.addEventListener('click', () => {
      _rsopReport = null;
      resetRsopUploadZone();
      hideRsopError();
      renderRsopResult();
    });
    container.appendChild(clearBtn);
  }

  async function processRsopFile(file) {
    hideRsopError();
    if (!window.GpoRsop) {
      showRsopError('RSoP-Modul nicht verfügbar.');
      return;
    }
    if (!_model || !Array.isArray(_model.gpos)) {
      showRsopError('Bitte zuerst einen GPO-Snapshot laden, bevor ein RSoP-/gpresult-Bericht hochgeladen wird.');
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const text = window.GpoRsop.decodeReportBuffer(buffer);
      const result = window.GpoRsop.parseReport(text, file.name);
      if (!result.ok) {
        showRsopError(result.error);
        return;
      }
      _rsopReport = result.report;
      const zone = document.getElementById('gpo-rsop-upload-zone');
      if (zone) {
        zone.classList.add('gpo-rsop-upload-zone--done');
        const textEl = zone.querySelector('.gpo-rsop-upload-text');
        if (textEl) textEl.textContent = '✅ ' + file.name;
      }
      renderRsopResult();
    } catch (err) {
      console.error('[GpoRenderer] Fehler beim Verarbeiten des RSoP-Berichts:', err);
      showRsopError('RSoP-/gpresult-Bericht konnte nicht verarbeitet werden.');
    }
  }

  function initRsopUpload() {
    const zone = document.getElementById('gpo-rsop-upload-zone');
    const input = document.getElementById('gpo-rsop-file-input');
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      if (e.dataTransfer.files[0]) processRsopFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', (e) => {
      if (e.target.files[0]) processRsopFile(e.target.files[0]);
    });
  }
  document.addEventListener('DOMContentLoaded', initRsopUpload);

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

  // V4.2: klickbarer GPO-Verweis innerhalb eines Finding-Kontexts - nutzt
  // ausschliesslich das bereits vorhandene openGpoDetail() (GPO-Detailpanel,
  // V2.3, inkl. dessen eigenem scrollIntoView()), keine neue Detailansicht,
  // kein neuer Navigations-Mechanismus. Kann die GPO nicht aufgeloest
  // werden (gpoById liefert nichts), bleibt es reiner Text - kein
  // kuenstlicher Link auf eine nicht (mehr) vorhandene GPO.
  function buildGpoRefElement(gpoId, gpoName) {
    if (gpoId && gpoById(gpoId)) {
      const link = document.createElement('a');
      link.href = '#gpo-tree-section';
      link.className = 'gpo-finding-gpo-ref';
      link.textContent = gpoName || ('GPO-ID: ' + gpoId);
      link.addEventListener('click', (e) => {
        e.preventDefault();
        openGpoDetail(gpoId);
      });
      return link;
    }
    const span = document.createElement('span');
    span.textContent = gpoName || (gpoId ? ('GPO-ID: ' + gpoId) : '(unbekannte GPO)');
    return span;
  }

  // "GPO: <klickbarer Name>" als eigene Zeile - fuer Finding-Typen, die
  // genau eine GPO betreffen (Hygiene/Security-Filter/WMI-Filter), damit
  // die betroffene GPO auch dort explizit im "Gefunden"-Abschnitt steht,
  // nicht nur in der Karten-Kopfzeile.
  function buildGpoRefRow(gpoId, gpoName) {
    const row = document.createElement('div');
    row.append('GPO: ', buildGpoRefElement(gpoId, gpoName));
    return row;
  }

  // V4.3: "N GPOs" direkt in der geschlossenen Kopfzeile (Konflikt/
  // Mehrfachdefinition) - reine Anzeige von finding.entries.length, das
  // bereits existierende Array wird nur gezaehlt, keine neue Berechnung.
  // Macht "wie viele GPOs betroffen" scanbar, ohne die Karte aufzuklappen.
  function buildGpoCountBadge(count) {
    const badge = document.createElement('span');
    badge.className = 'gpo-scope-badge';
    badge.textContent = count + (count === 1 ? ' GPO' : ' GPOs');
    return badge;
  }

  // V4.3: sichtbares "Details anzeigen" neben dem bestehenden Chevron -
  // reine Textbeschriftung, die bestehende makeExpandable()-Klick-Mechanik
  // und der Chevron selbst bleiben unveraendert.
  function buildExpandLabel() {
    const label = document.createElement('span');
    label.className = 'gpo-finding-expand-label';
    label.textContent = 'Details anzeigen';
    return label;
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
      gpoLabel.append('GPO: ', buildGpoRefElement(entry.gpoId, entry.gpoName));
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
    finding.entries.forEach((e, i) => {
      if (i > 0) gpoNames.append(', ');
      gpoNames.append(buildGpoRefElement(e.gpoId, e.gpoName));
    });
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

  // V4.1: settingKey -> requirementId, ausschliesslich aus dem bereits
  // vorhandenen, GPO-zentrierten evaluate()-Ergebnis (bsi-mapping.js,
  // hier nicht veraendert) abgeleitet. evaluate() traegt in jedem
  // Ergebnis-Eintrag evidence[].settingKey - genau denselben String, den
  // auch Konflikt-/Redundanz-Findings als finding.settingKey fuehren
  // (beide stammen aus demselben gpo-parser.js-Settings-Key-Format). Kein
  // neuer Abgleich/keine neue BSI-Zuordnung, nur ein Index ueber bereits
  // vorhandene evidence-Eintraege, einmal pro Snapshot-Load berechnet.
  function getBsiSettingKeyIndex() {
    if (_bsiSettingKeyIndexCache) return _bsiSettingKeyIndexCache;
    const index = new Map();
    if (window.GpoBsiMapping && typeof window.GpoBsiMapping.evaluate === 'function') {
      const byRequirement = window.GpoBsiMapping.evaluate(_model, _findings);
      Object.keys(byRequirement).forEach(requirementId => {
        (byRequirement[requirementId] || []).forEach(entry => {
          (entry.evidence || []).forEach(ev => {
            if (ev.settingKey) index.set(ev.settingKey, requirementId);
          });
        });
      });
    }
    _bsiSettingKeyIndexCache = index;
    return index;
  }

  // Nur Konflikt-/Redundanz-Findings tragen ueberhaupt ein settingKey-Feld
  // (Hygiene/Security-Filter/WMI-Filter nicht) - fuer diese liefert die
  // Map-Abfrage automatisch "kein Treffer", ohne eine Sonderbehandlung pro
  // Typ noetig zu machen. Keine Ableitung aus dem Setting-NAMEN, nur aus
  // dem exakten, bereits von bsi-mapping.js verwendeten Key.
  //
  // V4.2: zeigt bei Treffer dieselben, bereits in BSI_REQUIREMENT_INFO
  // (V3.5.3/V3.6, hier nicht veraendert) hinterlegten, verifizierten
  // Angaben - Baustein, Anforderungsnummer, die bestehende Kurzempfehlung
  // als "warum relevant" sowie zwei getrennte Links (offizielles PDF vs.
  // bestehende BSI-Coverage-Ansicht). Keine neue BSI-Zuordnung, keine neue
  // Quelle - nur eine ausfuehrlichere Darstellung derselben, schon
  // vorhandenen Daten. Die frueher hier dokumentierte SMB-Requirement-ID/
  // Quellen-Diskrepanz wurde in V4.3.1 bereinigt (ID lautet jetzt
  // 'BSI-APP.2.2-SMB-SIGNING', siehe BSI_REQUIREMENT_INFO-Kommentar).
  function buildFindingBsiContext(finding) {
    const requirementId = finding.settingKey ? getBsiSettingKeyIndex().get(finding.settingKey) : undefined;
    const info = requirementId ? BSI_REQUIREMENT_INFO[requirementId] : null;

    if (requirementId && info) {
      const wrap = document.createElement('div');
      wrap.className = 'gpo-finding-bsi-block';

      const baustein = document.createElement('div');
      baustein.className = 'gpo-finding-sub-title';
      baustein.textContent = info.bausteinLabel || requirementId;
      wrap.appendChild(baustein);

      const reqLine = document.createElement('div');
      reqLine.className = 'gpo-onboarding-bsi-req';
      reqLine.textContent = 'Anforderung ' + (info.anforderungNr ? info.anforderungNr + ' – ' : '') + (BSI_REQUIREMENT_LABELS[requirementId] || requirementId);
      wrap.appendChild(reqLine);

      if (info.empfehlung) {
        const why = document.createElement('div');
        why.className = 'gpo-finding-desc';
        why.textContent = 'Warum diese Grundlage relevant ist: ' + info.empfehlung;
        wrap.appendChild(why);
      }

      if (info.sourceUrl) {
        const docLink = document.createElement('a');
        docLink.className = 'gpo-kpi-bsi-link';
        docLink.href = info.sourceUrl;
        docLink.target = '_blank';
        docLink.rel = 'noopener';
        docLink.textContent = '→ BSI-Dokument öffnen';
        wrap.appendChild(docLink);
      }

      const coverageLink = document.createElement('a');
      coverageLink.className = 'gpo-kpi-bsi-link';
      coverageLink.href = '#gpo-bsi-section';
      coverageLink.textContent = '→ BSI-Coverage für dieses Requirement ansehen';
      wrap.appendChild(coverageLink);

      return wrap;
    }

    // Defensiver Grenzfall: eine requirementId wurde erkannt, aber
    // BSI_REQUIREMENT_INFO fuehrt (aktuell bei keinem der drei bestehenden
    // Requirements der Fall) keine verifizierte Quelle dafuer - bewusst
    // NICHT stillschweigend wie "kein Bezug" behandeln.
    if (requirementId && !info) {
      const unverified = document.createElement('div');
      unverified.className = 'gpo-bsi-source-missing';
      unverified.textContent = 'Keine verifizierte BSI-Grundlage für dieses Finding hinterlegt.';
      return unverified;
    }

    const none = document.createElement('div');
    none.className = 'gpo-bsi-source-missing';
    none.textContent = 'Kein direkter BSI-Bezug hinterlegt.';
    return none;
  }

  // ── Vereinheitlichte Finding-Textstruktur (Roadmap Abschnitt 1.6) ──
  // Jede Karte bekommt exakt drei, immer in dieser Reihenfolge vorhandene
  // Abschnitte: "Was" (was wurde gefunden), "Bewertung" (warum relevant),
  // "Naechster Schritt" (konkrete Empfehlung). Gemeinsam ist nur diese
  // Textstruktur und die Dispatch-Stelle hier - welche Daten je Typ in
  // welchen Abschnitt einfliessen, entscheidet resolveFindingSections()
  // pro finding.type, die Datenform selbst bleibt je Typ unterschiedlich.
  // V4.1 ergaenzt einen vierten, immer vorhandenen Abschnitt "BSI-
  // Grundlage" (buildFindingBsiContext()) - selbe Struktur, keine neue
  // Fachlogik.
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
    body.appendChild(buildBodySection('BSI-Grundlage', buildFindingBsiContext(finding), 'bsi'));

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
    const was = buildGpoRefRow(finding.gpoId, finding.gpoName);

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
      buildGpoRefRow(finding.gpoId, finding.gpoName),
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
      was: [buildGpoRefRow(finding.gpoId, finding.gpoName)].concat(buildWmiFilterFacts(wmiFilter)),
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

    header.append(badge, title, buildGpoCountBadge(finding.entries.length), scopeBadge, buildExpandLabel(), expand);

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

    header.append(badge, title, buildGpoCountBadge(finding.entries.length), scopeBadge, buildExpandLabel(), expand);

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

    header.append(badge, title, buildExpandLabel(), expand);

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

    header.append(badge, title, buildExpandLabel(), expand);

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

    header.append(badge, title, buildExpandLabel(), expand);

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
    'BSI-APP.2.2-SMB-SIGNING': 'SMB-Signierung',
  };
  const BSI_CATEGORY_LABELS = {
    domain_controllers: 'Domain Controllers',
    member_servers: 'Member Server',
    clients: 'Clients',
  };
  const BSI_CATEGORY_ORDER = ['domain_controllers', 'member_servers', 'clients'];
  const BSI_REQUIREMENT_ORDER = ['BSI-SYS.2.2.3-NTLM-LM-LEVEL', 'BSI-APP.2.2-SECURE-CHANNEL', 'BSI-APP.2.2-SMB-SIGNING'];

  // V3.5.3: kurze, eigenstaendig formulierte Zusammenfassung je Requirement
  // + Link auf die zugrunde liegende offizielle BSI-Quelle (IT-Grundschutz-
  // Kompendium, Edition 2023, PDF direkt beim BSI). Jede Quelle wurde vor
  // Einbau per Volltext-Abgleich der PDFs verifiziert (siehe Bericht) - kein
  // Requirement bekommt eine geratene/nicht gegengeprüfte URL.
  //
  // V4.3.1: die interne Requirement-ID fuer SMB-Signierung wurde von
  // 'BSI-SYS.2.2.3-SMB-SIGNING' auf 'BSI-APP.2.2-SMB-SIGNING' korrigiert
  // (siehe bsi-mapping.js, SMB_SIGNING_REQUIREMENT_ID). Historischer
  // Befund, der zu dieser Korrektur fuehrte: die alte ID trug das Praefix
  // "SYS.2.2.3", die tatsaechliche, per Volltextsuche verifizierte SMB-
  // Signierungspflicht ("Der SMB-Datenverkehr MUSS signiert sein.") stand
  // aber schon immer in APP.2.2.A9, nicht in SYS.2.2.3 (dort 0 Treffer fuer
  // "SMB"/"signier"). Quelle/Text/Label/Berechnung unveraendert - nur der
  // ID-String wurde konsistent auf den tatsaechlichen Baustein umgestellt.
  const BSI_REQUIREMENT_INFO = {
    'BSI-SYS.2.2.3-NTLM-LM-LEVEL': {
      anforderung: 'BSI IT-Grundschutz-Kompendium, SYS.2.2.3.A9 "Sichere zentrale Authentisierung in Windows-Netzen": Für die zentrale Authentisierung soll bevorzugt Kerberos eingesetzt werden. Ist das nicht möglich, muss mindestens NTLMv2 verwendet werden - die Authentisierung über LAN-Manager und NTLMv1 darf weder innerhalb der Institution noch in einer produktiven Umgebung erlaubt sein.',
      empfehlung: 'Das BSI empfiehlt, veraltete LAN-Manager-/NTLMv1-Authentisierung zu unterbinden und mindestens NTLMv2 zu erzwingen, idealerweise aber durchgängig Kerberos einzusetzen.',
      sourceUrl: 'https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Grundschutz/IT-GS-Kompendium_Einzel_PDFs_2023/07_SYS_IT_Systeme/SYS_2_2_3_Clients_unter_Windows_Edition_2023.pdf?__blob=publicationFile&v=5',
      sourceLabel: 'BSI IT-Grundschutz-Kompendium – SYS.2.2.3 „Clients unter Windows" (PDF, Anforderung A9)',
      // V3.6 Einstiegsbereich ("BSI-Grundlage"): dieselben, hier bereits
      // verifizierten Angaben nur zusaetzlich strukturiert (Baustein +
      // Anforderungsnummer) - keine neue Quelle, keine neue Aussage.
      bausteinLabel: 'SYS.2.2.3 – Clients unter Windows',
      anforderungNr: 'A9',
      grundlageLabel: 'Grundlage für die NTLM-Bewertung',
    },
    'BSI-APP.2.2-SECURE-CHANNEL': {
      anforderung: 'BSI IT-Grundschutz-Kompendium, APP.2.2.A8 "Absicherung des Sicheren Kanals": Der Sichere Kanal zwischen Domänenmitglied und Domänencontroller soll so konfiguriert sein, dass alle übertragenen Daten immer verschlüsselt und signiert werden.',
      empfehlung: 'Das BSI empfiehlt, den Secure-Channel-Datenverkehr zwischen Domänenmitgliedern und Domänencontrollern durchgängig zu verschlüsseln und zu signieren.',
      sourceUrl: 'https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Grundschutz/IT-GS-Kompendium_Einzel_PDFs_2023/06_APP_Anwendungen/APP_2_2_Active_Directory_Domain_Services_Edition_2023.pdf?__blob=publicationFile&v=4',
      sourceLabel: 'BSI IT-Grundschutz-Kompendium – APP.2.2 „Active Directory Domain Services" (PDF, Anforderung A8)',
      bausteinLabel: 'APP.2.2 – Active Directory Domain Services',
      anforderungNr: 'A8',
      grundlageLabel: 'Grundlage für die Secure-Channel-Bewertung',
    },
    'BSI-APP.2.2-SMB-SIGNING': {
      anforderung: 'BSI IT-Grundschutz-Kompendium, APP.2.2.A9 "Schutz der Authentisierung beim Einsatz von AD DS": der SMB-Datenverkehr muss signiert sein, SMBv1 muss deaktiviert sein.',
      empfehlung: 'Das BSI schreibt signierten SMB-Datenverkehr verpflichtend vor und fordert die Deaktivierung von SMBv1.',
      sourceUrl: 'https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Grundschutz/IT-GS-Kompendium_Einzel_PDFs_2023/06_APP_Anwendungen/APP_2_2_Active_Directory_Domain_Services_Edition_2023.pdf?__blob=publicationFile&v=4',
      sourceLabel: 'BSI IT-Grundschutz-Kompendium – APP.2.2 „Active Directory Domain Services" (PDF, Anforderung A9)',
      // V4.3.1: Requirement-ID wurde konsistent auf APP.2.2 korrigiert
      // (siehe Kopf-Kommentar oben) - die Quelle war bereits vorher korrekt
      // (APP.2.2.A9), nur die interne ID hinkte hinterher.
      bausteinLabel: 'APP.2.2 – Active Directory Domain Services',
      anforderungNr: 'A9',
      grundlageLabel: 'Grundlage für die SMB-Signierungsbewertung',
    },
  };

  // ── Einstiegsbereich "BSI-Grundlage" (V3.6) ──────────────────
  // Rein statisch (kein Modell noetig) - baut ausschliesslich auf
  // BSI_REQUIREMENT_INFO/-LABELS/-ORDER auf (dieselbe, bereits in der BSI-
  // Coverage-Sektion verifizierte Quelle), damit es keine zweite,
  // abweichende BSI-Quellenliste gibt. Laeuft einmalig beim Laden der
  // Seite, unabhaengig davon, ob bereits ein Snapshot hochgeladen wurde.
  function renderBsiFoundationOnboarding() {
    const grid = document.getElementById('gpo-onboarding-bsi-grid');
    if (!grid) return;
    grid.replaceChildren();

    BSI_REQUIREMENT_ORDER.forEach(requirementId => {
      const info = BSI_REQUIREMENT_INFO[requirementId];
      if (!info) return;

      const card = document.createElement('div');
      card.className = 'gpo-bsi-requirement-card';

      const baustein = document.createElement('div');
      baustein.className = 'gpo-finding-sub-title';
      baustein.textContent = info.bausteinLabel || '';
      card.appendChild(baustein);

      const reqLine = document.createElement('div');
      reqLine.className = 'gpo-onboarding-bsi-req';
      reqLine.textContent = (info.anforderungNr ? info.anforderungNr + ' · ' : '') + (BSI_REQUIREMENT_LABELS[requirementId] || requirementId);
      card.appendChild(reqLine);

      const desc = document.createElement('div');
      desc.className = 'gpo-onboarding-bsi-desc';
      desc.textContent = info.grundlageLabel || ('Grundlage für die ' + (BSI_REQUIREMENT_LABELS[requirementId] || requirementId) + '-Bewertung');
      card.appendChild(desc);

      if (info.sourceUrl) {
        const link = document.createElement('a');
        link.className = 'gpo-kpi-bsi-link';
        link.href = info.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'BSI-Dokument öffnen →';
        card.appendChild(link);
      } else {
        const missing = document.createElement('div');
        missing.className = 'gpo-bsi-source-missing';
        missing.textContent = 'Offizielle BSI-Quelle derzeit nicht hinterlegt.';
        card.appendChild(missing);
      }

      grid.appendChild(card);
    });
  }

  document.addEventListener('DOMContentLoaded', renderBsiFoundationOnboarding);
  document.addEventListener('gpo-baseline-loaded', () => {
    renderMicrosoftBaselineStatus();
    renderMicrosoftBaselineComparison();
  });

  const BSI_COMPLIANCE_LABELS = { erfuellt: 'Erfüllt', nicht_erfuellt: 'Nicht erfüllt', pruefen: 'Prüfen' };

  // Reine 1:1-Anzeige-Zuordnung bereits vorhandener Enum-Werte (coverage/
  // status aus evaluateComputerRequirement()) auf Symbol+Text+aria-label -
  // keine neue Bewertung, keine Ableitung. Coverage-Symbol bleibt immer
  // neutral eingefaerbt; nur der Compliance-Zusatz traegt Farbe (Auftrag
  // Punkt 4/18: Coverage und Compliance duerfen farblich nicht vermischt
  // werden).
  function buildComputerStatusBadge(entry) {
    const wrap = document.createElement('span');
    wrap.className = 'gpo-bsi-badge';

    if (entry.coverage === 'covered') {
      wrap.classList.add('gpo-bsi-badge--covered');
      const cov = document.createElement('span');
      cov.className = 'gpo-bsi-badge-coverage';
      cov.textContent = '✓ Covered';
      wrap.appendChild(cov);

      if (BSI_COMPLIANCE_LABELS[entry.status]) {
        const compl = document.createElement('span');
        compl.className = 'gpo-bsi-badge-compliance gpo-bsi-badge-compliance--' + entry.status.replace(/_/g, '-');
        const symbol = entry.status === 'nicht_erfuellt' ? '⚠ ' : (entry.status === 'pruefen' ? '? ' : '');
        compl.textContent = '· ' + symbol + BSI_COMPLIANCE_LABELS[entry.status];
        wrap.appendChild(compl);
        wrap.setAttribute('aria-label', 'Covered – Anforderung ' + BSI_COMPLIANCE_LABELS[entry.status].toLowerCase());
      } else {
        wrap.setAttribute('aria-label', 'Covered');
      }
    } else if (entry.coverage === 'not_covered') {
      wrap.classList.add('gpo-bsi-badge--not-covered');
      wrap.textContent = '✕ Nicht abgedeckt';
      wrap.setAttribute('aria-label', 'Nicht abgedeckt');
    } else if (entry.coverage === 'not_determinable') {
      wrap.classList.add('gpo-bsi-badge--not-determinable');
      wrap.textContent = '? Nicht bestimmbar';
      wrap.setAttribute('aria-label', 'Nicht bestimmbar');
    } else {
      wrap.textContent = String(entry.coverage);
    }

    return wrap;
  }

  // GPO-ID -> GPO-Name ausschliesslich ueber das bereits geladene Modell
  // (_model.gpos, dieselbe Datenquelle wie openGpoDetail()) - kein Raten,
  // keine neue Lookup-Struktur. Ohne Treffer bleibt die GUID sichtbar.
  function gpoRefLabel(gpoId) {
    const gpo = (_model.gpos || []).find(g => g.id === gpoId);
    return gpo && gpo.name ? gpo.name : ('GPO-ID: ' + gpoId);
  }

  function buildBsiDetailBlock(title, text) {
    const wrap = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'gpo-finding-sub-title';
    t.textContent = title;
    const p = document.createElement('div');
    p.className = 'gpo-bsi-computer-detail-text';
    p.textContent = text;
    wrap.append(t, p);
    return wrap;
  }

  function buildBsiGpoListBlock(title, gpoIds) {
    const wrap = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'gpo-finding-sub-title';
    t.textContent = title;
    wrap.appendChild(t);

    if (!gpoIds || gpoIds.length === 0) {
      const none = document.createElement('div');
      none.className = 'gpo-bsi-computer-detail-text';
      none.textContent = 'Keine.';
      wrap.appendChild(none);
      return wrap;
    }

    const list = document.createElement('ul');
    list.className = 'gpo-bsi-gpo-list';
    gpoIds.forEach(id => {
      const li = document.createElement('li');
      li.textContent = gpoRefLabel(id);
      list.appendChild(li);
    });
    wrap.appendChild(list);
    return wrap;
  }

  // values kommt 1:1 aus evaluateComputerRequirement() (Setting-Key ->
  // erkannter Wert) - reine Schluessel/Wert-Anzeige, keine fachliche
  // Interpretation. Ein leeres Objekt bedeutet nur "keine konfigurierte
  // Einstellung erkannt", NICHT automatisch "nicht erfuellt" (Auftrag
  // Punkt 8).
  function buildBsiValuesBlock(values) {
    const wrap = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'gpo-finding-sub-title';
    t.textContent = 'Erkannte Werte';
    wrap.appendChild(t);

    const entries = values ? Object.entries(values) : [];
    if (entries.length === 0) {
      const none = document.createElement('div');
      none.className = 'gpo-bsi-computer-detail-text';
      none.textContent = 'Keine konfigurierte Einstellung erkannt.';
      wrap.appendChild(none);
      return wrap;
    }

    const list = document.createElement('ul');
    list.className = 'gpo-bsi-values-list';
    entries.forEach(([key, value]) => {
      const li = document.createElement('li');
      li.textContent = key + ': ' + (value === undefined ? '(kein Wert)' : value);
      list.appendChild(li);
    });
    wrap.appendChild(list);
    return wrap;
  }

  // Ein Computer-Eintrag aus evaluateComputerCoverage()'s result.computers[]
  // (V3.5.1) - zeigt ausschliesslich bereits vorhandene Felder
  // (computer.*, coverage, status, reason, reachingGpoIds,
  // configuringGpoIds, values). Keine neue fachliche Interpretation, keine
  // Gewinner-GPO. Standardmaessig zugeklappt (natives <details>).
  function buildBsiComputerRow(entry) {
    const c = entry.computer || {};
    const details = document.createElement('details');
    details.className = 'gpo-bsi-computer';

    const summary = document.createElement('summary');
    summary.className = 'gpo-bsi-computer-summary';
    summary.setAttribute('aria-label', 'Details fuer ' + (c.distinguishedName || 'Computer ohne distinguishedName') + ' ein-/ausklappen');
    summary.appendChild(buildComputerStatusBadge(entry));

    const dn = document.createElement('span');
    dn.className = 'gpo-bsi-computer-dn';
    dn.textContent = c.distinguishedName || '(kein distinguishedName)';
    summary.appendChild(dn);

    const metaParts = [];
    metaParts.push(c.operatingSystem ? c.operatingSystem : 'OS unbekannt');
    if (c.enabled === false) metaParts.push('Deaktiviert');
    if (c.isReadOnlyDomainController) metaParts.push('RODC');
    const meta = document.createElement('span');
    meta.className = 'gpo-bsi-computer-meta';
    meta.textContent = metaParts.join(' · ');
    summary.appendChild(meta);

    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'gpo-bsi-computer-details';
    if (entry.reason) body.appendChild(buildBsiDetailBlock('Warum dieses Ergebnis?', entry.reason));
    body.appendChild(buildBsiGpoListBlock('Erreichende GPOs', entry.reachingGpoIds));
    body.appendChild(buildBsiGpoListBlock('Konfigurierende GPOs', entry.configuringGpoIds));
    body.appendChild(buildBsiValuesBlock(entry.values));
    details.appendChild(body);

    return details;
  }

  function buildBsiComputerListDetails(computers) {
    const details = document.createElement('details');
    details.className = 'gpo-bsi-category-details';
    const summary = document.createElement('summary');
    summary.className = 'gpo-bsi-category-details-summary';
    summary.textContent = '▼ Details';
    summary.setAttribute('aria-label', 'Computerliste ein-/ausklappen (' + computers.length + ' Computer)');
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'gpo-bsi-computer-list';
    computers.forEach(entry => list.appendChild(buildBsiComputerRow(entry)));
    details.appendChild(list);

    return details;
  }

  // BSI-Anforderung/Empfehlung + Quelle - rein informativ, unabhaengig von
  // computers.json (deshalb auch sichtbar, wenn Computer-Coverage fuer
  // diesen Snapshot nicht auswertbar ist). Quelle nur verlinkt, wenn vorab
  // per Volltextabgleich verifiziert (siehe BSI_REQUIREMENT_INFO-Kommentar
  // und Bericht) - sonst expliziter "nicht hinterlegt"-Hinweis statt einer
  // geratenen URL.
  function buildBsiRequirementInfo(requirementId) {
    const info = BSI_REQUIREMENT_INFO[requirementId];
    const details = document.createElement('details');
    details.className = 'gpo-bsi-req-info';
    const summary = document.createElement('summary');
    summary.className = 'gpo-bsi-req-info-summary';
    summary.textContent = 'BSI-Anforderung / Empfehlung';
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'gpo-bsi-req-info-body';

    if (info) {
      body.appendChild(buildBsiDetailBlock('BSI-Anforderung', info.anforderung));
      body.appendChild(buildBsiDetailBlock('Was empfiehlt das BSI?', info.empfehlung));
    }

    if (info && info.sourceUrl) {
      const link = document.createElement('a');
      link.className = 'gpo-kpi-bsi-link';
      link.href = info.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = (info.sourceLabel || 'BSI-Quelle') + ' öffnen →';
      body.appendChild(link);
    } else {
      const missing = document.createElement('div');
      missing.className = 'gpo-bsi-source-missing';
      missing.textContent = 'Offizielle BSI-Quelle derzeit nicht hinterlegt.';
      body.appendChild(missing);
    }

    details.appendChild(body);
    return details;
  }

  // Welche der fuenf fachlich relevanten Snapshot-Dateien wurden tatsaechlich
  // geladen? Ausschliesslich bereits vorhandene Datenquellen: _missingFiles
  // (identische Liste, die auch renderMissingHint() zeigt) sowie die beiden
  // bestehenden dataQuality-Flags. Keine neue Datenherkunftslogik.
  const BSI_DATA_SOURCE_FILES = [
    { label: 'Computer', filename: 'computers.json' },
    { label: 'GPO-Konfiguration', filename: 'gpos.json' },
    { label: 'GPO-Verknüpfungen', filename: 'links.json' },
    { label: 'Security-Filter', filename: 'filters.json' },
    { label: 'WMI-Filter', filename: 'wmi-filters.json' },
  ];

  function isBsiDataSourceMissing(filename) {
    const dq = _model.dataQuality || {};
    if (filename === 'computers.json') return !!dq.computersFileMissing;
    if (filename === 'links.json') return !!dq.linksFileMissing;
    return (_missingFiles || []).indexOf(filename) !== -1;
  }

  // Reine Anzeige-Liste, von zwei Stellen wiederverwendet (bestehende
  // Datenbasis innerhalb von BSI-Coverage UND der neue zentrale
  // "Datenbasis"-Hauptbereich, V3.7 Punkt 11) - keine zweite, abweichende
  // Pruef-Logik, dieselbe isBsiDataSourceMissing()/BSI_DATA_SOURCE_FILES.
  function buildDataBasisList() {
    const list = document.createElement('ul');
    list.className = 'gpo-bsi-databasis-list';
    BSI_DATA_SOURCE_FILES.forEach(({ label, filename }) => {
      const missing = isBsiDataSourceMissing(filename);
      const li = document.createElement('li');
      li.className = 'gpo-bsi-databasis-item' + (missing ? ' gpo-bsi-databasis-item--missing' : '');
      li.textContent = (missing ? '✕ ' : '✓ ') + label + ': ' + filename + (missing ? ' (nicht im Snapshot vorhanden)' : ' (geladen)');
      list.appendChild(li);
    });
    return list;
  }

  function buildBsiDataBasisSection() {
    const details = document.createElement('details');
    details.className = 'gpo-bsi-databasis';
    const summary = document.createElement('summary');
    summary.className = 'gpo-bsi-databasis-summary';
    summary.textContent = 'Datenbasis';
    details.appendChild(summary);
    details.appendChild(buildDataBasisList());
    return details;
  }

  // Zentraler, eigenstaendiger "Datenbasis"-Hauptbereich (V3.7 Punkt 11) -
  // zeigt dieselbe Datei-Verfuegbarkeit wie buildBsiDataBasisSection()
  // oben, nur an einer zweiten, ueber die Seiten-Navigation direkt
  // erreichbaren Stelle. Keine neue Datenherkunftslogik.
  // V4.3: Inhalt steht jetzt hinter einem <details> - dieselbe bereits
  // vorhandene Information (buildDataBasisList()/dataQuality), nur nicht
  // mehr dauerhaft vollstaendig ausgeklappt. "Technische Informationen /
  // Datenbasis" statt nur "Datenbasis" als Sichtbeschreibung, damit klar
  // ist, dass es sich um Hintergrund-/Herkunftsinformation handelt, nicht
  // um ein Analyseergebnis.
  function renderDataBasisSection() {
    const container = document.getElementById('gpo-databasis-container');
    if (!container) return;
    container.replaceChildren();

    const details = document.createElement('details');
    details.className = 'gpo-databasis-details';
    const summary = document.createElement('summary');
    summary.className = 'gpo-onboarding-collapsible-summary';
    summary.textContent = 'Technische Informationen / Datenbasis';
    details.appendChild(summary);

    const intro = document.createElement('div');
    intro.className = 'gpo-bsi-intro';
    intro.textContent = 'Zeigt ausschließlich, welche der vom Analyzer erwarteten Snapshot-Dateien im aktuell geladenen ZIP tatsächlich vorhanden waren – computers.json fehlend und computers.json vorhanden-aber-leer bleiben dabei unterscheidbar.';
    details.appendChild(intro);
    details.appendChild(buildDataBasisList());

    container.appendChild(details);
  }

  function renderBsiCoverage() {
    const container = document.getElementById('gpo-bsi-container');
    if (!container) return;
    container.replaceChildren();

    const intro = document.createElement('div');
    intro.className = 'gpo-bsi-intro';
    intro.textContent = 'Coverage zeigt nur, ob für einen Computer-Bereich eine eindeutig auswertbare GPO-Konfiguration vorliegt – nicht, ob die Anforderung erfüllt ist. Über "▼ Details" lässt sich je Kategorie die zugrunde liegende Computer-/GPO-Evidenz nachvollziehen.';
    container.appendChild(intro);

    if (!window.GpoBsiMapping || typeof window.GpoBsiMapping.evaluateComputerCoverage !== 'function') {
      const empty = document.createElement('div');
      empty.className = 'gpo-empty';
      empty.textContent = 'BSI-Coverage-Modul nicht verfügbar.';
      container.appendChild(empty);
      return;
    }

    // Expliziter Trennungshinweis (Auftrag Punkt 17) - oberhalb der
    // Detailansicht, damit ein gruenes Coverage-Symbol nie allein als
    // BSI-Konformitaet gelesen wird.
    const complianceHint = document.createElement('div');
    complianceHint.className = 'gpo-bsi-intro';
    complianceHint.textContent = 'Coverage und Compliance sind getrennte Aussagen: „Covered" bedeutet, dass eine auswertbare GPO-Konfiguration gefunden wurde. „Erfüllt", „Nicht erfüllt" oder „Prüfen" beschreibt die fachliche Bewertung. Aus einem Covered-Symbol allein lässt sich keine BSI-Konformität ableiten.';
    container.appendChild(complianceHint);

    const dataQuality = _model.dataQuality || {};
    const computersMissing = !!dataQuality.computersFileMissing;

    // Zeilenbezogener Covered-vs-Compliance-Hinweis (Info-Icon, siehe
    // bsiCoveredNonCompliantEntries() unten) bleibt unveraendert bestehen -
    // der neue Computer-Drill-down unten liefert dieselbe Unterscheidung
    // jetzt zusaetzlich fuer alle drei Kategorien direkt pro Computer.
    const gpoCentricByRequirement = (typeof window.GpoBsiMapping.evaluate === 'function')
      ? window.GpoBsiMapping.evaluate(_model, _findings)
      : {};
    const coverage = computersMissing ? null : window.GpoBsiMapping.evaluateComputerCoverage(_model);

    const grid = document.createElement('div');
    grid.className = 'gpo-bsi-grid';
    BSI_REQUIREMENT_ORDER.forEach(requirementId => {
      const req = coverage ? coverage[requirementId] : null;
      grid.appendChild(buildBsiRequirementCard(requirementId, req, gpoCentricByRequirement[requirementId] || [], computersMissing));
    });
    container.appendChild(grid);

    container.appendChild(buildBsiDataBasisSection());
  }

  // V3.7: Reihenfolge bewusst "Ergebnis zuerst" (Auftrag Punkt 8/10) -
  // Titel -> kompakte Kategorie-Zusammenfassung -> Anforderung/BSI-
  // Empfehlung erst ganz unten, aufklappbar. Rein die Anzeige-Reihenfolge
  // geaendert, keine der darunterliegenden Werte/Berechnungen angefasst.
  function buildBsiRequirementCard(requirementId, req, gpoCentricEntries, computersMissing) {
    const card = document.createElement('div');
    card.className = 'gpo-bsi-requirement-card';

    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = BSI_REQUIREMENT_LABELS[requirementId] || requirementId;
    card.appendChild(title);

    // computers.json fehlt (oder Coverage konnte aus anderem Grund nicht
    // berechnet werden) -> keine Computerlisten darstellen, bestehenden
    // Hinweis zeigen statt "0 Computer" (Auftrag Punkt 14). Die
    // Anforderung/Empfehlung bleibt trotzdem sichtbar (braucht keine
    // Computerdaten).
    if (computersMissing || !req) {
      const empty = document.createElement('div');
      empty.className = 'gpo-empty';
      empty.textContent = 'Keine computers.json im Snapshot vorhanden. Computer-basierte Coverage kann für diesen Snapshot nicht ausgewertet werden.';
      card.appendChild(empty);
      card.appendChild(buildBsiRequirementInfo(requirementId));
      return card;
    }

    BSI_CATEGORY_ORDER.forEach(catKey => {
      const cat = req.categories[catKey];
      if (cat) card.appendChild(buildBsiCategoryRow(BSI_CATEGORY_LABELS[catKey], cat, catKey, gpoCentricEntries, req.computers));
    });

    const unknownLine = document.createElement('div');
    unknownLine.className = 'gpo-bsi-unknown-line';
    unknownLine.textContent = 'Unknown: ' + req.unknown + ' – Computer ohne eindeutige Kategorie, nicht in Domain Controllers/Member Server/Clients eingerechnet.';
    card.appendChild(unknownLine);

    if (req.unknown > 0) {
      const unknownComputers = (req.computers || []).filter(c => c.computer && c.computer.category === 'unknown');
      if (unknownComputers.length > 0) card.appendChild(buildBsiComputerListDetails(unknownComputers));
    }

    card.appendChild(buildBsiRequirementInfo(requirementId));

    return card;
  }

  // "Covered" bei mindestens einem vorhandenen Eintrag dieser Kategorie,
  // dessen bereits vorhandener status != 'erfuellt' ist ("mindestens
  // einer reicht" - Test G: keine Aussage ueber ALLE covered-Faelle der
  // Zeile). Absichtlich .some(), nicht .every() oder eine Mehrheitsregel.
  function bsiCoveredNonCompliantEntries(gpoCentricEntries, catKey) {
    return gpoCentricEntries.filter(e => e.scopeCategory === catKey && e.coverage === 'covered' && e.status && e.status !== 'erfuellt');
  }

  function buildBsiCategoryRow(label, cat, catKey, gpoCentricEntries, computers) {
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

    if (cat.total > 0) {
      const categoryComputers = (computers || []).filter(c => c.computer && c.computer.category === catKey);
      if (categoryComputers.length > 0) row.appendChild(buildBsiComputerListDetails(categoryComputers));
    }

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
    const cleanupSearch = document.getElementById('gpo-cleanup-search');
    if (cleanupSearch) {
      cleanupSearch.addEventListener('input', (e) => {
        _state.cleanupQuery = e.target.value.trim();
        renderGpoCleanupView();
      });
    }
    const cleanupGroupFilter = document.getElementById('gpo-cleanup-group-filter');
    if (cleanupGroupFilter) {
      cleanupGroupFilter.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-group]');
        if (!btn) return;
        _state.cleanupGroupFilter = btn.dataset.group;
        renderGpoCleanupView();
      });
    }
    const cleanupStatusFilter = document.getElementById('gpo-cleanup-status-filter');
    if (cleanupStatusFilter) {
      cleanupStatusFilter.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-status]');
        if (!btn) return;
        _state.cleanupStatusFilter = btn.dataset.status;
        renderGpoCleanupView();
      });
    }
    const cleanupSortSelect = document.getElementById('gpo-cleanup-sort-select');
    if (cleanupSortSelect) {
      cleanupSortSelect.addEventListener('change', (e) => {
        _state.cleanupSort = e.target.value;
        renderGpoCleanupView();
      });
    }
    const detailClose = document.getElementById('gpo-detail-panel-close');
    if (detailClose) detailClose.addEventListener('click', closeGpoDetail);
  }

  document.addEventListener('DOMContentLoaded', initSearchInputs);

  // ── Aktive Seiten-Navigation (V3.7) ──────────────────────────
  // Reine Darstellung: hebt in der Sidebar-Navigation hervor, welcher der
  // 6 Hauptbereiche gerade im Sichtbereich liegt. Nutzt ausschliesslich
  // IntersectionObserver (Auftrag Punkt 3) - keine eigene Scroll-Berechnung,
  // keine fachliche Logik. Ist aktuell kein Bereich eindeutig sichtbar
  // (z.B. zwischen zwei Sektionen), bleibt die zuletzt gesetzte
  // Hervorhebung bestehen, statt sie zu loeschen.
  const NAV_SECTION_IDS = [
    'gpo-dashboard-section',
    'gpo-explorer-section',
    'gpo-findings-section',
    'gpo-tree-section',
    'gpo-bsi-section',
    'gpo-reference-section',
    'gpo-rsop-section',
    'gpo-databasis-section',
  ];

  function initActiveNavHighlight() {
    if (typeof IntersectionObserver !== 'function') return;

    const linksById = {};
    document.querySelectorAll('.gpo-page-nav-link').forEach(a => {
      const id = (a.getAttribute('href') || '').replace('#', '');
      if (id) linksById[id] = a;
    });

    const sections = NAV_SECTION_IDS.map(id => document.getElementById(id)).filter(Boolean);
    if (!sections.length) return;

    let activeId = null;
    function setActive(id) {
      if (id === activeId) return;
      activeId = id;
      Object.keys(linksById).forEach(linkId => {
        linksById[linkId].classList.toggle('gpo-page-nav-link--active', linkId === id);
      });
    }

    const ratioById = new Map();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        ratioById.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
      });
      let bestId = null;
      let bestRatio = 0;
      ratioById.forEach((ratio, id) => {
        if (ratio > bestRatio) { bestRatio = ratio; bestId = id; }
      });
      // Nur wechseln, wenn tatsaechlich ein Bereich eindeutig sichtbar ist -
      // sonst bleibt die zuletzt bekannte Hervorhebung stehen (Auftrag
      // Punkt 3, letzter Satz).
      if (bestId) setActive(bestId);
    }, {
      root: null,
      rootMargin: '-96px 0px -55% 0px',
      threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
    });

    sections.forEach(sec => observer.observe(sec));
  }

  document.addEventListener('DOMContentLoaded', initActiveNavHighlight);

  return { renderOverview };
})();
