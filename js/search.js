// ============================================================
// support.sheet – Fuse.js Search
// Nutzt #search-input aus dem Header – kein eigener DOM-Build
// Nutzt renderCommands() – keine eigene Renderlogik
// ============================================================

let _fuseInstance  = null;
let _searchTimeout = null;

const FUSE_OPTIONS = {
  threshold:          0.3,
  minMatchCharLength: 2,
  keys: [
    { name: 'cmd',  weight: 0.6 },
    { name: 'tags', weight: 0.3 },
    { name: 'desc', weight: 0.1 },
  ]
};


// ── Fuse initialisieren ───────────────────────────────────

/**
 * Initialisiert Fuse.js mit den geladenen Commands.
 * Wird von render.js nach loadCommands() aufgerufen.
 * @param {Object[]} commands
 */
function initSearch(commands) {
  _fuseInstance = new Fuse(commands, FUSE_OPTIONS);
}


// ── Suche ausführen ───────────────────────────────────────

/**
 * Sucht in den Commands und rendert das Ergebnis.
 * Leere Suche → alle Commands.
 * @param {string} query
 */
function runSearch(query) {
  const trimmed = query.trim();

  // Base: all commands or current filter
  const base = (typeof _activeFilter !== 'undefined' && _activeFilter !== 'all' && typeof getPrimaryTag === 'function')
    ? _allCommands.filter(c => getPrimaryTag(c) === _activeFilter)
    : _allCommands;

  if (trimmed.length === 0) {
    renderCommandGroups(base);
    _updateResultCount(base.length, true);
    return;
  }

  if (!_fuseInstance) return;

  const results = _fuseInstance.search(trimmed).map(r => r.item);
  // Apply active filter on top of search
  const filtered = (typeof _activeFilter !== 'undefined' && _activeFilter !== 'all' && typeof getPrimaryTag === 'function')
    ? results.filter(c => getPrimaryTag(c) === _activeFilter)
    : results;

  renderCommandGroups(filtered);
  _updateResultCount(filtered.length, false);
}


// ── Treffer-Anzeige ───────────────────────────────────────

function _updateResultCount(count, isAll) {
  const el = document.getElementById('search-result-count');
  if (!el) return;

  if (isAll) {
    el.textContent = '';
    el.hidden = true;
    return;
  }

  el.textContent = count === 0 ? 'Keine Treffer' : `${count} Treffer`;
  el.hidden = false;
}


// ── Events verdrahten ─────────────────────────────────────

/**
 * Hängt Input-Handler an das vorhandene #search-input.
 * Erstellt keinen neuen DOM-Node.
 * Wird von render.js via initSearchUI() aufgerufen.
 */
function initSearchUI() {
  const input = document.getElementById('search-input');
  if (!input) return; // kein Input im DOM → nichts tun

  // Debounced Input-Handler
  input.addEventListener('input', e => {
    clearTimeout(_searchTimeout);
    _searchTimeout = setTimeout(() => runSearch(e.target.value), 150);
  });

  // ESC: leeren + alle Commands zeigen
  input.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    input.value = '';
    input.dispatchEvent(new Event('input')); // runSearch('')
    input.blur();
  });

  // Treffer-Count unter dem Header einfügen falls noch nicht vorhanden
  if (!document.getElementById('search-result-count')) {
    const count  = document.createElement('div');
    count.id     = 'search-result-count';
    count.hidden = true;
    // Nach dem Header einfügen, vor dem Hero
    const header = document.querySelector('header');
    if (header) header.insertAdjacentElement('afterend', count);
  }
}
