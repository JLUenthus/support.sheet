// ============================================================
// guide.sheet – guides-editor.js (Phase 5+6 – Editor & Import)
// Neu anlegen ODER bearbeiten (?id=), Markdown-Toolbar, Live-Vorschau,
// Bild-Upload, Entwurf (localStorage), MD/TXT/DOCX-Import.
// Nutzt ausschließlich GuidesDB für Persistenz.
// Erwartet vor dieser Datei: guides-db.js, marked.min.js,
// mammoth.min.js, turndown.min.js.
// ============================================================
(function() {
  const DRAFT_KEY = 'gs-draft';

  let categories       = [];
  let tags             = [];
  let type              = 'guide';
  let currentGuideId   = null;
  let existingMeta      = null;
  const pendingAssets     = new Map(); // filename -> File|Blob (noch nicht gespeichert)
  const assetPreviewUrls  = new Map(); // filename -> Blob-URL (nur für Live-Vorschau)
  let importImageCounter = 0;

  let titleInput, categorySelect, subcategoryInput, tagInput, tagsPillsEl, textarea, preview;

  function notify(message, type_) {
    if (typeof showToast === 'function') showToast(message, type_);
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
  }

  function commitTag(raw) {
    const val = raw.trim();
    if (val && !tags.includes(val)) tags.push(val);
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
      commitTag(tagInput.value);
      tagInput.value = '';
      renderTagPills();
    });
  }

  // ── Typ-Toggle ───────────────────────────────────────────
  function setType(value) {
    type = value === 'howto' ? 'howto' : 'guide';
    document.querySelectorAll('.ge-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });
  }

  function initTypeToggle() {
    document.querySelectorAll('.ge-type-btn').forEach(btn => {
      btn.addEventListener('click', () => setType(btn.dataset.type));
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
        }
      });
    });
  }

  // ── Bild-Upload (Toolbar + Drag&Drop) ───────────────────
  function sanitizeFilename(name) {
    return (name || '').replace(/[^a-zA-Z0-9._-]/g, '_') || ('image-' + Date.now() + '.png');
  }

  function uniqueAssetName(name) {
    let candidate = sanitizeFilename(name);
    let i = 1;
    while (pendingAssets.has(candidate)) {
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
      preview.innerHTML = marked.parse(resolved);
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

  async function saveDraft() {
    const assets = {};
    for (const [filename, file] of pendingAssets.entries()) {
      try { assets[filename] = await fileToDataUrl(file); }
      catch { /* einzelnes Bild überspringen, Rest des Entwurfs trotzdem sichern */ }
    }

    const draft = {
      title: titleInput.value,
      category: categorySelect.value,
      subcategory: subcategoryInput.value,
      tags: [...tags],
      type,
      content: textarea.value,
      assets,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      notify('Entwurf gespeichert.', 'success');
    } catch (err) {
      notify('Entwurf konnte nicht gespeichert werden (evtl. zu groß mit Bildern): ' + (err?.message || err), 'error');
    }
  }

  function applyDraft(draft) {
    titleInput.value = draft.title || '';
    if (draft.category) categorySelect.value = draft.category;
    subcategoryInput.value = draft.subcategory || '';
    tags = Array.isArray(draft.tags) ? draft.tags : [];
    renderTagPills();
    setType(draft.type || 'guide');
    textarea.value = draft.content || '';

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

  function checkForDraft() {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    let draft;
    try { draft = JSON.parse(raw); } catch { localStorage.removeItem(DRAFT_KEY); return; }

    const banner = document.getElementById('ge-draft-banner');
    banner.hidden = false;
    document.getElementById('ge-draft-restore').addEventListener('click', () => {
      applyDraft(draft);
      banner.hidden = true;
    }, { once: true });
    document.getElementById('ge-draft-dismiss').addEventListener('click', () => {
      localStorage.removeItem(DRAFT_KEY);
      banner.hidden = true;
    }, { once: true });
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

    titleInput.value = res.meta.title || '';
    if (res.meta.category) categorySelect.value = res.meta.category;
    subcategoryInput.value = res.meta.subcategory || '';
    tags = Array.isArray(res.meta.tags) ? [...res.meta.tags] : [];
    renderTagPills();
    setType(res.meta.type || 'guide');
    textarea.value = res.content || '';

    document.getElementById('ge-page-title').textContent = 'Guide bearbeiten';
    document.title = 'support.sheet – Guide bearbeiten';

    await updatePreview();
  }

  // ── Speichern ────────────────────────────────────────────
  async function handleSave() {
    const title = titleInput.value.trim();
    if (!title) { notify('Bitte einen Titel eingeben.', 'error'); titleInput.focus(); return; }

    const id = currentGuideId || window.GuidesDB.generateId();
    const meta = {
      title,
      category: categorySelect.value || 'Allgemein',
      subcategory: subcategoryInput.value.trim(),
      tags: [...tags],
      type,
      favorite:  existingMeta ? existingMeta.favorite  : false,
      source:    existingMeta ? existingMeta.source    : 'manual',
      importTag: existingMeta ? existingMeta.importTag : null,
    };
    if (existingMeta && existingMeta.created) meta.created = existingMeta.created;

    for (const [filename, file] of pendingAssets.entries()) {
      const res = await window.GuidesDB.saveAsset(id, filename, file);
      if (!res.success) notify('Bild „' + filename + '“ konnte nicht gespeichert werden: ' + res.error, 'error');
    }

    const res = await window.GuidesDB.saveGuide(id, meta, textarea.value);
    if (!res.success) {
      notify(res.error || 'Guide konnte nicht gespeichert werden.', 'error');
      return;
    }

    localStorage.removeItem(DRAFT_KEY);
    pendingAssets.clear();
    assetPreviewUrls.clear();
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

    initTagsInput();
    initTypeToggle();
    initViewToggle();
    initToolbar();
    initImageUpload();
    initLivePreview();
    initImportMenu();

    document.getElementById('ge-save-draft').addEventListener('click', saveDraft);
    document.getElementById('ge-save').addEventListener('click', handleSave);

    await window.GuidesDB.restoreFolder();
    await loadCategories();

    const editId = resolveEditId();
    if (editId) {
      await loadForEdit(editId);
    } else {
      checkForDraft();
    }
  });
})();
