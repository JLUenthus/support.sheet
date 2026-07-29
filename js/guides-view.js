// ============================================================
// guide.sheet – guides-view.js (Phase 4 – Guide-Ansicht)
// Lädt einen einzelnen Guide über GuidesDB, rendert Markdown +
// Assets, und behandelt Favorit/Bearbeiten/Löschen.
// Erwartet js/guides-db.js und js/marked.min.js VOR dieser Datei.
// ============================================================
(function() {
  let currentId = null;
  let currentMeta = null;
  let currentContent = '';

  function notify(message, type) {
    if (typeof showToast === 'function') showToast(message, type);
  }

  function resolveGuideId() {
    const hash = decodeURIComponent(location.hash || '').replace(/^#/, '');
    if (hash) return hash;
    return new URLSearchParams(location.search).get('id');
  }

  function fmtDate(iso) {
    if (!iso) return '–';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  // < 6 Monate = aktuell, 6–12 Monate = prüfen, > 12 Monate = veraltet
  function ageClass(iso) {
    if (!iso) return '';
    const days = (Date.now() - new Date(iso).getTime()) / 86400000;
    if (isNaN(days)) return '';
    if (days < 182) return 'good';
    if (days <= 365) return 'warn';
    return 'bad';
  }

  function showError(message) {
    document.getElementById('gv-loading').hidden = true;
    document.getElementById('gv-article').hidden = true;
    const err = document.getElementById('gv-error');
    err.hidden = false;
    err.textContent = message;
  }

  // ── Assets: assets/<datei> im Markdown durch Blob-URLs ersetzen ──
  async function resolveAssetUrls(guideId, markdown) {
    const regex = /assets\/([^\s)"'\]]+)/g;
    const filenames = new Set();
    let m;
    while ((m = regex.exec(markdown))) filenames.add(m[1]);
    if (!filenames.size) return markdown;

    const urlMap = new Map();
    await Promise.all([...filenames].map(async (filename) => {
      const res = await window.GuidesDB.getAssetUrl(guideId, filename);
      if (res.success) urlMap.set(filename, res.url);
    }));

    return markdown.replace(regex, (match, filename) => urlMap.get(filename) || match);
  }

  // ── Copy-Button für Code-Blöcke ──────────────────────────
  function copyText(text, btn) {
    const done = (ok) => {
      if (btn) {
        btn.textContent = ok ? '✓ Kopiert' : '✗ Fehler';
        btn.classList.toggle('copied', ok);
        setTimeout(() => { btn.textContent = '📋 Kopieren'; btn.classList.remove('copied'); }, 1500);
      }
      notify(ok ? 'Kopiert!' : 'Kopieren fehlgeschlagen', ok ? 'success' : 'error');
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => done(true)).catch(() => execFallback(text, done));
    } else {
      execFallback(text, done);
    }
  }

  function execFallback(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { done(document.execCommand('copy')); }
    catch { done(false); }
    document.body.removeChild(ta);
  }

  function enhanceCodeBlocks(container) {
    container.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (window.hljs && code) {
        try { hljs.highlightElement(code); } catch { /* Sprache nicht erkannt – Rohtext bleibt */ }
      }

      const wrap = document.createElement('div');
      wrap.className = 'gv-code-block';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gv-code-copy';
      btn.textContent = '📋 Kopieren';
      btn.addEventListener('click', () => copyText(pre.textContent, btn));
      wrap.insertBefore(btn, pre);
    });
  }

  function setAmpel(id, iso) {
    const el = document.getElementById(id);
    el.className = 'gv-ampel';
    const cls = ageClass(iso);
    if (cls) el.classList.add('gv-ampel--' + cls);
  }

  function updateFavButton() {
    const btn = document.getElementById('gv-fav-btn');
    const active = !!currentMeta.favorite;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }

  async function renderGuide() {
    document.getElementById('gv-loading').hidden = true;
    document.getElementById('gv-error').hidden = true;
    document.getElementById('gv-article').hidden = false;

    document.title = 'support.sheet – ' + (currentMeta.title || 'Guide');
    document.getElementById('gv-title').textContent = currentMeta.title || '(Ohne Titel)';
    document.getElementById('gv-cat-badge').textContent = currentMeta.category || 'Allgemein';

    const tagsEl = document.getElementById('gv-tags');
    tagsEl.replaceChildren();
    (currentMeta.tags || []).forEach(tag => {
      const span = document.createElement('span');
      span.className = 'gv-tag';
      span.textContent = tag;
      tagsEl.appendChild(span);
    });

    document.getElementById('gv-created').textContent  = fmtDate(currentMeta.created);
    document.getElementById('gv-modified').textContent = fmtDate(currentMeta.modified);
    setAmpel('gv-created-ampel', currentMeta.created);
    setAmpel('gv-modified-ampel', currentMeta.modified);
    document.getElementById('gv-source').textContent = currentMeta.source || 'manual';

    const importRow = document.getElementById('gv-import-row');
    const importSep = document.getElementById('gv-import-sep');
    if (currentMeta.importTag) {
      importRow.hidden = false;
      importSep.hidden = false;
      document.getElementById('gv-import-tag').textContent = currentMeta.importTag;
    } else {
      importRow.hidden = true;
      importSep.hidden = true;
    }

    updateFavButton();

    const contentEl = document.getElementById('gv-content');
    if (typeof marked !== 'undefined') {
      const resolved = await resolveAssetUrls(currentId, currentContent);
      contentEl.innerHTML = marked.parse(resolved);
    } else {
      const pre = document.createElement('pre');
      pre.textContent = currentContent;
      contentEl.replaceChildren(pre);
    }
    enhanceCodeBlocks(contentEl);
  }

  async function loadGuide() {
    const db = window.GuidesDB;
    currentId = resolveGuideId();

    if (!db) { showError('Datenmodul (guides-db.js) konnte nicht geladen werden.'); return; }
    if (!currentId) { showError('Keine Guide-ID angegeben (weder #hash noch ?id=).'); return; }

    await db.restoreFolder();

    if (db.isFilesystemMode() && !db.isConnected()) {
      showError('Kein Ordner verbunden. Bitte in der Seitenleiste unter „Ordner-Status“ einen Ordner auswählen.');
      return;
    }

    const res = await db.getGuide(currentId);
    if (!res.success) {
      showError(res.error || 'Guide konnte nicht geladen werden.');
      return;
    }

    currentMeta    = res.meta;
    currentContent = res.content || '';
    await renderGuide();
  }

  async function toggleFavorite() {
    currentMeta.favorite = !currentMeta.favorite;
    updateFavButton();
    const res = await window.GuidesDB.saveGuide(currentId, currentMeta, currentContent);
    if (!res.success) {
      currentMeta.favorite = !currentMeta.favorite;
      updateFavButton();
      notify(res.error || 'Favorit konnte nicht gespeichert werden.', 'error');
    }
  }

  function openConfirm()  { document.getElementById('gv-confirm-overlay').hidden = false; }
  function closeConfirm() { document.getElementById('gv-confirm-overlay').hidden = true; }

  async function confirmDelete() {
    closeConfirm();
    const res = await window.GuidesDB.deleteGuide(currentId);
    if (res.success) {
      notify('Guide in den Papierkorb verschoben.', 'success');
      setTimeout(() => { window.location.href = 'guides.html'; }, 400);
    } else {
      notify(res.error || 'Löschen fehlgeschlagen.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadGuide();

    document.getElementById('gv-fav-btn').addEventListener('click', toggleFavorite);
    document.getElementById('gv-edit-btn').addEventListener('click', () => {
      if (currentId) window.location.href = 'guides-create.html?id=' + encodeURIComponent(currentId);
    });
    document.getElementById('gv-delete-btn').addEventListener('click', openConfirm);
    document.getElementById('gv-confirm-cancel').addEventListener('click', closeConfirm);
    document.getElementById('gv-confirm-ok').addEventListener('click', confirmDelete);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const overlay = document.getElementById('gv-confirm-overlay');
      if (overlay && !overlay.hidden) { closeConfirm(); return; }
      window.location.href = 'guides.html';
    });
  });
})();
