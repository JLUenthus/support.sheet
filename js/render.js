// ============================================================
// support.sheet – Command Renderer v3
// Kategorien + Filter-Bar + 3-spaltige Grid
// ============================================================

// ── Kategorie-Definitionen ────────────────────────────────
// Primärer Tag → Label + Farbe für Filter-Bar und Section-Header
const CATEGORY_MAP = {
  'msc':              { label: 'MMC-Konsolen',     dot: '#7c8cf8', icon: '🖥️'  },
  'system':           { label: 'Systeminfo',        dot: '#4ade80', icon: '⚙️'  },
  'network':          { label: 'Netzwerk',          dot: '#2dd4bf', icon: '🌐'  },
  'powershell':       { label: 'PowerShell',        dot: '#a78bfa', icon: '💚'  },
  'users':            { label: 'Benutzer',          dot: '#fbbf24', icon: '👥'  },
  'disk':             { label: 'Datenträger',       dot: '#f87171', icon: '💾'  },
  'process':          { label: 'Prozesse',          dot: '#f472b6', icon: '⚡'  },
  'remote':           { label: 'Remote & Support',  dot: '#2dd4bf', icon: '🖥️'  },
  'gpo':              { label: 'GPO & Richtlinien', dot: '#4ade80', icon: '📋'  },
  'eventlog':         { label: 'Event Logs',        dot: '#fbbf24', icon: '📋'  },
  'active-directory': { label: 'Active Directory',  dot: '#7c8cf8', icon: '🏢'  },
  'printer':          { label: 'Drucker & Spooler', dot: '#fb7124', icon: '🖨️'  },
  'quick':            { label: 'Schnellbefehle',    dot: '#fbbf24', icon: '⚡'  },
  // Exchange
  'exchange':         { label: 'Exchange',          dot: '#e8b339', icon: '📧'  },
  'on-premises':      { label: 'On-Premises',       dot: '#e8b339', icon: '🏢'  },
  'exo':              { label: 'Exchange Online',   dot: '#2dd4bf', icon: '☁️'  },
  // Exchange On-Prem
  'connect':    { label: 'Verbinden',         dot: '#7c8cf8', icon: '🔌' },
  'mailbox':    { label: 'Postfächer',         dot: '#e8b339', icon: '📬' },
  'tracking':   { label: 'Message Tracking',   dot: '#2dd4bf', icon: '🔍' },
  'permissions':{ label: 'Berechtigungen',     dot: '#f472b6', icon: '🔑' },
  'migration':  { label: 'Migration',          dot: '#fb7124', icon: '📦' },
  'compliance': { label: 'Compliance',         dot: '#f87171', icon: '🛡️' },
  'groups':     { label: 'Verteilergruppen',   dot: '#4ade80', icon: '👥' },
  // Fortinet subcategories
  'basics':  { label: 'Grundbefehle',   dot: '#fb7124', icon: '⚡' },
  'policy':  { label: 'Policies',        dot: '#f87171', icon: '📋' },
  'vpn':     { label: 'VPN',             dot: '#a78bfa', icon: '🔒' },
  'diag':    { label: 'Diagnose',        dot: '#fbbf24', icon: '🔍' },
  'log':     { label: 'Logging',         dot: '#4ade80', icon: '📜' },
  'user':    { label: 'Benutzer & Auth', dot: '#2dd4bf', icon: '👤' },
  // Fortinet products
  'fortigate':        { label: 'FortiGate',         dot: '#fb7124', icon: '🔥'  },
  'fortimanager':     { label: 'FortiManager',      dot: '#f87171', icon: '🖥️'  },
  'fortianalyzer':    { label: 'FortiAnalyzer',     dot: '#a78bfa', icon: '📊'  },
};

// Welcher Tag ist der primäre Kategorie-Tag?
// Erster Tag aus CATEGORY_MAP gewinnt
function getPrimaryTag(cmd) {
  if (!Array.isArray(cmd.tags)) return null;
  return cmd.tags.find(t => CATEGORY_MAP[t]) || cmd.tags[0] || null;
}


// ── Copy Button ───────────────────────────────────────────

function copyToClipboard(text, btn, command) {
  const onSuccess = () => {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
    if (typeof showToast === 'function') showToast('Kopiert!', 'success');
    if (command && typeof addRecent === 'function') addRecent(command, text);
  };
  const onError = err => {
    console.warn('Kopieren fehlgeschlagen', err);
    btn.classList.add('copy-error');
    setTimeout(() => btn.classList.remove('copy-error'), 1500);
    if (typeof showToast === 'function') showToast('Kopieren fehlgeschlagen', 'error');
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => execCommandFallback(text, onSuccess, onError));
  } else {
    execCommandFallback(text, onSuccess, onError);
  }
}

