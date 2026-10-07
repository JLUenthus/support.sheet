// ============================================================
// support.sheet – Linux-Befehlsseite
// ============================================================
// Datengetrieben wie die Windows-Seite (data/linux-commands.json), gleiche
// Karten-/Grid-/Filter-Klassen (.command-card, .cmd-grid, .section-header,
// .filter-btn, .copy-btn, .star-btn). Logik (Varianten, {sudo}, Sichtbarkeit,
// Tags, Hinweise) in js/linux-core.js. Alle Texte aus der Datei werden nur über
// textContent/createElement ausgegeben, nie als HTML.
//
// Wiederverwendet: copyWithVariables()/Variablen-Modal (variables.js),
// copyToClipboard() inkl. Toast (render.js), Favoriten (favorites.js),
// Zuletzt benutzt (recent.js).
(function () {
  const LC = window.LinuxCore;
  if (!LC) return;

  const DEFAULT_URL = './data/linux-commands.json';
  const KEY_DISTRO = 'ss-linux-distro';   // Konvention der Seite: "ss-" wie ss-safe-mode
  const KEY_SUDO = 'ss-linux-sudo';

  // Kategorie-Darstellung wie CATEGORY_MAP (render.js): Punktfarbe + Icon.
  const CATEGORY_STYLE = {
    'System': { dot: '#7c8cf8', icon: '🖥️' },
    'Dienste und Logs': { dot: '#fbbf24', icon: '⚙️' },
    'Pakete': { dot: '#4ade80', icon: '📦' },
    'Netzwerk': { dot: '#2dd4bf', icon: '🌐' },
    'Firewall': { dot: '#f87171', icon: '🛡️' },
    'Benutzer': { dot: '#a78bfa', icon: '👥' },
    'Datenträger': { dot: '#60a5fa', icon: '💾' },
    'Prozesse': { dot: '#f472b6', icon: '⚡' },
    'Dateien': { dot: '#fb923c', icon: '📁' },
    'SSH': { dot: '#4ade80', icon: '🔑' },
    'Zeit und Cron': { dot: '#fbbf24', icon: '⏰' },
  };
  const FALLBACK_STYLE = { dot: '#7c8cf8', icon: '📋' };

  const state = { distro: 'all', sudo: true, category: 'all' };
  let data = null; // { distros, categories, commands, warnings }

  function $(id) { return document.getElementById(id); }
  function styleFor(cat) { return CATEGORY_STYLE[cat] || FALLBACK_STYLE; }

  // ── Wertprüfung für Platzhalter ──────────────────────────────
  // variables.js erlaubt nur [a-zA-Z0-9._@\- \\], das lehnt Linux-Pfade ab
  // (/var/log, user@host:/export). Auf dieser Seite gilt deshalb eine eigene
  // Prüfung, die weiterhin alle Shell-Metazeichen sperrt: ; & | $ ` ( ) < > \
  // Anführungszeichen, Sternchen und Zeilenumbrüche. Wirkt nur auf linux.html;
  // variables.js und die anderen Seiten bleiben unverändert.
  const LINUX_SAFE_VALUE = /^[A-Za-z0-9._@:\/+=,~%\- ]+$/;
  window.validateValue = function (value) {
    if (!value.trim()) return { ok: false, reason: 'Wert darf nicht leer sein' };
    if (!LINUX_SAFE_VALUE.test(value)) return { ok: false, reason: `Ungültige Zeichen in "${value}"` };
    return { ok: true };
  };

  // ── Einstellungen (gespeichert) ──────────────────────────────
  function loadPrefs() {
    try {
      const d = localStorage.getItem(KEY_DISTRO);
      state.distro = d === 'all' || (data && data.distros.some(x => x.id === d)) ? d : 'all';
      const s = localStorage.getItem(KEY_SUDO);
      state.sudo = s === null ? true : s === 'true';
    } catch { /* localStorage nicht verfügbar: Standardwerte */ }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* ignorieren */ }
  }

  // ── Karten ───────────────────────────────────────────────────
  function makeCopyBtn(card, variantDistro, variantCmd) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.dataset.action = 'copy';
    btn.textContent = '📋 Kopieren';
    btn.addEventListener('click', () => copyVariant(card, variantCmd, btn));
    return btn;
  }

  // Der kopierte Text ist immer die aktuell angezeigte Fassung: {sudo} nach
  // Schalter aufgelöst, danach laufen {platzhalter} durch den bestehenden
  // Mechanismus (Modal), der auch Recent befüllt.
  function copyVariant(card, rawCmd, btn) {
    const text = LC.resolveSudo(rawCmd, state.sudo);
    copyWithVariables({
      id: card.id, name: card.title, cmd: text, desc: card.desc, tags: LC.tagsFor(card, data.distros),
    }, btn);
  }

  function buildCard(card) {
    const el = document.createElement('div');
    el.className = 'command-card linux-card';
    el.dataset.cmdId = card.id;

    const header = document.createElement('div');
    header.className = 'card-header';
    const h3 = document.createElement('h3');
    h3.textContent = card.title;
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star-btn';
    star.dataset.action = 'star';
    updateStarBtn(star, isFavorite({ id: card.id }));
    star.textContent = '★';
    star.addEventListener('click', () => {
      toggleFavorite({ id: card.id });
      refreshStarButtons(data.commands);
      renderFavorites();
    });
    header.append(h3, star);
    el.appendChild(header);

    if (card.desc) {
      const p = document.createElement('p');
      p.textContent = card.desc;
      el.appendChild(p);
    }

    const footer = document.createElement('div');
    footer.className = 'card-footer';
    const tagBox = document.createElement('div');
    LC.tagsFor(card, data.distros).forEach(t => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = t;
      tagBox.appendChild(span);
    });
    footer.appendChild(tagBox);

    const showAllVariants = LC.hasVariants(card) && state.distro === 'all';
    if (showAllVariants) {
      // Modus "Alle": jede Variante in eigener Zeile mit Label und eigenem Kopieren-Button.
      LC.variantsOf(card, data.distros).forEach(v => {
        const row = document.createElement('div');
        row.className = 'linux-variant';
        const head = document.createElement('div');
        head.className = 'linux-variant-head';
        const label = document.createElement('span');
        label.className = 'linux-variant-label';
        label.textContent = data.distros.find(d => d.id === v.distro).label;
        head.append(label, makeCopyBtn(card, v.distro, v.cmd));
        const code = document.createElement('code');
        code.dataset.field = 'cmd';
        code.dataset.variant = v.distro;
        code.textContent = LC.resolveSudo(v.cmd, state.sudo);
        row.append(head, code);
        el.appendChild(row);
      });
    } else {
      const raw = LC.commandFor(card, state.distro);
      const code = document.createElement('code');
      code.dataset.field = 'cmd';
      code.textContent = LC.resolveSudo(raw, state.sudo);
      el.appendChild(code);
      footer.appendChild(makeCopyBtn(card, state.distro, raw));
    }

    LC.notesFor(card, state.distro, data.distros).forEach(n => {
      const p = document.createElement('p');
      p.className = 'linux-note';
      if (n.label) {
        const l = document.createElement('strong');
        l.textContent = n.label + ': ';
        p.appendChild(l);
      }
      p.appendChild(document.createTextNode(n.text));
      el.appendChild(p);
    });

    el.appendChild(footer);
    return el;
  }

  // ── Abschnitte ───────────────────────────────────────────────
  function sectionFor(label, icon, dot, cards) {
    const section = document.createElement('div');
    section.className = 'cmd-section';
    const header = document.createElement('div');
    header.className = 'section-header';
    const iconEl = document.createElement('div');
    iconEl.className = 'section-icon';
    iconEl.style.background = dot + '20';
    iconEl.style.borderColor = dot + '50';
    iconEl.textContent = icon;
    const labelEl = document.createElement('span');
    labelEl.className = 'section-label';
    labelEl.textContent = label;
    const countEl = document.createElement('span');
    countEl.className = 'section-count';
    countEl.textContent = cards.length;
    header.append(iconEl, labelEl, countEl);
    section.appendChild(header);
    const grid = document.createElement('div');
    grid.className = 'cmd-grid';
    cards.forEach(c => grid.appendChild(buildCard(c)));
    section.appendChild(grid);
    return section;
  }

  function recentCards() {
    if (typeof getRecent !== 'function') return [];
    const byId = new Map(data.commands.map(c => [c.id, c]));
    return getRecent().map(e => byId.get(e.id)).filter(Boolean);
  }

  function renderList() {
    const container = $('linux-container');
    const frag = document.createDocumentFragment();
    let shown = 0;
    if (state.category === '__recent__') {
      const cards = recentCards().filter(c => LC.isVisible(c, state.distro));
      shown = cards.length;
      if (cards.length) frag.appendChild(sectionFor('Zuletzt verwendet', '🕐', '#fbbf24', cards));
    } else {
      data.categories.forEach(cat => {
        if (state.category !== 'all' && state.category !== cat) return;
        const cards = data.commands.filter(c => c.category === cat && LC.isVisible(c, state.distro));
        if (!cards.length) return;
        shown += cards.length;
        const st = styleFor(cat);
        frag.appendChild(sectionFor(cat, st.icon, st.dot, cards));
      });
    }
    if (!shown) {
      const empty = document.createElement('p');
      empty.className = 'linux-empty';
      empty.textContent = state.category === '__recent__' ? 'Noch keine Linux-Befehle verwendet.' : 'Keine Befehle in dieser Auswahl.';
      frag.appendChild(empty);
    }
    container.replaceChildren(frag);
    const pill = $('cmd-count');
    if (pill) pill.textContent = shown + ' Befehle';
  }

  function renderCount() {
    const total = data.commands.length;
    const visible = LC.countVisible(data.commands, state.distro);
    const el = $('linux-count');
    if (state.distro === 'all') {
      el.textContent = `${total} Befehle, bei Befehlen mit Varianten stehen alle Distributionen untereinander.`;
    } else {
      const label = data.distros.find(d => d.id === state.distro).label;
      const hidden = total - visible;
      el.textContent = `${visible} von ${total} Befehlen für ${label} sichtbar` + (hidden ? ` (${hidden} nur für andere Distributionen ausgeblendet).` : '.');
    }
  }

  function renderFavorites() {
    const section = $('favorites-section');
    const container = $('favorites-container');
    const ids = getFavoriteIds();
    const favs = data.commands.filter(c => ids.includes(c.id) && LC.isVisible(c, state.distro));
    section.hidden = favs.length === 0;
    container.replaceChildren(...favs.map(buildCard));
  }

  function render() {
    renderCount();
    renderList();
    renderFavorites();
    if (typeof renderRecent === 'function') renderRecent();
  }

  // ── Steuerung ────────────────────────────────────────────────
  function buildDistroSwitch() {
    const group = $('linux-distro-group');
    const options = [{ id: 'all', label: 'Alle' }, ...data.distros.map(d => ({ id: d.id, label: d.label }))];
    options.forEach(o => {
      const label = document.createElement('label');
      label.className = 'linux-pill';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'linux-distro';
      input.value = o.id;
      input.checked = state.distro === o.id;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        state.distro = o.id;
        savePref(KEY_DISTRO, o.id);
        render();
      });
      const text = document.createElement('span');
      text.textContent = o.label;
      label.append(input, text);
      group.appendChild(label);
    });
  }

  function initSudoSwitch() {
    const box = $('linux-sudo-checkbox');
    const desc = $('linux-sudo-desc');
    box.checked = state.sudo;
    desc.textContent = state.sudo ? 'an' : 'aus';
    box.addEventListener('change', () => {
      state.sudo = box.checked;
      savePref(KEY_SUDO, state.sudo);
      desc.textContent = state.sudo ? 'an' : 'aus';
      render();
    });
  }

  // Filter-Leiste in derselben Struktur wie render.js (renderFilterBar).
  function buildFilterBar() {
    const bar = $('filter-bar');
    bar.replaceChildren();
    const mk = (tag, label, dot, extraClass) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-btn' + (extraClass ? ' ' + extraClass : '');
      btn.dataset.tag = tag;
      const d = document.createElement('span');
      d.className = 'filter-dot';
      d.style.background = dot;
      btn.append(d, document.createTextNode(label));
      return btn;
    };
    if (typeof getRecent === 'function' && getRecent().length) {
      const r = mk('__recent__', 'Zuletzt verwendet', '#fbbf24', 'filter-btn--recent');
      r.id = 'filter-btn-recent';
      const count = document.createElement('span');
      count.className = 'filter-recent-count';
      count.textContent = getRecent().length;
      r.appendChild(count);
      bar.appendChild(r);
    }
    const all = mk('all', 'Alle', '#7c8cf8');
    all.classList.add('active');
    bar.appendChild(all);
    data.categories.forEach(cat => bar.appendChild(mk(cat, cat, styleFor(cat).dot)));

    bar.addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      const tag = btn.dataset.tag;
      // "Zuletzt verwendet" ist ein Umschalter wie auf der Windows-Seite.
      if (tag === '__recent__' && btn.classList.contains('active')) {
        state.category = 'all';
      } else {
        state.category = tag;
      }
      bar.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.tag === state.category));
      renderList();
    });
  }

  // ── Laden ────────────────────────────────────────────────────
  function showError(message) {
    const box = $('linux-error');
    box.textContent = message;
    box.hidden = false;
    $('linux-count').textContent = '';
    $('linux-container').replaceChildren();
    const pill = $('cmd-count');
    if (pill) pill.textContent = '0 Befehle';
  }

  async function load() {
    const url = document.body.dataset.linuxData || DEFAULT_URL;
    let raw;
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) {
      showError(`Die Befehlsdatei (${url}) konnte nicht geladen werden: ${err.message}`);
      return;
    }
    try {
      data = LC.normalizeData(raw);
    } catch (err) {
      showError(`Die Befehlsdatei (${url}) ist ungültig: ${err.message}`);
      return;
    }
    data.warnings.forEach(w => console.warn('linux-commands:', w));
    loadPrefs();
    buildDistroSwitch();
    initSudoSwitch();
    buildFilterBar();
    render();
  }

  document.addEventListener('DOMContentLoaded', load);
})();
