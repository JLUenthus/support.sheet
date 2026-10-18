// ============================================================
// support.sheet – quicknotes-io.js (Quicknotes: Zeichensatz, Export, ZIP-Sicherung, Import-Lesen)
// Reine Funktionen ohne Zugriff auf Datenbank oder Seite. Die ZIP-Sicherung nutzt das bereits vorhandene js/jszip.min.js.
// Interner Text hat immer LF-Zeilenenden (das Textfeld normalisiert so); Dateien werden mit CRLF geschrieben.
// ============================================================
(function () {
  const MAX_ZIP_ENTRIES = 5000;
  const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

  function normalizeNewlines(text) { return String(text).replace(/\r\n?/g, '\n'); }
  function toCrlf(text) { return normalizeNewlines(text).replace(/\n/g, '\r\n'); }
  function encodeUtf8(text) { return new TextEncoder().encode(text); }

  // Zeichensatzerkennung: BOM (UTF-8, UTF-16 LE/BE) hat Vorrang; sonst UTF-8 streng (fatal), bei Fehler Windows-1252.
  function decodeText(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    let encoding, text;
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      encoding = 'utf-16le'; text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    } else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      encoding = 'utf-16be'; text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
    } else {
      const hasBom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
        encoding = hasBom ? 'utf-8-bom' : 'utf-8';
      } catch (e) {
        text = new TextDecoder('windows-1252').decode(bytes);
        encoding = 'windows-1252';
      }
    }
    return { text: normalizeNewlines(text), encoding };
  }

  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function safeFileName(title, fallback) {
    let n = String(title == null ? '' : title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+|[. ]+$/g, '').slice(0, 80).trim();
    if (!n) n = fallback || 'Notiz';
    if (RESERVED.test(n)) n += '_';
    return n;
  }

  // Doppelte Namen (ohne Beachtung der Gross-/Kleinschreibung) bekommen den Zusatz " (2)", " (3)" …
  function uniqueName(base, ext, used) {
    let name = base + ext, i = 2;
    while (used.has(name.toLowerCase())) name = base + ' (' + i++ + ')' + ext;
    used.add(name.toLowerCase());
    return name;
  }

  function fileTitle(fileName) {
    const base = String(fileName || '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '');
    return window.QuickNotesDB ? window.QuickNotesDB.clampTitle(base) : base.slice(0, 80);
  }

  // ZIP mit einer .txt je Notiz (geloeschte im Ordner "Papierkorb") und quicknotes.json mit allen Feldern.
  async function buildBackup(notes) {
    if (typeof JSZip === 'undefined') throw new Error('jszip.min.js konnte nicht geladen werden.');
    const zip = new JSZip();
    const used = new Set(['quicknotes.json']);
    const usedTrash = new Set();
    notes.forEach((n) => {
      const trashed = !!n.trashedAt;
      const name = uniqueName(safeFileName(n.title), '.txt', trashed ? usedTrash : used);
      zip.file((trashed ? 'Papierkorb/' : '') + name, encodeUtf8(toCrlf(n.text)));
    });
    zip.file('quicknotes.json', JSON.stringify({ format: 'quicknotes-backup', version: 1, exportedAt: new Date().toISOString(), count: notes.length, notes }, null, 2));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  function validNote(n) {
    return n && typeof n === 'object' && typeof n.id === 'string' && n.id && typeof n.title === 'string' && typeof n.text === 'string';
  }

  // Liest eine Importdatei. Rueckgabe: { items: [{ title, text, source, backup? }], warnings: [] }
  // backup-Eintraege tragen die Originalfelder (id, createdAt, updatedAt, trashedAt …) fuer den verlustfreien Rueckweg.
  async function readImportFile(file) {
    const items = [], warnings = [];
    const buf = new Uint8Array(await file.arrayBuffer());
    const isZip = /\.zip$/i.test(file.name) || (buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 3 && buf[3] === 4);
    if (!isZip) {
      items.push({ title: fileTitle(file.name), text: decodeText(buf).text, source: file.name });
      return { items, warnings };
    }
    if (typeof JSZip === 'undefined') throw new Error('jszip.min.js konnte nicht geladen werden.');
    let zip;
    try { zip = await JSZip.loadAsync(buf); } catch (err) { throw new Error('„' + file.name + '“ ist keine lesbare ZIP-Datei: ' + (err && err.message)); }
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    if (entries.length > MAX_ZIP_ENTRIES) throw new Error('„' + file.name + '“ enthält zu viele Dateien (' + entries.length + ').');
    const jsonEntry = zip.file('quicknotes.json');
    if (jsonEntry) {
      let parsed;
      try { parsed = JSON.parse(decodeText(await jsonEntry.async('uint8array')).text); } catch (err) { throw new Error('quicknotes.json in „' + file.name + '“ ist nicht lesbar: ' + (err && err.message)); }
      if (!parsed || parsed.format !== 'quicknotes-backup' || !Array.isArray(parsed.notes)) throw new Error('quicknotes.json in „' + file.name + '“ hat kein bekanntes Format.');
      parsed.notes.forEach((n, i) => {
        if (validNote(n)) items.push({ title: n.title, text: normalizeNewlines(n.text), source: file.name, backup: n });
        else warnings.push('Eintrag ' + (i + 1) + ' in quicknotes.json übersprungen (unvollständig).');
      });
      return { items, warnings };
    }
    for (const entry of entries) {
      if (!/\.txt$/i.test(entry.name)) { warnings.push('„' + entry.name + '“ übersprungen (keine .txt-Datei).'); continue; }
      const bytes = await entry.async('uint8array');
      if (bytes.length > MAX_ENTRY_BYTES) { warnings.push('„' + entry.name + '“ übersprungen (zu groß).'); continue; }
      items.push({ title: fileTitle(entry.name), text: decodeText(bytes).text, source: file.name + '/' + entry.name });
    }
    return { items, warnings };
  }

  // Datei zum Herunterladen anbieten (Blob + Link). Der Link wird erst nach kurzer Zeit freigegeben.
  function download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function textBlob(text) { return new Blob([encodeUtf8(toCrlf(text))], { type: 'text/plain;charset=utf-8' }); }

  window.QuickNotesIO = {
    decodeText, toCrlf, normalizeNewlines, safeFileName, uniqueName, fileTitle, buildBackup, readImportFile, download, textBlob, validNote,
  };
})();
