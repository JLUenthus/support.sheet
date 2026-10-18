// ============================================================
// guide.sheet – guides-manage.js (Phase 7+8 – Export/Import/DB-Verwaltung)
// Export (Sicherung vollständig / Weitergabe / lesbares Archiv via JSZip),
// Import/Merge mit Konflikterkennung und Prüfsummenkontrolle, Verwaiste Assets
// (prüfen, in den Papierkorb), Kategorien-Verwaltung, Papierkorb, Statistik.
// Nutzt GuidesDB und GuidesBackup. Erwartet vor dieser Datei:
// guides-db.js + guides-backup.js + jszip.min.js.
// ============================================================
(function() {
  const EXPORT_NAME_KEY = 'gs-export-name';

  let categoriesState  = [];
  let categoryCounts   = {};
  let allGuidesCache   = [];
  let parsedImport     = null;
  let loading          = false;
  let importIdCounter  = 0;

  // Fehler (Sicherung, Import, Löschen, Papierkorb, Kategorien) bleiben bis zum Schliessen stehen und werden nicht
  // von einer folgenden Erfolgsmeldung verdraengt (siehe showToast, options.persistent)
  function notify(message, msgType) {
    if (typeof showToast === 'function') showToast(message, msgType, { persistent: msgType === 'error' });
  }

  function fmtDate(iso) {
    if (!iso) return '–';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function ageLabel(iso) {
    if (!iso) return '';
    const months = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (months < 6)  return '🟢 aktuell';
    if (months < 12) return '🟡 ' + Math.round(months) + ' Monate';
    return '🔴 veraltet';
  }

  function sanitizeForFilename(str) {
    const cleaned = (str || 'Unbenannt').replace(/[/\\:*?"<>|]/g, '').trim().replace(/\s+/g, '-');
    return cleaned || 'Unbenannt';
  }

  function generateUniqueId() {
    return 'guide-' + Date.now() + '-' + (++importIdCounter);
  }

  function categoryColorLookup(name) {
    const cat = categoriesState.find(c => c.name === name);
    return (cat && cat.color) || 'var(--dim)';
  }

  function resolveToHex(colorValue) {
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorValue || '')) return colorValue;
    const probe = document.createElement('div');
    probe.style.color = colorValue || '#7c8cf8';
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    const m = rgb.match(/\d+/g);
    if (!m) return '#7c8cf8';
    return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
  }

  // ── Orchestrierung ───────────────────────────────────────
  async function loadAll() {
    if (loading) return;
    loading = true;
    try {
      const db = window.GuidesDB;

      const catRes = await db.getCategories();
      categoriesState = catRes.categories || [];

      let guides = [];
      if (!(db.isFilesystemMode() && !db.isConnected())) {
        const guidesRes = await db.listGuides();
        guides = (guidesRes.success && guidesRes.guides) || [];
      }
      allGuidesCache = guides;

      categoryCounts = {};
      guides.forEach(g => {
        const c = g.meta.category || 'Allgemein';
        categoryCounts[c] = (categoryCounts[c] || 0) + 1;
      });

      await updateStatusPanel(guides);
      populateExportCategoryDropdown();
      renderCategoryManageList();
      await loadTrash();
      renderStats(guides);
      if (!document.getElementById('gm-files-list').hidden) renderFileManager(guides);
    } finally {
      loading = false;
    }
  }

  async function updateStatusPanel(guides) {
    const db = window.GuidesDB;
    document.getElementById('gm-status-folder').textContent = db.isFilesystemMode()
      ? (db.isConnected() ? db.getFolderPath() : 'Kein Ordner verbunden')
      : 'Browser-Speicher (IndexedDB)';
    document.getElementById('gm-status-guides').textContent = guides.length;
    document.getElementById('gm-status-categories').textContent = categoriesState.length;

    let assetTotal = 0;
    if (guides.length) {
      const results = await Promise.all(guides.map(g => db.listAssets(g.id)));
      results.forEach(r => { if (r.success) assetTotal += r.assets.length; });
    }
    document.getElementById('gm-status-assets').textContent = assetTotal;

    const st = await window.GuidesBackup.getStatus(db);
    document.getElementById('gm-status-lastbackup').textContent = !st.at ? 'Noch nie'
      : fmtDate(st.at) + (st.changed == null ? '' : ' · ' + st.changed + ' geändert seitdem');
  }

  // Ergebnis von Export/Import: bleibt stehen (der Toast verschwindet nach 2 s,
  // wuerde bei Teilergebnissen und Warnungen also leicht uebersehen).
  function showResult(message, type) {
    const el = document.getElementById('gm-result');
    el.textContent = message;
    el.className = 'gm-result gm-result--' + (type || 'success');
    el.hidden = false;
    notify(message, type);
  }

  function refreshBackupIndicator() { document.dispatchEvent(new CustomEvent('guides-backup-updated')); }

  function initStatusActions() {
    document.getElementById('gm-switch-folder').addEventListener('click', async () => {
      const res = await window.GuidesDB.openFolder();
      if (res.success) { notify('Ordner gewechselt.', 'success'); await loadAll(); }
      else if (res.error) notify(res.error, 'error');
    });
    document.getElementById('gm-disconnect-folder').addEventListener('click', async () => {
      const res = await window.GuidesDB.closeFolder();
      if (res.success) { notify('Ordner getrennt.', 'success'); await loadAll(); }
      else if (res.error) notify(res.error, 'error');
    });
    document.getElementById('gm-cleanup-assets').addEventListener('click', checkOrphans);
    document.getElementById('gm-orphans-trash').addEventListener('click', trashSelectedOrphans);
    document.getElementById('gm-orphans-close').addEventListener('click', () => { document.getElementById('gm-orphans-panel').hidden = true; });
  }

  // Der "Neu hier?"-Hinweis auf guides.html merkt sich sein Ausblenden in
  // localStorage (siehe HOWTO_HINT_KEY in guides-overview.js) – hier nur
  // den Schluessel wieder entfernen, das eigentliche Wiedereinblenden
  // passiert beim naechsten Aufruf von guides.html.
  const HOWTO_HINT_KEY = 'gs-howto-hint-dismissed';

  function initHowtoHintReset() {
    document.getElementById('gm-show-howto-hint')?.addEventListener('click', () => {
      localStorage.removeItem(HOWTO_HINT_KEY);
      notify('Wird beim nächsten Besuch von „Guides" wieder angezeigt.', 'success');
    });
  }

  // ── Verwaiste Assets: prüfen, anzeigen, nach Bestätigung in den Papierkorb ──
  // Läuft nie automatisch (nicht beim Speichern, nicht beim Import), sondern nur
  // auf ausdrücklichen Klick. Nichts wird endgültig gelöscht: bestätigte Dateien
  // wandern in den Papierkorb und lassen sich dort wiederherstellen.
  let orphanState = [];

  function renderOrphans(scan) {
    const panel   = document.getElementById('gm-orphans-panel');
    const list    = document.getElementById('gm-orphans-list');
    const summary = document.getElementById('gm-orphans-summary');
    const trashBtn = document.getElementById('gm-orphans-trash');
    list.replaceChildren();
    panel.hidden = false;

    orphanState.forEach((o) => {
      const row = document.createElement('label');
      row.className = 'gm-orphan-row';
      row.dataset.guide = o.guideId;
      row.dataset.file = o.filename;
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = o.selected;
      cb.addEventListener('change', () => { o.selected = cb.checked; });
      const guide = document.createElement('span');
      guide.className = 'gm-orphan-guide'; guide.textContent = o.title;
      const name = document.createElement('span');
      name.className = 'gm-orphan-name'; name.textContent = o.filename;
      const size = document.createElement('span');
      size.className = 'gm-orphan-size'; size.textContent = formatFileSize(o.size);
      row.append(cb, guide, name, size);
      list.appendChild(row);
    });

    const guideCount = new Set(orphanState.map((o) => o.guideId)).size;
    const skipped = scan.skipped.length ? ' ' + scan.skipped.length + ' Guide(s) konnten nicht gelesen werden und wurden nicht geprüft.' : '';
    summary.textContent = orphanState.length
      ? orphanState.length + ' nicht referenzierte Datei(en) in ' + guideCount + ' Guide(s) gefunden (' + scan.scanned + ' Guides geprüft). Es wurde nichts verändert.' + skipped
      : 'Keine verwaisten Assets gefunden (' + scan.scanned + ' Guides geprüft).' + skipped;
    trashBtn.hidden = !orphanState.length;
  }

  async function checkOrphans() {
    const summary = document.getElementById('gm-orphans-summary');
    document.getElementById('gm-orphans-panel').hidden = false;
    document.getElementById('gm-orphans-list').replaceChildren();
    document.getElementById('gm-orphans-trash').hidden = true;
    summary.textContent = 'Prüfe…';
    try {
      const scan = await window.GuidesBackup.scanOrphans(window.GuidesDB);
      orphanState = scan.orphans.map((o) => ({ ...o, selected: true }));
      renderOrphans(scan);
    } catch (err) {
      document.getElementById('gm-orphans-panel').hidden = true;
      notify('Prüfung fehlgeschlagen: ' + (err?.message || err), 'error');
    }
  }

  async function trashSelectedOrphans() {
    const selected = orphanState.filter((o) => o.selected);
    if (!selected.length) { notify('Keine Datei ausgewählt.', 'error'); return; }
    if (!confirm(selected.length + ' Datei(en) in den Papierkorb verschieben?\n\nSie werden nicht gelöscht und lassen sich im Papierkorb wiederherstellen. ' +
      'Endgültig gelöscht wird erst mit „Papierkorb leeren“ (nach einer weiteren Rückfrage).')) return;
    let moved = 0;
    const failed = [];
    for (const o of selected) {
      const res = await window.GuidesDB.trashAsset(o.guideId, o.filename);
      if (res.success) moved++; else failed.push(o.filename + ': ' + (res.error || 'Fehler'));
    }
    showResult(moved + ' Datei(en) in den Papierkorb verschoben' + (failed.length ? ', ' + failed.length + ' NICHT verschoben (' + failed.join('; ') + ')' : '') + '.',
      failed.length ? 'error' : 'success');
    await checkOrphans();
    await loadAll();
  }

  // ── Export ───────────────────────────────────────────────
  function populateExportCategoryDropdown() {
    const sel = document.getElementById('gm-export-category');
    sel.replaceChildren();
    categoriesState.forEach(cat => {
      const o = document.createElement('option');
      o.value = cat.name;
      o.textContent = cat.name;
      sel.appendChild(o);
    });
  }

  // Lesbares Archiv: Funktion unveraendert (Markdown + Bilder); die Daten kommen jetzt
  // aus dem Guide selbst (GuidesBackup.collect) statt aus dem Index-Eintrag.
  async function buildReadableArchive(zip, guides, exportedBy, dateStr) {
    const usedNames = new Map();
    const tocLines = [];

    for (const g of guides) {
      // Kopie statt g.meta direkt – privateNote darf niemals in eine Export-Datei gelangen.
      const meta = { ...g.meta };
      delete meta.privateNote;
      const categoryFolder = sanitizeForFilename(meta.category || 'Allgemein');
      let titleSlug = sanitizeForFilename(meta.title || 'Unbenannt');

      const key = categoryFolder + '/' + titleSlug;
      const count = (usedNames.get(key) || 0) + 1;
      usedNames.set(key, count);
      if (count > 1) titleSlug = titleSlug + '_' + count;

      const mdPath = categoryFolder + '/' + titleSlug + '.md';
      const assetsFolder = categoryFolder + '/' + titleSlug + '-assets/';

      let content = (g.content || '').split('assets/').join(assetsFolder);

      // Links/Dateien stehen nur in meta, nicht im Content-Text – im lesbaren
      // Archiv (reines Markdown, kein meta.json) müssen sie deshalb explizit
      // angehängt werden, sonst gehen sie beim Export unsichtbar verloren.
      const links = Array.isArray(meta.links) ? meta.links.filter((l) => l.url) : [];
      if (links.length) {
        const linkLines = links.map((l) => {
          const label = l.text && l.text.trim() ? l.text.trim() : null;
          let line = '- ' + (label ? '[' + label + '](' + l.url + ')' : l.url);
          if (l.offlineAsset) line += ' ([Offline-Kopie](' + assetsFolder + l.offlineAsset + '))';
          return line;
        });
        content += '\n\n## Links\n' + linkLines.join('\n') + '\n';
      }

      const attachments = Array.isArray(meta.attachments) ? meta.attachments : [];
      if (attachments.length) {
        const attachmentLines = attachments.map((a) => '- [' + a.name + '](' + assetsFolder + a.assetFile + ')');
        content += '\n\n## Dateien\n' + attachmentLines.join('\n') + '\n';
      }

      zip.file(mdPath, content);
      for (const a of g.assets) zip.file(assetsFolder + a.name, a.blob);

      tocLines.push('- [' + (meta.title || 'Unbenannt') + '](' + mdPath + ') – ' + ageLabel(meta.modified));
    }

    const readme = '# Guide-Export – ' + dateStr + '\n' +
      'Exportiert von: ' + exportedBy + '\n' +
      'Guides: ' + guides.length + '\n\n' +
      '## Inhaltsverzeichnis\n' + tocLines.join('\n') + '\n';
    zip.file('README.md', readme);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function downloadZip(zip, filename) {
    downloadBlob(await zip.generateAsync({ type: 'blob' }), filename);
  }

  // Die gerade erzeugte Datei wird wieder gelesen und gegen ihre Prüfsummen und
  // gegen das erwartete Manifest geprüft. Erst danach wird sie angeboten.
  async function verifyBuiltPackage(pkg) {
    const zip = await JSZip.loadAsync(pkg.blob);
    const v = await window.GuidesBackup.verifyZip(zip);
    const issues = [...v.errors];
    Object.entries(v.guideErrors).forEach(([id, msgs]) => issues.push(id + ': ' + msgs.join('; ')));
    if (!v.hasManifest) issues.push('Manifest fehlt');
    else {
      const text = await zip.file('_manifest.json').async('string');
      if (text !== pkg.manifestText) issues.push('Manifest weicht vom erwarteten ab');
    }
    if (v.guideCount !== pkg.counts.guides || v.assetCount !== pkg.counts.assets) issues.push('Anzahl der Guides/Assets weicht ab');
    return { ok: issues.length === 0, issues };
  }

  function updateFormatNotices() {
    const format = document.querySelector('input[name="gm-format"]:checked').value;
    const scope  = document.querySelector('input[name="gm-scope"]:checked').value;
    document.getElementById('gm-notice-full').hidden     = format !== 'full';
    document.getElementById('gm-notice-share').hidden    = format !== 'share';
    document.getElementById('gm-readable-warning').hidden = format !== 'readable';
    document.getElementById('gm-notice-partial').hidden  = !(format === 'full' && scope !== 'all');
  }

  async function handleExport() {
    if (typeof JSZip === 'undefined') { notify('jszip.js konnte nicht geladen werden.', 'error'); return; }

    const scope  = document.querySelector('input[name="gm-scope"]:checked').value;
    const format = document.querySelector('input[name="gm-format"]:checked').value;
    const exportedBy = (document.getElementById('gm-export-name').value || 'anonym').trim();
    localStorage.setItem(EXPORT_NAME_KEY, exportedBy);
    const GB = window.GuidesBackup;

    if (format === 'readable' && !confirm('Lesbares Archiv – KEIN Backup!\n\n' + GB.READABLE_WARNING + '\n\nTrotzdem als lesbares Archiv exportieren?')) return;

    const buttons = [document.getElementById('gm-export-btn'), document.getElementById('gm-quick-backup-btn')];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const data = await GB.collect(window.GuidesDB, {
        scope,
        category: document.getElementById('gm-export-category').value,
        includeTrash: format === 'full' && scope === 'all', // die Weitergabe enthält keinen Papierkorb (nicht für Dritte bestimmt)
      });
      if (!data.guides.length) { notify('Keine Guides für diese Auswahl gefunden.', 'error'); return; }

      const dateStr = new Date().toISOString().slice(0, 10);
      const assetTotal = data.guides.reduce((n, g) => n + g.assets.length, 0);

      if (format === 'readable') {
        const zip = new JSZip();
        await buildReadableArchive(zip, data.guides, exportedBy, dateStr);
        await downloadZip(zip, 'guide-sheet-export-' + dateStr + '.zip');
        showResult('Lesbares Archiv erstellt (' + GB.plural(data.guides.length, 'Guide', 'Guides') + ', ' + GB.plural(assetTotal, 'Asset', 'Assets') + '). ' +
          'Kein Backup: Tags, Favoriten, Zeitstempel, Unterkategorien, private Notizen, Anhänge/Links als Felder und der Kategorienbaum sind nicht enthalten.', 'warning');
        return;
      }

      const kind = format === 'share' ? 'share' : 'backup';
      const isFullBackup = kind === 'backup' && scope === 'all';
      const pkg = await GB.buildPackage(kind, data, exportedBy);
      const check = await verifyBuiltPackage(pkg);
      if (!check.ok) {
        showResult('WARNUNG: Die erzeugte Datei hat die Prüfung NICHT bestanden (Prüfsummen stimmen nicht: ' + check.issues.slice(0, 3).join(' | ') +
          (check.issues.length > 3 ? ' … +' + (check.issues.length - 3) : '') + '). Die Datei wurde nicht gespeichert und „Letztes Backup“ nicht gesetzt. Bitte erneut versuchen.', 'error');
        return;
      }

      const name = kind === 'share'
        ? 'guide-sheet-weitergabe-' + sanitizeForFilename(exportedBy) + '-' + dateStr + '.zip'
        : (isFullBackup ? 'guide-sheet-sicherung-' : 'guide-sheet-teilsicherung-') + dateStr + '.zip';
      downloadBlob(pkg.blob, name);

      const numbers = GB.plural(pkg.counts.guides, 'Guide', 'Guides') + ', ' + GB.plural(pkg.counts.assets, 'Asset', 'Assets') + ', Prüfsummen stimmen';
      let message, type = 'success';
      // Papierkorb-Altbestand: Rohkopien und Nichtlesbares werden genannt, nie stumm weggelassen
      const notes = [];
      if (data.legacy.length) notes.push('Papierkorb-Altbestand, als Guide nicht lesbar: ' + GB.plural(data.legacy.length, 'Rohkopie', 'Rohkopien') + ' unverändert im Paket (_legacy-trash): ' + data.legacy.map((l) => l.folder + (l.failed.length ? ' [' + l.failed.length + ' Datei(en) nicht lesbar]' : '')).join(', '));
      if (data.unlisted.length) notes.push('NICHT im Paket (nicht lesbar, kein Ordner zum Kopieren): ' + data.unlisted.map((u) => u.label + ' – ' + u.error).join('; '));
      if (notes.length) type = 'warning';
      if (kind === 'share') {
        message = 'Weitergabe geprüft: ' + numbers + '. Ohne private Notizen und ohne Papierkorb.';
      } else if (isFullBackup) {
        const recorded = GB.recordBackup(data.guides);
        refreshBackupIndicator();
        message = 'Sicherung geprüft: ' + numbers + '. ' + GB.PRIVATE_NOTICE + (notes.length ? ' ' + notes.join(' ') : '');
        if (!recorded) { message += ' Der Zeitpunkt der Sicherung konnte nicht gespeichert werden.'; type = 'warning'; }
      } else {
        message = 'Teil-Sicherung geprüft: ' + numbers + '. Sie enthält nicht alle Guides und setzt „Letztes Backup“ nicht. ' + GB.PRIVATE_NOTICE;
        type = 'warning';
      }
      showResult(message, type);
      await updateStatusPanel(allGuidesCache);
    } catch (err) {
      showResult('Export fehlgeschlagen: ' + (err?.message || err), 'error');
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  // ── Import / Merge ───────────────────────────────────────
  // Erkennt: Sicherung / Weitergabe (Format 2, mit Manifest), älteres Merge-Paket
  // (_package.json ohne formatVersion) und lesbares Archiv.
  async function parseMergePackage(zip) {
    const GB = window.GuidesBackup;
    const pkg = JSON.parse(await zip.file('_package.json').async('string'));
    const formatVersion = pkg.formatVersion || 1;
    if (formatVersion > GB.FORMAT_VERSION) {
      throw new Error('Das Paket hat das Format ' + formatVersion + ' und stammt aus einer neueren Version von guide.sheet.');
    }
    const packageKind = formatVersion >= 2 ? (pkg.kind === 'share' ? 'share' : 'backup') : 'package';

    let verification = null;
    if (formatVersion >= 2) {
      verification = await GB.verifyZip(zip);
      if (!verification.hasManifest) throw new Error('Das Paket (Format ' + formatVersion + ') enthält kein Manifest mit Prüfsummen und wird nicht importiert.');
    }

    const guideIds = new Set();
    Object.keys(zip.files).forEach((path) => {
      const m = path.match(/^guides\/([^/]+)\/meta\.json$/);
      if (m) guideIds.add(m[1]);
    });

    const items = [];
    for (const id of guideIds) {
      const meta = JSON.parse(await zip.file('guides/' + id + '/meta.json').async('string'));
      const content = await zip.file('guides/' + id + '/content.md').async('string');
      const assetPaths = Object.keys(zip.files).filter(p =>
        p.startsWith('guides/' + id + '/assets/') && !zip.files[p].dir);
      const problems = verification && verification.guideErrors[id];
      items.push({
        id, meta, content, assetPaths, conflict: false, chosenAction: 'new', selected: !problems, extraTag: '',
        trashed: !!meta.trashedAt, corrupt: !!problems, problems: problems || [],
      });
    }

    // Rohkopien aus dem Papierkorb-Altbestand: lesbar -> Papierkorb-Guide, sonst bleibt der Inhalt im Paket
    const legacyFolders = new Set();
    Object.keys(zip.files).forEach((path) => { const lm = path.match(/^_legacy-trash\/([^/]+)\//); if (lm) legacyFolders.add(lm[1]); });
    const legacyUnreadable = [];
    for (const folder of legacyFolders) {
      const prefix = '_legacy-trash/' + folder + '/';
      const problems = verification && verification.guideErrors[prefix.slice(0, -1)];
      let meta = null, content = null;
      try {
        meta = JSON.parse(await zip.file(prefix + 'meta.json').async('string'));
        content = await zip.file(prefix + 'content.md').async('string');
      } catch { meta = null; }
      if (!meta || typeof meta !== 'object' || !meta.id || items.some((i) => i.id === meta.id)) { legacyUnreadable.push(folder); continue; }
      if (!meta.trashedAt) meta.trashedAt = meta.modified || new Date().toISOString();
      const assetPaths = Object.keys(zip.files).filter((p) => p.startsWith(prefix + 'assets/') && !zip.files[p].dir);
      items.push({
        id: meta.id, meta, content, assetPaths, conflict: false, chosenAction: 'new', selected: !problems, extraTag: '',
        trashed: true, corrupt: !!problems, problems: problems || [], legacy: folder,
      });
    }

    let categoriesFromPkg = [];
    const catFile = zip.file('categories.json');
    if (catFile) {
      try { categoriesFromPkg = JSON.parse(await catFile.async('string')); } catch { /* ignorieren */ }
    }
    const categoriesCorrupt = !!(verification && verification.errors.some((e) => /categories\.json/.test(e)));

    return { kind: 'package', packageKind, pkg, items, categoriesFromPkg, categoriesCorrupt, verification, legacyUnreadable };
  }

  // buildReadableArchive() hängt "## Links"/"## Dateien" ans Ende des
  // Markdown-Texts an (die einzige Stelle für diese Infos, da das lesbare
  // Archiv kein meta.json hat). Beim Reimport muss das wieder herausgelöst
  // werden – sonst landet der Abschnitt als toter Text im Guide-Inhalt UND
  // die eigentlichen Links/Dateien-Bereiche bleiben leer.
  function extractTrailingSection(content, heading) {
    const marker = '\n\n## ' + heading + '\n';
    const idx = content.indexOf(marker);
    if (idx === -1) return { content, block: null };
    return { content: content.slice(0, idx), block: content.slice(idx + marker.length) };
  }

  function extractLinksAndAttachmentsFromContent(rawContent) {
    let content = rawContent;
    const attachments = [];
    const links = [];

    // Dateien steht immer als letzter Abschnitt – zuerst abtrennen, damit
    // der Links-Marker danach wieder das Ende des verbleibenden Texts ist.
    const dateien = extractTrailingSection(content, 'Dateien');
    content = dateien.content;
    if (dateien.block) {
      dateien.block.split('\n').filter(Boolean).forEach((line, i) => {
        const m = line.match(/^- \[(.+?)\]\(assets\/(.+)\)$/);
        if (m) attachments.push({ id: 'att-' + Date.now() + '-' + i, name: m[1], size: null, type: '', assetFile: m[2] });
      });
    }

    const linksSection = extractTrailingSection(content, 'Links');
    content = linksSection.content;
    if (linksSection.block) {
      linksSection.block.split('\n').filter(Boolean).forEach((line, i) => {
        const m = line.match(/^- (?:\[(.+?)\]\((\S+?)\)|(\S+))(?: \(\[Offline-Kopie\]\(assets\/(.+?)\)\))?$/);
        if (m) links.push({
          id: 'link-' + Date.now() + '-' + i,
          text: m[1] || '',
          url: m[2] || m[3],
          offlineAsset: m[4] || null,
          offlineSavedAt: m[4] ? new Date().toISOString() : null,
        });
      });
    }

    return { content, attachments, links };
  }

  async function parseReadableArchive(zip) {
    const items = [];
    const mdPaths = Object.keys(zip.files).filter(p =>
      p.toLowerCase().endsWith('.md') && !zip.files[p].dir && !/(^|\/)readme\.md$/i.test(p));

    for (const path of mdPaths) {
      const parts = path.split('/');
      if (parts.length < 2) continue;
      const categoryFolder = parts[0];
      const filename = parts[parts.length - 1];
      const titleSlug = filename.replace(/\.md$/i, '');
      const title = titleSlug.replace(/-/g, ' ');
      const category = categoryFolder.replace(/-/g, ' ');

      const assetsFolder = parts.slice(0, -1).concat(titleSlug + '-assets').join('/') + '/';
      let content = await zip.file(path).async('string');
      content = content.split(assetsFolder).join('assets/');

      const { content: cleanContent, attachments, links } = extractLinksAndAttachmentsFromContent(content);

      const assetPaths = Object.keys(zip.files).filter(p => p.startsWith(assetsFolder) && !zip.files[p].dir);
      const id = generateUniqueId();

      items.push({
        id,
        meta: { id, title, category, tags: [], type: 'guide', favorite: false, source: 'import', attachments, links },
        content: cleanContent, assetPaths, assetsFolderPrefix: assetsFolder,
        conflict: false, chosenAction: 'new', selected: true, extraTag: '',
      });
    }
    return { kind: 'readable', packageKind: 'readable', items, categoriesFromPkg: [] };
  }

  async function markConflicts(items) {
    const existing = await window.GuidesDB.listGuides();
    const existingIds = new Set((existing.guides || []).map(g => g.id));
    items.forEach((item) => {
      item.conflict = existingIds.has(item.id);
      item.chosenAction = item.conflict ? 'keep' : 'new';
    });
  }

  function buildImportRow(item) {
    const tr = document.createElement('tr');

    const tdSelect = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.selected;
    checkbox.disabled = !!item.corrupt;
    checkbox.addEventListener('change', () => { item.selected = checkbox.checked; });
    tdSelect.appendChild(checkbox);

    const tdTitle = document.createElement('td');
    tdTitle.textContent = (item.meta.title || '(Ohne Titel)') + (item.trashed ? ' (aus dem Papierkorb)' : '');
    const tdCat = document.createElement('td');
    tdCat.textContent = item.meta.category || 'Allgemein';

    const tdTag = document.createElement('td');
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.className = 'gm-import-tag-input';
    tagInput.placeholder = 'Tag…';
    tagInput.value = item.extraTag;
    tagInput.addEventListener('input', () => { item.extraTag = tagInput.value.trim(); });
    tdTag.appendChild(tagInput);

    const tdAction = document.createElement('td');

    if (item.corrupt) {
      const badge = document.createElement('span');
      badge.className = 'gm-conflict-badge';
      badge.textContent = '❌ Beschädigt – wird nicht importiert: ' + item.problems.join('; ');
      tdAction.appendChild(badge);
    } else if (item.conflict) {
      const badge = document.createElement('span');
      badge.className = 'gm-conflict-badge';
      badge.textContent = '⚠️ Konflikt';
      const select = document.createElement('select');
      select.className = 'gg-select';
      [['keep', 'Behalten (überspringen)'], ['replace', 'Ersetzen'], ['both', 'Beide behalten']].forEach(([v, label]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = label;
        select.appendChild(o);
      });
      select.value = item.chosenAction;
      select.addEventListener('change', () => { item.chosenAction = select.value; });
      tdAction.appendChild(badge);
      tdAction.appendChild(select);
    } else {
      const badge = document.createElement('span');
      badge.className = 'gm-new-badge';
      badge.textContent = '✅ Neu importieren';
      tdAction.appendChild(badge);
    }

    tr.append(tdSelect, tdTitle, tdCat, tdTag, tdAction);
    return tr;
  }

  const PACKAGE_LABELS = {
    backup: 'Sicherung erkannt',
    share: 'Weitergabe-Paket erkannt',
    package: 'Älteres Merge-Paket erkannt',
    readable: 'Lesbares Archiv erkannt',
  };

  function renderImportPreview(parsed) {
    const GB = window.GuidesBackup;
    const wrap    = document.getElementById('gm-import-preview');
    const title   = document.getElementById('gm-import-preview-title');
    const tbody   = document.getElementById('gm-import-rows');
    const tagAll  = document.getElementById('gm-import-tag-all');
    const selectAll = document.getElementById('gm-import-select-all');
    const warning   = document.getElementById('gm-import-warning');
    const integrity = document.getElementById('gm-import-integrity');

    wrap.hidden = false;
    const trashed = parsed.items.filter((i) => i.trashed).length;
    title.textContent = PACKAGE_LABELS[parsed.packageKind] + ' – ' + parsed.items.length + ' Guide(s)' + (trashed ? ' (davon ' + trashed + ' aus dem Papierkorb)' : '');

    const lu = parsed.legacyUnreadable || [];
    const missing = [GB.describeMissing(parsed.packageKind),
      lu.length ? 'Das Paket enthält ' + GB.plural(lu.length, 'Rohkopie', 'Rohkopien') + ' aus dem Papierkorb-Altbestand, die sich nicht als Guide lesen lassen (' + lu.join(', ') + '): sie werden nicht importiert, der Inhalt bleibt in der Paketdatei erhalten.' : ''].filter(Boolean).join(' ');
    warning.textContent = missing;
    warning.hidden = !missing;

    const v = parsed.verification;
    if (!v) {
      integrity.textContent = 'Dieses Format enthält keine Prüfsummen – die Vollständigkeit der Datei kann nicht geprüft werden.';
      integrity.className = 'gm-notice';
    } else if (v.ok) {
      integrity.textContent = 'Prüfsummen geprüft: ' + GB.plural(v.guideCount, 'Guide', 'Guides') + ', ' + GB.plural(v.assetCount, 'Asset', 'Assets') + ' – alle stimmen.';
      integrity.className = 'gm-notice gm-notice--ok';
    } else {
      const lines = [...v.errors];
      Object.entries(v.guideErrors).forEach(([id, msgs]) => lines.push('Guide ' + id + ': ' + msgs.join('; ')));
      integrity.textContent = 'ACHTUNG – Prüfsummenfehler, die Datei ist beschädigt oder verändert: ' + lines.join(' | ') + '. Betroffene Guides werden nicht importiert.';
      integrity.className = 'gm-notice gm-notice--error';
    }
    integrity.hidden = false;

    tbody.replaceChildren();
    parsed.items.forEach(item => tbody.appendChild(buildImportRow(item)));

    tagAll.value = '';
    selectAll.checked = true;
  }

  async function handleZipFile(file) {
    if (typeof JSZip === 'undefined') { notify('jszip.js konnte nicht geladen werden.', 'error'); return; }
    try {
      const zip = await JSZip.loadAsync(file);
      const parsed = zip.file('_package.json') ? await parseMergePackage(zip) : await parseReadableArchive(zip);
      parsed.zip = zip;
      if (parsed.kind === 'package') await markConflicts(parsed.items);

      parsedImport = parsed;
      renderImportPreview(parsed);
    } catch (err) {
      notify('ZIP konnte nicht gelesen werden: ' + (err?.message || err), 'error');
    }
  }

  async function confirmImport() {
    if (!parsedImport) return;
    const parsed = parsedImport;
    const GB = window.GuidesBackup;
    const btn = document.getElementById('gm-import-confirm');
    btn.disabled = true;
    try {
      const exportedBy = (parsed.pkg && parsed.pkg.exportedBy) || 'import';
      const dateStr = new Date().toISOString().slice(0, 10);
      const importTag = 'import:' + dateStr + ':' + exportedBy;
      const tagForAll = (document.getElementById('gm-import-tag-all').value || '').trim();
      // Sicherung: Herkunft (importTag) bleibt wie sie war. Pakete (Sicherung, Weitergabe, älteres
      // Merge-Paket) behalten created/modified/version; das lesbare Archiv hat keine Zeitstempel.
      const keepOrigin = parsed.packageKind === 'backup';
      const keepTimes  = parsed.kind === 'package';

      let imported = 0, importedTrashed = 0, skipped = 0, corrupt = 0, assetsSaved = 0;
      const failedGuides = [], failedAssets = [];

      for (const item of parsed.items) {
        if (item.corrupt) { corrupt++; continue; }
        if (!item.selected) { skipped++; continue; }
        if (item.conflict && item.chosenAction === 'keep') { skipped++; continue; }

        const targetId = (item.conflict && item.chosenAction === 'both') ? generateUniqueId() : item.id;
        const tags = new Set(item.meta.tags || []);
        if (tagForAll) tags.add(tagForAll);
        if (item.extraTag) tags.add(item.extraTag);
        const meta = Object.assign({}, item.meta, { id: targetId, tags: [...tags] });
        if (!keepOrigin) meta.importTag = importTag;
        const label = meta.title || targetId;

        for (const assetPath of item.assetPaths) {
          const filename = assetPath.split('/').pop();
          const entry = parsed.zip.file(assetPath);
          if (!entry) { failedAssets.push(filename + ' (' + label + '): fehlt im Paket'); continue; }
          const blob = await entry.async('blob');
          const res = await window.GuidesDB.saveAsset(targetId, filename, blob);
          if (res.success) assetsSaved++;
          else failedAssets.push(filename + ' (' + label + '): ' + (res.error || 'Fehler'));
        }

        const res = await window.GuidesDB.saveGuide(targetId, meta, item.content, { keepModified: keepTimes });
        if (res.success) { imported++; if (meta.trashedAt) importedTrashed++; }
        else failedGuides.push(label + ': ' + (res.error || 'Fehler'));
      }

      let categoryNote = '';
      if (parsed.categoriesFromPkg && parsed.categoriesFromPkg.length) {
        if (parsed.categoriesCorrupt) {
          categoryNote = 'Kategorienbaum NICHT übernommen (Prüfsummenfehler)';
        } else {
          const merged = GB.mergeCategories(categoriesState, parsed.categoriesFromPkg);
          if (merged.changed) {
            const saved = await window.GuidesDB.saveCategories(merged.tree);
            if (saved.success) {
              categoriesState = merged.tree;
              categoryNote = 'Kategorienbaum zusammengeführt (' + merged.added + ' Kategorie(n), ' + merged.addedSubs + ' Unterkategorie(n) ergänzt)';
            } else categoryNote = 'Kategorienbaum NICHT gespeichert: ' + (saved.error || 'Fehler');
          }
        }
      }

      const parts = [GB.plural(imported, 'Guide', 'Guides') + ' importiert' + (importedTrashed ? ' (davon ' + importedTrashed + ' im Papierkorb)' : '') +
        ', ' + GB.plural(assetsSaved, 'Asset', 'Assets') + ' gespeichert'];
      if (skipped) parts.push(skipped + ' übersprungen (abgewählt oder Konflikt „Behalten“)');
      if (corrupt) parts.push(GB.plural(corrupt, 'Guide', 'Guides') + ' NICHT importiert (Prüfsummenfehler)');
      if (failedGuides.length) parts.push(GB.plural(failedGuides.length, 'Guide', 'Guides') + ' NICHT importiert: ' + failedGuides.join('; '));
      if (failedAssets.length) parts.push(GB.plural(failedAssets.length, 'Asset', 'Assets') + ' NICHT gespeichert: ' + failedAssets.join('; '));
      if (categoryNote) parts.push(categoryNote);
      if ((parsed.legacyUnreadable || []).length) parts.push(GB.plural(parsed.legacyUnreadable.length, 'Papierkorb-Rohkopie', 'Papierkorb-Rohkopien') + ' aus dem Paket nicht als Guide lesbar und NICHT importiert (' + parsed.legacyUnreadable.join(', ') + ') – der Inhalt bleibt in der Paketdatei erhalten, bitte die Datei aufbewahren');
      const lossy = parsed.packageKind === 'readable' || parsed.packageKind === 'package' || (parsed.legacyUnreadable || []).length > 0;
      if (lossy) parts.push('Nicht im Paket enthalten: ' + (parsed.packageKind === 'readable'
        ? 'Tags, Favoriten, Zeitstempel, Unterkategorien, private Notizen, Kategorienbaum'
        : 'Links, Anhänge, private Notizen, Versionsangaben'));
      const failed = corrupt || failedGuides.length || failedAssets.length || /NICHT/.test(categoryNote);

      document.getElementById('gm-import-preview').hidden = true;
      parsedImport = null;
      showResult(parts.join('. ') + '.', failed ? 'error' : (lossy ? 'warning' : 'success'));
      refreshBackupIndicator();
      await loadAll();
    } finally {
      btn.disabled = false;
    }
  }

  function initImportZone() {
    const zone = document.getElementById('gm-import-zone');
    const fileInput = document.getElementById('gm-import-file');

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleZipFile(file);
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) handleZipFile(file);
    });

    document.getElementById('gm-import-confirm').addEventListener('click', confirmImport);

    document.getElementById('gm-import-select-all').addEventListener('change', (e) => {
      const checked = e.target.checked;
      if (parsedImport) parsedImport.items.forEach((item) => { item.selected = checked && !item.corrupt; });
      document.querySelectorAll('#gm-import-rows input[type="checkbox"]').forEach((cb) => { cb.checked = checked && !cb.disabled; });
    });
  }

  // ── Kategorien verwalten ─────────────────────────────────
  async function persistCategories() {
    const res = await window.GuidesDB.saveCategories(categoriesState);
    if (!res.success) notify(res.error || 'Kategorien konnten nicht gespeichert werden.', 'error');
  }

  function renderCategoryManageList() {
    const container = document.getElementById('gm-cat-manage-list');
    container.replaceChildren();
    categoriesState.forEach((cat, index) => container.appendChild(buildCategoryRow(cat, index)));
  }

  function buildCategoryRow(cat, index) {
    const row = document.createElement('div');
    row.className = 'gm-cat-row';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'gm-cat-color';
    colorInput.value = resolveToHex(cat.color);
    colorInput.addEventListener('input', async () => {
      categoriesState[index].color = colorInput.value;
      await persistCategories();
    });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'gm-cat-name-input';
    nameInput.value = cat.name;
    nameInput.addEventListener('change', async () => {
      const newName = nameInput.value.trim();
      if (!newName) { nameInput.value = cat.name; return; }
      categoriesState[index].name = newName;
      await persistCategories();
      renderCategoryManageList();
    });

    const count = document.createElement('span');
    count.className = 'gm-cat-count-badge';
    const guideCount = categoryCounts[cat.name] || 0;
    count.textContent = guideCount + ' Guide' + (guideCount === 1 ? '' : 's');

    const actions = document.createElement('div');
    actions.className = 'gm-cat-actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button'; upBtn.textContent = '↑'; upBtn.title = 'Nach oben';
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => swapCategories(index, index - 1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button'; downBtn.textContent = '↓'; downBtn.title = 'Nach unten';
    downBtn.disabled = index === categoriesState.length - 1;
    downBtn.addEventListener('click', () => swapCategories(index, index + 1));

    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.textContent = '🗑️';
    delBtn.disabled = guideCount > 0;
    delBtn.title = guideCount > 0 ? 'Nur löschbar wenn 0 Guides zugeordnet sind' : 'Kategorie löschen';
    delBtn.addEventListener('click', async () => {
      if (guideCount > 0) { notify('Kategorie enthält noch ' + guideCount + ' Guide(s).', 'error'); return; }
      categoriesState.splice(index, 1);
      await persistCategories();
      renderCategoryManageList();
    });

    actions.append(upBtn, downBtn, delBtn);
    row.append(colorInput, nameInput, count, actions);
    return row;
  }

  async function swapCategories(i, j) {
    if (j < 0 || j >= categoriesState.length) return;
    [categoriesState[i], categoriesState[j]] = [categoriesState[j], categoriesState[i]];
    await persistCategories();
    renderCategoryManageList();
  }

  function initAddCategory() {
    document.getElementById('gm-add-category').addEventListener('click', async () => {
      const name = (prompt('Name der neuen Kategorie:') || '').trim();
      if (!name) return;
      if (categoriesState.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        notify('Kategorie „' + name + '“ existiert bereits.', 'error');
        return;
      }
      categoriesState.push({ name, color: '#7c8cf8', subcategories: [] });
      await persistCategories();
      renderCategoryManageList();
    });
  }

  // ── Papierkorb ───────────────────────────────────────────
  async function loadTrash() {
    const res = await window.GuidesDB.listTrash();
    const list = document.getElementById('gm-trash-list');
    const emptyMsg = document.getElementById('gm-trash-empty');
    list.replaceChildren();
    const items = (res.success && res.guides) || [];
    items.forEach(item => list.appendChild(buildTrashRow(item)));

    // Assets im Papierkorb (aus "Verwaiste Assets prüfen")
    const assetRes = await window.GuidesDB.listTrashedAssets();
    const assetItems = (assetRes.success && assetRes.items) || [];
    const assetList = document.getElementById('gm-trash-assets-list');
    assetList.replaceChildren();
    document.getElementById('gm-trash-assets-title').hidden = !assetItems.length;
    const titles = new Map();
    allGuidesCache.forEach(g => titles.set(g.id, g.meta.title));
    items.forEach(g => titles.set(g.id, g.meta.title));
    assetItems.forEach(it => assetList.appendChild(buildTrashAssetRow(it, titles.get(it.guideId) || it.guideId)));
    emptyMsg.hidden = items.length > 0 || assetItems.length > 0;
  }

  function buildTrashAssetRow(it, guideTitle) {
    const row = document.createElement('div');
    row.className = 'gm-trash-item gm-trash-asset-row';
    row.dataset.guide = it.guideId;
    row.dataset.file = it.filename;

    const info = document.createElement('div');
    info.className = 'gm-trash-info';
    const title = document.createElement('strong');
    title.textContent = it.filename;
    const meta = document.createElement('span');
    meta.className = 'gm-trash-meta';
    meta.textContent = guideTitle + ' · ' + formatFileSize(it.size) + (it.trashedAt ? ' · Verschoben: ' + fmtDate(it.trashedAt) : '');
    info.append(title, meta);

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'gs-folder-btn gm-trash-asset-restore';
    restoreBtn.textContent = '↩️ Wiederherstellen';
    restoreBtn.addEventListener('click', async () => {
      const res = await window.GuidesDB.restoreAsset(it.guideId, it.trashName);
      if (res.success) { notify('Datei wiederhergestellt.', 'success'); await loadAll(); }
      else notify(res.error || 'Fehler beim Wiederherstellen.', 'error');
    });

    const actions = document.createElement('div');
    actions.className = 'gm-trash-actions';
    actions.appendChild(restoreBtn);
    row.append(info, actions);
    return row;
  }

  function buildTrashRow(item) {
    const row = document.createElement('div');
    row.className = 'gm-trash-item';

    const info = document.createElement('div');
    info.className = 'gm-trash-info';
    const title = document.createElement('strong');
    title.textContent = item.meta.title || '(Ohne Titel)';
    const meta = document.createElement('span');
    meta.className = 'gm-trash-meta';
    meta.textContent = (item.meta.category || 'Allgemein') + ' · Gelöscht: ' + fmtDate(item.meta.trashedAt);
    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'gm-trash-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'gs-folder-btn';
    restoreBtn.textContent = '↩️ Wiederherstellen';
    restoreBtn.addEventListener('click', async () => {
      const res = await window.GuidesDB.restoreGuide(item.id);
      if (res.success) { notify('Wiederhergestellt.', 'success'); await loadAll(); }
      else notify(res.error || 'Fehler beim Wiederherstellen.', 'error');
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'gv-delete-btn gs-folder-btn';
    delBtn.textContent = '🗑️ Endgültig löschen';
    delBtn.addEventListener('click', async () => {
      if (!confirm('„' + (item.meta.title || 'Guide') + '“ endgültig löschen? Das kann nicht rückgängig gemacht werden.')) return;
      const res = await window.GuidesDB.permanentDelete(item.id);
      if (res.success) { notify('Endgültig gelöscht.', 'success'); await loadAll(); }
      else notify(res.error || 'Fehler beim Löschen.', 'error');
    });

    actions.append(restoreBtn, delBtn);
    row.append(info, actions);
    return row;
  }

  function initEmptyTrash() {
    document.getElementById('gm-empty-trash').addEventListener('click', async () => {
      const db = window.GuidesDB;
      const res = await db.listTrash();
      const items = (res.success && res.guides) || [];
      const assetRes = await db.listTrashedAssets();
      const assetItems = (assetRes.success && assetRes.items) || [];
      if (!items.length && !assetItems.length) { notify('Papierkorb ist bereits leer.', 'success'); return; }
      const what = [items.length ? items.length + ' Guide(s)' : '', assetItems.length ? assetItems.length + ' Datei(en) (Assets)' : ''].filter(Boolean).join(' und ');
      if (!confirm('Papierkorb wirklich leeren? ' + what + ' werden endgültig gelöscht. Das kann nicht rückgängig gemacht werden.')) return;
      // Assets zuerst: permanentDelete() eines Guides entfernt dessen Papierkorb-Assets mit
      const purged = await db.purgeTrashedAssets(assetItems.map(a => ({ guideId: a.guideId, trashName: a.trashName })));
      let guideFailed = 0;
      for (const item of items) { const r = await db.permanentDelete(item.id); if (!r.success) guideFailed++; }
      const failed = (purged.failed || 0) + guideFailed;
      notify(failed ? 'Papierkorb teilweise geleert: ' + failed + ' Eintrag/Einträge konnten nicht gelöscht werden.' : 'Papierkorb geleert.', failed ? 'error' : 'success');
      await loadAll();
    });
  }

  // ── Dateiverwaltung (Anhänge über alle Guides hinweg) ────
  // Zeigt nur guide.meta.attachments (das "📎 Dateien"-Feature aus Guide
  // anlegen/-Ansicht) – Bilder und Link-Offline-Kopien sind hier bewusst
  // nicht mit aufgeführt, die gehören konzeptionell zum Guide-Inhalt selbst.
  function formatFileSize(bytes) {
    if (bytes == null) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return (i === 0 ? val : val.toFixed(1)) + ' ' + units[i];
  }

  function renderFileManager(guides) {
    const listEl  = document.getElementById('gm-files-list');
    const emptyEl = document.getElementById('gm-files-empty');
    listEl.replaceChildren();
    const withFiles = guides.filter(g => Array.isArray(g.meta.attachments) && g.meta.attachments.length);
    emptyEl.hidden = withFiles.length > 0;
    withFiles.forEach(g => listEl.appendChild(buildFileGuideGroup(g)));
  }

  function buildFileGuideGroup(guide) {
    const group = document.createElement('div');
    group.className = 'gm-files-guide-group';

    const title = document.createElement('div');
    title.className = 'gm-files-guide-title';
    title.textContent = guide.meta.title || '(Ohne Titel)';
    group.appendChild(title);

    guide.meta.attachments.forEach((att) => group.appendChild(buildFileRow(guide.id, att)));
    return group;
  }

  function buildFileRow(guideId, att) {
    const row = document.createElement('div');
    row.className = 'gv-attachment-row';

    const name = document.createElement('span');
    name.className = 'gv-attachment-name';
    name.textContent = att.name + (att.size != null ? ' (' + formatFileSize(att.size) + ')' : '');
    row.appendChild(name);

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'gs-folder-btn';
    downloadBtn.textContent = '📥 Herunterladen';
    downloadBtn.addEventListener('click', () => downloadManagedFile(guideId, att, downloadBtn));
    row.appendChild(downloadBtn);

    return row;
  }

  async function downloadManagedFile(guideId, att, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Lade…';
    try {
      const res = await window.GuidesDB.getAssetUrl(guideId, att.assetFile);
      if (!res.success) throw new Error(res.error || 'Datei nicht gefunden.');
      const blob = await (await fetch(res.url)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('Download fehlgeschlagen: ' + (err?.message || err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function initFileManager() {
    const toggleBtn = document.getElementById('gm-files-toggle');
    const listEl = document.getElementById('gm-files-list');
    toggleBtn.addEventListener('click', () => {
      const willShow = listEl.hidden;
      listEl.hidden = !willShow;
      toggleBtn.textContent = willShow ? '📂 Dateien ausblenden' : '📂 Dateien anzeigen';
      if (willShow) renderFileManager(allGuidesCache);
    });
  }

  // ── Statistik ────────────────────────────────────────────
  function renderStats(guides) {
    const container = document.getElementById('gm-stats');
    container.replaceChildren();

    const total = document.createElement('div');
    total.className = 'gm-stat-total';
    total.textContent = guides.length + ' Guide' + (guides.length === 1 ? '' : 's') + ' gesamt';
    container.appendChild(total);

    if (!guides.length) return;

    const counts = {};
    guides.forEach((g) => {
      const c = g.meta.category || 'Allgemein';
      counts[c] = (counts[c] || 0) + 1;
    });
    const maxCount = Math.max(1, ...Object.values(counts));

    const barsWrap = document.createElement('div');
    barsWrap.className = 'gm-stat-bars';
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
      const row = document.createElement('div');
      row.className = 'gm-stat-bar-row';
      const label = document.createElement('span');
      label.className = 'gm-stat-bar-label';
      label.textContent = name + ' (' + count + ')';
      const track = document.createElement('div');
      track.className = 'gm-stat-bar-track';
      const fill = document.createElement('div');
      fill.className = 'gm-stat-bar-fill';
      fill.style.width = Math.round((count / maxCount) * 100) + '%';
      fill.style.background = categoryColorLookup(name);
      track.appendChild(fill);
      row.append(label, track);
      barsWrap.appendChild(row);
    });
    container.appendChild(barsWrap);

    let green = 0, amber = 0, red = 0;
    guides.forEach((g) => {
      const months = (Date.now() - new Date(g.meta.modified).getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (months < 6) green++; else if (months < 12) amber++; else red++;
    });
    const ampelRow = document.createElement('div');
    ampelRow.className = 'gm-ampel-summary';
    [['🟢 ', green], ['🟡 ', amber], ['🔴 ', red]].forEach(([icon, n]) => {
      const span = document.createElement('span');
      span.textContent = icon + n;
      ampelRow.appendChild(span);
    });
    container.appendChild(ampelRow);

    const oldest = [...guides].sort((a, b) => new Date(a.meta.created) - new Date(b.meta.created))[0];
    const recent = [...guides].sort((a, b) => new Date(b.meta.modified) - new Date(a.meta.modified))[0];

    const extra = document.createElement('div');
    extra.className = 'gm-stat-extra';

    const line1 = document.createElement('div');
    line1.append('Ältester Guide: ');
    const b1 = document.createElement('strong');
    b1.textContent = oldest.meta.title || '–';
    line1.append(b1, ' (' + fmtDate(oldest.meta.created) + ')');

    const line2 = document.createElement('div');
    line2.append('Zuletzt geändert: ');
    const b2 = document.createElement('strong');
    b2.textContent = recent.meta.title || '–';
    line2.append(b2, ' (' + fmtDate(recent.meta.modified) + ')');

    extra.append(line1, line2);
    container.appendChild(extra);
  }

  // ── Init ─────────────────────────────────────────────────
  document.addEventListener('guides-db-connected', loadAll);
  document.addEventListener('guides-db-disconnected', loadAll);

  document.addEventListener('DOMContentLoaded', async () => {
    const nameInput = document.getElementById('gm-export-name');
    nameInput.value = localStorage.getItem(EXPORT_NAME_KEY) || '';

    initStatusActions();
    initHowtoHintReset();
    initImportZone();
    initAddCategory();
    initEmptyTrash();
    initFileManager();
    document.getElementById('gm-export-btn').addEventListener('click', handleExport);
    // "Jetzt Backup erstellen" = vollständige Sicherung aller Guides (nie das lesbare Archiv)
    document.getElementById('gm-quick-backup-btn').addEventListener('click', () => {
      document.querySelector('input[name="gm-scope"][value="all"]').checked = true;
      document.querySelector('input[name="gm-format"][value="full"]').checked = true;
      updateFormatNotices();
      handleExport();
    });
    document.querySelectorAll('input[name="gm-format"], input[name="gm-scope"]').forEach((r) => r.addEventListener('change', updateFormatNotices));
    updateFormatNotices();

    await window.GuidesDB.restoreFolder();
    await loadAll();
  });
})();
