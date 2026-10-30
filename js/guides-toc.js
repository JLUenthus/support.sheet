// ============================================================
// guide.sheet – guides-toc.js (Inhaltsverzeichnis in der Guide-Ansicht: Anzeigen und Springen)
// Zeigt links neben dem Text ein Panel mit allen Überschriften (h1 bis h4) des gerenderten Guides (#gv-content) und springt zu einer Überschrift.
// Der Eintrag des gerade sichtbaren Abschnitts ist hervorgehoben und bleibt im Panel sichtbar. Das Verzeichnis wird aus dem DOM abgeleitet, nichts wird gespeichert
// und nichts geschrieben: Das Anlegen von Überschriften gehört in den Editor (js/guides-toc-editor.js). Das Panel selbst steht in js/guides-toc-core.js.
// Alle Texte nur über textContent. Einziger Speicherzugriff: localStorage['gs-toc-open'] (in guides-toc-core.js). Keine Adressänderung (kein #anker).
// Wird von guides-view.js eingebunden: GuidesToc.init({ state, edit }) und GuidesToc.refresh() nach jedem Rendern.
// ============================================================
window.GuidesToc = (function () {
  'use strict';

  let api = null;          // Anbindung an guides-view.js: { state, edit }
  let entries = [];        // { el, level, text }
  let panel = null, btn = null;
  let settleStop = null;
  let ticking = false;

  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  // ── Überschriften sammeln (aus dem gerenderten DOM, nicht aus dem Markdown-Text) ──
  function collect() {
    entries = [];
    const root = $('gv-content');
    if (!root) return entries;
    const title = norm(api && api.state().title);
    let n = 0;
    root.querySelectorAll('h1,h2,h3,h4').forEach((h) => {
      const text = h.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return;
      const level = Number(h.tagName.charAt(1));
      if (norm(text) === 'inhaltsverzeichnis') return;       // handgeschriebenes Verzeichnis bleibt unangetastet
      if (level === 1 && norm(text) === title) return;       // Titelüberschrift des Guides
      n++;
      if (!h.id) h.id = 'gv-h-' + n;
      h.setAttribute('tabindex', '-1');
      h.classList.add('gv-toc-target');
      entries.push({ el: h, level, text });
    });
    return entries;
  }

  // ── Rollbereich: ab 901 px .gs-main, darunter die Seite ──
  function scroller() {
    const m = document.querySelector('.gs-main');
    return m && m.scrollHeight > m.clientHeight + 1 && getComputedStyle(m).overflowY !== 'visible' ? m : null;
  }

  // Mitführen: Eintrag des Abschnitts, dessen Überschrift zuletzt über der Lesemarke liegt
  function updateCurrent() {
    ticking = false;
    if (!panel || !entries.length) return;
    const sc = scroller();
    const base = (sc ? sc.getBoundingClientRect().top : 0) + 70;
    let cur = -1;
    entries.forEach((e, i) => { if (e.el.getBoundingClientRect().top <= base) cur = i; });
    const atEnd = sc ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2 : window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    if (atEnd && sc !== null || (!sc && atEnd && window.scrollY > 0)) cur = entries.length - 1;     // ganz unten angekommen: die letzten Überschriften erreichen die Lesemarke nie, der letzte Eintrag gilt
    panel.setCurrent(cur);
  }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(updateCurrent); } }

  function flash(target) {
    target.classList.add('gv-toc-flash');
    setTimeout(() => target.classList.remove('gv-toc-flash'), 1500);
  }

  // Nach dem Sprung verschieben nachladende Bilder oberhalb das Ziel: kurz nachführen, bis der Nutzer selbst bedient
  function settle(target) {
    if (settleStop) settleStop();
    const root = $('gv-content');
    let alive = true;
    let quiet = null;
    const bump = (ms) => { clearTimeout(quiet); quiet = setTimeout(() => stop(), ms); };
    const place = () => { if (alive && target.isConnected) target.scrollIntoView({ behavior: 'auto', block: 'start' }); };
    const again = () => { if (!alive) return; place(); requestAnimationFrame(place); bump(2500); };   // zweimal: sofort und nach dem Layout
    const evs = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    const stop = () => {
      alive = false; settleStop = null; clearTimeout(quiet); clearTimeout(cap);
      root.removeEventListener('load', again, true); root.removeEventListener('error', again, true);
      evs.forEach((n) => document.removeEventListener(n, stop, true));
    };
    root.addEventListener('load', again, true); root.addEventListener('error', again, true);
    evs.forEach((n) => document.addEventListener(n, stop, true));
    settleStop = stop;
    bump(4000);
    const cap = setTimeout(stop, 30000);
  }

  function goTo(target) {
    target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    flash(target);
    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    settle(target);
  }

  function jump(index, ev) {
    const entry = entries[index];
    if (!entry || !entry.el.isConnected) return;
    const keep = ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey);
    if (panel.isOverlay() && !keep) panel.close({ persist: false });   // Überlagerung schließt nach dem Sprung, angedockt bleibt das Panel offen
    goTo(entry.el);
  }

  function setEmptyUi() {
    const ro = !!(api && api.state().readonly);
    let b = $('gv-toc-edit');
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.id = 'gv-toc-edit'; b.className = 'gv-toc-btn-small'; b.textContent = 'Im Editor öffnen';
      b.addEventListener('click', () => { if (api && api.edit) api.edit(); });
      panel.empty.appendChild(b);
    }
    b.hidden = ro;                                            // Support-Guides sind schreibgeschützt: kein Weg in den Editor
  }

  // ── Anbindung ──
  function init(a) {
    api = a;
    btn = $('gv-toc-btn');
    if (!btn || !window.GuidesTocCore) return;
    const layout = document.querySelector('.gs-layout');
    panel = window.GuidesTocCore.create({
      mode: 'view', button: btn,
      dock: () => ({ parent: layout, before: document.querySelector('.gs-main') }),
      emptyText: 'Dieser Guide hat noch keine Überschriften. Überschriften legst du im Editor an.',
      onJump: jump,
      onOpen: () => { updateCurrent(); },
    });
    setEmptyUi();
    window.addEventListener('scroll', onScroll, { passive: true });
    const m = document.querySelector('.gs-main'); if (m) m.addEventListener('scroll', onScroll, { passive: true });
    refresh();
  }

  // Nach jedem Rendern: Überschriften neu sammeln (die IDs hängen an den neuen Elementen) und die Liste neu aufbauen
  function refresh() {
    collect();
    if (!panel) return;
    panel.setEntries(entries.map((e) => ({ text: e.text, level: e.level })));
    setEmptyUi();
    updateCurrent();
  }

  return { init, refresh, open: () => panel && panel.open(), close: () => panel && panel.close({ focusButton: true }), isOpen: () => !!panel && panel.isOpen() };
})();
