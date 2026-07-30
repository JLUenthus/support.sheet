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
  let allCategories = [];

  function notify(message, type) {
    if (typeof showToast === 'function') showToast(message, type);
  }

  // Markdown kollabiert normalerweise JEDE Anzahl Leerzeilen zu genau einem
  // Absatzabstand. Damit mehrfaches Enter im Editor auch im gerenderten
  // Guide zusätzlichen Abstand ergibt, wird jede Leerzeile über die erste
  // hinaus als eigener Spacer-Block eingefügt – außer innerhalb von
  // Code-Blöcken (```...```), da dort Whitespace ohnehin 1:1 erhalten
  // bleibt und nicht angefasst werden darf.
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

  // ── Interaktive Checklisten (GFM "- [ ]") ────────────────
  // marked rendert Task-Listen als <input type="checkbox" disabled> –
  // die n-te Checkbox im HTML entspricht der n-ten "- [ ]"/"- [x]"-Zeile
  // im rohen Markdown (marked parst linear). Zeilen innerhalb von
  // ```Code-Blöcken``` werden dabei übersprungen, damit z.B. eine
  // Doku-Zeile "- [ ] Beispiel" in einem Codebeispiel nicht mitzählt.
  function toggleCheckboxLine(content, targetIndex) {
    const lines = content.split('\n');
    let count = 0;
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = lines[i].match(/^(\s*[-*+]\s+\[)([ xX])(\].*)$/);
      if (!m) continue;
      if (count === targetIndex) {
        const newMark = m[2].trim() ? ' ' : 'x'; // aktuell markiert -> leeren, sonst -> "x"
        lines[i] = m[1] + newMark + m[3];
        return lines.join('\n');
      }
      count++;
    }
    return content;
  }

  async function toggleChecklistItem(index, box) {
    const updated = toggleCheckboxLine(currentContent, index);
    if (updated === currentContent) return;
    const previousContent = currentContent;
    currentContent = updated;
    const res = await window.GuidesDB.saveGuide(currentId, currentMeta, currentContent);
    if (!res.success) {
      currentContent = previousContent;
      box.checked = !box.checked;
      notify(res.error || 'Checkliste konnte nicht gespeichert werden.', 'error');
    }
  }

  function enhanceChecklists(container) {
    container.querySelectorAll('li > input[type="checkbox"]').forEach((box, index) => {
      box.disabled = false;
      box.classList.add('gv-checkbox');
      box.addEventListener('change', () => toggleChecklistItem(index, box));
    });
  }

  // Bilder, deren Asset nicht (mehr) gefunden wird, durch eine saubere
  // Platzhalter-Box ersetzen statt des hässlichen nativen Broken-Image-Icons.
  function enhanceImages(container) {
    container.querySelectorAll('img').forEach(img => {
      img.addEventListener('error', () => {
        const box = document.createElement('div');
        box.className = 'gv-img-broken';
        const icon = document.createElement('span');
        icon.className = 'gv-img-broken-icon';
        icon.textContent = '🖼️';
        const label = document.createElement('span');
        label.className = 'gv-img-broken-label';
        label.textContent = (img.getAttribute('alt') || 'Bild nicht gefunden') + ' – Datei fehlt';
        box.appendChild(icon);
        box.appendChild(label);
        img.replaceWith(box);
      }, { once: true });
    });
  }

  function categoryColor(name) {
    const cat = allCategories.find(c => c.name === name);
    return (cat && cat.color) || 'var(--dim)';
  }

  // ── Ähnliche Guides (Phase 12) ───────────────────────────
  // Bewusst keine [[Wiki-Link]]-Syntax (bricht bei Titel-Änderungen,
  // bräuchte Autocomplete im Editor) – stattdessen automatisches Ranking
  // nach gleicher Kategorie (+2) und gemeinsamen Tags (+1 je Tag).
  function buildRelatedTile(guide) {
    const color = categoryColor(guide.meta.category);

    const tile = document.createElement('div');
    tile.className = 'gg-tile gv-related-tile';
    tile.style.setProperty('--gg-cat-color', color);
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');

    const top = document.createElement('div');
    top.className = 'gg-tile-top';
    const title = document.createElement('h4');
    title.className = 'gg-tile-title';
    title.textContent = guide.meta.title || '(Ohne Titel)';
    top.appendChild(title);

    const badges = document.createElement('div');
    badges.className = 'gg-tile-badges';
    const badge = document.createElement('span');
    badge.className = 'gg-cat-badge';
    badge.style.setProperty('--gg-cat-color', color);
    badge.textContent = guide.meta.category || 'Allgemein';
    badges.appendChild(badge);

    tile.appendChild(top);
    tile.appendChild(badges);

    function open() { window.location.href = 'guides-view.html?id=' + encodeURIComponent(guide.id); }
    tile.addEventListener('click', open);
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });

    return tile;
  }

  async function renderRelatedGuides() {
    const section = document.getElementById('gv-related');
    const grid = document.getElementById('gv-related-grid');
    if (!section || !grid) return;

    const listRes = await window.GuidesDB.listGuides();
    if (!listRes.success) { section.hidden = true; return; }

    const myTags = Array.isArray(currentMeta.tags) ? currentMeta.tags : [];

    const scored = (listRes.guides || [])
      .filter((g) => g.id !== currentId)
      .map((g) => {
        let score = 0;
        if (currentMeta.category && g.meta.category === currentMeta.category) score += 2;
        const otherTags = Array.isArray(g.meta.tags) ? g.meta.tags : [];
        score += myTags.filter((t) => otherTags.includes(t)).length;
        return { guide: g, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (!scored.length) { section.hidden = true; return; }

    grid.replaceChildren();
    scored.forEach(({ guide }) => grid.appendChild(buildRelatedTile(guide)));
    section.hidden = false;
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
    if (currentMeta.importTag) {
      importRow.hidden = false;
      document.getElementById('gv-import-tag').textContent = currentMeta.importTag;
    } else {
      importRow.hidden = true;
    }

    const privateNoteBox = document.getElementById('gv-private-note');
    if (currentMeta.privateNote) {
      privateNoteBox.hidden = false;
      document.getElementById('gv-private-note-text').textContent = currentMeta.privateNote;
    } else {
      privateNoteBox.hidden = true;
    }

    updateFavButton();

    const contentEl = document.getElementById('gv-content');
    if (typeof marked !== 'undefined') {
      const resolved = await resolveAssetUrls(currentId, currentContent);
      contentEl.innerHTML = marked.parse(preserveBlankLines(resolved));
    } else {
      const pre = document.createElement('pre');
      pre.textContent = currentContent;
      contentEl.replaceChildren(pre);
    }
    enhanceCodeBlocks(contentEl);
    enhanceImages(contentEl);
    enhanceChecklists(contentEl);
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

    const catRes = await db.getCategories();
    allCategories = catRes.categories || [];
    await renderRelatedGuides();
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
