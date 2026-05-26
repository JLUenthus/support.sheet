// ============================================================
// support.sheet – tools.js
// Lokale Einstellungen, Backup/Restore, Daten-Übersicht
// Vanilla JS · kein Framework · kein Backend · kein innerHTML
// Benötigt: settings-store.js (getSettings, SETTINGS_KEY)
// ============================================================

const FAVORITES_KEY = 'adminsheet_favorites';
const RECENT_KEY    = 'adminsheet_recent_commands';

function saveSettings(settings) {
  try {
    // Nur erlaubte Felder speichern
    const safe = {
      defaultDomain:   String(settings.defaultDomain   || '').trim(),
      defaultServer:   String(settings.defaultServer   || '').trim(),
      defaultUsername: String(settings.defaultUsername || '').trim(),
      preferredTags:   Array.isArray(settings.preferredTags)
                         ? settings.preferredTags.map(t => String(t).trim()).filter(Boolean)
                         : [],
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe));
    return true;
  } catch {
    return false;
  }
}

function hasSettings() {
  const s = getSettings();
  return !!(s.defaultDomain || s.defaultServer || s.defaultUsername || s.preferredTags.length);
}


// ── UI: Einstellungen laden / speichern ───────────────────

function loadSettingsUI() {
  const s = getSettings();
  const el = id => document.getElementById(id);

  const dom  = el('setting-domain');
  const srv  = el('setting-server');
  const usr  = el('setting-username');
  const tags = el('setting-tags');

  if (dom)  dom.value  = s.defaultDomain;
  if (srv)  srv.value  = s.defaultServer;
  if (usr)  usr.value  = s.defaultUsername;
  if (tags) tags.value = s.preferredTags.join(', ');

  updateSavedAt(s.savedAt);
}

function saveSettingsUI() {
  const el = id => document.getElementById(id);

  const domain   = (el('setting-domain')?.value   || '').trim();
  const server   = (el('setting-server')?.value   || '').trim();
  const username = (el('setting-username')?.value || '').trim();
  const tagsRaw  = (el('setting-tags')?.value     || '').trim();
  const tags     = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  const ok = saveSettings({ defaultDomain: domain, defaultServer: server,
                             defaultUsername: username, preferredTags: tags });
  if (ok) {
    showToolsToast('Einstellungen gespeichert', 'success');
    updateDataOverview();
    updateSavedAt(new Date().toISOString());
    // Profil-Status in Header neu rendern
    if (typeof updateProfileStatus === 'function') updateProfileStatus();
  } else {
    showToolsToast('Fehler beim Speichern', 'error');
  }
}

function resetSettingsUI() {
  if (!confirm('Einstellungen wirklich zurücksetzen?')) return;
  localStorage.removeItem(SETTINGS_KEY);
  loadSettingsUI();
  updateDataOverview();
  showToolsToast('Einstellungen zurückgesetzt', 'success');
  if (typeof updateProfileStatus === 'function') updateProfileStatus();
}

function updateSavedAt(iso) {
  const el = document.getElementById('settings-saved-at');
  if (!el) return;
  if (!iso) { el.textContent = '–'; return; }
  try {
    el.textContent = new Date(iso).toLocaleString('de-DE');
  } catch { el.textContent = iso; }
}


// ── UI: Daten-Übersicht ───────────────────────────────────

function updateDataOverview() {
  const set = (elId, value) => {
    const el = document.getElementById(elId);
    if (el) el.textContent = value;
  };

  // Favoriten
  try {
    const favs = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    set('overview-favorites', Array.isArray(favs) ? favs.length : 0);
  } catch { set('overview-favorites', '?'); }

  // Recently Used
  try {
    const rec = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    set('overview-recent', Array.isArray(rec) ? rec.length : 0);
  } catch { set('overview-recent', '?'); }

  // Einstellungen
  set('overview-settings', hasSettings() ? 'Gespeichert' : 'Nicht gespeichert');

  // PWA
  const isPWA = window.matchMedia('(display-mode: standalone)').matches;
  set('overview-pwa', isPWA ? 'Installiert' : 'Nicht installiert');

  // Service Worker
  set('overview-sw', 'serviceWorker' in navigator
    ? (navigator.serviceWorker.controller ? 'Aktiv' : 'Registriert (inaktiv)')
    : 'Nicht unterstützt');

  // Online
  set('overview-online', navigator.onLine ? 'Online' : 'Offline');
}


// ── Export ────────────────────────────────────────────────

