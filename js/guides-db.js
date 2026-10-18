// ============================================================
// guide.sheet – guides-db.js (Phase 2 – Datenhaltung)
// Einziges Modul das mit dem Dateisystem / IndexedDB spricht.
// Alle anderen guide.sheet Seiten dürfen NUR über window.GuidesDB
// auf Daten zugreifen.
//
// Modus wird automatisch erkannt (kein manueller Switch):
//   - File System Access API verfügbar  → "fs"  (Chrome/Edge)
//   - Nicht verfügbar (z.B. Firefox)     → "idb" (IndexedDB Fallback)
//
// Ordnerstruktur im gewählten Ordner (siehe docs/guide-sheet-konzept.md):
//   categories.json
//   guides-index.json          ← Zusammenfassung aller meta.json (Performance)
//   guide-{timestamp}/
//     meta.json                  (trashedAt gesetzt = Soft-Delete, Ordner bleibt)
//     content.md
//     assets/
//   .trash-guide-{timestamp}/   ← Altbestand vor dem Index: Soft-Delete per Rename
//                                  (restoreGuide() erkennt und migriert das automatisch)
// ============================================================
(function() {
  const DB_NAME       = 'guidesheet-db';
  const DB_VERSION    = 3; // v3: storage-meta Store dazugekommen (FIX 6)
  const HANDLE_STORE  = 'fs-handles';
  const HANDLE_KEY    = 'root-handle';
  const GUIDES_STORE  = 'guides';
  const ASSETS_STORE  = 'assets';
  const CAT_STORE     = 'categories';
  const CAT_KEY       = 'tree';
  const INDEX_STORE   = 'guides-index';
  const INDEX_KEY     = 'index';
  const META_STORE    = 'storage-meta';
  const META_KEY      = 'meta';
  const STORAGE_META_VERSION = 1;
  const APP_VERSION   = '1.0';

  // ── In-Memory-Cache fuer listGuides() ─────────────────────
  let _guidesCache      = null;
  let _guidesCacheStamp = 0;
  const CACHE_TTL_MS    = 60_000; // 1 Minute

  // Serialisiert Index-Lese-Aendere-Schreibe-Zyklen. Mehrere gleichzeitige
  // saveGuide()/deleteGuide()-Aufrufe (z.B. aus deleteGuides()) wuerden
  // sonst denselben alten Indexstand lesen und sich beim Zurueckschreiben
  // gegenseitig ueberschreiben (Lost-Update) – die eigentlichen Datei-/
  // IDB-Schreibvorgaenge je Guide bleiben davon unberuehrt parallel.
  let _indexQueue = Promise.resolve();
  function _queueIndexUpdate(fn) {
    const run = _indexQueue.then(fn, fn);
    _indexQueue = run.then(() => {}, () => {});
    return run;
  }

  const DEFAULT_CATEGORIES = [
    { name: 'Exchange',         color: '#e8b339' },
    { name: 'Active Directory', color: '#7c8cf8' },
    { name: 'Windows Client',   color: '#60a5fa' },
    { name: 'Windows Server',   color: '#2dd4bf' },
    { name: 'Microsoft 365',    color: '#fb7124' },
    { name: 'Netzwerk',         color: '#4ade80' },
    { name: 'Sicherheit',       color: '#f87171' },
    { name: 'RDS',              color: '#a78bfa' },
    { name: 'Kunden',           color: '#f472b6' },
    { name: 'Allgemein',        color: '#94a3b8' },
  ].map(c => ({ ...c, subcategories: [] }));

  let _rootHandle     = null;
  let _permissionState = null; // 'granted' | 'prompt' | 'denied' | null

  // ── IndexedDB – generische Helper ─────────────────────────
  function _openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
        if (!db.objectStoreNames.contains(GUIDES_STORE)) db.createObjectStore(GUIDES_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(ASSETS_STORE)) db.createObjectStore(ASSETS_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(CAT_STORE))    db.createObjectStore(CAT_STORE);
        if (!db.objectStoreNames.contains(INDEX_STORE))  db.createObjectStore(INDEX_STORE);
        if (!db.objectStoreNames.contains(META_STORE))   db.createObjectStore(META_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function idbGet(store, key) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function idbGetAll(store) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  }

  // Schreibtransaktion mit durability 'strict' (wo der Browser die Option kennt): mit der Standard-
  // Dauerhaftigkeit kann bei einem Absturz die letzte Aenderung fehlen. Rueckfall ohne Option.
  function _writeTx(db, stores) {
    try { return db.transaction(stores, 'readwrite', { durability: 'strict' }); }
    catch { return db.transaction(stores, 'readwrite'); }
  }

  // Alle Schreibfunktionen loesen erst bei transaction.oncomplete auf (die Daten sind dann bestaetigt
  // geschrieben) und lehnen bei Fehler/Abbruch ab. NICHT bei request.onsuccess: eine Transaktion kann
  // danach noch abbrechen (Quota, E/A-Fehler) – die App haette dann Erfolg gemeldet, obwohl nichts gespeichert ist.
  async function idbPut(store, value, key) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = _writeTx(db, store); } catch (err) { reject(err); return; }
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort    = () => reject(tx.error || new Error('Transaktion abgebrochen'));
      const os  = tx.objectStore(store);
      const req = key !== undefined ? os.put(value, key) : os.put(value);
      req.onsuccess = () => { result = req.result; };
      req.onerror   = () => { reject(req.error); try { tx.abort(); } catch { /* schon beendet */ } };
    });
  }

  async function idbDelete(store, key) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = _writeTx(db, store); } catch (err) { reject(err); return; }
      tx.oncomplete = () => resolve();
      tx.onabort    = () => reject(tx.error || new Error('Transaktion abgebrochen'));
      const req = tx.objectStore(store).delete(key);
      req.onerror = () => { reject(req.error); try { tx.abort(); } catch { /* schon beendet */ } };
    });
  }

  // ── Modus-Erkennung ────────────────────────────────────────
  // Reine Existenzprüfung, einmalig beim Skript-Laden – kein Aufruf von
  // showDirectoryPicker() an dieser Stelle. Manche Browser (z.B. Brave mit
  // aktiven Shields) lassen den `in`-Operator für gesture-gated APIs
  // fälschlich `false` liefern, obwohl die Funktion via typeof-Zugriff
  // korrekt vorhanden ist – daher typeof statt `in`.
  const FS_AVAILABLE = typeof window.showDirectoryPicker === 'function';

  function isFilesystemMode() { return FS_AVAILABLE; }
  function isIndexedDBMode()  { return !FS_AVAILABLE; }

  // ── Events ───────────────────────────────────────────────
  function _dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }
  function _dispatchConnected() {
    _dispatch('guides-db-connected', { mode: isFilesystemMode() ? 'fs' : 'idb', path: getFolderPath() });
  }
  function _dispatchDisconnected() {
    _dispatch('guides-db-disconnected', {});
  }

  // ── Storage-Version-Marker (FIX 6) ────────────────────────
  // Haelt fest, welcher Storage-Backend (fs/idb) und welche Marker-Version
  // zuletzt mit diesem Ordner/dieser Browser-DB verbunden war. Rein
  // informativ (best-effort) – ein Fehler hier darf openFolder()/
  // restoreFolder() nie zum Scheitern bringen, deshalb kein throw.
  async function _writeStorageMeta() {
    try {
      const meta = {
        storage: isFilesystemMode() ? 'fs' : 'idb',
        version: STORAGE_META_VERSION,
        lastConnected: new Date().toISOString(),
        appVersion: APP_VERSION,
      };
      if (isFilesystemMode()) {
        const root = _requireRoot();
        await _writeTextFile(root, '_meta.json', JSON.stringify(meta, null, 2));
      } else {
        await idbPut(META_STORE, meta, META_KEY);
      }
    } catch { /* best-effort, siehe Kommentar oben */ }
  }

  async function _checkStorageMeta() {
    try {
      let meta;
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const text = await _readTextFile(root, '_meta.json');
        meta = _safeParse(text);
      } else {
        meta = (await idbGet(META_STORE, META_KEY)) || null;
      }
      if (!meta) return { ok: true, fresh: true };
      if (meta.version !== STORAGE_META_VERSION) {
        console.warn('[guides-db] Unbekannte Storage-Version:', meta?.version);
        return { ok: false, meta };
      }
      return { ok: true, meta };
    } catch {
      return { ok: true, fresh: true };
    }
  }

  // ── Ordner-Freigabe (File System Access API) ──────────────
  async function openFolder() {
    if (!isFilesystemMode()) return { success: false, error: 'File System Access API ist in diesem Browser nicht verfügbar.' };
    try {
      const handle = await window.showDirectoryPicker();
      await idbPut(HANDLE_STORE, handle, HANDLE_KEY);
      _rootHandle = handle;
      _permissionState = 'granted';
      await _writeStorageMeta();
      _dispatchConnected();
      return { success: true, path: handle.name };
    } catch (err) {
      if (err?.name === 'AbortError') return { success: false, aborted: true };
      return { success: false, error: 'Ordner konnte nicht geöffnet werden: ' + (err?.message || err) };
    }
  }

  async function restoreFolder() {
    if (!isFilesystemMode()) {
      await _checkStorageMeta();
      await _writeStorageMeta();
      _dispatchConnected();
      return { success: true, connected: true, mode: 'idb' };
    }
    try {
      const handle = await idbGet(HANDLE_STORE, HANDLE_KEY);
      if (!handle) return { success: true, connected: false };
      _rootHandle = handle;
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      _permissionState = perm;
      if (perm === 'granted') {
        await _checkStorageMeta();
        await _writeStorageMeta();
        _dispatchConnected();
      }
      return { success: true, connected: true, permission: perm };
    } catch (err) {
      return { success: false, error: 'Ordner-Handle konnte nicht wiederhergestellt werden: ' + (err?.message || err) };
    }
  }

  async function requestPermission() {
    if (!_rootHandle) return { success: false, error: 'Kein Ordner-Handle vorhanden – bitte erneut auswählen.' };
    try {
      const perm = await _rootHandle.requestPermission({ mode: 'readwrite' });
      _permissionState = perm;
      if (perm === 'granted') { _dispatchConnected(); return { success: true, permission: 'granted' }; }
      return { success: false, error: 'Zugriff wurde nicht gewährt.', permission: perm };
    } catch (err) {
      return { success: false, error: 'Berechtigungsanfrage fehlgeschlagen: ' + (err?.message || err) };
    }
  }

  async function closeFolder() {
    try {
      await idbDelete(HANDLE_STORE, HANDLE_KEY);
      _rootHandle = null;
      _permissionState = null;
      _dispatchDisconnected();
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Ordner konnte nicht getrennt werden: ' + (err?.message || err) };
    }
  }

  function isConnected() {
    if (isFilesystemMode()) return !!_rootHandle && _permissionState === 'granted';
    return true; // IndexedDB-Modus ist immer "verbunden" – kein echter Ordner nötig
  }

  function getFolderPath() {
    if (isFilesystemMode()) return _rootHandle ? _rootHandle.name : null;
    return 'Browser-Speicher (IndexedDB)';
  }

  function getPermissionState() { return _permissionState; }

  function generateId() { return 'guide-' + Date.now(); }

  // Erzwingt beim naechsten listGuides()-Aufruf ein frisches Lesen statt
  // des zwischengespeicherten Stands – z.B. wenn eine andere Seite/ein
  // anderer Tab in der Zwischenzeit Guides geaendert haben koennte.
  function invalidateCache() { _guidesCache = null; }

  // ── FS-Helper (nur intern) ─────────────────────────────────
  function _requireRoot() {
    if (!_rootHandle || _permissionState !== 'granted') throw new Error('Kein Ordner verbunden.');
    return _rootHandle;
  }

  async function _readTextFile(dirHandle, name) {
    const fileHandle = await dirHandle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return file.text();
  }

  async function _writeTextFile(dirHandle, name, text) {
    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (err) {
      // Strom abbrechen, sonst bleibt die Datei bis zum Schliessen der Seite gesperrt
      try { await writable.abort(); } catch { /* war schon geschlossen/abgebrochen */ }
      throw err;
    }
  }

  async function _copyDirectoryRecursive(srcDirHandle, destParentHandle, destName) {
    const destDirHandle = await destParentHandle.getDirectoryHandle(destName, { create: true });
    for await (const [name, handle] of srcDirHandle.entries()) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        const destFileHandle = await destDirHandle.getFileHandle(name, { create: true });
        const writable = await destFileHandle.createWritable();
        await writable.write(file);
        await writable.close();
      } else {
        await _copyDirectoryRecursive(handle, destDirHandle, name);
      }
    }
    return destDirHandle;
  }

  async function _renameDirectory(parentHandle, oldName, newName) {
    // File System Access API kennt kein natives rename() für Verzeichnisse –
    // rekursiv kopieren und danach die Quelle löschen.
    const srcHandle = await parentHandle.getDirectoryHandle(oldName);
    await _copyDirectoryRecursive(srcHandle, parentHandle, newName);
    await parentHandle.removeEntry(oldName, { recursive: true });
  }

  // Wandelt kaputtes/leeres JSON in einen definierten Fallback statt eine
  // Exception hochzureichen, die sonst an unerwarteter Stelle (mitten in
  // einem Promise.all/_parallelLimit-Task) den ganzen Vorgang abbrechen
  // wuerde – ein einzelnes beschaedigtes meta.json soll nur diesen einen
  // Guide betreffen, nicht z.B. den kompletten Index-Rebuild.
  function _safeParse(text, fallback = null) {
    try {
      return JSON.parse(text);
    } catch (err) {
      console.warn('[guides-db] JSON.parse fehlgeschlagen:', err);
      return fallback;
    }
  }

  // ── guides-index.json – zentraler Index statt N Einzel-meta.json-Reads ──
  // Fuehrt bis zu `limit` Tasks gleichzeitig aus statt alles auf einmal
  // parallel zu feuern (Browser/OS-Limits fuer offene Datei-Handles).
  async function _parallelLimit(tasks, limit = 10) {
    const results = [];
    let i = 0;
    async function worker() {
      while (i < tasks.length) {
        const idx = i++;
        results[idx] = await tasks[idx]();
      }
    }
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  async function _readIndex() {
    if (isFilesystemMode()) {
      try {
        const root = _requireRoot();
        const text = await _readTextFile(root, 'guides-index.json');
        return _safeParse(text);
      } catch {
        return null; // Index existiert noch nicht (oder kein Ordner verbunden)
      }
    }
    try {
      return (await idbGet(INDEX_STORE, INDEX_KEY)) || null;
    } catch {
      return null;
    }
  }

  async function _writeIndex(indexData) {
    const data = {
      version: 1,
      updated: new Date().toISOString(),
      guides: indexData,
    };
    if (isFilesystemMode()) {
      const root = _requireRoot();
      await _writeTextFile(root, 'guides-index.json', JSON.stringify(data, null, 2));
    } else {
      await idbPut(INDEX_STORE, data, INDEX_KEY);
    }
  }

  // Nur die Felder, die die Uebersicht/Filter/Suche wirklich braucht –
  // nicht content, privateNote, links, attachments etc.
  function _metaToIndexEntry(meta) {
    return {
      id: meta.id,
      title: meta.title || '',
      category: meta.category || '',
      subcategory: meta.subcategory || '',
      tags: meta.tags || [],
      type: meta.type || 'guide',
      created: meta.created,
      modified: meta.modified,
      favorite: !!meta.favorite,
      source: meta.source || 'manual',
      importTag: meta.importTag || null,
      trashed: !!meta.trashedAt,
      trashedAt: meta.trashedAt || null,
    };
  }

  // Einmalig aus dem vorhandenen Bestand aufbauen – im Dateisystem-Modus
  // aus den guide-*-Ordnern (parallelisiert, siehe _parallelLimit), im
  // IndexedDB-Modus aus dem bereits vorhandenen GUIDES_STORE (z.B. direkt
  // nach diesem Update, wenn dort noch Guides ohne Index liegen – sonst
  // wuerden die fuer den Nutzer kommentarlos aus der Liste verschwinden).
  async function _rebuildIndex() {
    if (isFilesystemMode()) {
      const root = _requireRoot();
      const dirHandles = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind !== 'directory') continue;
        // Normale Guides UND Alt-Papierkorb-Ordner (.trash-guide-*) aus der
        // Zeit vor diesem Index einsammeln – sonst wuerden bereits vorher
        // geloeschte Guides beim Rebuild uebersehen und waeren im (jetzt
        // Index-basierten) Papierkorb unsichtbar.
        if (name.startsWith('guide-')) dirHandles.push({ handle, name, trashedFolder: false });
        else if (name.startsWith('.trash-guide-')) dirHandles.push({ handle, name, trashedFolder: true });
      }
      const tasks = dirHandles.map(({ handle, name, trashedFolder }) => async () => {
        try {
          const meta = _safeParse(await _readTextFile(handle, 'meta.json'));
          if (!meta) {
            console.warn('[guides-db] Überspringe Guide mit defektem meta.json:', name);
            return null;
          }
          const entry = _metaToIndexEntry(meta);
          if (trashedFolder && !entry.trashed) {
            entry.trashed   = true;
            entry.trashedAt = entry.trashedAt || new Date().toISOString();
          }
          return entry;
        } catch {
          return null; // Ordner ohne lesbares meta.json überspringen
        }
      });
      const results = await _parallelLimit(tasks, 10);
      const entries = results.filter(Boolean);
      await _writeIndex(entries);
      return entries;
    }

    const all = await idbGetAll(GUIDES_STORE);
    const entries = all.map((rec) => _metaToIndexEntry(rec.meta));
    await _writeIndex(entries);
    return entries;
  }

  async function _ensureIndex() {
    const index = await _readIndex();
    if (index) return index;
    const entries = await _rebuildIndex();
    return { guides: entries };
  }

  // ── Version, Konflikte, Sperren ──────────────────────────
  // meta.version zaehlt jedes Speichern hoch (alte Guides ohne Feld gelten als Version 1).
  // saveGuide()/updateGuideFields() pruefen mit { expectedVersion } (und im Ordnermodus mit
  // { expectedStamp }, den Dateizeiten beim Lesen), ob der gespeicherte Stand noch der gelesene
  // ist – sonst wird ein ConflictError geworfen und NICHTS geschrieben. Lesen, Pruefen und
  // Schreiben laufen je Guide unter einer Web-Lock (Rueckfall: nur innerhalb dieser Seite).
  class ConflictError extends Error {
    constructor(message, info) {
      super(message);
      this.name = 'ConflictError';
      Object.assign(this, info || {}); // reason, expectedVersion, currentVersion, current: { meta, content }
    }
  }

  function _verOf(meta) {
    return Number.isInteger(meta && meta.version) && meta.version >= 1 ? meta.version : 1;
  }

  // Ein Schritt des Schreibvorgangs ist fehlgeschlagen (content.md, meta.json, Index, Datensatz)
  class StepError extends Error {
    constructor(step, cause) {
      super((cause && cause.message) || String(cause));
      this.name = 'StepError';
      this.step = step;
      this.cause = cause;
    }
  }
  async function _step(step, fn) {
    try { return await fn(); } catch (err) { throw new StepError(step, err); }
  }

  const _localChains = new Map();
  function _withGuideLock(id, fn) {
    const name = 'guides:' + id;
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
      return navigator.locks.request(name, () => fn());
    }
    // Rueckfall ohne Web-Locks: nur Schreibvorgaenge in dieser Seite werden serialisiert
    const prev = _localChains.get(name) || Promise.resolve();
    const run = prev.then(() => fn(), () => fn());
    const tail = run.then(() => {}, () => {});
    _localChains.set(name, tail);
    tail.then(() => { if (_localChains.get(name) === tail) _localChains.delete(name); });
    return run;
  }

  // Lesepfad: Guide-Ordner, bei Altbestand (Soft-Delete per Rename vor dem Index) .trash-<id>
  async function _locateGuideDir(root, id) {
    try { return await root.getDirectoryHandle(id); }
    catch (err) {
      if (err && err.name === 'NotFoundError') {
        try { return await root.getDirectoryHandle('.trash-' + id); } catch { /* nicht vorhanden */ }
      }
      throw err;
    }
  }

  // Frischer Stand aus dem Speicher: { exists, meta, content?, stamp?, rec? }.
  // Wirft bei Lesefehlern (kein Raten, kein "leer"). Fehlender Ordner/meta.json = exists:false.
  async function _readStored(id, opts) {
    const withContent = !!(opts && opts.withContent);
    if (isFilesystemMode()) {
      const root = _requireRoot();
      let dir;
      try { dir = await root.getDirectoryHandle(id); }
      catch (err) { if (err && err.name === 'NotFoundError') return { exists: false }; throw err; }
      let metaFile;
      try { metaFile = await (await dir.getFileHandle('meta.json')).getFile(); }
      catch (err) { if (err && err.name === 'NotFoundError') return { exists: false }; throw err; }
      const meta = _safeParse(await metaFile.text());
      if (!meta) throw new Error('meta.json ist beschädigt.');
      let contentFile = null;
      try { contentFile = await (await dir.getFileHandle('content.md')).getFile(); }
      catch (err) { if (withContent || !(err && err.name === 'NotFoundError')) throw err; }
      return {
        exists: true, meta,
        content: withContent ? await contentFile.text() : undefined,
        stamp: { meta: metaFile.lastModified, content: contentFile ? contentFile.lastModified : null },
      };
    }
    const rec = await idbGet(GUIDES_STORE, id);
    if (!rec) return { exists: false };
    return { exists: true, meta: rec.meta, content: rec.content, rec };
  }

  async function _readStamp(id) {
    try {
      const root = _requireRoot();
      const dir = await root.getDirectoryHandle(id);
      const m = await (await dir.getFileHandle('meta.json')).getFile();
      const c = await (await dir.getFileHandle('content.md')).getFile();
      return { meta: m.lastModified, content: c.lastModified };
    } catch { return null; }
  }

  async function _checkConflict(id, cur, options) {
    let reason = null;
    if (options.expectedVersion != null) {
      if (!cur.exists) reason = 'missing';
      else if (_verOf(cur.meta) !== options.expectedVersion) reason = 'version';
    }
    if (!reason && options.expectedStamp && cur.exists && cur.stamp) {
      const s = options.expectedStamp;
      if ((s.meta != null && s.meta !== cur.stamp.meta) || (s.content != null && s.content !== cur.stamp.content)) reason = 'file-changed';
    }
    if (!reason) return;
    let current = null;
    if (cur.exists) {
      try {
        const full = cur.content !== undefined ? cur : await _readStored(id, { withContent: true });
        current = { meta: full.meta, content: full.content };
      } catch { current = { meta: cur.meta, content: null }; }
    }
    const why = reason === 'missing' ? 'Der Guide existiert nicht mehr.'
      : reason === 'file-changed' ? 'Die Dateien wurden von außen geändert (andere Anwendung, Synchronisierung oder anderer Rechner).'
      : 'Der Guide wurde zwischenzeitlich in einem anderen Fenster geändert (Version ' + _verOf(cur.meta) + ' statt ' + options.expectedVersion + ').';
    throw new ConflictError(why, {
      reason, id, expectedVersion: options.expectedVersion,
      currentVersion: cur.exists ? _verOf(cur.meta) : null, current,
    });
  }

  // Schreibreihenfolge Ordnermodus: content.md, dann meta.json (mit der neuen Version, gilt als
  // Bestaetigung), dann der Index. Im IndexedDB-Modus: Datensatz, dann Index. content === undefined
  // laesst content.md unangetastet. Jeder Fehler wird als StepError mit dem Schritt gemeldet.
  // rollbackContent (nur updateGuideFields): bisheriger Text. Scheitert meta.json, nachdem content.md schon neu
  // geschrieben ist, wird content.md auf diesen Stand zurueckgesetzt – sonst passten Text und Version nicht zusammen
  // (und Aufrufer, die vorher Dateien angelegt haben, koennten sie nicht gefahrlos zurueckziehen).
  async function _persistGuide(id, fullMeta, content, existingRec, rollbackContent) {
    if (isFilesystemMode()) {
      const root = _requireRoot();
      const dir = await _step('Ordner', () => root.getDirectoryHandle(id, { create: true }));
      if (content !== undefined) await _step('content.md', () => _writeTextFile(dir, 'content.md', content));
      try {
        await _step('meta.json', () => _writeTextFile(dir, 'meta.json', JSON.stringify(fullMeta, null, 2)));
      } catch (e) {
        if (content !== undefined && rollbackContent !== undefined) {
          try { await _writeTextFile(dir, 'content.md', rollbackContent); e.rolledBack = true; } catch { e.rolledBack = false; }
        }
        throw e;
      }
      await _step('Index', () => _queueIndexUpdate(async () => {
        const idx = await _readIndex();
        const guides = (idx?.guides || []).filter((g) => g.id !== id);
        guides.push(_metaToIndexEntry(fullMeta));
        await _writeIndex(guides);
      }));
      _guidesCache = null;
      return await _readStamp(id);
    }
    const rec = await _step('Datensatz', async () => (existingRec !== undefined ? existingRec : await idbGet(GUIDES_STORE, id)));
    const record = { id, meta: fullMeta, content: content !== undefined ? content : (rec ? rec.content : ''), trashed: rec ? !!rec.trashed : false };
    await _queueIndexUpdate(() => _idbSaveGuideAtomic(id, record, fullMeta)); // wirft StepError('Datensatz' | 'Index')
    _guidesCache = null;
    return null;
  }

  // IndexedDB-Modus: Datensatz und Indexeintrag in einer Transaktion ueber beide Stores – entweder beides
  // oder nichts gespeichert. Die Struktur des Index bleibt unveraendert.
  function _idbSaveGuideAtomic(id, record, fullMeta) {
    return _openDb().then((db) => new Promise((resolve, reject) => {
      let tx, failed = null;
      try { tx = _writeTx(db, [GUIDES_STORE, INDEX_STORE]); } catch (err) { reject(new StepError('Datensatz', err)); return; }
      const fail = (step, err) => { if (!failed) failed = { step, err }; try { tx.abort(); } catch { /* schon beendet */ } };
      tx.oncomplete = () => (failed ? reject(new StepError(failed.step, failed.err)) : resolve());
      tx.onabort    = () => reject(failed ? new StepError(failed.step, failed.err) : new StepError('Datensatz', tx.error || new Error('Transaktion abgebrochen')));
      const gs = tx.objectStore(GUIDES_STORE), is = tx.objectStore(INDEX_STORE);
      const putReq = gs.put(record);
      putReq.onerror = () => fail('Datensatz', putReq.error);
      const getReq = is.get(INDEX_KEY);
      getReq.onerror = () => fail('Index', getReq.error);
      getReq.onsuccess = () => {
        const guides = ((getReq.result && getReq.result.guides) || []).filter((g) => g.id !== id);
        guides.push(_metaToIndexEntry(fullMeta));
        const putIdx = is.put({ version: 1, updated: new Date().toISOString(), guides }, INDEX_KEY);
        putIdx.onerror = () => fail('Index', putIdx.error);
      };
    }), (err) => { throw new StepError('Datensatz', err); });
  }

  function _partialResult(err) {
    if (err.rolledBack === true) {
      return {
        success: false, partial: false, rolledBack: true, step: err.step,
        error: 'Nicht gespeichert (Schritt „' + err.step + '“): ' + err.message + ' – content.md wurde auf den vorherigen Stand zurückgesetzt, es wurde nichts geändert.',
      };
    }
    if (!isFilesystemMode()) {
      // IndexedDB-Modus: Datensatz und Indexeintrag stehen in einer Transaktion – bei einem Fehler ist nichts gespeichert
      return {
        success: false, partial: false, atomic: true, step: err.step,
        error: 'Nicht gespeichert (Schritt „' + err.step + '“): ' + err.message + ' – Datensatz und Indexeintrag werden in einer Transaktion geschrieben, es wurde nichts gespeichert.',
      };
    }
    const detail = {
      'Ordner':     'der Guide-Ordner konnte nicht angelegt werden, es wurde nichts geschrieben.',
      'content.md': 'content.md konnte nicht geschrieben werden; meta.json, Version und Index sind unverändert.',
      'meta.json':  err.rolledBack === false ? 'content.md ist neu geschrieben und konnte NICHT zurückgesetzt werden: Text und Version passen nicht zusammen!' : 'content.md ist neu geschrieben, meta.json (und damit die Version) nicht; der Index ist unverändert.',
      'Datensatz':  'der Datensatz konnte nicht geschrieben werden; Version und Index sind unverändert.',
      'Index':      'Guide und Version sind gespeichert, aber der Index wurde nicht aktualisiert – der Guide erscheint evtl. nicht in der Liste.',
    }[err.step] || '';
    return {
      success: false, partial: true, step: err.step,
      error: 'Nur teilweise gespeichert (Schritt „' + err.step + '“): ' + err.message + (detail ? ' – ' + detail : ''),
    };
  }

  function _failureResult(id, err, what) {
    if (err instanceof ConflictError) throw err;
    if (err instanceof StepError) return _partialResult(err);
    return { success: false, error: 'Guide "' + id + '" konnte nicht ' + what + ': ' + (err?.message || err) };
  }

  // ── Guide CRUD ───────────────────────────────────────────
  async function listGuides() {
    try {
      const now = Date.now();
      if (_guidesCache && (now - _guidesCacheStamp) < CACHE_TTL_MS) {
        return { success: true, guides: _guidesCache };
      }

      const index = await _ensureIndex();
      const guides = (index.guides || [])
        .filter((g) => !g.trashed)
        .map((g) => ({ id: g.id, meta: g }));

      _guidesCache      = guides;
      _guidesCacheStamp = now;
      return { success: true, guides };
    } catch (err) {
      return { success: false, error: 'Guides konnten nicht gelesen werden: ' + (err?.message || err) };
    }
  }

  async function getGuide(id) {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const dir = await _locateGuideDir(root, id);
        const metaFile = await (await dir.getFileHandle('meta.json')).getFile();
        const meta = _safeParse(await metaFile.text());
        if (!meta) return { success: false, error: 'Guide "' + id + '": meta.json ist beschädigt.' };
        const contentFile = await (await dir.getFileHandle('content.md')).getFile();
        const content = await contentFile.text();
        // stamp: Dateizeiten beim Lesen – saveGuide() erkennt damit Aenderungen von aussen
        return { success: true, id, meta, content, stamp: { meta: metaFile.lastModified, content: contentFile.lastModified } };
      }
      const rec = await idbGet(GUIDES_STORE, id);
      if (!rec) return { success: false, error: 'Guide "' + id + '" wurde nicht gefunden.' };
      return { success: true, id, meta: rec.meta, content: rec.content };
    } catch (err) {
      return { success: false, error: 'Guide "' + id + '" konnte nicht gelesen werden: ' + (err?.message || err) };
    }
  }

  // saveGuide(id, meta, content, options)
  //   options.expectedVersion / options.expectedStamp: nur schreiben, wenn der gespeicherte Stand
  //     noch der gelesene ist, sonst ConflictError (nichts geschrieben).
  //   options.keepModified: Wiederherstellung aus einer Sicherung – modified UND version wie im
  //     Paket, keine Zaehlung, keine Konfliktpruefung, kein Zusammenfuehren mit dem Bestand.
  //   Ohne Optionen: wie bisher (Importe u.a.), version zaehlt aber hoch.
  //   Rueckgabe { success, id, meta, version, stamp } oder { success:false, partial, step, error }.
  async function saveGuide(id, meta, content, options) {
    options = options || {};
    try {
      if (!id) return { success: false, error: 'Guide-ID fehlt.' };
      return await _withGuideLock(id, async () => {
        const now = new Date().toISOString();
        const restore = !!options.keepModified;
        let cur = { exists: false };
        if (!restore) {
          try { cur = await _readStored(id, { withContent: false }); }
          catch (err) {
            if (options.expectedVersion != null || options.expectedStamp) {
              return { success: false, error: 'Guide "' + id + '": gespeicherter Stand nicht lesbar – nichts geschrieben (' + (err?.message || err) + ').' };
            }
            cur = { exists: false, unreadable: true }; // Altaufrufer ohne Pruefung ueberschreiben wie bisher
          }
          await _checkConflict(id, cur, options);
        }
        const fullMeta = Object.assign({
          id, title: '', category: '', subcategory: '', tags: [], type: 'guide',
          created: now, modified: now, favorite: false, source: 'manual', importTag: null, version: 1,
          privateNote: '', links: [], attachments: [],
        }, (!restore && cur.exists) ? cur.meta : null, meta, { id, modified: (restore && meta && meta.modified) ? meta.modified : now });
        if (!restore) fullMeta.version = cur.exists ? _verOf(cur.meta) + 1 : 1;

        const stamp = await _persistGuide(id, fullMeta, content || '', cur.rec);
        return { success: true, id, meta: fullMeta, version: fullMeta.version, stamp };
      });
    } catch (err) {
      return _failureResult(id, err, 'gespeichert werden');
    }
  }

  // updateGuideFields(id, partial, { expectedVersion })
  //   Liest den Guide frisch, setzt NUR die uebergebenen Felder (content nur, wenn es in partial
  //   steht), zaehlt version hoch und schreibt. Schlaegt das frische Lesen fehl, wird nichts
  //   geschrieben. partial darf eine Funktion ({ meta, content }) => Felder | null sein, die mit dem
  //   frischen Stand innerhalb der Sperre aufgerufen wird (wirft sie, wird nichts geschrieben).
  async function updateGuideFields(id, partial, options) {
    options = options || {};
    try {
      if (!id) return { success: false, error: 'Guide-ID fehlt.' };
      return await _withGuideLock(id, async () => {
        let cur;
        try { cur = await _readStored(id, { withContent: true }); }
        catch (err) { return { success: false, error: 'Guide "' + id + '" konnte nicht frisch gelesen werden – nichts geschrieben: ' + (err?.message || err) }; }
        if (!cur.exists) {
          await _checkConflict(id, cur, options);
          return { success: false, error: 'Guide "' + id + '" wurde nicht gefunden – nichts geschrieben.' };
        }
        await _checkConflict(id, cur, options);

        let patch;
        try { patch = typeof partial === 'function' ? await partial({ meta: JSON.parse(JSON.stringify(cur.meta)), content: cur.content }) : partial; }
        catch (err) { return { success: false, aborted: true, code: err && err.code, error: (err && err.message) || String(err) }; }
        if (!patch) return { success: true, unchanged: true, id, meta: cur.meta, content: cur.content, version: _verOf(cur.meta) };

        const newContent = Object.prototype.hasOwnProperty.call(patch, 'content') ? String(patch.content) : undefined;
        const metaPatch = Object.assign({}, patch);
        delete metaPatch.content;
        const fullMeta = Object.assign({}, cur.meta, metaPatch, { id, modified: new Date().toISOString(), version: _verOf(cur.meta) + 1 });
        const stamp = await _persistGuide(id, fullMeta, newContent, cur.rec, cur.content);
        return { success: true, id, meta: fullMeta, content: newContent !== undefined ? newContent : cur.content, version: fullMeta.version, stamp };
      });
    } catch (err) {
      return _failureResult(id, err, 'geändert werden');
    }
  }

  // Soft-Delete markiert nur meta.json/den IDB-Datensatz mit trashedAt –
  // der Ordner bleibt unter seinem normalen Namen liegen (kein Kopieren+
  // Loeschen mehr wie beim alten .trash-*-Rename, das bei vielen Assets
  // sehr langsam war). Physisch entfernt wird erst bei permanentDelete().
  async function deleteGuide(id) {
    return _withGuideLock(id, () => _deleteGuideLocked(id));
  }

  async function _deleteGuideLocked(id) {
    try {
      const now = new Date().toISOString();
      let updatedMeta = null;

      if (isFilesystemMode()) {
        const root = _requireRoot();
        try {
          const dir  = await root.getDirectoryHandle(id);
          const meta = JSON.parse(await _readTextFile(dir, 'meta.json'));
          meta.trashedAt = now;
          meta.version = _verOf(meta) + 1;
          await _writeTextFile(dir, 'meta.json', JSON.stringify(meta, null, 2));
          updatedMeta = meta;
        } catch { /* meta.json nicht lesbar – Index unten trotzdem markieren falls Eintrag existiert */ }
      } else {
        const rec = await idbGet(GUIDES_STORE, id);
        if (!rec) return { success: false, error: 'Guide "' + id + '" wurde nicht gefunden.' };
        rec.trashed        = true;
        rec.meta.trashedAt = now;
        rec.meta.version   = _verOf(rec.meta) + 1;
        await idbPut(GUIDES_STORE, rec);
        updatedMeta = rec.meta;
      }

      await _queueIndexUpdate(async () => {
        const idx = await _readIndex();
        if (!idx) return;
        const guides = (idx.guides || []).filter((g) => g.id !== id);
        if (updatedMeta) {
          guides.push(_metaToIndexEntry(updatedMeta));
        } else {
          // meta.json war nicht lesbar – vorhandenen Indexeintrag notfalls
          // direkt als trashed markieren statt den Guide aus dem Index
          // fallen zu lassen.
          const existing = (idx.guides || []).find((g) => g.id === id);
          if (existing) guides.push({ ...existing, trashed: true, trashedAt: now });
        }
        await _writeIndex(guides);
      });
      _guidesCache = null;

      return { success: true };
    } catch (err) {
      return { success: false, error: 'Guide "' + id + '" konnte nicht gelöscht werden: ' + (err?.message || err) };
    }
  }

  // Loescht mehrere Guides parallel (kein Rename/Copy mehr pro Guide, siehe
  // deleteGuide() – die Index-Updates sind ueber _queueIndexUpdate() serialisiert,
  // laufen also trotz Promise.all sicher nacheinander).
  async function deleteGuides(ids) {
    const results = await Promise.all(ids.map((id) => deleteGuide(id)));
    _guidesCache = null;
    const failed    = results.filter((r) => !r.success);
    const succeeded = ids.length - failed.length;
    return failed.length > 0
      ? { success: false, error: failed.map((f) => f.error).join(', '), succeeded, failed: failed.length }
      : { success: true, count: ids.length, succeeded, failed: 0 };
  }

  async function restoreGuide(id) {
    return _withGuideLock(id, () => _restoreGuideLocked(id));
  }

  async function _restoreGuideLocked(id) {
    try {
      let updatedMeta = null;

      if (isFilesystemMode()) {
        const root = _requireRoot();
        // Altbestand: Guide wurde vor diesem Update geloescht und liegt
        // deshalb noch unter dem alten .trash-<id>-Namen – einmalig
        // zurückbenennen, danach greift das neue Schema (Ordner bleibt,
        // nur trashedAt in meta.json).
        try {
          await root.getDirectoryHandle('.trash-' + id);
          await _renameDirectory(root, '.trash-' + id, id);
        } catch { /* liegt schon unter dem normalen Namen – neues Schema */ }

        try {
          const dir  = await root.getDirectoryHandle(id);
          const meta = JSON.parse(await _readTextFile(dir, 'meta.json'));
          delete meta.trashedAt;
          meta.version = _verOf(meta) + 1;
          await _writeTextFile(dir, 'meta.json', JSON.stringify(meta, null, 2));
          updatedMeta = meta;
        } catch { /* meta.json nicht lesbar – Wiederherstellung trotzdem ok */ }
      } else {
        const rec = await idbGet(GUIDES_STORE, id);
        if (!rec) return { success: false, error: 'Guide "' + id + '" wurde nicht gefunden.' };
        rec.trashed = false;
        delete rec.meta.trashedAt;
        rec.meta.version = _verOf(rec.meta) + 1;
        await idbPut(GUIDES_STORE, rec);
        updatedMeta = rec.meta;
      }

      await _queueIndexUpdate(async () => {
        const idx = await _readIndex();
        if (!idx) return;
        const guides = (idx.guides || []).filter((g) => g.id !== id);
        if (updatedMeta) guides.push(_metaToIndexEntry(updatedMeta));
        await _writeIndex(guides);
      });
      _guidesCache = null;

      return { success: true };
    } catch (err) {
      return { success: false, error: 'Guide "' + id + '" konnte nicht wiederhergestellt werden: ' + (err?.message || err) };
    }
  }

  async function listTrash() {
    try {
      const index = await _ensureIndex();
      const guides = (index.guides || [])
        .filter((g) => g.trashed)
        .map((g) => ({ id: g.id, meta: g }));
      return { success: true, guides };
    } catch (err) {
      return { success: false, error: 'Papierkorb konnte nicht gelesen werden: ' + (err?.message || err) };
    }
  }

  async function permanentDelete(id) {
    return _withGuideLock(id, () => _permanentDeleteLocked(id));
  }

  async function _permanentDeleteLocked(id) {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        let removed = false;
        for (const name of ['.trash-' + id, id]) {
          try { await root.removeEntry(name, { recursive: true }); removed = true; break; }
          catch { /* nächsten Namen versuchen */ }
        }
        if (!removed) return { success: false, error: 'Guide "' + id + '" wurde nicht gefunden.' };
      } else {
        await idbDelete(GUIDES_STORE, id);
        const assets = await idbGetAll(ASSETS_STORE);
        for (const a of assets.filter(a => a.guideId === id)) await idbDelete(ASSETS_STORE, a.key);
      }

      // Index-Eintrag endgueltig entfernen – sonst taucht der Guide im
      // (Index-basierten) Papierkorb weiter als Geist auf, obwohl sein
      // Ordner/Datensatz laengst weg ist.
      await _queueIndexUpdate(async () => {
        const idx = await _readIndex();
        if (!idx) return;
        const guides = (idx.guides || []).filter((g) => g.id !== id);
        await _writeIndex(guides);
      });
      _guidesCache = null;

      return { success: true };
    } catch (err) {
      return { success: false, error: 'Guide "' + id + '" konnte nicht endgültig gelöscht werden: ' + (err?.message || err) };
    }
  }

  // ── Papierkorb im Altlayout (.trash-guide-*, Soft-Delete per Rename vor dem Index) ──
  // Nur Ordnermodus. Die Sicherung liest diese Ordner, auch wenn der Index sie nicht kennt oder
  // ihr meta.json beschaedigt ist (dann als Rohkopie).
  async function listLegacyTrashFolders() {
    if (!isFilesystemMode()) return { success: true, folders: [] };
    try {
      const root = _requireRoot();
      const folders = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'directory' && name.startsWith('.trash-guide-')) folders.push(name);
      }
      return { success: true, folders: folders.sort() };
    } catch (err) {
      return { success: false, error: 'Papierkorb-Altbestand konnte nicht gelesen werden: ' + (err?.message || err) };
    }
  }

  // Liest einen Altbestand-Ordner als Guide (alle Felder, Text, Assets). success:false, wenn meta.json
  // oder content.md fehlt/beschaedigt ist – dann bleibt nur readFolderRaw().
  async function readLegacyTrashGuide(folder) {
    try {
      const root = _requireRoot();
      const dir = await root.getDirectoryHandle(folder);
      const meta = _safeParse(await _readTextFile(dir, 'meta.json'));
      if (!meta || typeof meta !== 'object') return { success: false, error: 'meta.json ist beschädigt.' };
      const content = await _readTextFile(dir, 'content.md');
      const assets = [];
      let assetsDir = null;
      try { assetsDir = await dir.getDirectoryHandle('assets'); } catch { /* keine Assets */ }
      if (assetsDir) {
        for await (const [name, handle] of assetsDir.entries()) {
          if (handle.kind === 'file') assets.push({ name, blob: await handle.getFile() });
        }
      }
      return { success: true, id: meta.id || folder.replace(/^\.trash-/, ''), meta, content, assets };
    } catch (err) {
      return { success: false, error: (err?.message || String(err)) };
    }
  }

  // Alle Dateien eines Ordners unveraendert (Rohkopie): { files: [{ path, blob }], failed: [path] }
  async function readFolderRaw(folder) {
    try {
      const root = _requireRoot();
      const dir = await root.getDirectoryHandle(folder);
      const files = [], failed = [];
      const walk = async (d, prefix) => {
        for await (const [name, handle] of d.entries()) {
          if (handle.kind === 'directory') { await walk(handle, prefix + name + '/'); continue; }
          try { files.push({ path: prefix + name, blob: await handle.getFile() }); } catch { failed.push(prefix + name); }
        }
      };
      await walk(dir, '');
      return { success: true, files, failed };
    } catch (err) {
      return { success: false, error: 'Ordner "' + folder + '" konnte nicht gelesen werden: ' + (err?.message || err), files: [], failed: [] };
    }
  }

  // ── Kategorien ───────────────────────────────────────────
  async function getCategories() {
    try {
      if (isFilesystemMode()) {
        if (!isConnected()) return { success: true, categories: DEFAULT_CATEGORIES, isDefault: true };
        const root = _requireRoot();
        try {
          const text = await _readTextFile(root, 'categories.json');
          return { success: true, categories: JSON.parse(text), isDefault: false };
        } catch {
          await _writeTextFile(root, 'categories.json', JSON.stringify(DEFAULT_CATEGORIES, null, 2));
          return { success: true, categories: DEFAULT_CATEGORIES, isDefault: true };
        }
      }
      const tree = await idbGet(CAT_STORE, CAT_KEY);
      if (tree) return { success: true, categories: tree, isDefault: false };
      await idbPut(CAT_STORE, DEFAULT_CATEGORIES, CAT_KEY);
      return { success: true, categories: DEFAULT_CATEGORIES, isDefault: true };
    } catch (err) {
      return { success: false, error: 'Kategorien konnten nicht gelesen werden: ' + (err?.message || err), categories: DEFAULT_CATEGORIES };
    }
  }

  async function saveCategories(tree) {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        await _writeTextFile(root, 'categories.json', JSON.stringify(tree, null, 2));
      } else {
        await idbPut(CAT_STORE, tree, CAT_KEY);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Kategorien konnten nicht gespeichert werden: ' + (err?.message || err) };
    }
  }

  // ── Assets ───────────────────────────────────────────────
  const MAX_ASSET_SIZE_MB = 10;
  const MAX_ASSET_SIZE    = MAX_ASSET_SIZE_MB * 1024 * 1024;

  async function saveAsset(guideId, filename, fileObject) {
    if (fileObject && fileObject.size > MAX_ASSET_SIZE) {
      return {
        success: false,
        error: 'Datei zu groß: ' + (fileObject.size / 1024 / 1024).toFixed(1) + ' MB. Maximum: ' + MAX_ASSET_SIZE_MB + ' MB.',
      };
    }
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const guideDir  = await root.getDirectoryHandle(guideId, { create: true });
        const assetsDir = await guideDir.getDirectoryHandle('assets', { create: true });
        const fileHandle = await assetsDir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        try {
          await writable.write(fileObject);
          await writable.close();
        } catch (err) {
          try { await writable.abort(); } catch { /* war schon geschlossen/abgebrochen */ }
          throw err;
        }
      } else {
        await idbPut(ASSETS_STORE, { key: guideId + '/' + filename, guideId, filename, blob: fileObject });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Asset "' + filename + '" konnte nicht gespeichert werden: ' + (err?.message || err) };
    }
  }

  async function getAssetUrl(guideId, filename) {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const guideDir  = await _locateGuideDir(root, guideId);
        const assetsDir = await guideDir.getDirectoryHandle('assets');
        const fileHandle = await assetsDir.getFileHandle(filename);
        const file = await fileHandle.getFile();
        return { success: true, url: URL.createObjectURL(file) };
      }
      const rec = await idbGet(ASSETS_STORE, guideId + '/' + filename);
      if (!rec) return { success: false, error: 'Asset "' + filename + '" wurde nicht gefunden.' };
      return { success: true, url: URL.createObjectURL(rec.blob) };
    } catch (err) {
      return { success: false, error: 'Asset-URL konnte nicht erzeugt werden: ' + (err?.message || err) };
    }
  }

  async function listAssets(guideId) {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const guideDir = await _locateGuideDir(root, guideId);
        let assetsDir;
        try { assetsDir = await guideDir.getDirectoryHandle('assets'); }
        catch { return { success: true, assets: [] }; }
        const names = [];
        for await (const [name, handle] of assetsDir.entries()) {
          if (handle.kind === 'file') names.push(name);
        }
        return { success: true, assets: names };
      }
      const all = await idbGetAll(ASSETS_STORE);
      return { success: true, assets: all.filter(a => a.guideId === guideId && !a.trashedAt).map(a => a.filename) };
    } catch (err) {
      return { success: false, error: 'Assets konnten nicht gelesen werden: ' + (err?.message || err) };
    }
  }

  // Wie listAssets(), aber mit Dateigroesse: [{ name, size }]
  async function listAssetsDetailed(guideId) {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const guideDir = await _locateGuideDir(root, guideId);
        let assetsDir;
        try { assetsDir = await guideDir.getDirectoryHandle('assets'); }
        catch { return { success: true, assets: [] }; }
        const assets = [];
        for await (const [name, handle] of assetsDir.entries()) {
          if (handle.kind === 'file') assets.push({ name, size: (await handle.getFile()).size });
        }
        return { success: true, assets };
      }
      const all = await idbGetAll(ASSETS_STORE);
      return {
        success: true,
        assets: all.filter(a => a.guideId === guideId && !a.trashedAt).map(a => ({ name: a.filename, size: a.blob ? a.blob.size : 0 })),
      };
    } catch (err) {
      return { success: false, error: 'Assets konnten nicht gelesen werden: ' + (err?.message || err) };
    }
  }

  async function deleteAsset(guideId, filename) {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const guideDir  = await root.getDirectoryHandle(guideId);
        const assetsDir = await guideDir.getDirectoryHandle('assets');
        await assetsDir.removeEntry(filename);
      } else {
        await idbDelete(ASSETS_STORE, guideId + '/' + filename);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Asset "' + filename + '" konnte nicht gelöscht werden: ' + (err?.message || err) };
    }
  }

  // ── Verwaiste Assets: erkennen (nur lesen) und in den Papierkorb legen ──
  // Es wird NICHTS mehr automatisch geloescht. findOrphanedAssets() liest nur;
  // trashAsset() verschiebt (Ordnermodus: Unterordner .assets-trash im Guide-Ordner,
  // IndexedDB-Modus: eigener Datensatz mit trashedAt); endgueltig geloescht wird
  // erst per purgeTrashedAssets() ("Papierkorb leeren", nach Rueckfrage).
  //
  // Erkennung: ein Asset gilt als referenziert, wenn sein Dateiname irgendwo im Text
  // vorkommt – in jeder ueblichen Schreibweise (roh, URL-kodiert, in spitzen Klammern,
  // mit Backslash-Escapes, Gross-/Kleinschreibung, Unicode-Normalform). Im Zweifel
  // gilt eine Datei als referenziert. Dazu zaehlen die Verweise aus meta.attachments,
  // meta.links (Offline-Kopien) und der privaten Notiz.
  const ASSET_TRASH_DIR = '.assets-trash';

  function _normName(s) { return String(s == null ? '' : s).normalize('NFC').toLowerCase(); }

  function _decodePercent(s) {
    return s.replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => {
      try { return decodeURIComponent(m); }
      catch { try { return unescape(m); } catch { return m; } } // z.B. Latin-1-Kodierung
    });
  }

  function _textVariants(text) {
    const t = String(text == null ? '' : text);
    const variants = new Set();
    const unescaped = t.replace(/\\([!-\/:-@\[-`{-~])/g, '$1'); // Markdown-Backslash-Escapes
    [t, unescaped].forEach((base) => {
      const once  = _decodePercent(base);
      const twice = _decodePercent(once);
      [base, once, twice, once.replace(/\+/g, ' ')].forEach((v) => variants.add(_normName(v)));
    });
    return [...variants];
  }

  function _isAssetReferenced(filename, variants, directRefs) {
    const n = _normName(filename);
    if (!n) return true;
    if (directRefs.has(n)) return true;
    return variants.some((v) => v.includes(n));
  }

  // Schreibt alle Verweise auf das Asset "from" im Text auf "to" um – in denselben Schreibweisen, die
  // findOrphanedAssets() als Verweis erkennt: roh, URL-kodiert (auch Klammern als %28/%29), in spitzen
  // Klammern, mit Backslash-Escapes, Gross-/Kleinschreibung, Unicode-Normalform. "to" wird roh geschrieben
  // (der Editor bereinigt den neuen Namen vorher auf [A-Za-z0-9._-]).
  function rewriteAssetReferences(text, from, to) {
    const variants = new Set();
    const addAll = (v) => { variants.add(v); variants.add(v.normalize('NFC')); variants.add(v.normalize('NFD')); };
    const enc = encodeURIComponent(from);
    [from, enc, encodeURI(from), enc.replace(/\(/g, '%28').replace(/\)/g, '%29'),
      from.replace(/ /g, '%20').replace(/[()\[\]]/g, '\\$&'), from.replace(/[()\[\]]/g, '\\$&')].forEach(addAll);
    const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alts = [...variants].filter(Boolean).sort((a, b) => b.length - a.length).map(esc);
    const re = new RegExp('(assets/)(?:' + alts.join('|') + ')(?![\\w%~-]|\\.\\w)', 'gi');
    return String(text == null ? '' : text).replace(re, (m, pre) => pre + to);
  }

  async function findOrphanedAssets(guideId, content, meta) {
    try {
      const listRes = await listAssetsDetailed(guideId);
      if (!listRes.success) return { success: false, error: listRes.error };

      const texts = [content || ''];
      const directRefs = new Set();
      if (meta) {
        if (meta.privateNote) texts.push(meta.privateNote);
        (meta.links || []).forEach((l) => { if (l && l.offlineAsset) directRefs.add(_normName(l.offlineAsset)); });
        (meta.attachments || []).forEach((a) => { if (a && a.assetFile) directRefs.add(_normName(a.assetFile)); });
      }
      const variants = texts.flatMap(_textVariants);

      const orphans = listRes.assets
        .filter((a) => !_isAssetReferenced(a.name, variants, directRefs))
        .map((a) => ({ guideId, filename: a.name, size: a.size }));
      return { success: true, orphans };
    } catch (err) {
      return { success: false, error: 'Verwaiste Assets konnten nicht geprüft werden: ' + (err?.message || err) };
    }
  }

  async function _copyFile(srcDir, srcName, destDir, destName) {
    const file = await (await srcDir.getFileHandle(srcName)).getFile();
    const writable = await (await destDir.getFileHandle(destName, { create: true })).createWritable();
    try {
      await writable.write(file);
      await writable.close();
    } catch (err) {
      try { await writable.abort(); } catch { /* war schon geschlossen/abgebrochen */ }
      throw err;
    }
    const check = await (await destDir.getFileHandle(destName)).getFile();
    if (check.size !== file.size) throw new Error('Kopie ist unvollständig (' + check.size + ' von ' + file.size + ' Bytes).');
  }

  async function trashAsset(guideId, filename) {
    try {
      const stamp = Date.now();
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const guideDir  = await root.getDirectoryHandle(guideId);
        const assetsDir = await guideDir.getDirectoryHandle('assets');
        const trashDir  = await guideDir.getDirectoryHandle(ASSET_TRASH_DIR, { create: true });
        // erst kopieren und pruefen, dann das Original entfernen
        await _copyFile(assetsDir, filename, trashDir, stamp + '-' + filename);
        await assetsDir.removeEntry(filename);
      } else {
        const rec = await idbGet(ASSETS_STORE, guideId + '/' + filename);
        if (!rec) return { success: false, error: 'Asset "' + filename + '" wurde nicht gefunden.' };
        await idbPut(ASSETS_STORE, {
          key: guideId + '/.trash/' + stamp + '-' + filename, guideId, filename, blob: rec.blob, trashedAt: new Date(stamp).toISOString(),
        });
        await idbDelete(ASSETS_STORE, guideId + '/' + filename);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Asset "' + filename + '" konnte nicht in den Papierkorb verschoben werden: ' + (err?.message || err) };
    }
  }

  function _parseTrashName(name) {
    const m = /^(\d{13})-(.+)$/.exec(name);
    return m ? { filename: m[2], trashedAt: new Date(Number(m[1])).toISOString() } : { filename: name, trashedAt: null };
  }

  // [{ guideId, filename, size, trashedAt, trashName }]
  async function listTrashedAssets() {
    try {
      const items = [];
      if (isFilesystemMode()) {
        const root = _requireRoot();
        for await (const [gname, ghandle] of root.entries()) {
          if (ghandle.kind !== 'directory' || !gname.startsWith('guide-')) continue;
          let trashDir;
          try { trashDir = await ghandle.getDirectoryHandle(ASSET_TRASH_DIR); } catch { continue; }
          for await (const [name, handle] of trashDir.entries()) {
            if (handle.kind !== 'file') continue;
            const parsed = _parseTrashName(name);
            items.push({ guideId: gname, filename: parsed.filename, size: (await handle.getFile()).size, trashedAt: parsed.trashedAt, trashName: name });
          }
        }
      } else {
        (await idbGetAll(ASSETS_STORE)).filter((a) => a.trashedAt).forEach((a) => {
          items.push({ guideId: a.guideId, filename: a.filename, size: a.blob ? a.blob.size : 0, trashedAt: a.trashedAt, trashName: a.key });
        });
      }
      return { success: true, items };
    } catch (err) {
      return { success: false, error: 'Papierkorb der Assets konnte nicht gelesen werden: ' + (err?.message || err) };
    }
  }

  async function restoreAsset(guideId, trashName) {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const guideDir = await _locateGuideDir(root, guideId);
        const trashDir = await guideDir.getDirectoryHandle(ASSET_TRASH_DIR);
        const { filename } = _parseTrashName(trashName);
        const assetsDir = await guideDir.getDirectoryHandle('assets', { create: true });
        let exists = true;
        try { await assetsDir.getFileHandle(filename); } catch { exists = false; }
        if (exists) return { success: false, error: 'Asset "' + filename + '" existiert bereits im Guide und wird nicht überschrieben.' };
        await _copyFile(trashDir, trashName, assetsDir, filename);
        await trashDir.removeEntry(trashName);
        return { success: true, filename };
      }
      const rec = await idbGet(ASSETS_STORE, trashName);
      if (!rec) return { success: false, error: 'Asset wurde nicht im Papierkorb gefunden.' };
      if (await idbGet(ASSETS_STORE, guideId + '/' + rec.filename)) {
        return { success: false, error: 'Asset "' + rec.filename + '" existiert bereits im Guide und wird nicht überschrieben.' };
      }
      await idbPut(ASSETS_STORE, { key: guideId + '/' + rec.filename, guideId, filename: rec.filename, blob: rec.blob });
      await idbDelete(ASSETS_STORE, trashName);
      return { success: true, filename: rec.filename };
    } catch (err) {
      return { success: false, error: 'Asset konnte nicht wiederhergestellt werden: ' + (err?.message || err) };
    }
  }

  // Endgueltiges Loeschen von Papierkorb-Assets: items = [{ guideId, trashName }]
  async function purgeTrashedAssets(items) {
    let deleted = 0, failed = 0;
    for (const it of items || []) {
      try {
        if (isFilesystemMode()) {
          const root = _requireRoot();
          const guideDir = await root.getDirectoryHandle(it.guideId);
          const trashDir = await guideDir.getDirectoryHandle(ASSET_TRASH_DIR);
          await trashDir.removeEntry(it.trashName);
        } else {
          const rec = await idbGet(ASSETS_STORE, it.trashName);
          if (!rec || !rec.trashedAt) throw new Error('kein Papierkorb-Asset');
          await idbDelete(ASSETS_STORE, it.trashName);
        }
        deleted++;
      } catch { failed++; }
    }
    return failed ? { success: false, deleted, failed, error: failed + ' Datei(en) konnten nicht endgültig gelöscht werden.' } : { success: true, deleted, failed: 0 };
  }

  // ── Public API ───────────────────────────────────────────
  window.GuidesDB = {
    // Ordner-Freigabe
    openFolder, restoreFolder, requestPermission, closeFolder,
    isConnected, getFolderPath, getPermissionState,
    isFilesystemMode, isIndexedDBMode,
    // Guides
    listGuides, getGuide, saveGuide, updateGuideFields, deleteGuide, deleteGuides, restoreGuide, permanentDelete, listTrash, generateId,
    invalidateCache, ConflictError,
    listLegacyTrashFolders, readLegacyTrashGuide, readFolderRaw,
    // Kategorien
    getCategories, saveCategories,
    // Assets
    saveAsset, getAssetUrl, listAssets, listAssetsDetailed, deleteAsset,
    findOrphanedAssets, rewriteAssetReferences, trashAsset, listTrashedAssets, restoreAsset, purgeTrashedAssets,
  };
})();
