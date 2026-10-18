// ============================================================
// guide.sheet – guides-backup.js (Sicherung / Weitergabe / Prüfsummen / Backup-Anzeige)
// Format- und Prüflogik ohne eigene Oberfläche. Liest ausschließlich über
// window.GuidesDB. Erwartet vor dieser Datei: guides-db.js; für Pakete
// zusätzlich jszip.min.js (nur beim Erstellen/Prüfen).
//
// Paketformat (ZIP), Version 2 – bleibt kompatibel zum alten Merge-Paket:
//   _package.json      Kopf: version, formatVersion, kind ('backup'|'share'), exportedAt, exportedBy, Zahlen, notice
//   _manifest.json     formatVersion, Zahlen, SHA-256 je meta.json, content.md und Asset, categoriesSha256
//   categories.json    vollständiger Kategorienbaum (Unterkategorien, Farben)
//   guides/<id>/meta.json | content.md | assets/<datei>
//   LIES-MICH.txt      nur bei kind 'backup' (Hinweis auf private Notizen)
// Die meta.json stammt aus dem Guide selbst (GuidesDB.getGuide), nie aus dem Index.
// ============================================================
(function () {
  'use strict';

  const FORMAT_VERSION = 2;
  const BACKUP_KEY     = 'gs-last-backup';
  const PRIVATE_NOTICE = 'Enthält private Notizen. Nicht weitergeben.';

  const READABLE_WARNING =
    'Das lesbare Archiv enthält nur Texte und Bilder. Es gehen verloren: Tags, Favoriten, Zeitstempel (erstellt/geändert), ' +
    'Unterkategorien, private Notizen, Anhänge und Links als eigene Felder (nur als Textabschnitt), Kategorienbaum samt Farben ' +
    'und Guides im Papierkorb. Titel und Kategorienamen werden in Dateinamen umgewandelt (Sonderzeichen entfallen) und können ' +
    'sich beim Import verändern. Als Backup ist dieses Format nicht geeignet.';

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ── SHA-256 ──────────────────────────────────────────────
  // crypto.subtle gibt es nur in sicheren Kontexten (https/localhost); sonst greift
  // die reine JS-Implementierung. Beide liefern dieselben Werte (siehe Test).
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function _sha256Js(bytes) {
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = bytes.length;
    const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
    dv.setUint32(padded.length - 4, (len << 3) >>> 0);
    const w = new Uint32Array(64);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    const out = new Uint8Array(32), odv = new DataView(out.buffer);
    h.forEach((v, i) => odv.setUint32(i * 4, v));
    return out;
  }

  const toHex = (u8) => [...u8].map((x) => x.toString(16).padStart(2, '0')).join('');

  async function _toBytes(data) {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
    throw new Error('Unbekannter Datentyp für die Prüfsumme.');
  }

  async function sha256Hex(data) {
    const bytes = await _toBytes(data);
    if (window.crypto && window.crypto.subtle) return toHex(new Uint8Array(await window.crypto.subtle.digest('SHA-256', bytes)));
    return toHex(_sha256Js(bytes));
  }

  // ── Daten einsammeln (aus dem Guide selbst, nie aus dem Index) ──
  // Bricht bei jedem Lesefehler ab, statt still etwas wegzulassen.
  async function collect(db, opts) {
    opts = opts || {};
    db.invalidateCache();
    const lr = await db.listGuides();
    if (!lr.success) throw new Error(lr.error || 'Guides konnten nicht gelesen werden.');
    let entries = (lr.guides || []).map((g) => ({ id: g.id, trashed: false, title: g.meta && g.meta.title, category: g.meta && g.meta.category, favorite: g.meta && g.meta.favorite }));
    if (opts.scope === 'category') entries = entries.filter((e) => (e.category || 'Allgemein') === opts.category);
    else if (opts.scope === 'favorites') entries = entries.filter((e) => e.favorite);
    if (opts.includeTrash) {
      const tr = await db.listTrash();
      if (!tr.success) throw new Error(tr.error || 'Papierkorb konnte nicht gelesen werden.');
      (tr.guides || []).forEach((g) => entries.push({ id: g.id, trashed: true, title: g.meta && g.meta.title, trashedAt: g.meta && g.meta.trashedAt }));
    }

    const guides = [], unreadableTrash = [];
    for (const e of entries) {
      const label = 'Guide „' + (e.title || e.id) + '“ (' + e.id + ')';
      try {
        const full = await db.getGuide(e.id);
        if (!full.success) throw new Error(label + ' konnte nicht gelesen werden: ' + (full.error || 'unbekannter Fehler'));
        const ar = await db.listAssets(e.id);
        if (!ar.success) throw new Error(label + ': Assets konnten nicht gelesen werden: ' + (ar.error || 'unbekannter Fehler'));
        const assets = [];
        for (const name of ar.assets) {
          const u = await db.getAssetUrl(e.id, name);
          if (!u.success) throw new Error(label + ': Asset „' + name + '“ konnte nicht gelesen werden: ' + (u.error || 'unbekannter Fehler'));
          try {
            const resp = await fetch(u.url);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            assets.push({ name, blob: await resp.blob() });
          } catch (err) {
            throw new Error(label + ': Asset „' + name + '“ konnte nicht gelesen werden: ' + (err && err.message || err));
          } finally { URL.revokeObjectURL(u.url); }
        }
        // Papierkorb-Altbestand: meta.json hat dort kein trashedAt – aus dem Index uebernehmen, damit der Guide als Papierkorb-Guide gekennzeichnet ist
        const meta = (e.trashed && !full.meta.trashedAt) ? Object.assign({}, full.meta, { trashedAt: e.trashedAt || full.meta.modified || new Date().toISOString() }) : full.meta;
        guides.push({ id: e.id, trashed: e.trashed, meta, content: full.content || '', assets });
      } catch (err) {
        // Ein unlesbarer Papierkorb-Guide darf die Sicherung nie verhindern (siehe Rohkopie unten);
        // bei einem aktiven Guide bleibt es beim Abbruch mit Meldung – nichts wird stumm weggelassen.
        if (!e.trashed) throw err;
        unreadableTrash.push({ id: e.id, label, error: (err && err.message) || String(err) });
      }
    }

    // Papierkorb im Altlayout (.trash-guide-*): lesbar -> als Papierkorb-Guide, sonst Rohkopie unveraendert.
    // Sie werden unabhaengig vom Index gesucht (ein beschaedigtes meta.json steht nie im Index).
    const legacy = [], unlisted = [];
    if (opts.includeTrash && db.isFilesystemMode()) {
      const lf = await db.listLegacyTrashFolders();
      if (!lf.success) throw new Error(lf.error || 'Papierkorb-Altbestand konnte nicht gelesen werden.');
      const have = new Set(guides.map((g) => g.id));
      for (const folder of lf.folders) {
        if (have.has(folder.replace(/^\.trash-/, ''))) continue;
        const rd = await db.readLegacyTrashGuide(folder);
        if (rd.success) {
          if (have.has(rd.id)) continue;
          const meta = Object.assign({}, rd.meta);
          if (!meta.trashedAt) meta.trashedAt = meta.modified || new Date().toISOString();
          guides.push({ id: rd.id, trashed: true, meta, content: rd.content, assets: rd.assets, legacyFolder: folder });
          have.add(rd.id);
        } else {
          const raw = await db.readFolderRaw(folder);
          if (!raw.success) { unlisted.push({ id: folder, label: folder, error: raw.error }); continue; }
          legacy.push({ folder, files: raw.files, failed: raw.failed, reason: rd.error });
        }
      }
    }
    // unlesbare Papierkorb-Eintraege aus dem Index: Ordner roh kopieren, falls es ihn gibt
    for (const u of unreadableTrash) {
      if (legacy.some((l) => l.folder === '.trash-' + u.id)) continue;
      let raw = null;
      if (db.isFilesystemMode()) {
        for (const folder of ['.trash-' + u.id, u.id]) {
          const r = await db.readFolderRaw(folder);
          if (r.success) { raw = { folder, files: r.files, failed: r.failed, reason: u.error }; break; }
        }
      }
      if (raw) legacy.push(raw); else unlisted.push(u);
    }

    const cat = await db.getCategories();
    if (!cat.success) throw new Error(cat.error || 'Kategorien konnten nicht gelesen werden.');
    return { guides, categories: cat.categories || [], legacy, unlisted };
  }

  // ── Paket bauen (kind: 'backup' = Sicherung, 'share' = Weitergabe ohne private Notiz) ──
  async function buildPackage(kind, data, exportedBy) {
    if (typeof JSZip === 'undefined') throw new Error('jszip.js konnte nicht geladen werden.');
    if (kind !== 'backup' && kind !== 'share') throw new Error('Unbekanntes Paketformat: ' + kind);
    const zip = new JSZip();
    const now = new Date().toISOString();
    const manifestGuides = [];
    let assetCount = 0, trashedCount = 0;

    for (const g of data.guides) {
      const meta = JSON.parse(JSON.stringify(g.meta));
      if (kind === 'share') delete meta.privateNote;
      const base = 'guides/' + g.id + '/';
      const metaText = JSON.stringify(meta, null, 2);
      zip.file(base + 'meta.json', metaText);
      zip.file(base + 'content.md', g.content);
      const assets = [];
      for (const a of g.assets) {
        zip.file(base + 'assets/' + a.name, a.blob);
        assets.push({ name: a.name, size: a.blob.size, sha256: await sha256Hex(a.blob) });
      }
      assetCount += assets.length;
      if (meta.trashedAt) trashedCount++;
      manifestGuides.push({
        id: g.id, trashed: !!meta.trashedAt,
        metaSha256: await sha256Hex(metaText), contentSha256: await sha256Hex(g.content), assets,
      });
    }

    // Rohkopien unlesbarer Papierkorb-Ordner (Altlayout) – unveraendert, mit Pruefsummen
    const manifestLegacy = [];
    for (const l of (data.legacy || [])) {
      const files = [];
      for (const f of l.files) {
        zip.file('_legacy-trash/' + l.folder + '/' + f.path, f.blob);
        files.push({ path: f.path, size: f.blob.size, sha256: await sha256Hex(f.blob) });
      }
      manifestLegacy.push({ folder: l.folder, reason: l.reason || '', files, failed: l.failed || [] });
    }

    const categoriesText = JSON.stringify(data.categories, null, 2);
    zip.file('categories.json', categoriesText);

    const manifest = {
      formatVersion: FORMAT_VERSION, kind, createdAt: now,
      guideCount: data.guides.length, trashedCount, assetCount, legacyTrashCount: manifestLegacy.length,
      categoriesSha256: await sha256Hex(categoriesText), guides: manifestGuides, legacyTrash: manifestLegacy,
    };
    const manifestText = JSON.stringify(manifest, null, 2);
    zip.file('_manifest.json', manifestText);
    zip.file('_package.json', JSON.stringify({
      version: '2.0', formatVersion: FORMAT_VERSION, kind, tool: 'guide.sheet',
      exportedAt: now, exportedBy, guideCount: data.guides.length, trashedCount, assetCount, legacyTrashCount: manifestLegacy.length,
      includesPrivateNotes: kind === 'backup',
      notice: kind === 'backup' ? PRIVATE_NOTICE : 'Ohne private Notizen (Weitergabe).',
    }, null, 2));
    if (kind === 'backup') {
      zip.file('LIES-MICH.txt',
        'guide.sheet – Sicherung (vollständig)\r\n' +
        'Erstellt: ' + now + '\r\n' +
        'Guides: ' + data.guides.length + ' (davon im Papierkorb: ' + trashedCount + '), Assets: ' + assetCount + '\r\n\r\n' +
        PRIVATE_NOTICE.toUpperCase() + '\r\n' + PRIVATE_NOTICE + '\r\n\r\n' +
        'Wiederherstellen: guide.sheet → Lokale DB | Einstellungen → Import / Merge → diese ZIP-Datei wählen.\r\n' +
        'Prüfsummen (SHA-256 je meta.json, content.md und Asset): _manifest.json\r\n');
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { blob, manifest, manifestText, counts: { guides: data.guides.length, trashed: trashedCount, assets: assetCount, legacy: manifestLegacy.length } };
  }

  // ── Prüfsummen prüfen (Export: gerade erzeugte Datei; Import: gewählte Datei) ──
  // Ergebnis: { hasManifest, ok, errors: [Text], guideErrors: { id: [Text] }, guideCount, assetCount, manifest }
  async function verifyZip(zip) {
    const mf = zip.file('_manifest.json');
    if (!mf) return { hasManifest: false, ok: true, errors: [], guideErrors: {}, guideCount: 0, assetCount: 0, manifest: null };
    const errors = [], guideErrors = {};
    const addG = (id, msg) => { (guideErrors[id] = guideErrors[id] || []).push(msg); };
    let man;
    try { man = JSON.parse(await mf.async('string')); } catch (err) {
      return { hasManifest: true, ok: false, errors: ['Manifest ist nicht lesbar: ' + (err && err.message || err)], guideErrors, guideCount: 0, assetCount: 0, manifest: null };
    }
    const listed = new Set(['guides/']);
    const read = async (path) => { const f = zip.file(path); return f ? f.async('uint8array') : null; };
    let assetCount = 0;

    for (const e of (man.guides || [])) {
      const base = 'guides/' + e.id + '/';
      const fileChecks = [[base + 'meta.json', e.metaSha256, 'meta.json'], [base + 'content.md', e.contentSha256, 'Text (content.md)']];
      for (const [path, expected, label] of fileChecks) {
        listed.add(path);
        const bytes = await read(path);
        if (!bytes) addG(e.id, label + ' fehlt im Paket');
        else if (await sha256Hex(bytes) !== expected) addG(e.id, 'Prüfsumme stimmt nicht: ' + label);
      }
      for (const a of (e.assets || [])) {
        assetCount++;
        const path = base + 'assets/' + a.name;
        listed.add(path);
        const bytes = await read(path);
        if (!bytes) addG(e.id, 'Asset „' + a.name + '“ fehlt im Paket');
        else if (bytes.length !== a.size || await sha256Hex(bytes) !== a.sha256) addG(e.id, 'Prüfsumme stimmt nicht: Asset „' + a.name + '“');
      }
    }
    for (const l of (man.legacyTrash || [])) {
      const key = '_legacy-trash/' + l.folder;
      for (const f of (l.files || [])) {
        const path = key + '/' + f.path;
        listed.add(path);
        const bytes = await read(path);
        if (!bytes) addG(key, 'Datei „' + f.path + '“ der Rohkopie fehlt im Paket');
        else if (bytes.length !== f.size || await sha256Hex(bytes) !== f.sha256) addG(key, 'Prüfsumme stimmt nicht: Rohkopie „' + f.path + '“');
      }
    }
    Object.keys(zip.files).forEach((p) => {
      if (zip.files[p].dir || !(p.startsWith('guides/') || p.startsWith('_legacy-trash/'))) return;
      if (!listed.has(p)) errors.push('Datei steht nicht im Manifest: ' + p);
    });
    const cats = await read('categories.json');
    if (!cats) errors.push('categories.json fehlt im Paket');
    else if (await sha256Hex(cats) !== man.categoriesSha256) errors.push('Prüfsumme stimmt nicht: categories.json');
    const guideCount = (man.guides || []).length;
    if (man.guideCount !== guideCount) errors.push('Manifest: Anzahl der Guides stimmt nicht (' + man.guideCount + ' angegeben, ' + guideCount + ' aufgeführt)');
    if (man.assetCount !== assetCount) errors.push('Manifest: Anzahl der Assets stimmt nicht (' + man.assetCount + ' angegeben, ' + assetCount + ' aufgeführt)');

    return { hasManifest: true, ok: !errors.length && !Object.keys(guideErrors).length, errors, guideErrors, guideCount, assetCount, manifest: man };
  }

  // ── Backup-Anzeige: nur eine vollständige Sicherung setzt den Zeitpunkt ──
  // Gespeichert wird auch, welche Guides (und in welchem Zustand) in der Sicherung waren,
  // damit Löschen und Wiederherstellen als Änderung seit der Sicherung zählen.
  function recordBackup(guides) {
    try {
      const state = {};
      guides.forEach((g) => { state[g.id] = g.trashed ? 1 : 0; });
      localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: new Date().toISOString(), guides: state }));
      return true;
    } catch { return false; }
  }

  function _readBackupRecord() {
    try {
      const rec = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
      return rec && rec.at && rec.guides ? rec : null;
    } catch { return null; }
  }

  // { at, changed } – at = null: noch nie gesichert; changed = null: Stand nicht lesbar
  async function getStatus(db) {
    const rec = _readBackupRecord();
    if (!rec) return { at: null, changed: null };
    if (db.isFilesystemMode() && !db.isConnected()) return { at: rec.at, changed: null };
    db.invalidateCache();
    const lr = await db.listGuides(), tr = await db.listTrash();
    if (!lr.success || !tr.success) return { at: rec.at, changed: null };
    const at = new Date(rec.at).getTime();
    const seen = new Set();
    let changed = 0;
    (lr.guides || []).concat(tr.guides || []).forEach((g) => {
      const m = g.meta || {}, was = rec.guides[g.id];
      seen.add(g.id);
      if (was === undefined) changed++;
      else if (!!m.trashed !== (was === 1)) changed++;
      else if (m.modified && new Date(m.modified).getTime() > at) changed++;
    });
    Object.keys(rec.guides).forEach((id) => { if (!seen.has(id)) changed++; });
    return { at: rec.at, changed };
  }

  // ── Kategorienbaum zusammenführen (nach vollem Pfad: Kategorie + Unterkategorie) ──
  // Nichts Vorhandenes wird überschrieben oder entfernt; lokale Farben bleiben.
  function mergeCategories(local, incoming) {
    const key = (s) => (typeof s === 'string' ? s : s && s.name);
    const tree = (local || []).map((c) => ({ ...c, subcategories: [...(c.subcategories || [])] }));
    let added = 0, addedSubs = 0;
    (incoming || []).forEach((c) => {
      if (!c || !c.name) return;
      const ex = tree.find((x) => x.name === c.name);
      if (!ex) { tree.push({ ...c, subcategories: [...(c.subcategories || [])] }); added++; return; }
      const have = new Set(ex.subcategories.map(key));
      (c.subcategories || []).forEach((s) => { if (!have.has(key(s))) { ex.subcategories.push(s); have.add(key(s)); addedSubs++; } });
    });
    return { tree, added, addedSubs, changed: added > 0 || addedSubs > 0 };
  }

  // ── Verwaiste Assets über alle (nicht gelöschten) Guides finden – nur lesen ──
  async function scanOrphans(db) {
    db.invalidateCache();
    const lr = await db.listGuides();
    if (!lr.success) throw new Error(lr.error || 'Guides konnten nicht gelesen werden.');
    const orphans = [], skipped = [];
    for (const g of lr.guides || []) {
      const full = await db.getGuide(g.id);
      if (!full.success) { skipped.push(g.id); continue; }
      const res = await db.findOrphanedAssets(g.id, full.content || '', full.meta);
      if (!res.success) { skipped.push(g.id); continue; }
      res.orphans.forEach((o) => orphans.push({ ...o, title: (full.meta && full.meta.title) || g.id }));
    }
    return { orphans, skipped, scanned: (lr.guides || []).length };
  }

  // Hinweis, was ein Importpaket NICHT enthält (leer = vollständig)
  function describeMissing(packageKind) {
    if (packageKind === 'readable') {
      return 'Lesbares Archiv: enthält keine Tags, Favoriten, Zeitstempel, Unterkategorien, private Notizen, keinen Kategorienbaum und keine Versionsangaben. ' +
        'Titel und Kategorienamen stammen aus Dateinamen (Sonderzeichen fehlen, Leerzeichen können zu Bindestrichen geworden sein). Links und Dateien nur, soweit sie als Abschnitt im Text stehen.';
    }
    if (packageKind === 'package') {
      return 'Älteres Merge-Paket: enthält keine Links, Anhänge (Anhangsdateien nur, wenn sie im Paket liegen), privaten Notizen und Versionsangaben. ' +
        'Diese Felder bleiben nach dem Import leer.';
    }
    if (packageKind === 'share') return 'Weitergabe-Paket: enthält bewusst keine privaten Notizen und keine Papierkorb-Guides.';
    return '';
  }

  window.GuidesBackup = {
    FORMAT_VERSION, PRIVATE_NOTICE, READABLE_WARNING, BACKUP_KEY,
    plural, sha256Hex, _sha256Js,
    collect, buildPackage, verifyZip,
    recordBackup, getStatus,
    mergeCategories, scanOrphans, describeMissing,
  };
})();