function exportData() {
  try {
    const settings = getSettings();
    const favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    const recent    = JSON.parse(localStorage.getItem(RECENT_KEY)    || '[]');

    const payload = {
      version:    '1.0',
      app:        'support.sheet',
      exportedAt: new Date().toISOString(),
      settings,
      favorites:  Array.isArray(favorites) ? favorites : [],
      recent:     Array.isArray(recent)    ? recent    : [],
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `support.sheet-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToolsToast('Export erfolgreich', 'success');
  } catch (err) {
    showToolsToast('Export fehlgeschlagen', 'error');
    console.error('Export error:', err);
  }
}


// ── Import ────────────────────────────────────────────────

function importData(file) {
  if (!file || !file.name.endsWith('.json')) {
    showToolsToast('Bitte eine .json Datei wählen', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const raw = e.target.result;
      const data = JSON.parse(raw);

      // Validierung
      if (!data || typeof data !== 'object') throw new Error('Ungültiges Format');
      if (data.app && data.app !== 'support.sheet') throw new Error('Falsche App');
      if (!data.version) throw new Error('Version fehlt');

      let imported = 0;

      // Settings
      if (data.settings && typeof data.settings === 'object') {
        saveSettings(data.settings);
        imported++;
      }

      // Favorites
      if (Array.isArray(data.favorites)) {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(data.favorites));
        imported++;
      }

      // Recent
      if (Array.isArray(data.recent)) {
        localStorage.setItem(RECENT_KEY, JSON.stringify(data.recent));
        imported++;
      }

      loadSettingsUI();
      updateDataOverview();
      showToolsToast(`Import erfolgreich (${imported} Bereiche)`, 'success');
      if (typeof updateProfileStatus === 'function') updateProfileStatus();

    } catch (err) {
      showToolsToast('Import fehlgeschlagen: ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
}


// ── Daten löschen ─────────────────────────────────────────

function clearLocalData() {
  const what = [];
  const checkboxes = document.querySelectorAll('.clear-check:checked');
  if (!checkboxes.length) { showToolsToast('Nichts ausgewählt', 'error'); return; }

  checkboxes.forEach(cb => what.push(cb.value));
  const label = what.join(', ');
  if (!confirm(`Wirklich löschen: ${label}?\nDas kann nicht rückgängig gemacht werden.`)) return;

  what.forEach(key => {
    if (key === 'settings') localStorage.removeItem(SETTINGS_KEY);
    if (key === 'favorites') localStorage.removeItem(FAVORITES_KEY);
    if (key === 'recent')    localStorage.removeItem(RECENT_KEY);
  });

  loadSettingsUI();
  updateDataOverview();
  showToolsToast(`Gelöscht: ${label}`, 'success');
  if (typeof updateProfileStatus === 'function') updateProfileStatus();
}


// ── Toast (tools.html intern) ─────────────────────────────
// Nutzt showToast aus toast.js falls vorhanden, sonst eigene Mini-Impl.

function showToolsToast(message, type) {
  if (typeof showToast === 'function') {
    showToast(message, type);
    return;
  }
  // Fallback
  const t = document.createElement('div');
  t.textContent = message;
  t.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:999;
    padding:10px 18px;border-radius:9px;font-size:.82rem;font-weight:600;
    background:#1a1d2e;border:1px solid ${type==='error'?'rgba(248,113,113,.4)':'rgba(74,222,128,.4)'};
    color:${type==='error'?'#f87171':'#4ade80'};
    opacity:0;transform:translateY(8px) scale(.95);transition:all .2s;
  `;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateY(0) scale(1)'; });
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 300); }, 2500);
}


// ── Init ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettingsUI();
  updateDataOverview();

  // Speichern
  document.getElementById('settings-save-btn')?.addEventListener('click', saveSettingsUI);

  // Zurücksetzen
  document.getElementById('settings-reset-btn')?.addEventListener('click', resetSettingsUI);

  // Export
  document.getElementById('export-btn')?.addEventListener('click', exportData);

  // Import
  const importFile = document.getElementById('import-file');
  document.getElementById('import-btn')?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', e => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = ''; // reset so same file can be re-selected
  });

  // Löschen
  document.getElementById('clear-btn')?.addEventListener('click', clearLocalData);

  // Online/Offline live
  window.addEventListener('online',  () => updateDataOverview());
  window.addEventListener('offline', () => updateDataOverview());
});

// ============================================================
// Dokumentations-Modal
// ============================================================

// Whitelist – nur diese Pfade dürfen geladen werden
const DOC_WHITELIST = [
  'docs/getting-started.md',
  'docs/project-structure.md',
  'docs/adding-commands.md',
  'docs/architecture.md',
  'docs/contributing.md',
];

