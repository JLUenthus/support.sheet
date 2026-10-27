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
  'winget':           { label: 'Winget',             dot: '#4ade80', icon: '📦'  },
  'shortcuts':        { label: 'Tastenkürzel',       dot: '#f472b6', icon: '⌨️'  },
  'dhcp':             { label: 'DHCP',               dot: '#2dd4bf', icon: '🌐'  },
  'hyperv':           { label: 'Hyper-V',            dot: '#a78bfa', icon: '🖥️'  },
  'update':           { label: 'Windows Update',     dot: '#fbbf24', icon: '🔄'  },
  'rds':              { label: 'RDS / Terminal',     dot: '#60a5fa', icon: '🖥️'  },
  'powertoys':        { label: 'PowerToys',          dot: '#fb923c', icon: '🔧'  },
  'sysinternals':     { label: 'Sysinternals',        dot: '#60a5fa', icon: '🔬'  },
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

// ── Befehlsseiten (opt-in) ───────────────────────────────────
// render.js wird auch von gpo.html, mitmachen.html, wizard.html und linux.html geladen (createCommandCard, addRecent, renderRecent).
// Das Verhalten dieses Abschnitts gilt NUR auf windows.html, exchange.html und forti.html: Sie tragen die Seitenklasse "commands-page" am <body>.
// Ohne diese Klasse (und ohne Option commandsPage bei createCommandCard) bleibt jede Ausgabe Zeichen für Zeichen wie zuvor
// (tests/render-golden.test.html vergleicht mit tests/fixtures/render.orig.js).
function isCommandsPage() { return !!(document.body && document.body.classList.contains('commands-page')); }

