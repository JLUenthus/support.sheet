// ============================================================
// support.sheet – quicknotes-select.js (Quicknotes: gemeinsame Auswahllogik und Sammelaktionen)
// Reine Logik ohne DOM und ohne Datenbankzugriff (Node-testbar): Auswahlmenge mit Umschalten, "Alle auswählen",
// Bereichsauswahl (Umschalt+Klick), Filter, Sammelaktion in den Papierkorb mit rev-Vergleich je Notiz, Rückgängig,
// Meldungs- und Bestätigungstexte, Aufräumen der Schreibpuffer beim endgültigen Löschen.
// Wird von der Guide-Übersicht (js/quicknotes-overview.js) und der Quicknotes-Seite (js/quicknotes-list.js) benutzt,
// damit die Regeln nicht doppelt gebaut werden und nicht auseinanderlaufen.
//
// ops (vom Aufrufer, spricht mit quicknotes-db):
//   trash(id, expectedRev)   -> { ok:true, note } | { ok:false, conflict } | { ok:false, missing }   (rev-Vergleich in der Transaktion)
//   restore(id, expectedRev) -> wie trash
//   prepare(item)            -> { ok:true, rev? } | { ok:false, reason }   optional, z. B. offene Notiz zuerst speichern
// Titel und Texte werden hier nur als Text zu Zeichenketten zusammengesetzt; die Aufrufer geben sie über textContent aus.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuickNotesSelect = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PENDING_PREFIX = 'qn.pending.';

  // ── Auswahlmenge ──────────────────────────────────────
  function createSelection() {
    const set = new Set();
    let anchor = null;
    const api = {
      has: (id) => set.has(id),
      size: () => set.size,
      ids: () => [...set],
      get anchor() { return anchor; },
      toggle(id) { if (set.has(id)) set.delete(id); else set.add(id); anchor = id; return set.has(id); },
      set(ids) { set.clear(); ids.forEach((i) => set.add(i)); },
      clear() { set.clear(); anchor = null; },
      // nur die uebergebenen (sichtbaren) Eintraege kommen dazu
      selectAll(visibleIds) { visibleIds.forEach((i) => set.add(i)); },
      // nach einem Filterwechsel: Unsichtbares verlaesst die Auswahl (eine Sammelaktion trifft nie, was man nicht sieht)
      restrictTo(visibleIds) {
        const v = new Set(visibleIds);
        [...set].forEach((i) => { if (!v.has(i)) set.delete(i); });
        if (anchor != null && !v.has(anchor)) anchor = null;
      },
      // Klick auf einen Eintrag; mit Umschalt: alle sichtbaren Eintraege zwischen Anker und Klick dazu
      click(id, visibleIds, shift) {
        if (shift && anchor != null && visibleIds.includes(anchor) && visibleIds.includes(id)) {
          const a = visibleIds.indexOf(anchor), b = visibleIds.indexOf(id);
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(visibleIds[i]);
          return;                                   // der Anker bleibt, weitere Umschalt+Klicks erweitern von dort
        }
        api.toggle(id);
      },
    };
    return api;
  }

  // ── Filter: Titel und Text enthalten den Begriff ──────
  function filterNotes(notes, query) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return notes.slice();
    return notes.filter((n) => String(n.title || '').toLowerCase().includes(q) || String(n.text || '').toLowerCase().includes(q));
  }

  // ── Texte ─────────────────────────────────────────────
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const notes = (n) => plural(n, 'Notiz', 'Notizen');

  function titlesPreview(items, max) {
    max = max || 3;
    const t = items.slice(0, max).map((i) => '„' + i.title + '“');
    const rest = items.length - t.length;
    const base = t.length > 1 ? t.slice(0, -1).join(', ') + ' und ' + t[t.length - 1] : t.join('');
    if (!rest) return base;
    return t.join(', ') + ' und ' + rest + ' weitere';
  }

  function confirmText(kind, items) {
    const n = items.length;
    if (kind === 'trash') return notes(n) + ' in den Papierkorb legen? Sie lassen sich in den Quicknotes wiederherstellen.';
    if (kind === 'empty') return 'Papierkorb leeren: ' + notes(n) + ' endgültig löschen? Das kann nicht rückgängig gemacht werden. ' + titlesPreview(items);
    return notes(n) + ' endgültig löschen? Das kann nicht rückgängig gemacht werden. ' + titlesPreview(items);
  }

  const VERBS = { trash: 'in den Papierkorb gelegt', restore: 'wiederhergestellt', purge: 'endgültig gelöscht' };
  function summarize(res, kind) {
    const verb = VERBS[kind] || kind;
    let t = notes(res.done.length) + ' ' + verb + '.';
    if (res.skipped.length) {
      const list = res.skipped.slice(0, 5).map((s) => '„' + s.title + '“ (' + s.reason + ')').join(', ');
      t += ' ' + res.skipped.length + ' übersprungen: ' + list + (res.skipped.length > 5 ? ' und ' + (res.skipped.length - 5) + ' weitere' : '') + '.';
    }
    return t;
  }

  // ── Sammelaktionen ────────────────────────────────────
  const reasonOf = (r, conflictText) => (r && r.missing ? 'existiert nicht mehr' : conflictText);

  // items: [{ id, title, rev }] mit dem Stand (rev), den die Liste beim Laden hatte. Nacheinander, jede Notiz einzeln.
  async function bulkTrash(items, ops) {
    const done = [], skipped = [];
    for (const it of items) {
      try {
        let expected = it.rev;
        if (ops.prepare) {
          const p = await ops.prepare(it);
          if (!p || p.ok === false) { skipped.push({ id: it.id, title: it.title, reason: (p && p.reason) || 'nicht gespeichert' }); continue; }
          if (p.rev != null) expected = p.rev;
        }
        const r = await ops.trash(it.id, expected);
        if (r && r.ok) done.push({ id: it.id, title: it.title, rev: r.note && r.note.rev != null ? r.note.rev : expected + 1 });
        else skipped.push({ id: it.id, title: it.title, reason: reasonOf(r, 'in einem anderen Fenster geändert') });
      } catch (e) { skipped.push({ id: it.id, title: it.title, reason: 'Fehler: ' + ((e && e.message) || e) }); }
    }
    return { done, skipped };
  }

  // done: Ergebnis von bulkTrash (rev = Stand nach dem Verschieben). Geaenderte Notizen werden nicht ueberschrieben.
  async function bulkRestore(done, ops) {
    const ok = [], skipped = [];
    for (const d of done) {
      try {
        const r = await ops.restore(d.id, d.rev);
        if (r && r.ok) ok.push({ id: d.id, title: d.title, rev: r.note && r.note.rev != null ? r.note.rev : d.rev + 1 });
        else skipped.push({ id: d.id, title: d.title, reason: reasonOf(r, 'seit der Aktion geändert') });
      } catch (e) { skipped.push({ id: d.id, title: d.title, reason: 'Fehler: ' + ((e && e.message) || e) }); }
    }
    return { done: ok, skipped };
  }

  // ── Schreibpuffer beim endgueltigen Loeschen ──────────
  // Entfernt nur Puffer (qn.pending.<id>.<Fensterkennung>), deren Text dem gespeicherten Text entspricht; abweichende bleiben
  // (der naechste Start bietet sie als neue Notiz an). storage: localStorage oder ein Ersatz mit length/key/getItem/removeItem.
  function purgeBuffersFor(storage, id, text) {
    const prefix = PENDING_PREFIX + id + '.';
    const keys = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(prefix)) keys.push(k); }
    const removed = [], kept = [];
    keys.forEach((k) => {
      let p = null;
      try { p = JSON.parse(storage.getItem(k)); } catch (e) { p = null; }
      if (p && typeof p.text === 'string' && p.text === text) { try { storage.removeItem(k); removed.push(k); } catch (e) { kept.push(k); } }
      else kept.push(k);
    });
    return { removed, kept };
  }

  return { createSelection, filterNotes, bulkTrash, bulkRestore, summarize, confirmText, titlesPreview, purgeBuffersFor, plural };
});