// ── Markdown → DOM (kein innerHTML mit rohen Daten) ────────
function renderMarkdown(text) {
  const container = document.createElement('div');
  container.className = 'doc-content';

  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Leerzeile
    if (line.trim() === '') { i++; continue; }

    // Code-Block (```)
    if (line.startsWith('```')) {
      const pre  = document.createElement('pre');
      const code = document.createElement('code');
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      code.textContent = codeLines.join('\n');
      pre.appendChild(code);
      container.appendChild(pre);
      i++; // skip closing ```
      continue;
    }

    // HR (---)
    if (/^-{3,}$/.test(line.trim())) {
      container.appendChild(document.createElement('hr'));
      i++; continue;
    }

    // Überschriften
    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h1 || h2 || h3) {
      const level  = h1 ? 1 : h2 ? 2 : 3;
      const el     = document.createElement(`h${level}`);
      el.textContent = (h1 || h2 || h3)[1];
      container.appendChild(el);
      i++; continue;
    }

    // Tabellen (| col | col |)
    if (line.startsWith('|')) {
      const table  = document.createElement('table');
      table.className = 'doc-table';
      let isHeader = true;
      while (i < lines.length && lines[i].startsWith('|')) {
        const row = lines[i];
        // Trennzeile (| --- | --- |)
        if (/^\|[\s\-:|]+\|/.test(row)) { isHeader = false; i++; continue; }
        const tr   = document.createElement('tr');
        const cells = row.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        cells.forEach(cell => {
          const td = document.createElement(isHeader ? 'th' : 'td');
          td.textContent = cell.trim();
          tr.appendChild(td);
        });
        table.appendChild(tr);
        i++;
      }
      container.appendChild(table);
      continue;
    }

    // Ungeordnete Liste (- item)
    if (/^(\s*[-*+] )/.test(line)) {
      const ul = document.createElement('ul');
      while (i < lines.length && /^(\s*[-*+] )/.test(lines[i])) {
        const li = document.createElement('li');
        li.textContent = lines[i].replace(/^\s*[-*+] /, '');
        ul.appendChild(li);
        i++;
      }
      container.appendChild(ul);
      continue;
    }

    // Geordnete Liste (1. item)
    if (/^\d+\. /.test(line)) {
      const ol = document.createElement('ol');
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        const li = document.createElement('li');
        li.textContent = lines[i].replace(/^\d+\. /, '');
        ol.appendChild(li);
        i++;
      }
      container.appendChild(ol);
      continue;
    }

    // Blockquote (> text)
    if (line.startsWith('> ')) {
      const bq = document.createElement('blockquote');
      bq.textContent = line.slice(2);
      container.appendChild(bq);
      i++; continue;
    }

    // Normaler Absatz – Inline-Formatting (`, **bold**)
    const p = document.createElement('p');
    applyInline(p, line);
    container.appendChild(p);
    i++;
  }

  return container;
}

// Inline-Formatting: `code` und **bold** ohne innerHTML
function applyInline(el, text) {
  // Teile bei `code` und **bold** auf
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  parts.forEach(part => {
    if (part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code');
      code.className = 'doc-inline-code';
      code.textContent = part.slice(1, -1);
      el.appendChild(code);
    } else if (part.startsWith('**') && part.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      el.appendChild(strong);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  });
}


// ── Modal öffnen / schließen ───────────────────────────────

let _lastDocTrigger = null; // merkt sich welche Card das Modal geöffnet hat

function openDocModal(docPath, title, triggerEl) {
  // Whitelist prüfen
  if (!DOC_WHITELIST.includes(docPath)) {
    console.warn('Doc not in whitelist:', docPath);
    return;
  }

  const overlay   = document.getElementById('doc-overlay');
  const titleEl   = document.getElementById('doc-modal-title');
  const contentEl = document.getElementById('doc-modal-content');

  if (!overlay || !titleEl || !contentEl) return;

  // Auslösendes Element merken für Focus-Return beim Schließen
  _lastDocTrigger = triggerEl || document.activeElement || null;

  titleEl.textContent = title;

  // Scroll-Position zurücksetzen bevor neuer Inhalt geladen wird
  contentEl.scrollTop = 0;
  contentEl.replaceChildren();

  // Ladeindikator
  const loader = document.createElement('div');
  loader.className = 'doc-loader';
  loader.textContent = 'Lädt…';
  contentEl.appendChild(loader);

  overlay.classList.add('doc-overlay--open');
  document.body.classList.add('doc-modal-open');

  // Fokus in Modal setzen (Accessibility)
  document.getElementById('doc-close-btn')?.focus();

  loadDoc(docPath).then(domContent => {
    contentEl.scrollTop = 0; // sicherheitshalber nochmal nach dem Render
    contentEl.replaceChildren(domContent);
  }).catch(err => {
    contentEl.replaceChildren();
    const errEl = document.createElement('p');
    errEl.className = 'doc-error';
    errEl.textContent = 'Dokument konnte nicht geladen werden: ' + err.message;
    contentEl.appendChild(errEl);
  });
}

function closeDocModal() {
  const overlay = document.getElementById('doc-overlay');
  if (!overlay) return;
  overlay.classList.remove('doc-overlay--open');
  document.body.classList.remove('doc-modal-open');

  // Fokus zurück auf die Card die das Modal geöffnet hat
  if (_lastDocTrigger && typeof _lastDocTrigger.focus === 'function') {
    _lastDocTrigger.focus();
  }
  _lastDocTrigger = null;
}

async function loadDoc(docPath) {
  const res = await fetch('./' + docPath);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return renderMarkdown(text);
}


// ── Event-Handler ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Doc-Cards
  document.querySelectorAll('[data-doc]').forEach(card => {
    card.addEventListener('click', () => {
      const docPath = card.dataset.doc;
      const title   = card.dataset.docTitle || docPath;
      openDocModal(docPath, title, card);
    });
  });

  // Schließen-Button
  document.getElementById('doc-close-btn')?.addEventListener('click', closeDocModal);

  // Overlay-Klick schließt (aber nicht Klick ins Modal)
  document.getElementById('doc-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('doc-overlay')) closeDocModal();
  });

  // ESC schließt
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDocModal();
  });
});