// Ergänzte Abschnitte (deutsche Beschriftung, eigenes Symbol) für Tags, die in CATEGORY_MAP fehlen, und eindeutige Symbole je Seite.
// CATEGORY_MAP selbst bleibt unverändert (andere Seiten); die Befehlsseiten nutzen cpCategoryMap().
const CP_ICON_OVERRIDES = {
  remote: '📡', eventlog: '📰', quick: '🚀', dhcp: '📶', hyperv: '🧊', rds: '💻', 'on-premises': '🏠', tracking: '🧭', migration: '🚚',
  groups: '📣', basics: '🧰', policy: '🧾', fortimanager: '🗄️',
};
const CP_EXTRA_CATEGORIES = {
  registry:         { label: 'Registry',                dot: '#fbbf24', icon: '🗝️' },
  'scheduled-task': { label: 'Geplante Aufgaben',       dot: '#60a5fa', icon: '⏰' },
  admin:            { label: 'Administration',          dot: '#7c8cf8', icon: '🛠️' },
  caution:          { label: 'Vorsicht',                dot: '#f87171', icon: '⚠️' },
  certificates:     { label: 'Zertifikate',             dot: '#2dd4bf', icon: '🎫' },
  cli:              { label: 'CLI',                     dot: '#a78bfa', icon: '📟' },
  database:         { label: 'Datenbanken',             dot: '#e8b339', icon: '🗃️' },
  faz:              { label: 'FortiAnalyzer (FAZ)',     dot: '#a78bfa', icon: '📈' },
  fg:               { label: 'FortiGate (FG)',          dot: '#fb7124', icon: '🧱' },
  files:            { label: 'Dateien',                 dot: '#4ade80', icon: '📁' },
  fmg:              { label: 'FortiManager (FMG)',      dot: '#f87171', icon: '🗂️' },
  graphics:         { label: 'Grafik',                  dot: '#f472b6', icon: '🎨' },
  ha:               { label: 'Hochverfügbarkeit (HA)',  dot: '#2dd4bf', icon: '🔁' },
  info:             { label: 'Informationen',           dot: '#7c8cf8', icon: 'ℹ️' },
  maintenance:      { label: 'Wartung',                 dot: '#fbbf24', icon: '🧹' },
  productivity:     { label: 'Produktivität',           dot: '#4ade80', icon: '📝' },
  ps:               { label: 'PowerShell (Kürzel ps)',  dot: '#a78bfa', icon: '🐚' },
  reboot:           { label: 'Neustart',                dot: '#fb7124', icon: '♻️' },
  repair:           { label: 'Reparatur',               dot: '#fbbf24', icon: '🩹' },
  security:         { label: 'Sicherheit',              dot: '#f87171', icon: '🔐' },
  server:           { label: 'Server',                  dot: '#60a5fa', icon: '🏗️' },
  transport:        { label: 'Transport',               dot: '#2dd4bf', icon: '✉️' },
  windows:          { label: 'Windows',                 dot: '#60a5fa', icon: '🪟' },
};
// Position der ergänzten Abschnitte in der Reihenfolge (Seite und Filterleiste folgen derselben Reihenfolge); der Rest steht am Ende
const CP_AFTER = { registry: 'gpo', 'scheduled-task': 'process' };
let _cpMap = null;
function cpCategoryMap() {
  if (_cpMap) return _cpMap;
  const out = {};
  const placed = new Set();
  Object.entries(CATEGORY_MAP).forEach(([key, meta]) => {
    out[key] = CP_ICON_OVERRIDES[key] ? { ...meta, icon: CP_ICON_OVERRIDES[key] } : meta;
    Object.keys(CP_AFTER).forEach(extra => { if (CP_AFTER[extra] === key && CP_EXTRA_CATEGORIES[extra] && !out[extra]) { out[extra] = CP_EXTRA_CATEGORIES[extra]; placed.add(extra); } });
  });
  Object.entries(CP_EXTRA_CATEGORIES).forEach(([key, meta]) => { if (!out[key] && !placed.has(key)) out[key] = meta; });
  return (_cpMap = out);
}
// Reihenfolge der Abschnitte wie in der Filterleiste (cpCategoryMap); unbekannte Tags danach in der Reihenfolge des Auftretens
function cpOrderedGroups(groups) {
  const order = Object.keys(cpCategoryMap());
  const known = order.filter(k => groups[k]).map(k => [k, groups[k]]);
  const rest = Object.entries(groups).filter(([k]) => !order.includes(k));
  return [...known, ...rest];
}

// Sicherheitsmodus: "hoch" ist ein Befehl nur mit risk "high" oder dem Tag caution (keine Teilstring-Heuristik wie in getRisk)
function cpIsHigh(cmd) { return cmd.risk === 'high' || (Array.isArray(cmd.tags) && cmd.tags.includes('caution')); }
function cpRisk(cmd) {
  if (cpIsHigh(cmd)) return 'high';
  if (cmd.risk) return cmd.risk;
  const l = (cmd.cmd || '').toLowerCase();
  return (l.includes('set-') || l.includes('disable') || l.includes('stop-') || l.includes('restart-') || l.includes('reset')) ? 'medium' : 'low';
}
function cpShouldShow(cmd) { return !isSafeModeOn() || !cpIsHigh(cmd); }
function cpUpdateSafeHint(commands) {
  const hint = document.getElementById('safe-mode-hint');
  if (hint) hint.textContent = '🛡️ Sicherheitsmodus: Befehle mit hohem Risiko ausgeblendet (' + commands.filter(cpIsHigh).length + ')';
}

