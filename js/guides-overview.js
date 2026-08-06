// ============================================================
// guide.sheet – guides-overview.js (Phase 3 – Guides-Übersicht)
// Kachel-/Listenansicht für guides.html: Suche, Filter, Sortierung,
// Kategoriebaum in der Sidebar. Nutzt ausschließlich GuidesDB.
// Erwartet js/guides-db.js + js/fuse.min.js vor dieser Datei.
// ============================================================
(function() {
  let allGuides   = [];   // [{ id, meta, content, contentPreview }]
  let categories  = [];   // [{ name, color, subcategories }]
  let fuse        = null;
  let loading     = false;
  let selectedIds = new Set(); // Phase 13 – Mehrfachauswahl

  const state = {
    query:   '',
    category: null,   // null = "Alle"
    tag:      '',
    favOnly:  false,
    sort:     'newest',
    view:     'grid',
  };

  const STATE_IDS = {
    skeleton:  'gg-skeleton',
    noFolder:  'gg-empty-noFolder',
    noGuides:  'gg-empty-noGuides',
    noResults: 'gg-empty-noResults',
    grid:      'gg-grid',
  };

  function notify(message, type) {
    if (typeof showToast === 'function') showToast(message, type);
  }

  function showState(active) {
    Object.entries(STATE_IDS).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.hidden = key !== active;
    });
  }

  // ── Ampel-Logik (exakt wie vorgegeben) ──────────────────
  function getAgeColor(dateString) {
    const months = (Date.now() - new Date(dateString)) / (1000 * 60 * 60 * 24 * 30);
    if (months < 6)  return 'var(--green)';
    if (months < 12) return 'var(--amber)';
    return 'var(--red)';
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || '–';
    return d.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  // Markdown-Syntax grob entfernen für Vorschautext
  function stripMarkdown(md) {
    return (md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_>#~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function categoryColor(name) {
    const cat = categories.find(c => c.name === name);
    return (cat && cat.color) || 'var(--dim)';
  }

  // ── Laden ────────────────────────────────────────────────
  // Kategorie/Tag können per Link aus der Sidebar anderer Seiten
  // (js/guides.js) vorausgewählt werden, z.B. guides.html?category=Exchange.
  function applyUrlFilterParams() {
    const params = new URLSearchParams(location.search);
    const cat = params.get('category');
    const tag = params.get('tag');
    if (cat) state.category = cat;
    if (tag) state.tag = tag;
  }

  async function init() {
    applyUrlFilterParams();
    await window.GuidesDB.restoreFolder();
    await loadAndRender();
  }

  async function loadAndRender() {
    if (loading) return;
    loading = true;
    try {
      const db = window.GuidesDB;

      if (db.isFilesystemMode() && !db.isConnected()) {
        showState('noFolder');
        return;
      }

      showState('skeleton');

      const catRes = await db.getCategories();
      categories = catRes.categories || [];
      populateCategoryFilter();

      const guidesRes = await db.listGuides();
      if (!guidesRes.success) {
        notify(guidesRes.error || 'Guides konnten nicht geladen werden.', 'error');
        renderCategoryTree();
        renderTagCloud();
        showState('noGuides');
        return;
      }

      allGuides = guidesRes.guides || [];
      renderCategoryTree();
      renderTagCloud();

      if (!allGuides.length) {
        showState('noGuides');
        return;
      }

      await loadContentPreviews(allGuides);
      buildFuse();
      populateTagFilter();
      renderGrid();
    } finally {
      loading = false;
    }
  }

  async function loadContentPreviews(guides) {
    const db = window.GuidesDB;
    await Promise.all(guides.map(async (g) => {
      try {
        const res = await db.getGuide(g.id);
        g.content        = res.success ? (res.content || '') : '';
        g.contentPreview  = stripMarkdown(g.content).slice(0, 200);
      } catch {
        g.content = '';
        g.contentPreview = '';
      }
    }));
  }

  function buildFuse() {
    fuse = new Fuse(allGuides, {
      threshold: 0.3,
      minMatchCharLength: 2,
      ignoreLocation: true, // Content kann lang sein – Treffer sollen unabhängig von der Position zählen
      keys: [
        { name: 'meta.title',    weight: 0.5 },
        { name: 'meta.tags',     weight: 0.25 },
        { name: 'meta.category', weight: 0.15 },
        { name: 'content',       weight: 0.1 },
      ],
    });
  }

  // ── Sidebar-Kategoriebaum (echte Daten) ─────────────────
  function renderCategoryTree() {
    const container = document.querySelector('.gs-cat-list');
    if (!container) return;
    container.replaceChildren();

    const counts = {};
    allGuides.forEach(g => {
      const c = g.meta.category || 'Allgemein';
      counts[c] = (counts[c] || 0) + 1;
    });

    container.appendChild(buildCatButton('Alle', null, allGuides.length, null));
    categories.forEach(cat => {
      container.appendChild(buildCatButton(cat.name, cat.color, counts[cat.name] || 0, cat.name));
    });

    updateCategoryActiveState();
    reclaimAddCategoryButton();
  }

  function buildCatButton(label, dotColor, count, filterValue) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gs-cat-item gg-cat-filter';
    btn.dataset.category = filterValue || '';

    const dot = document.createElement('span');
    dot.className = 'gs-cat-dot';
    dot.style.background = dotColor || 'var(--dim)';

    const name = document.createElement('span');
    name.className = 'gs-cat-name';
    name.textContent = label + ' (' + count + ')';

    btn.appendChild(dot);
    btn.appendChild(name);

    btn.addEventListener('click', () => {
      state.category = filterValue;
      updateCategoryActiveState();
      renderGrid();
    });

    return btn;
  }

  function updateCategoryActiveState() {
    document.querySelectorAll('.gg-cat-filter').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.category || null) === (state.category || null));
    });
    const sel = document.getElementById('gg-filter-category');
    if (sel) sel.value = state.category || '';
  }

  // ── Sidebar-Tag-Wolke (echte Daten, klickbar zum Filtern) ─
  // Support-Guides fliessen bereits nicht in allGuides ein (separater
  // fetch in loadSupportGuides). Der Meta-Tag "Support.sheet" wird
  // zusätzlich explizit ausgefiltert, falls er je auf einem
  // persönlichen Guide gesetzt sein sollte.
  const EXCLUDED_TAGS = ['Support.sheet', 'support.sheet'];

  function renderTagCloud() {
    const container = document.getElementById('gg-tag-cloud');
    if (!container) return;
    container.replaceChildren();

    const tagCounts = {};
    allGuides.forEach(g => (g.meta.tags || [])
      .filter(t => !EXCLUDED_TAGS.includes(t))
      .forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
    const tagNames = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b, 'de'));

    if (!tagNames.length) {
      const empty = document.createElement('div');
      empty.className = 'gg-tag-cloud-empty';
      empty.textContent = 'Noch keine Tags';
      container.appendChild(empty);
      return;
    }

    tagNames.forEach((tag) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gg-tag-chip';
      btn.dataset.tag = tag;
      btn.textContent = tag + ' (' + tagCounts[tag] + ')';
      btn.addEventListener('click', () => {
        state.tag = state.tag === tag ? '' : tag; // erneuter Klick hebt den Filter wieder auf
        updateTagActiveState();
        const sel = document.getElementById('gg-filter-tag');
        if (sel) sel.value = state.tag;
        renderGrid();
      });
      container.appendChild(btn);
    });

    updateTagActiveState();
  }

  function updateTagActiveState() {
    document.querySelectorAll('.gg-tag-chip').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tag === state.tag && state.tag !== '');
    });
  }

  // "+ Neue Kategorie" von der Phase-1-Platzhalterlogik in guides.js lösen
  // (Listener klonen/ersetzen statt zu duplizieren) und echte Persistenz anhängen.
  function reclaimAddCategoryButton() {
    const old = document.getElementById('gs-add-cat-btn');
    if (!old || old.dataset.ggBound) return;
    const fresh = old.cloneNode(true);
    fresh.dataset.ggBound = '1';
    old.parentNode.replaceChild(fresh, old);

    fresh.addEventListener('click', async () => {
      const name = (prompt('Name der neuen Kategorie:') || '').trim();
      if (!name) return;
      if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        notify('Kategorie „' + name + '“ existiert bereits.', 'error');
        return;
      }
      const updated = [...categories, { name, color: 'var(--accent2)', subcategories: [] }];
      const res = await window.GuidesDB.saveCategories(updated);
      if (res.success) {
        categories = updated;
        renderCategoryTree();
        populateCategoryFilter();
        notify('Kategorie „' + name + '“ angelegt.', 'success');
      } else {
        notify(res.error || 'Kategorie konnte nicht gespeichert werden.', 'error');
      }
    });
  }

  // ── Toolbar-Filter befüllen ──────────────────────────────
  function populateCategoryFilter() {
    const sel = document.getElementById('gg-filter-category');
    if (!sel) return;
    sel.replaceChildren();
    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = 'Alle Kategorien';
    sel.appendChild(optAll);
    categories.forEach(cat => {
      const o = document.createElement('option');
      o.value = cat.name;
      o.textContent = cat.name;
      sel.appendChild(o);
    });
    sel.value = state.category || '';
  }

  function populateTagFilter() {
    const sel = document.getElementById('gg-filter-tag');
    if (!sel) return;
    const tags = new Set();
    allGuides.forEach(g => (g.meta.tags || [])
      .filter(t => !EXCLUDED_TAGS.includes(t))
      .forEach(t => tags.add(t)));
    sel.replaceChildren();
    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = 'Alle Tags';
    sel.appendChild(optAll);
    [...tags].sort((a, b) => a.localeCompare(b, 'de')).forEach(t => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    });
    sel.value = state.tag || '';
  }

  // ── Filtern + Sortieren + Rendern ────────────────────────
  function sortComparator(mode) {
    switch (mode) {
      case 'oldest':   return (a, b) => new Date(a.meta.created)  - new Date(b.meta.created);
      case 'alpha':    return (a, b) => (a.meta.title || '').localeCompare(b.meta.title || '', 'de');
      case 'modified': return (a, b) => new Date(b.meta.modified) - new Date(a.meta.modified);
      case 'newest':
      default:         return (a, b) => new Date(b.meta.created)  - new Date(a.meta.created);
    }
  }

  function applyFiltersAndSort() {
    let list = allGuides;

    if (state.query) {
      list = fuse ? fuse.search(state.query).map(r => r.item) : list;
    }
    if (state.category) {
      list = list.filter(g => (g.meta.category || 'Allgemein') === state.category);
    }
    if (state.tag) {
      list = list.filter(g => Array.isArray(g.meta.tags) && g.meta.tags.includes(state.tag));
    }
    if (state.favOnly) {
      list = list.filter(g => g.meta.favorite);
    }

    return [...list].sort(sortComparator(state.sort));
  }

  function renderGrid() {
    const list = applyFiltersAndSort();
    const grid = document.getElementById('gg-grid');

    if (!list.length) {
      showState('noResults');
      updateBulkBar();
      return;
    }

    showState('grid');
    grid.classList.toggle('gg-grid--list', state.view === 'list');
    grid.replaceChildren();
    list.forEach(g => grid.appendChild(buildTile(g)));
    updateBulkBar();
  }

  function buildTile(g) {
    const meta  = g.meta;
    const color = categoryColor(meta.category);

    const tile = document.createElement('div');
    tile.className = 'gg-tile' + (selectedIds.has(g.id) ? ' gg-tile--selected' : '');
    tile.style.setProperty('--gg-cat-color', color);
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');

    const selectBox = document.createElement('input');
    selectBox.type = 'checkbox';
    selectBox.className = 'gg-tile-select';
    selectBox.setAttribute('aria-label', 'Guide auswählen');
    selectBox.checked = selectedIds.has(g.id);
    selectBox.addEventListener('click', (e) => e.stopPropagation());
    selectBox.addEventListener('change', () => {
      if (selectBox.checked) selectedIds.add(g.id);
      else selectedIds.delete(g.id);
      tile.classList.toggle('gg-tile--selected', selectBox.checked);
      updateBulkBar();
    });

    const top = document.createElement('div');
    top.className = 'gg-tile-top';

    const heading = document.createElement('div');
    heading.className = 'gg-tile-heading';

    const title = document.createElement('h3');
    title.className = 'gg-tile-title';
    title.textContent = meta.title || '(Ohne Titel)';

    heading.appendChild(selectBox);
    heading.appendChild(title);

    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = 'gg-fav-btn' + (meta.favorite ? ' active' : '');
    favBtn.setAttribute('aria-label', 'Favorit');
    favBtn.setAttribute('aria-pressed', String(!!meta.favorite));
    favBtn.textContent = '★';

    top.appendChild(heading);
    top.appendChild(favBtn);

    const badges = document.createElement('div');
    badges.className = 'gg-tile-badges';
    const catBadge = document.createElement('span');
    catBadge.className = 'gg-cat-badge';
    catBadge.style.setProperty('--gg-cat-color', color);
    catBadge.textContent = meta.category || 'Allgemein';
    badges.appendChild(catBadge);
    (meta.tags || []).slice(0, 4).forEach(t => {
      const tag = document.createElement('span');
      tag.className = 'gg-tag';
      tag.textContent = t;
      badges.appendChild(tag);
    });

    const preview = document.createElement('p');
    preview.className = 'gg-tile-preview';
    preview.textContent = (g.contentPreview || '').slice(0, 150) || 'Kein Vorschautext verfügbar.';

    const footer = document.createElement('div');
    footer.className = 'gg-tile-footer';

    const createdWrap = document.createElement('span');
    createdWrap.className = 'gg-ampel-wrap';
    createdWrap.title = 'Erstellt: ' + fmtDate(meta.created);
    const createdDot = document.createElement('span');
    createdDot.className = 'gg-ampel';
    createdDot.style.background = getAgeColor(meta.created);
    createdWrap.appendChild(createdDot);
    createdWrap.appendChild(document.createTextNode('Erstellt'));

    const modifiedWrap = document.createElement('span');
    modifiedWrap.className = 'gg-ampel-wrap';
    modifiedWrap.title = 'Geändert: ' + fmtDate(meta.modified);
    const modifiedDot = document.createElement('span');
    modifiedDot.className = 'gg-ampel';
    modifiedDot.style.background = getAgeColor(meta.modified);
    modifiedWrap.appendChild(modifiedDot);
    modifiedWrap.appendChild(document.createTextNode('Geändert'));

    footer.appendChild(createdWrap);
    footer.appendChild(modifiedWrap);

    tile.appendChild(top);
    tile.appendChild(badges);
    tile.appendChild(preview);
    tile.appendChild(footer);

    function openGuide() { window.location.href = 'guides-view.html?id=' + encodeURIComponent(g.id); }
    tile.addEventListener('click', openGuide);
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') openGuide(); });

    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      meta.favorite = !meta.favorite;
      favBtn.classList.toggle('active', meta.favorite);
      favBtn.setAttribute('aria-pressed', String(meta.favorite));
      const res = await window.GuidesDB.saveGuide(g.id, meta, g.content || '');
      if (!res.success) {
        meta.favorite = !meta.favorite;
        favBtn.classList.toggle('active', meta.favorite);
        favBtn.setAttribute('aria-pressed', String(meta.favorite));
        notify(res.error || 'Favorit konnte nicht gespeichert werden.', 'error');
      } else if (state.favOnly && !meta.favorite) {
        renderGrid();
      }
    });

    return tile;
  }

  // ── Toolbar-Events ───────────────────────────────────────
  function initToolbar() {
    let searchTimer;
    document.getElementById('gg-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.query = e.target.value.trim(); renderGrid(); }, 150);
    });

    document.getElementById('gg-filter-category').addEventListener('change', (e) => {
      state.category = e.target.value || null;
      updateCategoryActiveState();
      renderGrid();
    });

    document.getElementById('gg-filter-tag').addEventListener('change', (e) => {
      state.tag = e.target.value;
      updateTagActiveState();
      renderGrid();
    });

    const favToggle = document.getElementById('gg-fav-toggle');
    favToggle.addEventListener('click', () => {
      state.favOnly = !state.favOnly;
      favToggle.classList.toggle('active', state.favOnly);
      favToggle.setAttribute('aria-pressed', String(state.favOnly));
      renderGrid();
    });

    document.getElementById('gg-sort').addEventListener('change', (e) => {
      state.sort = e.target.value;
      renderGrid();
    });

    const gridBtn = document.getElementById('gg-view-grid');
    const listBtn = document.getElementById('gg-view-list');
    function setView(view) {
      state.view = view;
      gridBtn.classList.toggle('active', view === 'grid');
      listBtn.classList.toggle('active', view === 'list');
      gridBtn.setAttribute('aria-pressed', String(view === 'grid'));
      listBtn.setAttribute('aria-pressed', String(view === 'list'));
      renderGrid();
    }
    gridBtn.addEventListener('click', () => setView('grid'));
    listBtn.addEventListener('click', () => setView('list'));

    document.getElementById('gg-empty-connect').addEventListener('click', async () => {
      const res = await window.GuidesDB.openFolder();
      if (!res.success && res.error) notify(res.error, 'error');
    });
  }

  // ── Mehrfachauswahl + Bulk-Aktionen (Phase 13) ──────────
  function updateBulkBar() {
    const toolbar = document.getElementById('gg-toolbar');
    const bulkBar = document.getElementById('gg-bulk-bar');
    const grid    = document.getElementById('gg-grid');
    const count   = selectedIds.size;

    grid.classList.toggle('gg-has-selection', count > 0);
    toolbar.hidden = count > 0;
    bulkBar.hidden = count === 0;
    if (count > 0) {
      document.getElementById('gg-bulk-count').textContent = count + ' ausgewählt';
    }
  }

  function clearSelection() {
    selectedIds.clear();
    renderGrid(); // aktualisiert Kacheln (Checkboxen) und die Bulk-Leiste in einem Zug
  }

  async function bulkAddTag() {
    const tag = (prompt('Tag-Name für alle ausgewählten Guides:') || '').trim();
    if (!tag) return;
    const ids = [...selectedIds];
    let errors = 0;
    for (const id of ids) {
      const guide = allGuides.find((g) => g.id === id);
      if (!guide) continue;
      const tags = Array.isArray(guide.meta.tags) ? [...guide.meta.tags] : [];
      if (tags.includes(tag)) continue;
      tags.push(tag);
      const res = await window.GuidesDB.saveGuide(id, Object.assign({}, guide.meta, { tags }), guide.content || '');
      if (!res.success) errors++;
    }
    notify(
      'Tag „' + tag + '“ zu ' + ids.length + ' Guide(s) hinzugefügt' + (errors ? ' (' + errors + ' Fehler)' : '') + '.',
      errors ? 'error' : 'success'
    );
    selectedIds.clear();
    await loadAndRender();
  }

  function populateBulkCategorySelect() {
    const sel = document.getElementById('gg-bulk-category-select');
    sel.replaceChildren();
    categories.forEach((cat) => {
      const o = document.createElement('option');
      o.value = cat.name;
      o.textContent = cat.name;
      sel.appendChild(o);
    });
  }

  async function bulkChangeCategory() {
    const menu = document.getElementById('gg-bulk-category-menu');
    const newCategory = document.getElementById('gg-bulk-category-select').value;
    menu.hidden = true;
    if (!newCategory) return;

    const ids = [...selectedIds];
    let errors = 0;
    for (const id of ids) {
      const guide = allGuides.find((g) => g.id === id);
      if (!guide) continue;
      const res = await window.GuidesDB.saveGuide(id, Object.assign({}, guide.meta, { category: newCategory }), guide.content || '');
      if (!res.success) errors++;
    }
    notify(
      'Kategorie für ' + ids.length + ' Guide(s) auf „' + newCategory + '“ gesetzt' + (errors ? ' (' + errors + ' Fehler)' : '') + '.',
      errors ? 'error' : 'success'
    );
    selectedIds.clear();
    await loadAndRender();
  }

  async function bulkDeleteConfirmed() {
    document.getElementById('gg-bulk-delete-overlay').hidden = true;
    const ids = [...selectedIds];
    let errors = 0;
    for (const id of ids) {
      const res = await window.GuidesDB.deleteGuide(id);
      if (!res.success) errors++;
    }
    notify(
      (ids.length - errors) + ' Guide(s) in den Papierkorb verschoben' + (errors ? ' (' + errors + ' Fehler)' : '') + '.',
      errors ? 'error' : 'success'
    );
    selectedIds.clear();
    await loadAndRender();
  }

  function initBulkActions() {
    document.getElementById('gg-bulk-tag').addEventListener('click', bulkAddTag);

    document.getElementById('gg-bulk-category').addEventListener('click', () => {
      populateBulkCategorySelect();
      document.getElementById('gg-bulk-category-menu').hidden = false;
    });
    document.getElementById('gg-bulk-category-apply').addEventListener('click', bulkChangeCategory);
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('gg-bulk-category-menu');
      if (!menu.hidden && !e.target.closest('.gg-bulk-category-wrap')) menu.hidden = true;
    });

    document.getElementById('gg-bulk-delete').addEventListener('click', () => {
      document.getElementById('gg-bulk-delete-text').textContent =
        selectedIds.size + ' Guide(s) werden in den Papierkorb verschoben. Sie können in „Einstellungen“ wiederhergestellt werden.';
      document.getElementById('gg-bulk-delete-overlay').hidden = false;
    });
    document.getElementById('gg-bulk-delete-cancel').addEventListener('click', () => {
      document.getElementById('gg-bulk-delete-overlay').hidden = true;
    });
    document.getElementById('gg-bulk-delete-confirm').addEventListener('click', bulkDeleteConfirmed);

    document.getElementById('gg-bulk-clear').addEventListener('click', clearSelection);
  }

  // ── Hinweis auf die How-To-Anleitung (dismiss-/wiedereinblendbar) ──
  const HOWTO_HINT_KEY = 'gs-howto-hint-dismissed';

  function initHowtoHint() {
    const hint      = document.getElementById('gg-howto-hint');
    const reopenBtn = document.getElementById('gg-howto-hint-reopen');
    if (!hint || !reopenBtn) return;

    const dismissed = localStorage.getItem(HOWTO_HINT_KEY) === '1';
    hint.hidden = dismissed;
    reopenBtn.hidden = !dismissed;

    const dismissBtn = document.getElementById('gg-howto-hint-dismiss');
    dismissBtn.addEventListener('click', () => {
      localStorage.setItem(HOWTO_HINT_KEY, '1');
      hint.hidden = true;
      reopenBtn.hidden = false;
    });

    reopenBtn.addEventListener('click', () => {
      localStorage.removeItem(HOWTO_HINT_KEY);
      hint.hidden = false;
      reopenBtn.hidden = true;
    });
  }

  document.addEventListener('guides-db-connected', loadAndRender);
  document.addEventListener('guides-db-disconnected', loadAndRender);

  document.addEventListener('DOMContentLoaded', () => {
    initToolbar();
    initBulkActions();
    initHowtoHint();
    init();
  });

  // ── Support-Container (readonly Support-Guides aus data/support-guides.json) ──
  // Eigener fetch, komplett getrennt von allGuides/GuidesDB – zählt daher
  // weder in den Kategorie-Zählern noch in der Tag-Cloud oben mit.
  const SUPPORT_HIDE_KEY = 'gs-hide-support';

  async function loadSupportGuides() {
    try {
      const r = await fetch('./data/support-guides.json');
      const d = await r.json();
      return d.guides || [];
    } catch(e) {
      console.warn('Support-Guides nicht geladen:', e);
      return [];
    }
  }

  function renderSupportGuides(guides) {
    const grid    = document.getElementById('gs-support-grid');
    const countEl = document.getElementById('gs-support-count');
    if (!grid) return;

    if (countEl) countEl.textContent = guides.length;
    grid.replaceChildren();

    guides.forEach(guide => {
      const card = document.createElement('div');
      card.className = 'gs-card gs-support-card';
      card.dataset.guideId = guide.id;

      const badge = document.createElement('span');
      badge.className = 'gs-support-badge';
      badge.textContent = guide.subcategory || 'Support';

      const title = document.createElement('div');
      title.className = 'gs-card-title';
      title.textContent = guide.title;

      const preview = document.createElement('div');
      preview.className = 'gs-card-preview';
      const firstLine = (guide.content || '')
        .split('\n')
        .find(l => l.trim() && !l.startsWith('#')) || '';
      preview.textContent = firstLine
        .replace(/[*_`#\[\]]/g, '')
        .substring(0, 120);

      const lock = document.createElement('span');
      lock.className = 'gs-support-lock';
      lock.textContent = '🔒';
      lock.title = 'Nur lesbar';

      card.appendChild(badge);
      card.appendChild(title);
      card.appendChild(preview);
      card.appendChild(lock);

      card.addEventListener('click', () => {
        if (typeof GuideOverlay !== 'undefined') {
          GuideOverlay.openFromData(guide);
        }
      });

      grid.appendChild(card);
    });
  }

  function initSupportToggle() {
    const toggle  = document.getElementById('gs-support-toggle');
    const grid    = document.getElementById('gs-support-grid');
    const label   = document.getElementById('gs-support-toggle-label');
    const chevron = toggle?.querySelector('.gs-support-chevron');
    if (!toggle || !grid) return;

    const hidden = localStorage.getItem(SUPPORT_HIDE_KEY) === 'true';
    if (hidden) {
      grid.hidden = true;
      label.textContent = 'einblenden';
      if (chevron) chevron.style.transform = 'rotate(-90deg)';
      toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', () => {
      const isHidden = grid.hidden;
      grid.hidden = !isHidden;
      label.textContent = isHidden ? 'ausblenden' : 'einblenden';
      if (chevron) chevron.style.transform = isHidden ? '' : 'rotate(-90deg)';
      toggle.setAttribute('aria-expanded', String(isHidden));
      localStorage.setItem(SUPPORT_HIDE_KEY, String(!isHidden));
    });
  }

  loadSupportGuides().then(guides => {
    renderSupportGuides(guides);
    initSupportToggle();
  });
})();