function execCommandFallback(text, onSuccess, onError) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  try {
    document.execCommand('copy') ? onSuccess() : onError(new Error('execCommand returned false'));
  } catch(err) {
    onError(err);
  } finally {
    document.body.removeChild(ta);
  }
}


// ── Single Command Card ───────────────────────────────────

function getShellBadge(tags) {
  if (!Array.isArray(tags)) return null;
  if (tags.includes('powershell'))   return { label: 'PowerShell', cls: 'shell-ps' };
  if (tags.includes('on-premises'))  return { label: 'EMS',        cls: 'shell-ems' };
  if (tags.includes('exo'))          return { label: 'EXO',        cls: 'shell-exo' };
  return { label: 'CMD', cls: 'shell-cmd' };
}

function createCommandCard(template, cmd) {
  const clone = template.content.cloneNode(true);
  const nameEl       = clone.querySelector('[data-field="name"]');
  const descEl       = clone.querySelector('[data-field="desc"]');
  const cmdEl        = clone.querySelector('[data-field="cmd"]');
  const tagContainer = clone.querySelector('[data-field="tags"]');
  const copyBtn      = clone.querySelector('[data-action="copy"]');
  const starBtn      = clone.querySelector('[data-action="star"]');
  const card         = clone.querySelector('.command-card');

  if (card) card.dataset.cmdId = cmd.id;

  nameEl.textContent = cmd.name;
  descEl.textContent = cmd.desc;
  cmdEl.textContent  = cmd.cmd;

  // Shell-Badge vor den Tags
  const badge = getShellBadge(cmd.tags);
  if (badge) {
    const b = document.createElement('span');
    b.className   = 'shell-badge ' + badge.cls;
    b.textContent = badge.label;
    tagContainer.appendChild(b);
  }

  (Array.isArray(cmd.tags) ? cmd.tags : []).forEach(tag => {
    const span = document.createElement('span');
    span.className   = 'tag';
    span.textContent = tag;
    tagContainer.appendChild(span);
  });

  copyBtn.addEventListener('click', () => copyWithVariables(cmd, copyBtn));

  if (starBtn && typeof isFavorite === 'function') {
    updateStarBtn(starBtn, isFavorite(cmd));
    starBtn.addEventListener('click', () => {
      const isNow = toggleFavorite(cmd);
      updateStarBtn(starBtn, isNow);
      if (typeof renderFavorites === 'function') renderFavorites(_allCommands);
    });
  }
  return clone;
}


// ── Filter Bar ────────────────────────────────────────────

let _activeFilter = 'all';

function renderFilterBar(commands) {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;

  // Collect categories that actually appear in the dataset
  const usedTags = new Set(commands.map(getPrimaryTag).filter(Boolean));
  bar.replaceChildren();

  // "Zuletzt verwendet" button – nur wenn Recent-Einträge vorhanden
  if (typeof getRecent === 'function') {
    const recentList = getRecent();
    if (recentList.length > 0) {
      const recentBtn = document.createElement('button');
      recentBtn.className   = 'filter-btn filter-btn--recent';
      recentBtn.dataset.tag = '__recent__';
      recentBtn.id          = 'filter-btn-recent';
      const recentDot = document.createElement('span');
      recentDot.className = 'filter-dot';
      recentDot.style.background = '#fbbf24';
      recentBtn.appendChild(recentDot);
      recentBtn.appendChild(document.createTextNode('Zuletzt verwendet'));
      const recentCount = document.createElement('span');
      recentCount.className = 'filter-recent-count';
      recentCount.textContent = recentList.length;
      recentBtn.appendChild(recentCount);
      bar.appendChild(recentBtn);
    }
  }

  // "Alle" button
  const allBtn = document.createElement('button');
  allBtn.className   = 'filter-btn active';
  allBtn.dataset.tag = 'all';
  const allDot       = document.createElement('span');
  allDot.className   = 'filter-dot';
  allDot.style.background = '#7c8cf8';
  allBtn.appendChild(allDot);
  allBtn.appendChild(document.createTextNode('Alle'));
  bar.appendChild(allBtn);

  // One button per category (in CATEGORY_MAP order to be consistent)
  Object.entries(CATEGORY_MAP).forEach(([tag, meta]) => {
    if (!usedTags.has(tag)) return;
    const btn = document.createElement('button');
    btn.className   = 'filter-btn';
    btn.dataset.tag = tag;
    const dot       = document.createElement('span');
    dot.className   = 'filter-dot';
    dot.style.background = meta.dot;
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(meta.label));
    bar.appendChild(btn);
  });

  // Click handler
  bar.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    if (btn.dataset.tag === '__recent__') {
      // Toggle: wenn schon aktiv → zurück zu 'all'
      const isActive = btn.classList.contains('active');
      bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      if (isActive) {
        // Deaktivieren → Alle anzeigen
        _activeFilter = 'all';
        bar.querySelector('[data-tag="all"]')?.classList.add('active');
        applyFilter();
      } else {
        // Aktivieren → Recent anzeigen
        btn.classList.add('active');
        _activeFilter = '__recent__';
        applyRecentFilter();
      }
      return;
    }

    _activeFilter = btn.dataset.tag;
    bar.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    applyFilter();
  });
}

