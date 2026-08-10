// ============================================================
// guide.sheet – guides-manage.js (Phase 7+8 – Export/Import/DB-Verwaltung)
// Export (lesbares Archiv + Merge-Paket via JSZip), Import/Merge mit
// Konflikterkennung, Kategorien-Verwaltung, Papierkorb, Statistik.
// Nutzt ausschließlich GuidesDB. Erwartet vor dieser Datei:
// guides-db.js + jszip.min.js.
// ============================================================
(function() {
  const LAST_EXPORT_KEY = 'gs-last-export';
  const EXPORT_NAME_KEY = 'gs-export-name';

  let categoriesState  = [];
  let categoryCounts   = {};
  let allGuidesCache   = [];
  let parsedImport     = null;
  let loading          = false;
  let importIdCounter  = 0;

  function notify(message, msgType) {
    if (typeof showToast === 'function') showToast(message, msgType);
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

    const lastExport = localStorage.getItem(LAST_EXPORT_KEY);
    document.getElementById('gm-status-lastexport').textContent = lastExport ? fmtDate(lastExport) : 'Noch nie';
  }

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
    document.getElementById('gm-cleanup-assets').addEventListener('click', cleanupAllOrphanedAssets);
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

  async function cleanupAllOrphanedAssets() {
    const db = window.GuidesDB;
    const listRes = await db.listGuides();
    if (!listRes.success) { notify(listRes.error || 'Guides konnten nicht gelesen werden.', 'error'); return; }
    const guides = listRes.guides || [];
    if (!guides.length) { notify('Keine Guides vorhanden.', 'success'); return; }

    let totalDeleted = 0;
    let failedGuides = 0;
    for (const g of guides) {
      const full = await db.getGuide(g.id);
      if (!full.success) { failedGuides++; continue; }
      const res = await db.cleanupOrphanedAssets(g.id, full.content || '', full.meta);
      if (res.success) totalDeleted += res.deletedCount;
      else failedGuides++;
    }

    notify(
      totalDeleted + ' verwaiste Asset(s) entfernt' + (failedGuides ? ' (' + failedGuides + ' Guide(s) übersprungen)' : '') + '.',
      'success'
    );
    await updateStatusPanel(allGuidesCache);
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

      const assetsRes = await window.GuidesDB.listAssets(g.id);
      for (const filename of (assetsRes.assets || [])) {
        const urlRes = await window.GuidesDB.getAssetUrl(g.id, filename);
        if (!urlRes.success) continue;
        const blob = await (await fetch(urlRes.url)).blob();
        zip.file(assetsFolder + filename, blob);
      }

      tocLines.push('- [' + (meta.title || 'Unbenannt') + '](' + mdPath + ') – ' + ageLabel(meta.modified));
    }

    const readme = '# Guide-Export – ' + dateStr + '\n' +
      'Exportiert von: ' + exportedBy + '\n' +
      'Guides: ' + guides.length + '\n\n' +
      '## Inhaltsverzeichnis\n' + tocLines.join('\n') + '\n';
    zip.file('README.md', readme);
  }

  async function buildMergePackage(zip, guides, exportedBy, dateStr) {
    for (const g of guides) {
      const base = 'guides/' + g.id + '/';
      // Kopie statt g.meta direkt – privateNote darf niemals in eine Export-Datei gelangen.
      const meta = { ...g.meta };
      delete meta.privateNote;
      zip.file(base + 'meta.json', JSON.stringify(meta, null, 2));
      zip.file(base + 'content.md', g.content || '');

      const assetsRes = await window.GuidesDB.listAssets(g.id);
      for (const filename of (assetsRes.assets || [])) {
        const urlRes = await window.GuidesDB.getAssetUrl(g.id, filename);
        if (!urlRes.success) continue;
        const blob = await (await fetch(urlRes.url)).blob();
        zip.file(base + 'assets/' + filename, blob);
      }
    }

    zip.file('categories.json', JSON.stringify(categoriesState, null, 2));
    zip.file('_package.json', JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      exportedBy,
      guideCount: guides.length,
      tool: 'guide.sheet',
    }, null, 2));
  }

  async function downloadZip(zip, filename) {
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleExport() {
    if (typeof JSZip === 'undefined') { notify('jszip.js konnte nicht geladen werden.', 'error'); return; }

    const scope  = document.querySelector('input[name="gm-scope"]:checked').value;
    const format = document.querySelector('input[name="gm-format"]:checked').value;
    const exportedBy = (document.getElementById('gm-export-name').value || 'anonym').trim();
    localStorage.setItem(EXPORT_NAME_KEY, exportedBy);

    const res = await window.GuidesDB.listGuides();
    if (!res.success) { notify(res.error || 'Guides konnten nicht gelesen werden.', 'error'); return; }
    let guides = res.guides || [];

    if (scope === 'category') {
      const cat = document.getElementById('gm-export-category').value;
      guides = guides.filter(g => (g.meta.category || 'Allgemein') === cat);
    } else if (scope === 'favorites') {
      guides = guides.filter(g => g.meta.favorite);
    }

    if (!guides.length) { notify('Keine Guides für diese Auswahl gefunden.', 'error'); return; }

    for (const g of guides) {
      const full = await window.GuidesDB.getGuide(g.id);
      g.content = full.success ? full.content : '';
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const zip = new JSZip();

    try {
      if (format === 'readable') {
        await buildReadableArchive(zip, guides, exportedBy, dateStr);
        await downloadZip(zip, 'guide-sheet-export-' + dateStr + '.zip');
      } else {
        await buildMergePackage(zip, guides, exportedBy, dateStr);
        await downloadZip(zip, 'guide-sheet-package-' + sanitizeForFilename(exportedBy) + '-' + dateStr + '.zip');
      }
      localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
      document.dispatchEvent(new CustomEvent('guides-backup-updated'));
      notify('Export erstellt (' + guides.length + ' Guide(s)).', 'success');
      await updateStatusPanel(allGuidesCache);
    } catch (err) {
      notify('Export fehlgeschlagen: ' + (err?.message || err), 'error');
    }
  }

  // ── Import / Merge ───────────────────────────────────────
  async function parseMergePackage(zip) {
    const pkg = JSON.parse(await zip.file('_package.json').async('string'));
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
      items.push({ id, meta, content, assetPaths, conflict: false, chosenAction: 'new', selected: true, extraTag: '' });
    }

    let categoriesFromPkg = [];
    const catFile = zip.file('categories.json');
    if (catFile) {
      try { categoriesFromPkg = JSON.parse(await catFile.async('string')); } catch { /* ignorieren */ }
    }

    return { kind: 'package', pkg, items, categoriesFromPkg };
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
    return { kind: 'readable', items, categoriesFromPkg: [] };
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
    checkbox.addEventListener('change', () => { item.selected = checkbox.checked; });
    tdSelect.appendChild(checkbox);

    const tdTitle = document.createElement('td');
    tdTitle.textContent = item.meta.title || '(Ohne Titel)';
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

    if (item.conflict) {
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

  function renderImportPreview(parsed) {
    const wrap    = document.getElementById('gm-import-preview');
    const title   = document.getElementById('gm-import-preview-title');
    const tbody   = document.getElementById('gm-import-rows');
    const tagAll  = document.getElementById('gm-import-tag-all');
    const selectAll = document.getElementById('gm-import-select-all');

    wrap.hidden = false;
    title.textContent = (parsed.kind === 'package' ? 'Merge-Paket erkannt – ' : 'Lesbares Archiv erkannt – ')
      + parsed.items.length + ' Guide(s)';
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
    const exportedBy = (parsedImport.pkg && parsedImport.pkg.exportedBy) || 'import';
    const dateStr = new Date().toISOString().slice(0, 10);
    const importTag = 'import:' + dateStr + ':' + exportedBy;
    const tagForAll = (document.getElementById('gm-import-tag-all').value || '').trim();

    let imported = 0, skipped = 0;

    for (const item of parsedImport.items) {
      if (!item.selected) { skipped++; continue; }
      if (item.conflict && item.chosenAction === 'keep') { skipped++; continue; }

      const targetId = (item.conflict && item.chosenAction === 'both') ? generateUniqueId() : item.id;
      const tags = new Set(item.meta.tags || []);
      if (tagForAll) tags.add(tagForAll);
      if (item.extraTag) tags.add(item.extraTag);
      const meta = Object.assign({}, item.meta, { id: targetId, importTag, tags: [...tags] });

      for (const assetPath of item.assetPaths) {
        const entry = parsedImport.zip.file(assetPath);
        if (!entry) continue;
        const blob = await entry.async('blob');
        const filename = assetPath.split('/').pop();
        await window.GuidesDB.saveAsset(targetId, filename, blob);
      }

      const res = await window.GuidesDB.saveGuide(targetId, meta, item.content);
      if (res.success) imported++;
      else notify(res.error || 'Guide „' + (meta.title || targetId) + '“ konnte nicht importiert werden.', 'error');
    }

    if (parsedImport.categoriesFromPkg && parsedImport.categoriesFromPkg.length) {
      const names = new Set(categoriesState.map(c => c.name));
      const merged = [...categoriesState];
      parsedImport.categoriesFromPkg.forEach((c) => { if (!names.has(c.name)) merged.push(c); });
      if (merged.length !== categoriesState.length) {
        categoriesState = merged;
        await window.GuidesDB.saveCategories(categoriesState);
      }
    }

    notify(imported + ' Guide(s) importiert' + (skipped ? ', ' + skipped + ' übersprungen' : '') + '.', 'success');
    document.getElementById('gm-import-preview').hidden = true;
    parsedImport = null;
    await loadAll();
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
      if (parsedImport) parsedImport.items.forEach((item) => { item.selected = checked; });
      document.querySelectorAll('#gm-import-rows input[type="checkbox"]').forEach((cb) => { cb.checked = checked; });
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
    emptyMsg.hidden = items.length > 0;
    items.forEach(item => list.appendChild(buildTrashRow(item)));
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
      const res = await window.GuidesDB.listTrash();
      const items = (res.success && res.guides) || [];
      if (!items.length) { notify('Papierkorb ist bereits leer.', 'success'); return; }
      if (!confirm('Papierkorb wirklich leeren? ' + items.length + ' Guide(s) werden endgültig gelöscht.')) return;
      for (const item of items) await window.GuidesDB.permanentDelete(item.id);
      notify('Papierkorb geleert.', 'success');
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
    document.getElementById('gm-quick-backup-btn').addEventListener('click', () => {
      document.querySelector('input[name="gm-scope"][value="all"]').checked = true;
      document.querySelector('input[name="gm-format"][value="readable"]').checked = true;
      handleExport();
    });

    await window.GuidesDB.restoreFolder();
    await loadAll();
  });
})();
