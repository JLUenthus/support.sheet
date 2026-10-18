// ============================================================
// guide.sheet – guides-drafts.js (Entwürfe des Editors in localStorage)
// Ein Entwurf je Guide: Schlüssel "gs-draft:<guideId>"; neue Guides: "gs-draft:new:<uuid>".
// Text und Formularfelder stehen im Hauptschlüssel (klein, wird zuerst geschrieben):
//   { v:2, key, guideId|null, baseVersion|null, savedAt, title, category, subcategory, tags, content,
//     privateNote, links, attachments, pendingAttachmentNames, pendingRenames, imageNames, imagesMissing }
// Noch nicht gespeicherte Bilder liegen GETRENNT unter "gs-draft-img:<id>:<Index>" ({ v, name, dataUrl }),
// jedes mit Größenprüfung: passt ein Bild nicht in den Speicher, ist trotzdem der Text gesichert, und
// write() meldet die fehlenden Bilder. (Früher lagen die Bilder als Base64 im Hauptschlüssel; ein einziger
// großer Screenshot ließ dann auch den Text scheitern. Der alte Aufbau wird beim Lesen weiter verstanden und
// beim nächsten Schreiben in das neue Schema überführt.)
// Der alte Sammel-Schlüssel "gs-drafts" bleibt lesbar: beim ersten Zugriff werden seine Einträge in das neue
// Schema übernommen (jeder als "gs-draft:new:<alte id>"), der alte Schlüssel erst gelöscht, wenn alle Einträge
// samt Bildern geschrieben UND zurückgelesen sind. Misslingt das (Speicher voll), bleibt der alte Schlüssel
// unangetastet und seine Einträge werden weiter angeboten – nichts geht verloren.
// Nutzt ausschließlich localStorage. Ohne DOM, ohne GuidesDB.
// ============================================================
(function () {
  'use strict';

  const PREFIX     = 'gs-draft:';
  const NEW_PREFIX = 'gs-draft:new:';
  const IMG_PREFIX = 'gs-draft-img:';
  const OLD_KEY    = 'gs-drafts';
  const IMAGE_MAX_CHARS = 2500000; // ein einzelnes Bild (Base64) darf höchstens so groß sein; das Quota gilt für alle Einträge zusammen

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function keyFor(guideId, newId) { return guideId ? PREFIX + guideId : NEW_PREFIX + (newId || uuid()); }
  function newKey() { return NEW_PREFIX + uuid(); }

  function _imgBase(key) { return IMG_PREFIX + key.slice(PREFIX.length) + ':'; }

  function _keysWithPrefix(prefix) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  }

  function _putVerified(key, text) {
    localStorage.setItem(key, text);
    if (localStorage.getItem(key) !== text) throw new Error('Der Entwurf wurde nicht gespeichert.');
  }

  // Schreibt synchron und liest zurück. Wirft, wenn Text/Felder nicht gesichert werden konnten (auch
  // QuotaExceededError). Passen einzelne Bilder nicht, wird NICHT geworfen: Rückgabe { missing: [Bildnamen] }.
  // draft.assets: { name: dataUrl } (noch nicht gespeicherte Bilder)
  function write(draft) {
    if (!draft || !draft.key) throw new Error('Entwurf ohne Schlüssel.');
    const assets = draft.assets && typeof draft.assets === 'object' ? draft.assets : {};
    const names = Object.keys(assets);
    const main = Object.assign({ v: 2 }, draft, { imageNames: names, imagesMissing: [] });
    delete main.assets;
    _putVerified(draft.key, JSON.stringify(main)); // 1. Text und Felder zuerst (klein)

    // 2. Bilder einzeln, jedes mit eigener Größenprüfung
    const base = _imgBase(draft.key), keep = new Set(), missing = [];
    names.forEach((name, i) => {
      const k = base + i;
      const entry = JSON.stringify({ v: 1, name, dataUrl: assets[name] });
      try {
        if (localStorage.getItem(k) === entry) { keep.add(k); return; } // unverändert, nicht neu schreiben
        if (entry.length > IMAGE_MAX_CHARS) throw new Error('zu groß');
        try { localStorage.removeItem(k); } catch { /* weiter */ }       // alten Inhalt frei machen
        _putVerified(k, entry);
        keep.add(k);
      } catch {
        missing.push(name);
        try { localStorage.removeItem(k); } catch { /* weiter */ }
      }
    });
    _keysWithPrefix(base).forEach((k) => { if (!keep.has(k)) { try { localStorage.removeItem(k); } catch { /* weiter */ } } });
    if (missing.length) {
      try { _putVerified(draft.key, JSON.stringify(Object.assign({}, main, { imagesMissing: missing }))); } catch { /* Leser berechnet fehlende Bilder selbst */ }
    }
    return { missing };
  }

  function read(key) {
    try {
      const d = JSON.parse(localStorage.getItem(key));
      return d && typeof d === 'object' ? d : null;
    } catch { return null; }
  }

  // Bilder eines Entwurfs: { assets: { name: dataUrl }, missing: [Namen] }. Versteht beide Schemata.
  function imagesOf(d) {
    if (!d) return { assets: {}, missing: [] };
    if (!Array.isArray(d.imageNames)) return { assets: Object.assign({}, d.assets || {}), missing: [] }; // alter Aufbau: Bilder im Hauptschlüssel
    const found = {};
    if (d.key) {
      _keysWithPrefix(_imgBase(d.key)).forEach((k) => {
        try {
          const e = JSON.parse(localStorage.getItem(k));
          if (e && typeof e.name === 'string' && typeof e.dataUrl === 'string' && d.imageNames.includes(e.name)) found[e.name] = e.dataUrl;
        } catch { /* unlesbarer Eintrag zählt als fehlend */ }
      });
    }
    return { assets: found, missing: d.imageNames.filter((n) => !(n in found)) };
  }

  function _legacyEntries() {
    let arr = null;
    try { arr = JSON.parse(localStorage.getItem(OLD_KEY)); } catch { /* unlesbar: unangetastet lassen */ }
    return Array.isArray(arr) ? arr : null;
  }

  function _fromLegacy(o) {
    return {
      v: 2, key: NEW_PREFIX + (String(o.id || '') || uuid()), guideId: null, baseVersion: null,
      savedAt: o.savedAt || new Date().toISOString(),
      title: o.title || '', category: o.category || '', subcategory: o.subcategory || '',
      tags: Array.isArray(o.tags) ? o.tags : [], content: o.content || '', privateNote: o.privateNote || '',
      links: Array.isArray(o.links) ? o.links : [], attachments: [], pendingAttachmentNames: [], pendingRenames: [],
      assets: o.assets && typeof o.assets === 'object' ? o.assets : {},
    };
  }

  // Übernimmt den alten Schlüssel. Idempotent; löscht ihn erst nach erfolgreicher Übernahme aller Einträge
  // (Text UND Bilder). Passt ein Eintrag nicht vollständig, wird er zurückgenommen und der alte Schlüssel bleibt.
  function migrate() {
    if (localStorage.getItem(OLD_KEY) === null) return { migrated: 0, pending: 0 };
    const arr = _legacyEntries();
    if (!arr) return { migrated: 0, pending: 0, unreadable: true };
    let migrated = 0, ok = true;
    for (const o of arr) {
      if (!o || typeof o !== 'object') continue;
      const d = _fromLegacy(o);
      if (localStorage.getItem(d.key) !== null) continue; // schon übernommen
      try {
        const r = write(d);
        if (r.missing.length) throw new Error('Bilder passen nicht');
        migrated++;
      } catch { remove(d.key); ok = false; break; }
    }
    if (ok) { try { localStorage.removeItem(OLD_KEY); } catch { ok = false; } }
    return { migrated, pending: ok ? 0 : arr.length };
  }

  // Alle Entwürfe (nach der Migration), neueste zuerst. Nicht übernommene Alt-Einträge bleiben im Ergebnis.
  function listAll() {
    migrate();
    const out = [], seen = new Set();
    _keysWithPrefix(PREFIX).forEach((k) => {
      const d = read(k);
      if (d) { d.key = k; out.push(d); seen.add(k); }
    });
    const arr = localStorage.getItem(OLD_KEY) !== null ? _legacyEntries() : null;
    (arr || []).forEach((o) => { if (o && typeof o === 'object') { const d = _fromLegacy(o); if (!seen.has(d.key)) { d.legacyUnmigrated = true; out.push(d); } } });
    return out.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  }

  function listNew() { return listAll().filter((d) => !d.guideId); }

  // Entwurf genau dieses Guides (nie der eines anderen)
  function forGuide(guideId) {
    if (!guideId) return null;
    migrate();
    const d = read(PREFIX + guideId);
    if (!d || d.guideId !== guideId) return null;
    d.key = PREFIX + guideId;
    return d;
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch { /* nichts zu tun */ }
    if (key && key.startsWith(PREFIX)) _keysWithPrefix(_imgBase(key)).forEach((k) => { try { localStorage.removeItem(k); } catch { /* weiter */ } });
    // nicht übernommener Alt-Eintrag: aus dem alten Schlüssel nehmen
    if (key && key.startsWith(NEW_PREFIX) && localStorage.getItem(OLD_KEY) !== null) {
      const arr = _legacyEntries();
      if (arr) {
        const rest = arr.filter((o) => !(o && NEW_PREFIX + String(o.id || '') === key));
        try { if (rest.length) localStorage.setItem(OLD_KEY, JSON.stringify(rest)); else localStorage.removeItem(OLD_KEY); } catch { /* bleibt */ }
      }
    }
  }

  // Vergleichsform (Eingaben, die das Speichern ohnehin normalisiert, werden ebenso normalisiert)
  function normalize(s) {
    const links = (s.links || []).filter((l) => l && l.url && String(l.url).trim())
      .map((l) => ({ id: l.id || '', text: String(l.text || '').trim(), url: String(l.url).trim(), offlineAsset: l.offlineAsset || null }));
    return {
      title: String(s.title || '').trim(), category: s.category || '', subcategory: String(s.subcategory || '').trim(),
      tags: (s.tags || []).slice(), content: s.content || '', privateNote: String(s.privateNote || '').trim(),
      links, attachments: (s.attachments || []).map((a) => a.assetFile || a.name || '').sort(),
      pendingImages: (s.pendingImages || []).slice().sort(), pendingFiles: (s.pendingFiles || []).slice().sort(),
      renames: (s.renames || []).slice().sort(),
    };
  }
  function signature(s) { return JSON.stringify(normalize(s)); }

  // Unterscheidet sich ein Entwurf vom gespeicherten Stand (Formularzustand beim Laden)?
  function sameAsSaved(draft, saved) {
    const d = Object.assign({}, draft, {
      pendingImages: Array.isArray(draft.imageNames) ? draft.imageNames : Object.keys(draft.assets || {}),
      pendingFiles: draft.pendingAttachmentNames || [],
      renames: (draft.pendingRenames || []).map((r) => r.from + '>' + r.to),
    });
    return signature(d) === signature(saved);
  }

  window.GuidesDrafts = { PREFIX, NEW_PREFIX, IMG_PREFIX, OLD_KEY, uuid, keyFor, newKey, write, read, remove, migrate, listAll, listNew, forGuide, imagesOf, signature, sameAsSaved };
})();
