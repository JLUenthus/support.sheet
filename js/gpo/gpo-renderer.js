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

  // Fester Hinweistext aus dem Konzept, Abschnitt 5/6.
  const CONFLICT_DESC  = 'Mehrere GPOs definieren dieselbe Einstellung mit unterschiedlichen Werten.';
  const REDUNDANT_DESC = 'Mehrfach definiert, aktuell kein direkter Wertkonflikt erkennbar.';

  // Verknuepfung mit dem Command-System (Konzept Abschnitt 15) - dieselben
  // vier Befehle fuer Konflikt- und Hygiene-Findings, aus data/commands.json
  // wiederverwendet statt hier dupliziert.
  const DIAGNOSE_COMMAND_IDS = [
    'gpo-gpo-status-anzeigen',              // gpresult /r
    'gpo-gpo-report-als-html',               // gpresult /h
    'gpo-rsop-anzeigen',                     // rsop.msc
    'gpo-richtlinien-sofort-aktualisieren',  // gpupdate /force
  ];

  let _model = null;
  let _findings = [];
  let _diagnoseCommands = [];
  let _missingFiles = [];
  const _state = { conflictQuery: '', redundantQuery: '' };

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
    resetSearchInputs();

    renderMissingHint(_missingFiles);
    renderIntegrityPanel();
    renderNumGrid();
    renderAmpelRow();
    renderConflictList();
    renderRedundantList();
    renderHygieneList();
    renderOuTree();
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

    const failed = _model.gpos.filter(g => g.parseStatus === 'failed');
    const partial = _model.gpos.filter(g => g.parseStatus === 'partial');

    if (!failed.length && !partial.length) {
      panel.className = 'gpo-integrity-panel gpo-integrity-panel--ok';
      panel.textContent = '✓ Alle GPO-Reports vollständig gelesen.';
      return;
    }

    panel.className = 'gpo-integrity-panel gpo-integrity-panel--warn';

    const title = document.createElement('div');
    title.className = 'gpo-integrity-title';
    title.textContent = '⚠ Snapshot teilweise unvollständig';
    panel.appendChild(title);

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

  // null bedeutet "nicht bestimmbar" (links.json fehlte im ZIP) statt einer
  // falschen Zahl - siehe .md/todo/GPO_Analyzer_Pre_Real_Data_Hardening.md,
  // Abschnitt 8: eine fehlende Links-Datei darf nicht als "alle GPOs
  // unverknuepft" interpretiert werden. Liest dataQuality.linksFileMissing
  // aus dem Modell (gpo-parser.js) statt eigenstaendig aus _missingFiles
  // abzuleiten - dieselbe Quelle wie der Analyzer (GPO_NO_LINKS), damit
  // Uebersichtszahl und Findings nicht auseinanderlaufen koennen.
  function unlinkedGpoCount() {
    if (_model.dataQuality && _model.dataQuality.linksFileMissing) return null;
    const linkedGpoIds = new Set(_model.links.map(l => l.gpoId));
    return _model.gpos.filter(g => !linkedGpoIds.has(g.id)).length;
  }

  // Hygiene + Security-Filter zaehlen als "Auffaelligkeit", WMI-Filter
  // bewusst nicht (siehe Kommentar am Dateianfang).
  function anomalyCount() {
    return _findings.filter(f => f.type === 'hygiene' || f.type === 'security-filter').length;
  }

  function renderNumGrid() {
    const grid = document.getElementById('gpo-num-grid');
    grid.replaceChildren();

    const conflictCount  = countByType('conflict');
    const redundantCount = countByType('redundant');

    [
      ['GPOs', _model.gpos.length],
      ['Verknüpfungen', _model.links.length],
      ['Konflikte', conflictCount],
      ['Redundante Einstellungen', redundantCount],
      ['Auffälligkeiten', anomalyCount()],
      ['Unverknüpfte GPOs', unlinkedGpoCount()],
    ].forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'gpo-num-item';
      const val = document.createElement('div');
      val.className = 'gpo-num-value';
      // null = "nicht bestimmbar" (siehe unlinkedGpoCount()) statt einer
      // aus fehlenden Daten erratenen Zahl.
      val.textContent = value === null ? '–' : value;
      const lbl = document.createElement('div');
      lbl.className = 'gpo-num-label';
      lbl.textContent = label;
      item.appendChild(val);
      item.appendChild(lbl);
      grid.appendChild(item);
    });
  }

  function renderAmpelRow() {
    const row = document.getElementById('gpo-ampel-row');
    row.replaceChildren();

    const conflictCount  = countByType('conflict');
    const redundantCount = countByType('redundant');

    [
      ['🔴', conflictCount, 'Konflikte'],
      ['🟡', anomalyCount(), 'Auffälligkeiten'],
      ['🔵', redundantCount, 'redundante Einstellungen'],
    ].forEach(([icon, count, label]) => {
      const pill = document.createElement('div');
      pill.className = 'gpo-ampel-pill';
      pill.textContent = icon + ' ' + count + ' ' + label;
      row.appendChild(pill);
    });

    const ok = document.createElement('div');
    ok.className = 'gpo-ampel-pill gpo-ampel-pill--ok';
    ok.textContent = '✓ ' + _model.gpos.length + ' GPOs analysiert';
    row.appendChild(ok);
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
      const links = linksForGpo(entry.gpoId);

      const gpoDetail = document.createElement('div');
      gpoDetail.className = 'gpo-detail-gpo';

      const gpoTitle = document.createElement('div');
      gpoTitle.className = 'gpo-detail-gpo-title';
      gpoTitle.textContent = entry.gpoName;
      gpoDetail.appendChild(gpoTitle);

      if (links.length) {
        // enforced/blockInheritance je Link statt eines GPO-weiten Badges:
        // dieselbe GPO kann an einem Ziel enforced sein und an einem
        // anderen nicht (siehe .md/todo/GPO_Analyzer_Pre_Real_Data_
        // Hardening.md, Abschnitt 4/5) - ein GPO-Level-Badge wuerde das
        // falsch als globale Eigenschaft darstellen.
        const linkList = document.createElement('ul');
        linkList.className = 'gpo-detail-link-list';
        links.forEach(l => {
          const li = document.createElement('li');
          li.textContent = '[' + l.targetType + '] ' + l.target + ' (Reihenfolge ' + l.order + ')'
            + (l.enforced ? ' 🔒 enforced' : '')
            + (l.blockInheritance ? ' 🚫 block inheritance' : '');
          linkList.appendChild(li);
        });
        gpoDetail.appendChild(linkList);
      } else {
        const noLink = document.createElement('div');
        noLink.className = 'gpo-detail-no-link';
        noLink.textContent = 'Keine Verknüpfung gefunden.';
        gpoDetail.appendChild(noLink);
      }

      wrap.appendChild(gpoDetail);
    });

    return wrap;
  }

  function buildEntryRowList(finding) {
    const wrap = document.createElement('div');
    wrap.className = 'gpo-entry-row-list';
    finding.entries.forEach(entry => {
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
      wrap.appendChild(row);
    });
    return wrap;
  }

  function makeExpandable(header, body, expand) {
    header.addEventListener('click', () => {
      const isOpen = body.classList.toggle('open');
      expand.classList.toggle('open', isOpen);
    });
  }

  function buildRecommendationSection(rule) {
    if (!rule || !rule.recommendations || !rule.recommendations.length) return null;
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Empfehlung';
    wrap.appendChild(title);
    rule.recommendations.forEach(rec => {
      const p = document.createElement('div');
      p.className = 'gpo-detail-row';
      p.textContent = rec.text;
      wrap.appendChild(p);
    });
    return wrap;
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
  function buildConflictCard(finding) {
    const { category, name } = splitSettingKey(finding.settingKey);

    const card = document.createElement('div');
    card.className = 'gpo-finding-card gpo-finding-card--conflict';

    const header = document.createElement('div');
    header.className = 'gpo-finding-header';

    const badge = document.createElement('span');
    badge.className = 'gpo-sev-pill gpo-sev-pill--critical';
    badge.textContent = '🔴 Konflikt';

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

    const body = document.createElement('div');
    body.className = 'gpo-finding-body';

    const desc = document.createElement('p');
    desc.className = 'gpo-finding-desc';
    desc.textContent = CONFLICT_DESC;
    body.appendChild(desc);

    body.appendChild(buildEntryRowList(finding));

    // Kein "GPO X gewinnt" - stattdessen immer der feste RSoP-Hinweis.
    const hint = document.createElement('div');
    hint.className = 'gpo-conflict-hint';
    hint.textContent = finding.hint;
    body.appendChild(hint);

    body.appendChild(buildDetailSection(finding, category));

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
    countEl.textContent = conflicts.length;

    if (!conflicts.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const q = _state.conflictQuery.toLowerCase();
    const filtered = q ? conflicts.filter(f => f.settingKey.toLowerCase().includes(q)) : conflicts;

    if (!filtered.length) {
      const noMatch = document.createElement('div');
      noMatch.className = 'gpo-empty';
      noMatch.textContent = 'Keine Treffer für die Suche.';
      list.appendChild(noMatch);
      return;
    }

    filtered.forEach(f => list.appendChild(buildFindingCard(f)));
  }

  // ── Redundanz-Liste (Konzept Abschnitt 6) ───────────────────
  function buildRedundantCard(finding) {
    const { category, name } = splitSettingKey(finding.settingKey);

    const card = document.createElement('div');
    card.className = 'gpo-finding-card gpo-finding-card--redundant';

    const header = document.createElement('div');
    header.className = 'gpo-finding-header';

    const badge = document.createElement('span');
    badge.className = 'gpo-sev-pill gpo-sev-pill--info';
    badge.textContent = '🔵 Redundant';

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

    const body = document.createElement('div');
    body.className = 'gpo-finding-body';

    const value = finding.entries[0] ? finding.entries[0].value : '';
    const desc = document.createElement('p');
    desc.className = 'gpo-finding-desc';
    desc.textContent = REDUNDANT_DESC + ' Wert: ' + (value || '(leer)');
    body.appendChild(desc);

    const definedIn = document.createElement('div');
    definedIn.className = 'gpo-redundant-defined-in';
    const definedLabel = document.createElement('span');
    definedLabel.className = 'gpo-finding-sub-title';
    definedLabel.textContent = 'Definiert in';
    definedIn.appendChild(definedLabel);
    const gpoNames = document.createElement('div');
    gpoNames.className = 'gpo-redundant-gpo-list';
    gpoNames.textContent = finding.entries.map(e => e.gpoName).join(', ');
    definedIn.appendChild(gpoNames);
    body.appendChild(definedIn);

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
    countEl.textContent = redundants.length;

    if (!redundants.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const q = _state.redundantQuery.toLowerCase();
    const filtered = q ? redundants.filter(f => f.settingKey.toLowerCase().includes(q)) : redundants;

    if (!filtered.length) {
      const noMatch = document.createElement('div');
      noMatch.className = 'gpo-empty';
      noMatch.textContent = 'Keine Treffer für die Suche.';
      list.appendChild(noMatch);
      return;
    }

    filtered.forEach(f => list.appendChild(buildFindingCard(f)));
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
    badge.className = 'gpo-sev-pill gpo-sev-pill--warning';
    badge.textContent = '⚠ ' + (rule.name || 'Hygiene');

    const title = document.createElement('span');
    title.className = 'gpo-finding-title';
    title.textContent = finding.gpoName;

    const expand = document.createElement('span');
    expand.className = 'gpo-finding-expand';
    expand.textContent = '▼';

    header.append(badge, title, expand);

    const body = document.createElement('div');
    body.className = 'gpo-finding-body';

    const desc = document.createElement('p');
    desc.className = 'gpo-finding-desc';
    desc.textContent = rule.description || '';
    body.appendChild(desc);

    if (finding.detail && finding.detail.modified) {
      const detailRow = document.createElement('div');
      detailRow.className = 'gpo-detail-row';
      const modifiedLabel = (finding.detail.modified || '').replace('T', ' ').substring(0, 16);
      detailRow.textContent = 'Zuletzt geändert: ' + modifiedLabel
        + (finding.detail.ageYears != null ? ' (vor ' + finding.detail.ageYears + '+ Jahren)' : '');
      body.appendChild(detailRow);
    }

    // GPO_NO_LINKS: "gar kein Link" und "Link vorhanden, aber deaktiviert"
    // sehen sonst identisch aus (beide nutzen dieselbe rule.description) -
    // beim GPMC-Abgleich wuerde ein Techniker einen vorhandenen (nur
    // deaktivierten) Link sonst als Diskrepanz zum Tool missverstehen.
    if (finding.detail && finding.detail.linkStatus === 'disabled') {
      const detailRow = document.createElement('div');
      detailRow.className = 'gpo-detail-row';
      const count = finding.detail.disabledLinkCount || 0;
      detailRow.textContent = 'Verknüpfung vorhanden, aber deaktiviert (' + count + (count === 1 ? ' Link).' : ' Links).');
      body.appendChild(detailRow);
    } else if (finding.detail && finding.detail.linkStatus === 'none') {
      const detailRow = document.createElement('div');
      detailRow.className = 'gpo-detail-row';
      detailRow.textContent = 'Keine Verknüpfung vorhanden.';
      body.appendChild(detailRow);
    }

    const recSection = buildRecommendationSection(rule);
    if (recSection) body.appendChild(recSection);

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

    const body = document.createElement('div');
    body.className = 'gpo-finding-body';

    const desc = document.createElement('p');
    desc.className = 'gpo-finding-desc';
    desc.textContent = rule.description || '';
    body.appendChild(desc);

    const linkRow = document.createElement('div');
    linkRow.className = 'gpo-detail-row';
    linkRow.textContent = 'Verknüpft mit: [' + finding.targetType + '] ' + finding.target;
    body.appendChild(linkRow);

    const filterRow = document.createElement('div');
    filterRow.className = 'gpo-detail-row';
    filterRow.textContent = 'Security Filter: ' + (finding.securityFilter || []).map(f => f.trustee).join(', ');
    body.appendChild(filterRow);

    const recSection = buildRecommendationSection(rule);
    if (recSection) body.appendChild(recSection);

    makeExpandable(header, body, expand);
    card.append(header, body);
    return card;
  }

  function buildWmiFilterCard(finding) {
    const rule = finding.rule || {};
    const wmiFilter = finding.wmiFilter || {};

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

    const body = document.createElement('div');
    body.className = 'gpo-finding-body';

    const desc = document.createElement('p');
    desc.className = 'gpo-finding-desc';
    desc.textContent = rule.description || '';
    body.appendChild(desc);

    const nameRow = document.createElement('div');
    nameRow.className = 'gpo-detail-row';
    nameRow.textContent = 'Filter: ' + (wmiFilter.name || wmiFilter.id || 'unbekannt');
    body.appendChild(nameRow);

    if (wmiFilter.query) {
      const queryRow = document.createElement('div');
      queryRow.className = 'gpo-detail-row';
      const code = document.createElement('code');
      code.className = 'gpo-entry-value';
      code.textContent = wmiFilter.query;
      queryRow.appendChild(code);
      body.appendChild(queryRow);
    }

    makeExpandable(header, body, expand);
    card.append(header, body);
    return card;
  }

  function renderHygieneList() {
    const list  = document.getElementById('gpo-hygiene-list');
    const empty = document.getElementById('gpo-hygiene-empty');
    const countEl = document.getElementById('gpo-hygiene-count');
    list.replaceChildren();

    const hygieneFindings = _findings.filter(f => ['hygiene', 'security-filter', 'wmi-filter'].includes(f.type));
    countEl.textContent = hygieneFindings.length;

    if (!hygieneFindings.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    hygieneFindings.forEach(f => {
      const card = buildFindingCard(f);
      if (card) list.appendChild(card);
    });
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
  function hasNonDefaultSecurityFilter(gpo) {
    const filters = gpo.securityFilter || [];
    if (!filters.length) return false;
    return !filters.every(f => /authenticated users$/i.test((f.trustee || '').trim()));
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

  function buildGpoDetailMeta(gpo) {
    const wrap = document.createElement('div');
    [
      ['Status', gpo.status || '–'],
      ['Erstellt', formatDate(gpo.created)],
      ['Geändert', formatDate(gpo.modified)],
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

  function buildGpoDetailSettings(gpo) {
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Einstellungen (' + (gpo.settings || []).length + ')';
    wrap.appendChild(title);

    if (!gpo.settings || !gpo.settings.length) {
      const noneRow = document.createElement('div');
      noneRow.className = 'gpo-detail-row';
      noneRow.textContent = 'Keine konfigurierten Einstellungen.';
      wrap.appendChild(noneRow);
      return wrap;
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
    wrap.appendChild(list);
    return wrap;
  }

  function buildGpoDetailFindings(gpo) {
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'gpo-finding-sub-title';
    title.textContent = 'Findings zu dieser GPO';
    wrap.appendChild(title);

    const related = _findings.filter(f => findingInvolvesGpo(f, gpo.id));
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
    body.appendChild(buildGpoDetailSettings(gpo));
    body.appendChild(buildGpoDetailFindings(gpo));

    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeGpoDetail() {
    const panel = document.getElementById('gpo-detail-panel');
    if (panel) panel.hidden = true;
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
    const detailClose = document.getElementById('gpo-detail-panel-close');
    if (detailClose) detailClose.addEventListener('click', closeGpoDetail);
  }

  document.addEventListener('DOMContentLoaded', initSearchInputs);

  return { renderOverview };
})();
