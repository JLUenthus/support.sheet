// ===========================================================
// support.sheet – Private Workspace: Renderer
// UI-Schicht über PrivateCrypto/PrivateWorkspace: Workspace-
// Lifecycle (Öffnen/Erstellen/Speichern/Schließen/Auto-Lock)
// sowie Notizliste, Suche und Notiz-Editor. Enthält selbst
// keine Kryptografie und keine zweite Datenhaltung – Notizen
// werden immer frisch über PrivateWorkspace.getNotes()/getNote()
// bezogen.
// ===========================================================
(function () {
  'use strict';

  if (!window.PrivateCrypto || !window.PrivateWorkspace) {
    console.error('[private-renderer] PrivateCrypto/PrivateWorkspace nicht geladen.');
    return;
  }

  const hasFSA = typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';

  const SUPPORT_FILE_TYPES = [{
    description: '.support Workspace',
    accept: { 'application/octet-stream': ['.support'] }
  }];

  const els = {
    viewStart: document.getElementById('pw-view-start'),
    viewLocked: document.getElementById('pw-view-locked'),
    viewWorkspace: document.getElementById('pw-view-workspace'),

    btnOpen: document.getElementById('pw-btn-open'),
    btnCreate: document.getElementById('pw-btn-create'),
    startError: document.getElementById('pw-start-error'),

    btnLockedReopen: document.getElementById('pw-btn-locked-reopen'),

    workspaceName: document.getElementById('pw-workspace-name'),
    btnClose: document.getElementById('pw-btn-close'),
    statusSavedAt: document.getElementById('pw-status-saved-at'),
    statusPill: document.getElementById('pw-status-pill'),
    btnSave: document.getElementById('pw-btn-save'),
    btnSaveAs: document.getElementById('pw-btn-save-as'),
    fallbackHint: document.getElementById('pw-fallback-hint'),

    fileInput: document.getElementById('pw-file-input'),

    dialogCreate: document.getElementById('pw-dialog-create'),
    createForm: document.getElementById('pw-create-form'),
    createClose: document.getElementById('pw-create-close'),
    createName: document.getElementById('pw-create-name'),
    createPickLocation: document.getElementById('pw-create-pick-location'),
    createLocationText: document.getElementById('pw-create-location-text'),
    createPassword: document.getElementById('pw-create-password'),
    createPassword2: document.getElementById('pw-create-password2'),
    createStrength: document.getElementById('pw-create-strength'),
    createStrengthFill: document.getElementById('pw-create-strength-fill'),
    createStrengthLabel: document.getElementById('pw-create-strength-label'),
    createError: document.getElementById('pw-create-error'),
    createCancel: document.getElementById('pw-create-cancel'),
    createSubmit: document.getElementById('pw-create-submit'),

    dialogPassword: document.getElementById('pw-dialog-password'),
    passwordForm: document.getElementById('pw-password-form'),
    passwordTitle: document.getElementById('pw-password-title'),
    passwordClose: document.getElementById('pw-password-close'),
    passwordHint: document.getElementById('pw-password-hint'),
    passwordInput: document.getElementById('pw-password-input'),
    passwordError: document.getElementById('pw-password-error'),
    passwordCancel: document.getElementById('pw-password-cancel'),
    passwordSubmit: document.getElementById('pw-password-submit'),

    dialogUnsaved: document.getElementById('pw-dialog-unsaved'),
    unsavedError: document.getElementById('pw-unsaved-error'),
    unsavedSaveClose: document.getElementById('pw-unsaved-save-close'),
    unsavedDiscard: document.getElementById('pw-unsaved-discard'),
    unsavedCancel: document.getElementById('pw-unsaved-cancel'),

    btnNewNote: document.getElementById('pw-btn-new-note'),
    notesSearch: document.getElementById('pw-notes-search'),
    notesSearchClear: document.getElementById('pw-notes-search-clear'),
    notesList: document.getElementById('pw-notes-list'),
    notesEmpty: document.getElementById('pw-notes-empty'),

    editorEmpty: document.getElementById('pw-editor-empty'),
    editorEmptyText: document.getElementById('pw-editor-empty-text'),
    editorEmptyCta: document.getElementById('pw-editor-empty-cta'),
    editorForm: document.getElementById('pw-editor-form'),
    editorTitle: document.getElementById('pw-editor-title'),
    editorContent: document.getElementById('pw-editor-content'),
    editorTags: document.getElementById('pw-editor-tags'),
    editorTagInput: document.getElementById('pw-editor-tag-input'),
    editorTagAdd: document.getElementById('pw-editor-tag-add'),
    editorDirtyHint: document.getElementById('pw-editor-dirty-hint'),
    editorDelete: document.getElementById('pw-editor-delete'),
    editorSave: document.getElementById('pw-editor-save'),

    dialogEditorUnsaved: document.getElementById('pw-dialog-editor-unsaved'),
    editorUnsavedApply: document.getElementById('pw-editor-unsaved-apply'),
    editorUnsavedDiscard: document.getElementById('pw-editor-unsaved-discard'),
    editorUnsavedCancel: document.getElementById('pw-editor-unsaved-cancel'),

    dialogDeleteNote: document.getElementById('pw-dialog-delete-note'),
    deleteNoteCancel: document.getElementById('pw-delete-note-cancel'),
    deleteNoteConfirm: document.getElementById('pw-delete-note-confirm')
  };

  // ── Renderer-lokaler Zusatzstate (nur Anzeige, keine Geheimnisse) ──
  let pollTimer = null;
  let lastFallbackDownloadAt = null;
  const createState = { handle: null };

  // UI-State für die Notizen-Oberfläche - niemals Passwort/CryptoKey, niemals
  // eine dauerhafte Kopie des Workspace-Inhalts. Notiz-Daten werden immer
  // frisch über PrivateWorkspace.getNote()/getNotes() bezogen; hier liegt nur,
  // was rein die Editor-Ansicht selbst betrifft.
  let selectedNoteId = null;
  let editorDirty = false;
  let currentEditorTags = [];
  let searchQuery = '';
  let pendingEditorGuardAction = null;
  // Verhindert, dass ein zufällig währenddessen laufender Session-Poll-Tick
  // (siehe startPolling()) den synchron gesetzten "Wird gespeichert …"-Status
  // mit dem zu diesem Zeitpunkt noch unveränderten Dirty-Flag überschreibt.
  let saveOperationInProgress = false;

  // ── kleine Helfer ────────────────────────────────────────

  function showView(name) {
    els.viewStart.hidden = name !== 'start';
    els.viewLocked.hidden = name !== 'locked';
    els.viewWorkspace.hidden = name !== 'workspace';
  }

  function showInlineError(el, msg) { el.textContent = msg; el.hidden = false; }
  function clearInlineError(el) { el.textContent = ''; el.hidden = true; }

  function formatDateTime(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
  }

  function downloadSupportFile(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function describeWorkspaceError(err) {
    const code = err && err.code;
    if (code && PrivateCrypto.ErrorCodes[code] !== undefined) {
      return PrivateCrypto.describeError(err);
    }
    switch (code) {
      case PrivateWorkspace.ErrorCodes.NO_FILE_HANDLE:
        return 'Kein beschreibbarer Datei-Zugriff vorhanden.';
      case PrivateWorkspace.ErrorCodes.PERMISSION_DENIED:
        return 'Schreibrechte für die Datei wurden verweigert.';
      case PrivateWorkspace.ErrorCodes.WRITE_FAILED:
        return 'Speichern der Datei ist fehlgeschlagen. Bitte erneut versuchen.';
      case PrivateWorkspace.ErrorCodes.ENCRYPT_FAILED:
        return 'Verschlüsselung fehlgeschlagen. Bitte erneut versuchen.';
      case PrivateWorkspace.ErrorCodes.UNSAVED_CHANGES:
        return 'Es gibt noch ungespeicherte Änderungen.';
      case PrivateWorkspace.ErrorCodes.ALREADY_OPEN:
        return 'Es ist bereits ein Workspace geöffnet.';
      case PrivateWorkspace.ErrorCodes.NO_WORKSPACE:
        return 'Es ist aktuell kein Workspace geöffnet.';
      case PrivateWorkspace.ErrorCodes.NO_SESSION:
        return 'Es ist keine aktive Sitzung vorhanden. Bitte den Workspace erneut öffnen.';
      case PrivateWorkspace.ErrorCodes.INVALID_NOTE:
        return 'Ungültige Notiz-Daten.';
      case PrivateWorkspace.ErrorCodes.NOTE_NOT_FOUND:
        return 'Diese Notiz wurde nicht gefunden (möglicherweise bereits gelöscht).';
      default:
        return 'Ein unerwarteter Fehler ist aufgetreten.';
    }
  }

  function logSafeError(context, err) {
    // Ausschließlich Fehlercode/-name loggen – niemals Workspace-Inhalte,
    // Passwörter oder CryptoKeys landen in Log-Ausgaben.
    console.error('[private-renderer] ' + context, (err && (err.code || err.name)) || err);
  }

  function calcPasswordStrength(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 12) score++;
    if (pw.length >= 16) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
  }

  function strengthMeta(score) {
    if (score <= 1) return { cls: 'weak', label: 'Schwach' };
    if (score === 2) return { cls: 'fair', label: 'Mittel' };
    if (score === 3) return { cls: 'good', label: 'Gut' };
    return { cls: 'strong', label: 'Stark' };
  }

  function updateStrengthMeter(pw) {
    const score = calcPasswordStrength(pw);
    const meta = strengthMeta(score);
    els.createStrength.hidden = !pw;
    els.createStrengthFill.style.width = (pw ? (score / 4) * 100 : 0) + '%';
    els.createStrengthFill.className = 'pw-strength-fill pw-strength-fill--' + meta.cls;
    els.createStrengthLabel.textContent = pw ? meta.label : '';
  }

  function resetEyeToggle(input) {
    input.type = 'password';
    const btn = document.querySelector('.pw-eye-btn[data-target="' + input.id + '"]');
    if (btn) { btn.textContent = '👁'; btn.setAttribute('aria-label', 'Passwort anzeigen'); }
  }

  // ── Dialog-Grundgerüst (Fokus-Falle + Rückgabe des Fokus) ──
  let currentTrapDialog = null;

  function getFocusable(container) {
    return Array.from(container.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.disabled && el.getClientRects().length > 0);
  }

  function trapTabHandler(e) {
    if (e.key !== 'Tab' || !currentTrapDialog) return;
    const focusables = getFocusable(currentTrapDialog);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // Dialoge können verschachtelt sein (z.B. der Passwort-Dialog als
  // Fallback-Speichern-Bestätigung über dem "Ungespeicherte Änderungen"-Dialog) -
  // ein einfacher Stack statt einer einzelnen Variable sorgt dafür, dass beim
  // Schließen des inneren Dialogs Fokus/Tab-Falle korrekt zum äußeren zurückkehren.
  const dialogStack = [];

  function openDialog(overlayEl, focusEl) {
    dialogStack.push({ overlayEl, previousFocus: document.activeElement });
    overlayEl.hidden = false;
    const dialogEl = overlayEl.querySelector('.pw-dialog');
    currentTrapDialog = dialogEl;
    document.addEventListener('keydown', trapTabHandler, true);
    (focusEl || getFocusable(dialogEl)[0] || dialogEl).focus();
  }

  function closeDialog(overlayEl) {
    overlayEl.hidden = true;
    const idx = dialogStack.findIndex(e => e.overlayEl === overlayEl);
    const entry = idx !== -1 ? dialogStack.splice(idx, 1)[0] : null;

    const top = dialogStack[dialogStack.length - 1];
    if (top && !top.overlayEl.hidden) {
      currentTrapDialog = top.overlayEl.querySelector('.pw-dialog');
    } else {
      document.removeEventListener('keydown', trapTabHandler, true);
      currentTrapDialog = null;
    }

    if (entry && entry.previousFocus && typeof entry.previousFocus.focus === 'function') {
      entry.previousFocus.focus();
    }
  }

  // Klick auf den Backdrop selbst (nicht das Dialog-Panel) schließt wie Abbrechen.
  function wireBackdropCancel(overlayEl, cancelBtn) {
    overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) cancelBtn.click(); });
  }

  // ── Eye-Toggle (Passwort anzeigen/verbergen) ────────────
  document.querySelectorAll('.pw-eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
      btn.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
    });
  });

  // ── Aktivitäts-Tracking für Session-Timeout ─────────────
  ['pointerdown', 'keydown', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, () => PrivateWorkspace.touchActivity(), { passive: true });
  });

  // ── Status-/Session-Polling ──────────────────────────────
  // PrivateWorkspace hat (bewusst, siehe Phase-2-Bericht) keinen Event-/
  // Callback-Mechanismus für einen automatischen Session-Timeout. Damit die
  // UI einen im Hintergrund abgelaufenen Timeout überhaupt bemerkt, wird der
  // Session-Status in kurzen Abständen abgefragt, statt private-workspace.js
  // dafür zu erweitern (siehe Abschlussbericht Punkt H).
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(refreshWorkspaceView, 1000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function setStatusPill(state) {
    els.statusPill.className = 'pw-status-pill pw-status-pill--' + state;
    els.statusPill.textContent = state === 'saved' ? 'Gespeichert'
      : state === 'dirty' ? 'Ungespeicherte Änderungen'
      : 'Wird gespeichert …';
  }

  function refreshWorkspaceView() {
    const session = PrivateWorkspace.getSession();
    if (!session.active) {
      // Auto-Lock: PrivateWorkspace hat den State bereits entfernt. Keine
      // Editor-Änderungen heimlich übernehmen, keine Bestätigung einholen -
      // nur die UI selbst zurücksetzen (siehe Abschnitt 13 der Vorgabe).
      const wasWorkspaceView = !els.viewWorkspace.hidden;
      stopPolling();
      lastFallbackDownloadAt = null;
      resetNotesUiState();
      showView('locked');
      // Ein unsichtbares Feld aus der jetzt ausgeblendeten Workspace-Ansicht
      // darf nicht dauerhaft document.activeElement bleiben (Phase-5-Fund) -
      // nur beim tatsächlichen Übergang fokussieren, nicht bei jedem Poll-Tick.
      if (wasWorkspaceView) els.btnLockedReopen.focus();
      return;
    }
    const state = PrivateWorkspace.getState();
    els.workspaceName.textContent = (state && state.name) || 'Workspace';
    // Während eines laufenden Save-Vorgangs bleibt der Status unangetastet -
    // sonst könnte ein zufällig dazwischenfallender Poll-Tick "Wird gespeichert …"
    // fälschlich wieder auf "Ungespeicherte Änderungen" zurücksetzen, obwohl der
    // Save noch läuft (siehe saveOperationInProgress).
    if (!saveOperationInProgress) {
      setStatusPill(PrivateWorkspace.isDirty() ? 'dirty' : 'saved');
    }

    const savedAtIso = lastFallbackDownloadAt || (state && state.modified);
    els.statusSavedAt.textContent = savedAtIso ? ('Zuletzt gespeichert: ' + formatDateTime(savedAtIso)) : 'Noch nicht gespeichert';

    els.fallbackHint.hidden = !!PrivateWorkspace.getFileHandle();
  }

  function onWorkspaceOpened() {
    showView('workspace');
    startPolling();
    resetNotesUiState();
    renderNotesList();
    showEditorEmpty();
    refreshWorkspaceView();
    // Sinnvoller Einstiegspunkt direkt nach dem Öffnen: entweder eine
    // vorhandene erste Notiz oder (bei leerem Workspace) direkt "Neue Notiz".
    els.btnNewNote.focus();
  }

  function afterWorkspaceClosed() {
    stopPolling();
    lastFallbackDownloadAt = null;
    resetNotesUiState();
    showView('start');
    // Nach dem Schließen darf der Fokus nicht auf einem jetzt ausgeblendeten
    // Editor-/Notiz-Feld hängen bleiben (Phase-5-Fund) - stattdessen auf die
    // naheliegendste nächste Aktion setzen.
    els.btnOpen.focus();
  }

  // Setzt sowohl den JS-Notiz-State als auch die DOM-Felder von Liste und
  // Editor zurück. Wichtig bei Auto-Lock/Schließen: ohne das explizite Leeren
  // der Formularfelder bliebe entschlüsselter Notiz-Klartext (unsichtbar,
  // aber im DOM vorhanden) in der ausgeblendeten Workspace-Ansicht stehen.
  function resetNotesUiState() {
    selectedNoteId = null;
    editorDirty = false;
    currentEditorTags = [];
    searchQuery = '';
    els.notesSearch.value = '';
    els.notesList.innerHTML = '';
    els.editorTitle.value = '';
    els.editorContent.value = '';
    els.editorTags.innerHTML = '';
    els.editorTagInput.value = '';
    els.editorDirtyHint.hidden = true;
    els.workspaceName.textContent = '';
    els.notesSearchClear.hidden = true;
    // Kein irreführender Speicherstatus darf nach Close/Auto-Lock stehen bleiben,
    // auch wenn die Sektion selbst ausgeblendet ist (siehe Phase-6-Vorgabe 10).
    els.statusPill.className = 'pw-status-pill';
    els.statusPill.textContent = '';
    els.statusSavedAt.textContent = '';
    showEditorEmpty();
  }

  // ── generischer Passwort-Dialog (aktuell nur für "Workspace öffnen") ──
  let currentPasswordCleanup = null;

  function promptPassword({ title, hint, submitLabel, onSubmit }) {
    return new Promise((resolve) => {
      if (currentPasswordCleanup) currentPasswordCleanup();

      els.passwordTitle.textContent = title;
      els.passwordHint.textContent = hint || '';
      els.passwordHint.hidden = !hint;
      els.passwordSubmit.textContent = submitLabel || 'Öffnen';
      els.passwordInput.value = '';
      clearInlineError(els.passwordError);
      resetEyeToggle(els.passwordInput);

      let settled = false;
      function finish(result) {
        if (settled) return;
        settled = true;
        cleanup();
        els.passwordInput.value = '';
        els.passwordHint.textContent = '';
        els.passwordHint.hidden = true;
        closeDialog(els.dialogPassword);
        resolve(result);
      }

      async function onFormSubmit(e) {
        e.preventDefault();
        const password = els.passwordInput.value;
        if (!password) return;
        els.passwordSubmit.disabled = true;
        clearInlineError(els.passwordError);
        try {
          await onSubmit(password);
          finish(true);
        } catch (err) {
          logSafeError('Passwort-Dialog', err);
          showInlineError(els.passwordError, describeWorkspaceError(err));
          els.passwordInput.value = '';
          els.passwordInput.focus();
        } finally {
          els.passwordSubmit.disabled = false;
        }
      }

      function onCancel() { finish(false); }

      function cleanup() {
        els.passwordForm.removeEventListener('submit', onFormSubmit);
        els.passwordCancel.removeEventListener('click', onCancel);
        els.passwordClose.removeEventListener('click', onCancel);
        currentPasswordCleanup = null;
      }

      els.passwordForm.addEventListener('submit', onFormSubmit);
      els.passwordCancel.addEventListener('click', onCancel);
      els.passwordClose.addEventListener('click', onCancel);
      currentPasswordCleanup = cleanup;

      openDialog(els.dialogPassword, els.passwordInput);
    });
  }

  // ── Download-Fallback: Speichern ohne FileSystemFileHandle ──
  //
  // PrivateWorkspace hält das Passwort intern und gibt es nie heraus. Für den
  // Fallback-Save muss der Renderer weder das Passwort kennen noch selbst
  // verschlüsseln: PrivateWorkspace.exportEncrypted() erledigt Kopie,
  // modified-Zeitstempel und Verschlüsselung intern und liefert nur die
  // fertigen, verschlüsselten Bytes zurück. Da ein Download keine Bestätigung
  // ist, dass die Datei tatsächlich irgendwo dauerhaft ankommt, entscheidet
  // erst der Renderer nach ausgelöstem Download per markClean(), dass der
  // Workspace als "gespeichert" gilt.
  async function saveViaDownloadFallback() {
    const bytes = await PrivateWorkspace.exportEncrypted();
    const state = PrivateWorkspace.getState();
    downloadSupportFile(bytes, (state.name || 'Workspace') + '.support');

    PrivateWorkspace.markClean();
    lastFallbackDownloadAt = state.modified;
  }

  // ── Notizen: Liste, Suche, Editor ────────────────────────
  //
  // Es gibt bewusst KEINE zweite Datenhaltung: jede Anzeige liest die Notizen
  // frisch über PrivateWorkspace.getNotes()/getNote(). Der einzige UI-eigene
  // Zustand ist, welche Notiz gerade ausgewählt ist und ob der Editor lokale,
  // noch nicht per updateNote() übernommene Änderungen enthält.

  function getFilteredSortedNotes() {
    const notes = PrivateWorkspace.getNotes();
    notes.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    const q = searchQuery.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.content || '').toLowerCase().includes(q) ||
      (n.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  function renderNotesList() {
    if (!PrivateWorkspace.hasWorkspace()) return;

    const allNotes = PrivateWorkspace.getNotes();
    const visibleNotes = getFilteredSortedNotes();

    els.notesList.innerHTML = '';

    if (allNotes.length === 0) {
      els.notesEmpty.textContent = 'Noch keine Notizen. Erstelle deine erste Notiz.';
      els.notesEmpty.hidden = false;
      els.notesList.hidden = true;
      return;
    }
    if (visibleNotes.length === 0) {
      els.notesEmpty.textContent = searchQuery.trim()
        ? 'Keine Notizen gefunden für „' + searchQuery.trim() + '“.'
        : 'Keine passenden Notizen gefunden.';
      els.notesEmpty.hidden = false;
      els.notesList.hidden = true;
      return;
    }
    els.notesEmpty.hidden = true;
    els.notesList.hidden = false;

    visibleNotes.forEach(note => {
      const li = document.createElement('li');
      li.className = 'pw-note-item';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-note-item-btn';
      btn.setAttribute('aria-current', note.id === selectedNoteId ? 'true' : 'false');
      // Die Note-ID wandert bewusst nur als Closure-Variable in den Handler,
      // nicht als data-Attribut ins DOM (siehe Sicherheitsvorgabe Abschnitt 17).
      btn.addEventListener('click', () => selectNote(note.id));

      const titleEl = document.createElement('div');
      titleEl.className = 'pw-note-item-title';
      titleEl.textContent = note.title && note.title.trim() ? note.title : 'Unbenannte Notiz';
      btn.appendChild(titleEl);

      if (note.modified) {
        const metaEl = document.createElement('div');
        metaEl.className = 'pw-note-item-meta';
        metaEl.textContent = 'Geändert: ' + formatDateTime(note.modified);
        btn.appendChild(metaEl);
      }

      if (note.content) {
        const previewEl = document.createElement('div');
        previewEl.className = 'pw-note-item-preview';
        previewEl.textContent = note.content.slice(0, 80);
        btn.appendChild(previewEl);
      }

      if (note.tags && note.tags.length) {
        const tagsEl = document.createElement('div');
        tagsEl.className = 'pw-note-item-tags';
        note.tags.forEach(t => {
          const chip = document.createElement('span');
          chip.className = 'pw-note-item-tag';
          chip.textContent = t;
          tagsEl.appendChild(chip);
        });
        btn.appendChild(tagsEl);
      }

      li.appendChild(btn);
      els.notesList.appendChild(li);
    });
  }

  function showEditorEmpty() {
    els.editorForm.hidden = true;
    els.editorEmpty.hidden = false;
    // Bewusst gestalteter Empty State (Vorgabe Abschnitt 3): ein Workspace
    // ganz ohne Notizen bekommt eine erklärende CTA statt der neutralen
    // "wähle eine Notiz"-Meldung, die hier fälschlich nahelegen würde, dass
    // es etwas zum Auswählen gäbe.
    const hasAnyNotes = PrivateWorkspace.hasWorkspace() && PrivateWorkspace.getNotes().length > 0;
    if (hasAnyNotes) {
      els.editorEmptyText.textContent = 'Wähle eine Notiz aus oder erstelle eine neue.';
      els.editorEmptyCta.hidden = true;
    } else {
      els.editorEmptyText.textContent = 'Noch keine Notizen. Erstelle deine erste Notiz, um loszulegen.';
      els.editorEmptyCta.hidden = false;
    }
  }

  function renderTagChips() {
    els.editorTags.innerHTML = '';
    currentEditorTags.forEach((tag, idx) => {
      const chip = document.createElement('span');
      chip.className = 'pw-tag-chip';

      const label = document.createElement('span');
      label.textContent = tag;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'pw-tag-remove';
      removeBtn.setAttribute('aria-label', 'Tag „' + tag + '“ entfernen');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        currentEditorTags.splice(idx, 1);
        renderTagChips();
        markEditorDirty();
      });

      chip.appendChild(label);
      chip.appendChild(removeBtn);
      els.editorTags.appendChild(chip);
    });
  }

  function addTagFromInput() {
    const raw = els.editorTagInput.value.trim();
    els.editorTagInput.value = '';
    if (!raw || currentEditorTags.includes(raw)) return; // leere/doppelte Tags ignorieren
    currentEditorTags.push(raw);
    renderTagChips();
    markEditorDirty();
    els.editorTagInput.focus();
  }

  function markEditorDirty() {
    if (editorDirty) return;
    editorDirty = true;
    els.editorDirtyHint.hidden = false;
  }

  function loadNoteIntoEditor(id) {
    const note = PrivateWorkspace.getNote(id);
    if (!note) {
      selectedNoteId = null;
      showEditorEmpty();
      return;
    }
    selectedNoteId = id;
    els.editorForm.hidden = false;
    els.editorEmpty.hidden = true;
    els.editorTitle.value = note.title;
    els.editorContent.value = note.content;
    currentEditorTags = note.tags.slice();
    renderTagChips();
    els.editorTagInput.value = '';
    editorDirty = false;
    els.editorDirtyHint.hidden = true;
  }

  function commitEditorChanges() {
    if (!selectedNoteId) return;
    const title = els.editorTitle.value;
    const content = els.editorContent.value;
    // Auch hier defensiv trimmen/entdoppeln - die Editor-UI verhindert das
    // zwar bereits beim Hinzufügen eines Tags, aber updateNote() ist die
    // Stelle, an der endgültig gespeichert wird.
    const trimmedTags = currentEditorTags.map(t => t.trim()).filter(t => t.length > 0);
    const tags = trimmedTags.filter((t, i) => trimmedTags.indexOf(t) === i);

    try {
      PrivateWorkspace.updateNote(selectedNoteId, { title, content, tags });
      editorDirty = false;
      els.editorDirtyHint.hidden = true;
      renderNotesList();
      showToast('Notiz gespeichert.', 'success');
    } catch (err) {
      logSafeError('note-save', err);
      showToast(describeWorkspaceError(err), 'error');
    }
    refreshWorkspaceView();
  }

  // Alle Aktionen, die die aktuell im Editor angezeigte Notiz verlassen
  // (andere Notiz wählen, neue Notiz anlegen, Workspace schließen), laufen
  // über diesen Guard: bei lokalen, nicht übernommenen Editor-Änderungen wird
  // zuerst nachgefragt, bevor die eigentliche Aktion ausgeführt wird.
  function withEditorGuard(action) {
    if (!editorDirty) { action(); return; }
    pendingEditorGuardAction = action;
    openDialog(els.dialogEditorUnsaved, els.editorUnsavedCancel);
  }

  function selectNote(id) {
    if (id === selectedNoteId) return;
    withEditorGuard(() => {
      loadNoteIntoEditor(id);
      renderNotesList();
    });
  }

  function handleNewNoteClick() {
    withEditorGuard(() => {
      let note;
      try {
        note = PrivateWorkspace.addNote({});
      } catch (err) {
        logSafeError('note-create', err);
        showToast(describeWorkspaceError(err), 'error');
        return;
      }
      renderNotesList();
      loadNoteIntoEditor(note.id);
      renderNotesList(); // aria-current auf die neue Notiz aktualisieren
      els.editorTitle.focus();
      refreshWorkspaceView();
    });
  }

  function handleDeleteNoteClick() {
    if (!selectedNoteId) return;
    openDialog(els.dialogDeleteNote, els.deleteNoteCancel);
  }

  function handleDeleteNoteConfirm() {
    const id = selectedNoteId;
    if (!id) { closeDialog(els.dialogDeleteNote); return; }
    try {
      PrivateWorkspace.deleteNote(id);
    } catch (err) {
      logSafeError('note-delete', err);
      showToast(describeWorkspaceError(err), 'error');
      closeDialog(els.dialogDeleteNote);
      return;
    }
    closeDialog(els.dialogDeleteNote);
    editorDirty = false; // eine gelöschte Notiz kann keine zu übernehmenden Änderungen mehr haben

    const remaining = getFilteredSortedNotes();
    if (remaining.length > 0) {
      loadNoteIntoEditor(remaining[0].id);
    } else {
      selectedNoteId = null;
      showEditorEmpty();
    }
    renderNotesList();
    refreshWorkspaceView();
    showToast('Notiz gelöscht.', 'warning');
  }

  // ── Workspace öffnen ─────────────────────────────────────
  function pickFileViaInput() {
    return new Promise((resolve) => {
      const input = els.fileInput;
      input.value = '';
      function onChange() {
        cleanup();
        resolve(input.files && input.files[0] ? input.files[0] : null);
      }
      function onCancelEvt() {
        cleanup();
        resolve(null);
      }
      function cleanup() {
        input.removeEventListener('change', onChange);
        input.removeEventListener('cancel', onCancelEvt);
      }
      input.addEventListener('change', onChange);
      input.addEventListener('cancel', onCancelEvt); // von Chromium/Firefox unterstützt; harmlos falls nicht gefeuert
      input.click();
    });
  }

  async function handleOpenClick() {
    clearInlineError(els.startError);
    try {
      let fileOrHandle;

      if (hasFSA) {
        let handles;
        try {
          handles = await window.showOpenFilePicker({ types: SUPPORT_FILE_TYPES, multiple: false });
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          throw err;
        }
        fileOrHandle = handles[0];
      } else {
        const file = await pickFileViaInput();
        if (!file) return;
        fileOrHandle = file;
      }

      const displayName = hasFSA ? fileOrHandle.name : fileOrHandle.name;
      const opened = await promptPassword({
        title: 'Workspace öffnen',
        hint: displayName ? ('Datei: ' + displayName) : '',
        submitLabel: 'Öffnen',
        onSubmit: (password) => PrivateWorkspace.open(fileOrHandle, password)
      });
      if (!opened) return;

      lastFallbackDownloadAt = null;
      onWorkspaceOpened();
      showToast('Workspace geöffnet.', 'success');
    } catch (err) {
      logSafeError('open', err);
      showInlineError(els.startError, describeWorkspaceError(err));
    }
  }

  // ── Workspace erstellen ──────────────────────────────────
  function resetCreateDialog() {
    els.createName.value = 'Neuer-Workspace';
    els.createPassword.value = '';
    els.createPassword2.value = '';
    createState.handle = null;
    els.createLocationText.textContent = hasFSA ? 'Kein Speicherort gewählt' : 'Wird nach dem Erstellen als Download bereitgestellt.';
    clearInlineError(els.createError);
    updateStrengthMeter('');
    resetEyeToggle(els.createPassword);
    resetEyeToggle(els.createPassword2);
    els.createSubmit.disabled = false;
    els.createSubmit.textContent = 'Workspace erstellen';
  }

  els.createPassword.addEventListener('input', () => updateStrengthMeter(els.createPassword.value));

  async function handleCreatePickLocation() {
    const suggested = (els.createName.value.trim().replace(/\.support$/i, '') || 'Neuer-Workspace') + '.support';
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: suggested, types: SUPPORT_FILE_TYPES });
      createState.handle = handle;
      els.createLocationText.textContent = handle.name;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      logSafeError('Speicherort wählen', err);
      showInlineError(els.createError, 'Speicherort konnte nicht gewählt werden.');
    }
  }

  async function writeInitialFile(handle, bytes) {
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }

  async function handleCreateSubmit() {
    clearInlineError(els.createError);
    const name = els.createName.value.trim().replace(/\.support$/i, '');
    const pw1 = els.createPassword.value;
    const pw2 = els.createPassword2.value;

    if (!name) return showInlineError(els.createError, 'Bitte einen Dateinamen angeben.');
    if (pw1.length < 12) return showInlineError(els.createError, 'Das Passwort muss mindestens 12 Zeichen lang sein.');
    if (pw1 !== pw2) return showInlineError(els.createError, 'Die Passwörter stimmen nicht überein.');
    if (hasFSA && !createState.handle) return showInlineError(els.createError, 'Bitte zuerst einen Speicherort wählen.');

    els.createSubmit.disabled = true;
    els.createSubmit.textContent = 'Erstelle …';
    try {
      const encryptedBytes = await PrivateCrypto.createWorkspace(name, pw1);

      if (hasFSA) {
        await writeInitialFile(createState.handle, encryptedBytes);
        await PrivateWorkspace.open(createState.handle, pw1);
      } else {
        downloadSupportFile(encryptedBytes, name + '.support');
        await PrivateWorkspace.open(encryptedBytes, pw1);
      }
      lastFallbackDownloadAt = null;

      const wasFsa = hasFSA;
      resetCreateDialog();
      closeDialog(els.dialogCreate);
      onWorkspaceOpened();
      showToast(wasFsa ? 'Workspace erstellt und geöffnet.' : 'Workspace erstellt, Datei heruntergeladen und geöffnet.', 'success');
    } catch (err) {
      logSafeError('create', err);
      showInlineError(els.createError, describeWorkspaceError(err));
    } finally {
      els.createSubmit.disabled = false;
      els.createSubmit.textContent = 'Workspace erstellen';
    }
  }

  // ── Speichern ────────────────────────────────────────────
  // Beide Aktionen (Speichern/Speichern unter) werden gemeinsam deaktiviert,
  // solange eine von beiden läuft - verhindert doppelte/überlappende
  // Save-Requests durch den Nutzer, ohne die bestehende Session-Race-Sicherung
  // in private-workspace.js (Generation-Guard) abzuschwächen oder zu duplizieren.
  function setSaveButtonsBusy(busy) {
    els.btnSave.disabled = busy;
    els.btnSaveAs.disabled = busy;
  }

  async function handleSaveClick() {
    setSaveButtonsBusy(true);
    saveOperationInProgress = true;
    setStatusPill('saving');
    try {
      if (PrivateWorkspace.getFileHandle()) {
        await PrivateWorkspace.save();
        lastFallbackDownloadAt = null;
        showToast('Workspace gespeichert.', 'success');
      } else {
        await saveViaDownloadFallback();
        showToast('Verschlüsselte Datei heruntergeladen.', 'success');
      }
    } catch (err) {
      logSafeError('save', err);
      showToast(describeWorkspaceError(err), 'error');
    } finally {
      saveOperationInProgress = false;
      setSaveButtonsBusy(false);
      refreshWorkspaceView();
    }
  }

  // "Speichern unter" ist nur bei verfügbarer File System Access API sinnvoll -
  // ohne FSA speichert der normale "Speichern"-Button über den Download-
  // Fallback ohnehin bereits jedes Mal eine neue Datei.
  async function handleSaveAsClick() {
    let handle;
    try {
      const state = PrivateWorkspace.getState();
      const suggested = ((state && state.name) || 'Workspace') + '.support';
      handle = await window.showSaveFilePicker({ suggestedName: suggested, types: SUPPORT_FILE_TYPES });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      logSafeError('save-as-pick', err);
      showToast('Speicherort konnte nicht gewählt werden.', 'error');
      return;
    }

    setSaveButtonsBusy(true);
    saveOperationInProgress = true;
    setStatusPill('saving');
    try {
      await PrivateWorkspace.saveAs(handle);
      lastFallbackDownloadAt = null;
      showToast('Workspace unter neuem Speicherort gespeichert.', 'success');
    } catch (err) {
      logSafeError('save-as', err);
      showToast(describeWorkspaceError(err), 'error');
    } finally {
      saveOperationInProgress = false;
      setSaveButtonsBusy(false);
      refreshWorkspaceView();
    }
  }

  // ── Schließen ────────────────────────────────────────────
  // Zwei getrennte Ebenen: zuerst wird ein evtl. ungespeicherter Editor-Zustand
  // behandelt (withEditorGuard), erst danach – falls der Workspace weiterhin
  // dirty ist – der bestehende Workspace-Schließen-Dialog aus Phase 3A.
  function handleCloseClick() {
    withEditorGuard(() => {
      if (!PrivateWorkspace.isDirty()) {
        PrivateWorkspace.close();
        afterWorkspaceClosed();
        return;
      }
      clearInlineError(els.unsavedError);
      openDialog(els.dialogUnsaved, els.unsavedCancel);
    });
  }

  async function handleUnsavedSaveClose() {
    els.unsavedSaveClose.disabled = true;
    els.unsavedDiscard.disabled = true;
    try {
      if (PrivateWorkspace.getFileHandle()) {
        await PrivateWorkspace.save();
      } else {
        await saveViaDownloadFallback();
      }
      PrivateWorkspace.close({ discard: true });
      closeDialog(els.dialogUnsaved);
      afterWorkspaceClosed();
      showToast('Workspace gespeichert und geschlossen.', 'success');
    } catch (err) {
      logSafeError('save&close', err);
      showInlineError(els.unsavedError, describeWorkspaceError(err));
    } finally {
      els.unsavedSaveClose.disabled = false;
      els.unsavedDiscard.disabled = false;
    }
  }

  function handleUnsavedDiscard() {
    PrivateWorkspace.close({ discard: true });
    closeDialog(els.dialogUnsaved);
    afterWorkspaceClosed();
    showToast('Workspace ohne Speichern geschlossen.', 'warning');
  }

  function handleUnsavedCancel() {
    closeDialog(els.dialogUnsaved);
  }

  // ── Event-Verkabelung ────────────────────────────────────
  els.btnOpen.addEventListener('click', handleOpenClick);
  els.btnCreate.addEventListener('click', () => {
    resetCreateDialog();
    openDialog(els.dialogCreate, els.createName);
  });
  els.btnLockedReopen.addEventListener('click', () => showView('start'));

  els.createForm.addEventListener('submit', (e) => { e.preventDefault(); handleCreateSubmit(); });
  els.createPickLocation.addEventListener('click', handleCreatePickLocation);
  els.createCancel.addEventListener('click', () => { resetCreateDialog(); closeDialog(els.dialogCreate); });
  els.createClose.addEventListener('click', () => { resetCreateDialog(); closeDialog(els.dialogCreate); });
  wireBackdropCancel(els.dialogCreate, els.createCancel);

  wireBackdropCancel(els.dialogPassword, els.passwordCancel);

  els.btnClose.addEventListener('click', handleCloseClick);
  els.btnSave.addEventListener('click', handleSaveClick);
  els.btnSaveAs.addEventListener('click', handleSaveAsClick);

  els.unsavedSaveClose.addEventListener('click', handleUnsavedSaveClose);
  els.unsavedDiscard.addEventListener('click', handleUnsavedDiscard);
  els.unsavedCancel.addEventListener('click', handleUnsavedCancel);
  wireBackdropCancel(els.dialogUnsaved, els.unsavedCancel);

  // Notizen
  els.btnNewNote.addEventListener('click', handleNewNoteClick);
  els.editorEmptyCta.addEventListener('click', handleNewNoteClick);
  els.notesSearch.addEventListener('input', () => {
    searchQuery = els.notesSearch.value;
    els.notesSearchClear.hidden = searchQuery.length === 0;
    renderNotesList();
  });
  els.notesSearchClear.addEventListener('click', () => {
    searchQuery = '';
    els.notesSearch.value = '';
    els.notesSearchClear.hidden = true;
    renderNotesList();
    els.notesSearch.focus();
  });

  els.editorTitle.addEventListener('input', markEditorDirty);
  els.editorContent.addEventListener('input', markEditorDirty);
  els.editorTagAdd.addEventListener('click', addTagFromInput);
  els.editorTagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTagFromInput(); }
  });
  els.editorSave.addEventListener('click', commitEditorChanges);
  els.editorDelete.addEventListener('click', handleDeleteNoteClick);

  els.editorUnsavedApply.addEventListener('click', () => {
    commitEditorChanges();
    closeDialog(els.dialogEditorUnsaved);
    const action = pendingEditorGuardAction; pendingEditorGuardAction = null;
    if (action) action();
  });
  els.editorUnsavedDiscard.addEventListener('click', () => {
    editorDirty = false;
    els.editorDirtyHint.hidden = true;
    closeDialog(els.dialogEditorUnsaved);
    const action = pendingEditorGuardAction; pendingEditorGuardAction = null;
    if (action) action();
  });
  els.editorUnsavedCancel.addEventListener('click', () => {
    closeDialog(els.dialogEditorUnsaved);
    pendingEditorGuardAction = null;
  });
  wireBackdropCancel(els.dialogEditorUnsaved, els.editorUnsavedCancel);

  els.deleteNoteConfirm.addEventListener('click', handleDeleteNoteConfirm);
  els.deleteNoteCancel.addEventListener('click', () => closeDialog(els.dialogDeleteNote));
  wireBackdropCancel(els.dialogDeleteNote, els.deleteNoteCancel);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.dialogCreate.hidden) els.createCancel.click();
    else if (!els.dialogPassword.hidden) els.passwordCancel.click();
    else if (!els.dialogEditorUnsaved.hidden) els.editorUnsavedCancel.click();
    else if (!els.dialogDeleteNote.hidden) els.deleteNoteCancel.click();
    else if (!els.dialogUnsaved.hidden) els.unsavedCancel.click();
  });

  // Wenn FSA nicht verfügbar ist, macht "Speicherort wählen" keinen Sinn -
  // stattdessen ein ehrlicher Hinweis, dass nach dem Erstellen heruntergeladen wird.
  if (!hasFSA) {
    els.createPickLocation.hidden = true;
    els.createLocationText.textContent = 'Wird nach dem Erstellen als Download bereitgestellt.';
  }
  // "Speichern unter" ergibt ohne FSA keinen zusätzlichen Nutzen gegenüber dem
  // ohnehin bestehenden Download-Fallback von "Speichern".
  els.btnSaveAs.hidden = !hasFSA;

  // ── Init ─────────────────────────────────────────────────
  showView('start');
})();
