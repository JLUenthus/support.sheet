// ============================================================
// support.sheet – quicknotes.js (Quicknotes: Seitenlogik)
// Tabs wie Notepad++, Klartext-Editor, Autosave mit Schreibpuffer (localStorage) und Revisionspruefung.
// Grundsatz: nichts geht still verloren. Ein Text verlaesst Editor und Schreibpuffer erst, nachdem die Datenbank das
// Speichern bestaetigt hat (Transaktion abgeschlossen) oder der Nutzer ausdruecklich entschieden hat.
// Alle Notiztexte und Titel werden ausschliesslich ueber textContent/value ausgegeben, nie als HTML.
// Erwartet js/quicknotes-db.js und js/quicknotes-io.js vor dieser Datei.
// ============================================================
(function () {
  const DB = window.QuickNotesDB;
  const IO = window.QuickNotesIO;
  const WIN = DB.WINDOW_ID;

  const SESSION_KEY = 'qn.session';
  const PENDING_PREFIX = 'qn.pending.';
  const BACKUP_KEY = 'qn.lastBackup';
  const DEBOUNCE_MS = 500;
  const PENDING_THROTTLE_MS = 120;
  const RETRY_BASE_MS = 2000;
  const RETRY_MAX_MS = 30000;
  const ZOOM_MIN = 9, ZOOM_MAX = 32, ZOOM_DEFAULT = 14;

  const $ = (id) => document.getElementById(id);
  const docs = new Map();      // id -> doc
  let order = [];              // ids der geoeffneten Tabs in Reihenfolge
  let activeId = null;
  let wrap = false;
  let zoom = ZOOM_DEFAULT;
  let fallbackMode = false;
  let persisted = false;
  let tabEscape = false;       // Esc gedrueckt: naechste Tab-Taste verlaesst das Textfeld
  const globalBanners = [];    // { key, kind, text, actions }
  const recoveryOffers = [];   // { key, pendingKey, pending, note }

  // ── kleine Helfer ─────────────────────────────────────
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const pad = (n) => String(n).padStart(2, '0');
  function hhmmss(ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function hhmm(ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dateTime(ts) { const d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + hhmm(ts); }
  function errText(err) {
    if (!err) return 'Unbekannter Fehler';
    if (err.name === 'QuotaExceededError') return 'Speicher voll (QuotaExceededError)';
    return (err.name && err.name !== 'Error' ? err.name + ': ' : '') + (err.message || 'Unbekannter Fehler');
  }
  function notify(message, type) { if (typeof showToast === 'function') showToast(message, type || 'success'); }

  // ── Sitzung (Tabs, Reihenfolge, aktive Notiz, Umbruch, Zoom) ──
  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (s && s.v === 1 && Array.isArray(s.open)) return s;
    } catch (e) { /* unlesbar: wie nicht vorhanden */ }
    return null;
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ v: 1, open: order, active: activeId, wrap, zoom })); } catch (e) { /* Zustand ist verzichtbar */ }
  }

  // ── Schreibpuffer ─────────────────────────────────────
  function pendingKey(doc) { return PENDING_PREFIX + doc.id + '.' + WIN; }
  function writePendingNow(doc) {
    if (doc.pendingTimer) { clearTimeout(doc.pendingTimer); doc.pendingTimer = null; }
    doc.lastPendingWrite = Date.now();
    try {
      localStorage.setItem(pendingKey(doc), JSON.stringify({ id: doc.id, title: doc.title, text: doc.text, ts: Date.now(), rev: doc.savedRev, win: WIN }));
      doc.pendingFailed = false;
    } catch (e) { doc.pendingFailed = true; }
    if (doc.id === activeId) updateStatus();
  }
  function writePendingThrottled(doc) {
    const wait = PENDING_THROTTLE_MS - (Date.now() - doc.lastPendingWrite);
    if (wait <= 0) writePendingNow(doc);
    else if (!doc.pendingTimer) doc.pendingTimer = setTimeout(() => writePendingNow(doc), wait);
  }
  function removePending(doc) {
    if (doc.pendingTimer) { clearTimeout(doc.pendingTimer); doc.pendingTimer = null; }
    try { localStorage.removeItem(pendingKey(doc)); } catch (e) { /* nichts zu tun */ }
  }

  // ── Dokument-Zustand ──────────────────────────────────
  function makeDoc(note) {
    return {
      id: note.id, title: note.title, createdAt: note.createdAt, text: note.text,
      savedText: note.text, savedTitle: note.title, savedRev: note.rev, savedAt: note.updatedAt,
      state: 'saved', error: null, conflict: null, conflictHidden: false, remoteChanged: null, remoteTrashed: false,
      timer: null, retryTimer: null, retries: 0, queue: Promise.resolve(), pendingTimer: null, lastPendingWrite: 0, pendingFailed: false,
      pane: null, gutter: null, ta: null, lineCount: 0,
      convertedGuideId: note.convertedGuideId || null, convertedAt: note.convertedAt || null,   // optionale Felder (Umwandlung in einen Guide)
    };
  }
  const isClean = (doc) => doc.text === doc.savedText && doc.title === doc.savedTitle;
  const needsSave = (doc) => doc.state !== 'saved';

  function setState(doc, state) {
    doc.state = state;
    updateTabState(doc);
    if (doc.id === activeId) { renderBanners(); updateStatus(); }
  }

  function scheduleSave(doc) {
    clearTimeout(doc.timer);
    doc.timer = setTimeout(() => { doc.timer = null; flush(doc); }, DEBOUNCE_MS);
  }

  function enqueue(doc, fn) {
    doc.queue = doc.queue.then(fn, fn);
    return doc.queue;
  }

  // Sofort speichern (Debounce ueberspringen). Der Schreibpuffer wird zuerst synchron geschrieben.
  function flush(doc) {
    if (!docs.has(doc.id)) return Promise.resolve();
    clearTimeout(doc.timer); doc.timer = null;
    if (!isClean(doc)) writePendingNow(doc);
    return enqueue(doc, () => saveNow(doc));
  }
  function flushAll() { return Promise.all([...docs.values()].map(flush)); }

  async function saveNow(doc) {
    if (!docs.has(doc.id)) return;
    if (doc.state === 'conflict') return;                        // wartet auf Entscheidung des Nutzers
    if (isClean(doc)) {
      if (doc.state !== 'saved') { doc.error = null; setState(doc, 'saved'); }
      removePending(doc);
      return;
    }
    const text = doc.text, title = doc.title;
    setState(doc, 'saving');
    let res;
    try { res = await DB.save(doc.id, { text, title }, doc.savedRev); }
    catch (err) { onSaveError(doc, err); return; }
    if (res.conflict) { onConflict(doc, res.current); return; }
    if (res.missing) { onConflict(doc, null); return; }
    doc.savedRev = res.note.rev; doc.savedText = res.note.text; doc.savedTitle = res.note.title; doc.savedAt = Date.now();
    doc.retries = 0; doc.error = null;
    clearTimeout(doc.retryTimer); doc.retryTimer = null;
    if (isClean(doc)) { removePending(doc); setState(doc, 'saved'); }
    else { setState(doc, 'dirty'); scheduleSave(doc); }         // waehrenddessen weitergetippt
    if (window.QuickNotesList) window.QuickNotesList.refreshSoon();      // neue Aenderungszeit in der Liste
    if (doc.id === activeId) updateStatus();
  }

  function onSaveError(doc, err) {
    doc.error = err;
    writePendingNow(doc);                                          // Text bleibt im Puffer
    setState(doc, 'error');
    clearTimeout(doc.retryTimer);
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(2, doc.retries));
    doc.retries++;
    doc.retryTimer = setTimeout(() => { doc.retryTimer = null; flush(doc); }, delay);
  }

  function onConflict(doc, current) {
    doc.conflict = { current };
    doc.conflictHidden = false;
    clearTimeout(doc.retryTimer); doc.retryTimer = null;
    writePendingNow(doc);
    setState(doc, 'conflict');
  }

  // Laedt einen gespeicherten Stand in den Editor (nur nach ausdruecklicher Entscheidung oder bei sauberem Dokument).
  function loadFromRecord(doc, rec) {
    doc.text = rec.text; doc.savedText = rec.text; doc.title = rec.title; doc.savedTitle = rec.title;
    doc.savedRev = rec.rev; doc.savedAt = rec.updatedAt;
    doc.convertedGuideId = rec.convertedGuideId || null; doc.convertedAt = rec.convertedAt || null;
    doc.error = null; doc.conflict = null; doc.conflictHidden = false; doc.remoteChanged = null; doc.retries = 0;
    clearTimeout(doc.timer); clearTimeout(doc.retryTimer); doc.timer = doc.retryTimer = null;
    removePending(doc);
    if (doc.ta.value !== rec.text) doc.ta.value = rec.text;
    updateGutter(doc);
    updateTabState(doc);
    setState(doc, 'saved');
    renderTabs();
  }

  // ── Banner ────────────────────────────────────────────
  function banner(kind, text, actions) {
    const b = el('div', 'qn-banner qn-banner--' + kind);
    b.setAttribute('role', kind === 'info' ? 'status' : 'alert');
    b.appendChild(el('p', 'qn-banner-text', text));
    if (actions && actions.length) {
      const row = el('div', 'qn-banner-actions');
      actions.forEach((a) => {
        let btn;
        if (a.href) { btn = el('a', 'qn-btn' + (a.primary ? ' qn-btn--primary' : ''), a.label); btn.href = a.href; }   // echter Link (Text per textContent)
        else { btn = el('button', 'qn-btn' + (a.primary ? ' qn-btn--primary' : ''), a.label); btn.type = 'button'; btn.addEventListener('click', a.onClick); }
        row.appendChild(btn);
      });
      b.appendChild(row);
    }
    return b;
  }

  function saveDocAsFile(doc) {
    IO.download(IO.textBlob(doc.text), IO.safeFileName(doc.title) + '.txt');
  }

  function docBanners(doc) {
    const out = [];
    if (doc.state === 'error') {
      out.push(banner('error',
        'Speichern fehlgeschlagen: ' + errText(doc.error) + '. Der Text bleibt im Editor und im Schreibpuffer, es wird automatisch erneut versucht.',
        [{ label: 'Als Datei sichern (.txt)', primary: true, onClick: () => saveDocAsFile(doc) }, { label: 'Jetzt erneut versuchen', onClick: () => { doc.retries = 0; flush(doc); } }]));
    } else if (doc.state === 'conflict') {
      if (doc.conflictHidden) {
        out.push(banner('error', 'Konflikt – diese Notiz ist nicht gespeichert (weiter bearbeiten möglich, nichts wird überschrieben).', [{ label: 'Konflikt lösen …', onClick: () => { doc.conflictHidden = false; renderBanners(); } }]));
      } else {
        const cur = doc.conflict && doc.conflict.current;
        const text = cur
          ? 'Konflikt: Diese Notiz wurde in einem anderen Fenster geändert (Stand von ' + hhmmss(cur.updatedAt) + '). Deine Version wurde NICHT gespeichert und bleibt unverändert im Editor.'
          : 'Diese Notiz existiert nicht mehr (in einem anderen Fenster endgültig gelöscht). Deine Version bleibt unverändert im Editor.';
        const actions = [{ label: 'Meine Version als neue Notiz sichern', primary: true, onClick: () => resolveSaveAsNew(doc) }];
        if (cur) actions.push({ label: 'Stand aus dem anderen Fenster laden', onClick: () => resolveLoadOther(doc) });
        actions.push({ label: 'Weiter bearbeiten', onClick: () => { doc.conflictHidden = true; renderBanners(); doc.ta.focus(); } });
        out.push(banner('error', text, actions));
      }
    } else if (doc.remoteChanged) {
      out.push(banner('info', 'Diese Notiz wurde in einem anderen Fenster geändert.', [
        { label: 'Neu laden', primary: true, onClick: () => loadFromRecord(doc, doc.remoteChanged) },
        { label: 'Ignorieren', onClick: () => { doc.remoteChanged = null; renderBanners(); } },
      ]));
    }
    if (doc.remoteTrashed) {
      out.push(banner('info', 'Diese Notiz wurde in einem anderen Fenster in den Papierkorb gelegt.', [
        { label: 'Wiederherstellen', onClick: async () => { try { await DB.setTrashed(doc.id, false); doc.remoteTrashed = false; const rec = await DB.get(doc.id); if (rec && isClean(doc)) { doc.savedRev = rec.rev; } renderBanners(); refreshTrashCount(); } catch (e) { notify('Wiederherstellen fehlgeschlagen: ' + errText(e), 'error'); } } },
        { label: 'Ausblenden', onClick: () => { doc.remoteTrashed = false; renderBanners(); } },
      ]));
    }
    if (doc.pendingFailed && doc.state !== 'saved') {
      out.push(banner('warn', 'Der Schreibpuffer im Browser ist voll oder gesperrt – der Text ist nur im Editor und in der Datenbank-Warteschlange gesichert.', []));
    }
    return out;
  }

  function renderBanners() {
    const host = $('qn-banners');
    host.replaceChildren();
    globalBanners.forEach((g) => host.appendChild(banner(g.kind, g.text, g.actions)));
    recoveryOffers.forEach((o) => host.appendChild(recoveryBanner(o)));
    const doc = docs.get(activeId);
    if (doc && !fallbackMode) docBanners(doc).forEach((b) => host.appendChild(b));
  }

  function addGlobalBanner(key, kind, text, actions) {
    const i = globalBanners.findIndex((b) => b.key === key);
    const entry = { key, kind, text, actions: (actions || []).concat([{ label: 'Schließen', onClick: () => removeGlobalBanner(key) }]) };
    if (i >= 0) globalBanners[i] = entry; else globalBanners.push(entry);
    renderBanners();
  }
  function removeGlobalBanner(key) {
    const i = globalBanners.findIndex((b) => b.key === key);
    if (i >= 0) globalBanners.splice(i, 1);
    renderBanners();
  }

  // ── Konfliktaufloesung ────────────────────────────────
  async function resolveSaveAsNew(doc) {
    const suffix = ' (Konflikt ' + hhmm(Date.now()) + ')';
    const title = (doc.title.slice(0, DB.TITLE_MAX - suffix.length) + suffix);
    let note;
    try { note = await DB.create({ title, text: doc.text }); }
    catch (err) { addGlobalBanner('conflict-save', 'error', 'Die Konflikt-Kopie konnte nicht gespeichert werden: ' + errText(err) + '. Dein Text bleibt unverändert im Editor.', []); return; }
    const cur = doc.conflict && doc.conflict.current;
    if (cur) loadFromRecord(doc, cur);
    else closeDocNow(doc);
    openNote(note, { activate: true });
    notify('Deine Version wurde als „' + note.title + '“ gesichert.');
  }

  function resolveLoadOther(doc) {
    const cur = doc.conflict && doc.conflict.current;
    if (!cur) return;
    if (!window.confirm('Deine nicht gespeicherten Änderungen in dieser Notiz gehen verloren und der Stand aus dem anderen Fenster wird geladen. Fortfahren?')) return;
    loadFromRecord(doc, cur);
    doc.ta.focus();
  }

  // ── Wiederherstellung aus dem Schreibpuffer ───────────
  function recoveryBanner(o) {
    const p = o.pending;
    const name = o.note ? o.note.title : (p.title || 'Unbekannt');
    const relation = !o.note ? 'Die Notiz existiert nicht mehr.' : (p.ts > o.note.updatedAt ? 'Der Puffer ist neuer als der gespeicherte Stand.' : 'Der Puffer ist älter als der gespeicherte Stand, weicht aber ab.');
    const text = 'Ungespeicherter Text für „' + name + '“ gefunden (gepuffert um ' + hhmmss(p.ts) + '). ' + relation + ' Es wurde nichts verändert.';
    const actions = [];
    if (o.note) actions.push({ label: 'Wiederherstellen', primary: true, onClick: () => recoverApply(o) });
    actions.push({ label: 'Als neue Notiz sichern', primary: !o.note, onClick: () => recoverAsNew(o) });
    actions.push({ label: 'Verwerfen', onClick: () => recoverDiscard(o) });
    return banner('warn', text, actions);
  }
  function dropOffer(o) { const i = recoveryOffers.indexOf(o); if (i >= 0) recoveryOffers.splice(i, 1); renderBanners(); }

  async function recoverApply(o) {
    let doc = docs.get(o.note.id);
    if (!doc) {
      const fresh = await DB.get(o.note.id);
      if (!fresh) { recoverAsNew(o); return; }
      doc = openNote(fresh, { activate: true });
    } else activate(doc.id);
    // der gepufferte Text wird zum aktuellen Text; gespeichert wird ueber den normalen Weg (Revisionspruefung)
    doc.ta.value = o.pending.text; doc.text = o.pending.text;
    if (o.pending.title && o.pending.title !== doc.title) doc.title = DB.clampTitle(o.pending.title, doc.createdAt);
    updateGutter(doc);
    onEdit(doc);
    try { localStorage.removeItem(o.pendingKey); } catch (e) { /* nichts zu tun */ }
    dropOffer(o);
    flush(doc);
  }
  async function recoverAsNew(o) {
    try {
      const note = await DB.create({ title: DB.clampTitle((o.pending.title || 'Wiederhergestellt') + ' (Wiederhergestellt)'), text: o.pending.text });
      try { localStorage.removeItem(o.pendingKey); } catch (e) { /* nichts zu tun */ }
      dropOffer(o);
      openNote(note, { activate: true });
    } catch (err) { addGlobalBanner('recover-fail', 'error', 'Wiederherstellung fehlgeschlagen: ' + errText(err) + '. Der Puffer bleibt erhalten.', []); }
  }
  function recoverDiscard(o) {
    if (!window.confirm('Den gepufferten Text endgültig verwerfen?')) return;
    try { localStorage.removeItem(o.pendingKey); } catch (e) { /* nichts zu tun */ }
    dropOffer(o);
  }

  async function scanPending(notesById) {
    let held = new Set();
    try { if (navigator.locks && navigator.locks.query) held = new Set(((await navigator.locks.query()).held || []).map((l) => l.name)); } catch (e) { /* ohne Locks: alle Eintraege pruefen */ }
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PENDING_PREFIX)) keys.push(k); }
    keys.forEach((k) => {
      let p;
      try { p = JSON.parse(localStorage.getItem(k)); } catch (e) { return; }
      if (!p || typeof p.text !== 'string' || typeof p.id !== 'string') return;      // unlesbar: liegen lassen, nichts loeschen
      if (p.win && held.has('qn.win.' + p.win)) return;                               // gehoert zu einem noch offenen Fenster
      const note = notesById.get(p.id) || null;
      if (note && note.trashedAt) return;                                            // im Papierkorb: Puffer bleibt unberuehrt, Angebot nach dem Wiederherstellen
      if (note && note.text === p.text && (!p.title || p.title === note.title)) { try { localStorage.removeItem(k); } catch (e) { /* nichts zu tun */ } return; } // bereits gespeichert
      recoveryOffers.push({ key: k, pendingKey: k, pending: p, note });
    });
    renderBanners();
  }

  // ── Editor-Bereiche ───────────────────────────────────
  function updateGutter(doc) {
    const ta = doc.ta, g = doc.gutter;
    let n = 1; const v = ta.value;
    for (let i = v.indexOf('\n'); i !== -1; i = v.indexOf('\n', i + 1)) n++;
    if (n !== doc.lineCount) {
      doc.lineCount = n;
      const parts = new Array(n);
      for (let i = 0; i < n; i++) parts[i] = i + 1;
      g.textContent = parts.join('\n');
      g.style.minWidth = (String(n).length + 2) + 'ch';
    }
    const bar = ta.offsetHeight - ta.clientHeight;                // waagerechte Bildlaufleiste
    g.style.paddingBottom = (8 + Math.max(0, bar)) + 'px';
    g.scrollTop = ta.scrollTop;
  }

  function replaceRange(ta, from, to, str, selFrom, selTo) {
    ta.focus();
    ta.setSelectionRange(from, to);
    let ok = false;
    try { ok = document.execCommand('insertText', false, str); } catch (e) { ok = false; }
    if (!ok || ta.value.slice(from, from + str.length) !== str) {
      if (ok) { /* execCommand meldete Erfolg, hat aber nichts geaendert */ }
      ta.setRangeText(str, from, to, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(selFrom, selTo);
  }

  function lineRange(v, start, end) {
    const ls = v.lastIndexOf('\n', start - 1) + 1;
    let e = end;
    if (end > start && v[end - 1] === '\n') e = end - 1;
    let le = v.indexOf('\n', e);
    if (le === -1) le = v.length;
    return [ls, le];
  }

  function indentSelection(ta) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const [ls, le] = lineRange(v, s, e);
    const lines = v.slice(ls, le).split('\n');
    replaceRange(ta, ls, le, lines.map((l) => '\t' + l).join('\n'), s + 1, e + lines.length);
  }

  function outdentSelection(ta) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const [ls, le] = lineRange(v, s, e);
    const lines = v.slice(ls, le).split('\n');
    let firstRemoved = 0, total = 0;
    const out = lines.map((l, i) => {
      let r = 0;
      if (l.startsWith('\t')) r = 1;
      else { const m = /^ {1,4}/.exec(l); r = m ? m[0].length : 0; }
      if (i === 0) firstRemoved = r;
      total += r;
      return l.slice(r);
    });
    if (!total) return;
    const ns = Math.max(ls, s - firstRemoved);
    replaceRange(ta, ls, le, out.join('\n'), ns, Math.max(ns, e - total));
  }

  function stamp() { const d = new Date(); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function onEditorKeydown(e, doc) {
    const ta = doc.ta;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) { tabEscape = true; updateStatus(); return; }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (tabEscape) { tabEscape = false; updateStatus(); return; }       // Tab-Belegung aufgehoben: normaler Fokuswechsel
      e.preventDefault();
      if (e.shiftKey) outdentSelection(ta);
      else if (ta.selectionStart !== ta.selectionEnd) indentSelection(ta);
      else replaceRange(ta, ta.selectionStart, ta.selectionEnd, '\t', ta.selectionStart + 1, ta.selectionStart + 1);
      return;
    }
    if (tabEscape) { tabEscape = false; updateStatus(); }
    if (e.key === 'F5') { e.preventDefault(); const s = stamp(); replaceRange(ta, ta.selectionStart, ta.selectionEnd, s, ta.selectionStart + s.length, ta.selectionStart + s.length); }
  }

  function onEdit(doc) {
    doc.text = doc.ta.value;
    updateGutter(doc);
    if (doc.state === 'conflict') { writePendingThrottled(doc); updateStatus(); return; }   // nichts speichern, bis entschieden ist
    if (isClean(doc) && doc.state !== 'saving') {
      clearTimeout(doc.timer); doc.timer = null; clearTimeout(doc.retryTimer); doc.retryTimer = null;
      doc.error = null; removePending(doc);
      if (doc.state !== 'saved') setState(doc, 'saved');
      updateStatus();
      return;
    }
    writePendingThrottled(doc);
    if (doc.state === 'saved') setState(doc, 'dirty');
    if (doc.state !== 'error') scheduleSave(doc);
    updateStatus();
  }

  function createPane(doc) {
    const pane = el('div', 'qn-pane');
    pane.id = 'qn-pane-' + doc.id;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', 'qn-tab-' + doc.id);
    pane.hidden = true;
    const gutter = el('div', 'qn-gutter');
    gutter.setAttribute('aria-hidden', 'true');
    const ta = el('textarea', 'qn-editor');
    ta.value = doc.text;
    ta.setAttribute('aria-label', 'Notiztext: ' + doc.title);
    ta.setAttribute('wrap', wrap ? 'soft' : 'off');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('spellcheck', 'false');
    pane.append(gutter, ta);
    doc.pane = pane; doc.gutter = gutter; doc.ta = ta;
    pane.classList.toggle('qn-pane--wrap', wrap);
    ta.addEventListener('input', () => onEdit(doc));
    ta.addEventListener('keydown', (e) => onEditorKeydown(e, doc));
    ta.addEventListener('blur', () => { if (!isClean(doc)) flush(doc); });
    ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
    ['keyup', 'click', 'select', 'focus'].forEach((t) => ta.addEventListener(t, updateStatus));
    ta.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoom + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    $('qn-editors').appendChild(pane);
    updateGutter(doc);
    applyZoomTo(doc);
  }

  function applyZoomTo(doc) { doc.pane.style.setProperty('--qn-fs', zoom + 'px'); }
  function setZoom(z) {
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    docs.forEach((d) => { applyZoomTo(d); updateGutter(d); });
    saveSession();
  }
  function setWrap(on) {
    wrap = !!on;
    $('qn-wrap').setAttribute('aria-pressed', String(wrap));
    docs.forEach((d) => { d.ta.setAttribute('wrap', wrap ? 'soft' : 'off'); d.pane.classList.toggle('qn-pane--wrap', wrap); updateGutter(d); });
    saveSession();
  }

  // ── Tabs ──────────────────────────────────────────────
  function tabEl(id) { return $('qn-tabstrip').querySelector('[data-id="' + id + '"]'); }

  function tabLabel(doc) {
    const suffix = { dirty: ' – ungespeichert', saving: ' – wird gespeichert', error: ' – Fehler beim Speichern', conflict: ' – Konflikt' }[doc.state] || '';
    return doc.title + suffix;
  }

  function updateTabState(doc) {
    const w = tabEl(doc.id);
    if (!w) return;
    w.dataset.state = doc.state;
    w.classList.toggle('qn-tab--unsaved', doc.state !== 'saved');
    const b = w.querySelector('.qn-tab-btn');
    if (b) b.setAttribute('aria-label', tabLabel(doc));
    doc.ta.setAttribute('aria-label', 'Notiztext: ' + doc.title);
  }

  function renderTabs() {
    const strip = $('qn-tabstrip');
    const hadFocus = strip.contains(document.activeElement) ? document.activeElement.closest('[data-id]') : null;
    const renaming = strip.querySelector('.qn-tab-rename');
    if (renaming) return;                                       // laufende Umbenennung nicht zerstoeren
    strip.replaceChildren();
    order.forEach((id) => {
      const doc = docs.get(id);
      if (!doc) return;
      const w = el('div', 'qn-tab' + (id === activeId ? ' qn-tab--active' : ''));
      w.dataset.id = id;
      w.dataset.state = doc.state;
      w.setAttribute('role', 'presentation');
      w.draggable = true;
      const b = el('button', 'qn-tab-btn');
      b.type = 'button';
      b.id = 'qn-tab-' + id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === activeId));
      b.setAttribute('aria-controls', 'qn-pane-' + id);
      b.tabIndex = id === activeId ? 0 : -1;
      b.title = doc.title;
      b.setAttribute('aria-label', tabLabel(doc));
      b.append(el('span', 'qn-tab-dot', '●'), el('span', 'qn-tab-title', doc.title));
      b.addEventListener('click', () => activate(id));
      b.addEventListener('dblclick', (e) => { e.preventDefault(); activate(id); startRename(docs.get(id)); });
      b.addEventListener('keydown', (e) => onTabKeydown(e, id));
      const x = el('button', 'qn-tab-close', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Notiz schließen: ' + doc.title);
      x.title = 'Tab schließen (Alt+W)';
      x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
      w.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(id); } });
      w.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
      w.addEventListener('dragstart', (e) => { if (e.dataTransfer) { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; } w.classList.add('qn-tab--dragging'); });
      w.addEventListener('dragend', () => w.classList.remove('qn-tab--dragging'));
      w.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
      w.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = e.dataTransfer && e.dataTransfer.getData('text/plain');
        if (!from || from === id) return;
        const r = w.getBoundingClientRect();
        moveTab(from, id, e.clientX > r.left + r.width / 2);
      });
      w.append(b, x);
      strip.appendChild(w);
      updateTabState(doc);
    });
    if (hadFocus) { const t = tabEl(hadFocus.dataset.id); if (t) t.querySelector('.qn-tab-btn').focus(); }
    if (window.QuickNotesList) window.QuickNotesList.markersChanged();   // offene Tabs in der Liste markieren, Text des Leerzustands
    $('qn-empty').hidden = fallbackMode || order.length > 0;
    $('qn-editors').hidden = fallbackMode || order.length === 0;
    ['qn-rename', 'qn-export-one', 'qn-delete'].forEach((id) => { $(id).disabled = order.length === 0; });
  }

  function onTabKeydown(e, id) {
    const i = order.indexOf(id);
    let t = null;
    if (e.key === 'ArrowRight') t = order[(i + 1) % order.length];
    else if (e.key === 'ArrowLeft') t = order[(i - 1 + order.length) % order.length];
    else if (e.key === 'Home') t = order[0];
    else if (e.key === 'End') t = order[order.length - 1];
    if (t == null) return;
    e.preventDefault();
    activate(t);
    const b = tabEl(t); if (b) b.querySelector('.qn-tab-btn').focus();
  }

  function moveTab(fromId, toId, after) {
    const f = order.indexOf(fromId);
    if (f < 0 || order.indexOf(toId) < 0) return;
    order.splice(f, 1);
    let t = order.indexOf(toId);
    if (after) t++;
    order.splice(t, 0, fromId);
    renderTabs();
    saveSession();
  }

  function activate(id, opts) {
    const doc = docs.get(id);
    if (!doc) return;
    const prev = docs.get(activeId);
    if (prev && prev !== doc && !isClean(prev)) flush(prev);
    activeId = id;
    docs.forEach((d) => { d.pane.hidden = d.id !== id; });
    renderTabs();
    const t = tabEl(id);
    if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    renderBanners();
    updateStatus();
    updateGutter(doc);
    if (!opts || opts.focus !== false) doc.ta.focus();
    saveSession();
    DB.markOpened(id);
  }

  // Oeffnet eine Notiz als Tab (falls noch nicht offen)
  function openNote(note, opts) {
    let doc = docs.get(note.id);
    if (!doc) {
      doc = makeDoc(note);
      docs.set(note.id, doc);
      createPane(doc);
      if (!order.includes(note.id)) order.push(note.id);
      renderTabs();
    }
    if (opts && opts.activate) activate(note.id);
    else saveSession();
    return doc;
  }

  function removeDocFromUi(doc) {
    clearTimeout(doc.timer); clearTimeout(doc.retryTimer);
    removePending(doc);
    doc.pane.remove();
    docs.delete(doc.id);
    const i = order.indexOf(doc.id);
    if (i >= 0) order.splice(i, 1);
    if (activeId === doc.id) {
      activeId = null;
      const next = order[Math.min(i, order.length - 1)];
      if (next) activate(next); else { renderTabs(); renderBanners(); updateStatus(); saveSession(); }
    } else { renderTabs(); saveSession(); }
  }
  function closeDocNow(doc) { removeDocFromUi(doc); }

  // Schliessen loescht nichts. Ausnahme: leere Notiz mit unveraendertem Standardtitel geht in den Papierkorb.
  async function closeTab(id) {
    const doc = docs.get(id);
    if (!doc) return;
    await flush(doc);
    if (needsSave(doc)) {
      activate(id, { focus: false });
      addGlobalBanner('close-' + id, 'error', 'Der Tab „' + doc.title + '“ bleibt geöffnet: Die Änderungen sind noch nicht gespeichert.', []);
      return;
    }
    if (doc.text === '' && doc.title === DB.defaultTitle(doc.createdAt)) {
      try { await DB.setTrashed(id, true); refreshTrashCount(); }
      catch (err) { addGlobalBanner('close-' + id, 'error', 'Die leere Notiz konnte nicht in den Papierkorb gelegt werden: ' + errText(err), []); }
    }
    removeDocFromUi(doc);
  }

  async function newNote() {
    try {
      const note = await DB.create({});
      openNote(note, { activate: true });
      refreshListMenu();
    } catch (err) {
      addGlobalBanner('create-fail', 'error', 'Die neue Notiz konnte nicht angelegt werden: ' + errText(err), []);
    }
  }

  // ── Umbenennen ────────────────────────────────────────
  function startRename(doc) {
    if (!doc) return;
    const w = tabEl(doc.id);
    if (!w || w.querySelector('.qn-tab-rename')) return;
    const btn = w.querySelector('.qn-tab-btn');
    const input = el('input', 'qn-tab-rename');
    input.type = 'text';
    input.maxLength = DB.TITLE_MAX;
    input.value = doc.title;
    input.setAttribute('aria-label', 'Notiz umbenennen');
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const v = input.value;
      input.remove();
      btn.hidden = false;
      if (commit) {
        const t = DB.clampTitle(v, doc.createdAt);
        if (t !== doc.title) {
          doc.title = t;
          writePendingNow(doc);
          if (doc.state === 'saved') setState(doc, 'dirty');
          flush(doc);
        }
      }
      renderTabs();
      const nb = tabEl(doc.id); if (nb) nb.querySelector('.qn-tab-btn').focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    btn.hidden = true;
    w.insertBefore(input, btn);
    input.focus();
    input.select();
  }

  // ── Statusleiste ──────────────────────────────────────
  function updateStatus() {
    const doc = docs.get(activeId);
    const pos = $('qn-st-pos'), cnt = $('qn-st-count'), sv = $('qn-st-save');
    if (!doc || fallbackMode) {
      pos.textContent = 'Zeile 1, Spalte 1';
      cnt.textContent = '0 Zeichen · 0 Wörter';
      sv.textContent = fallbackMode ? 'Nicht gespeichert – Datenbank nicht verfügbar' : '–';
      sv.dataset.state = fallbackMode ? 'error' : '';
    } else {
      const ta = doc.ta, v = ta.value, p = ta.selectionStart;
      const before = v.slice(0, p);
      const line = before.split('\n').length;
      const col = p - (before.lastIndexOf('\n') + 1) + 1;
      pos.textContent = 'Zeile ' + line + ', Spalte ' + col;
      const sur = (v.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || []).length;
      const chars = v.length - sur;
      const words = (v.match(/\S+/g) || []).length;
      cnt.textContent = chars + ' Zeichen · ' + words + ' Wörter';
      const label = {
        saved: doc.savedAt ? 'Gespeichert um ' + hhmmss(doc.savedAt) : 'Gespeichert',
        dirty: 'Ungespeichert …', saving: 'Speichert …', error: 'Fehler – nicht gespeichert', conflict: 'Konflikt – nicht gespeichert',
      }[doc.state];
      sv.textContent = label;
      sv.dataset.state = doc.state;
    }
    $('qn-st-tab').textContent = tabEscape ? 'Tab-Taste frei: Der nächste Tab verlässt das Feld' : 'Tab-Taste rückt ein · Esc, dann Tab verlässt das Feld';
    if (window.QuickNotesConvert) window.QuickNotesConvert.refreshUi();   // Knopf "In Guide umwandeln" und Statuszeile der Umwandlung
  }

  function updatePersistStatus() {
    const b = $('qn-st-persist'), h = $('qn-persist-hint');
    b.textContent = persisted ? 'Speicher: dauerhaft' : 'Speicher: nicht garantiert';
    b.dataset.persisted = persisted ? '1' : '0';
    h.textContent = (persisted ? 'Der Browser hat diesen Speicher als dauerhaft markiert. ' : 'Der Browser hat diesen Speicher nicht als dauerhaft markiert. ')
      + 'Browser dürfen bei Speicherknappheit Websitedaten räumen. Das Löschen von Websitedaten entfernt alle Quicknotes. Sichere regelmäßig mit „Alle Notizen sichern“.';
    if (!persisted) { h.hidden = false; b.setAttribute('aria-expanded', 'true'); }
  }

  function updateBackupStatus() {
    const e = $('qn-st-backup');
    const t = Number(localStorage.getItem(BACKUP_KEY));
    if (!t) { e.textContent = 'Letzte Sicherung: noch nie'; return; }
    const days = Math.floor((Date.now() - t) / 86400000);
    e.textContent = 'Letzte Sicherung: ' + (days <= 0 ? 'heute' : days === 1 ? 'vor 1 Tag' : 'vor ' + days + ' Tagen');
  }

  // ── Notizliste (▾), Papierkorb ────────────────────────
  async function refreshTrashCount() {
    try { $('qn-trash-count').textContent = String((await DB.list()).filter((n) => n.trashedAt).length); } catch (e) { /* Anzeige nur */ }
    if (window.QuickNotesList) window.QuickNotesList.refreshSoon();   // Notizenliste (Seitenbereich) nachziehen
  }

  async function refreshListMenu() {
    if (window.QuickNotesList) window.QuickNotesList.refreshSoon();
    const menu = $('qn-list-menu');
    if (menu.hidden) return;
    let notes;
    try { notes = (await DB.list()).filter((n) => !n.trashedAt).sort((a, b) => b.updatedAt - a.updatedAt); }
    catch (err) { menu.replaceChildren(el('p', 'qn-menu-empty', 'Die Notizliste konnte nicht geladen werden: ' + errText(err))); return; }
    menu.replaceChildren();
    if (!notes.length) menu.appendChild(el('p', 'qn-menu-empty', 'Keine Notizen vorhanden.'));
    notes.forEach((n) => {
      const b = el('button', 'qn-menu-item' + (docs.has(n.id) ? ' qn-menu-item--open' : ''));
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.dataset.id = n.id;
      b.append(el('span', 'qn-menu-title', n.title));
      if (n.convertedGuideId) { const f = el('span', 'qn-menu-flag', '⇒ Guide'); f.title = 'In einen Guide umgewandelt am ' + dateTime(n.convertedAt || n.updatedAt); b.appendChild(f); }
      b.append(el('span', 'qn-menu-time', dateTime(n.updatedAt)));
      b.addEventListener('click', () => { closeListMenu(); openNote(n, { activate: true }); });
      menu.appendChild(b);
    });
  }
  function openListMenu() {
    const menu = $('qn-list-menu');
    menu.hidden = false;
    $('qn-list-btn').setAttribute('aria-expanded', 'true');
    refreshListMenu().then(() => { const f = menu.querySelector('.qn-menu-item'); if (f) f.focus(); });
  }
  function closeListMenu() {
    $('qn-list-menu').hidden = true;
    $('qn-list-btn').setAttribute('aria-expanded', 'false');
  }

  async function deleteActive() {
    const doc = docs.get(activeId);
    if (!doc) return;
    if (!window.confirm('Die Notiz „' + doc.title + '“ in den Papierkorb legen? Sie kann dort wiederhergestellt werden.')) return;
    await flush(doc);
    if (needsSave(doc)) { addGlobalBanner('delete-' + doc.id, 'error', 'Nicht gelöscht: Die Änderungen an „' + doc.title + '“ sind noch nicht gespeichert.', []); return; }
    try { await DB.setTrashed(doc.id, true); }
    catch (err) { addGlobalBanner('delete-' + doc.id, 'error', 'Die Notiz konnte nicht in den Papierkorb gelegt werden: ' + errText(err), []); return; }
    removeDocFromUi(doc);
    refreshTrashCount(); refreshListMenu();
  }

  // ── Sicherung und Import ──────────────────────────────
  async function backupAll() {
    try {
      await flushAll();
      const all = await DB.list();
      // offene Notizen mit noch nicht gespeichertem Text: den aktuellen Editorstand sichern, nichts weglassen
      const notes = all.map((n) => { const d = docs.get(n.id); return d ? Object.assign({}, n, { text: d.text, title: d.title }) : n; });
      const blob = await IO.buildBackup(notes);
      const d = new Date();
      IO.download(blob, 'quicknotes-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.zip');
      try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (e) { /* Anzeige nur */ }
      updateBackupStatus();
      notify('Sicherung erstellt (' + notes.length + ' Notizen).');
    } catch (err) {
      addGlobalBanner('backup-fail', 'error', 'Die Sicherung ist fehlgeschlagen: ' + errText(err), []);
    }
  }

  async function importFiles(files) {
    const summary = { created: 0, restored: 0, skipped: 0, renamed: 0 };
    const warnings = [];
    let existing;
    try { existing = new Map((await DB.list()).map((n) => [n.id, n])); }
    catch (err) { addGlobalBanner('import-fail', 'error', 'Import nicht möglich: ' + errText(err), []); return; }
    const toAdd = [];
    for (const file of files) {
      let r;
      try { r = await IO.readImportFile(file); }
      catch (err) { warnings.push(errText(err)); continue; }
      warnings.push(...r.warnings);
      r.items.forEach((it) => {
        const now = Date.now();
        if (it.backup) {
          const b = it.backup;
          const ex = existing.get(b.id) || toAdd.find((n) => n.id === b.id);
          if (ex && ex.text === it.text && ex.title === b.title) { summary.skipped++; return; }   // bereits vorhanden, identisch
          const note = {
            id: ex ? crypto.randomUUID() : b.id,
            title: ex ? DB.clampTitle(b.title.slice(0, DB.TITLE_MAX - 10) + ' (Import)') : DB.clampTitle(b.title),
            text: it.text,
            createdAt: Number.isFinite(b.createdAt) ? b.createdAt : now,
            updatedAt: Number.isFinite(b.updatedAt) ? b.updatedAt : now,
            rev: 1, trashedAt: Number.isFinite(b.trashedAt) ? b.trashedAt : null, lastOpenedAt: Number.isFinite(b.lastOpenedAt) ? b.lastOpenedAt : now,
          };
          // optionale Felder der Umwandlung in einen Guide: verlustfrei uebernehmen (aeltere Sicherungen haben sie nicht)
          if (typeof b.convertedGuideId === 'string' && b.convertedGuideId) { note.convertedGuideId = b.convertedGuideId; note.convertedAt = Number.isFinite(b.convertedAt) ? b.convertedAt : now; }
          toAdd.push(note);
          if (ex) summary.renamed++; else summary.restored++;
        } else {
          toAdd.push({ id: crypto.randomUUID(), title: DB.clampTitle(it.title, now), text: it.text, createdAt: now, updatedAt: now, rev: 1, trashedAt: null, lastOpenedAt: now });
          summary.created++;
        }
      });
    }
    try { if (toAdd.length) await DB.addMany(toAdd); }
    catch (err) { addGlobalBanner('import-fail', 'error', 'Der Import ist fehlgeschlagen, es wurde nichts angelegt: ' + errText(err), []); return; }
    const live = toAdd.filter((n) => !n.trashedAt);
    if (live.length && live.length <= 10) live.forEach((n, i) => openNote(n, { activate: i === live.length - 1 }));
    refreshTrashCount(); refreshListMenu();
    const parts = [];
    if (summary.created) parts.push(summary.created + ' neue Notiz(en) aus Dateien');
    if (summary.restored) parts.push(summary.restored + ' aus der Sicherung wiederhergestellt');
    if (summary.renamed) parts.push(summary.renamed + ' mit „(Import)“ angelegt, weil die ID schon vorhanden war');
    if (summary.skipped) parts.push(summary.skipped + ' übersprungen (bereits identisch vorhanden)');
    addGlobalBanner('import-done', warnings.length ? 'warn' : 'info',
      'Import abgeschlossen: ' + (parts.join(', ') || 'nichts importiert') + '.' + (warnings.length ? ' Hinweise: ' + warnings.join(' ') : '') + (live.length > 10 ? ' Über ▾ öffnen.' : ''), []);
  }

  // ── Fremdaenderungen (BroadcastChannel) ───────────────
  async function checkRemote(id) {
    const doc = docs.get(id);
    if (!doc) return;
    let rec;
    try { rec = await DB.get(id); } catch (e) { return; }
    if (!rec) return;                                           // endgueltig geloescht: faellt beim Speichern als Konflikt auf
    doc.remoteTrashed = !!rec.trashedAt;
    if (rec.rev > doc.savedRev) {
      if (rec.text === doc.savedText) {                         // nur Titel/Kennzeichen geaendert: still uebernehmen
        doc.savedRev = rec.rev;
        doc.convertedGuideId = rec.convertedGuideId || null; doc.convertedAt = rec.convertedAt || null;
        if (doc.title === doc.savedTitle) { doc.title = rec.title; }
        doc.savedTitle = rec.title;
        renderTabs();
      } else if (isClean(doc) && doc.state === 'saved') {
        doc.remoteChanged = rec;
      }
    }
    if (doc.id === activeId) renderBanners();
  }

  function onRemoteChange(msg) {
    refreshTrashCount();
    refreshListMenu();
    if (msg && msg.id) checkRemote(msg.id);
  }

  // ── Notbetrieb ohne Datenbank ─────────────────────────
  function enterFallback(err) {
    fallbackMode = true;
    $('qn-tabstrip').parentElement.hidden = true;
    $('qn-notes').hidden = true;
    $('qn-toolbar').hidden = true;
    $('qn-editors').hidden = true;
    $('qn-empty').hidden = true;
    $('qn-fallback').hidden = false;
    $('qn-statusbar').querySelectorAll('.qn-st').forEach((s) => { if (s.id !== 'qn-st-save') s.hidden = true; });
    addGlobalBanner('db-fail', 'error', 'Die Datenbank ist nicht verfügbar (' + errText(err) + '). Notizen werden NICHT gespeichert – das passiert z. B. im privaten Modus oder bei gesperrtem Speicher. Du kannst den Text unten als Datei sichern.', []);
    $('qn-fallback-save').addEventListener('click', () => IO.download(IO.textBlob($('qn-fallback-text').value), 'Notiz-' + stamp().replace(/[: ]/g, '-') + '.txt'));
    updateStatus();
    $('qn-fallback-text').focus();
  }

  // ── Start ─────────────────────────────────────────────
  async function init() {
    const session = readSession();
    if (session) { wrap = !!session.wrap; zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(session.zoom) || ZOOM_DEFAULT)); }
    $('qn-wrap').setAttribute('aria-pressed', String(wrap));
    updateBackupStatus();
    updateStatus();

    // dieses Fenster als "lebendig" markieren (so erkennt ein anderes Fenster, dass dessen Puffer noch gebraucht wird)
    try { if (navigator.locks) navigator.locks.request('qn.win.' + WIN, () => new Promise(() => {})); } catch (e) { /* ohne Locks */ }

    let all;
    try { await DB.open(); all = await DB.list(); }
    catch (err) { enterFallback(err); return; }

    initPersist();
    const byId = new Map(all.map((n) => [n.id, n]));
    const live = all.filter((n) => !n.trashedAt);

    let openIds;
    if (session) openIds = session.open.filter((id) => byId.has(id) && !byId.get(id).trashedAt);
    else openIds = live.sort((a, b) => a.createdAt - b.createdAt).map((n) => n.id);

    const params = new URLSearchParams(location.search);
    let target = decodeURIComponent((location.hash || '').slice(1));
    if (target === 'trash') target = '';                                 // quicknotes.html#trash oeffnet den Papierkorb-Dialog (js/quicknotes-list.js)
    if (params.get('new') === '1') {
      try {
        const note = await DB.create({});
        byId.set(note.id, note);
        openIds.push(note.id);
        target = note.id;
        history.replaceState(null, '', location.pathname + '#' + note.id);
      } catch (err) { addGlobalBanner('create-fail', 'error', 'Die neue Notiz konnte nicht angelegt werden: ' + errText(err), []); }
    }
    if (!live.length && !openIds.length && params.get('new') !== '1') {
      try { const note = await DB.create({}); byId.set(note.id, note); openIds.push(note.id); target = note.id; } catch (err) { addGlobalBanner('create-fail', 'error', 'Die erste Notiz konnte nicht angelegt werden: ' + errText(err), []); }
    }
    if (target) {
      const t = byId.get(target);
      if (t && !t.trashedAt) { if (!openIds.includes(target)) openIds.push(target); }
      else if (t && t.trashedAt) addGlobalBanner('hash', 'warn', 'Die Notiz „' + t.title + '“ liegt im Papierkorb.', [{ label: 'Wiederherstellen', onClick: async () => { try { const r = await DB.setTrashed(t.id, false); if (r.ok) { openNote(r.note, { activate: true }); removeGlobalBanner('hash'); refreshTrashCount(); } } catch (e) { notify('Wiederherstellen fehlgeschlagen: ' + errText(e), 'error'); } } }]);
      else addGlobalBanner('hash', 'warn', 'Die verlinkte Notiz wurde nicht gefunden.', []);
    }

    openIds.forEach((id) => openNote(byId.get(id)));
    const first = (target && docs.has(target)) ? target : (session && docs.has(session.active) ? session.active : order[order.length - 1]);
    if (first) {
      activate(first);
      const d = docs.get(first);
      d.ta.setSelectionRange(d.ta.value.length, d.ta.value.length);
    } else { renderTabs(); renderBanners(); }

    refreshTrashCount();
    scanPending(byId);
    DB.onChange(onRemoteChange);
    if (window.QuickNotesList) { let fresh = all; try { fresh = await DB.list(); } catch (e) { /* alter Stand */ } window.QuickNotesList.start(fresh); }
  }

  async function initPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        persisted = await navigator.storage.persisted();
        if (!persisted) persisted = await navigator.storage.persist();
      }
    } catch (e) { persisted = false; }
    updatePersistStatus();
  }

  // ── Ereignisse ────────────────────────────────────────
  function bind() {
    $('qn-new').addEventListener('click', newNote);
    $('qn-empty-new').addEventListener('click', newNote);
    $('qn-empty-list').addEventListener('click', () => { if (window.QuickNotesList) window.QuickNotesList.openPanel(); });
    $('qn-rename').addEventListener('click', () => startRename(docs.get(activeId)));
    $('qn-wrap').addEventListener('click', () => setWrap(!wrap));
    $('qn-export-one').addEventListener('click', () => { const d = docs.get(activeId); if (d) saveDocAsFile(d); });
    $('qn-delete').addEventListener('click', deleteActive);
    $('qn-backup').addEventListener('click', backupAll);
    $('qn-import').addEventListener('click', () => $('qn-import-file').click());
    $('qn-import-file').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) importFiles(f); });
    $('qn-trash-btn').addEventListener('click', () => { if (window.QuickNotesList) window.QuickNotesList.openTrash(); });
    $('qn-list-btn').addEventListener('click', () => ($('qn-list-menu').hidden ? openListMenu() : closeListMenu()));
    $('qn-st-persist').addEventListener('click', () => { const h = $('qn-persist-hint'); h.hidden = !h.hidden; $('qn-st-persist').setAttribute('aria-expanded', String(!h.hidden)); });
    $('qn-tabs-left').addEventListener('click', () => $('qn-tabstrip').scrollBy({ left: -240 }));
    $('qn-tabs-right').addEventListener('click', () => $('qn-tabstrip').scrollBy({ left: 240 }));
    $('qn-tabstrip').addEventListener('wheel', (e) => { if (!e.ctrlKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { $('qn-tabstrip').scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });

    $('qn-list-menu').addEventListener('keydown', (e) => {
      const items = [...$('qn-list-menu').querySelectorAll('.qn-menu-item')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeListMenu(); $('qn-list-btn').focus(); }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.qn-menuwrap')) closeListMenu(); });

    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('qn-tab-rename')) return;
      const alt = e.altKey && !e.ctrlKey && !e.metaKey;
      if (alt && e.code === 'KeyN') { e.preventDefault(); if (!fallbackMode) newNote(); }
      else if (alt && e.code === 'KeyW') { e.preventDefault(); if (activeId) closeTab(activeId); }
      else if (e.key === 'F2' && !e.ctrlKey && !e.altKey) { if (activeId) { e.preventDefault(); startRename(docs.get(activeId)); } }
      else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); flushAll(); }
    });

    window.addEventListener('hashchange', async () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id || id === 'trash' || fallbackMode) return;
      if (docs.has(id)) { activate(id); return; }
      try { const n = await DB.get(id); if (n && !n.trashedAt) openNote(n, { activate: true }); } catch (e) { /* Hinweis nicht noetig */ }
    });

    const flushOnLeave = () => { docs.forEach((d) => { if (!isClean(d)) { writePendingNow(d); flush(d); } }); };
    window.addEventListener('pagehide', flushOnLeave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushOnLeave();
      else { docs.forEach((d) => checkRemote(d.id)); refreshTrashCount(); }
    });
    window.addEventListener('beforeunload', (e) => {
      const unsaved = fallbackMode ? ($('qn-fallback-text').value !== '') : [...docs.values()].some(needsSave);
      if (unsaved) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('selectionchange', () => { if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('qn-editor')) updateStatus(); });
  }

  // Umwandlung in einen Guide (js/quicknotes-convert.js): die Notiz wurde aktualisiert (convertedGuideId, ggf. Papierkorb)
  function adoptConverted(rec) {
    const doc = docs.get(rec.id);
    if (!doc) { refreshTrashCount(); refreshListMenu(); return; }
    doc.savedRev = rec.rev;
    doc.convertedGuideId = rec.convertedGuideId || null; doc.convertedAt = rec.convertedAt || null;
    if (rec.trashedAt) { removeDocFromUi(doc); refreshTrashCount(); refreshListMenu(); return; }
    updateStatus(); refreshListMenu();
  }

  // Eine Notiz wurde in den Papierkorb gelegt (Sammelaktion): offenen Tab schliessen, die Nachbar-Notiz wird aktiv
  // Wurde nach dem Speichern (Flush) noch weitergetippt, bleibt die Notiz offen: Der Text bleibt im Editor und im Schreibpuffer,
  // das naechste Speichern endet im Konflikt-Banner (Kopie sichern) – der Tab wird nie mit ungespeichertem Text geschlossen.
  // Rueckgabe: true = Tab geschlossen, false = bleibt offen (ungespeicherte Eingaben)
  function adoptTrashed(id) {
    const doc = docs.get(id);
    if (!doc) return true;
    if (!isClean(doc) || doc.state === 'saving') {
      writePendingNow(doc);
      doc.remoteTrashed = true;
      renderTabs(); renderBanners(); updateStatus();
      return false;
    }
    removeDocFromUi(doc);
    return true;
  }

  // Schnittstelle fuer js/quicknotes-convert.js und js/quicknotes-list.js
  window.QuickNotesPageInternal = {
    openIds: () => order.slice(),
    activeId: () => activeId,
    openNote: (note, opts) => openNote(note, opts),
    activate: (id) => activate(id),
    newNote: () => newNote(),
    adoptTrashed,
    refreshMenus: () => { refreshTrashCount(); refreshListMenu(); },
    activeDoc: () => docs.get(activeId) || null,
    docById: (id) => docs.get(id) || null,
    flush: (doc) => flush(doc),
    adoptConverted,
    banner: (key, kind, text, actions) => addGlobalBanner(key, kind, text, actions),
    removeBanner: (key) => removeGlobalBanner(key),
    download: (text, name) => IO.download(IO.textBlob(text, false), name),
  };

  window.QuickNotesPage = { flushAll, openNote, activate, closeTab, newNote, RETRY_BASE_MS, DEBOUNCE_MS, get activeId() { return activeId; } };

  document.addEventListener('DOMContentLoaded', () => { bind(); init(); });
})();
