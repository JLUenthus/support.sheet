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

  // ── Export (Markdown / PDF / Word) ──────────────────────
  function sanitizeForFilename(str) {
    const cleaned = (str || 'Unbenannt').replace(/[/\\:*?"<>|]/g, '').trim().replace(/\s+/g, '-');
    return cleaned || 'Unbenannt';
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

  // Links/Dateien stehen nur in meta, nicht im Content-Text – ohne diesen
  // Anhang würden sie beim reinen Markdown-Export unsichtbar verloren gehen.
  function appendLinksAndAttachmentsMarkdown(content, meta) {
    let result = content;
    const links = Array.isArray(meta.links) ? meta.links.filter((l) => l.url) : [];
    if (links.length) {
      result += '\n\n## Links\n' + links.map((l) => {
        const label = l.text && l.text.trim() ? l.text.trim() : null;
        return '- ' + (label ? '[' + label + '](' + l.url + ')' : l.url);
      }).join('\n') + '\n';
    }
    const attachments = Array.isArray(meta.attachments) ? meta.attachments : [];
    if (attachments.length) {
      result += '\n\n## Dateien\n' + attachments.map((a) => '- ' + a.name).join('\n') + '\n';
    }
    return result;
  }

  function exportMarkdown() {
    const content = appendLinksAndAttachmentsMarkdown(currentContent || '', currentMeta);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, sanitizeForFilename(currentMeta.title) + '.md');
    notify('Als Markdown exportiert.', 'success');
  }

  // Nutzt den Browser-Druckdialog ("Als PDF speichern") statt einer
  // eigenen PDF-Bibliothek – liefert echten, durchsuchbaren Text statt
  // eines gerasterten Bilds. Die Druckansicht (siehe @media print in
  // guides.css) blendet Sidebar/Aktionen/Private Notiz aus.
  function exportPdf() {
    window.print();
  }

  // blob:-URLs (aus resolveAssetUrls) gelten nur innerhalb der aktuellen
  // Seite/Session – eine gespeicherte .docx, die später (oder auf einem
  // anderen Gerät) geöffnet wird, kann sie nicht mehr auflösen und zeigt
  // ein kaputtes Bild-Symbol. Deshalb hier jedes <img> auf ein
  // eigenständiges Base64-Data-URL umstellen, bevor das Dokument gebaut
  // wird – das Bild ist dann fest im Dokument eingebettet.
  async function inlineImagesAsDataUrls(container) {
    const imgs = [...container.querySelectorAll('img[src^="blob:"]')];
    await Promise.all(imgs.map(async (img) => {
      try {
        const blob = await (await fetch(img.src)).blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        img.src = dataUrl;
      } catch { /* einzelnes Bild überspringen, Rest des Dokuments trotzdem exportieren */ }
    }));
  }

  // Baut aus dem bereits gerenderten Guide-Inhalt ein eigenständiges
  // HTML-Dokument und lässt html-docx-js daraus eine echte .docx-Datei
  // erzeugen. Die private Notiz ist hier nie Teil der Quelle (steht nur
  // im Header, nicht in #gv-content), wird also nie mit exportiert.
  async function exportDocx() {
    if (typeof htmlDocx === 'undefined') {
      notify('Word-Export ist gerade nicht verfügbar (html-docx.min.js nicht geladen).', 'error');
      return;
    }
    const contentEl = document.getElementById('gv-content');
    const title = currentMeta.title || '(Ohne Titel)';
    // Klon statt Original: UI-Elemente, die nur in der Live-Ansicht Sinn
    // ergeben (Code-Kopieren-Button), gehören nicht in ein statisches
    // Dokument und werden vor dem Export entfernt.
    const clone = contentEl.cloneNode(true);
    clone.querySelectorAll('.gv-code-copy').forEach(btn => btn.remove());
    await inlineImagesAsDataUrls(clone);

    const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;');

    // Links/Dateien stehen nur in meta, nicht in #gv-content – ohne diesen
    // Anhang würden sie beim Word-Export unsichtbar verloren gehen.
    let extraHtml = '';
    const links = Array.isArray(currentMeta.links) ? currentMeta.links.filter((l) => l.url) : [];
    if (links.length) {
      extraHtml += '<h2>Links</h2><ul>' + links.map((l) => {
        const label = l.text && l.text.trim() ? l.text.trim() : l.url;
        return '<li><a href="' + escapeHtml(l.url) + '">' + escapeHtml(label) + '</a></li>';
      }).join('') + '</ul>';
    }
    const attachments = Array.isArray(currentMeta.attachments) ? currentMeta.attachments : [];
    if (attachments.length) {
      extraHtml += '<h2>Dateien</h2><ul>' + attachments.map((a) =>
        '<li>' + escapeHtml(a.name) + '</li>').join('') + '</ul>';
    }

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'
      + '<h1>' + escapeHtml(title) + '</h1>'
      + clone.innerHTML
      + extraHtml
      + '</body></html>';
    try {
      const blob = htmlDocx.asBlob(html);
      downloadBlob(blob, sanitizeForFilename(title) + '.docx');
      notify('Als Word-Dokument exportiert.', 'success');
    } catch (err) {
      notify('Word-Export fehlgeschlagen: ' + (err?.message || err), 'error');
    }
  }

  function initExportMenu() {
    const wrap = document.querySelector('.gv-export-wrap');
    const btn = document.getElementById('gv-export-btn');
    const menu = document.getElementById('gv-export-menu');
    if (!wrap || !btn || !menu) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !wrap.contains(e.target)) menu.hidden = true;
    });

    document.getElementById('gv-export-md').addEventListener('click', () => { menu.hidden = true; exportMarkdown(); });
    document.getElementById('gv-export-pdf').addEventListener('click', () => { menu.hidden = true; exportPdf(); });
    document.getElementById('gv-export-docx').addEventListener('click', () => { menu.hidden = true; exportDocx(); });
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

  // ── Links (mit optionaler Offline-Kopie) ────────────────
  function renderLinks() {
    const section = document.getElementById('gv-links');
    const list = document.getElementById('gv-links-list');
    if (!section || !list) return;

    const links = Array.isArray(currentMeta.links) ? currentMeta.links : [];
    if (!links.length) { section.hidden = true; return; }

    list.replaceChildren();
    links.forEach((link) => list.appendChild(buildLinkRow(link)));
    section.hidden = false;
  }

  function buildLinkRow(link) {
    const wrapper = document.createElement('div');
    wrapper.className = 'gv-link-item';

    const row = document.createElement('div');
    row.className = 'gv-link-row';

    const urlText = document.createElement('span');
    urlText.className = 'gv-link-url';
    urlText.textContent = link.url;

    if (link.text && link.text.trim()) {
      const textCol = document.createElement('div');
      textCol.className = 'gv-link-text-col';
      const labelEl = document.createElement('span');
      labelEl.className = 'gv-link-label';
      labelEl.textContent = link.text;
      textCol.appendChild(labelEl);
      textCol.appendChild(urlText);
      row.appendChild(textCol);
    } else {
      row.appendChild(urlText);
    }

    const actions = document.createElement('div');
    actions.className = 'gv-link-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'gv-link-copy-btn';
    copyBtn.textContent = '📋 Kopieren';
    copyBtn.addEventListener('click', () => copyText(link.url, copyBtn));
    actions.appendChild(copyBtn);

    if (link.offlineAsset) {
      const savedLabel = fmtDate(link.offlineSavedAt);
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'gs-folder-btn';
      viewBtn.textContent = '🕓 Offline-Version vom ' + savedLabel + ' anzeigen';
      viewBtn.addEventListener('click', () => viewOfflineSnapshot(link));
      actions.appendChild(viewBtn);

      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.className = 'gs-folder-btn';
      refreshBtn.textContent = '🔄 Aktualisieren';
      refreshBtn.addEventListener('click', () => downloadLinkOffline(link, refreshBtn));
      actions.appendChild(refreshBtn);
    } else {
      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'gs-folder-btn';
      downloadBtn.textContent = '📥 Offline speichern';
      downloadBtn.title = 'Best-Effort – funktioniert nur bei Seiten, die Cross-Origin-Zugriff (CORS) erlauben. Bei den meisten Websites (z.B. gewöhnliche Blogs/Wikis) blockiert der Browser das aus Sicherheitsgründen – dann bitte Strg+P → „Als PDF speichern" nutzen.';
      downloadBtn.addEventListener('click', () => downloadLinkOffline(link, downloadBtn));
      actions.appendChild(downloadBtn);
    }

    row.appendChild(actions);
    wrapper.appendChild(row);

    // Fehlermeldung bleibt eingeblendet (statt Toast, der zu schnell
    // verschwindet) und lässt sich per X gezielt schließen.
    const errorBox = document.createElement('div');
    errorBox.className = 'gv-link-error';
    errorBox.hidden = true;
    const errorText = document.createElement('span');
    errorText.className = 'gv-link-error-text';
    errorBox.appendChild(errorText);
    const errorClose = document.createElement('button');
    errorClose.type = 'button';
    errorClose.className = 'gv-link-error-close';
    errorClose.setAttribute('aria-label', 'Fehlermeldung schließen');
    errorClose.textContent = '×';
    errorClose.addEventListener('click', () => { errorBox.hidden = true; });
    errorBox.appendChild(errorClose);
    wrapper.appendChild(errorBox);

    return wrapper;
  }

  // Best-Effort: klappt nur bei Seiten, die Cross-Origin-Lesezugriff
  // erlauben (CORS) – bei den meisten echten Websites blockiert das der
  // Browser aus Sicherheitsgründen. In dem Fall: klare Fehlermeldung mit
  // Hinweis auf die manuelle Alternative (Drucken/Als PDF speichern).
  async function downloadLinkOffline(link, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Lade…';
    try {
      const res = await fetch(link.url, { mode: 'cors' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const filename = 'link-' + link.id + '.html';
      const saveRes = await window.GuidesDB.saveAsset(currentId, filename, blob);
      if (!saveRes.success) throw new Error(saveRes.error || 'Speichern fehlgeschlagen.');

      link.offlineAsset = filename;
      link.offlineSavedAt = new Date().toISOString();
      const saveGuideRes = await window.GuidesDB.saveGuide(currentId, currentMeta, currentContent);
      if (!saveGuideRes.success) throw new Error(saveGuideRes.error || 'Guide konnte nicht aktualisiert werden.');

      renderLinks();
      notify('Offline-Kopie gespeichert.', 'success');
    } catch (err) {
      const errorBox = btn.closest('.gv-link-item').querySelector('.gv-link-error');
      errorBox.querySelector('.gv-link-error-text').textContent =
        'Offline-Kopie fehlgeschlagen – die Seite blockiert vermutlich Cross-Origin-Zugriff (CORS), das kann bei den meisten Websites nicht umgangen werden. ' +
        'Alternative: Seite öffnen, Strg+P → „Als PDF speichern“, und die PDF-Datei manuell in den Guide-Inhalt einfügen.';
      errorBox.hidden = false;
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  async function viewOfflineSnapshot(link) {
    const res = await window.GuidesDB.getAssetUrl(currentId, link.offlineAsset);
    if (!res.success) { notify(res.error || 'Offline-Version konnte nicht geladen werden.', 'error'); return; }
    window.open(res.url, '_blank');
  }

  // ── Dateien (Anhänge) ────────────────────────────────────
  // Anders als Links/Bilder werden Anhänge direkt in der Guide-Ansicht
  // hinzugefügt (kein Umweg über den Editor) – deshalb schreibt
  // addAttachmentFile()/removeAttachment() sofort über saveAsset/saveGuide.
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

  function usesCacheStorage() {
    const db = window.GuidesDB;
    return !db.isFilesystemMode() || !db.isConnected();
  }

  function updateAttachmentsHint() {
    const hint = document.getElementById('gv-attachments-hint');
    if (hint) hint.hidden = !usesCacheStorage();
  }

  function renderAttachments() {
    const list = document.getElementById('gv-attachments-list');
    if (!list) return;
    const attachments = Array.isArray(currentMeta.attachments) ? currentMeta.attachments : [];
    list.replaceChildren();
    if (!attachments.length) {
      const empty = document.createElement('div');
      empty.className = 'gv-attachments-empty';
      empty.textContent = 'Noch keine Dateien hinterlegt.';
      list.appendChild(empty);
      return;
    }
    attachments.forEach((att) => list.appendChild(buildAttachmentRow(att)));
  }

  function buildAttachmentRow(att) {
    const row = document.createElement('div');
    row.className = 'gv-attachment-row';

    const name = document.createElement('span');
    name.className = 'gv-attachment-name';
    name.textContent = att.name + (att.size != null ? ' (' + formatFileSize(att.size) + ')' : '');
    row.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'gv-attachment-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'gs-folder-btn';
    downloadBtn.textContent = '📥 Herunterladen';
    downloadBtn.addEventListener('click', () => downloadAttachment(att, downloadBtn));
    actions.appendChild(downloadBtn);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'gv-attachment-remove-btn';
    removeBtn.textContent = '🗑️';
    removeBtn.setAttribute('aria-label', 'Datei entfernen');
    removeBtn.addEventListener('click', () => removeAttachment(att));
    actions.appendChild(removeBtn);

    row.appendChild(actions);
    return row;
  }

  async function downloadAttachment(att, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Lade…';
    try {
      const res = await window.GuidesDB.getAssetUrl(currentId, att.assetFile);
      if (!res.success) throw new Error(res.error || 'Datei nicht gefunden.');
      const blob = await (await fetch(res.url)).blob();
      downloadBlob(blob, att.name);
    } catch (err) {
      notify('Download fehlgeschlagen: ' + (err?.message || err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  async function removeAttachment(att) {
    if (!confirm('Datei „' + att.name + '“ wirklich entfernen?')) return;
    const previous = currentMeta.attachments;
    currentMeta.attachments = (currentMeta.attachments || []).filter((a) => a.id !== att.id);
    const res = await window.GuidesDB.saveGuide(currentId, currentMeta, currentContent);
    if (!res.success) {
      currentMeta.attachments = previous;
      notify(res.error || 'Datei konnte nicht entfernt werden.', 'error');
      return;
    }
    await window.GuidesDB.deleteAsset(currentId, att.assetFile);
    renderAttachments();
    notify('Datei entfernt.', 'success');
  }

  async function addAttachmentFile(file) {
    if (usesCacheStorage()) {
      notify('Kein Ordner verbunden – große Dateien können im Browser-Cache (IndexedDB) zu Problemen führen.', 'error');
    }
    const attId = 'att-' + Date.now();
    const assetFile = 'attachment-' + attId + '-' + sanitizeAttachmentName(file.name);
    const saveRes = await window.GuidesDB.saveAsset(currentId, assetFile, file);
    if (!saveRes.success) { notify(saveRes.error || 'Datei konnte nicht gespeichert werden.', 'error'); return; }

    const attachments = Array.isArray(currentMeta.attachments) ? currentMeta.attachments : [];
    attachments.push({ id: attId, name: file.name, size: file.size, type: file.type || '', assetFile });
    currentMeta.attachments = attachments;
    const res = await window.GuidesDB.saveGuide(currentId, currentMeta, currentContent);
    if (!res.success) { notify(res.error || 'Guide konnte nicht aktualisiert werden.', 'error'); return; }

    renderAttachments();
    notify('Datei hinzugefügt.', 'success');
  }

  function initAttachments() {
    updateAttachmentsHint();
    document.addEventListener('guides-db-connected', updateAttachmentsHint);
    document.addEventListener('guides-db-disconnected', updateAttachmentsHint);

    document.getElementById('gv-attachment-add-btn').addEventListener('click', () => {
      updateAttachmentsHint();
      document.getElementById('gv-attachment-input').click();
    });
    document.getElementById('gv-attachment-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await addAttachmentFile(file);
    });
  }

  // ── Bilder-Browser (Assets-Ordner anzeigen, umbenennen, Referenz kopieren) ──
  // Direkte Antwort auf "Bilder manchmal kaputt": zeigt was tatsächlich im
  // assets/-Ordner liegt, damit kaputte/doppelte Bild-Referenzen von Hand
  // repariert werden können, ohne den Ordner selbst öffnen zu müssen.
  const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async function buildImageRow(filename) {
    const row = document.createElement('div');
    row.className = 'gv-image-row';

    const thumb = document.createElement('img');
    thumb.className = 'gv-image-thumb';
    const urlRes = await window.GuidesDB.getAssetUrl(currentId, filename);
    if (urlRes.success) thumb.src = urlRes.url;
    row.appendChild(thumb);

    const name = document.createElement('span');
    name.className = 'gv-image-name';
    name.textContent = filename;
    row.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'gv-image-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'gs-folder-btn';
    renameBtn.textContent = '✏️ Umbenennen';
    renameBtn.addEventListener('click', () => renameImage(filename));
    actions.appendChild(renameBtn);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'gv-link-copy-btn';
    copyBtn.textContent = '📋 Zum Einfügen kopieren';
    copyBtn.addEventListener('click', () => copyText('![' + filename + '](assets/' + filename + ')', copyBtn));
    actions.appendChild(copyBtn);

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'gs-folder-btn';
    downloadBtn.textContent = '📥 Herunterladen';
    downloadBtn.addEventListener('click', () => downloadImage(filename, downloadBtn));
    actions.appendChild(downloadBtn);

    row.appendChild(actions);
    return row;
  }

  async function downloadImage(filename, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Lade…';
    try {
      const urlRes = await window.GuidesDB.getAssetUrl(currentId, filename);
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
    const listEl = document.getElementById('gv-images-list');
    if (!listEl) return;
    const res = await window.GuidesDB.listAssets(currentId);
    const images = (res.success ? res.assets : []).filter((name) => IMAGE_EXT_RE.test(name));
    listEl.replaceChildren();
    if (!images.length) {
      const empty = document.createElement('div');
      empty.className = 'gv-images-empty';
      empty.textContent = 'Keine Bilder gespeichert.';
      listEl.appendChild(empty);
      return;
    }
    for (const name of images) {
      listEl.appendChild(await buildImageRow(name));
    }
  }

  async function renameImage(oldName) {
    const input = (prompt('Neuer Dateiname:', oldName) || '').trim();
    if (!input || input === oldName) return;
    const newName = sanitizeAttachmentName(input);

    const listRes = await window.GuidesDB.listAssets(currentId);
    if ((listRes.assets || []).includes(newName)) {
      notify('Datei „' + newName + '“ existiert bereits.', 'error');
      return;
    }

    const urlRes = await window.GuidesDB.getAssetUrl(currentId, oldName);
    if (!urlRes.success) { notify(urlRes.error || 'Bild nicht gefunden.', 'error'); return; }
    const blob = await (await fetch(urlRes.url)).blob();

    const saveRes = await window.GuidesDB.saveAsset(currentId, newName, blob);
    if (!saveRes.success) { notify(saveRes.error || 'Umbenennen fehlgeschlagen.', 'error'); return; }
    await window.GuidesDB.deleteAsset(currentId, oldName);

    const oldPattern = new RegExp('assets/' + escapeRegExp(oldName), 'g');
    const updatedContent = currentContent.replace(oldPattern, 'assets/' + newName);
    let metaChanged = updatedContent !== currentContent;
    (currentMeta.attachments || []).forEach((a) => { if (a.assetFile === oldName) { a.assetFile = newName; metaChanged = true; } });
    (currentMeta.links || []).forEach((l) => { if (l.offlineAsset === oldName) { l.offlineAsset = newName; metaChanged = true; } });

    if (metaChanged) {
      currentContent = updatedContent;
      const saveGuideRes = await window.GuidesDB.saveGuide(currentId, currentMeta, currentContent);
      if (!saveGuideRes.success) { notify(saveGuideRes.error || 'Guide konnte nicht aktualisiert werden.', 'error'); return; }
    }

    notify('Bild umbenannt.', 'success');
    await renderGuide();
    await renderImageBrowser();
  }

  function initImageBrowser() {
    const toggleBtn = document.getElementById('gv-images-toggle');
    const listEl = document.getElementById('gv-images-list');
    if (!toggleBtn || !listEl) return;
    toggleBtn.addEventListener('click', async () => {
      const willShow = listEl.hidden;
      listEl.hidden = !willShow;
      toggleBtn.textContent = willShow ? '🖼️ Bilder ausblenden' : '🖼️ Bilder anzeigen';
      if (willShow) await renderImageBrowser();
    });
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
    const importSep = document.getElementById('gv-import-sep');
    if (currentMeta.importTag) {
      importRow.hidden = false;
      importSep.hidden = false;
      document.getElementById('gv-import-tag').textContent = currentMeta.importTag;
    } else {
      importRow.hidden = true;
      importSep.hidden = true;
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

    renderLinks();
    renderAttachments();
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
    initExportMenu();
    initAttachments();
    initImageBrowser();
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