// Tags: das Tag, das auf jeder Karte der Seite steht (windows, exchange, cli), wird nicht gezeigt; caution erscheint als "Vorsicht"
let _cpCommon = { src: null, set: new Set() };
function cpCommonTags() {
  if (_cpCommon.src === _allCommands) return _cpCommon.set;
  let set = new Set();
  if (Array.isArray(_allCommands) && _allCommands.length >= 10) {
    set = new Set(Array.isArray(_allCommands[0].tags) ? _allCommands[0].tags : []);
    _allCommands.forEach(c => { const t = Array.isArray(c.tags) ? c.tags : []; set.forEach(x => { if (!t.includes(x)) set.delete(x); }); });
  }
  _cpCommon = { src: _allCommands, set };
  return set;
}
const cpVisibleTags = cmd => (Array.isArray(cmd.tags) ? cmd.tags : []).filter(t => !cpCommonTags().has(t));
const cpTagLabel = tag => (tag === 'caution' ? 'Vorsicht' : tag);
// Favoriten-Karten baut favorites.js (nicht Teil dieser Änderung): Tags dort nachträglich angleichen
function cpLocalizeTags(root) {
  const common = cpCommonTags();
  root.querySelectorAll('.tag').forEach(t => { const x = t.textContent; if (x === 'caution') t.textContent = 'Vorsicht'; else if (common.has(x)) t.remove(); });
}
function cpInitFavoritesObserver() {
  const c = document.getElementById('favorites-container');
  if (!c || typeof MutationObserver === 'undefined') return;
  new MutationObserver(() => cpLocalizeTags(c)).observe(c, { childList: true, subtree: true });
}

// Leerzustand der Suche: Meldung im Befehlsbereich (Suchbegriff nur als Text)
function cpRenderEmpty(term) {
  if (!isCommandsPage()) return;
  const container = document.getElementById('commands-container');
  if (!container) return;
  const box = document.createElement('div');
  box.className = 'cmd-empty';
  box.setAttribute('role', 'status');
  const title = document.createElement('p');
  title.className = 'cmd-empty-title';
  const q = document.createElement('strong');
  q.textContent = term;
  title.append('Keine Treffer für „', q, '“');
  const hint = document.createElement('p');
  hint.className = 'cmd-empty-hint';
  hint.textContent = 'Anderen Suchbegriff versuchen oder die Suche leeren, um alle Befehle zu sehen.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cmd-empty-clear';
  btn.textContent = 'Suche leeren';
  btn.addEventListener('click', () => { const c = document.getElementById('search-clear'); if (c) c.click(); });
  box.append(title, hint, btn);
  container.replaceChildren(box);
}

// "Zuletzt verwendet": der Knopf erscheint direkt nach dem ersten Kopieren (recent.js aktualisiert nur einen vorhandenen Knopf)
function cpEnsureRecentButton() {
  const bar = document.getElementById('filter-bar');
  if (!bar || document.getElementById('filter-btn-recent') || typeof getRecent !== 'function') return;
  const list = getRecent();
  if (list.length > 0) bar.insertBefore(buildRecentButton(list.length), bar.firstChild);
}

// ── Risk-Level ──────────────────────────────────────────────
// Keine manuelle Pflege noetig – wird zur Laufzeit aus dem
// "caution"-Tag und ein paar Cmd-Heuristiken abgeleitet.
function getRisk(cmd) {
  const tags = cmd.tags || [];

  // Explizites risk-Feld hat Vorrang (Zukunft)
  if (cmd.risk) return cmd.risk;

  // caution-Tag = high
  if (tags.includes('caution')) return 'high';

  // Weitere Heuristiken
  const cmdLower = (cmd.cmd || '').toLowerCase();
  if (
    cmdLower.includes('remove-') ||
    cmdLower.includes('delete') ||
    cmdLower.includes('format') ||
    cmdLower.includes('-force') ||
    cmdLower.includes('drop ')
  ) return 'high';

  if (
    cmdLower.includes('set-') ||
    cmdLower.includes('disable') ||
    cmdLower.includes('stop-') ||
    cmdLower.includes('restart-') ||
    cmdLower.includes('reset')
  ) return 'medium';

  return 'low';
}


// ── Copy Button ───────────────────────────────────────────

