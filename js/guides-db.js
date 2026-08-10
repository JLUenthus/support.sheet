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

  async function idbPut(store, value, key) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readwrite').objectStore(store);
      const req = key !== undefined ? tx.put(value, key) : tx.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function idbDelete(store, key) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
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
    await writable.write(text);
    await writable.close();
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
        const dir = await root.getDirectoryHandle(id);
        const meta = _safeParse(await _readTextFile(dir, 'meta.json'));
        if (!meta) return { success: false, error: 'Guide "' + id + '": meta.json ist beschädigt.' };
        const content = await _readTextFile(dir, 'content.md');
        return { success: true, id, meta, content };
      }
      const rec = await idbGet(GUIDES_STORE, id);
      if (!rec) return { success: false, error: 'Guide "' + id + '" wurde nicht gefunden.' };
      return { success: true, id, meta: rec.meta, content: rec.content };
    } catch (err) {
      return { success: false, error: 'Guide "' + id + '" konnte nicht gelesen werden: ' + (err?.message || err) };
    }
  }

  async function saveGuide(id, meta, content) {
    try {
      if (!id) return { success: false, error: 'Guide-ID fehlt.' };
      const now = new Date().toISOString();
      const fullMeta = Object.assign({
        id, title: '', category: '', subcategory: '', tags: [], type: 'guide',
        created: now, modified: now, favorite: false, source: 'manual', importTag: null, version: 1,
        privateNote: '', links: [], attachments: [],
      }, meta, { id, modified: now });

      if (isFilesystemMode()) {
        const root = _requireRoot();
        const dir = await root.getDirectoryHandle(id, { create: true });
        await _writeTextFile(dir, 'meta.json', JSON.stringify(fullMeta, null, 2));
        await _writeTextFile(dir, 'content.md', content || '');
      } else {
        const existing = await idbGet(GUIDES_STORE, id);
        await idbPut(GUIDES_STORE, { id, meta: fullMeta, content: content || '', trashed: existing?.trashed || false });
      }

      await _queueIndexUpdate(async () => {
        const idx = await _readIndex();
        const guides = (idx?.guides || []).filter((g) => g.id !== id);
        guides.push(_metaToIndexEntry(fullMeta));
        await _writeIndex(guides);
      });
      _guidesCache = null;

      return { success: true, id, meta: fullMeta };
    } catch (err) {
      return { success: false, error: 'Guide "' + id + '" konnte nicht gespeichert werden: ' + (err?.message || err) };
    }
  }

  // Soft-Delete markiert nur meta.json/den IDB-Datensatz mit trashedAt –
  // der Ordner bleibt unter seinem normalen Namen liegen (kein Kopieren+
  // Loeschen mehr wie beim alten .trash-*-Rename, das bei vielen Assets
  // sehr langsam war). Physisch entfernt wird erst bei permanentDelete().
  async function deleteGuide(id) {
    try {
      const now = new Date().toISOString();
      let updatedMeta = null;

      if (isFilesystemMode()) {
        const root = _requireRoot();
        try {
          const dir  = await root.getDirectoryHandle(id);
          const meta = JSON.parse(await _readTextFile(dir, 'meta.json'));
          meta.trashedAt = now;
          await _writeTextFile(dir, 'meta.json', JSON.stringify(meta, null, 2));
          updatedMeta = meta;
        } catch { /* meta.json nicht lesbar – Index unten trotzdem markieren falls Eintrag existiert */ }
      } else {
        const rec = await idbGet(GUIDES_STORE, id);
        if (!rec) return { success: false, error: 'Guide "' + id + '" wurde nicht gefunden.' };
        rec.trashed        = true;
        rec.meta.trashedAt = now;
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
          await _writeTextFile(dir, 'meta.json', JSON.stringify(meta, null, 2));
          updatedMeta = meta;
        } catch { /* meta.json nicht lesbar – Wiederherstellung trotzdem ok */ }
      } else {
        const rec = await idbGet(GUIDES_STORE, id);
        if (!rec) return { success: false, error: 'Guide "' + id + '" wurde nicht gefunden.' };
        rec.trashed = false;
        delete rec.meta.trashedAt;
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
        await writable.write(fileObject);
        await writable.close();
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
        const guideDir  = await root.getDirectoryHandle(guideId);
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
        const guideDir = await root.getDirectoryHandle(guideId);
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
      return { success: true, assets: all.filter(a => a.guideId === guideId).map(a => a.filename) };
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

  // Löscht alle Assets eines Guides, die im aktuellen content-Text nicht mehr
  // per "assets/<dateiname>" referenziert werden (z.B. nach Entfernen eines
  // Bildes im Editor). Link-Offline-Kopien und Datei-Anhänge stehen nicht im
  // content-Text, sondern nur in meta.links/meta.attachments – müssen also
  // explizit mit als "referenziert" gezählt werden, sonst löscht der nächste
  // Editor-Speichervorgang sie sofort wieder.
  async function cleanupOrphanedAssets(guideId, content, meta) {
    try {
      const listRes = await listAssets(guideId);
      if (!listRes.success) return { success: false, error: listRes.error };

      const referenced = new Set();
      const regex = /assets\/([^\s)"'\]]+)/g;
      let m;
      while ((m = regex.exec(content || ''))) referenced.add(m[1]);

      if (meta) {
        (meta.links || []).forEach((l) => { if (l.offlineAsset) referenced.add(l.offlineAsset); });
        (meta.attachments || []).forEach((a) => { if (a.assetFile) referenced.add(a.assetFile); });
      }

      const orphaned = listRes.assets.filter((filename) => !referenced.has(filename));
      for (const filename of orphaned) {
        await deleteAsset(guideId, filename);
      }
      return { success: true, deletedCount: orphaned.length, deletedFiles: orphaned };
    } catch (err) {
      return { success: false, error: 'Verwaiste Assets konnten nicht bereinigt werden: ' + (err?.message || err) };
    }
  }

  // ── Public API ───────────────────────────────────────────
  window.GuidesDB = {
    // Ordner-Freigabe
    openFolder, restoreFolder, requestPermission, closeFolder,
    isConnected, getFolderPath, getPermissionState,
    isFilesystemMode, isIndexedDBMode,
    // Guides
    listGuides, getGuide, saveGuide, deleteGuide, deleteGuides, restoreGuide, permanentDelete, listTrash, generateId,
    invalidateCache,
    // Kategorien
    getCategories, saveCategories,
    // Assets
    saveAsset, getAssetUrl, listAssets, deleteAsset, cleanupOrphanedAssets,
  };
})();
