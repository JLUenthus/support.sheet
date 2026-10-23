// ============================================================
// support.sheet – guide-templates-db.js (eigene Vorlagen beim Anlegen eines Guides: Datenschicht)
// Eigene IndexedDB "guide-templates-db" (Version 1, Store "templates"), getrennt von guidesheet-db / GuidesDB und vom Guide-Speicher.
// Wird NUR geoeffnet (und damit angelegt), wenn der Vorlagen-Dialog benutzt wird, nie beim Laden einer Seite.
// Muster wie quicknotes-db.js: jede Schreiboperation in EINER Transaktion mit durability 'strict' (wo unterstuetzt), Erfolg erst
// bei transaction.oncomplete; save() prueft die Revision (rev) in derselben Transaktion (Abweichung: nichts geschrieben, Rueckgabe
// { conflict: true, current }); Loeschen ist weich (trashedAt). Aenderungen gehen per BroadcastChannel an andere Fenster.
// Datensatz: { id (UUID), name, description, title, category, subcategory, tags, content, createdAt, updatedAt, rev, trashedAt }
// window.__GT_DB_NAME ueberschreibt den Datenbanknamen (nur fuer Tests, vor dem Laden dieser Datei setzen).
// Erwartet js/guide-templates-core.js vor dieser Datei.
// ============================================================
(function () {
  const Core = window.GuideTemplatesCore;
  const DB_NAME = (typeof window.__GT_DB_NAME === 'string' && window.__GT_DB_NAME) || 'guide-templates-db';
  const STORE = 'templates';
  const CHANNEL = 'guide-templates-changes';
  const WINDOW_ID = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 12);

  let dbPromise = null;
  let channel = null;
  const listeners = new Set();

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

  // Fuehrt fn(store, setResult, guard) in einer Transaktion aus; aufgeloest wird erst bei transaction.oncomplete.
  async function runTx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = mode === 'readwrite' ? db.transaction(STORE, mode, { durability: 'strict' }) : db.transaction(STORE, mode);
      } catch (err) {
        try { tx = db.transaction(STORE, mode); } catch (err2) { reject(err2); return; }
      }
      let result, thrown = null;
      const guard = (cb) => (ev) => { try { cb(ev); } catch (err) { thrown = err; try { tx.abort(); } catch (e) { /* schon beendet */ } } };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(thrown || tx.error || new Error('Die Transaktion wurde abgebrochen.'));
      try { fn(tx.objectStore(STORE), (v) => { result = v; }, guard); }
      catch (err) { thrown = err; try { tx.abort(); } catch (e) { /* schon beendet */ } }
    });
  }

  function notify(change) {
    try {
      if (!channel && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL);
      if (channel) channel.postMessage(Object.assign({ from: WINDOW_ID }, change));
    } catch (e) { /* ohne BroadcastChannel: andere Fenster aktualisieren sich beim naechsten Oeffnen */ }
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

  function invalid(problems) { const e = new Error(problems.join(' ')); e.name = 'ValidationError'; e.problems = problems; return e; }

  // Neue Vorlage (ungueltige Eingaben werden abgelehnt, nie gekuerzt)
  async function create(init) {
    const problems = Core.validate(init);
    if (problems.length) throw invalid(problems);
    const n = Core.normalize(init);
    const now = Date.now();
    const rec = Object.assign({ id: crypto.randomUUID() }, n, { createdAt: now, updatedAt: now, rev: 1, trashedAt: null });
    await runTx('readwrite', (store, setResult, guard) => {
      const req = store.add(rec);
      req.onsuccess = guard(() => setResult(rec));
    });
    notify({ type: 'changed', id: rec.id, rev: rec.rev });
    return rec;
  }

  // Speichert die Felder, wenn die Revision noch dem erwarteten Stand entspricht.
  // Rueckgabe: { ok: true, template } | { ok: false, conflict: true, current } | { ok: false, missing: true }
  async function save(id, fields, expectedRev) {
    const problems = Core.validate(fields);
    if (problems.length) throw invalid(problems);
    const n = Core.normalize(fields);
    const res = await runTx('readwrite', (store, setResult, guard) => {
      const g = store.get(id);
      g.onsuccess = guard(() => {
        const rec = g.result;
        if (!rec) { setResult({ ok: false, missing: true }); return; }
        if (rec.rev !== expectedRev) { setResult({ ok: false, conflict: true, current: rec }); return; }
        const next = Object.assign({}, rec, n, { updatedAt: Date.now(), rev: rec.rev + 1 });
        const p = store.put(next);
        p.onsuccess = guard(() => setResult({ ok: true, template: next }));
      });
    });
    if (res.ok) notify({ type: 'changed', id, rev: res.template.rev });
    return res;
  }

  // Weich loeschen / wiederherstellen (nur das Kennzeichen aendert sich). expectedRev (optional): bei Abweichung nichts tun.
  async function setTrashed(id, trashed, expectedRev) {
    const res = await runTx('readwrite', (store, setResult, guard) => {
      const g = store.get(id);
      g.onsuccess = guard(() => {
        const rec = g.result;
        if (!rec) { setResult({ ok: false, missing: true }); return; }
        if (expectedRev != null && rec.rev !== expectedRev) { setResult({ ok: false, conflict: true, current: rec }); return; }
        const next = Object.assign({}, rec, { trashedAt: trashed ? Date.now() : null, rev: rec.rev + 1 });
        const p = store.put(next);
        p.onsuccess = guard(() => setResult({ ok: true, template: next }));
      });
    });
    if (res.ok) notify({ type: 'changed', id, rev: res.template.rev });
    return res;
  }

  // Import: fuegt vollstaendige Datensaetze ein; bestehende werden nie ueberschrieben (add statt put, bei gleicher ID bricht die Transaktion ab)
  async function addMany(templates) {
    if (!templates.length) return 0;
    await runTx('readwrite', (store, setResult, guard) => {
      let done = 0;
      templates.forEach((t) => {
        const req = store.add(t);
        req.onsuccess = guard(() => { done++; setResult(done); });
      });
    });
    templates.forEach((t) => notify({ type: 'changed', id: t.id, rev: t.rev }));
    return templates.length;
  }

  window.GuideTemplatesDB = { open, list, get, create, save, setTrashed, addMany, onChange, DB_NAME, STORE, WINDOW_ID };
})();