function copyToClipboard(text, btn, command) {
  const onSuccess = () => {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
    if (typeof showToast === 'function') showToast('Kopiert!', 'success');
    if (command && typeof addRecent === 'function') addRecent(command, text);
    if (command && isCommandsPage()) cpEnsureRecentButton();
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

function getShellBadge(tags, cp) {
  if (!Array.isArray(tags)) return null;
  if (tags.includes('shortcuts'))    return { label: 'Shortcut',   cls: 'shell-shortcut' };
  if (tags.includes('powershell'))   return { label: 'PowerShell', cls: 'shell-ps' };
  if (tags.includes('on-premises'))  return { label: 'EMS',        cls: 'shell-ems' };
  if (tags.includes('exo'))          return { label: 'EXO',        cls: 'shell-exo' };
  if (cp && tags.includes('cli')) return { label: 'CLI', cls: 'shell-cmd' };
  return { label: 'CMD', cls: 'shell-cmd' };
}

function createCommandCard(template, cmd, opts) {
  const cp = !!(opts && opts.commandsPage);   // opt-in: nur die Befehlsseiten (renderCommandGroups), sonst Ausgabe wie zuvor
  const clone = template.content.cloneNode(true);
  const nameEl       = clone.querySelector('[data-field="name"]');
  const descEl       = clone.querySelector('[data-field="desc"]');
  const cmdEl        = clone.querySelector('[data-field="cmd"]');
  const tagContainer = clone.querySelector('[data-field="tags"]');
  const copyBtn      = clone.querySelector('[data-action="copy"]');
  const starBtn      = clone.querySelector('[data-action="star"]');
  const cardHeader   = clone.querySelector('.card-header');
  const card         = clone.querySelector('.command-card');

  if (card) card.dataset.cmdId = cmd.id;

  nameEl.textContent = cmd.name;
  descEl.textContent = cmd.desc;
  cmdEl.textContent  = cmd.cmd;

  // Shell-Badge vor den Tags
  const badge = getShellBadge(cmd.tags, cp);
  if (badge) {
    const b = document.createElement('span');
    b.className   = 'shell-badge ' + badge.cls;
    b.textContent = badge.label;
    tagContainer.appendChild(b);
  }

  (cp ? cpVisibleTags(cmd) : (Array.isArray(cmd.tags) ? cmd.tags : [])).forEach(tag => {
    const span = document.createElement('span');
    span.className   = 'tag';
    span.textContent = cp ? cpTagLabel(tag) : tag;
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

  // Guide-Button – nur wenn guideRef gesetzt ist. Sitzt im card-header
  // direkt vor dem Stern (statt in der Tag-Zeile), damit er bei jeder
  // Kachel an derselben, gut sichtbaren Stelle liegt.
  if (cmd.guideRef) {
    const guideBtn = document.createElement('button');
    guideBtn.className = 'guide-ref-btn-header';
    guideBtn.textContent = '📖';
    guideBtn.title = 'Guide zu diesem Befehl oeffnen';
    guideBtn.setAttribute('aria-label', 'Guide zu diesem Befehl oeffnen');
    guideBtn.addEventListener('click', e => {
      e.stopPropagation(); // verhindert dass die Kachel andere Events triggert
      if (typeof GuideOverlay !== 'undefined') {
        GuideOverlay.open(cmd.guideRef);
      }
    });

    if (cardHeader && starBtn) {
      cardHeader.insertBefore(guideBtn, starBtn);
    } else if (cardHeader) {
      cardHeader.appendChild(guideBtn);
    }
  }

  // Risk-Badge + Warnung ─────────────────────────────────
  const risk = cp ? cpRisk(cmd) : getRisk(cmd);

  // Nur HIGH und MEDIUM anzeigen, LOW ist Standard → kein Badge
  if (risk === 'high' || risk === 'medium') {
    const badge = document.createElement('div');
    badge.className = `risk-badge risk-badge--${risk}`;
    badge.title = cp
      ? (risk === 'high' ? 'Achtung: Dieser Befehl kann Daten ändern oder löschen. Vor Ausführung prüfen.' : 'Hinweis: Dieser Befehl verändert Systemeinstellungen.')
      : risk === 'high'
      ? 'Achtung: Dieser Befehl kann destructive sein. Vor Ausführung prüfen.'
      : 'Hinweis: Dieser Befehl verändert Systemeinstellungen.';

    const dot = document.createElement('span');
    dot.className = 'risk-dot';

    const label = document.createElement('span');
    label.textContent = cp ? (risk === 'high' ? 'Hoch' : 'Mittel') : (risk === 'high' ? 'HIGH' : 'MED');

    badge.appendChild(dot);
    badge.appendChild(label);

    // In card-header vor dem star-btn einfügen (landet damit automatisch
    // hinter einem evtl. vorhandenen guide-btn, der oben bereits davor sitzt)
    if (cardHeader && starBtn) {
      cardHeader.insertBefore(badge, starBtn);
    } else if (cardHeader) {
      cardHeader.appendChild(badge);
    }
  }

  // HIGH: Warnung auf der Kachel anzeigen
  if (risk === 'high') {
    const warn = document.createElement('div');
    warn.className = 'risk-warning';
    warn.innerHTML =
      '⚠️ Vor Ausführung prüfen – dieser Befehl kann ' +
      'nicht ohne weiteres rückgängig gemacht werden.';

    // Nach der Code-Zeile einfügen
    const codeEl = clone.querySelector('[data-field="cmd"]');
    if (codeEl) {
      codeEl.insertAdjacentElement('afterend', warn);
    }
  }

  return clone;
}


// ── Filter Bar ────────────────────────────────────────────

let _activeFilter = 'all';

// "Zuletzt verwendet"-Knopf der Filterleiste (aus renderFilterBar herausgelöst, Ausgabe unverändert)
function buildRecentButton(count) {
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
  recentCount.textContent = count;
  recentBtn.appendChild(recentCount);
  return recentBtn;
}

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
      bar.appendChild(buildRecentButton(recentList.length));
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
  Object.entries(isCommandsPage() ? cpCategoryMap() : CATEGORY_MAP).forEach(([tag, meta]) => {
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

  // Click handler – nur einmal binden, bar.replaceChildren() oben leert nur
  // die Kind-Buttons, bar selbst bleibt dasselbe Element. Ohne diesen Guard
  // haengt sich bei jedem erneuten renderFilterBar()-Aufruf (z.B. Exchange/
  // Fortinet Produkt-Tabs, die renderFilterBar() bei jedem Klick neu
  // aufrufen) ein weiterer Click-Listener an – nach N Produkt-Wechseln
  // wuerde applyFilter()/renderCommandGroups() N-fach pro Klick laufen.
  if (bar.dataset.filterBound) return;
  bar.dataset.filterBound = '1';
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
  const cp = isCommandsPage();

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
    const badge = getShellBadge(cmd.tags, cp);
    if (badge) {
      const b = document.createElement('span');
      b.className   = 'shell-badge ' + badge.cls;
      b.textContent = badge.label;
      tagContainer.appendChild(b);
    }

    (cp ? cpVisibleTags(cmd) : (Array.isArray(cmd.tags) ? cmd.tags : [])).forEach(tag => {
      const span = document.createElement('span');
      span.className = 'tag'; span.textContent = cp ? cpTagLabel(tag) : tag;
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


// ── Safe Mode ──────────────────────────────────────────────
// Blendet HIGH-Risk Commands aus. Standard: aus. Persistiert in localStorage,
// damit die Einstellung seitenübergreifend (windows/exchange/forti) gilt.
const SAFE_MODE_KEY = 'ss-safe-mode';

function isSafeModeOn() {
  return localStorage.getItem(SAFE_MODE_KEY) === 'true';
}

function shouldShowCommand(cmd) {
  if (!isSafeModeOn()) return true;
  return getRisk(cmd) !== 'high';
}

function initSafeMode() {
  const checkbox = document.getElementById('safe-mode-checkbox');
  const hint     = document.getElementById('safe-mode-hint');
  const desc     = document.getElementById('safe-mode-desc');
  if (!checkbox) return;

  // Gespeicherten Zustand laden
  const saved = isSafeModeOn();
  checkbox.checked = saved;
  if (hint) hint.hidden = !saved;
  if (desc) desc.textContent = saved ? 'an' : 'aus';

  checkbox.addEventListener('change', () => {
    const on = checkbox.checked;
    localStorage.setItem(SAFE_MODE_KEY, String(on));
    if (hint) hint.hidden = !on;
    if (desc) desc.textContent = on ? 'an' : 'aus';
    // Re-render mit genau der Liste, die zuletzt an renderCommandGroups()
    // ging – egal ob die per Kategorie-Filter (applyFilter), Suche
    // (runSearch) oder Produkt-Tab (exchange.html/forti.html, eigene
    // Inline-Skripte) zustande kam. applyFilter()/runSearch() direkt
    // aufzurufen wuerde auf exchange.html/forti.html die aktuelle
    // Produkt-Tab-Auswahl verwerfen, da die _currentProduct-Variable dort
    // lokal im jeweiligen Inline-Skript liegt, nicht in render.js.
    renderCommandGroups(_lastRenderedCommands);
  });
}


// ── Grouped Render ────────────────────────────────────────

let _lastRenderedCommands = [];

function renderCommandGroups(commands, containerId = 'commands-container') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const template = document.getElementById('command-template');
  if (!template) return;

  _lastRenderedCommands = commands;
  // opt-in: nur der Befehlsbereich der drei Befehlsseiten (Seitenklasse commands-page); sonst unverändert
  const cp = containerId === 'commands-container' && isCommandsPage();
  const visible = cp ? commands.filter(cpShouldShow) : commands.filter(shouldShowCommand);

  const fragment = document.createDocumentFragment();

  // Group by primary tag
  const groups = {};
  visible.forEach(cmd => {
    const tag = getPrimaryTag(cmd) || 'other';
    if (!groups[tag]) groups[tag] = [];
    groups[tag].push(cmd);
  });

  (cp ? cpOrderedGroups(groups) : Object.entries(groups)).forEach(([tag, cmds]) => {
    const meta = (cp ? cpCategoryMap() : CATEGORY_MAP)[tag] || { label: tag, dot: '#7c8cf8', icon: '📋' };

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
    cmds.forEach(cmd => gridFrag.appendChild(createCommandCard(template, cmd, cp ? { commandsPage: true } : undefined)));
    grid.appendChild(gridFrag);
    section.appendChild(grid);

    fragment.appendChild(section);
  });

  container.replaceChildren(fragment);
  if (typeof updateCommandCount === 'function') updateCommandCount(visible.length);
  if (typeof renderFavorites    === 'function') renderFavorites(_allCommands);
  if (cp) cpUpdateSafeHint(commands);
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
// Nur auf Seiten mit eigenem Command-Grid automatisch laden (windows.html/
// exchange.html/forti.html). Seiten, die render.js nur wegen einzelner
// Funktionen wie createCommandCard() einbinden (z.B. mitmachen.html fuer die
// Live-Vorschau), haben kein #commands-container und sollen keinen
// zusaetzlichen, ungenutzten commands.json-Fetch ausloesen.
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('commands-container')) return;
  if (isCommandsPage()) cpInitFavoritesObserver();
  loadCommands()
    .then(commands => {
      _allCommands = commands;
      renderFilterBar(commands);
      initSafeMode();
      renderCommandGroups(commands);
      if (typeof initSearch   === 'function') initSearch(commands);
      if (typeof initSearchUI === 'function') initSearchUI();
    })
    .catch(err => console.error('❌ Fehler:', err.message));
});
