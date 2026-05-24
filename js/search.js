// ============================================================
// AdminSheet – Fuse.js Search
// Vanilla JS, kein Framework
// Nutzt renderCommands() – kein eigener Renderer
// ============================================================

// Fuse.js wird via CDN in test.html geladen (vor search.js)

let _fuseInstance  = null;
let _searchTimeout = null;

const FUSE_OPTIONS = {
  threshold:         0.3,  // 0 = exakt, 1 = alles
  minMatchCharLength: 2,
  keys: [
    { name: 'cmd',  weight: 0.6 },  // höchste Gewichtung
    { name: 'tags', weight: 0.3 },  // mittel
    { name: 'desc', weight: 0.1 },  // niedrig
  ]
};


// ── Fuse initialisieren ───────────────────────────────────

/**
 * Initialisiert Fuse.js mit den geladenen Commands.
 * Muss nach loadCommands() aufgerufen werden.
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

  if (trimmed.length === 0) {
    renderCommands(_allCommands);
    updateResultCount(_allCommands.length, true);
    return;
  }

  if (!_fuseInstance) return;

  const results = _fuseInstance.search(trimmed).map(r => r.item);

  renderCommands(results);
  updateResultCount(results.length, false);
}


// ── Treffer-Anzeige ───────────────────────────────────────

/**
 * Aktualisiert die Treffer-Anzeige unter dem Suchfeld.
 * @param {number} count
 * @param {boolean} isAll
 */
function updateResultCount(count, isAll) {
  const el = document.getElementById('search-result-count');
  if (!el) return;

  if (isAll) {
    el.textContent = '';
    el.hidden = true;
    return;
  }

  el.textContent = count === 0
    ? 'Keine Treffer'
    : `${count} ${count === 1 ? 'Treffer' : 'Treffer'}`;
  el.hidden = false;
}


// ── Search Input aufbauen ─────────────────────────────────

/**
 * Erstellt das Search-UI und fügt es vor dem Container ein.
 * Kein innerHTML – alles via createElement.
 */
function initSearchUI() {
  const container = document.getElementById('commands-container');
  if (!container || document.getElementById('search-wrap')) return;

  // Wrapper
  const wrap = document.createElement('div');
  wrap.id = 'search-wrap';

  // Input
  const input = document.createElement('input');
  input.type        = 'text';
  input.id          = 'search-input';
  input.placeholder = 'Commands durchsuchen…';
  input.setAttribute('aria-label', 'Commands durchsuchen');
  input.autocomplete = 'off';
  input.spellcheck   = false;

  // Treffer-Count
  const count = document.createElement('span');
  count.id     = 'search-result-count';
  count.hidden = true;

  // Debounced Input-Handler
  input.addEventListener('input', e => {
    clearTimeout(_searchTimeout);
    _searchTimeout = setTimeout(() => runSearch(e.target.value), 150);
  });

  // ESC leert das Suchfeld
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      input.value = '';
      runSearch('');
      input.blur();
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(count);
  container.insertAdjacentElement('beforebegin', wrap);
}
