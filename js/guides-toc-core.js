// ============================================================
// guide.sheet – guides-toc-core.js (gemeinsames Inhaltsverzeichnis-Panel für Guide-Ansicht und Editor)
// Baut ein Panel links neben dem Text: Kopf mit Schließen, Filter, Zählung, Liste (Einrückung nach Ebene), Platz für zusätzliche Bedienelemente (Editor: Formular).
//   - Angedockt (ab 1100 px): im normalen Fluss, position: sticky, eigener Scrollbereich; geschlossen belegt es keinen Platz.
//   - Überlagerung (unter 1100 px): position: fixed über der Seitenleiste (901 bis 1099 px) beziehungsweise links unter der Navigation (bis 900 px), mit Schließen-Knopf, Esc und Schließen nach einem Sprung.
//   - Zustand: localStorage['gs-toc-open'] ('true' oder 'false', Standard und bei jedem anderen Wert: geschlossen) ist der einzige Speicherzugriff dieses Moduls.
// Alle Texte nur über textContent. Kein IndexedDB, keine Adressänderung.
// Verwendung: const p = GuidesTocCore.create({ mode: 'view' | 'editor', button, dock: () => ({ parent, before }), onJump(index, ev), emptyText });
//   p.setEntries([{ text, level }]), p.setCurrent(index), p.open(), p.close(), p.toggle(), p.isOpen(), p.el, p.extra, p.empty, p.layout()
// ============================================================
window.GuidesTocCore = (function () {
  'use strict';

  const KEY = 'gs-toc-open';
  const DOCK_MIN = 1100;          // ab dieser Fensterbreite angedockt
  const STACK_MAX = 900;          // bis zu dieser Breite gestapeltes Layout (css/guides.css)

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function readOpen() { try { return window.localStorage.getItem(KEY) === 'true'; } catch (e) { return false; } }
  function writeOpen(v) { try { window.localStorage.setItem(KEY, v ? 'true' : 'false'); } catch (e) { /* kein Speicher: Zustand wird nicht gemerkt */ } }

  function create(opt) {
    const mode = opt.mode === 'editor' ? 'editor' : 'view';
    const btn = opt.button || null;
    let entries = [];
    let open = false;
    let current = -1;
    let overlay = false;

    // ── Aufbau ──
    const panel = el('aside', 'gv-toc-panel gv-toc-panel--' + mode);
    panel.id = 'gv-toc-panel';
    panel.setAttribute('aria-label', 'Inhaltsverzeichnis');
    panel.hidden = true;

    const head = el('div', 'gv-toc-head');
    const heading = el('div', 'gv-toc-heading', 'Inhaltsverzeichnis'); heading.id = 'gv-toc-heading'; heading.setAttribute('role', 'heading'); heading.setAttribute('aria-level', '2');
    const close = el('button', 'gv-toc-close', '✕'); close.type = 'button'; close.id = 'gv-toc-close'; close.setAttribute('aria-label', 'Inhaltsverzeichnis schließen'); close.title = 'Schließen (Esc)';
    head.append(heading, close);

    const filter = el('input', 'gv-toc-filter'); filter.type = 'text'; filter.id = 'gv-toc-filter'; filter.placeholder = 'Titel enthält …'; filter.autocomplete = 'off'; filter.spellcheck = false; filter.setAttribute('aria-label', 'Titel enthält');
    const count = el('div', 'gv-toc-count'); count.id = 'gv-toc-count'; count.setAttribute('aria-live', 'polite');
    const list = el('ul', 'gv-toc-list'); list.id = 'gv-toc-list';
    const empty = el('div', 'gv-toc-empty'); empty.id = 'gv-toc-empty'; empty.hidden = true;
    const emptyText = el('div', 'gv-toc-empty-text', opt.emptyText || 'Noch keine Überschriften.'); emptyText.id = 'gv-toc-empty-text';
    empty.appendChild(emptyText);
    const extra = el('div', 'gv-toc-extra'); extra.id = 'gv-toc-extra';
    panel.append(head, filter, count, list, empty, extra);

    // ── Liste ──
    function renderList() {
      list.replaceChildren();
      const min = entries.reduce((m, e) => Math.min(m, e.level), 9);
      entries.forEach((e, i) => {
        const li = el('li', 'gv-toc-li');
        const b = el('button', 'gv-toc-item gv-toc-d' + Math.min(3, e.level - min), e.text);
        b.type = 'button'; b.dataset.index = String(i); b.dataset.level = String(e.level);
        b.addEventListener('click', (ev) => { if (opt.onJump) opt.onJump(i, ev); });
        li.appendChild(b);
        list.appendChild(li);
      });
      const none = entries.length === 0;
      empty.hidden = !none;
      list.hidden = none;
      filter.hidden = none;
      count.hidden = none;
      applyFilter();
      paintCurrent(false);
    }

    function applyFilter() {
      const q = norm(filter.value);
      let shown = 0;
      [...list.children].forEach((li, i) => {
        const ok = !q || norm(entries[i].text).includes(q);
        li.hidden = !ok;
        if (ok) shown++;
      });
      const total = entries.length;
      count.textContent = !total ? '' : (shown === total ? total + (total === 1 ? ' Eintrag' : ' Einträge') : (shown ? shown + ' von ' + total : 'Keine Treffer (0 von ' + total + ')'));
    }

    // Eintrag im Listenbereich sichtbar halten, ohne die Seite zu scrollen (scrollIntoView würde alle Vorfahren mitrollen)
    function keepVisible(item) {
      if (!item || list.hidden) return;
      const lr = list.getBoundingClientRect(), ir = item.getBoundingClientRect();
      if (ir.top < lr.top) list.scrollTop -= (lr.top - ir.top) + 4;
      else if (ir.bottom > lr.bottom) list.scrollTop += (ir.bottom - lr.bottom) + 4;
    }

    function paintCurrent(scroll) {
      const items = [...list.querySelectorAll('.gv-toc-item')];
      items.forEach((b, i) => {
        const on = i === current;
        b.classList.toggle('gv-toc-current', on);
        if (on) b.setAttribute('aria-current', 'location'); else b.removeAttribute('aria-current');
      });
      if (scroll && open && items[current]) keepVisible(items[current]);
    }

    // ── Lage ──
    function layout() {
      const w = window.innerWidth;
      const vh = document.documentElement.clientHeight;      // ohne waagerechte Rollleiste: feste Elemente beziehen sich auf diesen Bereich
      overlay = w < DOCK_MIN;
      panel.classList.toggle('gv-toc-overlay', overlay);
      panel.classList.toggle('gv-toc-docked', !overlay);
      const s = panel.style;
      ['left', 'top', 'width', 'height', 'maxHeight', 'bottom'].forEach((k) => { s[k] = ''; });
      if (overlay) {
        const lay = document.querySelector('.gs-layout');
        const nav = document.querySelector('.as-tab-bar');
        const navBottom = nav ? nav.getBoundingClientRect().bottom : 70;
        if (w > STACK_MAX && lay) {                    // 901 bis 1099 px: über der Seitenleiste, bündig an der linken Kante des Layouts, nicht über dem Text
          const r = lay.getBoundingClientRect();
          s.left = Math.round(r.left) + 'px'; s.top = Math.round(Math.max(r.top, navBottom + 4)) + 'px'; s.width = '262px';
          s.height = Math.max(160, Math.round(vh - Math.max(r.top, navBottom + 4) - 64)) + 'px';   // unten Platz für den Pfeil nach oben (unter der Seitenleiste)
        } else {                                       // bis 900 px: links unter der Navigation, bei schmalen Fenstern volle Breite
          const reserve = mode === 'editor' ? 8 : 60;     // Ansicht: unten Platz für den Pfeil nach oben (rechts unten); im Editor gibt es dort keinen Seitenpfeil, die Fußleiste wird unten gesucht
          let top = navBottom + 8, bottom = vh - reserve;
          if (mode === 'editor') {                       // die Werkzeugleiste des Editors klebt oder liegt im Fenster: das Panel nimmt den größeren freien Bereich über oder unter ihr und verdeckt keinen ihrer Knöpfe
            const tb = document.getElementById('ge-toolbar'), q = tb && tb.getBoundingClientRect();
            if (q && q.height > 0 && q.bottom > navBottom && q.top < vh) {
              const aboveH = q.top - 8 - top, belowH = bottom - (q.bottom + 8);
              if (belowH >= aboveH) top = q.bottom + 8; else bottom = q.top - 8;
            }
            const bar = document.getElementById('ge-bottom-bar'), bq = bar && bar.getBoundingClientRect();
            if (bq && bq.height > 0 && bq.top < vh && bq.bottom > navBottom) bottom = Math.min(bottom, bq.top - 8);   // feste Fußleiste mit Speichern (am Seitenende steht sie über dem Fensterrand)
          }
          s.left = '8px'; s.top = Math.round(top) + 'px'; s.width = Math.min(340, w - 16) + 'px';
          s.height = Math.max(80, Math.round(bottom - top)) + 'px';
        }
      } else if (mode === 'editor') {                  // angedockt im Editor: unter der festen Werkzeugleiste, über der festen Fußleiste
        const main = document.querySelector('.gs-main');
        const tb = document.getElementById('ge-toolbar');
        const bar = document.getElementById('ge-bottom-bar');
        const top = (tb ? (parseFloat(getComputedStyle(tb).top) || 98) + tb.offsetHeight : 98) + 8;   // die Werkzeugleiste klebt bei top: 98px im Rollbereich
        const mcs = main ? getComputedStyle(main) : null;
        const pad = mcs ? (parseFloat(mcs.paddingTop) || 0) + (parseFloat(mcs.paddingBottom) || 0) : 0;      // klebende Elemente beziehen sich auf die Inhaltsfläche, nicht auf den Rand des Rollbereichs
        const mh = (main ? main.clientHeight : vh) - pad;
        s.top = top + 'px';
        s.maxHeight = Math.max(200, mh - top - (bar ? bar.offsetHeight : 60) - 12) + 'px';
      }
    }

    // ── Öffnen und Schließen ──
    function sync() {
      panel.hidden = !open;
      panel.classList.toggle('gv-toc-open', open);
      if (btn) {
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.textContent = open ? '📑 Inhaltsverzeichnis ausblenden' : '📑 Inhaltsverzeichnis anzeigen';
      }
    }

    function openPanel(o) {
      o = o || {};
      if (!panel.isConnected) dock();
      layout();
      open = true; sync();
      layout();
      if (o.persist !== false) writeOpen(true);
      document.addEventListener('keydown', onDocKey, true);
      paintCurrent(true);
      if (o.focus !== false && overlay) { const f = filter.hidden ? close : filter; f.focus({ preventScroll: true }); }
      if (!o.silent && opt.onOpen) opt.onOpen();
    }

    function closePanel(o) {
      o = o || {};
      if (!open) return;
      open = false; sync();
      if (o.persist !== false) writeOpen(false);
      document.removeEventListener('keydown', onDocKey, true);
      if (o.focusButton && btn) btn.focus({ preventScroll: true });
      if (opt.onClose) opt.onClose();
    }

    // Esc schließt das Panel (Überlagerung immer, angedockt wenn der Fokus im Panel liegt); die Ansicht springt bei Esc sonst zur Übersicht (guides-view.js)
    function onDocKey(e) {
      if (e.key !== 'Escape' || !open) return;
      if (overlay || panel.contains(document.activeElement)) { e.stopPropagation(); e.preventDefault(); closePanel({ focusButton: true }); }
    }

    function visibleItems() { return [...list.querySelectorAll('.gv-toc-li:not([hidden]) .gv-toc-item')]; }

    panel.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        const a = document.activeElement;
        if (a && a !== filter && !a.classList.contains('gv-toc-item')) return;     // in Formularfeldern behalten die Pfeiltasten ihre Bedeutung
        if (a === filter && (e.key === 'Home' || e.key === 'End')) return;
        const items = visibleItems(); if (!items.length) return;
        const i = items.indexOf(a);
        let next;
        if (e.key === 'Home') next = 0; else if (e.key === 'End') next = items.length - 1;
        else if (i < 0) next = e.key === 'ArrowDown' ? 0 : items.length - 1;
        else next = Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        e.preventDefault(); items[next].focus({ preventScroll: true }); keepVisible(items[next]);
      }
    });

    close.addEventListener('click', () => closePanel({ focusButton: true }));
    filter.addEventListener('input', applyFilter);
    if (btn) btn.addEventListener('click', () => { if (open) closePanel({ focusButton: true }); else openPanel({ focus: true }); });

    // ── Andocken (im Fluss) ──
    function dock() {
      const d = opt.dock ? opt.dock() : null;
      if (d && d.parent) d.parent.insertBefore(panel, d.before || null); else document.body.appendChild(panel);
    }

    let rz = null;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (open) layout(); }, 80); });
    // Editor bis 900 px: die Werkzeugleiste wandert beim Rollen bis zu ihrer klebenden Lage, das Panel folgt ihr (gedrosselt)
    let sq = false;
    window.addEventListener('scroll', () => { if (mode === 'editor' && open && overlay && !sq) { sq = true; requestAnimationFrame(() => { sq = false; if (open && overlay) layout(); }); } }, { passive: true });

    dock();
    sync();
    layout();
    // Zustand vom letzten Mal: nur angedockt von selbst öffnen (eine Überlagerung über dem Text wäre beim Laden störend)
    if (readOpen() && window.innerWidth >= DOCK_MIN) openPanel({ persist: false, focus: false, silent: true });   // onOpen erst nach dem Aufbau des Adapters (er lädt die Einträge selbst)

    return {
      el: panel, extra, empty, emptyText, list, filter,
      setEntries(a) { entries = a.slice(); if (current >= entries.length) current = -1; renderList(); },
      setCurrent(i) { if (i === current) return; current = i; paintCurrent(true); },
      getCurrent() { return current; },
      open: openPanel, close: closePanel, toggle() { if (open) closePanel({ focusButton: true }); else openPanel({ focus: true }); },
      isOpen: () => open, isOverlay: () => overlay, layout,
    };
  }

  return { create, KEY, DOCK_MIN, readOpen, writeOpen, norm };
})();
