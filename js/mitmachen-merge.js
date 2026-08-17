// ============================================================
// support.sheet – mitmachen-merge.js
// Internes Merge-Werkzeug fuer den Maintainer (Mitmachen-Konzept,
// Schritt 7, Option B). Laedt die vier aktuellen Original-Dateien plus
// die Export-ZIP eines Kollegen, zeigt einen Diff mit An/Abwahl pro
// Eintrag und erzeugt die fertig gemergten Dateien zum Download.
// Kein automatischer Commit, kein Upload irgendwohin.
// Erwartet js/jszip.min.js und js/mitmachen-checksum.js vor dieser Datei.
// ============================================================
(function () {
  const CATEGORY_LABELS = { windows: 'Windows', exchange: 'Exchange', forti: 'Fortinet' };

  // state.files: die vier hochgeladenen Original-Dateien, ROH (JSON.parse-
  // Ergebnis, exakt wie in der Datei) – dieselbe Form, die auch
  // window.MitmachenChecksum.computeDatasetsChecksum() (js/mitmachen-
  // checksum.js) erwartet, damit der Vergleich mit dem beim Export in
  // js/mitmachen.js berechneten baseChecksum ueberhaupt moeglich ist.
  const state = {
    files: { commandsWindows: null, commandsExchange: null, commandsForti: null, guides: null },
    zip: null, // { commandsAdditions, guidesAdditions, mergeInfo }
  };

  // Fuer den Merge-Schritt: flache Liste der neuen Commands/Guides in
  // exakt der Reihenfolge, in der sie gerendert wurden – so lassen sich
  // die Checkboxen im DOM per Index wieder den Originalobjekten zuordnen,
  // ohne die Objekte selbst im DOM zwischenspeichern zu muessen.
  let commandsFlat = [];
  let guidesFlat = [];
  let guideEditsFlat = [];

  function notify(message, type) {
    if (typeof showToast === 'function') showToast(message, type);
  }

  function mgEl(id) { return document.getElementById(id); }

  // ── Fehleranzeige (pro Datei, blockiert die Seite nicht) ──
  function showFileError(label, message) {
    const box = mgEl('mmg-errors');
    box.hidden = false;
    const item = document.createElement('div');
    item.className = 'mmg-error-item';
    const strong = document.createElement('strong');
    strong.textContent = label + ': ';
    item.appendChild(strong);
    item.appendChild(document.createTextNode(message));
    box.appendChild(item);
  }

  function clearFileErrors() {
    const box = mgEl('mmg-errors');
    box.replaceChildren();
    box.hidden = true;
  }

  function setFieldStatus(fieldId, text, kind) {
    const field = mgEl(fieldId);
    field.classList.toggle('mmg-upload-field--loaded', kind === 'ok');
    const statusEl = field.querySelector('[data-status]');
    statusEl.textContent = text;
    statusEl.className = 'mmg-upload-field-status' + (kind ? ' mmg-upload-field-status--' + kind : '');
  }

  // ── Datei einlesen ─────────────────────────────────────────
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Datei konnte nicht gelesen werden.'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Datei konnte nicht gelesen werden.'));
      reader.readAsArrayBuffer(file);
    });
  }

  // ── Validierung der vier Original-Dateien (gleiche Form wie die
  // Normalisierung in js/mitmachen.js, aber hier bleibt alles roh) ──
  function validateOriginalFile(key, json) {
    if (key === 'commandsWindows') {
      if (!json || !Array.isArray(json.commands)) {
        throw new Error('Erwartete Struktur { commands: [...] } nicht gefunden.');
      }
    } else if (key === 'guides') {
      if (!json || !Array.isArray(json.guides)) {
        throw new Error('Erwartete Struktur { guides: [...] } nicht gefunden.');
      }
    } else {
      if (!Array.isArray(json)) {
        throw new Error('Erwartete ein Array von Commands.');
      }
    }
  }

  async function handleOriginalFileInput(e) {
    const key = e.target.dataset.key;
    const file = e.target.files[0];
    if (!file) return;
    const fieldId = 'mmg-field-' + key;

    try {
      const text = await readFileAsText(file);
      const json = JSON.parse(text);
      validateOriginalFile(key, json);
      state.files[key] = json;
      setFieldStatus(fieldId, '✓ ' + file.name, 'ok');
    } catch (err) {
      state.files[key] = null;
      setFieldStatus(fieldId, '✕ ' + (err.message || 'Datei ungueltig.'), 'error');
      showFileError(file.name, err.message || 'Datei konnte nicht gelesen werden.');
    }

    tryRunDiff();
  }

  // ── ZIP einlesen ───────────────────────────────────────────
  async function handleZipInput(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const zip = await JSZip.loadAsync(buffer);

      const commandsAdditionsFile = zip.file('commands-additions.json');
      const guidesAdditionsFile   = zip.file('support-guides-additions.json');
      const guidesEditsFile       = zip.file('support-guides-edits.json');
      const mergeInfoFile         = zip.file('merge-info.json');

      if (!commandsAdditionsFile || !guidesAdditionsFile || !mergeInfoFile) {
        throw new Error('ZIP enthaelt nicht alle erwarteten Dateien (commands-additions.json, support-guides-additions.json, merge-info.json).');
      }

      const commandsAdditions = JSON.parse(await commandsAdditionsFile.async('string'));
      const guidesAdditions   = JSON.parse(await guidesAdditionsFile.async('string'));
      // support-guides-edits.json ist optional - aeltere Exports kannten die
      // Bearbeiten-Funktion noch nicht, daher hier auf leere Liste zurueckfallen.
      const guidesEdits       = guidesEditsFile ? JSON.parse(await guidesEditsFile.async('string')) : { guides: [] };
      const mergeInfo         = JSON.parse(await mergeInfoFile.async('string'));

      if (!commandsAdditions.windows || !Array.isArray(commandsAdditions.windows.commands) ||
          !Array.isArray(commandsAdditions.exchange) || !Array.isArray(commandsAdditions.forti)) {
        throw new Error('commands-additions.json hat nicht die erwartete Struktur.');
      }
      if (!Array.isArray(guidesAdditions.guides)) {
        throw new Error('support-guides-additions.json hat nicht die erwartete Struktur.');
      }
      if (!Array.isArray(guidesEdits.guides)) {
        throw new Error('support-guides-edits.json hat nicht die erwartete Struktur.');
      }
      if (typeof mergeInfo.baseChecksum !== 'string') {
        throw new Error('merge-info.json hat nicht die erwartete Struktur.');
      }

      state.zip = { commandsAdditions, guidesAdditions, guidesEdits, mergeInfo };
      setFieldStatus('mmg-field-zip', '✓ ' + file.name, 'ok');
    } catch (err) {
      state.zip = null;
      setFieldStatus('mmg-field-zip', '✕ ' + (err.message || 'ZIP ungueltig.'), 'error');
      showFileError(file.name, err.message || 'ZIP konnte nicht gelesen werden.');
    }

    tryRunDiff();
  }

  // ── Diff + Checksum-Vergleich ausloesen sobald alles geladen ist ──
  function tryRunDiff() {
    const allFilesLoaded = Object.values(state.files).every(f => f !== null);
    if (!allFilesLoaded || !state.zip) return;
    clearFileErrors();
    runDiff();
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || '–';
    return d.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' })
      + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  }

  function renderMeta() {
    const info = state.zip.mergeInfo;
    const el = mgEl('mmg-meta');
    el.hidden = false;
    el.textContent = 'Eingereicht von ' + (info.exportedBy || 'unbekannt') + ' am ' + fmtDate(info.exportedAt) +
      ' – ' + (info.newCommands ?? 0) + ' neue Commands, ' + (info.newGuides ?? 0) + ' neue Guides, ' +
      (info.editedGuides ?? 0) + ' bearbeitete Guide(s), ' +
      (info.newLinks ?? 0) + ' Verknuepfung(en) laut merge-info.json.';
  }

  // Checksum ist reine Information/Warnung, nie ein Blocker – der Merge
  // bleibt in jedem Fall moeglich (siehe Anforderung).
  function renderChecksumStatus() {
    const el = mgEl('mmg-checksum-status');
    el.hidden = false;

    const freshChecksum = window.MitmachenChecksum.computeDatasetsChecksum(state.files);
    const baseChecksum = state.zip.mergeInfo.baseChecksum;

    if (freshChecksum === baseChecksum) {
      el.className = 'mmg-checksum-status mmg-checksum-status--ok';
      el.textContent = '✓ Datenstand stimmt mit dem Stand des Kollegen ueberein (Checksum ' + freshChecksum + ').';
    } else {
      el.className = 'mmg-checksum-status mmg-checksum-status--warn';
      el.textContent = '⚠ Kollege hat auf einem anderen Datenstand gearbeitet (erwartete Checksum ' + baseChecksum +
        ', aktuell ' + freshChecksum + '). Merge ist trotzdem moeglich, Eintraege bitte besonders sorgfaeltig pruefen.';
    }
  }

  function buildDiffRow({ checked, duplicate, name, sub, meta }) {
    const row = document.createElement('label');
    row.className = 'mmg-diff-row' + (duplicate ? ' mmg-diff-row--duplicate' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'mmg-diff-checkbox';
    checkbox.checked = checked;

    const text = document.createElement('div');
    text.className = 'mmg-diff-text';

    const nameEl = document.createElement('div');
    nameEl.className = 'mmg-diff-name';
    nameEl.textContent = name;
    text.appendChild(nameEl);

    if (sub) {
      const subEl = document.createElement('code');
      subEl.className = 'mmg-diff-sub';
      subEl.textContent = sub;
      text.appendChild(subEl);
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'mmg-diff-meta';
    metaEl.textContent = meta + (duplicate ? ' · Duplikat – ID existiert bereits' : '');
    text.appendChild(metaEl);

    row.appendChild(checkbox);
    row.appendChild(text);
    return row;
  }

  function emptyNote(text) {
    const el = document.createElement('div');
    el.className = 'mmg-diff-empty';
    el.textContent = text;
    return el;
  }

  function renderCommandsDiff() {
    const container = mgEl('mmg-diff-commands');
    container.replaceChildren();

    commandsFlat = [];
    const additions = state.zip.commandsAdditions;
    ['windows', 'exchange', 'forti'].forEach(cat => {
      const list = cat === 'windows' ? additions.windows.commands : additions[cat];
      list.forEach(cmd => commandsFlat.push({ ...cmd, _category: cat }));
    });

    if (!commandsFlat.length) {
      container.appendChild(emptyNote('Keine neuen Commands in dieser ZIP.'));
      return;
    }

    const existingIds = {
      windows:  new Set((state.files.commandsWindows.commands || []).map(c => c.id)),
      exchange: new Set((state.files.commandsExchange || []).map(c => c.id)),
      forti:    new Set((state.files.commandsForti || []).map(c => c.id)),
    };

    commandsFlat.forEach(cmd => {
      const duplicate = existingIds[cmd._category].has(cmd.id);
      container.appendChild(buildDiffRow({
        checked: !duplicate,
        duplicate,
        name: cmd.name,
        sub: cmd.cmd,
        meta: CATEGORY_LABELS[cmd._category] + ' · ' + cmd.id,
      }));
    });
  }

  function renderGuidesDiff() {
    const container = mgEl('mmg-diff-guides');
    container.replaceChildren();

    guidesFlat = [...state.zip.guidesAdditions.guides];

    if (!guidesFlat.length) {
      container.appendChild(emptyNote('Keine neuen Guides in dieser ZIP.'));
      return;
    }

    const existingGuideIds = new Set((state.files.guides.guides || []).map(g => g.id));

    guidesFlat.forEach(guide => {
      const duplicate = existingGuideIds.has(guide.id);
      container.appendChild(buildDiffRow({
        checked: !duplicate,
        duplicate,
        name: guide.title,
        sub: null,
        meta: guide.id,
      }));
    });
  }

  // Bearbeitete Guides sind keine Duplikate im ueblichen Sinn - sie sollen
  // den bestehenden Eintrag absichtlich ersetzen, daher immer vorausgewaehlt
  // und ohne die rote Duplikat-Markierung von buildDiffRow.
  function renderGuideEditsDiff() {
    const container = mgEl('mmg-diff-guide-edits');
    container.replaceChildren();

    guideEditsFlat = [...state.zip.guidesEdits.guides];

    if (!guideEditsFlat.length) {
      container.appendChild(emptyNote('Keine bearbeiteten Guides in dieser ZIP.'));
      return;
    }

    const existingGuideIds = new Set((state.files.guides.guides || []).map(g => g.id));

    guideEditsFlat.forEach(guide => {
      const exists = existingGuideIds.has(guide.id);
      container.appendChild(buildDiffRow({
        checked: true,
        duplicate: false,
        name: guide.title,
        sub: null,
        meta: guide.id + ' · ' + (exists ? 'wird aktualisiert' : 'Original nicht gefunden, wird als neuer Guide ergaenzt'),
      }));
    });
  }

  function runDiff() {
    renderMeta();
    renderChecksumStatus();
    renderCommandsDiff();
    renderGuidesDiff();
    renderGuideEditsDiff();
    mgEl('mmg-diff').hidden = false;
    mgEl('mmg-success').hidden = true;
  }

  // ── Merge + Download ───────────────────────────────────────
  function selectedRows(containerId, flatList) {
    const rows = [...mgEl(containerId).querySelectorAll('.mmg-diff-row')];
    return rows
      .map((row, i) => ({ checked: row.querySelector('input[type="checkbox"]').checked, item: flatList[i] }))
      .filter(x => x.checked)
      .map(x => x.item);
  }

  function stripDiffCategory(cmd) {
    const { _category, ...rest } = cmd;
    return rest;
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Einzelne a.click()-Downloads pro Datei wurden vom Browser teilweise als
  // automatische Mehrfach-Downloads verworfen (nur 1 von 4 Dateien kam an,
  // ohne Fehlermeldung). Stattdessen alle 4 fertigen Dateien plus Info-Text
  // in eine ZIP buendeln – ein einziger, zuverlaessiger Download.
  async function runMerge() {
    const selectedCommands = selectedRows('mmg-diff-commands', commandsFlat);
    const selectedGuides   = selectedRows('mmg-diff-guides', guidesFlat);
    const selectedEdits    = selectedRows('mmg-diff-guide-edits', guideEditsFlat);

    const byCategory = { windows: [], exchange: [], forti: [] };
    selectedCommands.forEach(cmd => byCategory[cmd._category].push(stripDiffCategory(cmd)));

    // Nur die angehakten neuen Eintraege anhaengen, alles andere
    // (version/lastUpdated/description, bestehende Eintraege, Reihenfolge)
    // bleibt unveraendert.
    const mergedCommandsJson = {
      ...state.files.commandsWindows,
      commands: [...state.files.commandsWindows.commands, ...byCategory.windows],
    };
    const mergedExchange = [...state.files.commandsExchange, ...byCategory.exchange];
    const mergedForti    = [...state.files.commandsForti, ...byCategory.forti];

    // Bearbeitete Guides ersetzen den bestehenden Eintrag per id (oder werden
    // angehaengt, falls das Original nicht mehr existiert). Reihenfolge der
    // unveraenderten Guides bleibt dabei erhalten.
    let guidesWithEdits = state.files.guides.guides.map(g => {
      const edit = selectedEdits.find(e => e.id === g.id);
      return edit ? edit : g;
    });
    const appendedEdits = selectedEdits.filter(e => !state.files.guides.guides.some(g => g.id === e.id));
    const mergedGuides = {
      ...state.files.guides,
      guides: [...guidesWithEdits, ...appendedEdits, ...selectedGuides],
    };

    const mergeBtn = mgEl('mmg-merge-btn');
    mergeBtn.disabled = true;

    try {
      const zip = new JSZip();
      zip.file('commands.json', JSON.stringify(mergedCommandsJson, null, 2));
      zip.file('exchange-commands.json', JSON.stringify(mergedExchange, null, 2));
      zip.file('forti-commands.json', JSON.stringify(mergedForti, null, 2));
      zip.file('support-guides.json', JSON.stringify(mergedGuides, null, 2));
      zip.file('MERGE_INFO.txt',
        'Merge durchgefuehrt am ' + new Date().toISOString() + '\n\n' +
        'Neue Commands gemergt: ' + byCategory.windows.length + ' (Windows), ' +
        byCategory.exchange.length + ' (Exchange), ' + byCategory.forti.length + ' (Fortinet)\n' +
        'Neue Guides gemergt: ' + selectedGuides.length + '\n' +
        'Bearbeitete Guides gemergt: ' + selectedEdits.length + '\n\n' +
        'Enthaltene Dateien: commands.json, exchange-commands.json, forti-commands.json, support-guides.json\n' +
        'Bitte entpacken, Dateien manuell ins Repo einfuegen und danach sw.js CACHE_VERSION bumpen.'
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob('mitmachen-merge-' + new Date().toISOString().slice(0, 10) + '.zip', blob);

      const successEl = mgEl('mmg-success');
      successEl.hidden = false;
      successEl.textContent = '✓ ' + selectedCommands.length + ' Command(s), ' + selectedGuides.length +
        ' neue(r) Guide(s) und ' + selectedEdits.length + ' bearbeitete(r) Guide(s) uebernommen. Eine ZIP mit allen 4 Dateien und MERGE_INFO.txt wurde heruntergeladen – ' +
        'bitte entpacken, Dateien manuell ins Repo einfuegen und danach sw.js CACHE_VERSION bumpen.';
      notify('Merge abgeschlossen, ZIP heruntergeladen.', 'success');
    } catch (err) {
      notify('Merge fehlgeschlagen: ' + (err.message || err), 'error');
    } finally {
      mergeBtn.disabled = false;
    }
  }

  // ── Init ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.mmg-upload-field input[data-key]').forEach(input => {
      input.addEventListener('change', handleOriginalFileInput);
    });
    mgEl('mmg-zip-input').addEventListener('change', handleZipInput);
    mgEl('mmg-merge-btn').addEventListener('click', runMerge);
  });
})();
