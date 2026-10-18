// ============================================================
// support.sheet – quicknotes-db.js (Quicknotes: Datenschicht)
// Eigene IndexedDB "quicknotes-db" (Version 1, Store "notes"), getrennt von guidesheet-db / GuidesDB.
// Jede Schreiboperation laeuft in EINER Transaktion mit durability 'strict' (wo unterstuetzt) und meldet Erfolg erst bei
// transaction.oncomplete. save() prueft in derselben Transaktion die Revision (rev): weicht sie ab, wird NICHT geschrieben
// (Rueckgabe { conflict: true, current }). Geloescht wird weich (trashedAt); endgueltig nur ueber purge().
// Aenderungen werden per BroadcastChannel an andere Fenster gemeldet (onChange).
// window.__QN_DB_NAME ueberschreibt den Datenbanknamen (nur fuer Tests, vor dem Laden dieser Datei setzen).
// ============================================================
(function () {
  const DB_NAME = (typeof window.__QN_DB_NAME === 'string' && window.__QN_DB_NAME) || 'quicknotes-db';
  const STORE = 'notes';
  const CHANNEL = 'quicknotes-changes';
  const TITLE_MAX = 80;
  const WINDOW_ID = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 12);

  let dbPromise = null;
  let channel = null;
  const listeners = new Set();

  function pad(n) { return String(n).padStart(2, '0'); }

  // "Notiz 17.10. 14:05"
  function defaultTitle(ts) {
    const d = new Date(ts == null ? Date.now() : ts);
    return 'Notiz ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '. ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function clampTitle(title, fallbackTs) {
    const t = String(title == null ? '' : title).replace(/[\r\n\t]+/g, ' ').trim().slice(0, TITLE_MAX).trim();
    return t || defaultTitle(fallbackTs);
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB ist in diesem Browser nicht verfügbar.')); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (err) { reject(err); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Die Datenbank konnte nicht geöffnet werden.'));
      req.onblocked = () => reject(new Error('Die Datenbank ist durch ein anderes Fenster blockiert.'));
    }).catch((err) => { dbPromise = null; throw err; });
    return dbPromise;
  }

  // Fuehrt fn(store, setResult) in einer Transaktion aus. Aufgeloest wird erst bei transaction.oncomplete (bestaetigt).
  // Wirft fn bzw. ein Request-Callback synchron (z. B. QuotaExceededError bei put), wird die Transaktion abgebrochen und
  // mit genau diesem Fehler abgelehnt.
  async function runTx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = mode === 'readwrite' ? db.transaction(STORE, mode, { durability: 'strict' }) : db.transaction(STORE, mode);
      } catch (err) {
        try { tx = db.transaction(STORE, mode); } catch (err2) { reject(err2); return; }
      }
      let result;
      let thrown = null;
      const guard = (cb) => (ev) => {
        try { cb(ev); } catch (err) { thrown = err; try { tx.abort(); } catch (e) { /* schon beendet */ } }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(thrown || tx.error || new Error('Die Transaktion wurde abgebrochen.'));
      try { fn(tx.objectStore(STORE), (v) => { result = v; }, guard); }
      catch (err) { thrown = err; try { tx.abort(); } catch (e) { /* schon beendet */ } }
    });
  }

  // Gibt es die Datenbank schon? (Lesende Seiten wie die Guide-Übersicht legen sie nicht nur zum Anschauen an.)
  // Ohne indexedDB.databases() (ältere Browser) gilt sie als vorhanden.
  async function exists() {
    try { if (indexedDB.databases) return (await indexedDB.databases()).some((d) => d.name === DB_NAME); } catch (e) { /* unbekannt */ }
    return true;
  }

  function notify(change) {
    try {
      if (!channel && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL);
      if (channel) channel.postMessage(Object.assign({ from: WINDOW_ID }, change));
    } catch (e) { /* ohne BroadcastChannel: andere Fenster aktualisieren sich beim Sichtbarwerden */ }
  }

  function onChange(cb) {
    listeners.add(cb);
    try {
      if (!channel && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL);
      if (channel && !channel.onmessage) {
        channel.onmessage = (ev) => { if (ev.data && ev.data.from !== WINDOW_ID) listeners.forEach((fn) => { try { fn(ev.data); } catch (e) { console.error(e); } }); };
      }
    } catch (e) { /* ohne BroadcastChannel */ }
    return () => listeners.delete(cb);
  }

  async function list() {
    return runTx('readonly', (store, setResult, guard) => {
      const req = store.getAll();
      req.onsuccess = guard(() => setResult(req.result || []));
    });
  }

  async function get(id) {
    return runTx('readonly', (store, setResult, guard) => {
      const req = store.get(id);
      req.onsuccess = guard(() => setResult(req.result || null));
    });
  }

  async function create(init) {
    init = init || {};
    const now = Date.now();
    const note = {
      id: crypto.randomUUID(),
      title: clampTitle(init.title, now),
      text: typeof init.text === 'string' ? init.text : '',
      createdAt: now, updatedAt: now, rev: 1, trashedAt: null, lastOpenedAt: now,
    };
    await runTx('readwrite', (store, setResult, guard) => {
      const req = store.add(note);
      req.onsuccess = guard(() => setResult(note));
    });
    notify({ type: 'changed', id: note.id, rev: note.rev });
    return note;
  }

  // Speichert text und/oder title, wenn die Revision noch dem erwarteten Stand entspricht.
  // Rueckgabe: { ok: true, note } | { ok: false, conflict: true, current } | { ok: false, missing: true }
  async function save(id, patch, expectedRev) {
    const res = await runTx('readwrite', (store, setResult, guard) => {
      const g = store.get(id);
      g.onsuccess = guard(() => {
        const rec = g.result;
        if (!rec) { setResult({ ok: false, missing: true }); return; }
        if (rec.rev !== expectedRev) { setResult({ ok: false, conflict: true, current: rec }); return; }
        const next = Object.assign({}, rec, { updatedAt: Date.now(), rev: rec.rev + 1 });
        if (typeof patch.text === 'string') next.text = patch.text;
        if (typeof patch.title === 'string') next.title = clampTitle(patch.title, rec.createdAt);
        const p = store.put(next);
        p.onsuccess = guard(() => setResult({ ok: true, note: next }));
      });
    });
    if (res.ok) notify({ type: 'changed', id, rev: res.note.rev });
    return res;
  }

  // Weich loeschen / wiederherstellen: nur das Kennzeichen aendert sich, der Text bleibt unangetastet.
  async function setTrashed(id, trashed) {
    const res = await runTx('readwrite', (store, setResult, guard) => {
      const g = store.get(id);
      g.onsuccess = guard(() => {
        const rec = g.result;
        if (!rec) { setResult({ ok: false, missing: true }); return; }
        const next = Object.assign({}, rec, { trashedAt: trashed ? Date.now() : null, rev: rec.rev + 1 });
        const p = store.put(next);
        p.onsuccess = guard(() => setResult({ ok: true, note: next }));
      });
    });
    if (res.ok) notify({ type: 'changed', id, rev: res.note.rev });
    return res;
  }

  // Vermerkt die Umwandlung in einen Guide (convertedGuideId, convertedAt) – und legt die Notiz auf Wunsch in den Papierkorb
  // (weich, trashedAt) – in EINER Transaktion mit Revisionspruefung. Der Text der Notiz bleibt unveraendert; rev zaehlt wie
  // bei jedem Speichern hoch. Wird erst aufgerufen, nachdem der Guide nachweislich gespeichert und zurueckgelesen ist.
  // Rueckgabe wie save(): { ok, note } | { ok:false, conflict, current } | { ok:false, missing }
  async function markConverted(id, expectedRev, guideId, trash) {
    const res = await runTx('readwrite', (store, setResult, guard) => {
      const g = store.get(id);
      g.onsuccess = guard(() => {
        const rec = g.result;
        if (!rec) { setResult({ ok: false, missing: true }); return; }
        if (rec.rev !== expectedRev) { setResult({ ok: false, conflict: true, current: rec }); return; }
        const now = Date.now();
        const next = Object.assign({}, rec, { convertedGuideId: guideId, convertedAt: now, rev: rec.rev + 1 });
        if (trash) next.trashedAt = now;
        const p = store.put(next);
        p.onsuccess = guard(() => setResult({ ok: true, note: next }));
      });
    });
    if (res.ok) notify({ type: 'changed', id, rev: res.note.rev });
    return res;
  }

  // Endgueltig loeschen – nur aus dem Papierkorb-Dialog, nach Bestaetigung.
  async function purge(id) {
    await runTx('readwrite', (store, setResult, guard) => {
      const req = store.delete(id);
      req.onsuccess = guard(() => setResult(true));
    });
    notify({ type: 'purged', id });
    return true;
  }

  // Merkt sich das Oeffnen, ohne rev oder updatedAt zu veraendern (sonst gaebe es Scheinkonflikte zwischen Fenstern).
  async function markOpened(id) {
    try {
      await runTx('readwrite', (store, setResult, guard) => {
        const g = store.get(id);
        g.onsuccess = guard(() => {
          const rec = g.result;
          if (!rec) { setResult(false); return; }
          rec.lastOpenedAt = Date.now();
          const p = store.put(rec);
          p.onsuccess = guard(() => setResult(true));
        });
      });
    } catch (e) { /* nur Komfortinformation */ }
  }

  // Fuegt Notizen vollstaendig ein (Import/Wiederherstellung); bestehende Datensaetze werden nie ueberschrieben (add statt put).
  async function addMany(notes) {
    await runTx('readwrite', (store, setResult, guard) => {
      let done = 0;
      if (!notes.length) { setResult(0); return; }
      notes.forEach((n) => {
        const req = store.add(n);
        req.onsuccess = guard(() => { done++; setResult(done); });
      });
    });
    notes.forEach((n) => notify({ type: 'changed', id: n.id, rev: n.rev }));
    return notes.length;
  }

  window.QuickNotesDB = {
    open, exists, list, get, create, save, setTrashed, markConverted, purge, markOpened, addMany, onChange,
    defaultTitle, clampTitle, TITLE_MAX, WINDOW_ID, DB_NAME, STORE,
  };
})();
