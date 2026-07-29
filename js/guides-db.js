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
//   guide-{timestamp}/
//     meta.json
//     content.md
//     assets/
//   .trash-guide-{timestamp}/   ← Soft-Delete
// ============================================================
(function() {
  const DB_NAME       = 'guidesheet-db';
  const DB_VERSION    = 1;
  const HANDLE_STORE  = 'fs-handles';
  const HANDLE_KEY    = 'root-handle';
  const GUIDES_STORE  = 'guides';
  const ASSETS_STORE  = 'assets';
  const CAT_STORE     = 'categories';
  const CAT_KEY       = 'tree';

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

  // ── Ordner-Freigabe (File System Access API) ──────────────
  async function openFolder() {
    if (!isFilesystemMode()) return { success: false, error: 'File System Access API ist in diesem Browser nicht verfügbar.' };
    try {
      const handle = await window.showDirectoryPicker();
      await idbPut(HANDLE_STORE, handle, HANDLE_KEY);
      _rootHandle = handle;
      _permissionState = 'granted';
      _dispatchConnected();
      return { success: true, path: handle.name };
    } catch (err) {
      if (err?.name === 'AbortError') return { success: false, aborted: true };
      return { success: false, error: 'Ordner konnte nicht geöffnet werden: ' + (err?.message || err) };
    }
  }

  async function restoreFolder() {
    if (!isFilesystemMode()) {
      _dispatchConnected();
      return { success: true, connected: true, mode: 'idb' };
    }
    try {
      const handle = await idbGet(HANDLE_STORE, HANDLE_KEY);
      if (!handle) return { success: true, connected: false };
      _rootHandle = handle;
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      _permissionState = perm;
      if (perm === 'granted') _dispatchConnected();
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

  // ── Guide CRUD ───────────────────────────────────────────
  async function listGuides() {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const guides = [];
        for await (const [name, handle] of root.entries()) {
          if (handle.kind !== 'directory' || !name.startsWith('guide-')) continue;
          try {
            const meta = JSON.parse(await _readTextFile(handle, 'meta.json'));
            guides.push({ id: name, meta });
          } catch {
            // Ordner ohne lesbares meta.json überspringen
          }
        }
        return { success: true, guides };
      }
      const all = await idbGetAll(GUIDES_STORE);
      const guides = all.filter(g => !g.trashed).map(g => ({ id: g.id, meta: g.meta }));
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
        const meta = JSON.parse(await _readTextFile(dir, 'meta.json'));
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
      return { success: true, id, meta: fullMeta };
    } catch (err) {
      return { success: false, error: 'Guide "' + id + '" konnte nicht gespeichert werden: ' + (err?.message || err) };
    }
  }

  async function deleteGuide(id) {
    try {
      const now = new Date().toISOString();
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const dir = await root.getDirectoryHandle(id);
        try {
          const meta = JSON.parse(await _readTextFile(dir, 'meta.json'));
          meta.trashedAt = now;
          await _writeTextFile(dir, 'meta.json', JSON.stringify(meta, null, 2));
        } catch { /* meta.json nicht lesbar – trotzdem in den Papierkorb verschieben */ }
        await _renameDirectory(root, id, '.trash-' + id);
      } else {
        const rec = await idbGet(GUIDES_STORE, id);
        if (!rec) return { success: false, error: 'Guide "' + id + '" wurde nicht gefunden.' };
        rec.trashed = true;
        rec.meta.trashedAt = now;
        await idbPut(GUIDES_STORE, rec);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Guide "' + id + '" konnte nicht gelöscht werden: ' + (err?.message || err) };
    }
  }

  async function restoreGuide(id) {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        await _renameDirectory(root, '.trash-' + id, id);
        try {
          const dir = await root.getDirectoryHandle(id);
          const meta = JSON.parse(await _readTextFile(dir, 'meta.json'));
          delete meta.trashedAt;
          await _writeTextFile(dir, 'meta.json', JSON.stringify(meta, null, 2));
        } catch { /* meta.json nicht lesbar – Wiederherstellung trotzdem ok */ }
      } else {
        const rec = await idbGet(GUIDES_STORE, id);
        if (!rec) return { success: false, error: 'Guide "' + id + '" wurde nicht gefunden.' };
        rec.trashed = false;
        delete rec.meta.trashedAt;
        await idbPut(GUIDES_STORE, rec);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Guide "' + id + '" konnte nicht wiederhergestellt werden: ' + (err?.message || err) };
    }
  }

  async function listTrash() {
    try {
      if (isFilesystemMode()) {
        const root = _requireRoot();
        const guides = [];
        for await (const [name, handle] of root.entries()) {
          if (handle.kind !== 'directory' || !name.startsWith('.trash-')) continue;
          try {
            const meta = JSON.parse(await _readTextFile(handle, 'meta.json'));
            guides.push({ id: name.replace(/^\.trash-/, ''), meta });
          } catch {
            // Ordner ohne lesbares meta.json überspringen
          }
        }
        return { success: true, guides };
      }
      const all = await idbGetAll(GUIDES_STORE);
      const guides = all.filter(g => g.trashed).map(g => ({ id: g.id, meta: g.meta }));
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
  async function saveAsset(guideId, filename, fileObject) {
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

  // ── Public API ───────────────────────────────────────────
  window.GuidesDB = {
    // Ordner-Freigabe
    openFolder, restoreFolder, requestPermission, closeFolder,
    isConnected, getFolderPath, getPermissionState,
    isFilesystemMode, isIndexedDBMode,
    // Guides
    listGuides, getGuide, saveGuide, deleteGuide, restoreGuide, permanentDelete, listTrash, generateId,
    // Kategorien
    getCategories, saveCategories,
    // Assets
    saveAsset, getAssetUrl, listAssets,
  };
})();
