// ============================================================
// guide.sheet – guides-overview.js (Phase 3 – Guides-Übersicht)
// Kachel-/Listenansicht für guides.html: Suche, Filter, Sortierung,
// Kategoriebaum in der Sidebar. Nutzt ausschließlich GuidesDB.
// Erwartet js/guides-db.js + js/fuse.min.js vor dieser Datei.
// ============================================================
(function() {
  let allGuides  = [];   // [{ id, meta, content, contentPreview }]
  let categories = [];   // [{ name, color, subcategories }]
  let fuse       = null;
  let loading    = false;

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
  async function init() {
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
      threshold: 0.35,
      minMatchCharLength: 2,
      keys: [
        { name: 'meta.title',    weight: 0.5 },
        { name: 'meta.tags',     weight: 0.25 },
        { name: 'meta.category', weight: 0.15 },
        { name: 'contentPreview', weight: 0.1 },
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
  function renderTagCloud() {
    const container = document.getElementById('gg-tag-cloud');
    if (!container) return;
    container.replaceChildren();

    const tagCounts = {};
    allGuides.forEach(g => (g.meta.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
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
    allGuides.forEach(g => (g.meta.tags || []).forEach(t => tags.add(t)));
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
      return;
    }

    showState('grid');
    grid.classList.toggle('gg-grid--list', state.view === 'list');
    grid.replaceChildren();
    list.forEach(g => grid.appendChild(buildTile(g)));
  }

  function buildTile(g) {
    const meta  = g.meta;
    const color = categoryColor(meta.category);

    const tile = document.createElement('div');
    tile.className = 'gg-tile';
    tile.style.setProperty('--gg-cat-color', color);
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');

    const top = document.createElement('div');
    top.className = 'gg-tile-top';

    const title = document.createElement('h3');
    title.className = 'gg-tile-title';
    title.textContent = meta.title || '(Ohne Titel)';

    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = 'gg-fav-btn' + (meta.favorite ? ' active' : '');
    favBtn.setAttribute('aria-label', 'Favorit');
    favBtn.setAttribute('aria-pressed', String(!!meta.favorite));
    favBtn.textContent = '★';

    top.appendChild(title);
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
    initHowtoHint();
    init();
  });
})();
