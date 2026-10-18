// ============================================================
// support.sheet – quicknotes-overview.js (Gruppe "Quicknotes" in der Guide-Übersicht, guides.html)
// Aufbau und Verhalten wie die Gruppe "Support" (js/guides-overview.js), aber ganz oben unter der Filterleiste.
// Liest NUR aus quicknotes-db (Titel, Vorschau, Änderungszeit) – der Titel steht nirgends doppelt. Unabhängig von den
// Guide-Filtern (Suche, Kategorie, Tag, Favoriten, Sortierung) und von den Zählern der Seitenleiste; die bestehende
// Guide-Logik wird nicht verändert. Fällt die Datenbank aus, zeigt nur diese Gruppe eine Fehlermeldung.
// Zustand wie beim Support-Schalter in localStorage: gs-hide-quicknotes ('true' = ausgeblendet; Standard: ausgeblendet).
// Erwartet js/quicknotes-db.js vor dieser Datei.
// ============================================================
(function () {
  const HIDE_KEY = 'gs-hide-quicknotes';
  const $ = (id) => document.getElementById(id);
  let rendering = false, again = false;

  function isHidden() { return localStorage.getItem(HIDE_KEY) !== 'false'; }

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(ts) { const d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function preview(text) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    return flat.slice(0, 150) || 'Leere Notiz.';
  }

  function applyVisibility() {
    const hidden = isHidden();
    const body = $('gs-qn-body'), toggle = $('gs-qn-toggle'), label = $('gs-qn-toggle-label');
    const chevron = toggle.querySelector('.gs-support-chevron');
    body.hidden = hidden;
    $('gs-qn-new').hidden = hidden;
    $('gs-qn-section').classList.toggle('gs-qn-section--open', !hidden);
    label.textContent = hidden ? 'einblenden' : 'ausblenden';
    if (chevron) chevron.style.transform = hidden ? 'rotate(-90deg)' : '';
    toggle.setAttribute('aria-expanded', String(!hidden));
  }

  function buildTile(note) {
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
    return tile;
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
      const notes = all.filter((n) => !n.trashedAt).sort((a, b) => b.updatedAt - a.updatedAt);
      count.textContent = String(notes.length);
      err.hidden = true;
      grid.replaceChildren();
      if (!notes.length) {
        const empty = document.createElement('p');
        empty.className = 'gs-qn-empty';
        empty.textContent = 'Noch keine Quicknotes.';
        grid.appendChild(empty);
      } else notes.forEach((n) => grid.appendChild(buildTile(n)));
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

  function init() {
    if (!$('gs-qn-section')) return;
    applyVisibility();
    $('gs-qn-toggle').addEventListener('click', () => {
      localStorage.setItem(HIDE_KEY, String(!isHidden()));
      applyVisibility();
    });
    $('gs-qn-new').addEventListener('click', createNew);
    render();
    try { if (window.QuickNotesDB) window.QuickNotesDB.onChange(render); } catch (e) { /* ohne BroadcastChannel: Aktualisierung beim Sichtbarwerden */ }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