function applyFilter() {
  const filtered = _activeFilter === 'all'
    ? _allCommands
    : _allCommands.filter(c => getPrimaryTag(c) === _activeFilter);
  renderCommandGroups(filtered);
  if (typeof runSearch === 'function') {
    const input = document.getElementById('search-input');
    if (input && input.value.trim()) runSearch(input.value);
  }
}

function applyRecentFilter() {
  if (typeof getRecent !== 'function') return;
  const recentEntries = getRecent();

  // Page-Farben für dezenten Akzent
  const PAGE_COLORS = {
    'index':    '#7c8cf8',
    'exchange': '#e8b339',
    'forti':    '#fb7124',
    'scripts':  '#4ade80',
    'eventlog': '#e8b339',
    'mitmachen':'#a78bfa',
  };

  // Commands aufbauen: aus _allCommands wenn vorhanden, sonst aus Entry-Daten
  const recentCmds = recentEntries.map(entry => {
    const found = _allCommands.find(c => c.id === entry.id);
    if (found) return { ...found, _recentPage: entry.page };
    // Nicht auf dieser Seite → aus Entry rekonstruieren
    return {
      id:    entry.id,
      name:  entry.name,
      cmd:   entry.cmd || entry.resolved,
      desc:  entry.desc || '',
      tags:  entry.tags || [],
      _recentPage: entry.page,   // Herkunfts-Seite
    };
  });

  // Rendern – mit Page-Info für Farbgebung
  renderCommandGroupsRecent(recentCmds, PAGE_COLORS);
}

// Spezielles Render für Recent: flach, mit Page-Badge je Card
function renderCommandGroupsRecent(commands, pageColors) {
  const container = document.getElementById('commands-container');
  if (!container) return;
  const template = document.getElementById('command-template');
  if (!template) return;

  const section = document.createElement('div');
  section.className = 'cmd-section';

  // Section header
  const header = document.createElement('div');
  header.className = 'section-header';
  const iconEl  = document.createElement('div');
  iconEl.className = 'section-icon';
  iconEl.style.cssText = 'background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.35)';
  iconEl.textContent = '🕐';
  const labelEl = document.createElement('span'); labelEl.className = 'section-label'; labelEl.textContent = 'Zuletzt verwendet';
  const countEl = document.createElement('span'); countEl.className = 'section-count'; countEl.textContent = commands.length;
  header.appendChild(iconEl); header.appendChild(labelEl); header.appendChild(countEl);
  section.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'cmd-grid';
  const currentPage = (location.pathname.split('/').pop() || 'index.html').replace('.html','');

  commands.forEach(cmd => {
    const clone        = template.content.cloneNode(true);
    const nameEl       = clone.querySelector('[data-field="name"]');
    const descEl       = clone.querySelector('[data-field="desc"]');
    const cmdEl        = clone.querySelector('[data-field="cmd"]');
    const tagContainer = clone.querySelector('[data-field="tags"]');
    const copyBtn      = clone.querySelector('[data-action="copy"]');
    const starBtn      = clone.querySelector('[data-action="star"]');
    const card         = clone.querySelector('.command-card');

    if (card) {
      card.dataset.cmdId = cmd.id;
      const pageColor = (pageColors?.[cmd._recentPage]) || '#7c8cf8';
      card.style.setProperty('--recent-page-color', pageColor);
      card.classList.add('recent-page-card');

      // Page-Badge wenn Command von anderer Seite
      if (cmd._recentPage && cmd._recentPage !== currentPage) {
        const badge = document.createElement('span');
        badge.className = 'recent-page-badge';
        badge.textContent = cmd._recentPage;
        badge.style.cssText = `background:${pageColor}22;color:${pageColor};border-color:${pageColor}55`;
        card.appendChild(badge);
      }
    }

    nameEl.textContent = cmd.name;
    descEl.textContent = cmd.desc;
    cmdEl.textContent  = cmd.cmd;

    // Shell-Badge
    const badge = getShellBadge(cmd.tags);
    if (badge) {
      const b = document.createElement('span');
      b.className   = 'shell-badge ' + badge.cls;
      b.textContent = badge.label;
      tagContainer.appendChild(b);
    }

    (Array.isArray(cmd.tags) ? cmd.tags : []).forEach(tag => {
      const span = document.createElement('span');
      span.className = 'tag'; span.textContent = tag;
      tagContainer.appendChild(span);
    });

    copyBtn.addEventListener('click', () => copyWithVariables(cmd, copyBtn));

    if (starBtn && typeof isFavorite === 'function') {
      updateStarBtn(starBtn, isFavorite(cmd));
      starBtn.addEventListener('click', () => {
        const isNow = toggleFavorite(cmd);
        updateStarBtn(starBtn, isNow);
        if (typeof renderFavorites === 'function') renderFavorites(_allCommands);
      });
    }

    grid.appendChild(clone);
  });

  section.appendChild(grid);
  const frag = document.createDocumentFragment();
  frag.appendChild(section);
  container.replaceChildren(frag);
  if (typeof updateCommandCount === 'function') updateCommandCount(commands.length);
}


