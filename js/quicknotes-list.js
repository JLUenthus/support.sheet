// ============================================================
// support.sheet – quicknotes-list.js (Quicknotes-Seite: Notizenliste, Mehrfachauswahl, Papierkorb-Dialog)
// Notizenliste als Seitenbereich (alle Notizen, offene und geschlossene, mit Filter), Mehrfachauswahl mit Sammelaktion in
// den Papierkorb (rev-Vergleich je Notiz, offene Notizen werden zuerst gespeichert, Rueckgaengig bleibt als Meldung stehen)
// und der Papierkorb-Dialog (mehrfach wiederherstellen, endgueltig loeschen, leeren – jede endgueltige Aktion in zwei
// Schritten mit Bestaetigung). Endgueltig geloescht wird NUR dort, nach Bestaetigung, nie automatisch.
// Die Regeln (Auswahl, Sammelaktion, Texte, Puffer) stehen in js/quicknotes-select.js und gelten genauso in der Guide-Uebersicht.
// Alle Titel und Texte werden nur ueber textContent/value ausgegeben.
// Erwartet js/quicknotes-db.js, js/quicknotes-select.js und js/quicknotes.js (window.QuickNotesPageInternal) vor dieser Datei.
// ============================================================
(function () {
  const DB = window.QuickNotesDB;
  const S = window.QuickNotesSelect;
  const P = window.QuickNotesPageInternal;
  const $ = (id) => document.getElementById(id);
  const PANEL_KEY = 'qn.notes-panel';
  const PREVIEW_LEN = 120;

  let notes = [];          // nicht geloeschte Notizen, zuletzt geaenderte zuerst
  let trashed = [];        // Notizen im Papierkorb, zuletzt geloescht zuerst
  let panelOpen = false;
  let selMode = false;
  let filterQ = '';
  let started = false;
  let busy = false;
  let refreshTimer = null;
  const sel = S.createSelection();

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const pad = (n) => String(n).padStart(2, '0');
  function dateTime(ts) { const d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function errText(err) { return (err && err.name && err.name !== 'Error' ? err.name + ': ' : '') + ((err && err.message) || 'Unbekannter Fehler'); }
  const narrow = () => !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
  const preview = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LEN);

  // ── Daten ─────────────────────────────────────────────
  const visibleNotes = () => S.filterNotes(notes, filterQ);
  const visibleIds = () => visibleNotes().map((n) => n.id);

  async function refresh() {
    if (!started) return;
    let all;
    try { all = await DB.list(); }
    catch (err) { const l = $('qn-note-list'); if (l) l.replaceChildren(el('li', 'qn-note-empty', 'Die Notizliste konnte nicht geladen werden: ' + errText(err))); return; }
    setData(all);
  }
  function setData(all) {
    notes = all.filter((n) => !n.trashedAt).sort((a, b) => b.updatedAt - a.updatedAt);
    trashed = all.filter((n) => n.trashedAt).sort((a, b) => b.trashedAt - a.trashedAt);
    sel.restrictTo(visibleIds());
    updateCounts();
    render();
  }
  function refreshSoon() {
    if (!started) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, 150);
  }

  function updateCounts() {
    $('qn-all-count').textContent = String(notes.length);
    $('qn-trash-count').textContent = String(trashed.length);
    updateEmptyText();
  }

  function updateEmptyText() {
    const e = $('qn-empty-text');
    if (!e) return;
    const closed = Math.max(0, notes.length - P.openIds().length);
    e.textContent = 'Keine Notiz offen.' + (closed ? ' ' + (closed === 1 ? '1 weitere Notiz ist' : closed + ' weitere Notizen sind') + ' geschlossen.' : '');
  }

  // ── Seitenbereich ─────────────────────────────────────
  function setPanel(open, persist) {
    panelOpen = !!open;
    $('qn-notes').hidden = !panelOpen;
    $('qn-all-btn').setAttribute('aria-expanded', String(panelOpen));
    if (persist) { try { localStorage.setItem(PANEL_KEY, panelOpen ? '1' : '0'); } catch (e) { /* Zustand ist verzichtbar */ } }
    if (panelOpen) render();
  }
  function openPanel() { if (!panelOpen) setPanel(true, true); const f = $('qn-filter'); if (f) f.focus(); }

  function setSelMode(on) {
    selMode = !!on;
    if (!selMode) sel.clear();
    $('qn-sel-toggle').setAttribute('aria-pressed', String(selMode));
    render();
  }

  function row(n, isOpen, isActive) {
    const li = el('li', 'qn-note-row' + (isOpen ? ' qn-note-row--open' : ''));
    li.dataset.id = n.id;
    if (selMode) {
      const c = el('input', 'qn-note-check');
      c.type = 'checkbox';
      c.setAttribute('aria-label', 'Notiz „' + n.title + '“ auswählen');
      c.addEventListener('click', (e) => { sel.click(n.id, visibleIds(), e.shiftKey); syncSelectionUi(); });
      li.appendChild(c);
    }
    const b = el('button', 'qn-note-item');
    b.type = 'button';
    if (isActive) b.setAttribute('aria-current', 'true');
    b.appendChild(el('span', 'qn-note-title', n.title));
    const meta = el('span', 'qn-note-meta');
    meta.appendChild(el('span', 'qn-note-time', dateTime(n.updatedAt)));
    if (isOpen) meta.appendChild(el('span', 'qn-note-open', 'offen'));
    if (n.convertedGuideId) meta.appendChild(el('span', 'qn-note-flag', '⇒ Guide'));
    b.appendChild(meta);
    b.addEventListener('click', (e) => {
      if (selMode) { sel.click(n.id, visibleIds(), e.shiftKey); syncSelectionUi(); return; }
      openNoteById(n.id);
    });
    li.appendChild(b);
    return li;
  }

  function render() {
    const list = $('qn-note-list');
    if (!list || !panelOpen) { updateEmptyText(); return; }
    const vis = visibleNotes();
    const open = new Set(P.openIds());
    const active = P.activeId();
    list.replaceChildren();
    vis.forEach((n) => list.appendChild(row(n, open.has(n.id), n.id === active)));
    if (!vis.length) list.appendChild(el('li', 'qn-note-empty', filterQ.trim() ? 'Keine Treffer.' : 'Keine Notizen vorhanden.'));
    $('qn-notes-sub').textContent = filterQ.trim() ? vis.length + ' von ' + notes.length + ' Notizen' : S.plural(notes.length, 'Notiz', 'Notizen');
    syncSelectionUi();
    updateEmptyText();
  }

  // Auswahlzustand in der Liste nachziehen (ohne neu zu zeichnen: Fokus bleibt)
  function syncSelectionUi() {
    const bar = $('qn-selbar');
    bar.hidden = !selMode;
    $('qn-sel-count').textContent = sel.size() + ' ausgewählt';
    const t = $('qn-sel-trash');
    t.textContent = 'In den Papierkorb (' + sel.size() + ')';
    t.disabled = sel.size() === 0 || busy;
    document.querySelectorAll('#qn-note-list .qn-note-row').forEach((li) => {
      const on = sel.has(li.dataset.id);
      li.classList.toggle('qn-note-row--sel', on);
      const c = li.querySelector('.qn-note-check');
      if (c) c.checked = on;
    });
  }

  async function openNoteById(id) {
    if (P.docById(id)) P.activate(id);
    else {
      try { const rec = await DB.get(id); if (rec && !rec.trashedAt) P.openNote(rec, { activate: true }); else refresh(); }
      catch (err) { P.banner('list-open', 'error', 'Die Notiz konnte nicht geöffnet werden: ' + errText(err), []); }
    }
    if (narrow()) setPanel(false, false);
  }

  // ── Sammelaktion: in den Papierkorb ───────────────────
  // Offene Notizen werden zuerst gespeichert (Flush). Gelingt das nicht, wird die Notiz uebersprungen und gemeldet – sie wird nie
  // in den Papierkorb gelegt, ohne dass ihr Text gespeichert ist. Danach gilt der rev-Vergleich in der Datenbank-Transaktion.
  async function prepareOpen(item) {
    const doc = P.docById(item.id);
    if (!doc) return { ok: true };
    await P.flush(doc);
    if (doc.state !== 'saved') return { ok: false, reason: 'nicht gespeichert (' + (doc.state === 'conflict' ? 'Konflikt mit einem anderen Fenster' : 'Speichern fehlgeschlagen') + ')' };
    return { ok: true, rev: doc.savedRev };
  }
  const trashOps = () => ({ prepare: prepareOpen, trash: (id, rev) => DB.setTrashedIfRev(id, true, rev) });
  const restoreOps = () => ({ restore: (id, rev) => DB.setTrashedIfRev(id, false, rev) });

  async function trashSelected() {
    if (busy) return;
    const items = visibleNotes().filter((n) => sel.has(n.id)).map((n) => ({ id: n.id, title: n.title, rev: n.rev }));
    if (!items.length) return;
    if (!window.confirm(S.confirmText('trash', items))) return;
    busy = true; syncSelectionUi();
    let res;
    try { res = await S.bulkTrash(items, trashOps()); }
    finally { busy = false; }
    // offene Tabs schliessen (die Nachbar-Notiz wird aktiv) – ausser es wurde nach dem Speichern noch getippt: dann bleibt der Tab offen
    const stillOpen = res.done.filter((d) => !P.adoptTrashed(d.id));
    setSelMode(false);
    await refresh();
    P.refreshMenus();
    reportBulk(res, stillOpen);
  }

  // Meldung bleibt bis zum Schliessen oder zur naechsten Aktion stehen (nicht nur 2 Sekunden); Rueckgaengig, solange sie da ist
  function reportBulk(res, stillOpen) {
    const actions = res.done.length ? [{ label: 'Rückgängig', primary: true, onClick: () => undo(res.done) }] : [];
    const extra = stillOpen && stillOpen.length
      ? ' ' + (stillOpen.length === 1 ? 'Eine Notiz hat' : stillOpen.length + ' Notizen haben') + ' nach dem Speichern noch neue Eingaben und ' + (stillOpen.length === 1 ? 'bleibt' : 'bleiben') + ' geöffnet (beim nächsten Speichern erscheint der Konflikt-Hinweis, Text geht nicht verloren): ' + S.titlesPreview(stillOpen) + '.'
      : '';
    P.banner('bulk', res.skipped.length || extra ? 'warn' : 'info', S.summarize(res, 'trash') + extra, actions);
  }
  async function undo(done) {
    let r;
    try { r = await S.bulkRestore(done, restoreOps()); }
    catch (err) { P.banner('bulk', 'error', 'Rückgängig fehlgeschlagen: ' + errText(err), []); return; }
    await refresh();
    P.refreshMenus();
    P.banner('bulk', r.skipped.length ? 'warn' : 'info', S.summarize(r, 'restore'), []);
  }

  // ── Papierkorb-Dialog ─────────────────────────────────
  async function openTrash() {
    if ($('qn-trash-dialog')) return;
    const tsel = S.createSelection();
    let rows = [];            // Notizen im Papierkorb (frisch gelesen)
    let confirming = null;    // { kind, items } waehrend der Bestaetigung (Schritt 2)
    let working = false;

    const overlay = el('div', 'qn-modal');
    overlay.id = 'qn-trash-dialog';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Papierkorb');
    const box = el('div', 'qn-modal-box');
    const head = el('div', 'qn-modal-head');
    head.appendChild(el('h2', 'qn-modal-title', 'Papierkorb'));
    const close = el('button', 'qn-btn', 'Schließen');
    close.type = 'button'; close.id = 'qn-trash-close';
    head.appendChild(close);

    const mk = (id, text, cls) => { const b = el('button', 'qn-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.id = id; return b; };
    const bAll = mk('qn-trash-selall', 'Alle auswählen'), bNone = mk('qn-trash-selnone', 'Auswahl aufheben');
    const bRestore = mk('qn-trash-restore', 'Wiederherstellen (0)'), bPurge = mk('qn-trash-purge', 'Endgültig löschen (0)', 'qn-btn--danger'), bEmpty = mk('qn-trash-empty', 'Papierkorb leeren', 'qn-btn--danger');
    const actions = el('div', 'qn-trash-actions');
    actions.append(bAll, bNone, bRestore, bPurge, bEmpty);
    const msg = el('p', 'qn-trash-msg');
    msg.id = 'qn-trash-msg'; msg.setAttribute('role', 'status'); msg.hidden = true;
    const confirmBox = el('div', 'qn-trash-confirm');
    confirmBox.id = 'qn-trash-confirm'; confirmBox.setAttribute('role', 'alertdialog'); confirmBox.setAttribute('aria-labelledby', 'qn-trash-confirm-text'); confirmBox.hidden = true;
    const confirmText = el('p', 'qn-trash-confirm-text'); confirmText.id = 'qn-trash-confirm-text';
    const bOk = mk('qn-trash-confirm-ok', 'Endgültig löschen', 'qn-btn--danger'), bCancel = mk('qn-trash-confirm-cancel', 'Abbrechen');
    const confirmActions = el('div', 'qn-trash-actions');
    confirmActions.append(bCancel, bOk);
    confirmBox.append(confirmText, confirmActions);
    const listEl = el('div', 'qn-trash-list');
    box.append(head, el('p', 'qn-modal-sub', 'Gelöschte Notizen werden nie automatisch endgültig entfernt. Endgültig löschen geht nur hier, in zwei Schritten (Auswahl, dann Bestätigung).'), actions, msg, confirmBox, listEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const prevFocus = document.activeElement;
    const closeDialog = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (confirming) cancelConfirm(); else closeDialog();
    };
    document.addEventListener('keydown', onKey, true);
    close.addEventListener('click', closeDialog);

    const selectedItems = () => rows.filter((n) => tsel.has(n.id)).map((n) => ({ id: n.id, title: n.title, rev: n.rev, text: n.text }));
    function say(text, kind) { msg.textContent = text; msg.hidden = !text; msg.className = 'qn-trash-msg' + (kind ? ' qn-trash-msg--' + kind : ''); }

    function sync() {
      const n = tsel.size();
      bRestore.textContent = 'Wiederherstellen (' + n + ')';
      bPurge.textContent = 'Endgültig löschen (' + n + ')';
      const lock = !!confirming || working;
      bRestore.disabled = n === 0 || lock; bPurge.disabled = n === 0 || lock;
      bAll.disabled = !rows.length || lock; bNone.disabled = n === 0 || lock; bEmpty.disabled = !rows.length || lock;
      listEl.querySelectorAll('.qn-trash-row').forEach((r) => {
        const on = tsel.has(r.dataset.id);
        r.classList.toggle('qn-trash-row--sel', on);
        const c = r.querySelector('.qn-trash-check'); if (c) { c.checked = on; c.disabled = lock; }
      });
    }

    async function fill() {
      let all;
      try { all = await DB.list(); }
      catch (err) { listEl.replaceChildren(el('p', 'qn-menu-empty', 'Der Papierkorb konnte nicht geladen werden: ' + errText(err))); return; }
      rows = all.filter((n) => n.trashedAt).sort((a, b) => b.trashedAt - a.trashedAt);
      tsel.restrictTo(rows.map((n) => n.id));
      listEl.replaceChildren();
      if (!rows.length) listEl.appendChild(el('p', 'qn-menu-empty', 'Der Papierkorb ist leer.'));
      rows.forEach((n) => {
        const r = el('div', 'qn-trash-row');
        r.dataset.id = n.id;
        const c = el('input', 'qn-trash-check');
        c.type = 'checkbox';
        c.setAttribute('aria-label', 'Notiz „' + n.title + '“ im Papierkorb auswählen');
        c.addEventListener('click', (e) => { tsel.click(n.id, rows.map((x) => x.id), e.shiftKey); sync(); });
        const info = el('div', 'qn-trash-info');
        info.append(el('span', 'qn-trash-title', n.title), el('span', 'qn-trash-meta', 'gelöscht am ' + dateTime(n.trashedAt) + ' · ' + n.text.length + ' Zeichen'));
        const pv = preview(n.text);
        if (pv) info.appendChild(el('span', 'qn-trash-preview', pv));
        if (n.convertedGuideId) {
          const a = el('a', 'qn-trash-guide', '⇒ Guide öffnen');
          a.href = 'guides-view.html?id=' + encodeURIComponent(n.convertedGuideId);
          info.appendChild(a);
        }
        r.append(c, info);
        listEl.appendChild(r);
      });
      sync();
      updateCountsFrom(rows);
    }
    function updateCountsFrom(r) { trashed = r; $('qn-trash-count').textContent = String(r.length); }

    async function afterChange() { await fill(); await refresh(); P.refreshMenus(); }

    async function doRestore(items) {
      working = true; sync();
      let r;
      try { r = await S.bulkRestore(items, restoreOps()); }
      catch (err) { working = false; say('Wiederherstellen fehlgeschlagen: ' + errText(err), 'error'); return; }
      working = false;
      say(S.summarize(r, 'restore') + ' Sie erscheinen wieder in der Notizenliste und in der Guide-Übersicht.', r.skipped.length ? 'warn' : 'ok');
      tsel.clear();
      await afterChange();
    }

    // Schritt 2: Bestaetigung im Dialog (Zahl und erste Titel)
    function startPurge(kind, items) {
      if (!items.length) return;
      confirming = { kind, items };
      confirmText.textContent = S.confirmText(kind, items);
      confirmBox.hidden = false;
      sync();
      bCancel.focus();
    }
    function cancelConfirm() { confirming = null; confirmBox.hidden = true; sync(); }

    async function doPurge(items) {
      working = true; sync();
      const done = [], skipped = []; let keptBuffers = 0;
      for (const it of items) {
        try {
          const r = await DB.purgeIfRev(it.id, it.rev);
          if (r.ok) { done.push({ id: it.id, title: it.title }); keptBuffers += S.purgeBuffersFor(localStorage, it.id, r.note.text).kept.length; }
          else skipped.push({ id: it.id, title: it.title, reason: r.missing ? 'existiert nicht mehr' : 'in einem anderen Fenster geändert' });
        } catch (err) { skipped.push({ id: it.id, title: it.title, reason: 'Fehler: ' + errText(err) }); }
      }
      working = false;
      say(S.summarize({ done, skipped }, 'purge') + (keptBuffers ? ' ' + keptBuffers + ' gepufferte, abweichende Texte bleiben erhalten und werden beim nächsten Start angeboten.' : ''), skipped.length ? 'warn' : 'ok');
      tsel.clear();
      await afterChange();
    }

    bAll.addEventListener('click', () => { tsel.selectAll(rows.map((n) => n.id)); sync(); });
    bNone.addEventListener('click', () => { tsel.clear(); sync(); });
    bRestore.addEventListener('click', () => doRestore(selectedItems().map((i) => ({ id: i.id, title: i.title, rev: i.rev }))));
    bPurge.addEventListener('click', () => startPurge('purge', selectedItems()));
    bEmpty.addEventListener('click', () => { tsel.selectAll(rows.map((n) => n.id)); startPurge('empty', rows.map((n) => ({ id: n.id, title: n.title, rev: n.rev, text: n.text }))); });
    bCancel.addEventListener('click', cancelConfirm);
    bOk.addEventListener('click', async () => { const c = confirming; cancelConfirm(); if (c) await doPurge(c.items); });

    await fill();
    close.focus();
  }

  // ── Start und Ereignisse ──────────────────────────────
  function start(all) {
    started = true;
    let stored = null;
    try { stored = localStorage.getItem(PANEL_KEY); } catch (e) { /* ohne Speicher */ }
    setPanel(stored === '1' ? true : stored === '0' ? false : !narrow(), false);
    setData(all);
    handleHash();
  }

  function handleHash() {
    if (decodeURIComponent((location.hash || '').slice(1)) === 'trash') openTrash();
  }

  function markersChanged() { if (started) { render(); } }

  function bind() {
    if (!$('qn-all-btn')) return;
    $('qn-all-btn').addEventListener('click', () => setPanel(!panelOpen, true));
    $('qn-filter').addEventListener('input', (e) => { filterQ = e.target.value; sel.restrictTo(visibleIds()); render(); });
    $('qn-sel-toggle').addEventListener('click', () => setSelMode(!selMode));
    $('qn-sel-all').addEventListener('click', () => { sel.selectAll(visibleIds()); syncSelectionUi(); });
    $('qn-sel-none').addEventListener('click', () => { sel.clear(); syncSelectionUi(); });
    $('qn-sel-cancel').addEventListener('click', () => setSelMode(false));
    $('qn-sel-trash').addEventListener('click', trashSelected);
    $('qn-new-in-list').addEventListener('click', () => P.newNote());
    $('qn-notes').addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (selMode) { setSelMode(false); $('qn-sel-toggle').focus(); }
      else if (narrow()) { setPanel(false, false); $('qn-all-btn').focus(); }
    });
    window.addEventListener('hashchange', handleHash);
  }

  window.QuickNotesList = { start, refresh, refreshSoon, markersChanged, openTrash, openPanel, handleHash };
  document.addEventListener('DOMContentLoaded', bind);
})();
