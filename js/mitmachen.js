// ============================================================
// support.sheet – mitmachen.js
// Schritt 1 (Daten laden) + Schritt 2 (Uebersicht, Filter, Suche)
// aus dem Mitmachen-Konzept. Kein Framework, kein Build-Schritt.
// ============================================================
(function () {
  const SESSION_KEY = 'mitmachen_data';

  // Ziel-Adresse fuer die Mailto-Formulare (Skript einreichen, Feedback).
  // Noch ein unausgefuellter Platzhalter, siehe docs/review-2026-07-30.md.
  const MAIL_TO = 'deine@email.de';

  // ── Datenquellen ──────────────────────────────────────────
  // "kind" bestimmt, wie die rohe JSON-Struktur zu einem flachen
  // Array normalisiert wird (siehe parse-Funktionen unten).
  // "category" wird als internes Feld _category an jeden Command
  // gehaengt (nur fuer Filter/Anzeige in dieser Seite, kein Teil
  // des echten commands.json-Schemas).
  const FILE_DEFS = [
    {
      key: 'commandsWindows',
      url: './data/commands.json',
      label: 'Windows Commands (commands.json)',
      parse: (data) => normalizeWrappedCommands(data, 'windows'),
    },
    {
      key: 'commandsExchange',
      url: './data/exchange-commands.json',
      label: 'Exchange Commands (exchange-commands.json)',
      parse: (data) => normalizeFlatCommands(data, 'exchange'),
    },
    {
      key: 'commandsForti',
      url: './data/forti-commands.json',
      label: 'Fortinet Commands (forti-commands.json)',
      parse: (data) => normalizeFlatCommands(data, 'forti'),
    },
    {
      key: 'guides',
      url: './data/support-guides.json',
      label: 'Support-Guides (support-guides.json)',
      parse: (data) => normalizeGuides(data),
    },
  ];

  const CATEGORY_LABELS = { windows: 'Windows', exchange: 'Exchange', forti: 'Fortinet' };
  const ID_PREFIX       = { windows: 'win', exchange: 'exo', forti: 'forti' };

  const PENDING_KEY = 'mitmachen_pending';
  const AUTHOR_KEY  = 'mitmachen_author';

  let workingCopy = null; // { commandsWindows, commandsExchange, commandsForti, guides, loadedAt }
  let pendingChanges = null; // { newCommands: [...], newGuides: [...], links: [...] } – siehe Prompt 4

  // Rohe, nicht normalisierte JSON.parse()-Ergebnisse der vier Dateien –
  // getrennt von workingCopy gehalten, weil workingCopy._category-Tags
  // pro Command anhaengt (siehe normalizeWrappedCommands/normalizeFlat
  // Commands unten), die es in den echten Dateien nicht gibt. Der
  // baseChecksum muss auf den ECHTEN Dateiinhalten beruhen, sonst passt
  // er nie zu einem kuenftigen Merge-Tool, das dieselben Originaldateien
  // einfach nur neu hochlaedt (siehe js/mitmachen-checksum.js).
  let rawData = emptyRawData();

  function emptyRawData() {
    return { commandsWindows: null, commandsExchange: null, commandsForti: null, guides: null };
  }

  const state = {
    category: '',
    query: '',
  };

  // ── Normalisierung ────────────────────────────────────────
  function normalizeWrappedCommands(data, category) {
    if (!data || !Array.isArray(data.commands)) {
      throw new Error('Erwartete Struktur { commands: [...] } nicht gefunden.');
    }
    return data.commands.map(c => ({ ...c, _category: category }));
  }

  function normalizeFlatCommands(data, category) {
    if (!Array.isArray(data)) {
      throw new Error('Erwartete ein Array von Commands.');
    }
    return data.map(c => ({ ...c, _category: category }));
  }

  function normalizeGuides(data) {
    if (!data || !Array.isArray(data.guides)) {
      throw new Error('Erwartete Struktur { guides: [...] } nicht gefunden.');
    }
    return data.guides;
  }

  // ── sessionStorage: Arbeitskopie ──────────────────────────
  function saveWorkingCopy() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(workingCopy));
    } catch (err) {
      console.warn('mitmachen.js: Arbeitskopie konnte nicht in sessionStorage abgelegt werden.', err);
    }
  }

  function emptyWorkingCopy() {
    return { commandsWindows: [], commandsExchange: [], commandsForti: [], guides: [], loadedAt: null, baseChecksum: null };
  }

  // Pruefwert ueber die vier ROHEN Originaldateien (rawData, nicht die
  // normalisierte workingCopy) – landet in merge-info.json als
  // baseChecksum. Zweck: beim Merge (Prompt 5) erkennen, ob der Kollege
  // auf einem inzwischen veralteten Stand gearbeitet hat. Die eigentliche
  // Hash-Funktion lebt in js/mitmachen-checksum.js (window.MitmachenChecksum),
  // damit ein kuenftiger Merge-Helfer exakt denselben Wert fuer dieselben
  // Dateien berechnet, statt die Funktion ein zweites Mal zu implementieren.
  // Wird nach jedem Laden (fetch ODER manueller Upload) neu berechnet.
  function recomputeBaseChecksum() {
    workingCopy.baseChecksum = window.MitmachenChecksum.computeDatasetsChecksum(rawData);
  }

  // ── sessionStorage: pendingChanges ────────────────────────
  // Getrennt von der Arbeitskopie – neue Commands (und spaeter Guides,
  // Prompt 3) landen NICHT in workingCopy.commandsWindows/.../guides,
  // sondern hier. Erst der Export (Prompt 4) fasst beides zusammen.
  function emptyPendingChanges() {
    return { newCommands: [], newGuides: [], editedGuides: [], links: [] };
  }

  function loadPendingChanges() {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          newCommands:  Array.isArray(parsed.newCommands)  ? parsed.newCommands  : [],
          newGuides:    Array.isArray(parsed.newGuides)    ? parsed.newGuides    : [],
          editedGuides: Array.isArray(parsed.editedGuides) ? parsed.editedGuides : [],
          links:        Array.isArray(parsed.links)        ? parsed.links        : [],
        };
      }
    } catch (err) {
      console.warn('mitmachen.js: pendingChanges konnten nicht gelesen werden.', err);
    }
    return emptyPendingChanges();
  }

  function savePendingChanges() {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingChanges));
    } catch (err) {
      console.warn('mitmachen.js: pendingChanges konnten nicht in sessionStorage abgelegt werden.', err);
    }
  }

  // ── sessionStorage: Autorname ─────────────────────────────
  // Einmalig zu Beginn der Session abgefragt (nicht erst beim Export),
  // damit er hinterher nicht vergessen wird – siehe Konzept "Was noch
  // sinnvoll waere". Das Export-Formular liest denselben Wert vor.
  function loadAuthorName() {
    try {
      return sessionStorage.getItem(AUTHOR_KEY) || '';
    } catch (err) {
      return '';
    }
  }

  function saveAuthorName(name) {
    try {
      sessionStorage.setItem(AUTHOR_KEY, name);
    } catch (err) {
      console.warn('mitmachen.js: Autorname konnte nicht in sessionStorage abgelegt werden.', err);
    }
  }

  function renderAuthorUI() {
    const name = loadAuthorName();
    const banner  = document.getElementById('mm-author-banner');
    const display = document.getElementById('mm-author-display');
    if (name) {
      banner.hidden = true;
      display.hidden = false;
      document.getElementById('mm-author-display-name').textContent = name;
    } else {
      document.getElementById('mm-author-input').value = '';
      banner.hidden = false;
      display.hidden = true;
    }
  }

  function initAuthorPrompt() {
    document.getElementById('mm-author-save').addEventListener('click', () => {
      const name = document.getElementById('mm-author-input').value.trim();
      if (!name) { notify('Bitte einen Namen eintragen.', 'error'); return; }
      saveAuthorName(name);
      renderAuthorUI();
    });
    document.getElementById('mm-author-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('mm-author-save').click();
    });
    document.getElementById('mm-author-change').addEventListener('click', () => {
      document.getElementById('mm-author-input').value = loadAuthorName();
      document.getElementById('mm-author-banner').hidden = false;
      document.getElementById('mm-author-display').hidden = true;
      document.getElementById('mm-author-input').focus();
    });
  }

  // ── Hinweis auf evtl. veralteten Stand ────────────────────
  // Einfacher Vergleich ueber die Gesamtanzahl an Eintraegen zwischen dem
  // sessionStorage-Snapshot von VOR diesem Laden und den frisch geladenen
  // Daten – kein Server-Versioning vorhanden, daher bewusst simpel
  // (siehe Konzept "Was noch sinnvoll waere"). Nur relevant fuer den
  // automatischen Fetch-Weg: bei einem Reload derselben Session koennen
  // sich die Original-Dateien zwischenzeitlich serverseitig geaendert
  // haben, waehrend man selbst noch auf Basis des alten Stands denkt.
  function countWorkingCopyEntries(copy) {
    return (copy?.commandsWindows?.length  || 0) +
           (copy?.commandsExchange?.length || 0) +
           (copy?.commandsForti?.length    || 0) +
           (copy?.guides?.length           || 0);
  }

  function checkForStaleData(previousSnapshotRaw, freshWorkingCopy) {
    if (!previousSnapshotRaw) return; // erster Load dieser Session, nichts zum Vergleichen
    try {
      const previous = JSON.parse(previousSnapshotRaw);
      if (countWorkingCopyEntries(previous) !== countWorkingCopyEntries(freshWorkingCopy)) {
        document.getElementById('mm-stale-warning').hidden = false;
      }
    } catch (err) {
      // Alter Snapshot nicht lesbar – kein Blocker, einfach ignorieren.
    }
  }

  // ── Schritt 1: Weg A (fetch) ──────────────────────────────
  // Gibt sowohl die normalisierte Arbeitskopie-Form (parsed) als auch das
  // unveraenderte JSON.parse()-Ergebnis (raw) zurueck – Letzteres wird
  // ausschliesslich fuer recomputeBaseChecksum() gebraucht (siehe dort).
  async function fetchOneFile(def) {
    const res = await fetch(def.url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    return { raw, parsed: def.parse(raw) };
  }

  async function loadAllViaFetch() {
    const results = await Promise.allSettled(FILE_DEFS.map(fetchOneFile));
    const data = {};
    const raw = {};
    const errors = [];
    results.forEach((r, i) => {
      const def = FILE_DEFS[i];
      if (r.status === 'fulfilled') {
        data[def.key] = r.value.parsed;
        raw[def.key]  = r.value.raw;
      } else {
        data[def.key] = [];
        raw[def.key]  = null;
        errors.push({ key: def.key, label: def.label, message: r.reason?.message || String(r.reason) });
      }
    });
    return { data, raw, errors };
  }

  // ── Schritt 1: Weg B (manueller Upload) ──────────────────
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Datei konnte nicht gelesen werden.'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  function notify(message, type) {
    if (typeof showToast === 'function') showToast(message, type);
  }

  function setFieldError(input, message) {
    clearFieldError(input);
    if (!message) return;
    const field = input.closest('.mm-upload-field');
    if (!field) return;
    const err = document.createElement('span');
    err.className = 'mm-upload-field-error';
    err.textContent = message;
    field.appendChild(err);
  }

  function clearFieldError(input) {
    const field = input.closest('.mm-upload-field');
    if (!field) return;
    field.querySelectorAll('.mm-upload-field-error').forEach(el => el.remove());
  }

  async function applyManualUpload() {
    const inputs = [...document.querySelectorAll('#mm-upload-panel input[type="file"]')];
    let appliedCount = 0;

    for (const input of inputs) {
      const file = input.files && input.files[0];
      if (!file) continue;

      const def = FILE_DEFS.find(d => d.key === input.dataset.uploadKey);
      if (!def) continue;

      try {
        const text = await readFileAsText(file);
        const json = JSON.parse(text);
        const parsed = def.parse(json);
        workingCopy[def.key] = parsed;
        rawData[def.key] = json;
        clearFieldError(input);
        appliedCount++;
      } catch (err) {
        setFieldError(input, err.message || 'Datei konnte nicht gelesen werden.');
      }
    }

    if (appliedCount > 0) {
      workingCopy.loadedAt = new Date().toISOString();
      recomputeBaseChecksum();
      saveWorkingCopy();
      renderAll();
      notify(appliedCount + ' Datei(en) uebernommen.', 'success');
    } else {
      notify('Bitte mindestens eine Datei auswaehlen.', 'error');
    }
  }

  // ── Fehler-Anzeige (pro Datei, blockiert die Seite nicht) ──
  function renderErrors(errors) {
    const box = document.getElementById('mm-errors');
    box.replaceChildren();
    if (!errors.length) { box.hidden = true; return; }

    box.hidden = false;
    errors.forEach(e => {
      const item = document.createElement('div');
      item.className = 'mm-error-item';
      const strong = document.createElement('strong');
      strong.textContent = e.label + ': ';
      item.appendChild(strong);
      item.appendChild(document.createTextNode('konnte nicht automatisch geladen werden (' + e.message + '). Bitte manuell hochladen.'));
      box.appendChild(item);
    });
  }

  // ── Uebersicht: Zaehler ───────────────────────────────────
  function renderCounts() {
    const w = workingCopy.commandsWindows.length;
    const e = workingCopy.commandsExchange.length;
    const f = workingCopy.commandsForti.length;
    const g = workingCopy.guides.length;

    document.getElementById('mm-count-commands').textContent =
      w + ' Windows Commands · ' + e + ' Exchange · ' + f + ' Fortinet';
    document.getElementById('mm-count-guides').textContent =
      g + ' Support-Guides';
  }

  // ── Uebersicht: Liste + Filter ────────────────────────────
  // pendingChanges.newCommands fliesst nur in die ANZEIGE ein (siehe
  // buildRow()'s "noch nicht exportiert"-Hervorhebung) – die Arbeitskopie
  // selbst (workingCopy) bleibt unveraendert, neue Commands werden nicht
  // hineingemischt.
  function allCommands() {
    return [
      ...workingCopy.commandsWindows,
      ...workingCopy.commandsExchange,
      ...workingCopy.commandsForti,
      ...pendingChanges.newCommands,
    ];
  }

  function collectAllKnownIds() {
    const ids = new Set();
    workingCopy.commandsWindows.forEach(c => ids.add(c.id));
    workingCopy.commandsExchange.forEach(c => ids.add(c.id));
    workingCopy.commandsForti.forEach(c => ids.add(c.id));
    pendingChanges.newCommands.forEach(c => ids.add(c.id));
    return ids;
  }

  // Gemeinsame Such-Logik der Uebersicht – auch von der Guide-Auswahl
  // (openGuidePicker) genutzt, damit beide Suchfelder sich identisch
  // verhalten.
  function matchesQuery(cmd, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    return (cmd.name || '').toLowerCase().includes(q) ||
           (cmd.cmd  || '').toLowerCase().includes(q) ||
           (Array.isArray(cmd.tags) && cmd.tags.some(t => (t || '').toLowerCase().includes(q)));
  }

  function applyFilters(commands) {
    let list = commands;

    if (state.category) {
      list = list.filter(c => c._category === state.category);
    }

    if (state.query) {
      list = list.filter(c => matchesQuery(c, state.query));
    }

    return list;
  }

  function truncateCmd(cmd, max) {
    if (!cmd) return '';
    return cmd.length > max ? cmd.slice(0, max) + '…' : cmd;
  }

  // Ein Command hat einen Guide entweder ueber sein echtes guideRef-Feld
  // (bereits im Repo verknuepft) ODER ueber einen frisch in dieser Session
  // angelegten Link (pendingChanges.links, siehe Guide-Formular unten) –
  // Letzteres deckt sowohl neue Commands als auch bestehende Commands ab,
  // die gerade erst einen neuen Guide bekommen haben.
  function hasGuide(cmd, guideIds) {
    if (cmd.guideRef && guideIds.has(cmd.guideRef)) return true;
    return pendingChanges.links.some(l => l.commandId === cmd.id);
  }

  function isPendingChange(cmd) {
    return !!cmd._pending || pendingChanges.links.some(l => l.commandId === cmd.id);
  }

  // Loest den Guide zu einem Command auf, egal ob frisch in dieser Session
  // angelegt (pendingChanges.newGuides, ueber pendingChanges.links verknuepft)
  // oder bereits ausgeliefert (workingCopy.guides, ueber cmd.guideRef) - und
  // bevorzugt dabei eine evtl. bereits in dieser Session vorgenommene
  // Bearbeitung (pendingChanges.editedGuides), damit ein erneutes Oeffnen
  // des Editors den zuletzt gespeicherten Stand zeigt, nicht den Original-
  // inhalt. Ein Command hat in der Praxis nie beides gleichzeitig (der
  // "Guide verfassen"-Button erscheint nur, wenn hasGuide() bereits false
  // war), daher keine Prioritaetsfrage zwischen den beiden Quellen.
  function findGuideForCommand(cmd) {
    const link = pendingChanges.links.find(l => l.commandId === cmd.id);
    if (link) {
      const pendingGuide = pendingChanges.newGuides.find(g => g.id === link.guideId);
      if (pendingGuide) return { guide: pendingGuide, source: 'pending' };
    }
    if (cmd.guideRef) {
      const editedGuide = pendingChanges.editedGuides.find(g => g.id === cmd.guideRef);
      if (editedGuide) return { guide: editedGuide, source: 'existing' };
      const existingGuide = workingCopy.guides.find(g => g.id === cmd.guideRef);
      if (existingGuide) return { guide: existingGuide, source: 'existing' };
    }
    return null;
  }

  function buildRow(cmd, guideIds) {
    const pending = isPendingChange(cmd);
    const row = document.createElement('div');
    row.className = 'mm-row' + (pending ? ' mm-row--pending' : '');

    const dot = document.createElement('span');
    dot.className = 'mm-row-cat mm-row-cat--' + cmd._category;
    dot.title = CATEGORY_LABELS[cmd._category] || cmd._category;

    const name = document.createElement('div');
    name.className = 'mm-row-name';
    name.textContent = cmd.name || '(ohne Namen)';
    name.title = cmd.name || '';

    const cmdEl = document.createElement('code');
    cmdEl.className = 'mm-row-cmd';
    cmdEl.textContent = truncateCmd(cmd.cmd, 64);
    if (cmd.cmd) cmdEl.title = cmd.cmd;

    const badgeGroup = document.createElement('div');
    badgeGroup.className = 'mm-row-badges';

    if (pending) {
      const pendingBadge = document.createElement('span');
      pendingBadge.className = 'mm-pending-badge';
      pendingBadge.textContent = 'noch nicht exportiert';
      badgeGroup.appendChild(pendingBadge);
    }

    const badge = document.createElement('span');
    const has = hasGuide(cmd, guideIds);
    badge.className = 'mm-badge ' + (has ? 'mm-badge--yes' : 'mm-badge--no');
    badge.textContent = has ? '✓ Guide' : '○ kein';
    badgeGroup.appendChild(badge);

    if (has) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'mm-row-guide-edit-btn';
      editBtn.textContent = '✏️ Bearbeiten';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const found = findGuideForCommand(cmd);
        if (found) openGuideFormForEdit(cmd, found.guide, found.source);
      });
      badgeGroup.appendChild(editBtn);
    } else {
      const guideBtn = document.createElement('button');
      guideBtn.type = 'button';
      guideBtn.className = 'mm-row-guide-btn';
      guideBtn.textContent = '📖 Guide verfassen';
      guideBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openGuideForm(cmd);
      });
      badgeGroup.appendChild(guideBtn);
    }

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(cmdEl);
    row.appendChild(badgeGroup);
    return row;
  }

  function guideIdSet() {
    return new Set(workingCopy.guides.map(g => g.id));
  }

  function commandsWithoutGuide() {
    const guideIds = guideIdSet();
    return allCommands().filter(cmd => !hasGuide(cmd, guideIds));
  }

  function renderList() {
    const guideIds = guideIdSet();
    const all = allCommands();
    const filtered = applyFilters(all);

    const list  = document.getElementById('mm-list');
    const empty = document.getElementById('mm-empty');
    const meta  = document.getElementById('mm-list-meta');

    meta.textContent = filtered.length === all.length
      ? filtered.length + ' Befehle'
      : filtered.length + ' von ' + all.length + ' Befehlen';

    list.replaceChildren();

    if (!filtered.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    filtered.forEach(cmd => list.appendChild(buildRow(cmd, guideIds)));
  }

  function updateNewGuideButtonState() {
    const btn = document.getElementById('mm-new-guide');
    const disabled = commandsWithoutGuide().length === 0;
    btn.disabled = disabled;
    btn.title = disabled ? 'Alle Commands haben bereits einen Guide' : '';
  }

  function renderAll() {
    renderCounts();
    renderList();
    updateChangesButtonState();
    updateNewGuideButtonState();
  }

  // ── Guide-Auswahl (oberster "+ Neuer Guide"-Button) ───────
  // Guides sind laut Konzept immer an einen Command gebunden (kein
  // freistehender Guide ohne guideRef). Der Button oeffnet daher ein
  // Auswahl-Fenster ueber alle Commands ohne Guide statt direkt
  // openGuideForm() ohne Ziel-Command aufzurufen.
  const gp = { query: '' };

  function renderGuidePickerList() {
    const list  = document.getElementById('mm-gp-list');
    const empty = document.getElementById('mm-gp-empty');
    list.replaceChildren();

    const candidates = commandsWithoutGuide().filter(cmd => matchesQuery(cmd, gp.query));

    if (!candidates.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    candidates.forEach(cmd => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mm-gp-row';

      const dot = document.createElement('span');
      dot.className = 'mm-row-cat mm-row-cat--' + cmd._category;
      dot.title = CATEGORY_LABELS[cmd._category] || cmd._category;

      const name = document.createElement('span');
      name.className = 'mm-gp-row-name';
      name.textContent = cmd.name || '(ohne Namen)';
      name.title = cmd.name || '';

      const cmdEl = document.createElement('code');
      cmdEl.className = 'mm-gp-row-cmd';
      cmdEl.textContent = truncateCmd(cmd.cmd, 48);
      if (cmd.cmd) cmdEl.title = cmd.cmd;

      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(cmdEl);

      row.addEventListener('click', () => {
        closeGuidePicker();
        openGuideForm(cmd);
      });

      list.appendChild(row);
    });
  }

  function openGuidePicker() {
    gp.query = '';
    document.getElementById('mm-gp-search').value = '';
    renderGuidePickerList();
    document.getElementById('mm-gp-modal').hidden = false;
    document.getElementById('mm-gp-search').focus();
  }

  function closeGuidePicker() {
    document.getElementById('mm-gp-modal').hidden = true;
  }

  function initGuidePicker() {
    document.getElementById('mm-new-guide').addEventListener('click', () => {
      if (commandsWithoutGuide().length === 0) return;
      openGuidePicker();
    });
    document.getElementById('mm-gp-close').addEventListener('click', closeGuidePicker);
    document.getElementById('mm-gp-backdrop').addEventListener('click', closeGuidePicker);

    let searchTimer;
    document.getElementById('mm-gp-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const val = e.target.value;
      searchTimer = setTimeout(() => { gp.query = val.trim(); renderGuidePickerList(); }, 150);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('mm-gp-modal').hidden) closeGuidePicker();
    });
  }

  // ── Upload-Panel oeffnen/schliessen ───────────────────────
  function openUploadPanel() {
    document.getElementById('mm-upload-panel').hidden = false;
  }

  function closeUploadPanel() {
    document.getElementById('mm-upload-panel').hidden = true;
  }

  // ── Toolbar-Events ────────────────────────────────────────
  function initFilterBar() {
    document.getElementById('mm-filter-category').addEventListener('change', (e) => {
      state.category = e.target.value;
      renderList();
    });

    let searchTimer;
    document.getElementById('mm-filter-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const val = e.target.value;
      searchTimer = setTimeout(() => { state.query = val.trim(); renderList(); }, 150);
    });
  }

  function initUploadPanel() {
    document.getElementById('mm-upload-toggle')?.addEventListener('click', openUploadPanel);
    document.getElementById('mm-upload-close')?.addEventListener('click', closeUploadPanel);
    document.getElementById('mm-upload-apply')?.addEventListener('click', applyManualUpload);
  }

  function initStaleWarning() {
    document.getElementById('mm-stale-dismiss')?.addEventListener('click', () => {
      document.getElementById('mm-stale-warning').hidden = true;
    });
  }

  // ── Typ-Auswahl (Befehl / Skript / Feedback) ──────────────
  // Der grosse Befehls-Katalog wird erst beim ersten Klick auf
  // "Befehl einreichen" per init() geladen (befehlLoaded-Flag) - vorher
  // ist bewusst nichts geladen, damit man nicht sofort von der riesigen
  // Liste erschlagen wird.
  let befehlLoaded = false;

  function selectType(type) {
    document.querySelectorAll('.mm-type-card').forEach(c => c.classList.remove('active'));
    document.getElementById('mm-type-' + type)?.classList.add('active');
    document.getElementById('mm-type-hint').hidden = true;

    document.querySelectorAll('.mm-form-section').forEach(s => { s.hidden = true; });
    document.getElementById('mm-form-' + type).hidden = false;

    if (type === 'befehl' && !befehlLoaded) {
      befehlLoaded = true;
      init();
    }
  }

  function initTypeSelector() {
    document.getElementById('mm-type-befehl').addEventListener('click', () => selectType('befehl'));
    document.getElementById('mm-type-skript').addEventListener('click', () => selectType('skript'));
    document.getElementById('mm-type-feedback').addEventListener('click', () => selectType('feedback'));
  }

  // ── Start ─────────────────────────────────────────────────
  function showOverview() {
    document.getElementById('mm-overview').hidden = false;
  }

  function setStatus(text) {
    const status = document.getElementById('mm-status');
    status.hidden = false;
    status.querySelector('.mm-status-text').textContent = text;
  }

  function hideStatus() {
    document.getElementById('mm-status').hidden = true;
  }

  async function init() {
    setStatus('Daten werden geladen …');

    pendingChanges = loadPendingChanges();
    const previousSnapshotRaw = sessionStorage.getItem(SESSION_KEY);

    const { data, raw, errors } = await loadAllViaFetch();
    workingCopy = emptyWorkingCopy();
    workingCopy.commandsWindows  = data.commandsWindows  || [];
    workingCopy.commandsExchange = data.commandsExchange || [];
    workingCopy.commandsForti    = data.commandsForti    || [];
    workingCopy.guides           = data.guides           || [];
    workingCopy.loadedAt         = new Date().toISOString();
    rawData = raw;
    recomputeBaseChecksum();
    checkForStaleData(previousSnapshotRaw, workingCopy);
    saveWorkingCopy();

    hideStatus();
    renderErrors(errors);
    if (errors.length) openUploadPanel();

    showOverview();
    renderAuthorUI();
    renderAll();
  }

  // ============================================================
  // "+ Neuer Command"-Formular (Prompt 2 / Schritt 3)
  // ============================================================

  const cf = {
    guideChoice: 'no',    // 'yes' | 'no'
    selectedTags: new Set(),
    currentId: '',
  };

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function generateCommandId(category, name) {
    const prefix = ID_PREFIX[category] || category;
    const slug = slugify(name).slice(0, 28) || 'command';
    return prefix + '-' + slug;
  }

  function uniqueId(baseId, existingIds) {
    if (!existingIds.has(baseId)) return baseId;
    let i = 2;
    while (existingIds.has(baseId + '-' + i)) i++;
    return baseId + '-' + i;
  }

  // Vorhandene Tags einer Kategorie (aus der Arbeitskopie, nicht neu geladen)
  // – Basis fuer die Tag-Vorschlaege im Formular.
  function tagsForCategory(category) {
    const source = category === 'windows'  ? workingCopy.commandsWindows
                 : category === 'exchange' ? workingCopy.commandsExchange
                 : category === 'forti'    ? workingCopy.commandsForti
                 : [];
    const tags = new Set();
    source.forEach(c => (Array.isArray(c.tags) ? c.tags : []).forEach(t => tags.add(t)));
    return [...tags].sort((a, b) => a.localeCompare(b, 'de'));
  }

  function cfEl(id) { return document.getElementById(id); }

  function resetCommandForm() {
    cfEl('mm-cf-category').value = 'windows';
    cfEl('mm-cf-name').value = '';
    cfEl('mm-cf-cmd').value = '';
    cfEl('mm-cf-desc').value = '';
    cfEl('mm-cf-tag-input').value = '';
    document.querySelectorAll('input[name="mm-cf-risk"]').forEach(r => { r.checked = r.value === 'low'; });
    cf.guideChoice = 'no';
    cf.selectedTags = new Set();
    cf.currentId = '';
    updateGuideToggleUI();
    ['name', 'cmd', 'desc', 'tags'].forEach(clearCfFieldError);
    renderTagSuggestions();
    renderSelectedTags();
    deriveIdFromForm();
    updatePreview();
  }

  function clearCfFieldError(field) {
    const errEl = cfEl('mm-cf-' + field + '-error');
    if (errEl) errEl.textContent = '';
    const inputEl = cfEl('mm-cf-' + field);
    if (inputEl) inputEl.classList.remove('mm-field-input--error');
  }

  function setCfFieldError(field, message) {
    const errEl = cfEl('mm-cf-' + field + '-error');
    if (errEl) errEl.textContent = message;
    const inputEl = cfEl('mm-cf-' + field);
    if (inputEl) inputEl.classList.add('mm-field-input--error');
  }

  function renderTagSuggestions() {
    const container = cfEl('mm-cf-tag-suggestions');
    container.replaceChildren();
    const category = cfEl('mm-cf-category').value;
    tagsForCategory(category).forEach(tag => {
      const label = document.createElement('label');
      label.className = 'mm-tag-chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = cf.selectedTags.has(tag);
      cb.addEventListener('change', () => {
        if (cb.checked) cf.selectedTags.add(tag);
        else cf.selectedTags.delete(tag);
        renderSelectedTags();
        clearCfFieldError('tags');
        updatePreview();
      });
      const span = document.createElement('span');
      span.textContent = tag;
      label.appendChild(cb);
      label.appendChild(span);
      container.appendChild(label);
    });
  }

  // Zeigt ALLE aktuell gewaehlten Tags (egal ob Vorschlag oder selbst
  // eingetippt) als entfernbare Chips – einzige Stelle, an der ein Tag
  // wieder abgewaehlt werden kann, wenn er kein Vorschlag der aktuellen
  // Kategorie (mehr) ist.
  function renderSelectedTags() {
    const container = cfEl('mm-cf-tag-selected');
    container.replaceChildren();
    const suggested = new Set(tagsForCategory(cfEl('mm-cf-category').value));

    [...cf.selectedTags].sort((a, b) => a.localeCompare(b, 'de')).forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'mm-tag-selected-chip';
      const label = document.createElement('span');
      label.textContent = tag;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'mm-tag-selected-remove';
      removeBtn.textContent = '✕';
      removeBtn.setAttribute('aria-label', 'Tag „' + tag + '“ entfernen');
      removeBtn.addEventListener('click', () => {
        cf.selectedTags.delete(tag);
        if (suggested.has(tag)) renderTagSuggestions();
        renderSelectedTags();
        updatePreview();
      });
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  function addCustomTag() {
    const input = cfEl('mm-cf-tag-input');
    const raw = input.value.trim().toLowerCase();
    if (!raw) return;
    cf.selectedTags.add(raw);
    input.value = '';
    clearCfFieldError('tags');
    // Falls der Tag zufaellig bereits ein Vorschlag der Kategorie ist,
    // muss dessen Checkbox ebenfalls den neuen Zustand zeigen.
    renderTagSuggestions();
    renderSelectedTags();
    updatePreview();
  }

  function updateGuideToggleUI() {
    const yesBtn = cfEl('mm-cf-guide-yes');
    const noBtn  = cfEl('mm-cf-guide-no');
    yesBtn.classList.toggle('active', cf.guideChoice === 'yes');
    noBtn.classList.toggle('active', cf.guideChoice === 'no');
    yesBtn.setAttribute('aria-pressed', String(cf.guideChoice === 'yes'));
    noBtn.setAttribute('aria-pressed', String(cf.guideChoice === 'no'));
  }

  function getSelectedRisk() {
    const checked = document.querySelector('input[name="mm-cf-risk"]:checked');
    return checked ? checked.value : 'low';
  }

  function deriveIdFromForm() {
    const category = cfEl('mm-cf-category').value;
    const name = cfEl('mm-cf-name').value;
    cf.currentId = generateCommandId(category, name);
    refreshIdDisplay();
  }

  function refreshIdDisplay() {
    const idDisplay = cfEl('mm-cf-id-display');
    const warning = cfEl('mm-cf-id-warning');
    const suggestionBtn = cfEl('mm-cf-id-suggestion-btn');

    idDisplay.textContent = cf.currentId || '–';

    const existingIds = collectAllKnownIds();
    const isDuplicate = !!cf.currentId && existingIds.has(cf.currentId);
    warning.hidden = !isDuplicate;

    if (isDuplicate) {
      const suggestion = uniqueId(cf.currentId, existingIds);
      suggestionBtn.textContent = 'Vorschlag „' + suggestion + '“ übernehmen';
      suggestionBtn.onclick = () => {
        cf.currentId = suggestion;
        refreshIdDisplay();
      };
    }
  }

  function buildPreviewCommand() {
    const tags = [...cf.selectedTags];
    return {
      id: cf.currentId || 'vorschau',
      name: cfEl('mm-cf-name').value || '(Name)',
      cmd: cfEl('mm-cf-cmd').value || '(Command)',
      desc: cfEl('mm-cf-desc').value || '(Beschreibung)',
      tags,
      risk: getSelectedRisk(),
      guideRef: null,
    };
  }

  // createCommandCard() (js/render.js) haengt Stern-/Kopier-Handler
  // bedingungslos an, weil die Funktion fuer echte, bereits gespeicherte
  // Commands auf windows.html/exchange.html/forti.html gedacht ist. Ein
  // Klick wuerde dort direkt in die echten, seitenuebergreifenden
  // localStorage-Keys schreiben: toggleFavorite() (js/favorites.js) in
  // "adminsheet_favorites", und ein erfolgreicher Copy ueber
  // copyToClipboard()'s onSuccess (js/render.js) via addRecent()
  // (js/recent.js) in "adminsheet_recent_commands" – beide keyed auf
  // cf.currentId, der id einer Vorschau-Karte, die noch gar nicht
  // gespeichert ist.
  //
  // disabled=true allein reicht nicht: es unterbindet echte Klicks und
  // .click(), aber ein direkt dispatchtes MouseEvent('click') erreicht
  // den Listener trotzdem. Deshalb Knoten durch cloneNode(true) ersetzen
  // – das kopiert Attribute/Aussehen, aber nie ueber addEventListener
  // gesetzte Handler. Damit ist gar kein Listener mehr vorhanden, egal
  // wie ein Klick ausgeloest wird. render.js/favorites.js/recent.js
  // selbst bleiben unangetastet.
  function neutralizePreviewButtons(cardFragment) {
    ['[data-action="star"]', '[data-action="copy"]'].forEach(selector => {
      const btn = cardFragment.querySelector(selector);
      if (!btn) return;
      const inert = btn.cloneNode(true);
      inert.disabled = true;
      inert.title = 'Nur Vorschau – erst nach dem Speichern verfügbar';
      btn.replaceWith(inert);
    });
  }

  function updatePreview() {
    const wrap = cfEl('mm-cf-preview-card');
    const template = cfEl('command-template');
    wrap.replaceChildren();
    if (!template || typeof createCommandCard !== 'function') return;
    const card = createCommandCard(template, buildPreviewCommand());
    neutralizePreviewButtons(card);
    wrap.appendChild(card);
  }

  function validateCommandForm() {
    let valid = true;
    const name = cfEl('mm-cf-name').value.trim();
    const cmd  = cfEl('mm-cf-cmd').value.trim();
    const desc = cfEl('mm-cf-desc').value.trim();

    ['name', 'cmd', 'desc', 'tags'].forEach(clearCfFieldError);

    if (!name) { setCfFieldError('name', 'Name ist erforderlich.'); valid = false; }
    if (!cmd)  { setCfFieldError('cmd',  'Command ist erforderlich.'); valid = false; }
    if (!desc) { setCfFieldError('desc', 'Beschreibung ist erforderlich.'); valid = false; }
    if (cf.selectedTags.size === 0) { setCfFieldError('tags', 'Mindestens 1 Tag ist erforderlich.'); valid = false; }

    refreshIdDisplay();
    if (!!cf.currentId && collectAllKnownIds().has(cf.currentId)) {
      notify('Diese Command-ID ist bereits vergeben. Bitte Vorschlag übernehmen oder Namen ändern.', 'error');
      valid = false;
    }

    return valid;
  }

  function saveNewCommand() {
    if (!validateCommandForm()) return;

    const category = cfEl('mm-cf-category').value;
    const newCommand = {
      id: cf.currentId,
      name: cfEl('mm-cf-name').value.trim(),
      cmd: cfEl('mm-cf-cmd').value.trim(),
      desc: cfEl('mm-cf-desc').value.trim(),
      tags: [...cf.selectedTags],
      risk: getSelectedRisk(),
      guideRef: null,
      _category: category,
      _pending: true,
    };

    pendingChanges.newCommands.push(newCommand);
    savePendingChanges();

    closeCommandForm();
    renderAll();
    notify('Command „' + newCommand.name + '“ wurde hinzugefügt (noch nicht exportiert).', 'success');

    // "Direkt einen Guide dazu verfassen? Ja" – Guide-Formular sofort im
    // Anschluss oeffnen, bereits auf den gerade gespeicherten Command
    // gezielt (siehe openGuideForm()).
    if (cf.guideChoice === 'yes') {
      openGuideForm(newCommand);
    }
  }

  function openCommandForm() {
    resetCommandForm();
    cfEl('mm-cf-modal').hidden = false;
  }

  function closeCommandForm() {
    cfEl('mm-cf-modal').hidden = true;
  }

  function initCommandForm() {
    cfEl('mm-new-command').addEventListener('click', openCommandForm);
    cfEl('mm-cf-close').addEventListener('click', closeCommandForm);
    cfEl('mm-cf-cancel').addEventListener('click', closeCommandForm);
    cfEl('mm-cf-backdrop').addEventListener('click', closeCommandForm);
    cfEl('mm-cf-save').addEventListener('click', saveNewCommand);

    cfEl('mm-cf-category').addEventListener('change', () => {
      renderTagSuggestions();
      renderSelectedTags();
      deriveIdFromForm();
      updatePreview();
    });

    cfEl('mm-cf-name').addEventListener('input', () => {
      clearCfFieldError('name');
      deriveIdFromForm();
      updatePreview();
    });

    cfEl('mm-cf-cmd').addEventListener('input', () => {
      clearCfFieldError('cmd');
      updatePreview();
    });

    cfEl('mm-cf-desc').addEventListener('input', () => {
      clearCfFieldError('desc');
      updatePreview();
    });

    document.querySelectorAll('input[name="mm-cf-risk"]').forEach(r => {
      r.addEventListener('change', updatePreview);
    });

    cfEl('mm-cf-tag-add').addEventListener('click', addCustomTag);
    cfEl('mm-cf-tag-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); }
    });

    cfEl('mm-cf-guide-yes').addEventListener('click', () => { cf.guideChoice = 'yes'; updateGuideToggleUI(); });
    cfEl('mm-cf-guide-no').addEventListener('click',  () => { cf.guideChoice = 'no';  updateGuideToggleUI(); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !cfEl('mm-cf-modal').hidden) closeCommandForm();
    });
  }

  // ============================================================
  // "Guide verfassen"-Formular (Prompt 3 / Schritt 4)
  // Editor-Bausteine 1:1 aus guide.sheet uebernommen (siehe
  // js/guides-editor.js: initToolbar, openLinkDialog, openTableDialog,
  // insertWrap, insertRaw, insertChecklist) – schlank ohne GuidesDB/
  // IndexedDB/File-System-Anbindung, kein Bild-Upload, keine Entwuerfe,
  // kein Emoji-Picker. Ergebnis landet nur in pendingChanges.newGuides.
  // ============================================================

  const GUIDE_TEMPLATE =
    '## Was macht der Befehl\n\n' +
    '## Wann verwenden\n\n' +
    '## Parameter die man kennen muss\n\n' +
    '## Häufige Fehler\n\n' +
    '## Praxisbeispiel\n';

  const gf = {
    targetCmd: null, // Command, fuer den dieser Guide verfasst wird
    tags: [],
    currentId: '',
    mode: 'create',        // 'create' | 'edit'
    editingGuideId: null,   // nur in 'edit': ID des bearbeiteten Guides
    editingSource: null,    // nur in 'edit': 'pending' | 'existing'
  };

  function gfEl(id) { return document.getElementById(id); }

  // ── Cursor-Helfer fuer die Toolbar (1:1 aus guides-editor.js,
  // generisch ueber "ta" – kein Bezug zu einem bestimmten Formular) ──
  function insertWrap(ta, before, after, placeholder) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const value = ta.value;
    const selected = value.slice(start, end) || placeholder || '';
    ta.value = value.slice(0, start) + before + selected + (after || '') + value.slice(end);
    ta.focus();
    ta.setSelectionRange(start + before.length, start + before.length + selected.length);
    ta.dispatchEvent(new Event('input'));
  }

  function insertRaw(ta, text) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const value = ta.value;
    ta.value = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event('input'));
  }

  function insertChecklist(ta) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const value = ta.value;
    const selected = value.slice(start, end);
    const inserted = selected
      ? selected.split('\n').map(line => line ? '- [ ] ' + line : line).join('\n')
      : '- [ ] Aufgabe';
    ta.value = value.slice(0, start) + inserted + value.slice(end);
    ta.focus();
    ta.setSelectionRange(start, start + inserted.length);
    ta.dispatchEvent(new Event('input'));
  }

  // ── Kategorien (aus Arbeitskopie + bereits pendenten neuen Guides) ──
  function guideCategories() {
    const cats = new Set();
    workingCopy.guides.forEach(g => { if (g.category) cats.add(g.category); });
    pendingChanges.newGuides.forEach(g => { if (g.category) cats.add(g.category); });
    if (!cats.size) cats.add('Support');
    return [...cats].sort((a, b) => a.localeCompare(b, 'de'));
  }

  function renderGuideCategorySelect() {
    const sel = gfEl('mm-gf-category');
    sel.replaceChildren();
    const cats = guideCategories();
    cats.forEach(cat => {
      const o = document.createElement('option');
      o.value = cat;
      o.textContent = cat;
      sel.appendChild(o);
    });
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '+ Neue Kategorie…';
    sel.appendChild(customOpt);
    sel.value = cats.includes('Support') ? 'Support' : cats[0];
  }

  function getSelectedGuideCategory() {
    const sel = gfEl('mm-gf-category').value;
    if (sel === '__custom__') {
      return gfEl('mm-gf-category-custom').value.trim() || 'Support';
    }
    return sel;
  }

  // ── Tags (Pill-UI 1:1 aus guides-editor.js, ohne Status-Vorschlaege) ──
  function renderGuideTagPills() {
    const container = gfEl('mm-gf-tags-pills');
    container.replaceChildren();
    gf.tags.forEach((tag, i) => {
      const pill = document.createElement('span');
      pill.className = 'ge-tag-pill';
      pill.textContent = tag;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ge-tag-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Tag entfernen');
      remove.addEventListener('click', () => { gf.tags.splice(i, 1); renderGuideTagPills(); });
      pill.appendChild(remove);
      container.appendChild(pill);
    });
  }

  function commitGuideTag(raw) {
    const val = raw.trim();
    if (val && !gf.tags.includes(val)) gf.tags.push(val);
  }

  function commitGuideTagFromInput() {
    const input = gfEl('mm-gf-tag-input');
    if (!input.value.trim()) return;
    commitGuideTag(input.value);
    input.value = '';
    renderGuideTagPills();
  }

  // ── Guide-ID: "support-{command-name-slug}", einmalig beim Oeffnen
  // aus dem Ziel-Command abgeleitet (nicht reaktiv auf den Titel, der
  // frei formuliert sein darf) – mit derselben Duplikat-Vorschlag-Logik
  // wie beim Command-Formular (uniqueId() ist dafuer bereits generisch). ──
  function generateGuideId(commandName) {
    return 'support-' + (slugify(commandName).slice(0, 40) || 'guide');
  }

  function collectAllKnownGuideIds() {
    const ids = new Set();
    workingCopy.guides.forEach(g => ids.add(g.id));
    pendingChanges.newGuides.forEach(g => ids.add(g.id));
    return ids;
  }

  function deriveGuideIdFromTarget() {
    gf.currentId = generateGuideId(gf.targetCmd.name || gf.targetCmd.id);
    refreshGuideIdDisplay();
  }

  function refreshGuideIdDisplay() {
    const idDisplay = gfEl('mm-gf-id-display');
    const warning = gfEl('mm-gf-id-warning');
    idDisplay.textContent = gf.currentId || '–';

    // Beim Bearbeiten ist die ID die des Guides selbst - kein Duplikat.
    if (gf.mode === 'edit') {
      warning.hidden = true;
      return;
    }

    const existingIds = collectAllKnownGuideIds();
    const isDuplicate = !!gf.currentId && existingIds.has(gf.currentId);
    warning.hidden = !isDuplicate;

    if (isDuplicate) {
      const suggestion = uniqueId(gf.currentId, existingIds);
      const suggestionBtn = gfEl('mm-gf-id-suggestion-btn');
      suggestionBtn.textContent = 'Vorschlag „' + suggestion + '“ übernehmen';
      suggestionBtn.onclick = () => {
        gf.currentId = suggestion;
        refreshGuideIdDisplay();
      };
    }
  }

  // ── Link-Dialog (1:1 aus guides-editor.js, Ziel-Textarea fest auf
  // das Guide-Formular bezogen – es gibt in mitmachen.html nur einen
  // Editor gleichzeitig) ──
  let _linkCursorStart = 0;
  let _linkCursorEnd = 0;

  function openGuideLinkDialog() {
    const ta = gfEl('mm-gf-textarea');
    _linkCursorStart = ta.selectionStart;
    _linkCursorEnd = ta.selectionEnd;
    const selected = ta.value.slice(_linkCursorStart, _linkCursorEnd);
    gfEl('link-dialog-text').value = selected || '';
    gfEl('link-dialog-url').value = '';
    gfEl('link-dialog').hidden = false;
    if (!gfEl('link-dialog-text').value) gfEl('link-dialog-text').focus();
    else gfEl('link-dialog-url').focus();
  }

  function closeGuideLinkDialog() {
    gfEl('link-dialog').hidden = true;
    gfEl('mm-gf-textarea').focus();
  }

  function insertGuideLink() {
    const text = gfEl('link-dialog-text').value.trim();
    const url  = gfEl('link-dialog-url').value.trim();
    if (!url) return;
    const linkText = text || url;
    const markdown = '[' + linkText + '](' + url + ')';
    const ta = gfEl('mm-gf-textarea');
    const before = ta.value.slice(0, _linkCursorStart);
    const after  = ta.value.slice(_linkCursorEnd);
    ta.value = before + markdown + after;
    const newPos = _linkCursorStart + markdown.length;
    ta.setSelectionRange(newPos, newPos);
    ta.dispatchEvent(new Event('input'));
    ta.focus();
    closeGuideLinkDialog();
  }

  function initGuideLinkDialog() {
    gfEl('link-dialog-close')?.addEventListener('click', closeGuideLinkDialog);
    gfEl('link-dialog-cancel')?.addEventListener('click', closeGuideLinkDialog);
    gfEl('link-dialog-ok')?.addEventListener('click', insertGuideLink);
    document.querySelector('#link-dialog .link-dialog-backdrop')?.addEventListener('click', closeGuideLinkDialog);
    gfEl('link-dialog-url')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') insertGuideLink();
      if (e.key === 'Escape') closeGuideLinkDialog();
    });
    gfEl('link-dialog-text')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); gfEl('link-dialog-url')?.focus(); }
      if (e.key === 'Escape') closeGuideLinkDialog();
    });
  }

  // ── Tabellen-Dialog (1:1 aus guides-editor.js) ──
  function openGuideTableDialog() {
    gfEl('table-dialog').hidden = false;
    gfEl('table-cols').focus();
  }

  function closeGuideTableDialog() {
    gfEl('table-dialog').hidden = true;
    gfEl('mm-gf-textarea').focus();
  }

  function insertGuideTable() {
    const cols   = parseInt(gfEl('table-cols').value) || 2;
    const rows   = parseInt(gfEl('table-rows').value) || 3;
    const header = gfEl('table-header').value || 'Spalte';
    const headers = Array.from({ length: cols }, (_, i) => ` ${header} ${i + 1} `).join('|');
    const divider = Array.from({ length: cols }, () => '----------').join('|');
    const row     = Array.from({ length: cols }, () => ' Wert ').join('|');
    const rowsStr = Array.from({ length: rows }, () => `|${row}|`).join('\n');
    const table = `\n|${headers}|\n|${divider}|\n${rowsStr}\n`;
    insertRaw(gfEl('mm-gf-textarea'), table);
    closeGuideTableDialog();
  }

  function initGuideTableDialog() {
    gfEl('table-dialog-close')?.addEventListener('click', closeGuideTableDialog);
    gfEl('table-dialog-cancel')?.addEventListener('click', closeGuideTableDialog);
    gfEl('table-dialog-ok')?.addEventListener('click', insertGuideTable);
    document.querySelector('#table-dialog .link-dialog-backdrop')?.addEventListener('click', closeGuideTableDialog);
  }

  // ── Toolbar (1:1 aus guides-editor.js's initToolbar, ohne Bild/
  // Ausrichtung/Emoji – kein Asset-Speicher in diesem schlanken Editor) ──
  function initGuideToolbar() {
    document.querySelectorAll('#mm-gf-toolbar button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ta = gfEl('mm-gf-textarea');
        switch (btn.dataset.action) {
          case 'h1':         insertWrap(ta, '# ', '', 'Überschrift'); break;
          case 'h2':         insertWrap(ta, '## ', '', 'Überschrift'); break;
          case 'h3':         insertWrap(ta, '### ', '', 'Überschrift'); break;
          case 'bullet':     insertRaw(ta, '\n- '); break;
          case 'ordered':    insertRaw(ta, '\n1. '); break;
          case 'bold':       insertWrap(ta, '**', '**', 'fett'); break;
          case 'italic':     insertWrap(ta, '*', '*', 'kursiv'); break;
          case 'code':       insertWrap(ta, '`', '`', 'code'); break;
          case 'codeblock':  insertWrap(ta, '\n```\n', '\n```\n', 'code'); break;
          case 'powershell': insertRaw(ta, '\n| PowerShell |\n|---|\n| # Kommentar |\n| `Befehl` |\n'); break;
          case 'cmd':        insertRaw(ta, '\n| CMD |\n|---|\n| # Kommentar |\n| `Befehl` |\n'); break;
          case 'link':       openGuideLinkDialog(); break;
          case 'table':      openGuideTableDialog(); break;
          case 'checklist':  insertChecklist(ta); break;
        }
      });
    });
  }

  function initGuideViewToggle() {
    const buttons = document.querySelectorAll('#mm-gf-view-toggle .gg-view-btn');
    const wrap = gfEl('mm-gf-editor-wrap');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        wrap.dataset.mode = btn.dataset.mode;
      });
    });
  }

  // ── Live-Vorschau ──
  function updateGuidePreview() {
    const md = gfEl('mm-gf-textarea').value;
    const preview = gfEl('mm-gf-preview');
    if (typeof marked !== 'undefined') {
      preview.innerHTML = marked.parse(md);
    } else {
      preview.textContent = md;
    }
  }

  function initGuideLivePreview() {
    let timer;
    gfEl('mm-gf-textarea').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(updateGuidePreview, 200);
    });
  }

  // ── Validierung + Speichern ──
  function clearGfFieldError(field) {
    const errEl = gfEl('mm-gf-' + field + '-error');
    if (errEl) errEl.textContent = '';
    const inputEl = gfEl(field === 'content' ? 'mm-gf-textarea' : 'mm-gf-' + field);
    if (inputEl) inputEl.classList.remove('mm-field-input--error');
  }

  function setGfFieldError(field, message) {
    const errEl = gfEl('mm-gf-' + field + '-error');
    if (errEl) errEl.textContent = message;
    const inputEl = gfEl(field === 'content' ? 'mm-gf-textarea' : 'mm-gf-' + field);
    if (inputEl) inputEl.classList.add('mm-field-input--error');
  }

  // Trennt den Inhalt an Ueberschriften-Zeilen (# bis ######) auf und trimmt
  // jeden Abschnitt einzeln. So zaehlt reiner Text vor der ersten Ueberschrift
  // ebenfalls als eigener Abschnitt. Verhindert, dass das leere
  // GUIDE_TEMPLATE-Geruest (nur Ueberschriften) die Mindestlaenge erfuellt,
  // ohne dass irgendwo tatsaechlich Text steht.
  function contentSections(content) {
    const sections = [];
    let current = [];
    content.split('\n').forEach(line => {
      if (/^#{1,6}\s+/.test(line)) {
        sections.push(current.join('\n').trim());
        current = [];
      } else {
        current.push(line);
      }
    });
    sections.push(current.join('\n').trim());
    return sections;
  }

  const MIN_SECTION_LENGTH = 20;

  function validateGuideForm() {
    let valid = true;
    const title = gfEl('mm-gf-title').value.trim();
    const content = gfEl('mm-gf-textarea').value;

    ['title', 'content'].forEach(clearGfFieldError);

    if (!title) { setGfFieldError('title', 'Titel ist erforderlich.'); valid = false; }

    const contentErrors = [];
    const hasFilledSection = contentSections(content).some(s => s.length >= MIN_SECTION_LENGTH);
    if (!hasFilledSection) {
      contentErrors.push('Bitte mindestens einen Abschnitt ausfüllen (mindestens ' + MIN_SECTION_LENGTH + ' Zeichen Text unter einer Überschrift).');
    }
    const fenceCount = (content.match(/```/g) || []).length;
    if (fenceCount % 2 !== 0) {
      contentErrors.push('Unvollständiger Code-Block: ungerade Anzahl von ``` gefunden.');
    }
    if (contentErrors.length) { setGfFieldError('content', contentErrors.join(' ')); valid = false; }

    return valid;
  }

  function saveNewGuide() {
    if (!validateGuideForm()) return;

    const nowIso = new Date().toISOString();
    const newGuide = {
      id: gf.currentId,
      title: gfEl('mm-gf-title').value.trim(),
      category: getSelectedGuideCategory(),
      subcategory: '',
      tags: [...gf.tags],
      type: 'guide',
      created: nowIso,
      modified: nowIso,
      favorite: false,
      readonly: false,
      source: 'mitmachen',
      links: [],
      content: gfEl('mm-gf-textarea').value,
    };

    pendingChanges.newGuides.push(newGuide);
    pendingChanges.links.push({ commandId: gf.targetCmd.id, guideId: newGuide.id });
    savePendingChanges();

    closeGuideForm();
    renderAll();
    notify('Guide „' + newGuide.title + '“ wurde hinzugefügt (noch nicht exportiert) und mit „' + gf.targetCmd.name + '“ verknüpft.', 'success');
  }

  // Bearbeitung eines bereits bestehenden Guides (frisch angelegt in dieser
  // Session ODER bereits ausgeliefert). ID bleibt in jedem Fall fest - siehe
  // refreshGuideIdDisplay()'s Sonderfall fuer gf.mode === 'edit'.
  function saveEditedGuide() {
    if (!validateGuideForm()) return;

    const updatedFields = {
      title: gfEl('mm-gf-title').value.trim(),
      category: getSelectedGuideCategory(),
      tags: [...gf.tags],
      content: gfEl('mm-gf-textarea').value,
      modified: new Date().toISOString(),
    };

    if (gf.editingSource === 'pending') {
      const idx = pendingChanges.newGuides.findIndex(g => g.id === gf.editingGuideId);
      if (idx !== -1) {
        pendingChanges.newGuides[idx] = { ...pendingChanges.newGuides[idx], ...updatedFields };
      }
    } else {
      // 'existing' - bereits ausgelieferter Guide (support-guides.json).
      // workingCopy.guides bleibt unangetastet (repraesentiert immer den
      // echten Original-Stand), die Bearbeitung wird separat in
      // pendingChanges.editedGuides verfolgt und beim Export als eigene
      // Datei mitgeschickt (siehe js/mitmachen-export.js).
      const alreadyEditedIdx = pendingChanges.editedGuides.findIndex(g => g.id === gf.editingGuideId);
      const base = alreadyEditedIdx !== -1
        ? pendingChanges.editedGuides[alreadyEditedIdx]
        : workingCopy.guides.find(g => g.id === gf.editingGuideId);
      const updatedGuide = { ...base, ...updatedFields };

      if (alreadyEditedIdx !== -1) {
        pendingChanges.editedGuides[alreadyEditedIdx] = updatedGuide;
      } else {
        pendingChanges.editedGuides.push(updatedGuide);
      }
    }

    savePendingChanges();
    closeGuideForm();
    renderAll();
    notify('Guide „' + updatedFields.title + '“ wurde aktualisiert (noch nicht exportiert).', 'success');
  }

  function handleGuideFormSave() {
    if (gf.mode === 'edit') saveEditedGuide();
    else saveNewGuide();
  }

  // Modal-Titel + Speichern-Button je nach Modus - reine Textanpassung,
  // keine Strukturaenderung.
  function updateGuideFormModeUI() {
    const isEdit = gf.mode === 'edit';
    gfEl('mm-gf-title-heading').textContent = isEdit ? 'Guide bearbeiten' : 'Guide verfassen';
    gfEl('mm-gf-save').textContent = isEdit ? 'Änderungen speichern' : 'Guide speichern';
  }

  // ── Oeffnen/Schliessen ──
  function resetGuideForm(targetCmd) {
    gf.targetCmd = targetCmd;
    gf.tags = [];
    gf.mode = 'create';
    gf.editingGuideId = null;
    gf.editingSource = null;

    gfEl('mm-gf-context').textContent = 'Für: ' + (targetCmd.name || targetCmd.id);
    gfEl('mm-gf-title').value = targetCmd.name || '';
    renderGuideCategorySelect();
    gfEl('mm-gf-category-custom').hidden = true;
    gfEl('mm-gf-category-custom').value = '';
    gfEl('mm-gf-tag-input').value = '';
    renderGuideTagPills();
    gfEl('mm-gf-textarea').value = GUIDE_TEMPLATE;
    ['title', 'content'].forEach(clearGfFieldError);
    deriveGuideIdFromTarget();
    updateGuidePreview();
    updateGuideFormModeUI();

    const viewButtons = document.querySelectorAll('#mm-gf-view-toggle .gg-view-btn');
    viewButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === 'split'));
    gfEl('mm-gf-editor-wrap').dataset.mode = 'split';
  }

  // Oeffnet denselben Editor, aber vorbefuellt mit dem Inhalt eines bereits
  // bestehenden Guides (source: 'pending' fuer noch nicht exportierte, neu
  // in dieser Session angelegte Guides, 'existing' fuer bereits ausgelieferte
  // aus support-guides.json). Aufgerufen ueber den "✏️ Bearbeiten"-Button in
  // buildRow() (siehe findGuideForCommand()).
  function openGuideFormForEdit(targetCmd, guide, source) {
    gf.targetCmd = targetCmd;
    gf.tags = Array.isArray(guide.tags) ? [...guide.tags] : [];
    gf.mode = 'edit';
    gf.editingGuideId = guide.id;
    gf.editingSource = source;
    gf.currentId = guide.id;

    gfEl('mm-gf-context').textContent = 'Für: ' + (targetCmd.name || targetCmd.id);
    gfEl('mm-gf-title').value = guide.title || '';
    renderGuideCategorySelect();
    gfEl('mm-gf-category-custom').hidden = true;
    gfEl('mm-gf-category-custom').value = '';
    gfEl('mm-gf-category').value = guide.category || 'Support';
    gfEl('mm-gf-tag-input').value = '';
    renderGuideTagPills();
    gfEl('mm-gf-textarea').value = guide.content || '';
    ['title', 'content'].forEach(clearGfFieldError);
    refreshGuideIdDisplay();
    updateGuidePreview();
    updateGuideFormModeUI();

    const viewButtons = document.querySelectorAll('#mm-gf-view-toggle .gg-view-btn');
    viewButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === 'split'));
    gfEl('mm-gf-editor-wrap').dataset.mode = 'split';

    gfEl('mm-gf-modal').hidden = false;
  }

  function openGuideForm(targetCmd) {
    resetGuideForm(targetCmd);
    gfEl('mm-gf-modal').hidden = false;
  }

  function closeGuideForm() {
    gfEl('mm-gf-modal').hidden = true;
  }

  function initGuideForm() {
    gfEl('mm-gf-close').addEventListener('click', closeGuideForm);
    gfEl('mm-gf-cancel').addEventListener('click', closeGuideForm);
    gfEl('mm-gf-backdrop').addEventListener('click', closeGuideForm);
    gfEl('mm-gf-save').addEventListener('click', handleGuideFormSave);

    gfEl('mm-gf-title').addEventListener('input', () => clearGfFieldError('title'));

    gfEl('mm-gf-category').addEventListener('change', () => {
      const isCustom = gfEl('mm-gf-category').value === '__custom__';
      gfEl('mm-gf-category-custom').hidden = !isCustom;
      if (isCustom) gfEl('mm-gf-category-custom').focus();
    });

    gfEl('mm-gf-tag-input').addEventListener('input', () => {
      const input = gfEl('mm-gf-tag-input');
      if (input.value.includes(',')) {
        const parts = input.value.split(',');
        const last = parts.pop();
        parts.forEach(commitGuideTag);
        input.value = last;
        renderGuideTagPills();
      }
    });
    gfEl('mm-gf-tag-input').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      commitGuideTagFromInput();
    });
    gfEl('mm-gf-tag-input').addEventListener('blur', commitGuideTagFromInput);
    gfEl('mm-gf-tag-add-btn').addEventListener('click', commitGuideTagFromInput);

    initGuideToolbar();
    initGuideLinkDialog();
    initGuideTableDialog();
    initGuideViewToggle();
    initGuideLivePreview();
    gfEl('mm-gf-textarea').addEventListener('input', () => clearGfFieldError('content'));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !gfEl('mm-gf-modal').hidden) closeGuideForm();
    });
  }

  // ============================================================
  // "Meine Änderungen ansehen" + Export (Prompt 4 / Schritt 5+6)
  // ============================================================

  function chEl(id) { return document.getElementById(id); }

  function updateChangesButtonState() {
    const btn = chEl('mm-changes-btn');
    const empty = !pendingChanges.newCommands.length && !pendingChanges.newGuides.length &&
      !pendingChanges.editedGuides.length && !pendingChanges.links.length;
    btn.disabled = empty;
  }

  // Ein commandId in einer Verknuepfung kann entweder auf einen frisch in
  // dieser Session angelegten Command zeigen (pendingChanges.newCommands)
  // oder auf einen bereits bestehenden, echten Command (workingCopy) –
  // je nachdem ob "Guide verfassen" nach "Ja" oder ueber den Listen-Button
  // ausgeloest wurde. Fuer die Anzeige wird der Name aufgeloest, sonst
  // bleibt die rohe ID stehen.
  function resolveCommandLabel(commandId) {
    const pending = pendingChanges.newCommands.find(c => c.id === commandId);
    if (pending) return pending.name;
    const all = [...workingCopy.commandsWindows, ...workingCopy.commandsExchange, ...workingCopy.commandsForti];
    const existing = all.find(c => c.id === commandId);
    return existing ? existing.name : commandId;
  }

  function renderChangesList(listId, emptyId, items, buildLabel, onRemove) {
    const list = chEl(listId);
    const empty = chEl(emptyId);
    list.replaceChildren();

    if (!items.length) { empty.hidden = false; return; }
    empty.hidden = true;

    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'mm-changes-row';
      row.appendChild(buildLabel(item));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'mm-changes-remove-btn';
      removeBtn.textContent = '🗑️';
      removeBtn.setAttribute('aria-label', 'Eintrag entfernen');
      removeBtn.addEventListener('click', () => onRemove(index));
      row.appendChild(removeBtn);

      list.appendChild(row);
    });
  }

  function renderChangesModal() {
    renderChangesList('mm-changes-commands', 'mm-changes-commands-empty', pendingChanges.newCommands, (cmd) => {
      const label = document.createElement('div');
      label.className = 'mm-changes-row-label';
      const name = document.createElement('span');
      name.className = 'mm-changes-row-name';
      name.textContent = cmd.name;
      const cmdCode = document.createElement('code');
      cmdCode.className = 'mm-changes-row-cmd';
      cmdCode.textContent = truncateCmd(cmd.cmd, 50);
      label.appendChild(name);
      label.appendChild(cmdCode);
      return label;
    }, removeNewCommand);

    renderChangesList('mm-changes-guides', 'mm-changes-guides-empty', pendingChanges.newGuides, (guide) => {
      const label = document.createElement('span');
      label.className = 'mm-changes-row-name';
      label.textContent = guide.title;
      return label;
    }, removeNewGuide);

    renderChangesList('mm-changes-edited-guides', 'mm-changes-edited-guides-empty', pendingChanges.editedGuides, (guide) => {
      const label = document.createElement('span');
      label.className = 'mm-changes-row-name';
      label.textContent = guide.title;
      return label;
    }, removeEditedGuide);

    renderChangesList('mm-changes-links', 'mm-changes-links-empty', pendingChanges.links, (link) => {
      const label = document.createElement('span');
      label.className = 'mm-changes-row-name';
      label.textContent = resolveCommandLabel(link.commandId) + ' → ' + link.guideId;
      return label;
    }, removeLink);

    updateChangesButtonState();
  }

  // Beim Entfernen eines neuen Commands/Guides werden Verknuepfungen, die
  // darauf zeigen, automatisch mitentfernt – sonst bliebe eine Verknuepfung
  // auf eine ID zurueck, die im Export nirgends mehr auftaucht (verwaiste
  // Referenz, die den Merge in Prompt 5 verwirren wuerde). Das Entfernen
  // einer Verknuepfung selbst loescht dagegen nie den Command oder Guide.
  function removeNewCommand(index) {
    const removed = pendingChanges.newCommands[index];
    pendingChanges.newCommands.splice(index, 1);
    pendingChanges.links = pendingChanges.links.filter(l => l.commandId !== removed.id);
    savePendingChanges();
    renderChangesModal();
    renderAll();
  }

  function removeNewGuide(index) {
    const removed = pendingChanges.newGuides[index];
    pendingChanges.newGuides.splice(index, 1);
    pendingChanges.links = pendingChanges.links.filter(l => l.guideId !== removed.id);
    savePendingChanges();
    renderChangesModal();
    renderAll();
  }

  // Das Entfernen einer Bearbeitung wirft nur die pending-Aenderung weg –
  // der Original-Guide in workingCopy.guides wurde nie angefasst.
  function removeEditedGuide(index) {
    pendingChanges.editedGuides.splice(index, 1);
    savePendingChanges();
    renderChangesModal();
    renderAll();
  }

  function removeLink(index) {
    pendingChanges.links.splice(index, 1);
    savePendingChanges();
    renderChangesModal();
    renderAll();
  }

  function setExportNameError(message) {
    chEl('mm-export-name-error').textContent = message;
    chEl('mm-export-name').classList.add('mm-field-input--error');
  }

  function clearExportNameError() {
    chEl('mm-export-name-error').textContent = '';
    chEl('mm-export-name').classList.remove('mm-field-input--error');
  }

  async function handleExport() {
    const name = chEl('mm-export-name').value.trim();
    clearExportNameError();
    if (!name) {
      setExportNameError('Bitte deinen Namen eintragen.');
      return;
    }

    try {
      await window.MitmachenExport.buildAndDownload({
        pendingChanges,
        baseChecksum: workingCopy.baseChecksum,
        exportedBy: name,
      });
      saveAuthorName(name);
      renderAuthorUI();
      chEl('mm-changes-export').hidden = true;
      chEl('mm-export-success').hidden = false;
      notify('Export heruntergeladen.', 'success');
    } catch (err) {
      notify('Export fehlgeschlagen: ' + (err.message || err), 'error');
    }
  }

  function clearAllPendingChanges() {
    pendingChanges = emptyPendingChanges();
    savePendingChanges();
    closeChangesModal();
    renderAll();
    notify('Änderungen wurden geleert.', 'success');
  }

  function openChangesModal() {
    chEl('mm-export-name').value = loadAuthorName();
    clearExportNameError();
    chEl('mm-changes-export').hidden = false;
    chEl('mm-export-success').hidden = true;
    renderChangesModal();
    chEl('mm-changes-modal').hidden = false;
  }

  function closeChangesModal() {
    chEl('mm-changes-modal').hidden = true;
  }

  function initChangesModal() {
    chEl('mm-changes-btn').addEventListener('click', openChangesModal);
    chEl('mm-changes-close').addEventListener('click', closeChangesModal);
    chEl('mm-changes-close-footer').addEventListener('click', closeChangesModal);
    chEl('mm-changes-backdrop').addEventListener('click', closeChangesModal);

    chEl('mm-export-name').addEventListener('input', clearExportNameError);
    chEl('mm-export-btn').addEventListener('click', handleExport);
    chEl('mm-export-keep').addEventListener('click', closeChangesModal);
    chEl('mm-export-clear').addEventListener('click', clearAllPendingChanges);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !chEl('mm-changes-modal').hidden) closeChangesModal();
    });
  }

  // ============================================================
  // "Skript einreichen" – unveraendert aus der alten mitmachen.html
  // uebernommen (reines Mailto-Formular, keine Kategorien-Fetch noetig,
  // die Kategorien-Liste im Select ist statisch wie in scripts.html).
  // ============================================================
  const SKRIPT_CAT_LABELS = {
    system: 'System', network: 'Netzwerk', security: 'Sicherheit',
    inventory: 'Inventar', eventlog: 'Event Log', exchange: 'Exchange',
  };

  function sEl(id) { return document.getElementById(id); }

  function updatePreviewScript() {
    const title    = sEl('mm-s-title').value.trim()    || 'Script-Name';
    const subtitle = sEl('mm-s-subtitle').value.trim() || 'Kurzbeschreibung';
    const cat      = sEl('mm-s-cat').value             || 'system';
    const desc     = sEl('mm-s-desc').value.trim()     || 'Beschreibung';
    const req      = sEl('mm-s-req').value.trim()      || 'PowerShell 5.1+';

    const usageRaw = sEl('mm-s-usage').value || '';
    const usage = usageRaw.split('\n').filter(l => l.trim())
      .map(l => `    { "label": "Beispiel", "cmd": "${l.trim().replace(/"/g, '\\"')}" }`)
      .join(',\n');

    const slug = title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

    sEl('mm-s-preview').textContent =
`// In scripts.html einfügen:
{
  "id": "${slug}",
  "title": "${title}",
  "file": "powershell/${title}.ps1",
  "category": "${cat}",
  "subtitle": "${subtitle.replace(/"/g, '\\"')}",
  "desc": "${desc.replace(/"/g, '\\"').replace(/\n/g, ' ')}",
  "requirements": "${req}",
  "usage": [
${usage || '    { "label": "Beispiel", "cmd": ".\\\\' + title + '.ps1" }'}
  ]
}`;
  }

  function copyPreviewScript() {
    const txt = sEl('mm-s-preview').textContent;
    if (txt.startsWith('//') && txt.includes('Formular')) return;
    navigator.clipboard.writeText(txt).then(() => notify('Vorschau kopiert.', 'success'));
  }

  function submitSkript() {
    const name  = sEl('mm-s-name').value.trim();
    const title = sEl('mm-s-title').value.trim();
    const desc  = sEl('mm-s-desc').value.trim();
    const code  = sEl('mm-s-code').value.trim();
    const json  = sEl('mm-s-preview').textContent;

    if (!name || !title || !desc || !code) {
      notify('Bitte alle Pflichtfelder (*) ausfüllen.', 'error');
      return;
    }

    const subject = encodeURIComponent(`[support.sheet] Neues Skript: ${title}`);
    const body = encodeURIComponent(
`Hallo,

ich möchte folgendes Skript einreichen:

──────────────────────────────
VON: ${name}
──────────────────────────────

${json}

──────────────────────────────
SCRIPT-CODE:
──────────────────────────────
${code}

Viele Grüße
${name}`);

    window.location.href = `mailto:${MAIL_TO}?subject=${subject}&body=${body}`;
    notify('Mail-Client geöffnet! Bitte die vorausgefüllte Mail absenden.', 'success');
  }

  function initSkriptForm() {
    ['mm-s-title', 'mm-s-subtitle', 'mm-s-desc', 'mm-s-usage', 'mm-s-params', 'mm-s-req'].forEach(id => {
      sEl(id).addEventListener('input', updatePreviewScript);
    });
    sEl('mm-s-cat').addEventListener('change', updatePreviewScript);
    sEl('mm-s-copy').addEventListener('click', copyPreviewScript);
    sEl('mm-s-submit').addEventListener('click', submitSkript);
  }

  // ============================================================
  // "Feedback & Fehler" – unveraendert aus der alten mitmachen.html
  // uebernommen (reines Mailto-Formular).
  // ============================================================
  const FEEDBACK_SUBJECTS = {
    bug: '[support.sheet] Bug: ',
    feature: '[support.sheet] Feature-Wunsch: ',
    beschreibung: '[support.sheet] Beschreibung verbessern: ',
  };

  function openFeedback(type) {
    document.querySelectorAll('.mm-feedback-card').forEach(c => c.classList.toggle('active', c.id === 'mm-fb-' + type));
    sEl('mm-fb-form-wrap').hidden = false;
    sEl('mm-fb-subject').value = FEEDBACK_SUBJECTS[type] || '';
    sEl('mm-fb-subject').focus();
  }

  function submitFeedback() {
    const name    = sEl('mm-fb-name').value.trim();
    const subject = sEl('mm-fb-subject').value.trim();
    const body    = sEl('mm-fb-body').value.trim();
    if (!subject || !body) {
      notify('Betreff und Nachricht sind Pflichtfelder.', 'error');
      return;
    }
    const fullBody = encodeURIComponent(`${body}\n\n${name ? 'Grüße,\n' + name : ''}`);
    window.location.href = `mailto:${MAIL_TO}?subject=${encodeURIComponent(subject)}&body=${fullBody}`;
    notify('Mail-Client geöffnet! Bitte die vorausgefüllte Mail absenden.', 'success');
  }

  function initFeedbackForm() {
    sEl('mm-fb-bug').addEventListener('click', () => openFeedback('bug'));
    sEl('mm-fb-feature').addEventListener('click', () => openFeedback('feature'));
    sEl('mm-fb-beschreibung').addEventListener('click', () => openFeedback('beschreibung'));
    sEl('mm-fb-submit').addEventListener('click', submitFeedback);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTypeSelector();
    initFilterBar();
    initUploadPanel();
    initStaleWarning();
    initAuthorPrompt();
    initCommandForm();
    initGuidePicker();
    initGuideForm();
    initChangesModal();
    initSkriptForm();
    initFeedbackForm();
  });
})();
