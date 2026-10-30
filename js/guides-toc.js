// ============================================================
// guide.sheet – guides-toc.js (Inhaltsverzeichnis in der Guide-Ansicht)
// Zeigt ein kleines Fenster mit allen Überschriften (h1 bis h4) des gerenderten Guides (#gv-content), springt zu einer Überschrift und
// hängt auf Wunsch eine neue Überschrift ans Ende des Guides an. Das Verzeichnis wird aus dem DOM abgeleitet, nichts wird separat gespeichert.
//
// Datensicherheit beim Anfügen (nur anfügen, nie ändern):
//   - Grundlage ist der frisch gelesene gespeicherte Inhalt: der Schreibhelfer der Ansicht (writeFields in guides-view.js, darunter
//     GuidesDB.updateGuideFields mit expectedVersion und der dortigen Behandlung von Konflikt, Übernahme aus einem anderen Fenster
//     und Fehlern) ruft die Funktion mit dem frischen Stand auf; dieses Modul schreibt nie selbst.
//   - Nach dem Speichern wird der Guide zurückgelesen: neuer Inhalt = alter Inhalt + angefügter Block (Byte-gleich), Version um eins höher.
//   - "Rückgängig" entfernt genau den angefügten Block, und nur wenn der gespeicherte Inhalt noch damit endet.
// Alle Texte nur über textContent. Kein localStorage, keine Adressänderung (kein #anker).
// Wird von guides-view.js eingebunden: GuidesToc.init({ state, writeFields, afterAdopt, render, notify, edit }) und GuidesToc.refresh() nach jedem Rendern.
// ============================================================
window.GuidesToc = (function () {
  'use strict';

  const MAX_TITLE = 120;
  const LEVELS = [2, 3, 4];
  let api = null;          // Anbindung an guides-view.js
  let entries = [];        // { el, level, text }
  let panel = null, btn = null;
  let busy = false;
  let lastAppend = null;   // { block, seen: { content, version } }
  let lastSuggestion = '';
  let settleStop = null;

  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const verOf = (meta) => (meta && Number.isInteger(meta.version) && meta.version >= 1 ? meta.version : 1);
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

  // ── Titel bereinigen (rein, ohne DOM) ──
  function cleanTitle(raw) {
    const LB = new RegExp('\\s*[' + String.fromCharCode(13, 10, 0x2028, 0x2029) + ']+\\s*', 'g');      // Zeilenumbrüche (CR, LF, U+2028, U+2029) samt umgebendem Leerraum
    return String(raw == null ? '' : raw).replace(LB, ' ').trim().replace(/^[#\s]+/, '').trim();
  }

  // Liegt am Ende des Textes ein offener Codeblock? Dann wäre eine angefügte Überschrift Teil des Codes.
  function endsInOpenFence(content) {
    let open = null;
    String(content).split('\n').forEach((line) => {
      const m = /^\s*(`{3,}|~{3,})/.exec(line);
      if (!m) return;
      if (open === null) open = m[1].charAt(0);
      else if (m[1].charAt(0) === open) open = null;
    });
    return open !== null;
  }

  // Nummernvorschlag: Beginnen die Überschriften der Ebene mit einer Nummer ("11." oder "6.3"), die nächste Nummer; sonst leer.
  function suggest(level) {
    const same = entries.filter((e) => e.level === level && /^\d+(?:\.\d+)*\.?\s/.test(e.text));
    if (!same.length) return '';
    const m = /^(\d+(?:\.\d+)*)(\.?)\s/.exec(same[same.length - 1].text);
    const parts = m[1].split('.');
    parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
    return parts.join('.') + m[2] + ' ';
  }

  // ── Fenster aufbauen ──
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function build() {
    panel = document.createElement('dialog');
    panel.id = 'gv-toc-panel';
    panel.className = 'gv-toc-panel';
    panel.setAttribute('aria-labelledby', 'gv-toc-heading');

    const head = el('div', 'gv-toc-head');
    const h = el('div', 'gv-toc-heading', 'Inhaltsverzeichnis'); h.id = 'gv-toc-heading'; h.setAttribute('role', 'heading'); h.setAttribute('aria-level', '2');
    const close = el('button', 'gv-toc-close', '✕'); close.type = 'button'; close.id = 'gv-toc-close'; close.setAttribute('aria-label', 'Inhaltsverzeichnis schließen'); close.title = 'Schließen (Esc)';
    head.append(h, close);

    const filter = el('input', 'gv-toc-filter'); filter.type = 'text'; filter.id = 'gv-toc-filter'; filter.placeholder = 'Titel enthält …'; filter.autocomplete = 'off'; filter.spellcheck = false; filter.setAttribute('aria-label', 'Titel enthält');
    const count = el('div', 'gv-toc-count'); count.id = 'gv-toc-count'; count.setAttribute('aria-live', 'polite');
    const list = el('ul', 'gv-toc-list'); list.id = 'gv-toc-list';
    const empty = el('div', 'gv-toc-empty', 'Dieser Guide hat noch keine Überschriften.'); empty.id = 'gv-toc-empty'; empty.hidden = true;

    const msg = el('div', 'gv-toc-msg'); msg.id = 'gv-toc-msg'; msg.hidden = true;
    const msgText = el('div', 'gv-toc-msg-text'); msgText.id = 'gv-toc-msg-text';
    const msgActions = el('div', 'gv-toc-msg-actions');
    const undo = el('button', 'gv-toc-btn-small', 'Rückgängig'); undo.type = 'button'; undo.id = 'gv-toc-undo';
    const edit = el('button', 'gv-toc-btn-small', 'Bearbeiten'); edit.type = 'button'; edit.id = 'gv-toc-edit';
    const hint = el('div', 'gv-toc-msg-hint', 'Text unter der Überschrift im Editor ergänzen'); hint.id = 'gv-toc-hint';
    msgActions.append(undo, edit);
    msg.append(msgText, hint, msgActions);

    const add = el('form', 'gv-toc-add'); add.id = 'gv-toc-add'; add.noValidate = true;
    const addHead = el('div', 'gv-toc-add-head', 'Neuen Punkt anlegen');
    const row = el('div', 'gv-toc-add-row');
    const title = el('input', 'gv-toc-title'); title.type = 'text'; title.id = 'gv-toc-title'; title.placeholder = 'Titel der neuen Überschrift'; title.autocomplete = 'off'; title.spellcheck = false; title.setAttribute('aria-label', 'Titel der neuen Überschrift');
    const level = el('select', 'gv-toc-level'); level.id = 'gv-toc-level'; level.setAttribute('aria-label', 'Ebene');
    LEVELS.forEach((l) => { const o = el('option', null, 'H' + l); o.value = String(l); if (l === 2) o.selected = true; level.appendChild(o); });
    const submit = el('button', 'gv-toc-append', 'Am Ende anfügen'); submit.type = 'submit'; submit.id = 'gv-toc-append';
    row.append(title, level);
    add.append(addHead, row, submit);

    panel.append(head, filter, count, list, empty, msg, add);
    document.body.appendChild(panel);

    close.addEventListener('click', () => closePanel(true));
    filter.addEventListener('input', applyFilter);
    level.addEventListener('change', () => fillSuggestion());
    add.addEventListener('submit', (e) => { e.preventDefault(); append(); });
    undo.addEventListener('click', undoAppend);
    edit.addEventListener('click', () => { if (api && api.edit) api.edit(); });
    panel.addEventListener('keydown', onPanelKey);
  }

  function renderList() {
    const list = $('gv-toc-list');
    list.replaceChildren();
    const min = entries.reduce((m, e) => Math.min(m, e.level), 9);
    entries.forEach((e, i) => {
      const li = el('li', 'gv-toc-li');
      const b = el('button', 'gv-toc-item gv-toc-d' + Math.min(3, e.level - min), e.text);
      b.type = 'button'; b.dataset.index = String(i); b.dataset.level = String(e.level);
      b.addEventListener('click', (ev) => jump(i, ev));
      li.appendChild(b);
      list.appendChild(li);
    });
    $('gv-toc-empty').hidden = entries.length > 0;
    list.hidden = entries.length === 0;
    $('gv-toc-filter').hidden = entries.length === 0;
    $('gv-toc-count').hidden = entries.length === 0;
    applyFilter();
  }

  function applyFilter() {
    const q = norm($('gv-toc-filter').value);
    let shown = 0;
    [...$('gv-toc-list').children].forEach((li, i) => {
      const ok = !q || norm(entries[i].text).includes(q);
      li.hidden = !ok;
      if (ok) shown++;
    });
    const total = entries.length;
    $('gv-toc-count').textContent = !total ? '' : (shown === total ? total + (total === 1 ? ' Eintrag' : ' Einträge') : (shown ? shown + ' von ' + total : 'Keine Treffer (0 von ' + total + ')'));
  }

  function fillSuggestion() {
    const input = $('gv-toc-title');
    const next = suggest(Number($('gv-toc-level').value));
    if (input.value === '' || input.value === lastSuggestion) { input.value = next; lastSuggestion = next; }
  }

  function setReadonlyUi() {
    const ro = !!(api && api.state().readonly);
    $('gv-toc-add').hidden = ro;
  }

  // ── Meldungen im Fenster ──
  function message(text, type, opts) {
    opts = opts || {};
    const box = $('gv-toc-msg');
    box.hidden = !text;
    box.className = 'gv-toc-msg' + (type ? ' gv-toc-msg--' + type : '');
    box.setAttribute('role', type === 'error' ? 'alert' : 'status');
    $('gv-toc-msg-text').textContent = text || '';
    $('gv-toc-undo').hidden = !opts.undo;
    $('gv-toc-edit').hidden = !opts.edit;
    $('gv-toc-hint').hidden = !opts.edit;
    if (type === 'error' && text && typeof window.showToast === 'function') window.showToast(text, 'error', { persistent: true });
  }

  function lock(on) {
    ['gv-toc-title', 'gv-toc-level', 'gv-toc-append', 'gv-toc-undo'].forEach((id) => { const e = $(id); if (e) e.disabled = on; });
  }

  // ── Öffnen, Schließen, Springen ──
  function scroller() {
    const m = document.querySelector('.gs-main');
    return m && m.scrollHeight > m.clientHeight + 1 && getComputedStyle(m).overflowY !== 'visible' ? m : null;
  }

  function highlightCurrent() {
    const sc = scroller();
    const base = (sc ? sc.getBoundingClientRect().top : 0) + 70;
    let cur = -1;
    entries.forEach((e, i) => { if (e.el.getBoundingClientRect().top <= base) cur = i; });
    [...document.querySelectorAll('#gv-toc-list .gv-toc-item')].forEach((b, i) => {
      const on = i === cur;
      b.classList.toggle('gv-toc-current', on);
      if (on) b.setAttribute('aria-current', 'location'); else b.removeAttribute('aria-current');
    });
    const curBtn = document.querySelector('#gv-toc-list .gv-toc-current');
    if (curBtn) curBtn.scrollIntoView({ block: 'nearest' });
  }

  function place() {
    const r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const w = Math.min(420, vw - 16);
    panel.style.width = w + 'px';
    panel.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
    const top = Math.min(Math.max(8, r.bottom + 6), Math.max(8, vh - Math.min(520, vh - 16)));   // genug Höhe für Liste und Formular, auch wenn die Schaltfläche weit unten steht
    panel.style.top = top + 'px';
    panel.style.maxHeight = Math.max(120, vh - top - 8) + 'px';
  }

  function isOpen() { return !!panel && panel.open; }

  function openPanel() {
    if (!panel) build();
    collect();
    renderList();
    setReadonlyUi();
    $('gv-toc-filter').value = '';
    applyFilter();
    if (!panel.open) panel.show();
    place();
    fillSuggestion();
    btn.setAttribute('aria-expanded', 'true');
    highlightCurrent();
    const f = $('gv-toc-filter');
    (f.hidden ? $('gv-toc-title') : f).focus({ preventScroll: true });
    document.addEventListener('keydown', onDocKey, true);
  }

  function closePanel(focusButton) {
    if (!isOpen()) return;
    panel.close();
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onDocKey, true);
    if (focusButton) btn.focus({ preventScroll: true });
  }

  // Esc schließt das Fenster; die Seite selbst springt bei Esc sonst zur Übersicht (guides-view.js)
  function onDocKey(e) {
    if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); e.preventDefault(); closePanel(true); }
  }

  function visibleItems() { return [...document.querySelectorAll('#gv-toc-list .gv-toc-li:not([hidden]) .gv-toc-item')]; }

  function onPanelKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      const items = visibleItems();
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (document.activeElement && document.activeElement.id === 'gv-toc-title') return;
      let next;
      if (e.key === 'Home') next = 0; else if (e.key === 'End') next = items.length - 1;
      else if (i < 0) next = e.key === 'ArrowDown' ? 0 : items.length - 1;
      else next = Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (document.activeElement && document.activeElement.id === 'gv-toc-level') return;
      e.preventDefault(); items[next].focus({ preventScroll: false });
      return;
    }
    if (e.key === 'Tab') {                    // Fokusfalle nur innerhalb des Fensters
      const f = [...panel.querySelectorAll('button, input, select')].filter((x) => !x.disabled && !x.hidden && x.offsetParent !== null && !x.closest('[hidden]'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

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
    if (!keep) closePanel(false);
    goTo(entry.el);
  }

  // ── Neuen Punkt am Ende anfügen ──
  function failText(res) {
    if (res.aborted && res.code === 'OPENFENCE') return 'Der Guide endet in einem offenen Codeblock. Eine angefügte Überschrift wäre Teil des Codes. Nichts wurde geändert, bitte den Codeblock im Editor schließen.';
    if (res.aborted && res.code === 'MISMATCH') return 'Der Guide wurde inzwischen geändert. Bitte die Überschrift im Editor entfernen.';
    if (res.conflict) return 'Nicht gespeichert: ' + (res.error || 'Der Guide wurde geändert.') + ' Es wurde nichts geändert, bitte die Ansicht neu laden und es erneut versuchen.';
    return 'Nicht gespeichert: ' + (res.error || 'Der Guide konnte nicht geschrieben werden.') + ' Der Inhalt ist unverändert.';
  }

  async function readBack(id) {
    try { return await window.GuidesDB.getGuide(id); } catch (e) { return { success: false, error: String((e && e.message) || e) }; }
  }

  async function append() {
    if (busy || !api) return;
    const st = api.state();
    if (st.readonly) return;
    const title = cleanTitle($('gv-toc-title').value);
    const level = Number($('gv-toc-level').value);
    if (!title) { message('Bitte einen Titel eingeben.', 'error'); return; }
    if (title.length > MAX_TITLE) { message('Der Titel ist zu lang (' + title.length + ' Zeichen, höchstens ' + MAX_TITLE + ').', 'error'); return; }
    if (!LEVELS.includes(level)) { message('Ungültige Ebene.', 'error'); return; }
    const block = '\n' + '#'.repeat(level) + ' ' + title + '\n';
    busy = true; lock(true); message('', null);
    try {
      let seen = null;
      const res = await api.writeFields(({ meta, content }) => {
        if (endsInOpenFence(content)) { const e = new Error('offener Codeblock'); e.code = 'OPENFENCE'; throw e; }
        seen = { content, version: verOf(meta) };
        return { content: content + block };            // frisch gelesener Inhalt + Block, nie der Text aus dem DOM
      });
      if (!res || !res.success || !seen) { message(failText(res || {}), 'error'); return; }
      const back = await readBack(st.id);
      const ok = back && back.success && typeof back.content === 'string' && back.content.startsWith(seen.content) &&
        back.content === seen.content + block && verOf(back.meta) === seen.version + 1;
      if (!ok) { message('Nachprüfung fehlgeschlagen: Der gespeicherte Stand weicht vom erwarteten ab. Die Ansicht bleibt unverändert, bitte den Guide im Editor prüfen.', 'error'); return; }
      lastAppend = { block, seen };
      if (res.adopted) await api.afterAdopt(res); else await api.render();
      collect(); renderList();
      $('gv-toc-title').value = ''; lastSuggestion = '';
      fillSuggestion();
      message('Punkt am Ende des Guides angefügt.', 'ok', { undo: true, edit: true });
      const lastLi = $('gv-toc-list').lastElementChild; if (lastLi) lastLi.scrollIntoView({ block: 'nearest' });   // der neue Punkt steht am Ende der Liste (nach der Meldung, die Liste ist dann kürzer)
      const last = entries[entries.length - 1];
      if (last && last.text === title) goTo(last.el);
    } catch (err) {
      message('Nicht gespeichert: ' + ((err && err.message) || err) + ' Der Inhalt ist unverändert.', 'error');
    } finally { busy = false; lock(false); }
  }

  async function undoAppend() {
    if (busy || !api || !lastAppend) return;
    const st = api.state();
    if (st.readonly) return;
    const L = lastAppend;
    busy = true; lock(true);
    try {
      let seen = null;
      const res = await api.writeFields(({ meta, content }) => {
        if (!content.endsWith(L.block)) { const e = new Error('Der Guide endet nicht mehr mit dem angefügten Block.'); e.code = 'MISMATCH'; throw e; }
        seen = { content, version: verOf(meta) };
        return { content: content.slice(0, content.length - L.block.length) };
      });
      if (!res || !res.success || !seen) {
        if (res && res.aborted && res.code === 'MISMATCH') lastAppend = null;
        message(failText(res || {}), 'error', { undo: !!lastAppend });
        return;
      }
      const back = await readBack(st.id);
      const want = seen.content.slice(0, seen.content.length - L.block.length);
      const ok = back && back.success && back.content === want && verOf(back.meta) === seen.version + 1;
      if (!ok) { message('Nachprüfung fehlgeschlagen: Der gespeicherte Stand weicht vom erwarteten ab. Die Ansicht bleibt unverändert, bitte den Guide im Editor prüfen.', 'error'); return; }
      lastAppend = null;
      if (res.adopted) await api.afterAdopt(res); else await api.render();
      collect(); renderList(); fillSuggestion();
      message('Der angefügte Punkt wurde entfernt.', 'ok');
    } catch (err) {
      message('Nicht gespeichert: ' + ((err && err.message) || err) + ' Der Inhalt ist unverändert.', 'error', { undo: !!lastAppend });
    } finally { busy = false; lock(false); }
  }

  // ── Anbindung ──
  function init(a) {
    api = a;
    btn = $('gv-toc-btn');
    if (!btn) return;
    btn.addEventListener('click', () => { if (isOpen()) closePanel(true); else openPanel(); });
  }

  // Nach jedem Rendern: Überschriften neu sammeln (die IDs hängen an den neuen Elementen); ist das Fenster offen, die Liste neu aufbauen
  function refresh() {
    collect();
    if (isOpen()) { renderList(); setReadonlyUi(); fillSuggestion(); highlightCurrent(); }
  }

  return { init, refresh, open: openPanel, close: () => closePanel(true), cleanTitle, endsInOpenFence, suggest };
})();
