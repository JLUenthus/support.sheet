// ============================================================
// guide.sheet – guides-editor.js (Phase 5+6 – Editor & Import)
// Neu anlegen ODER bearbeiten (?id=), Markdown-Toolbar, Live-Vorschau,
// Bild-Upload, Entwurf (localStorage), MD/TXT/DOCX-Import.
// Nutzt ausschließlich GuidesDB für Persistenz.
// Erwartet vor dieser Datei: guides-db.js, marked.min.js,
// mammoth.min.js, turndown.min.js.
// ============================================================
(function() {
  const DRAFTS_KEY = 'gs-drafts'; // Sammlung statt Einzel-Key – mehrere Entwürfe können parallel existieren
  let currentDraftId = null; // wird beim ersten Autosave dieser Session vergeben (oder beim Wiederherstellen übernommen)

  let categories       = [];
  let tags             = [];
  let links            = []; // [{ id, url, offlineAsset, offlineSavedAt }]
  let linkIdCounter    = 0;
  let attachments        = []; // [{ id, name, size, type, assetFile }]
  let attachmentIdCounter = 0;
  const pendingAttachmentFiles = new Map(); // assetFile -> File (noch nicht gespeichert)
  let currentGuideId   = null;
  let existingMeta      = null;
  const pendingAssets     = new Map(); // filename -> File|Blob (noch nicht gespeichert)
  const assetPreviewUrls  = new Map(); // filename -> Blob-URL (nur für Live-Vorschau)
  let existingAssetNames  = new Set(); // bereits auf der Platte gespeicherte Asset-Dateinamen (Edit-Modus)
  let importImageCounter = 0;

  let titleInput, categorySelect, subcategoryInput, tagInput, tagsPillsEl, textarea, preview, privateNoteInput, privateNoteDetails, linksRowsEl, attachmentsRowsEl, attachmentsHintEl;

  // Vorschläge für häufige Status-Tags – per Klick an/abwählbar.
  const SUGGESTED_TAGS = ['unfertig', 'überarbeiten', 'wichtig', 'geprüft', 'veraltet'];

  function notify(message, type_) {
    if (typeof showToast === 'function') showToast(message, type_);
  }

  // Markdown kollabiert normalerweise JEDE Anzahl Leerzeilen zu genau einem
  // Absatzabstand. Damit mehrfaches Enter auch in der Live-Vorschau (und
  // später in der Guide-Ansicht, siehe guides-view.js) zusätzlichen Abstand
  // ergibt, wird jede Leerzeile über die erste hinaus als eigener Spacer
  // ins gerenderte HTML übernommen – außer innerhalb von Code-Blöcken
  // (```...```), da dort Whitespace ohnehin 1:1 erhalten bleibt.
  function preserveBlankLines(md) {
    if (!md) return md;
    const parts = md.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (i % 2 === 1) return part; // Code-Block – unverändert
      return part.replace(/\n{3,}/g, (match) => {
        const extra = match.length - 2;
        return '\n\n' + Array(extra).fill('<div class="gv-blank-line"></div>').join('\n\n') + '\n\n';
      });
    }).join('');
  }

  function resolveEditId() {
    return new URLSearchParams(location.search).get('id');
  }

  // ── Cursor-Helfer für die Toolbar ───────────────────────
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

  // Ohne Auswahl: eine leere Aufgabenzeile einfügen. Mit mehrzeiliger
  // Auswahl: jede nicht-leere Zeile in eine eigene Checklisten-Zeile
  // umwandeln – passt zu den anklickbaren Checklisten in der Guide-Ansicht.
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

  // ── Tags ─────────────────────────────────────────────────
  function renderTagPills() {
    tagsPillsEl.replaceChildren();
    tags.forEach((tag, i) => {
      const pill = document.createElement('span');
      pill.className = 'ge-tag-pill';
      pill.textContent = tag;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ge-tag-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Tag entfernen');
      remove.addEventListener('click', () => { tags.splice(i, 1); renderTagPills(); });
      pill.appendChild(remove);
      tagsPillsEl.appendChild(pill);
    });
    renderTagSuggestions();
    if (typeof scheduleAutosave === 'function') scheduleAutosave();
  }

  // Vorgefertigte Status-Tags, an/abwählbar per Klick – kein Enter nötig.
  function renderTagSuggestions() {
    const container = document.getElementById('ge-tag-suggestions');
    if (!container) return;
    container.replaceChildren();
    SUGGESTED_TAGS.forEach((tag) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ge-tag-suggestion' + (tags.includes(tag) ? ' active' : '');
      btn.textContent = tag;
      btn.addEventListener('click', () => {
        if (tags.includes(tag)) tags = tags.filter((t) => t !== tag);
        else tags.push(tag);
        renderTagPills();
      });
      container.appendChild(btn);
    });
  }

  function commitTag(raw) {
    const val = raw.trim();
    if (val && !tags.includes(val)) tags.push(val);
  }

  // Text aus dem Eingabefeld als Tag übernehmen – von Enter, Komma,
  // Blur (Klick woanders) und dem "+ Hinzufügen"-Button gemeinsam genutzt.
  function commitFromInput() {
    if (!tagInput.value.trim()) return;
    commitTag(tagInput.value);
    tagInput.value = '';
    renderTagPills();
  }

  function initTagsInput() {
    tagInput.addEventListener('input', () => {
      if (tagInput.value.includes(',')) {
        const parts = tagInput.value.split(',');
        const last = parts.pop();
        parts.forEach(commitTag);
        tagInput.value = last;
        renderTagPills();
      }
    });
    tagInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      commitFromInput();
    });
    // Wer einfach woanders hinklickt, soll den getippten Tag nicht verlieren.
    tagInput.addEventListener('blur', commitFromInput);

    document.getElementById('ge-tag-add-btn').addEventListener('click', commitFromInput);
  }

  // ── Links ────────────────────────────────────────────────
  // offlineAsset/offlineSavedAt werden hier nur durchgereicht (nicht im
  // Editor bearbeitet) – die Offline-Kopie wird ausschließlich in der
  // Guide-Ansicht angelegt/aktualisiert, damit ein erneutes Speichern im
  // Editor eine bereits heruntergeladene Kopie nicht verwirft.
  function renderLinks() {
    linksRowsEl.replaceChildren();
    links.forEach((link) => {
      const row = document.createElement('div');
      row.className = 'ge-link-row';

      const input = document.createElement('input');
      input.type = 'url';
      input.className = 'ge-link-input';
      input.placeholder = 'https://…';
      input.value = link.url || '';
      input.addEventListener('input', () => { link.url = input.value; scheduleAutosave(); });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ge-link-remove';
      remove.setAttribute('aria-label', 'Link entfernen');
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        links = links.filter((l) => l.id !== link.id);
        renderLinks();
        scheduleAutosave();
      });

      row.appendChild(input);
      row.appendChild(remove);
      linksRowsEl.appendChild(row);
    });
  }

  function addLinkRow(prefill) {
    links.push(Object.assign({
      id: 'link-' + Date.now() + '-' + (++linkIdCounter),
      url: '', offlineAsset: null, offlineSavedAt: null,
    }, prefill || {}));
    renderLinks();
  }

  function initLinksInput() {
    document.getElementById('ge-link-add-btn').addEventListener('click', () => { addLinkRow(); scheduleAutosave(); });
  }

  // ── Dateien (Anhänge) ────────────────────────────────────
  // Anders als Bilder werden Anhänge nicht im Entwurf (localStorage)
  // zwischengespeichert – Setup-Dateien etc. können beliebig groß sein und
  // würden das Draft-Quota sofort sprengen. Die Datei selbst wird erst beim
  // finalen Speichern (handleSave) über GuidesDB.saveAsset abgelegt.
  function formatFileSize(bytes) {
    if (bytes == null) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return (i === 0 ? val : val.toFixed(1)) + ' ' + units[i];
  }

  function sanitizeAttachmentName(name) {
    return (name || 'datei').replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  function updateAttachmentsHint() {
    if (!attachmentsHintEl) return;
    const db = window.GuidesDB;
    attachmentsHintEl.hidden = !(!db.isFilesystemMode() || !db.isConnected());
  }

  function renderAttachments() {
    attachmentsRowsEl.replaceChildren();
    attachments.forEach((att) => {
      const row = document.createElement('div');
      row.className = 'ge-attachment-row';

      const name = document.createElement('span');
      name.className = 'ge-attachment-name';
      name.textContent = att.name + (att.size != null ? ' (' + formatFileSize(att.size) + ')' : '');
      row.appendChild(name);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ge-link-remove';
      remove.setAttribute('aria-label', 'Datei entfernen');
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        attachments = attachments.filter((a) => a.id !== att.id);
        pendingAttachmentFiles.delete(att.assetFile);
        renderAttachments();
        scheduleAutosave();
      });
      row.appendChild(remove);

      attachmentsRowsEl.appendChild(row);
    });
  }

  function addAttachmentFile(file) {
    const id = 'att-' + Date.now() + '-' + (++attachmentIdCounter);
    const assetFile = 'attachment-' + id + '-' + sanitizeAttachmentName(file.name);
    attachments.push({ id, name: file.name, size: file.size, type: file.type || '', assetFile });
    pendingAttachmentFiles.set(assetFile, file);
    renderAttachments();
  }

  function initAttachmentsInput() {
    updateAttachmentsHint();
    document.addEventListener('guides-db-connected', updateAttachmentsHint);
    document.addEventListener('guides-db-disconnected', updateAttachmentsHint);

    document.getElementById('ge-attachment-add-btn').addEventListener('click', () => {
      updateAttachmentsHint();
      document.getElementById('ge-attachment-input').click();
    });
    document.getElementById('ge-attachment-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) { addAttachmentFile(file); scheduleAutosave(); }
    });
  }

  // ── Split/Editor/Vorschau-Umschalter ─────────────────────
  function initViewToggle() {
    const buttons = document.querySelectorAll('#ge-view-toggle .gg-view-btn');
    const wrap = document.getElementById('ge-editor-wrap');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        wrap.dataset.mode = btn.dataset.mode;
      });
    });
  }

  // ── Toolbar ──────────────────────────────────────────────
  function initToolbar() {
    document.querySelectorAll('#ge-toolbar button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        switch (btn.dataset.action) {
          case 'h1':        insertWrap(textarea, '# ', '', 'Überschrift'); break;
          case 'h2':        insertWrap(textarea, '## ', '', 'Überschrift'); break;
          case 'h3':        insertWrap(textarea, '### ', '', 'Überschrift'); break;
          case 'bold':      insertWrap(textarea, '**', '**', 'fett'); break;
          case 'italic':    insertWrap(textarea, '*', '*', 'kursiv'); break;
          case 'code':      insertWrap(textarea, '`', '`', 'code'); break;
          case 'codeblock': insertWrap(textarea, '\n```\n', '\n```\n', 'code'); break;
          case 'link':      insertWrap(textarea, '[', '](https://)', 'Linktext'); break;
          case 'image':     document.getElementById('ge-image-input').click(); break;
          case 'table':     insertRaw(textarea, '\n| Spalte 1 | Spalte 2 |\n|----------|----------|\n| Wert     | Wert     |\n'); break;
          case 'checklist': insertChecklist(textarea); break;
          case 'align-left':   insertWrap(textarea, '<div style="text-align:left">\n\n', '\n\n</div>', 'Text'); break;
          case 'align-center': insertWrap(textarea, '<div style="text-align:center">\n\n', '\n\n</div>', 'Text'); break;
          case 'align-right':  insertWrap(textarea, '<div style="text-align:right">\n\n', '\n\n</div>', 'Text'); break;
        }
      });
    });
  }

  // ── Bild-Upload (Toolbar + Drag&Drop) ───────────────────
  function sanitizeFilename(name) {
    return (name || '').replace(/[^a-zA-Z0-9._-]/g, '_') || ('image-' + Date.now() + '.png');
  }

  // Muss sowohl gegen bereits ausgewählte (pendingAssets) als auch gegen
  // bereits auf der Platte gespeicherte Bilder (existingAssetNames) prüfen –
  // sonst bekommt ein zweites eingefügtes Bild mit gleichem Namen (z.B. zwei
  // per Strg+V eingefügte Screenshots heißen oft beide "image.png") beim
  // Speichern denselben Dateinamen und überschreibt so lautlos das zuvor
  // bereits gespeicherte Bild (Ursache für "Bilder manchmal kaputt").
  function uniqueAssetName(name) {
    let candidate = sanitizeFilename(name);
    let i = 1;
    while (pendingAssets.has(candidate) || existingAssetNames.has(candidate)) {
      const dot = candidate.lastIndexOf('.');
      const base = dot > -1 ? candidate.slice(0, dot) : candidate;
      const ext  = dot > -1 ? candidate.slice(dot) : '';
      candidate = base + '-' + (++i) + ext;
    }
    return candidate;
  }

  function handleImageFile(file) {
    if (!file.type || !file.type.startsWith('image/')) {
      notify('Nur Bilddateien werden unterstützt.', 'error');
      return;
    }
    const filename = uniqueAssetName(file.name);
    pendingAssets.set(filename, file);
    assetPreviewUrls.set(filename, URL.createObjectURL(file));
    insertRaw(textarea, '![' + filename + '](assets/' + filename + ')');
  }

  function initImageUpload() {
    const fileInput = document.getElementById('ge-image-input');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) handleImageFile(file);
    });

    textarea.addEventListener('dragover', (e) => { e.preventDefault(); textarea.classList.add('ge-drag'); });
    textarea.addEventListener('dragleave', () => textarea.classList.remove('ge-drag'));
    textarea.addEventListener('drop', (e) => {
      e.preventDefault();
      textarea.classList.remove('ge-drag');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleImageFile(file);
    });

    // Screenshot/Bild per Strg+V direkt aus der Zwischenablage einfügen.
    // Nur abfangen wenn wirklich ein Bild im Clipboard liegt – normales
    // Text-Einfügen bleibt sonst unangetastet.
    textarea.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) handleImageFile(file);
          break;
        }
      }
    });
  }

  // ── Bilder-Browser (bereits gespeicherte Bilder anzeigen/umbenennen) ────
  // Zeigt nur Bilder, die schon auf der Platte liegen (Edit-Modus) – neu
  // eingefügte, noch ungespeicherte Bilder (pendingAssets) landen ohnehin
  // sofort als Referenz im Text und müssen hier nicht separat auftauchen.
  const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

  async function buildImageRow(filename) {
    const row = document.createElement('div');
    row.className = 'ge-image-row';

    const thumb = document.createElement('img');
    thumb.className = 'ge-image-thumb';
    if (currentGuideId) {
      const urlRes = await window.GuidesDB.getAssetUrl(currentGuideId, filename);
      if (urlRes.success) thumb.src = urlRes.url;
    }
    row.appendChild(thumb);

    const name = document.createElement('span');
    name.className = 'ge-image-name';
    name.textContent = filename;
    row.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'ge-image-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'gs-folder-btn';
    renameBtn.textContent = '✏️ Umbenennen';
    renameBtn.addEventListener('click', () => renameExistingImage(filename));
    actions.appendChild(renameBtn);

    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'gs-folder-btn';
    insertBtn.textContent = '📋 In Guide einfügen';
    insertBtn.addEventListener('click', () => insertRaw(textarea, '![' + filename + '](assets/' + filename + ')'));
    actions.appendChild(insertBtn);

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'gs-folder-btn';
    downloadBtn.textContent = '📥 Herunterladen';
    downloadBtn.addEventListener('click', () => downloadImage(filename, downloadBtn));
    actions.appendChild(downloadBtn);

    row.appendChild(actions);
    return row;
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

  async function downloadImage(filename, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Lade…';
    try {
      const urlRes = await window.GuidesDB.getAssetUrl(currentGuideId, filename);
      if (!urlRes.success) throw new Error(urlRes.error || 'Bild nicht gefunden.');
      const blob = await (await fetch(urlRes.url)).blob();
      downloadBlob(blob, filename);
    } catch (err) {
      notify('Download fehlgeschlagen: ' + (err?.message || err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  async function renderImageBrowser() {
    const listEl = document.getElementById('ge-images-list');
    if (!listEl) return;
    const images = [...existingAssetNames].filter((name) => IMAGE_EXT_RE.test(name));
    listEl.replaceChildren();
    if (!images.length) {
      const empty = document.createElement('div');
      empty.className = 'ge-images-empty';
      empty.textContent = currentGuideId ? 'Keine Bilder gespeichert.' : 'Noch kein Guide gespeichert – hier erscheinen Bilder erst nach dem ersten Speichern.';
      listEl.appendChild(empty);
      return;
    }
    for (const name of images) {
      listEl.appendChild(await buildImageRow(name));
    }
  }

  async function renameExistingImage(oldName) {
    const input = (prompt('Neuer Dateiname:', oldName) || '').trim();
    if (!input || input === oldName) return;
    const newName = sanitizeAttachmentName(input);

    if (existingAssetNames.has(newName) || pendingAssets.has(newName)) {
      notify('Datei „' + newName + '“ existiert bereits.', 'error');
      return;
    }

    const urlRes = await window.GuidesDB.getAssetUrl(currentGuideId, oldName);
    if (!urlRes.success) { notify(urlRes.error || 'Bild nicht gefunden.', 'error'); return; }
    const blob = await (await fetch(urlRes.url)).blob();

    const saveRes = await window.GuidesDB.saveAsset(currentGuideId, newName, blob);
    if (!saveRes.success) { notify(saveRes.error || 'Umbenennen fehlgeschlagen.', 'error'); return; }
    await window.GuidesDB.deleteAsset(currentGuideId, oldName);

    existingAssetNames.delete(oldName);
    existingAssetNames.add(newName);

    // Referenzen im gerade offenen (evtl. noch ungespeicherten) Text
    // aktualisieren, damit nichts verloren geht.
    textarea.value = textarea.value.split('assets/' + oldName).join('assets/' + newName);
    await updatePreview();

    notify('Bild umbenannt.', 'success');
    await renderImageBrowser();
  }

  function initImageBrowser() {
    const toggleBtn = document.getElementById('ge-images-toggle');
    const listEl = document.getElementById('ge-images-list');
    if (!toggleBtn || !listEl) return;
    toggleBtn.addEventListener('click', async () => {
      const willShow = listEl.hidden;
      listEl.hidden = !willShow;
      toggleBtn.textContent = willShow ? '🖼️ Gespeicherte Bilder ausblenden' : '🖼️ Gespeicherte Bilder anzeigen';
      if (willShow) await renderImageBrowser();
    });
  }

  // ── Live-Vorschau ────────────────────────────────────────
  async function resolveAssetsForPreview(md) {
    const regex = /assets\/([^\s)"'\]]+)/g;
    const names = new Set();
    let m;
    while ((m = regex.exec(md))) names.add(m[1]);
    if (!names.size) return md;

    const map = new Map();
    await Promise.all([...names].map(async (name) => {
      if (assetPreviewUrls.has(name)) { map.set(name, assetPreviewUrls.get(name)); return; }
      if (currentGuideId) {
        const res = await window.GuidesDB.getAssetUrl(currentGuideId, name);
        if (res.success) map.set(name, res.url);
      }
    }));

    return md.replace(regex, (match, name) => map.get(name) || match);
  }

  async function updatePreview() {
    const md = textarea.value;
    if (typeof marked !== 'undefined') {
      const resolved = await resolveAssetsForPreview(md);
      preview.innerHTML = marked.parse(preserveBlankLines(resolved));
    } else {
      const pre = document.createElement('pre');
      pre.textContent = md;
      preview.replaceChildren(pre);
    }
  }

  function initLivePreview() {
    let timer;
    textarea.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(updatePreview, 300);
    });
  }

  // ── Kategorien laden ─────────────────────────────────────
  async function loadCategories() {
    const res = await window.GuidesDB.getCategories();
    categories = res.categories || [];
    categorySelect.replaceChildren();
    categories.forEach((cat) => {
      const o = document.createElement('option');
      o.value = cat.name;
      o.textContent = cat.name;
      categorySelect.appendChild(o);
    });
  }

  // ── Entwurf (localStorage) ───────────────────────────────
  // Bilder aus pendingAssets müssen als Base64 mitgesichert werden – sonst
  // verweist der wiederhergestellte Text auf assets/*, die nie gespeichert
  // wurden (kaputtes Bild beim späteren Anzeigen des Guides).
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mime = (header.match(/data:(.*?);base64/) || [, 'image/png'])[1];
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function loadDrafts() {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function persistDrafts(drafts) {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  }

  function removeDraftById(id) {
    persistDrafts(loadDrafts().filter((d) => d.id !== id));
  }

  async function saveDraft(silent) {
    const assets = {};
    for (const [filename, file] of pendingAssets.entries()) {
      try { assets[filename] = await fileToDataUrl(file); }
      catch { /* einzelnes Bild überspringen, Rest des Entwurfs trotzdem sichern */ }
    }

    // Erster Autosave dieser Session vergibt eine eigene Draft-ID – dadurch
    // überschreibt das Bearbeiten eines Guides oder ein zweiter, parallel
    // begonnener neuer Guide nie mehr den Entwurf einer anderen Session.
    if (!currentDraftId) currentDraftId = 'draft-' + Date.now();

    const draft = {
      id: currentDraftId,
      title: titleInput.value,
      category: categorySelect.value,
      subcategory: subcategoryInput.value,
      tags: [...tags],
      content: textarea.value,
      privateNote: privateNoteInput.value,
      links: links.map((l) => ({ ...l })),
      assets,
      savedAt: new Date().toISOString(),
    };
    try {
      const drafts = loadDrafts().filter((d) => d.id !== currentDraftId);
      drafts.push(draft);
      persistDrafts(drafts);
      if (silent) updateAutosaveStatus();
      else notify('Entwurf gespeichert.', 'success');
    } catch (err) {
      if (!silent) notify('Entwurf konnte nicht gespeichert werden (evtl. zu groß mit Bildern): ' + (err?.message || err), 'error');
    }
  }

  function updateAutosaveStatus() {
    const el = document.getElementById('ge-autosave-status');
    if (!el) return;
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = 'Automatisch gespeichert um ' + time;
  }

  // Automatisches Zwischenspeichern: 3 Sekunden nach der letzten Eingabe
  // (Titel, Kategorie, Tags, Inhalt, private Notiz) wird der Entwurf still
  // im Hintergrund gesichert – ohne Toast, nur der Status-Text unten
  // aktualisiert sich. Ergänzt (ersetzt nicht) den manuellen "Entwurf
  // speichern"-Button.
  let autosaveTimer = null;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { saveDraft(true); }, 3000);
  }
  function initAutosave() {
    [titleInput, categorySelect, subcategoryInput, textarea, privateNoteInput].forEach(el => {
      el.addEventListener('input', scheduleAutosave);
      el.addEventListener('change', scheduleAutosave);
    });
  }

  function applyDraft(draft) {
    currentDraftId = draft.id;
    titleInput.value = draft.title || '';
    if (draft.category) categorySelect.value = draft.category;
    subcategoryInput.value = draft.subcategory || '';
    tags = Array.isArray(draft.tags) ? draft.tags : [];
    renderTagPills();
    textarea.value = draft.content || '';
    privateNoteInput.value = draft.privateNote || '';
    if (draft.privateNote) privateNoteDetails.open = true;
    links = Array.isArray(draft.links) ? draft.links.map((l) => ({ ...l })) : [];
    renderLinks();

    if (draft.assets) {
      Object.entries(draft.assets).forEach(([filename, dataUrl]) => {
        try {
          const blob = dataUrlToBlob(dataUrl);
          pendingAssets.set(filename, blob);
          assetPreviewUrls.set(filename, URL.createObjectURL(blob));
        } catch { /* einzelnes Bild überspringen */ }
      });
    }

    updatePreview();
  }

  function fmtDraftDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' })
      + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  }

  function buildDraftRow(draft, panel, listEl) {
    const row = document.createElement('div');
    row.className = 'ge-draft-row';

    const info = document.createElement('div');
    info.className = 'ge-draft-row-info';
    const title = document.createElement('strong');
    title.className = 'ge-draft-row-title';
    title.textContent = draft.title ? draft.title : '(Ohne Titel)';
    const meta = document.createElement('span');
    meta.className = 'ge-draft-row-meta';
    meta.textContent = fmtDraftDate(draft.savedAt);
    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'ge-draft-row-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'gs-folder-btn';
    restoreBtn.textContent = 'Wiederherstellen';
    restoreBtn.addEventListener('click', () => {
      applyDraft(draft);
      panel.hidden = true;
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'gv-confirm-btn gv-confirm-btn--cancel';
    dismissBtn.textContent = 'Verwerfen';
    dismissBtn.addEventListener('click', () => {
      removeDraftById(draft.id);
      row.remove();
      if (!listEl.children.length) panel.hidden = true;
    });

    actions.append(restoreBtn, dismissBtn);
    row.append(info, actions);
    return row;
  }

  function checkForDrafts() {
    const drafts = loadDrafts();
    if (!drafts.length) return;

    const panel  = document.getElementById('ge-draft-panel');
    const listEl = document.getElementById('ge-draft-list');
    listEl.replaceChildren();
    drafts
      .slice()
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
      .forEach((draft) => listEl.appendChild(buildDraftRow(draft, panel, listEl)));
    panel.hidden = false;
  }

  // ── Bestehenden Guide laden (Bearbeiten-Modus) ──────────
  async function loadForEdit(id) {
    const res = await window.GuidesDB.getGuide(id);
    if (!res.success) {
      notify(res.error || 'Guide konnte nicht geladen werden.', 'error');
      return;
    }
    currentGuideId = id;
    existingMeta = res.meta;
    const assetsRes = await window.GuidesDB.listAssets(id);
    existingAssetNames = new Set(assetsRes.assets || []);

    titleInput.value = res.meta.title || '';
    if (res.meta.category) categorySelect.value = res.meta.category;
    subcategoryInput.value = res.meta.subcategory || '';
    tags = Array.isArray(res.meta.tags) ? [...res.meta.tags] : [];
    renderTagPills();
    textarea.value = res.content || '';
    privateNoteInput.value = res.meta.privateNote || '';
    if (res.meta.privateNote) privateNoteDetails.open = true;
    links = Array.isArray(res.meta.links) ? res.meta.links.map((l) => ({ ...l })) : [];
    renderLinks();
    attachments = Array.isArray(res.meta.attachments) ? res.meta.attachments.map((a) => ({ ...a })) : [];
    renderAttachments();

    document.getElementById('ge-page-title').textContent = 'Guide bearbeiten';
    document.title = 'support.sheet – Guide bearbeiten';

    await updatePreview();
  }

  // ── Speichern ────────────────────────────────────────────
  async function handleSave() {
    const title = titleInput.value.trim();
    if (!title) { notify('Bitte einen Titel eingeben.', 'error'); titleInput.focus(); return; }

    const isEditMode = !!currentGuideId;
    const id = currentGuideId || window.GuidesDB.generateId();
    const meta = {
      title,
      category: categorySelect.value || 'Allgemein',
      subcategory: subcategoryInput.value.trim(),
      tags: [...tags],
      privateNote: privateNoteInput.value.trim(),
      links: links.filter((l) => l.url && l.url.trim()).map((l) => ({ ...l, url: l.url.trim() })),
      attachments: attachments.map((a) => ({ ...a })),
      favorite:  existingMeta ? existingMeta.favorite  : false,
      source:    existingMeta ? existingMeta.source    : 'manual',
      importTag: existingMeta ? existingMeta.importTag : null,
    };
    if (existingMeta && existingMeta.created) meta.created = existingMeta.created;

    for (const [filename, file] of pendingAssets.entries()) {
      const res = await window.GuidesDB.saveAsset(id, filename, file);
      if (!res.success) notify('Bild „' + filename + '“ konnte nicht gespeichert werden: ' + res.error, 'error');
    }
    for (const [assetFile, file] of pendingAttachmentFiles.entries()) {
      const res = await window.GuidesDB.saveAsset(id, assetFile, file);
      if (!res.success) notify('Datei „' + assetFile + '“ konnte nicht gespeichert werden: ' + res.error, 'error');
    }

    const res = await window.GuidesDB.saveGuide(id, meta, textarea.value);
    if (!res.success) {
      notify(res.error || 'Guide konnte nicht gespeichert werden.', 'error');
      return;
    }

    // Nur beim Bearbeiten kann es überhaupt schon alte, jetzt nicht mehr
    // referenzierte Assets geben – bei einem neuen Guide gibt es nichts
    // aufzuräumen.
    if (isEditMode) {
      const cleanupRes = await window.GuidesDB.cleanupOrphanedAssets(id, textarea.value, meta);
      if (!cleanupRes.success) {
        notify(cleanupRes.error || 'Verwaiste Assets konnten nicht bereinigt werden.', 'error');
      }
    }

    if (currentDraftId) { removeDraftById(currentDraftId); currentDraftId = null; }
    pendingAssets.clear();
    assetPreviewUrls.clear();
    pendingAttachmentFiles.clear();
    notify('Guide gespeichert.', 'success');
    window.location.href = 'guides-view.html?id=' + encodeURIComponent(id);
  }

  // ── Import: Menü ─────────────────────────────────────────
  function initImportMenu() {
    const importBtn  = document.getElementById('ge-import-btn');
    const importMenu = document.getElementById('ge-import-menu');
    const fileInput  = document.getElementById('ge-import-file');

    importBtn.addEventListener('click', () => { importMenu.hidden = !importMenu.hidden; });
    document.addEventListener('click', (e) => {
      if (!importMenu.hidden && !e.target.closest('.ge-import-wrap')) importMenu.hidden = true;
    });

    importMenu.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        fileInput.accept = btn.dataset.accept || '';
        fileInput.dataset.kind = btn.dataset.kind;
        importMenu.hidden = true;
        fileInput.click();
      });
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      const kind = e.target.dataset.kind;
      e.target.value = '';
      if (!file) return;
      if (kind === 'docx') await importDocxFile(file);
      else await importTextFile(file);
    });
  }

  async function importTextFile(file) {
    try {
      const text = await file.text();
      textarea.value = text;
      await updatePreview();
      notify('„' + file.name + '“ importiert.', 'success');
    } catch (err) {
      notify('Import fehlgeschlagen: ' + (err?.message || err), 'error');
    }
  }

  function base64ToBlob(base64, contentType) {
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: contentType });
  }

  async function importDocxFile(file) {
    if (typeof mammoth === 'undefined') { notify('mammoth.js konnte nicht geladen werden.', 'error'); return; }
    if (typeof TurndownService === 'undefined') { notify('turndown.js konnte nicht geladen werden.', 'error'); return; }

    notify('Word-Dokument wird konvertiert…', 'success');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer }, {
        convertImage: mammoth.images.imgElement((image) => image.read('base64').then((base64) => {
          const ext = ((image.contentType || 'image/png').split('/').pop() || 'png').replace('jpeg', 'jpg');
          const filename = uniqueAssetName('docx-image-' + (++importImageCounter) + '.' + ext);
          const blob = base64ToBlob(base64, image.contentType);
          pendingAssets.set(filename, blob);
          assetPreviewUrls.set(filename, URL.createObjectURL(blob));
          return { src: 'assets/' + filename };
        })),
      });

      const turndown = new TurndownService();
      textarea.value = turndown.turndown(result.value);
      await updatePreview();
      notify('„' + file.name + '“ importiert – bitte vor dem Speichern prüfen.', 'success');
      if (result.messages && result.messages.length) console.warn('mammoth-Hinweise:', result.messages);
    } catch (err) {
      notify('DOCX-Import fehlgeschlagen: ' + (err?.message || err), 'error');
    }
  }

  // ── Init ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    titleInput       = document.getElementById('ge-title');
    categorySelect   = document.getElementById('ge-category');
    subcategoryInput = document.getElementById('ge-subcategory');
    tagInput         = document.getElementById('ge-tag-input');
    tagsPillsEl      = document.getElementById('ge-tags-pills');
    textarea         = document.getElementById('ge-textarea');
    preview          = document.getElementById('ge-preview');
    privateNoteInput   = document.getElementById('ge-private-note');
    privateNoteDetails = document.getElementById('ge-private-note-details');
    linksRowsEl        = document.getElementById('ge-links-rows');
    attachmentsRowsEl  = document.getElementById('ge-attachments-rows');
    attachmentsHintEl  = document.getElementById('ge-attachments-hint');

    initTagsInput();
    renderTagPills(); // zeigt die Tag-Vorschläge auch ohne vorhandene Tags sofort an
    initLinksInput();
    initAttachmentsInput();
    initViewToggle();
    initToolbar();
    initImageUpload();
    initImageBrowser();
    initLivePreview();
    initImportMenu();
    initAutosave();

    document.getElementById('ge-save-draft').addEventListener('click', () => saveDraft(false));
    document.getElementById('ge-save').addEventListener('click', handleSave);

    await window.GuidesDB.restoreFolder();
    await loadCategories();

    const editId = resolveEditId();
    if (editId) {
      await loadForEdit(editId);
    } else {
      checkForDrafts();
    }
  });
})();
