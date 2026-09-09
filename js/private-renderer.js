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
    btnNewWindow: document.getElementById('pw-btn-new-window'),
    btnNewTab: document.getElementById('pw-btn-new-tab'),
    startError: document.getElementById('pw-start-error'),

    btnLockedReopen: document.getElementById('pw-btn-locked-reopen'),

    workspaceName: document.getElementById('pw-workspace-name'),
    btnClose: document.getElementById('pw-btn-close'),
    statusSavedAt: document.getElementById('pw-status-saved-at'),
    statusAutoLockHint: document.getElementById('pw-status-autolock-hint'),
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

    editorAttachments: document.getElementById('pw-editor-attachments'),
    editorAttachmentsEmpty: document.getElementById('pw-editor-attachments-empty'),
    editorAttachmentInput: document.getElementById('pw-editor-attachment-input'),
    editorAttachmentAdd: document.getElementById('pw-editor-attachment-add'),
    editorAttachmentHint: document.getElementById('pw-editor-attachment-hint'),

    dialogEditorUnsaved: document.getElementById('pw-dialog-editor-unsaved'),
    editorUnsavedApply: document.getElementById('pw-editor-unsaved-apply'),
    editorUnsavedDiscard: document.getElementById('pw-editor-unsaved-discard'),
    editorUnsavedCancel: document.getElementById('pw-editor-unsaved-cancel'),

    dialogDeleteNote: document.getElementById('pw-dialog-delete-note'),
    deleteNoteTitle: document.getElementById('pw-delete-note-title'),
    deleteNoteBody: document.getElementById('pw-delete-note-body'),
    deleteNoteCancel: document.getElementById('pw-delete-note-cancel'),
    deleteNoteConfirm: document.getElementById('pw-delete-note-confirm'),

    // Notes/Entries-Umschalter (Phase 7)
    tabNotes: document.getElementById('pw-tab-notes'),
    tabEntries: document.getElementById('pw-tab-entries'),
    notesPanel: document.getElementById('pw-notes-panel'),
    entriesPanel: document.getElementById('pw-entries-panel'),

    btnNewEntry: document.getElementById('pw-btn-new-entry'),
    entriesSearch: document.getElementById('pw-entries-search'),
    entriesSearchClear: document.getElementById('pw-entries-search-clear'),
    entryCategoryFilter: document.getElementById('pw-entry-category-filter'),
    entriesList: document.getElementById('pw-entries-list'),
    entriesEmpty: document.getElementById('pw-entries-empty'),

    entryEditorEmpty: document.getElementById('pw-entry-editor-empty'),
    entryEditorEmptyText: document.getElementById('pw-entry-editor-empty-text'),
    entryEditorEmptyCta: document.getElementById('pw-entry-editor-empty-cta'),
    entryEditorForm: document.getElementById('pw-entry-editor-form'),
    entryTitle: document.getElementById('pw-entry-title'),
    entryCategory: document.getElementById('pw-entry-category'),
    entryDescription: document.getElementById('pw-entry-description'),
    entryTags: document.getElementById('pw-entry-tags'),
    entryTagInput: document.getElementById('pw-entry-tag-input'),
    entryTagAdd: document.getElementById('pw-entry-tag-add'),
    entryFields: document.getElementById('pw-entry-fields'),
    entryFieldAdd: document.getElementById('pw-entry-field-add'),
    entryEditorDirtyHint: document.getElementById('pw-entry-editor-dirty-hint'),
    entryDelete: document.getElementById('pw-entry-delete'),
    entrySave: document.getElementById('pw-entry-save'),

    entryAttachments: document.getElementById('pw-entry-attachments'),
    entryAttachmentsEmpty: document.getElementById('pw-entry-attachments-empty'),
    entryAttachmentInput: document.getElementById('pw-entry-attachment-input'),
    entryAttachmentAdd: document.getElementById('pw-entry-attachment-add'),
    entryAttachmentHint: document.getElementById('pw-entry-attachment-hint'),

    editorUnsavedBody: document.getElementById('pw-editor-unsaved-body'),

    dialogAttachmentPreview: document.getElementById('pw-dialog-attachment-preview'),
    attachmentPreviewTitle: document.getElementById('pw-attachment-preview-title'),
    attachmentPreviewImg: document.getElementById('pw-attachment-preview-img'),
    attachmentPreviewMeta: document.getElementById('pw-attachment-preview-meta'),
    attachmentPreviewClose: document.getElementById('pw-attachment-preview-close'),
    attachmentPreviewCloseBtn: document.getElementById('pw-attachment-preview-close-btn'),
    attachmentPreviewDownload: document.getElementById('pw-attachment-preview-download')
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

  // Analoger UI-State für Entries (Phase 7) - gleiche Prinzipien: keine
  // Zweitspeicherung, Daten immer frisch über PrivateWorkspace.getEntry(ies)().
  let activeTab = 'notes'; // 'notes' | 'entries' - bestimmt u.a., welcher Editor vom Dirty-Guard/Löschen-Dialog gemeint ist
  let selectedEntryId = null;
  let entriesEditorDirty = false;
  let currentEntryTags = [];
  let currentEntryFields = []; // [{label, value}] - Feld-IDs vergibt erst PrivateWorkspace beim Speichern
  let entriesSearchQuery = '';
  let entryCategoryFilter = ''; // '' = "Alle"
  // Verhindert, dass ein zufällig währenddessen laufender Session-Poll-Tick
  // (siehe startPolling()) den synchron gesetzten "Wird gespeichert …"-Status
  // mit dem zu diesem Zeitpunkt noch unveränderten Dirty-Flag überschreibt.
  let saveOperationInProgress = false;

  // Anhänge (Phase 11): Es gibt bewusst KEINE eigene Zwischenspeicherung der
  // Anhang-Listen selbst - die werden immer frisch über
  // PrivateWorkspace.get(Note|Entry)Attachments() bezogen (gleiches Prinzip
  // wie bei Notizen/Entries). Renderer-lokal wird nur nachgehalten, welche
  // temporären Object-URLs (Vorschau-Thumbnails + Lightbox + Download) gerade
  // aktiv sind, damit sie zuverlässig wieder freigegeben werden können -
  // niemals als Teil des Workspace-Modells persistiert (Vorgabe Abschnitt 12).
  const activeObjectUrls = new Set();
  let attachmentPreviewObjectUrl = null;
  let currentPreviewAttachment = null;

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

  // ── Anhang-Hilfsfunktionen (Phase 11) ────────────────────
  //
  // Gemeinsam für Notizen UND Entries (keine zweite, abweichende
  // Implementierung) - Object-URLs entstehen ausschließlich hier, aus lokal
  // aus Base64 rekonstruierten Blobs, und werden über activeObjectUrls
  // nachgehalten, damit sie in resetNotesUiState() zuverlässig vollständig
  // freigegeben werden können (Vorgabe Abschnitt 12/20).

  function formatFileSize(bytes) {
    if (!(bytes >= 0)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function base64ToBlob(base64, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  function createAttachmentObjectUrl(attachment) {
    const blob = base64ToBlob(attachment.data, attachment.type);
    const url = URL.createObjectURL(blob);
    activeObjectUrls.add(url);
    return url;
  }

  function revokeAttachmentObjectUrl(url) {
    if (!url) return;
    URL.revokeObjectURL(url);
    activeObjectUrls.delete(url);
  }

  function revokeAllAttachmentObjectUrls() {
    activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    activeObjectUrls.clear();
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
      case PrivateWorkspace.ErrorCodes.INVALID_ENTRY:
        return 'Ungültige Eintragsdaten.';
      case PrivateWorkspace.ErrorCodes.INVALID_ENTRY_FIELD:
        return 'Ungültiges Feld in diesem Eintrag.';
      case PrivateWorkspace.ErrorCodes.ENTRY_NOT_FOUND:
        return 'Dieser Eintrag wurde nicht gefunden (möglicherweise bereits gelöscht).';
      case PrivateWorkspace.ErrorCodes.INVALID_ATTACHMENT:
        return 'Es wurde keine gültige Bilddatei übergeben.';
      case PrivateWorkspace.ErrorCodes.ATTACHMENT_TYPE_UNSUPPORTED:
        return 'Nur Bilddateien (PNG, JPEG, GIF, WebP, SVG) werden als Anhang unterstützt.';
      case PrivateWorkspace.ErrorCodes.ATTACHMENT_TOO_LARGE:
        return 'Diese Datei ist zu groß für einen Anhang (max. ' + Math.round(PrivateWorkspace.MAX_ATTACHMENT_BYTES / (1024 * 1024)) + ' MB).';
      case PrivateWorkspace.ErrorCodes.ATTACHMENT_NOT_FOUND:
        return 'Dieser Anhang wurde nicht gefunden (möglicherweise bereits entfernt).';
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

  // Läuft die Session ab, während ein Dialog offen ist (Phase-9-Vorgabe 12),
  // muss dieser sauber verschwinden statt über der gesperrten Ansicht hängen
  // zu bleiben. Sicher für alle Dialoge, die überhaupt parallel zu einer
  // aktiven Session offen sein können (Workspace-Unsaved/Editor-Unsaved/
  // Notiz-Eintrag-Löschen) - diese sind rein event-getrieben ohne offene
  // Promise. Passwort- und Create-Dialog setzen "kein Workspace offen" voraus
  // und können daher konstruktionsbedingt nie parallel zu einer aktiven
  // Session offen sein.
  function forceCloseAllDialogs() {
    while (dialogStack.length > 0) {
      dialogStack.pop().overlayEl.hidden = true;
    }
    document.removeEventListener('keydown', trapTabHandler, true);
    currentTrapDialog = null;
    pendingEditorGuardAction = null;
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
  // Bewusst nur echte, diskrete Nutzerinteraktionen - keine Mausbewegungen
  // (zu hochfrequent) und nichts Timer-/Render-/Visibility-Basiertes.
  // PrivateWorkspace.touchActivity() ist bereits intern auf `session.active`
  // gegated (siehe private-workspace.js) - ohne offenen Workspace lösen diese
  // Events also ohnehin keine Wirkung aus (Vorgabe Abschnitt 7).
  ['pointerdown', 'keydown', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, () => PrivateWorkspace.touchActivity(), { passive: true });
  });

  // ── Sichtbarkeitswechsel (Phase 9) ───────────────────────
  //
  // "hidden" darf laut Vorgabe niemals selbst einen Lock auslösen und bleibt
  // hier bewusst ein reines No-Op. Bei Rückkehr zu "visible" wird lediglich
  // die UI mit dem tatsächlichen (ggf. inzwischen abgelaufenen) Session-
  // Zustand synchronisiert - über denselben refreshWorkspaceView()-Pfad, den
  // auch das bestehende Polling nutzt (siehe Abschnitt 11: keine zweite
  // Cleanup-Implementierung). `pollTimer` ist nur zwischen startPolling()
  // (bei onWorkspaceOpened) und stopPolling() (bei Close/Lock) gesetzt - das
  // verhindert zuverlässig, dass ein Tab-Wechsel auf der Start-/Locked-Ansicht
  // (ganz ohne je geöffneten Workspace) fälschlich reagiert.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!pollTimer) return;
    refreshWorkspaceView();
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

  // ── Zeitbasierte Session-Prüfung (Phase 9) ───────────────
  //
  // PrivateWorkspace sperrt intern bereits selbst über einen setTimeout()
  // (siehe private-workspace.js) - diese Funktion ändert daran nichts und
  // erfindet keine zweite Timeout-Mechanik. Sie schließt nur eine Lücke:
  // In einem länger im Hintergrund gedrosselten Tab kann auch der interne
  // setTimeout() selbst verspätet feuern, wodurch die Session in der Zwischen-
  // zeit fälschlich noch "aktiv" erscheinen könnte. Beim tatsächlichen Prüf-
  // zeitpunkt (Poll-Tick oder Rückkehr aus dem Hintergrund) wird deshalb
  // zusätzlich anhand der bereits vorhandenen session.lastActivity/
  // timeoutMinutes real verstrichene Zeit nachgerechnet - läuft die Session
  // rechnerisch bereits ab, wird sie sofort über die bestehende, öffentliche
  // clearSession()-Methode beendet (identisch zu einem regulär gefeuerten
  // internen Timeout, inkl. sessionGeneration-Erhöhung für die Race-Guards).
  function checkSessionExpiry() {
    const session = PrivateWorkspace.getSession();
    if (!session.active || !session.lastActivity || !(session.timeoutMinutes > 0)) return;
    const elapsedMs = Date.now() - new Date(session.lastActivity).getTime();
    if (elapsedMs >= session.timeoutMinutes * 60 * 1000) {
      PrivateWorkspace.clearSession();
    }
  }

  function formatAutoLockHint(timeoutMinutes) {
    if (!(timeoutMinutes > 0)) return '';
    if (timeoutMinutes >= 1) return 'Auto-Lock: ' + Math.round(timeoutMinutes) + ' Min.';
    return 'Auto-Lock: ' + Math.round(timeoutMinutes * 60) + ' Sek.';
  }

  function refreshWorkspaceView() {
    checkSessionExpiry();
    const session = PrivateWorkspace.getSession();
    if (!session.active) {
      // Auto-Lock: PrivateWorkspace hat den State bereits entfernt. Keine
      // Editor-Änderungen heimlich übernehmen, keine Bestätigung einholen -
      // nur die UI selbst zurücksetzen (siehe Abschnitt 13 der Vorgabe).
      const wasWorkspaceView = !els.viewWorkspace.hidden;
      stopPolling();
      lastFallbackDownloadAt = null;
      // Läuft die Session während ein Dialog offen ist ab, darf dieser nicht
      // über der jetzt gesperrten Ansicht hängen bleiben (Phase-9-Vorgabe 12).
      if (dialogStack.length > 0) forceCloseAllDialogs();
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
    // Rein informativ, keine Live-Sekundenanzeige/kein Countdown (Vorgabe Abschnitt 9).
    els.statusAutoLockHint.textContent = formatAutoLockHint(session.timeoutMinutes);

    els.fallbackHint.hidden = !!PrivateWorkspace.getFileHandle();
  }

  function onWorkspaceOpened() {
    showView('workspace');
    startPolling();
    resetNotesUiState();
    renderNotesList();
    renderEntriesList();
    renderEntryCategoryFilter();
    showEditorEmpty();
    showEntryEditorEmpty();
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
    // Der zuletzt gerenderte Empty-State-Text kann den Suchbegriff enthalten
    // ("Keine Notizen gefunden für „…") - muss beim Zurücksetzen ebenfalls
    // weg, sonst bliebe der Suchbegriff nach Close/Auto-Lock im DOM stehen
    // (Phase-9-Fund, Vorgabe Abschnitt 11).
    els.notesEmpty.textContent = '';
    els.notesEmpty.hidden = true;
    els.editorTitle.value = '';
    els.editorContent.value = '';
    els.editorTags.innerHTML = '';
    els.editorTagInput.value = '';
    els.editorDirtyHint.hidden = true;
    els.notesSearchClear.hidden = true;

    // Entry-Zustand (Phase 7) - dieselben Gründe wie bei Notizen: nach
    // Close/Auto-Lock darf kein Eintrags-Klartext (Titel, Beschreibung,
    // Kategorie, Tags, Field-Label/-Werte) im DOM verbleiben.
    selectedEntryId = null;
    entriesEditorDirty = false;
    currentEntryTags = [];
    currentEntryFields = [];
    entriesSearchQuery = '';
    entryCategoryFilter = '';
    els.entriesSearch.value = '';
    els.entriesSearchClear.hidden = true;
    els.entriesList.innerHTML = '';
    // Siehe Kommentar bei els.notesEmpty oben - gilt identisch für Entries.
    els.entriesEmpty.textContent = '';
    els.entriesEmpty.hidden = true;
    els.entryTitle.value = '';
    els.entryCategory.value = '';
    els.entryDescription.value = '';
    els.entryTags.innerHTML = '';
    els.entryTagInput.value = '';
    els.entryFields.innerHTML = '';
    els.entryEditorDirtyHint.hidden = true;
    els.entryCategoryFilter.innerHTML = '';
    els.entryCategoryFilter.hidden = true;

    // Beim nächsten geöffneten Workspace immer wieder auf dem Notizen-Tab starten.
    activeTab = 'notes';
    els.tabNotes.classList.add('pw-content-tab--active');
    els.tabEntries.classList.remove('pw-content-tab--active');
    els.tabNotes.setAttribute('aria-selected', 'true');
    els.tabEntries.setAttribute('aria-selected', 'false');
    els.notesPanel.hidden = false;
    els.entriesPanel.hidden = true;

    els.workspaceName.textContent = '';
    // Kein irreführender Speicherstatus darf nach Close/Auto-Lock stehen bleiben,
    // auch wenn die Sektion selbst ausgeblendet ist (siehe Phase-6-Vorgabe 10).
    els.statusPill.className = 'pw-status-pill';
    els.statusPill.textContent = '';
    els.statusSavedAt.textContent = '';
    els.statusAutoLockHint.textContent = '';

    // Temporäre Dialogdaten (Phase 8, Vorgabe Abschnitt 8): die dynamisch
    // gesetzten Lösch-/Unsaved-Dialogtexte enthalten zwar nie den eigentlichen
    // Notiz-/Eintragsinhalt (nur generische Bezeichner wie "Eintrag löschen?"),
    // werden aber der Vollständigkeit halber ebenfalls auf den neutralen
    // Ausgangszustand zurückgesetzt.
    els.deleteNoteTitle.textContent = 'Notiz löschen?';
    els.deleteNoteBody.textContent = 'Diese Notiz wird aus dem Workspace entfernt.';
    els.editorUnsavedBody.textContent = 'Diese Notiz enthält Änderungen, die noch nicht übernommen wurden.';

    // Anhänge (Phase 11): ALLE aktiven Object-URLs freigeben (Karten-
    // Thumbnails, Lightbox) - Vorgabe Abschnitt 12/20, kein einziger
    // blob:-Verweis darf ein Close/Auto-Lock/Reset überleben. Der einzige
    // Ort, an dem das geschieht (keine zweite Cleanup-Implementierung).
    revokeAllAttachmentObjectUrls();
    attachmentPreviewObjectUrl = null;
    currentPreviewAttachment = null;
    els.dialogAttachmentPreview.hidden = true;
    els.attachmentPreviewImg.src = '';
    els.attachmentPreviewImg.alt = '';
    els.attachmentPreviewTitle.textContent = 'Anhang';
    els.attachmentPreviewMeta.textContent = '';
    els.editorAttachments.innerHTML = '';
    els.entryAttachments.innerHTML = '';

    showEditorEmpty();
    showEntryEditorEmpty();
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
    renderAttachmentsForContext(getAttachmentContext(false));
  }

  // Gemeinsame Tag-Mechanik für Notizen UND Entries (Phase 7: "keine zweite
  // Implementierung mit abweichendem Verhalten") - trimmen, keine Duplikate,
  // Enter zum Hinzufügen, sichtbare Chips, Entfernen möglich. Notizen und
  // Entries übergeben jeweils nur ihr eigenes Tags-Array/DOM-Ziel/Dirty-Marker.
  function createTagChip(tag, onRemove) {
    const chip = document.createElement('span');
    chip.className = 'pw-tag-chip';

    const label = document.createElement('span');
    label.textContent = tag;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'pw-tag-remove';
    removeBtn.setAttribute('aria-label', 'Tag „' + tag + '“ entfernen');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', onRemove);

    chip.appendChild(label);
    chip.appendChild(removeBtn);
    return chip;
  }

  function renderTagChipsInto(containerEl, tagsArr, renderFn, markDirtyFn) {
    containerEl.innerHTML = '';
    tagsArr.forEach((tag, idx) => {
      containerEl.appendChild(createTagChip(tag, () => {
        tagsArr.splice(idx, 1);
        renderFn();
        markDirtyFn();
      }));
    });
  }

  function addTagFromInputGeneric(inputEl, tagsArr, renderFn, markDirtyFn) {
    const raw = inputEl.value.trim();
    inputEl.value = '';
    if (!raw || tagsArr.includes(raw)) return; // leere/doppelte Tags ignorieren
    tagsArr.push(raw);
    renderFn();
    markDirtyFn();
    inputEl.focus();
  }

  function renderTagChips() {
    renderTagChipsInto(els.editorTags, currentEditorTags, renderTagChips, markEditorDirty);
  }

  function addTagFromInput() {
    addTagFromInputGeneric(els.editorTagInput, currentEditorTags, renderTagChips, markEditorDirty);
  }

  function renderEntryTagChips() {
    renderTagChipsInto(els.entryTags, currentEntryTags, renderEntryTagChips, markEntryEditorDirty);
  }

  function addEntryTagFromInput() {
    addTagFromInputGeneric(els.entryTagInput, currentEntryTags, renderEntryTagChips, markEntryEditorDirty);
  }

  function markEditorDirty() {
    if (editorDirty) return;
    editorDirty = true;
    els.editorDirtyHint.hidden = false;
  }

  // ── Anhänge: gemeinsame Render-/Aktions-Logik (Phase 11) ─
  //
  // Ein generischer Kontext (Notiz vs. Eintrag) statt zweier abweichender
  // Implementierungen - gleiches Prinzip wie currentEditorDirty()/
  // withEditorGuard() oben (Dispatch statt Duplikation, Vorgabe Abschnitt 5/21).

  function getAttachmentContext(isEntry) {
    return isEntry
      ? {
          kind: 'entry',
          id: selectedEntryId,
          getAttachments: PrivateWorkspace.getEntryAttachments,
          addAttachment: PrivateWorkspace.addEntryAttachment,
          deleteAttachment: PrivateWorkspace.deleteEntryAttachment,
          containerEl: els.entryAttachments,
          emptyEl: els.entryAttachmentsEmpty,
          markDirty: markEntryEditorDirty
        }
      : {
          kind: 'note',
          id: selectedNoteId,
          getAttachments: PrivateWorkspace.getNoteAttachments,
          addAttachment: PrivateWorkspace.addNoteAttachment,
          deleteAttachment: PrivateWorkspace.deleteNoteAttachment,
          containerEl: els.editorAttachments,
          emptyEl: els.editorAttachmentsEmpty,
          markDirty: markEditorDirty
        };
  }

  // Da Notizen/Einträge sich einen einzigen physischen Editor-DOM-Bereich
  // teilen (kein Editor pro Notiz), muss vor einem DOM-Rerender nach einem
  // asynchronen Upload geprüft werden, ob zwischenzeitlich zu einer anderen
  // Notiz/einem anderen Eintrag gewechselt wurde - der Anhang selbst landet
  // in jedem Fall korrekt an der ursprünglichen Notiz/dem ursprünglichen
  // Eintrag (ctx.id bleibt dabei unverändert), nur die Anzeige darf nicht
  // versehentlich die Anhänge der falschen Notiz in den sichtbaren Editor rendern.
  function isAttachmentContextStillActive(ctx) {
    return ctx.kind === 'entry' ? selectedEntryId === ctx.id : selectedNoteId === ctx.id;
  }

  function renderAttachmentsInto(containerEl, emptyEl, attachments) {
    // Vorschau-Object-URLs des bisherigen Renderings dieses Containers
    // freigeben, bevor er neu befüllt wird - sonst häufen sich bei jedem
    // erneuten Rendern (z.B. nach Hinzufügen/Entfernen) verwaiste Blob-URLs an.
    containerEl.querySelectorAll('img[data-object-url]').forEach(img => revokeAttachmentObjectUrl(img.dataset.objectUrl));
    containerEl.innerHTML = '';
    emptyEl.hidden = attachments.length > 0;

    attachments.forEach(att => {
      const card = document.createElement('div');
      card.className = 'pw-attachment-card';

      const previewUrl = createAttachmentObjectUrl(att);
      const img = document.createElement('img');
      img.className = 'pw-attachment-thumb';
      img.src = previewUrl;
      img.dataset.objectUrl = previewUrl;
      // Dateiname landet ausschließlich als alt-Attribut/textContent im DOM -
      // niemals als HTML interpretiert (Vorgabe Abschnitt 19), auch bei
      // absichtlich bösartigen Namen wie "<img src=x onerror=...>.png".
      img.alt = att.name;
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.addEventListener('click', () => openAttachmentPreview(att));
      img.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAttachmentPreview(att); }
      });
      card.appendChild(img);

      const meta = document.createElement('div');
      meta.className = 'pw-attachment-meta';
      const nameEl = document.createElement('div');
      nameEl.className = 'pw-attachment-name';
      nameEl.textContent = att.name;
      const sizeEl = document.createElement('div');
      sizeEl.className = 'pw-attachment-size';
      sizeEl.textContent = formatFileSize(att.size);
      meta.appendChild(nameEl);
      meta.appendChild(sizeEl);
      card.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'pw-attachment-actions';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'pw-btn';
      openBtn.textContent = 'Öffnen';
      openBtn.addEventListener('click', () => openAttachmentPreview(att));
      actions.appendChild(openBtn);

      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'pw-btn';
      downloadBtn.textContent = 'Herunterladen';
      downloadBtn.addEventListener('click', () => downloadAttachment(att));
      actions.appendChild(downloadBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'pw-btn pw-btn-danger';
      removeBtn.textContent = 'Entfernen';
      removeBtn.setAttribute('aria-label', 'Anhang „' + att.name + '“ entfernen');
      removeBtn.addEventListener('click', () => handleAttachmentRemove(getAttachmentContextForAttachmentOwner(att), att));
      actions.appendChild(removeBtn);

      card.appendChild(actions);
      containerEl.appendChild(card);
    });
  }

  // "Entfernen" wird aus der Karte heraus aufgerufen, ohne dass die Karte
  // selbst weiß, ob sie zu einer Notiz oder einem Eintrag gehört - der
  // aktuell aktive Tab entscheidet das eindeutig (siehe activeTab), exakt
  // wie beim bestehenden Löschen-Dialog (handleDeleteClick/-Confirm).
  function getAttachmentContextForAttachmentOwner() {
    return getAttachmentContext(activeTab === 'entries');
  }

  function renderAttachmentsForContext(ctx) {
    if (!ctx.id) {
      revokeAllAttachmentObjectUrlsIn(ctx.containerEl);
      ctx.containerEl.innerHTML = '';
      ctx.emptyEl.hidden = false;
      return;
    }
    renderAttachmentsInto(ctx.containerEl, ctx.emptyEl, ctx.getAttachments(ctx.id));
  }

  function revokeAllAttachmentObjectUrlsIn(containerEl) {
    containerEl.querySelectorAll('img[data-object-url]').forEach(img => revokeAttachmentObjectUrl(img.dataset.objectUrl));
  }

  async function handleAttachmentFileChosen(ctx, file) {
    if (!file || !ctx.id) return;
    try {
      await ctx.addAttachment(ctx.id, file);
    } catch (err) {
      logSafeError('attachment-add', err);
      showToast(describeWorkspaceError(err), 'error');
      return;
    }
    if (isAttachmentContextStillActive(ctx)) {
      renderAttachmentsForContext(ctx);
      ctx.markDirty();
    }
    refreshWorkspaceView();
  }

  function handleAttachmentRemove(ctx, att) {
    if (!ctx.id) return;
    try {
      ctx.deleteAttachment(ctx.id, att.id);
    } catch (err) {
      logSafeError('attachment-remove', err);
      showToast(describeWorkspaceError(err), 'error');
      return;
    }
    renderAttachmentsForContext(ctx);
    ctx.markDirty();
    refreshWorkspaceView();
  }

  function closeAttachmentPreview() {
    closeDialog(els.dialogAttachmentPreview);
    if (attachmentPreviewObjectUrl) {
      revokeAttachmentObjectUrl(attachmentPreviewObjectUrl);
      attachmentPreviewObjectUrl = null;
    }
    currentPreviewAttachment = null;
    els.attachmentPreviewImg.src = '';
    els.attachmentPreviewImg.alt = '';
  }

  function openAttachmentPreview(att) {
    if (attachmentPreviewObjectUrl) revokeAttachmentObjectUrl(attachmentPreviewObjectUrl);
    attachmentPreviewObjectUrl = createAttachmentObjectUrl(att);
    currentPreviewAttachment = att;
    els.attachmentPreviewTitle.textContent = att.name;
    els.attachmentPreviewImg.src = attachmentPreviewObjectUrl;
    els.attachmentPreviewImg.alt = att.name;
    els.attachmentPreviewMeta.textContent = formatFileSize(att.size) + ' · ' + att.type;
    openDialog(els.dialogAttachmentPreview, els.attachmentPreviewCloseBtn);
  }

  // Object-URL bewusst nur temporär für den eigentlichen Download-Klick -
  // wird unmittelbar danach wieder freigegeben (Vorgabe Abschnitt 14),
  // Original-Dateiname und MIME-Typ bleiben erhalten.
  function downloadAttachment(att) {
    const url = createAttachmentObjectUrl(att);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => revokeAttachmentObjectUrl(url), 2000);
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
    renderAttachmentsForContext(getAttachmentContext(false));
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

  // Alle Aktionen, die den aktuell im Editor angezeigten Inhalt verlassen
  // (andere Notiz/anderen Eintrag wählen, neu anlegen, Notes<->Entries
  // wechseln, Workspace schließen), laufen über diesen EINEN Guard - bewusst
  // keine zweite, unabhängige Dirty-Dialog-Architektur für Entries (Phase 7,
  // Vorgabe Abschnitt 10). Welcher der beiden Editoren gemeint ist, ergibt
  // sich aus dem zum Aufrufzeitpunkt aktiven Tab.
  function currentEditorDirty() {
    return activeTab === 'entries' ? entriesEditorDirty : editorDirty;
  }

  function withEditorGuard(action) {
    if (!currentEditorDirty()) { action(); return; }
    pendingEditorGuardAction = action;
    els.editorUnsavedBody.textContent = activeTab === 'entries'
      ? 'Dieser Eintrag enthält Änderungen, die noch nicht übernommen wurden.'
      : 'Diese Notiz enthält Änderungen, die noch nicht übernommen wurden.';
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

  // Ein gemeinsamer Löschen-Dialog für Notizen UND Entries (Phase 7, Vorgabe
  // Abschnitt 13/23: bestehenden Bestätigungsdialog wiederverwenden statt
  // einen zweiten zu bauen) - Überschrift/Text werden je nach aktivem Tab
  // gesetzt, Mechanik (Dialog, Fokus, Escape/Backdrop) bleibt identisch.
  function handleDeleteClick() {
    const isEntry = activeTab === 'entries';
    const id = isEntry ? selectedEntryId : selectedNoteId;
    if (!id) return;
    els.deleteNoteTitle.textContent = isEntry ? 'Eintrag löschen?' : 'Notiz löschen?';
    els.deleteNoteBody.textContent = isEntry ? 'Dieser Eintrag wird aus dem Workspace entfernt.' : 'Diese Notiz wird aus dem Workspace entfernt.';
    openDialog(els.dialogDeleteNote, els.deleteNoteCancel);
  }

  function handleDeleteConfirm() {
    const isEntry = activeTab === 'entries';
    const id = isEntry ? selectedEntryId : selectedNoteId;
    if (!id) { closeDialog(els.dialogDeleteNote); return; }
    try {
      if (isEntry) PrivateWorkspace.deleteEntry(id); else PrivateWorkspace.deleteNote(id);
    } catch (err) {
      logSafeError(isEntry ? 'entry-delete' : 'note-delete', err);
      showToast(describeWorkspaceError(err), 'error');
      closeDialog(els.dialogDeleteNote);
      return;
    }
    closeDialog(els.dialogDeleteNote);

    if (isEntry) {
      entriesEditorDirty = false; // ein gelöschter Eintrag kann keine zu übernehmenden Änderungen mehr haben
      const remaining = getFilteredSortedEntries();
      if (remaining.length > 0) {
        loadEntryIntoEditor(remaining[0].id);
      } else {
        selectedEntryId = null;
        showEntryEditorEmpty();
      }
      renderEntriesList();
      renderEntryCategoryFilter();
      showToast('Eintrag gelöscht.', 'warning');
    } else {
      editorDirty = false; // eine gelöschte Notiz kann keine zu übernehmenden Änderungen mehr haben
      const remaining = getFilteredSortedNotes();
      if (remaining.length > 0) {
        loadNoteIntoEditor(remaining[0].id);
      } else {
        selectedNoteId = null;
        showEditorEmpty();
      }
      renderNotesList();
      showToast('Notiz gelöscht.', 'warning');
    }
    refreshWorkspaceView();
  }

  // ── Entries: Liste, Suche, Kategorie-Filter, Editor ──────
  //
  // Struktureller Zwilling der Notizen-Sektion oben - keine zweite
  // Datenhaltung, jede Anzeige liest frisch über PrivateWorkspace.getEntries()/
  // getEntry(). Kategorien werden dynamisch aus den vorhandenen Entries
  // abgeleitet, nicht hart codiert (Vorgabe Abschnitt 11).

  function getFilteredSortedEntries() {
    const entries = PrivateWorkspace.getEntries();
    entries.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    let filtered = entries;
    if (entryCategoryFilter) {
      filtered = filtered.filter(e => (e.category || '') === entryCategoryFilter);
    }
    const q = entriesSearchQuery.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q) ||
      (e.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (e.fields || []).some(f => (f.label || '').toLowerCase().includes(q) || (f.value || '').toLowerCase().includes(q))
    );
  }

  function getEntryCategories() {
    const set = new Set();
    PrivateWorkspace.getEntries().forEach(e => { if (e.category && e.category.trim()) set.add(e.category.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
  }

  function renderEntryCategoryFilter() {
    const categories = getEntryCategories();
    els.entryCategoryFilter.innerHTML = '';
    if (categories.length === 0) {
      els.entryCategoryFilter.hidden = true;
      entryCategoryFilter = '';
      return;
    }
    // Falls die zuletzt gewählte Kategorie durch Löschen/Umbenennen
    // verschwunden ist, den Filter sauber auf "Alle" zurücksetzen.
    if (entryCategoryFilter && !categories.includes(entryCategoryFilter)) {
      entryCategoryFilter = '';
    }
    els.entryCategoryFilter.hidden = false;

    function makePill(label, value) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-category-pill' + (entryCategoryFilter === value ? ' pw-category-pill--active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        entryCategoryFilter = entryCategoryFilter === value ? '' : value;
        renderEntryCategoryFilter();
        renderEntriesList();
      });
      return btn;
    }

    els.entryCategoryFilter.appendChild(makePill('Alle', ''));
    categories.forEach(cat => els.entryCategoryFilter.appendChild(makePill(cat, cat)));
  }

  function renderEntriesList() {
    if (!PrivateWorkspace.hasWorkspace()) return;

    const allEntries = PrivateWorkspace.getEntries();
    const visibleEntries = getFilteredSortedEntries();

    els.entriesList.innerHTML = '';

    if (allEntries.length === 0) {
      els.entriesEmpty.textContent = 'Noch keine Einträge. Erstelle deinen ersten strukturierten Eintrag.';
      els.entriesEmpty.hidden = false;
      els.entriesList.hidden = true;
      return;
    }
    if (visibleEntries.length === 0) {
      els.entriesEmpty.textContent = entriesSearchQuery.trim()
        ? 'Keine Einträge gefunden für „' + entriesSearchQuery.trim() + '“.'
        : 'Keine Einträge für diese Kategorie gefunden.';
      els.entriesEmpty.hidden = false;
      els.entriesList.hidden = true;
      return;
    }
    els.entriesEmpty.hidden = true;
    els.entriesList.hidden = false;

    visibleEntries.forEach(entry => {
      const li = document.createElement('li');
      li.className = 'pw-note-item';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-note-item-btn';
      btn.setAttribute('aria-current', entry.id === selectedEntryId ? 'true' : 'false');
      // Die Entry-ID wandert bewusst nur als Closure-Variable in den Handler,
      // nicht als data-Attribut ins DOM (siehe Sicherheitsvorgabe Abschnitt 17).
      btn.addEventListener('click', () => selectEntry(entry.id));

      const titleEl = document.createElement('div');
      titleEl.className = 'pw-note-item-title';
      titleEl.textContent = entry.title && entry.title.trim() ? entry.title : 'Unbenannter Eintrag';
      btn.appendChild(titleEl);

      if (entry.category) {
        const catEl = document.createElement('div');
        catEl.className = 'pw-note-item-meta';
        catEl.textContent = entry.category;
        btn.appendChild(catEl);
      }

      if (entry.description) {
        const descEl = document.createElement('div');
        descEl.className = 'pw-note-item-preview';
        descEl.textContent = entry.description.slice(0, 80);
        btn.appendChild(descEl);
      }

      if (entry.modified) {
        const metaEl = document.createElement('div');
        metaEl.className = 'pw-note-item-meta';
        metaEl.textContent = 'Geändert: ' + formatDateTime(entry.modified);
        btn.appendChild(metaEl);
      }

      if (entry.tags && entry.tags.length) {
        const tagsEl = document.createElement('div');
        tagsEl.className = 'pw-note-item-tags';
        entry.tags.forEach(t => {
          const chip = document.createElement('span');
          chip.className = 'pw-note-item-tag';
          chip.textContent = t;
          tagsEl.appendChild(chip);
        });
        btn.appendChild(tagsEl);
      }

      li.appendChild(btn);
      els.entriesList.appendChild(li);
    });
  }

  function showEntryEditorEmpty() {
    els.entryEditorForm.hidden = true;
    els.entryEditorEmpty.hidden = false;
    const hasAnyEntries = PrivateWorkspace.hasWorkspace() && PrivateWorkspace.getEntries().length > 0;
    if (hasAnyEntries) {
      els.entryEditorEmptyText.textContent = 'Wähle einen Eintrag aus oder erstelle einen neuen.';
      els.entryEditorEmptyCta.hidden = true;
    } else {
      els.entryEditorEmptyText.textContent = 'Noch keine Einträge. Erstelle deinen ersten strukturierten Eintrag.';
      els.entryEditorEmptyCta.hidden = false;
    }
    renderAttachmentsForContext(getAttachmentContext(true));
  }

  function renderEntryFieldRows() {
    els.entryFields.innerHTML = '';
    currentEntryFields.forEach((field, idx) => {
      const row = document.createElement('div');
      row.className = 'pw-entry-field-row';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'pw-input pw-entry-field-label';
      labelInput.placeholder = 'Label';
      labelInput.value = field.label;
      labelInput.setAttribute('aria-label', 'Feld-Label');
      labelInput.addEventListener('input', () => { currentEntryFields[idx].label = labelInput.value; markEntryEditorDirty(); });

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'pw-input pw-entry-field-value';
      valueInput.placeholder = 'Wert';
      valueInput.value = field.value;
      valueInput.setAttribute('aria-label', 'Feld-Wert');
      valueInput.addEventListener('input', () => { currentEntryFields[idx].value = valueInput.value; markEntryEditorDirty(); });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'pw-entry-field-remove';
      removeBtn.setAttribute('aria-label', 'Feld entfernen');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        currentEntryFields.splice(idx, 1);
        renderEntryFieldRows();
        markEntryEditorDirty();
      });

      row.appendChild(labelInput);
      row.appendChild(valueInput);
      row.appendChild(removeBtn);
      els.entryFields.appendChild(row);
    });
  }

  function handleAddFieldClick() {
    currentEntryFields.push({ label: '', value: '' });
    renderEntryFieldRows();
    markEntryEditorDirty();
    const labelInputs = els.entryFields.querySelectorAll('.pw-entry-field-label');
    const last = labelInputs[labelInputs.length - 1];
    if (last) last.focus();
  }

  function markEntryEditorDirty() {
    if (entriesEditorDirty) return;
    entriesEditorDirty = true;
    els.entryEditorDirtyHint.hidden = false;
  }

  function loadEntryIntoEditor(id) {
    const entry = PrivateWorkspace.getEntry(id);
    if (!entry) {
      selectedEntryId = null;
      showEntryEditorEmpty();
      return;
    }
    selectedEntryId = id;
    els.entryEditorForm.hidden = false;
    els.entryEditorEmpty.hidden = true;
    els.entryTitle.value = entry.title;
    els.entryCategory.value = entry.category;
    els.entryDescription.value = entry.description;
    currentEntryTags = entry.tags.slice();
    renderEntryTagChips();
    els.entryTagInput.value = '';
    currentEntryFields = entry.fields.map(f => ({ label: f.label, value: f.value }));
    renderEntryFieldRows();
    renderAttachmentsForContext(getAttachmentContext(true));
    entriesEditorDirty = false;
    els.entryEditorDirtyHint.hidden = true;
  }

  function commitEntryEditorChanges() {
    if (!selectedEntryId) return;
    const title = els.entryTitle.value;
    const category = els.entryCategory.value;
    const description = els.entryDescription.value;
    const trimmedTags = currentEntryTags.map(t => t.trim()).filter(t => t.length > 0);
    const tags = trimmedTags.filter((t, i) => trimmedTags.indexOf(t) === i);
    const fields = currentEntryFields.map(f => ({ label: f.label, value: f.value }));

    try {
      PrivateWorkspace.updateEntry(selectedEntryId, { title, category, description, tags, fields });
      entriesEditorDirty = false;
      els.entryEditorDirtyHint.hidden = true;
      renderEntriesList();
      renderEntryCategoryFilter();
      showToast('Eintrag gespeichert.', 'success');
    } catch (err) {
      logSafeError('entry-save', err);
      showToast(describeWorkspaceError(err), 'error');
    }
    refreshWorkspaceView();
  }

  function selectEntry(id) {
    if (id === selectedEntryId) return;
    withEditorGuard(() => {
      loadEntryIntoEditor(id);
      renderEntriesList();
    });
  }

  function handleNewEntryClick() {
    withEditorGuard(() => {
      let entry;
      try {
        entry = PrivateWorkspace.addEntry({});
      } catch (err) {
        logSafeError('entry-create', err);
        showToast(describeWorkspaceError(err), 'error');
        return;
      }
      renderEntriesList();
      renderEntryCategoryFilter();
      loadEntryIntoEditor(entry.id);
      renderEntriesList(); // aria-current auf den neuen Eintrag aktualisieren
      els.entryTitle.focus();
      refreshWorkspaceView();
    });
  }

  // ── Notes/Entries-Umschalter ──────────────────────────────
  //
  // Reiner Sichtbarkeits-Wechsel, kein erneutes Entschlüsseln/Öffnen und kein
  // Reset des jeweils anderen Bereichs - bestehender Zustand (Auswahl, Suche)
  // bleibt beim Zurückwechseln erhalten (Vorgabe Abschnitt 6).
  function switchTab(tab) {
    if (tab === activeTab) return;
    withEditorGuard(() => {
      activeTab = tab;
      els.tabNotes.classList.toggle('pw-content-tab--active', tab === 'notes');
      els.tabEntries.classList.toggle('pw-content-tab--active', tab === 'entries');
      els.tabNotes.setAttribute('aria-selected', tab === 'notes' ? 'true' : 'false');
      els.tabEntries.setAttribute('aria-selected', tab === 'entries' ? 'true' : 'false');
      els.notesPanel.hidden = tab !== 'notes';
      els.entriesPanel.hidden = tab !== 'entries';
      // Sinnvoller Fokus im jetzt aktiven Bereich, statt auf einem jetzt
      // ausgeblendeten Element des vorherigen Tabs stehen zu bleiben.
      if (tab === 'notes') els.btnNewNote.focus(); else els.btnNewEntry.focus();
    });
  }

  // ── In neuem Fenster öffnen (Phase 8) ────────────────────
  //
  // Bewusst schlicht gehalten: normales window.open() auf die bestehende
  // Seite, ohne Query-Parameter/Payload/postMessage - das neue Fenster startet
  // komplett frisch auf der Start-Ansicht und öffnet seinen eigenen Workspace
  // selbst. "noopener,noreferrer" verhindert zusätzlich jeden Rückkanal
  // (window.opener) vom neuen zum alten Fenster. Es gibt keine gemeinsame
  // Session, keinen Cross-Window-Storage und keinen Datei-/Passwort-Transfer -
  // jedes Fenster ist danach eine vollständig unabhängige PrivateWorkspace-
  // Instanz (eigenes Modul-Closure-State pro Tab/Fenster/Prozess).
  //
  // Muss synchron und direkt aus dem Klick-Handler aufgerufen werden - jeder
  // await/setTimeout davor lässt Popup-Blocker den Aufruf verwerfen, weil er
  // dann nicht mehr als direkte Folge einer Nutzer-Geste gilt.
  function handleOpenInNewWindowClick() {
    // Explizite width/height-Fenstermerkmale signalisieren dem Browser ein
    // eigenständiges Popup-Fenster statt eines Tabs (siehe handleOpenInNewTabClick
    // unten, die bewusst OHNE diese Merkmale aufruft) - dasselbe Ziel, derselbe
    // "noopener,noreferrer"-Schutz, kein gemeinsamer State zwischen den Fenstern.
    const newWindow = window.open('private.html', '_blank', 'noopener,noreferrer,width=1100,height=800');
    if (!newWindow) {
      showToast('Das neue Fenster konnte nicht geöffnet werden. Bitte erlaube Pop-ups für diese Seite.', 'error');
    }
    // Kein Erfolgs-Toast bei geglücktem Öffnen (Vorgabe: keine Meldung, wenn
    // der Browser erfolgreich geöffnet hat) - das neue Fenster spricht für sich.
  }

  // Gleiches Ziel, ohne Fenstermerkmale - Browser öffnen ein window.open() ohne
  // width/height-Angabe standardmäßig als regulären Tab statt als Popup-Fenster.
  function handleOpenInNewTabClick() {
    const newTab = window.open('private.html', '_blank', 'noopener,noreferrer');
    if (!newTab) {
      showToast('Der neue Tab konnte nicht geöffnet werden. Bitte erlaube Pop-ups für diese Seite.', 'error');
    }
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
  els.btnNewWindow.addEventListener('click', handleOpenInNewWindowClick);
  els.btnNewTab.addEventListener('click', handleOpenInNewTabClick);
  els.btnCreate.addEventListener('click', () => {
    resetCreateDialog();
    openDialog(els.dialogCreate, els.createName);
  });
  els.btnLockedReopen.addEventListener('click', () => showView('start'));

  els.createForm.addEventListener('submit', (e) => { e.preventDefault(); handleCreateSubmit(); });
  els.createPickLocation.addEventListener('click', handleCreatePickLocation);
  els.createCancel.addEventListener('click', () => { resetCreateDialog(); closeDialog(els.dialogCreate); });
  els.createClose.addEventListener('click', () => { resetCreateDialog(); closeDialog(els.dialogCreate); });
  // Bewusst kein wireBackdropCancel() hier: beim Ausfüllen von Name/Passwort
  // soll ein versehentlicher Klick neben den Dialog die Eingaben nicht
  // verwerfen - nur "Abbrechen" oder das X schließen den Dialog.

  wireBackdropCancel(els.dialogPassword, els.passwordCancel);

  els.btnClose.addEventListener('click', handleCloseClick);
  els.btnSave.addEventListener('click', handleSaveClick);
  els.btnSaveAs.addEventListener('click', handleSaveAsClick);

  els.unsavedSaveClose.addEventListener('click', handleUnsavedSaveClose);
  els.unsavedDiscard.addEventListener('click', handleUnsavedDiscard);
  els.unsavedCancel.addEventListener('click', handleUnsavedCancel);
  wireBackdropCancel(els.dialogUnsaved, els.unsavedCancel);

  // Notes/Entries-Umschalter
  els.tabNotes.addEventListener('click', () => switchTab('notes'));
  els.tabEntries.addEventListener('click', () => switchTab('entries'));

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
  els.editorDelete.addEventListener('click', handleDeleteClick);

  // Entries
  els.btnNewEntry.addEventListener('click', handleNewEntryClick);
  els.entryEditorEmptyCta.addEventListener('click', handleNewEntryClick);
  els.entriesSearch.addEventListener('input', () => {
    entriesSearchQuery = els.entriesSearch.value;
    els.entriesSearchClear.hidden = entriesSearchQuery.length === 0;
    renderEntriesList();
  });
  els.entriesSearchClear.addEventListener('click', () => {
    entriesSearchQuery = '';
    els.entriesSearch.value = '';
    els.entriesSearchClear.hidden = true;
    renderEntriesList();
    els.entriesSearch.focus();
  });

  els.entryTitle.addEventListener('input', markEntryEditorDirty);
  els.entryCategory.addEventListener('input', markEntryEditorDirty);
  els.entryDescription.addEventListener('input', markEntryEditorDirty);
  els.entryTagAdd.addEventListener('click', addEntryTagFromInput);
  els.entryTagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addEntryTagFromInput(); }
  });
  els.entryFieldAdd.addEventListener('click', handleAddFieldClick);
  els.entrySave.addEventListener('click', commitEntryEditorChanges);
  els.entryDelete.addEventListener('click', handleDeleteClick);

  // ── Anhänge (Phase 11): Upload-Button + verstecktes File-Input ──────────
  // Ein Hinzufügen ändert bewusst nur Editor-/RAM-Zustand (siehe
  // handleAttachmentFileChosen -> PrivateWorkspace.add(Note|Entry)Attachment)
  // - kein automatisches Speichern der .support-Datei (Vorgabe Abschnitt 8).
  els.editorAttachmentAdd.addEventListener('click', () => els.editorAttachmentInput.click());
  els.editorAttachmentInput.addEventListener('change', () => {
    const file = els.editorAttachmentInput.files && els.editorAttachmentInput.files[0];
    els.editorAttachmentInput.value = '';
    handleAttachmentFileChosen(getAttachmentContext(false), file);
  });
  els.entryAttachmentAdd.addEventListener('click', () => els.entryAttachmentInput.click());
  els.entryAttachmentInput.addEventListener('change', () => {
    const file = els.entryAttachmentInput.files && els.entryAttachmentInput.files[0];
    els.entryAttachmentInput.value = '';
    handleAttachmentFileChosen(getAttachmentContext(true), file);
  });

  // ── Anhänge: Strg/Cmd+V direkt im aktiven Editor (Phase 11) ─────────────
  // Nur eingreifen, wenn tatsächlich ein Bild im Clipboard liegt - normales
  // Text-Paste bleibt in jedem anderen Fall komplett unangetastet (Vorgabe
  // Abschnitt 10). Enthält die Zwischenablage zusätzlich Text, wird bewusst
  // nur der Bild-Anhang übernommen (kein zusätzlicher Aufwand für ein sehr
  // seltenes Mischszenario, siehe Vorgabe "kein unnötiger Mehraufwand").
  function wireAttachmentPasteHandler(formEl, isEntry) {
    formEl.addEventListener('paste', (e) => {
      if (!e.clipboardData || !e.clipboardData.items) return;
      let imageItem = null;
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        const item = e.clipboardData.items[i];
        if (item.kind === 'file' && item.type && item.type.startsWith('image/')) { imageItem = item; break; }
      }
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      handleAttachmentFileChosen(getAttachmentContext(isEntry), file);
    });
  }
  wireAttachmentPasteHandler(els.editorForm, false);
  wireAttachmentPasteHandler(els.entryEditorForm, true);

  // ── Anhänge: Vorschau-/Lightbox-Dialog ───────────────────────────────────
  els.attachmentPreviewClose.addEventListener('click', closeAttachmentPreview);
  els.attachmentPreviewCloseBtn.addEventListener('click', closeAttachmentPreview);
  els.attachmentPreviewDownload.addEventListener('click', () => {
    if (currentPreviewAttachment) downloadAttachment(currentPreviewAttachment);
  });
  wireBackdropCancel(els.dialogAttachmentPreview, els.attachmentPreviewCloseBtn);

  els.editorUnsavedApply.addEventListener('click', () => {
    if (activeTab === 'entries') commitEntryEditorChanges(); else commitEditorChanges();
    closeDialog(els.dialogEditorUnsaved);
    const action = pendingEditorGuardAction; pendingEditorGuardAction = null;
    if (action) action();
  });
  els.editorUnsavedDiscard.addEventListener('click', () => {
    // Nicht nur den Dirty-Flag löschen, sondern den Editor auch aus dem
    // persistierten State neu laden - sonst bliebe der verworfene Entwurf
    // optisch stehen, falls die anschließende Aktion (z.B. Tab-Wechsel) den
    // gerade verlassenen Editor nicht selbst neu befüllt.
    if (activeTab === 'entries') {
      entriesEditorDirty = false;
      els.entryEditorDirtyHint.hidden = true;
      if (selectedEntryId) loadEntryIntoEditor(selectedEntryId); else showEntryEditorEmpty();
    } else {
      editorDirty = false;
      els.editorDirtyHint.hidden = true;
      if (selectedNoteId) loadNoteIntoEditor(selectedNoteId); else showEditorEmpty();
    }
    closeDialog(els.dialogEditorUnsaved);
    const action = pendingEditorGuardAction; pendingEditorGuardAction = null;
    if (action) action();
  });
  els.editorUnsavedCancel.addEventListener('click', () => {
    closeDialog(els.dialogEditorUnsaved);
    pendingEditorGuardAction = null;
  });
  wireBackdropCancel(els.dialogEditorUnsaved, els.editorUnsavedCancel);

  els.deleteNoteConfirm.addEventListener('click', handleDeleteConfirm);
  els.deleteNoteCancel.addEventListener('click', () => closeDialog(els.dialogDeleteNote));
  wireBackdropCancel(els.dialogDeleteNote, els.deleteNoteCancel);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.dialogCreate.hidden) els.createCancel.click();
    else if (!els.dialogPassword.hidden) els.passwordCancel.click();
    else if (!els.dialogAttachmentPreview.hidden) els.attachmentPreviewCloseBtn.click();
    else if (!els.dialogEditorUnsaved.hidden) els.editorUnsavedCancel.click();
    else if (!els.dialogDeleteNote.hidden) els.deleteNoteCancel.click();
    else if (!els.dialogUnsaved.hidden) els.unsavedCancel.click();
  });

  // ── Keyboard Shortcuts (Phase 8) ──────────────────────────
  // Ctrl/Cmd+S -> Speichern, Ctrl/Cmd+Shift+S -> Speichern unter … Bewusst nur
  // ein dünner Dispatch auf die bereits bestehenden Handler/Buttons - kein
  // zweiter Save-Mechanismus, kein eigener Guard. Der disabled-Zustand der
  // Buttons (siehe setSaveButtonsBusy()) verhindert bereits zuverlässig eine
  // zweite parallele Save-Operation; der Generation-Guard in
  // private-workspace.js bleibt davon komplett unberührt.
  document.addEventListener('keydown', (e) => {
    if (!((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's')) return;
    if (els.viewWorkspace.hidden) return; // außerhalb des geöffneten Workspace: normales Browserverhalten unangetastet lassen
    // In jedem Fall verhindern, dass der Browser-eigene "Seite speichern"-
    // Dialog zusätzlich aufgeht - unabhängig davon, ob unser Save unten
    // tatsächlich ausgeführt wird.
    e.preventDefault();
    if (dialogStack.length > 0) return; // Vorgabe: Shortcuts lösen nicht aus, wenn ein Dialog aktiv ist
    if (e.shiftKey) {
      if (!els.btnSaveAs.hidden && !els.btnSaveAs.disabled) handleSaveAsClick();
    } else if (!els.btnSave.disabled) {
      handleSaveClick();
    }
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

  // ── Anhänge: Größenlimit-Hinweis (Phase 11) ──────────────
  // Kein hartkodierter Zweitwert im Markup - liest denselben, in
  // private-workspace.js einmalig definierten Grenzwert.
  (function initAttachmentHints() {
    const mb = Math.round(PrivateWorkspace.MAX_ATTACHMENT_BYTES / (1024 * 1024));
    const text = 'Max. ' + mb + ' MB pro Bild.';
    els.editorAttachmentHint.textContent = text;
    els.entryAttachmentHint.textContent = text;
  })();

  // ── Init ─────────────────────────────────────────────────
  showView('start');
})();