// ── Grouped Render ────────────────────────────────────────

function renderCommandGroups(commands, containerId = 'commands-container') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const template = document.getElementById('command-template');
  if (!template) return;

  const fragment = document.createDocumentFragment();

  // Group by primary tag
  const groups = {};
  commands.forEach(cmd => {
    const tag = getPrimaryTag(cmd) || 'other';
    if (!groups[tag]) groups[tag] = [];
    groups[tag].push(cmd);
  });

  Object.entries(groups).forEach(([tag, cmds]) => {
    const meta = CATEGORY_MAP[tag] || { label: tag, dot: '#7c8cf8', icon: '📋' };

    // Section wrapper
    const section = document.createElement('div');
    section.className       = 'cmd-section';
    section.dataset.category = tag;

    // Section header
    const header = document.createElement('div');
    header.className = 'section-header';

    const iconEl = document.createElement('div');
    iconEl.className   = 'section-icon';
    iconEl.style.background = meta.dot + '20';
    iconEl.style.borderColor = meta.dot + '50';
    iconEl.textContent = meta.icon;

    const labelEl = document.createElement('span');
    labelEl.className   = 'section-label';
    labelEl.textContent = meta.label;

    const countEl = document.createElement('span');
    countEl.className   = 'section-count';
    countEl.textContent = cmds.length;

    header.appendChild(iconEl);
    header.appendChild(labelEl);
    header.appendChild(countEl);
    section.appendChild(header);

    // Card grid
    const grid = document.createElement('div');
    grid.className = 'cmd-grid';
    const gridFrag = document.createDocumentFragment();
    cmds.forEach(cmd => gridFrag.appendChild(createCommandCard(template, cmd)));
    grid.appendChild(gridFrag);
    section.appendChild(grid);

    fragment.appendChild(section);
  });

  container.replaceChildren(fragment);
  if (typeof updateCommandCount === 'function') updateCommandCount(commands.length);
  if (typeof renderFavorites    === 'function') renderFavorites(_allCommands);
}


// ── renderCommands (public API, used by search.js etc.) ──

let _allCommands = [];

function renderCommands(commands, containerId = 'commands-container') {
  if (containerId !== 'commands-container') {
    // Favorites/recent container – flat render without category headers
    const container = document.getElementById(containerId);
    if (!container) return;
    const template = document.getElementById('command-template');
    if (!template) return;
    const frag = document.createDocumentFragment();
    commands.forEach(cmd => frag.appendChild(createCommandCard(template, cmd)));
    container.replaceChildren(frag);
    return;
  }

  _allCommands = commands;
  renderCommandGroups(commands);
}


// ── Start ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadCommands()
    .then(commands => {
      _allCommands = commands;
      renderFilterBar(commands);
      renderCommandGroups(commands);
      if (typeof updateCommandCount === 'function') updateCommandCount(commands.length);
      if (typeof initSearch   === 'function') initSearch(commands);
      if (typeof initSearchUI === 'function') initSearchUI();
    })
    .catch(err => console.error('❌ Fehler:', err.message));
});
