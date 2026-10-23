// ============================================================
// support.sheet – quicknotes-overview.js (Gruppe "Quicknotes" in der Guide-Übersicht, guides.html)
// Aufbau und Verhalten wie die Gruppe "Support" (js/guides-overview.js), aber ganz oben unter der Filterleiste.
// Liest NUR aus quicknotes-db (Titel, Vorschau, Änderungszeit) – der Titel steht nirgends doppelt. Unabhängig von den
// Guide-Filtern (Suche, Kategorie, Tag, Favoriten, Sortierung) und von den Zählern der Seitenleiste; die bestehende
// Guide-Logik wird nicht verändert. Fällt die Datenbank aus, zeigt nur diese Gruppe eine Fehlermeldung.
// Zustand wie beim Support-Schalter in localStorage: gs-hide-quicknotes ('true' = ausgeblendet; Standard: ausgeblendet).
// guides.html#quicknotes blendet die Gruppe NUR für diesen Besuch ein (der gespeicherte Zustand bleibt), scrollt sie ins
// Sichtfeld und setzt den Fokus auf die Kopfzeile.
// Auswahlmodus: mehrere Notizen markieren und gemeinsam in den Papierkorb legen (Regeln aus js/quicknotes-select.js, rev-Vergleich
// je Notiz, Rückgängig bleibt als Meldung stehen). Endgültig gelöscht wird hier NIE – nur im Papierkorb-Dialog der Quicknotes-Seite.
// Erwartet js/quicknotes-db.js und js/quicknotes-select.js vor dieser Datei.
// ============================================================
(function () {
  const HIDE_KEY = 'gs-hide-quicknotes';
  const $ = (id) => document.getElementById(id);
  const S = window.QuickNotesSelect;
  let rendering = false, again = false;
  let forced = false;            // #quicknotes: für diesen Besuch eingeblendet, ohne den gespeicherten Zustand zu ändern
  let selMode = false, busy = false;
  let notes = [];                // nicht gelöschte Notizen, zuletzt geändert zuerst
  const sel = S ? S.createSelection() : null;

  function isHidden() { return localStorage.getItem(HIDE_KEY) !== 'false'; }
  const isVisible = () => forced || !isHidden();

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(ts) { const d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function preview(text) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    return flat.slice(0, 150) || 'Leere Notiz.';
  }

  function applyVisibility() {
    const shown = isVisible();
    const toggle = $('gs-qn-toggle'), label = $('gs-qn-toggle-label');
    const chevron = toggle.querySelector('.gs-support-chevron');
    $('gs-qn-body').hidden = !shown;
    $('gs-qn-new').hidden = !shown;
    $('gs-qn-select').hidden = !shown;
    $('gs-qn-links').hidden = !shown;
    $('gs-qn-section').classList.toggle('gs-qn-section--open', shown);
    label.textContent = shown ? 'ausblenden' : 'einblenden';
    if (chevron) chevron.style.transform = shown ? '' : 'rotate(-90deg)';
    toggle.setAttribute('aria-expanded', String(shown));
    if (!shown && selMode) setSelMode(false);
  }

  // ── Kacheln ───────────────────────────────────────────
  const visibleIds = () => notes.map((n) => n.id);

  function buildTile(note) {
    const cell = document.createElement('div');
    cell.className = 'gs-qn-cell';
    const tile = document.createElement('a');
    tile.className = 'gg-tile gs-qn-tile';
    tile.href = 'quicknotes.html#' + encodeURIComponent(note.id);
    tile.dataset.noteId = note.id;

    const top = document.createElement('div');
    top.className = 'gg-tile-top';
    const heading = document.createElement('div');
    heading.className = 'gg-tile-heading';
    const title = document.createElement('h3');
    title.className = 'gg-tile-title';
    title.textContent = note.title || '(Ohne Titel)';
    heading.appendChild(title);
    top.appendChild(heading);

    const badges = document.createElement('div');
    badges.className = 'gg-tile-badges';
    const badge = document.createElement('span');
    badge.className = 'gg-cat-badge gs-qn-badge';
    badge.textContent = 'QUICKNOTE';
    badges.appendChild(badge);
    if (note.convertedGuideId) {
      const conv = document.createElement('span');
      conv.className = 'gg-cat-badge gs-qn-badge gs-qn-badge--conv';
      conv.textContent = 'UMGEWANDELT';
      badges.appendChild(conv);
    }

    const prev = document.createElement('p');
    prev.className = 'gg-tile-preview';
    prev.textContent = preview(note.text);

    const footer = document.createElement('div');
    footer.className = 'gg-tile-footer';
    const time = document.createElement('span');
    time.className = 'gs-qn-time';
    time.textContent = 'Geändert: ' + fmt(note.updatedAt);
    footer.appendChild(time);

    tile.append(top, badges, prev, footer);
    cell.appendChild(tile);

    if (selMode) {
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'gs-qn-check';
      chk.setAttribute('aria-label', 'Notiz „' + (note.title || 'Ohne Titel') + '“ auswählen');
      chk.addEventListener('click', (e) => { sel.click(note.id, visibleIds(), e.shiftKey); syncSel(); });
      cell.appendChild(chk);
      // Im Auswahlmodus wählt ein Klick auf die Kachel aus und öffnet nicht
      tile.addEventListener('click', (e) => { e.preventDefault(); sel.click(note.id, visibleIds(), e.shiftKey); syncSel(); });
    }
    return cell;
  }

  async function render() {
    if (rendering) { again = true; return; }
    rendering = true;
    const grid = $('gs-qn-grid'), count = $('gs-qn-count'), err = $('gs-qn-error');
    try {
      const db = window.QuickNotesDB;
      if (!db) throw new Error('quicknotes-db.js ist nicht geladen.');
      // Die Übersicht legt die Datenbank nicht an: solange keine Quicknote existiert, gibt es sie auch nicht.
      const all = (await db.exists()) ? await db.list() : [];
      notes = all.filter((n) => !n.trashedAt).sort((a, b) => b.updatedAt - a.updatedAt);
      count.textContent = String(notes.length);
      $('gs-qn-trashcount').textContent = String(all.length - notes.length);
      err.hidden = true;
      if (sel) sel.restrictTo(visibleIds());
      grid.replaceChildren();
      if (!notes.length) {
        const empty = document.createElement('p');
        empty.className = 'gs-qn-empty';
        empty.textContent = 'Noch keine Quicknotes.';
        grid.appendChild(empty);
      } else notes.forEach((n) => grid.appendChild(buildTile(n)));
      syncSel();
    } catch (e) {
      count.textContent = '!';
      grid.replaceChildren();
      err.textContent = 'Quicknotes konnten nicht geladen werden: ' + ((e && e.message) || e) + '. Die Guides sind davon nicht betroffen.';
      err.hidden = false;
    } finally {
      rendering = false;
      if (again) { again = false; render(); }
    }
  }

  // ── Auswahlmodus ──────────────────────────────────────
  function syncSel() {
    if (!sel) return;
    $('gs-qn-selbar').hidden = !selMode;
    $('gs-qn-sel-count').textContent = sel.size() + ' ausgewählt';
    const t = $('gs-qn-sel-trash');
    t.textContent = 'In den Papierkorb (' + sel.size() + ')';
    t.disabled = sel.size() === 0 || busy;
    $('gs-qn-select').setAttribute('aria-pressed', String(selMode));
    document.querySelectorAll('#gs-qn-grid .gs-qn-cell').forEach((cell) => {
      const id = cell.querySelector('.gs-qn-tile').dataset.noteId;
      const on = sel.has(id);
      cell.querySelector('.gs-qn-tile').classList.toggle('gs-qn-tile--sel', on);
      const c = cell.querySelector('.gs-qn-check');
      if (c) c.checked = on;
    });
  }

  function setSelMode(on) {
    selMode = !!on;
    if (!selMode && sel) sel.clear();
    render();
  }

  // Meldung bleibt bis zum Schließen oder zur nächsten Aktion stehen; Rückgängig, solange sie da ist
  function showMsg(text, warn, undoFn) {
    const m = $('gs-qn-msg');
    $('gs-qn-msg-text').textContent = text;
    m.classList.toggle('gs-qn-msg--warn', !!warn);
    const u = $('gs-qn-undo');
    u.hidden = !undoFn;
    u.onclick = undoFn ? () => undoFn() : null;
    m.hidden = false;
  }

  async function trashSelected() {
    if (busy || !sel) return;
    const items = notes.filter((n) => sel.has(n.id)).map((n) => ({ id: n.id, title: n.title, rev: n.rev }));
    if (!items.length) return;
    if (!window.confirm(S.confirmText('trash', items))) return;
    busy = true; syncSel();
    let res;
    try { res = await S.bulkTrash(items, { trash: (id, rev) => window.QuickNotesDB.setTrashedIfRev(id, true, rev) }); }
    finally { busy = false; }
    selMode = false; sel.clear();
    await render();
    showMsg(S.summarize(res, 'trash'), res.skipped.length > 0, res.done.length ? () => undo(res.done) : null);
  }

  async function undo(done) {
    let r;
    try { r = await S.bulkRestore(done, { restore: (id, rev) => window.QuickNotesDB.setTrashedIfRev(id, false, rev) }); }
    catch (e) { showMsg('Rückgängig fehlgeschlagen: ' + ((e && e.message) || e), true, null); return; }
    await render();
    showMsg(S.summarize(r, 'restore'), r.skipped.length > 0, null);
  }

  async function createNew() {
    const btn = $('gs-qn-new');
    btn.disabled = true;
    try {
      const note = await window.QuickNotesDB.create({});
      window.location.href = 'quicknotes.html#' + encodeURIComponent(note.id);
    } catch (e) {
      btn.disabled = false;
      const err = $('gs-qn-error');
      err.textContent = 'Die neue Quicknote konnte nicht angelegt werden: ' + ((e && e.message) || e);
      err.hidden = false;
      if (typeof showToast === 'function') showToast(err.textContent, 'error', { persistent: true });
    }
  }

  // guides.html#quicknotes: für diesen Besuch einblenden (gespeicherten Zustand nicht ändern), ins Sichtfeld scrollen, Kopfzeile fokussieren
  function handleHash() {
    if (location.hash !== '#quicknotes') return;
    forced = true;
    applyVisibility();
    const s = $('gs-qn-section'), h = $('gs-qn-header');
    if (s.scrollIntoView) s.scrollIntoView({ block: 'start' });
    if (h && h.focus) h.focus();
  }

  function init() {
    if (!$('gs-qn-section')) return;
    applyVisibility();
    $('gs-qn-toggle').addEventListener('click', () => {
      const nowShown = !isVisible();
      forced = false;                                   // eine ausdrückliche Entscheidung gilt (und wird gespeichert)
      localStorage.setItem(HIDE_KEY, String(!nowShown));
      applyVisibility();
    });
    $('gs-qn-new').addEventListener('click', createNew);
    if (sel) {
      $('gs-qn-select').addEventListener('click', () => setSelMode(!selMode));
      $('gs-qn-sel-all').addEventListener('click', () => { sel.selectAll(visibleIds()); syncSel(); });
      $('gs-qn-sel-none').addEventListener('click', () => { sel.clear(); syncSel(); });
      $('gs-qn-sel-cancel').addEventListener('click', () => setSelMode(false));
      $('gs-qn-sel-trash').addEventListener('click', trashSelected);
    }
    $('gs-qn-msg-close').addEventListener('click', () => { $('gs-qn-msg').hidden = true; });
    handleHash();
    render().then(() => { if (forced) handleHash(); });
    window.addEventListener('hashchange', handleHash);
    try { if (window.QuickNotesDB) window.QuickNotesDB.onChange(render); } catch (e) { /* ohne BroadcastChannel: Aktualisierung beim Sichtbarwerden */ }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
