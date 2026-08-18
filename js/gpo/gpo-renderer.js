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

  // Konflikte werden nach conflictLevel getrennt gezaehlt (Roadmap
  // .md/todo/GPO_Analyzer_Roadmap_vor_v2_v2_spaeter.md, Abschnitt 1.1/2.1:
  // "echte" vs. "potenzielle" Konflikte statt einer einzigen Zahl).
  function countByConflictLevel(level) {
    return _findings.filter(f => f.type === 'conflict' && f.conflictLevel === level).length;
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

    const redundantCount = countByType('redundant');

    [
      ['GPOs', _model.gpos.length],
      ['Verknüpfungen', _model.links.length],
      ['Echte Konflikte', countByConflictLevel('real')],
      ['Potenzielle Konflikte', countByConflictLevel('potential')],
      ['Mehrfach definierte Einstellungen', redundantCount],
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

    const redundantCount = countByType('redundant');

    [
      ['🔴', countByConflictLevel('real'), 'echte Konflikte'],
      ['🟡', countByConflictLevel('potential'), 'potenzielle Konflikte'],
      ['🟡', anomalyCount(), 'Auffälligkeiten'],
      ['🔵', redundantCount, 'mehrfach definierte Einstellungen'],
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

    body.appendChild(buildBodySection('Was', sections.was));
    body.appendChild(buildBodySection('Bewertung', sections.bewertung));
    body.appendChild(buildBodySection('Nächster Schritt', sections.naechsterSchritt, true));

    return body;
  }

  function buildBodySection(title, content, isNextStep) {
    const wrap = document.createElement('div');
    wrap.className = 'gpo-body-section' + (isNextStep ? ' gpo-body-section--next-step' : '');
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

  function resolveConflictSections(finding) {
    return {
      was: [CONFLICT_DESC, buildEntryRowList(finding)],
      bewertung: finding.scopeExplanation || '',
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

  function resolveWmiFilterSections(finding) {
    const rule = finding.rule || {};
    const wmiFilter = finding.wmiFilter || {};
    const was = ['Filter: ' + (wmiFilter.name || wmiFilter.id || 'unbekannt')];

    if (wmiFilter.query) {
      const queryRow = document.createElement('div');
      queryRow.className = 'gpo-detail-row';
      const code = document.createElement('code');
      code.className = 'gpo-entry-value';
      code.textContent = wmiFilter.query;
      queryRow.appendChild(code);
      was.push(queryRow);
    }

    return {
      was,
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

    const card = document.createElement('div');
    card.className = 'gpo-finding-card gpo-finding-card--conflict';

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

    const hygieneFindings = _findings.filter(f => ['hygiene', 'security-filter', 'wmi-filter'].includes(f.type));
    countEl.textContent = hygieneFindings.length;

    if (!hygieneFindings.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

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

      items.forEach(f => {
        const card = buildFindingCard(f);
        if (card) section.appendChild(card);
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
