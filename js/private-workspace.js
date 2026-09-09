// ===========================================================
// support.sheet – Private Workspace: State-Management
// Verwaltet den entschlüsselten Workspace ausschließlich im
// aktiven JS-Speicher. Nutzt js/private-crypto.js für alle
// kryptografischen Operationen. Kein Autosave, keine UI.
// ===========================================================
(function () {
  'use strict';

  if (!window.PrivateCrypto) {
    throw new Error('PrivateWorkspace benötigt js/private-crypto.js (muss vorher geladen werden).');
  }

  const DEFAULT_TIMEOUT_MINUTES = 30;

  const ErrorCodes = Object.freeze({
    ALREADY_OPEN: 'ALREADY_OPEN',
    NO_WORKSPACE: 'NO_WORKSPACE',
    NO_FILE_HANDLE: 'NO_FILE_HANDLE',
    NO_SESSION: 'NO_SESSION',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    ENCRYPT_FAILED: 'ENCRYPT_FAILED',
    WRITE_FAILED: 'WRITE_FAILED',
    UNSAVED_CHANGES: 'UNSAVED_CHANGES',
    INVALID_NOTE: 'INVALID_NOTE',
    NOTE_NOT_FOUND: 'NOTE_NOT_FOUND',
    INVALID_ENTRY: 'INVALID_ENTRY',
    ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
    INVALID_ENTRY_FIELD: 'INVALID_ENTRY_FIELD'
  });

  class PrivateWorkspaceError extends Error {
    constructor(code, message, cause) {
      super(message || code);
      this.name = 'PrivateWorkspaceError';
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  // ── internal state (nur im JS-Speicher, nie persistiert) ──
  let currentWorkspace = null;      // entschlüsseltes Workspace-Objekt (kontrollierte Kopie)
  let currentFileHandle = null;     // FileSystemFileHandle | null
  let cachedPassword = null;        // nur im Speicher für die Dauer der Session, siehe Bericht Punkt F/I
  let isDirtyFlag = false;

  // Generation-Zähler gegen Session-Races: jeder asynchrone Vorgang, der später
  // State committen darf (open/save/saveAs/exportEncrypted), merkt sich die zum
  // Startzeitpunkt aktuelle Generation und prüft sie nach jedem relevanten await
  // erneut. close()/Auto-Lock (clearSession()) sowie ein erfolgreiches open()
  // erhöhen die Generation - ein Vorgang aus einer alten Generation committet
  // dann nie mehr State, sondern bricht mit NO_SESSION ab.
  let sessionGeneration = 0;
  // Verhindert, dass zwei nahezu gleichzeitig gestartete open()-Aufrufe beide
  // die ALREADY_OPEN-Prüfung passieren, bevor einer von beiden currentWorkspace
  // gesetzt hat (currentWorkspace ist während des laufenden open() noch null).
  let openInProgress = false;

  let timeoutMinutes = DEFAULT_TIMEOUT_MINUTES;
  let timeoutHandle = null;

  const session = {
    active: false,
    lastActivity: null,
    lastSaved: null
  };

  // ── Hilfsfunktionen ─────────────────────────────────────

  function deepClone(obj) {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
  }

  function isFileSystemFileHandle(x) {
    return !!x && typeof x.getFile === 'function' && typeof x.createWritable === 'function';
  }

  // Ein von einem asynchronen Vorgang zu Beginn erfasstes `generation` ist nur
  // dann noch gültig, wenn seither weder close() noch Auto-Lock noch ein neuer
  // open() gelaufen ist (beide erhöhen sessionGeneration) UND ein Workspace
  // überhaupt noch geöffnet ist.
  function sessionIsCurrent(generation) {
    return generation === sessionGeneration && currentWorkspace !== null;
  }

  // ── Notiz-Hilfsfunktionen ────────────────────────────────

  function generateNoteId() {
    const existingIds = new Set(currentWorkspace.sections.notes.map(n => n.id));
    let id;
    do {
      id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        // Fallback für Umgebungen ohne crypto.randomUUID() (in der Praxis nicht zu
        // erwarten, da dieselben Browser auch die File System Access API tragen).
        : 'note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    } while (existingIds.has(id));
    return id;
  }

  function assertPlainObject(value, paramName) {
    if (value === undefined) return {};
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(paramName + ' muss ein Objekt sein.');
    }
    return value;
  }

  // Validiert nur die Felder, die im übergebenen Objekt tatsächlich vorhanden
  // sind - addNote()/updateNote() entscheiden selbst, welche Felder Pflicht
  // sind bzw. welche Felder gar nicht gesetzt werden dürfen (id/created/modified).
  function validateNoteFields(fields) {
    if ('title' in fields && typeof fields.title !== 'string') {
      throw new PrivateWorkspaceError(ErrorCodes.INVALID_NOTE, 'title muss ein String sein.');
    }
    if ('content' in fields && typeof fields.content !== 'string') {
      throw new PrivateWorkspaceError(ErrorCodes.INVALID_NOTE, 'content muss ein String sein.');
    }
    if ('tags' in fields) {
      if (!Array.isArray(fields.tags)) {
        throw new PrivateWorkspaceError(ErrorCodes.INVALID_NOTE, 'tags muss ein Array sein.');
      }
      if (!fields.tags.every(t => typeof t === 'string')) {
        throw new PrivateWorkspaceError(ErrorCodes.INVALID_NOTE, 'tags darf ausschließlich Strings enthalten.');
      }
    }
  }

  function assertNoServerFields(fields, disallowed, code) {
    for (const key of disallowed) {
      if (key in fields) {
        throw new PrivateWorkspaceError(code || ErrorCodes.INVALID_NOTE, `${key} wird automatisch verwaltet und darf nicht übergeben werden.`);
      }
    }
  }

  function findNoteIndex(id) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('id muss ein nicht-leerer String sein.');
    }
    return currentWorkspace.sections.notes.findIndex(n => n.id === id);
  }

  // ── Entry-Hilfsfunktionen (Phase 7) ─────────────────────
  //
  // Struktureller Zwilling der Notiz-Hilfsfunktionen oben - bewusst separat
  // gehalten statt generalisiert, weil Notes/Entries unterschiedliche Felder
  // validieren und eine gemeinsame Abstraktion hier mehr Komplexität als
  // Nutzen bringen würde.

  function generateEntryId() {
    const existingIds = new Set(currentWorkspace.sections.entries.map(e => e.id));
    let id;
    do {
      id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'entry-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    } while (existingIds.has(id));
    return id;
  }

  function generateFieldId(existingIds) {
    let id;
    do {
      id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'field-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    } while (existingIds.has(id));
    return id;
  }

  // Validiert die Struktur eines rohen fields-Arrays (Aufrufer-Eingabe, vor
  // der Normalisierung). id wird serverseitig vergeben und darf hier nicht
  // vom Aufrufer kommen - genau wie id/created/modified auf Entry-Ebene.
  function validateEntryFieldsArray(fieldsArr) {
    if (!Array.isArray(fieldsArr)) {
      throw new PrivateWorkspaceError(ErrorCodes.INVALID_ENTRY, 'fields muss ein Array sein.');
    }
    fieldsArr.forEach(f => {
      if (f === null || typeof f !== 'object' || Array.isArray(f)) {
        throw new PrivateWorkspaceError(ErrorCodes.INVALID_ENTRY_FIELD, 'Jedes Field muss ein Objekt sein.');
      }
      if ('id' in f) {
        throw new PrivateWorkspaceError(ErrorCodes.INVALID_ENTRY_FIELD, 'id wird automatisch verwaltet und darf nicht übergeben werden.');
      }
      if ('label' in f && typeof f.label !== 'string') {
        throw new PrivateWorkspaceError(ErrorCodes.INVALID_ENTRY_FIELD, 'label muss ein String sein.');
      }
      if ('value' in f && typeof f.value !== 'string') {
        throw new PrivateWorkspaceError(ErrorCodes.INVALID_ENTRY_FIELD, 'value muss ein String sein.');
      }
    });
  }

  // Baut aus einem bereits validierten fields-Array die tatsächlich
  // gespeicherte Form mit serverseitig vergebenen IDs.
  function normalizeEntryFields(fieldsArr) {
    const usedIds = new Set();
    return fieldsArr.map(f => {
      const id = generateFieldId(usedIds);
      usedIds.add(id);
      return {
        id,
        label: typeof f.label === 'string' ? f.label : '',
        value: typeof f.value === 'string' ? f.value : ''
      };
    });
  }

  // Validiert nur die Felder, die im übergebenen Objekt tatsächlich vorhanden
  // sind - addEntry()/updateEntry() entscheiden selbst über Defaults.
  function validateEntryTopFields(fields) {
    if ('title' in fields && typeof fields.title !== 'string') {
      throw new PrivateWorkspaceError(ErrorCodes.INVALID_ENTRY, 'title muss ein String sein.');
    }
    if ('category' in fields && typeof fields.category !== 'string') {
      throw new PrivateWorkspaceError(ErrorCodes.INVALID_ENTRY, 'category muss ein String sein.');
    }
    if ('description' in fields && typeof fields.description !== 'string') {
      throw new PrivateWorkspaceError(ErrorCodes.INVALID_ENTRY, 'description muss ein String sein.');
    }
    if ('tags' in fields) {
      if (!Array.isArray(fields.tags)) {
        throw new PrivateWorkspaceError(ErrorCodes.INVALID_ENTRY, 'tags muss ein Array sein.');
      }
      if (!fields.tags.every(t => typeof t === 'string')) {
        throw new PrivateWorkspaceError(ErrorCodes.INVALID_ENTRY, 'tags darf ausschließlich Strings enthalten.');
      }
    }
    if ('fields' in fields) {
      validateEntryFieldsArray(fields.fields);
    }
  }

  function findEntryIndex(id) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('id muss ein nicht-leerer String sein.');
    }
    return currentWorkspace.sections.entries.findIndex(e => e.id === id);
  }

  async function readBytes(file) {
    if (file instanceof Uint8Array) return file;
    if (file instanceof ArrayBuffer) return new Uint8Array(file);
    if (isFileSystemFileHandle(file)) {
      const blob = await file.getFile();
      return new Uint8Array(await blob.arrayBuffer());
    }
    if (typeof file.arrayBuffer === 'function') {
      return new Uint8Array(await file.arrayBuffer());
    }
    throw new TypeError('file muss File, Blob, FileSystemFileHandle, ArrayBuffer oder Uint8Array sein.');
  }

  function stopSessionTimer() {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  function startSessionTimer() {
    stopSessionTimer();
    if (!(timeoutMinutes > 0)) return; // 0/negativ deaktiviert den Timer bewusst (Test-/Sonderfall)
    timeoutHandle = setTimeout(handleSessionTimeout, timeoutMinutes * 60 * 1000);
  }

  function handleSessionTimeout() {
    // Ungespeicherte Änderungen gehen beim automatischen Sperren verloren – Absicht, keine Autosave-Rettung.
    clearSession();
  }

  // ── Permission-Handling (File System Access API) ───────

  async function ensureWritePermission(fileHandle) {
    if (typeof fileHandle.queryPermission !== 'function') return; // Handle-Typ ohne Permission-Modell (z.B. manche OPFS-Implementierungen)
    const opts = { mode: 'readwrite' };
    let status = await fileHandle.queryPermission(opts);
    if (status === 'granted') return;
    if (typeof fileHandle.requestPermission === 'function') {
      status = await fileHandle.requestPermission(opts);
    }
    if (status !== 'granted') {
      throw new PrivateWorkspaceError(ErrorCodes.PERMISSION_DENIED, 'Schreibrechte für die Datei wurden verweigert.');
    }
  }

  // ── "Atomisches" Schreiben ───────────────────────────────
  //
  // Technische Realität der File System Access API (Stand: Chromium, 2026):
  // createWritable() schreibt laut Spezifikation zunächst gegen einen
  // browser-internen Stream/Swap-Mechanismus; die Zieldatei wird erst beim
  // abschließenden close() ersetzt. Bricht der Vorgang vorher ab (Fehler,
  // abort(), Tab-Crash), bleibt die Originaldatei unverändert. Das ist die
  // stärkste Atomaritätsgarantie, die die stabile Web-Plattform-API aktuell
  // hergibt – es handelt sich um ein Implementierungsdetail des Browsers,
  // nicht um eine von uns selbst gebaute Garantie.
  //
  // Ein manuelles "eigene Temp-Datei im selben Verzeichnis schreiben, dann
  // Original ersetzen" wurde bewusst NICHT implementiert, weil die stabile
  // API dafür zwei Voraussetzungen nicht erfüllt:
  //   1. Ein FileSystemFileHandle kann sein übergeordnetes
  //      FileSystemDirectoryHandle nicht ermitteln (keine getParent()-Methode).
  //   2. FileSystemDirectoryHandle bietet keine standardisierte, in allen
  //      Browsern verfügbare rename()/move()-Operation.
  // Ein selbstgebautes "Temp schreiben → Original löschen → Temp umbenennen"
  // wäre zwischen den Schritten NICHT atomar und hätte damit genau das
  // Risiko erzeugt, das vermieden werden soll. Siehe Bericht Punkt G.
  async function writeAtomically(fileHandle, bytes) {
    await ensureWritePermission(fileHandle);
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(bytes);
      await writable.close();
    } catch (err) {
      try { await writable.abort(); } catch (_) { /* best effort */ }
      throw err;
    }
  }

  // ── Öffentliche API ─────────────────────────────────────

  async function open(file, password) {
    if (typeof password !== 'string' || password.length === 0) {
      throw new TypeError('password muss ein nicht-leerer String sein.');
    }
    if (!file) {
      throw new TypeError('file darf nicht leer sein.');
    }
    if (currentWorkspace !== null || openInProgress) {
      throw new PrivateWorkspaceError(ErrorCodes.ALREADY_OPEN, 'Es ist bereits ein Workspace geöffnet. Bitte zuerst schließen.');
    }

    // Ab hier synchron gesetzt (vor dem ersten await): ein zweiter, nahezu
    // gleichzeitig gestarteter open()-Aufruf sieht openInProgress bereits als
    // true und bricht sofort mit ALREADY_OPEN ab, statt am Ende um den State
    // zu konkurrieren.
    openInProgress = true;
    try {
      const fileHandle = isFileSystemFileHandle(file) ? file : null;
      const bytes = await readBytes(file);

      // Wirft bei falschem Passwort / ungültigem Format (PrivateCrypto.ErrorCodes.*).
      // Es wird an dieser Stelle noch NICHTS am internen State verändert.
      const workspace = await PrivateCrypto.openWorkspace(bytes, password);

      // Backward Compatibility (Phase 7): ältere Workspaces ohne
      // sections.entries bekommen beim Öffnen nur in-memory ein leeres Array -
      // kein Datei-Rewrite, kein ungefragtes Format-Upgrade. Erst ein
      // expliziter save() würde das Feld tatsächlich auf Disk schreiben.
      if (!Array.isArray(workspace.sections.entries)) {
        workspace.sections.entries = [];
      }

      // Erst nach erfolgreicher Entschlüsselung: State übernehmen (kontrollierte Kopie).
      currentWorkspace = deepClone(workspace);
      currentFileHandle = fileHandle;
      cachedPassword = password;
      isDirtyFlag = false;
      sessionGeneration++;

      session.active = true;
      session.lastActivity = new Date().toISOString();
      session.lastSaved = null;
      startSessionTimer();

      return getState();
    } finally {
      openInProgress = false;
    }
  }

  async function performSave(fileHandle) {
    const generation = sessionGeneration;
    touchActivity();

    const toSave = deepClone(currentWorkspace);
    toSave.modified = new Date().toISOString();

    let encryptedBytes;
    try {
      // Jeder Save-Aufruf erzeugt über PrivateCrypto.encrypt() ein neues Salt + IV.
      encryptedBytes = await PrivateCrypto.encrypt(toSave, cachedPassword);
    } catch (err) {
      if (sessionIsCurrent(generation)) isDirtyFlag = true;
      throw new PrivateWorkspaceError(ErrorCodes.ENCRYPT_FAILED, 'Verschlüsselung beim Speichern fehlgeschlagen.', err);
    }

    // Session-Race-Guard: close()/Auto-Lock kann während der (langsamen)
    // Verschlüsselung oben gelaufen sein. Ein Save aus einer bereits
    // ungültigen Generation darf keinen State mehr committen.
    if (!sessionIsCurrent(generation)) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_SESSION, 'Die Session wurde beendet, während der Speichervorgang lief. Änderungen wurden nicht übernommen.');
    }

    try {
      await writeAtomically(fileHandle, encryptedBytes);
    } catch (err) {
      if (sessionIsCurrent(generation)) isDirtyFlag = true;
      if (err instanceof PrivateWorkspaceError) throw err;
      throw new PrivateWorkspaceError(ErrorCodes.WRITE_FAILED, 'Speichern der Datei ist fehlgeschlagen.', err);
    }

    // Derselbe Race-Guard erneut nach dem (ebenfalls langsamen) Schreibvorgang.
    if (!sessionIsCurrent(generation)) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_SESSION, 'Die Session wurde beendet, während der Speichervorgang lief. Änderungen wurden nicht übernommen.');
    }

    // Erst nach bestätigtem Schreiberfolg UND weiterhin gültiger Session gilt der Save als erfolgreich.
    currentWorkspace = toSave;
    isDirtyFlag = false;
    session.lastSaved = new Date().toISOString();
  }

  async function save() {
    if (!currentWorkspace) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_WORKSPACE, 'Kein Workspace geöffnet.');
    }
    if (!currentFileHandle) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_FILE_HANDLE, 'Kein beschreibbarer Datei-Handle vorhanden. Bitte "Speichern unter" verwenden.');
    }
    await performSave(currentFileHandle);
  }

  async function saveAs(fileHandle) {
    if (!currentWorkspace) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_WORKSPACE, 'Kein Workspace geöffnet.');
    }
    if (!isFileSystemFileHandle(fileHandle)) {
      throw new TypeError('fileHandle muss ein FileSystemFileHandle mit createWritable() sein.');
    }
    await performSave(fileHandle);
    // performSave() wirft NO_SESSION, falls die Session während des Speicherns
    // ungültig wurde - diese Zeile läuft also nur bei weiterhin gültiger Session.
    currentFileHandle = fileHandle; // erst nach Erfolg übernehmen
  }

  // Export/Serialisierung für Aufrufer ohne beschreibbaren FileSystemFileHandle
  // (Browser-Fallback). Bewusst KEIN "normaler Save": es gibt keine Bestätigung,
  // dass die zurückgegebenen Bytes tatsächlich irgendwo dauerhaft ankommen (der
  // Aufrufer könnte sie z.B. nur anzeigen oder verwerfen) - deshalb bleibt
  // dirty hier unangetastet und session.lastSaved (Bedeutung: "zuletzt
  // erfolgreich auf den verknüpften FileHandle geschrieben") wird nicht gesetzt.
  // Ein Aufrufer, der die Bytes tatsächlich persistiert (z.B. per Download),
  // kann anschließend explizit markClean() aufrufen.
  async function exportEncrypted() {
    if (!currentWorkspace) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_WORKSPACE, 'Kein Workspace geöffnet.');
    }
    if (!cachedPassword) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_SESSION, 'Keine aktive Session mit Passwort vorhanden.');
    }
    const generation = sessionGeneration;
    touchActivity();

    const toExport = deepClone(currentWorkspace);
    toExport.modified = new Date().toISOString();

    let encryptedBytes;
    try {
      // Wie bei jedem Save erzeugt PrivateCrypto.encrypt() ein neues Salt + IV.
      encryptedBytes = await PrivateCrypto.encrypt(toExport, cachedPassword);
    } catch (err) {
      throw new PrivateWorkspaceError(ErrorCodes.ENCRYPT_FAILED, 'Verschlüsselung beim Export fehlgeschlagen.', err);
    }

    // Session-Race-Guard: close()/Auto-Lock kann während der (langsamen)
    // Verschlüsselung oben gelaufen sein. Ein Export aus einer bereits
    // ungültigen Generation darf keinen State mehr committen und liefert
    // auch keine Bytes zurück.
    if (!sessionIsCurrent(generation)) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_SESSION, 'Die Session wurde beendet, während der Export lief. Die exportierten Daten wurden verworfen.');
    }

    // Erst nach Erfolg und bei weiterhin gültiger Session: internen modified-Wert
    // übernehmen, damit exportierte Datei und interner State denselben
    // Zeitstempel tragen. Dirty-State bleibt bewusst unverändert (siehe Kommentar oben).
    currentWorkspace = toExport;
    return encryptedBytes;
  }

  // ── Notiz-API (Phase 4A: nur Datenmodell/Mutatoren, keine UI) ──
  //
  // title/content/tags sind beim Erstellen optional (Default: '' / '' / []) -
  // eine "Neue Notiz"-Aktion kann so sofort eine leere Notiz anlegen, die
  // danach per updateNote() befüllt wird. Sind sie angegeben, wird ihr Typ
  // strikt geprüft. Es gibt bewusst keine Zeichen-/Längenlimits, da nichts
  // in der Aufgabenstellung einen konkreten Grund dafür liefert (siehe
  // Abschlussbericht).

  function addNote(noteData) {
    if (!currentWorkspace) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_WORKSPACE, 'Kein Workspace geöffnet.');
    }
    const data = assertPlainObject(noteData, 'noteData');
    assertNoServerFields(data, ['id', 'created', 'modified']);
    validateNoteFields(data);

    const now = new Date().toISOString();
    const note = {
      id: generateNoteId(),
      title: typeof data.title === 'string' ? data.title : '',
      content: typeof data.content === 'string' ? data.content : '',
      tags: Array.isArray(data.tags) ? data.tags.slice() : [],
      created: now,
      modified: now
    };

    currentWorkspace.sections.notes.push(note);
    markDirty();
    return deepClone(note);
  }

  function updateNote(id, changes) {
    if (!currentWorkspace) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_WORKSPACE, 'Kein Workspace geöffnet.');
    }
    const data = assertPlainObject(changes, 'changes');
    assertNoServerFields(data, ['id', 'created', 'modified']);
    validateNoteFields(data);

    const idx = findNoteIndex(id);
    if (idx === -1) {
      throw new PrivateWorkspaceError(ErrorCodes.NOTE_NOT_FOUND, 'Notiz mit dieser ID wurde nicht gefunden.');
    }

    const note = currentWorkspace.sections.notes[idx];
    if ('title' in data) note.title = data.title;
    if ('content' in data) note.content = data.content;
    if ('tags' in data) note.tags = data.tags.slice();
    note.modified = new Date().toISOString();

    markDirty();
    return deepClone(note);
  }

  function deleteNote(id) {
    if (!currentWorkspace) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_WORKSPACE, 'Kein Workspace geöffnet.');
    }
    const idx = findNoteIndex(id);
    if (idx === -1) {
      throw new PrivateWorkspaceError(ErrorCodes.NOTE_NOT_FOUND, 'Notiz mit dieser ID wurde nicht gefunden.');
    }
    currentWorkspace.sections.notes.splice(idx, 1);
    markDirty();
  }

  function getNotes() {
    if (!currentWorkspace) return [];
    return deepClone(currentWorkspace.sections.notes);
  }

  function getNote(id) {
    if (!currentWorkspace) return null;
    if (typeof id !== 'string' || id.length === 0) return null;
    const note = currentWorkspace.sections.notes.find(n => n.id === id);
    return note ? deepClone(note) : null;
  }

  // ── Entry-API (Phase 7: strukturierte Einträge, kein Passwortmanager) ──
  //
  // title/category/description sind beim Erstellen optional (Default: '') -
  // tags/fields optional (Default: []). Es gibt bewusst keine spezielle
  // Credential-Logik (Passwörter, MFA-Codes, API-Secrets, ...) und keine
  // zusätzliche Feld-Verschlüsselung über die Workspace-Verschlüsselung
  // hinaus - siehe Abschlussbericht.

  function addEntry(entryData) {
    if (!currentWorkspace) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_WORKSPACE, 'Kein Workspace geöffnet.');
    }
    const data = assertPlainObject(entryData, 'entryData');
    assertNoServerFields(data, ['id', 'created', 'modified'], ErrorCodes.INVALID_ENTRY);
    validateEntryTopFields(data);

    const now = new Date().toISOString();
    const entry = {
      id: generateEntryId(),
      title: typeof data.title === 'string' ? data.title : '',
      category: typeof data.category === 'string' ? data.category : '',
      description: typeof data.description === 'string' ? data.description : '',
      tags: Array.isArray(data.tags) ? data.tags.slice() : [],
      fields: Array.isArray(data.fields) ? normalizeEntryFields(data.fields) : [],
      created: now,
      modified: now
    };

    currentWorkspace.sections.entries.push(entry);
    markDirty();
    return deepClone(entry);
  }

  function updateEntry(id, changes) {
    if (!currentWorkspace) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_WORKSPACE, 'Kein Workspace geöffnet.');
    }
    const data = assertPlainObject(changes, 'changes');
    assertNoServerFields(data, ['id', 'created', 'modified'], ErrorCodes.INVALID_ENTRY);
    validateEntryTopFields(data);

    const idx = findEntryIndex(id);
    if (idx === -1) {
      throw new PrivateWorkspaceError(ErrorCodes.ENTRY_NOT_FOUND, 'Eintrag mit dieser ID wurde nicht gefunden.');
    }

    const entry = currentWorkspace.sections.entries[idx];
    if ('title' in data) entry.title = data.title;
    if ('category' in data) entry.category = data.category;
    if ('description' in data) entry.description = data.description;
    if ('tags' in data) entry.tags = data.tags.slice();
    if ('fields' in data) entry.fields = normalizeEntryFields(data.fields);
    entry.modified = new Date().toISOString();

    markDirty();
    return deepClone(entry);
  }

  function deleteEntry(id) {
    if (!currentWorkspace) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_WORKSPACE, 'Kein Workspace geöffnet.');
    }
    const idx = findEntryIndex(id);
    if (idx === -1) {
      throw new PrivateWorkspaceError(ErrorCodes.ENTRY_NOT_FOUND, 'Eintrag mit dieser ID wurde nicht gefunden.');
    }
    currentWorkspace.sections.entries.splice(idx, 1);
    markDirty();
  }

  function getEntries() {
    if (!currentWorkspace) return [];
    return deepClone(currentWorkspace.sections.entries);
  }

  function getEntry(id) {
    if (!currentWorkspace) return null;
    if (typeof id !== 'string' || id.length === 0) return null;
    const entry = currentWorkspace.sections.entries.find(e => e.id === id);
    return entry ? deepClone(entry) : null;
  }

  function close(options) {
    const discard = !!(options && options.discard);

    if (!currentWorkspace) {
      clearSession();
      return { closed: true, discarded: false };
    }

    if (isDirtyFlag && !discard) {
      throw new PrivateWorkspaceError(ErrorCodes.UNSAVED_CHANGES, 'Workspace hat ungespeicherte Änderungen. Bitte speichern oder Verwerfen bestätigen.');
    }

    const wasDirty = isDirtyFlag;
    clearSession();
    return { closed: true, discarded: discard && wasDirty };
  }

  function isDirty() {
    return isDirtyFlag;
  }

  function markDirty() {
    if (!currentWorkspace) {
      throw new PrivateWorkspaceError(ErrorCodes.NO_WORKSPACE, 'Kein Workspace geöffnet.');
    }
    isDirtyFlag = true;
    touchActivity();
  }

  function markClean() {
    isDirtyFlag = false;
  }

  function hasWorkspace() {
    return currentWorkspace !== null;
  }

  function getFileHandle() {
    return currentFileHandle;
  }

  function getState() {
    return currentWorkspace ? deepClone(currentWorkspace) : null;
  }

  function getSession() {
    return {
      active: session.active,
      hasWorkspace: currentWorkspace !== null,
      dirty: isDirtyFlag,
      lastActivity: session.lastActivity,
      lastSaved: session.lastSaved,
      timeoutMinutes: timeoutMinutes,
      hasFileHandle: currentFileHandle !== null
    };
  }

  function clearSession() {
    currentWorkspace = null;
    currentFileHandle = null;
    cachedPassword = null;
    isDirtyFlag = false;
    stopSessionTimer();
    session.active = false;
    session.lastActivity = null;
    session.lastSaved = null;
    // Invalidiert jeden noch laufenden save()/saveAs()/exportEncrypted(), der
    // seine Generation vor diesem clearSession() erfasst hat (siehe K1).
    sessionGeneration++;
  }

  function touchActivity() {
    if (!session.active) return;
    session.lastActivity = new Date().toISOString();
    startSessionTimer();
  }

  function setSessionTimeout(minutes) {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) {
      throw new TypeError('minutes muss eine nicht-negative Zahl sein.');
    }
    timeoutMinutes = minutes;
    if (session.active) startSessionTimer();
  }

  window.PrivateWorkspace = Object.freeze({
    open,
    save,
    saveAs,
    exportEncrypted,
    close,
    isDirty,
    getSession,
    clearSession,
    getState,
    markDirty,
    markClean,
    getFileHandle,
    hasWorkspace,
    touchActivity,
    setSessionTimeout,
    addNote,
    updateNote,
    deleteNote,
    getNotes,
    getNote,
    addEntry,
    updateEntry,
    deleteEntry,
    getEntries,
    getEntry,
    ErrorCodes
  });
})();
