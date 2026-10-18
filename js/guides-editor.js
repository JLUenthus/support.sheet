// ============================================================
// guide.sheet – guides-editor.js (Phase 5+6 – Editor & Import)
// Neu anlegen ODER bearbeiten (?id=), Markdown-Toolbar, Live-Vorschau,
// Bild-Upload, Entwurf (localStorage), MD/TXT/DOCX-Import.
// Nutzt ausschließlich GuidesDB für Persistenz.
// Erwartet vor dieser Datei: guides-db.js, marked.min.js, safe-markdown.js,
// mammoth.min.js, turndown.min.js.
// ============================================================
(function() {
  // Entwürfe: siehe js/guides-drafts.js (ein Entwurf je Guide) und den Block "Entwurf (localStorage)" unten
  let newDraftKey    = null;  // Entwurfsschluessel eines NEUEN Guides in dieser Sitzung (gs-draft:new:<uuid>)
  let editorReady    = false; // erst wenn Grundzustand (baseline) feststeht, werden Entwuerfe geschrieben
  let recoveryPending = false; // gefundener Entwurf zu diesem Guide ist noch unentschieden: nie ueberschreiben, Formular gesperrt
  let baselineState  = null;  // Formularzustand = gespeicherter Stand
  let baselineSig    = '';
  let draftTimer     = null;
  let draftWritten   = false;
  let draftAt        = null;  // Zeitpunkt des letzten erfolgreichen Entwurfs (Anzeige)
  let lastSavedAt    = null;  // Zeitpunkt des letzten Speicherns (Anzeige)
  const pendingAssetData = new Map(); // filename -> Base64-Data-URL (Kopie fuer den Entwurf)
  let pendingRenames = [];            // vorgemerkte Umbenennungen gespeicherter Bilder [{ from, to }] – erst beim Speichern angewendet
  const PERSIST = { persistent: true }; // Fehlermeldungen, die Datenverlust betreffen: bleiben bis zum Schliessen

  let categories       = [];
  let tags             = [];
  let links            = []; // [{ id, url, offlineAsset, offlineSavedAt }]
  let linkIdCounter    = 0;
  let attachments        = []; // [{ id, name, size, type, assetFile }]
  let attachmentIdCounter = 0;
  const pendingAttachmentFiles = new Map(); // assetFile -> File (noch nicht gespeichert)
  let currentGuideId   = null;
  let existingMeta      = null;
  let loadedVersion     = null; // meta.version beim Laden (Bearbeiten-Modus) – Grundlage der Konfliktpruefung beim Speichern
  let loadedStamp       = null; // Dateizeiten beim Laden (Ordnermodus)
  const pendingAssets     = new Map(); // filename -> File|Blob (noch nicht gespeichert)
  const assetPreviewUrls  = new Map(); // filename -> Blob-URL (nur für Live-Vorschau)
  let existingAssetNames  = new Set(); // bereits auf der Platte gespeicherte Asset-Dateinamen (Edit-Modus)
  let importImageCounter = 0;

  let titleInput, categorySelect, subcategoryInput, tagInput, tagsPillsEl, textarea, preview, privateNoteInput, privateNoteDetails, linksRowsEl, attachmentsRowsEl, attachmentsHintEl;

  // Gibt alle noch offenen Live-Vorschau-Blob-URLs frei und leert die Map.
  // Nach einem erfolgreichen Speichern (saveGuide()) ist das ein regulärer
  // Aufräumschritt; über den beforeunload-Listener unten greift dieselbe
  // Funktion auch, wenn der Editor ohne zu speichern verlassen wird (Klick
  // auf einen anderen Link, Tab schließen, Zurück-Navigation) – sonst
  // blieben die Blob-URLs der eingefügten Bilder für die Dauer der
  // Session ungenutzt im Speicher.
  function revokeAssetPreviewUrls() {
    assetPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    assetPreviewUrls.clear();
  }

  // Cursor-Position vor Öffnen des Link-Dialogs merken
  let _linkCursorStart = 0;
  let _linkCursorEnd   = 0;

  // Vorschläge für häufige Status-Tags – per Klick an/abwählbar.
  const SUGGESTED_TAGS = ['unfertig', 'überarbeiten', 'wichtig', 'geprüft', 'veraltet'];

  function notify(message, type_, options) {
    if (typeof showToast === 'function') showToast(message, type_, options);
  }

  // Markdown kollabiert normalerweise JEDE Anzahl Leerzeilen zu genau einem
  // Absatzabstand. Damit mehrfaches Enter auch in der Live-Vorschau (und
  // später in der Guide-Ansicht, siehe guides-view.js) zusätzlichen Abstand
  // ergibt, wird jede Leerzeile über die erste hinaus als eigener Spacer
  // ins gerenderte HTML übernommen – außer innerhalb von Code-Blöcken
  // (```...```), da dort Whitespace ohnehin 1:1 erhalten bleibt.
  function preserveBlankLines(md) {
    if (!md) return md;
    const parts = md.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (i % 2 === 1) return part; // Code-Block – unverändert
      return part.replace(/\n{3,}/g, (match) => {
        const extra = match.length - 2;
        return '\n\n' + Array(extra).fill('<div class="gv-blank-line"></div>').join('\n\n') + '\n\n';
      });
    }).join('');
  }

  function resolveEditId() {
    return new URLSearchParams(location.search).get('id');
  }

  // ── Prefill aus URL-Parameter (z.B. "Als Guide speichern" im
  // Troubleshooting Wizard) ─────────────────────────────────
  // Nur an der Aufrufstelle unten fuer NEUE Guides genutzt (nie wenn
  // resolveEditId() eine ID liefert) – sonst koennte ein zufaelliger
  // ?prefill=-Parameter eine bestehende Guide ueberschreiben.
  function applyPrefillFromUrl() {
    const prefillParam = new URLSearchParams(location.search).get('prefill');
    if (!prefillParam) return;

    let prefill;
    try {
      // Gegenstueck zu wizard-renderer.js toBase64():
      // btoa(unescape(encodeURIComponent(str))) -> decodeURIComponent(escape(atob(str)))
      prefill = JSON.parse(decodeURIComponent(escape(atob(prefillParam))));
    } catch (err) {
      console.warn('[guides-editor] Prefill-Parameter ungültig:', err);
      return; // Seite oeffnet einfach leer, kein Fehler nach aussen
    }
    if (!prefill || typeof prefill !== 'object') return;

    if (prefill.title && titleInput) {
      titleInput.value = String(prefill.title);
    }

    // Kategorie: nur gesetzt falls eine Option mit exakt diesem Wert
    // existiert (categorySelect.value ist sonst ein stiller No-op).
    if (prefill.category && categorySelect) {
      categorySelect.value = prefill.category;
    }
    if (prefill.subcategory && subcategoryInput) {
      subcategoryInput.value = String(prefill.subcategory);
    }

    // Tags ueber die bestehende Tag-Logik setzen (commitTag() + tags[]),
    // nicht ueber das Eingabefeld simulieren – das wuerde den letzten Tag
    // ohne abschließendes Komma unkommitiert im Input stehen lassen.
    if (Array.isArray(prefill.tags)) {
      prefill.tags.forEach(t => { if (t) commitTag(String(t)); });
      renderTagPills();
    }

    if (prefill.content && textarea) {
      textarea.value = String(prefill.content);
      updatePreview();
    }
  }

  // ── Cursor-Helfer für die Toolbar ───────────────────────
  function insertWrap(ta, before, after, placeholder) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const value = ta.value;
    const selected = value.slice(start, end) || placeholder || '';
    ta.value = value.slice(0, start) + before + selected + (after || '') + value.slice(end);
    ta.focus();
    ta.setSelectionRange(start + before.length, start + before.length + selected.length);
    ta.dispatchEvent(new Event('input'));
  }

  function insertRaw(ta, text) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const value = ta.value;
    ta.value = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event('input'));
  }

  // Ohne Auswahl: eine leere Aufgabenzeile einfügen. Mit mehrzeiliger
  // Auswahl: jede nicht-leere Zeile in eine eigene Checklisten-Zeile
  // umwandeln – passt zu den anklickbaren Checklisten in der Guide-Ansicht.
  function insertChecklist(ta) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const value = ta.value;
    const selected = value.slice(start, end);
    const inserted = selected
      ? selected.split('\n').map(line => line ? '- [ ] ' + line : line).join('\n')
      : '- [ ] Aufgabe';
    ta.value = value.slice(0, start) + inserted + value.slice(end);
    ta.focus();
    ta.setSelectionRange(start, start + inserted.length);
    ta.dispatchEvent(new Event('input'));
  }

  // ── Tags ─────────────────────────────────────────────────
  function renderTagPills() {
    tagsPillsEl.replaceChildren();
    tags.forEach((tag, i) => {
      const pill = document.createElement('span');
      pill.className = 'ge-tag-pill';
      pill.textContent = tag;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ge-tag-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Tag entfernen');
      remove.addEventListener('click', () => { tags.splice(i, 1); renderTagPills(); });
      pill.appendChild(remove);
      tagsPillsEl.appendChild(pill);
    });
    renderTagSuggestions();
    if (typeof scheduleAutosave === 'function') scheduleAutosave();
  }

  // Vorgefertigte Status-Tags, an/abwählbar per Klick – kein Enter nötig.
  function renderTagSuggestions() {
    const container = document.getElementById('ge-tag-suggestions');
    if (!container) return;
    container.replaceChildren();
    SUGGESTED_TAGS.forEach((tag) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ge-tag-suggestion' + (tags.includes(tag) ? ' active' : '');
      btn.textContent = tag;
      btn.addEventListener('click', () => {
        if (tags.includes(tag)) tags = tags.filter((t) => t !== tag);
        else tags.push(tag);
        renderTagPills();
      });
      container.appendChild(btn);
    });
  }

  function commitTag(raw) {
    const val = raw.trim();
    if (val && !tags.includes(val)) tags.push(val);
  }

  // Text aus dem Eingabefeld als Tag übernehmen – von Enter, Komma,
  // Blur (Klick woanders) und dem "+ Hinzufügen"-Button gemeinsam genutzt.
  function commitFromInput() {
    if (!tagInput.value.trim()) return;
    commitTag(tagInput.value);
    tagInput.value = '';
    renderTagPills();
  }

  function initTagsInput() {
    tagInput.addEventListener('input', () => {
      if (tagInput.value.includes(',')) {
        const parts = tagInput.value.split(',');
        const last = parts.pop();
        parts.forEach(commitTag);
        tagInput.value = last;
        renderTagPills();
      }
    });
    tagInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      commitFromInput();
    });
    // Wer einfach woanders hinklickt, soll den getippten Tag nicht verlieren.
    tagInput.addEventListener('blur', commitFromInput);

    document.getElementById('ge-tag-add-btn')?.addEventListener('click', commitFromInput);
  }

  // ── Links ────────────────────────────────────────────────
  // offlineAsset/offlineSavedAt werden hier nur durchgereicht (nicht im
  // Editor bearbeitet) – die Offline-Kopie wird ausschließlich in der
  // Guide-Ansicht angelegt/aktualisiert, damit ein erneutes Speichern im
  // Editor eine bereits heruntergeladene Kopie nicht verwirft.
  function renderLinks() {
    linksRowsEl.replaceChildren();
    links.forEach((link) => {
      const row = document.createElement('div');
      row.className = 'ge-link-row';

      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'ge-link-input ge-link-text-input';
      textInput.placeholder = 'Linktext (optional)';
      textInput.value = link.text || '';
      textInput.addEventListener('input', () => { link.text = textInput.value; scheduleAutosave(); });

      const urlInput = document.createElement('input');
      urlInput.type = 'url';
      urlInput.className = 'ge-link-input ge-link-url-input';
      urlInput.placeholder = 'https://…';
      urlInput.value = link.url || '';
      urlInput.addEventListener('input', () => { link.url = urlInput.value; scheduleAutosave(); });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ge-link-remove';
      remove.setAttribute('aria-label', 'Link entfernen');
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        links = links.filter((l) => l.id !== link.id);
        renderLinks();
        scheduleAutosave();
      });

      row.appendChild(textInput);
      row.appendChild(urlInput);
      row.appendChild(remove);
      linksRowsEl.appendChild(row);
    });
  }

  function addLinkRow(prefill) {
    links.push(Object.assign({
      id: 'link-' + Date.now() + '-' + (++linkIdCounter),
      text: '', url: '', offlineAsset: null, offlineSavedAt: null,
    }, prefill || {}));
    renderLinks();
  }

  function initLinksInput() {
    document.getElementById('ge-link-add-btn')?.addEventListener('click', () => { addLinkRow(); scheduleAutosave(); });
  }

  // ── Dateien (Anhänge) ────────────────────────────────────
  // Anders als Bilder werden Anhänge nicht im Entwurf (localStorage)
  // zwischengespeichert – Setup-Dateien etc. können beliebig groß sein und
  // würden das Draft-Quota sofort sprengen. Die Datei selbst wird erst beim
  // finalen Speichern (saveGuide) über GuidesDB.saveAsset abgelegt.
  function formatFileSize(bytes) {
    if (bytes == null) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return (i === 0 ? val : val.toFixed(1)) + ' ' + units[i];
  }

  function sanitizeAttachmentName(name) {
    return (name || 'datei').replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  function updateAttachmentsHint() {
    if (!attachmentsHintEl) return;
    const db = window.GuidesDB;
    attachmentsHintEl.hidden = !(!db.isFilesystemMode() || !db.isConnected());
  }

  function renderAttachments() {
    attachmentsRowsEl.replaceChildren();
    attachments.forEach((att) => {
      const row = document.createElement('div');
      row.className = 'ge-attachment-row';

      const name = document.createElement('span');
      name.className = 'ge-attachment-name';
      name.textContent = att.name + (att.size != null ? ' (' + formatFileSize(att.size) + ')' : '');
      row.appendChild(name);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ge-link-remove';
      remove.setAttribute('aria-label', 'Datei entfernen');
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        attachments = attachments.filter((a) => a.id !== att.id);
        pendingAttachmentFiles.delete(att.assetFile);
        renderAttachments();
        scheduleAutosave();
      });
      row.appendChild(remove);

      attachmentsRowsEl.appendChild(row);
    });
  }

  function addAttachmentFile(file) {
    if (file.size > MAX_ASSET_SIZE) {
      notify('Datei zu groß: ' + (file.size / 1024 / 1024).toFixed(1) + ' MB. Maximum: ' + MAX_ASSET_SIZE_MB + ' MB.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify('Große Datei: ' + (file.size / 1024 / 1024).toFixed(1) + ' MB – das kann die Performance beeinflussen.', 'warning');
    }
    const id = 'att-' + Date.now() + '-' + (++attachmentIdCounter);
    const assetFile = 'attachment-' + id + '-' + sanitizeAttachmentName(file.name);
    attachments.push({ id, name: file.name, size: file.size, type: file.type || '', assetFile });
    pendingAttachmentFiles.set(assetFile, file);
    renderAttachments();
  }

  function initAttachmentsInput() {
    updateAttachmentsHint();
    document.addEventListener('guides-db-connected', updateAttachmentsHint);
    document.addEventListener('guides-db-disconnected', updateAttachmentsHint);

    document.getElementById('ge-attachment-add-btn')?.addEventListener('click', () => {
      updateAttachmentsHint();
      document.getElementById('ge-attachment-input')?.click();
    });
    document.getElementById('ge-attachment-input')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) { addAttachmentFile(file); scheduleAutosave(); }
    });
  }

  // ── Split/Editor/Vorschau-Umschalter ─────────────────────
  function initViewToggle() {
    const buttons = document.querySelectorAll('#ge-view-toggle .gg-view-btn');
    const wrap = document.getElementById('ge-editor-wrap');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        wrap.dataset.mode = btn.dataset.mode;
      });
    });
  }

  // ── Toolbar ──────────────────────────────────────────────
  function initToolbar() {
    document.querySelectorAll('#ge-toolbar button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        switch (btn.dataset.action) {
          case 'h1':        insertWrap(textarea, '# ', '', 'Überschrift'); break;
          case 'h2':        insertWrap(textarea, '## ', '', 'Überschrift'); break;
          case 'h3':        insertWrap(textarea, '### ', '', 'Überschrift'); break;
          case 'bullet':    insertRaw(textarea, '\n- '); break;
          case 'ordered':   insertRaw(textarea, '\n1. '); break;
          case 'bold':      insertWrap(textarea, '**', '**', 'fett'); break;
          case 'italic':    insertWrap(textarea, '*', '*', 'kursiv'); break;
          case 'code':      insertWrap(textarea, '`', '`', 'code'); break;
          case 'codeblock': insertWrap(textarea, '\n```\n', '\n```\n', 'code'); break;
          case 'powershell': insertRaw(textarea, '\n| PowerShell |\n|---|\n| # Kommentar |\n| `Befehl` |\n'); break;
          case 'cmd':        insertRaw(textarea, '\n| CMD |\n|---|\n| # Kommentar |\n| `Befehl` |\n'); break;
          case 'link':      openLinkDialog(); break;
          case 'image':     document.getElementById('ge-image-input').click(); break;
          case 'table':     openTableDialog(); break;
          case 'checklist': insertChecklist(textarea); break;
          case 'align-left':   insertWrap(textarea, '<div style="text-align:left">\n\n', '\n\n</div>', 'Text'); break;
          case 'align-center': insertWrap(textarea, '<div style="text-align:center">\n\n', '\n\n</div>', 'Text'); break;
          case 'align-right':  insertWrap(textarea, '<div style="text-align:right">\n\n', '\n\n</div>', 'Text'); break;
          case 'emoji':        toggleEmojiPicker(btn); break;
        }
      });
    });
  }

  // ── Link-Dialog ──────────────────────────────────────────
  function openLinkDialog() {
    _linkCursorStart = textarea.selectionStart;
    _linkCursorEnd   = textarea.selectionEnd;
    // Selektierten Text als Linktext vorausfüllen
    const selected = textarea.value.slice(_linkCursorStart, _linkCursorEnd);
    document.getElementById('link-dialog-text').value = selected || '';
    document.getElementById('link-dialog-url').value  = '';

    document.getElementById('link-dialog').hidden = false;
    // Fokus auf erstes leeres Feld
    const textInput = document.getElementById('link-dialog-text');
    const urlInput  = document.getElementById('link-dialog-url');
    if (!textInput.value) textInput.focus();
    else urlInput.focus();
  }

  function closeLinkDialog() {
    document.getElementById('link-dialog').hidden = true;
    textarea.focus();
  }

  function insertLink() {
    const text = document.getElementById('link-dialog-text').value.trim();
    const url  = document.getElementById('link-dialog-url').value.trim();
    if (!url) return;

    const linkText = text || url;
    const markdown = '[' + linkText + '](' + url + ')';

    const before = textarea.value.slice(0, _linkCursorStart);
    const after  = textarea.value.slice(_linkCursorEnd);
    textarea.value = before + markdown + after;
    // Cursor hinter den eingefügten Link setzen
    const newPos = _linkCursorStart + markdown.length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.dispatchEvent(new Event('input')); // Live-Vorschau aktualisieren
    textarea.focus();

    closeLinkDialog();
  }

  function initLinkDialog() {
    document.getElementById('link-dialog-close')?.addEventListener('click', closeLinkDialog);
    document.getElementById('link-dialog-cancel')?.addEventListener('click', closeLinkDialog);
    document.getElementById('link-dialog-ok')?.addEventListener('click', insertLink);
    document.querySelector('.link-dialog-backdrop')?.addEventListener('click', closeLinkDialog);

    // Enter im URL-Feld = Einfügen
    document.getElementById('link-dialog-url')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') insertLink();
      if (e.key === 'Escape') closeLinkDialog();
    });

    // Enter im Text-Feld = Sprung zu URL
    document.getElementById('link-dialog-text')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('link-dialog-url')?.focus();
      }
      if (e.key === 'Escape') closeLinkDialog();
    });
  }

  // ── Tabellen-Dialog ──────────────────────────────────────
  function openTableDialog() {
    document.getElementById('table-dialog').hidden = false;
    document.getElementById('table-cols').focus();
  }

  function closeTableDialog() {
    document.getElementById('table-dialog').hidden = true;
    textarea.focus();
  }

  function insertTable() {
    const cols   = parseInt(document.getElementById('table-cols').value) || 2;
    const rows   = parseInt(document.getElementById('table-rows').value) || 3;
    const header = document.getElementById('table-header').value || 'Spalte';

    const headers = Array.from({ length: cols }, (_, i) => ` ${header} ${i + 1} `).join('|');
    const divider = Array.from({ length: cols }, () => '----------').join('|');
    const row     = Array.from({ length: cols }, () => ' Wert ').join('|');
    const rowsStr = Array.from({ length: rows }, () => `|${row}|`).join('\n');

    const table = `\n|${headers}|\n|${divider}|\n${rowsStr}\n`;
    insertRaw(textarea, table);
    closeTableDialog();
  }

  function initTableDialog() {
    document.getElementById('table-dialog-close')?.addEventListener('click', closeTableDialog);
    document.getElementById('table-dialog-cancel')?.addEventListener('click', closeTableDialog);
    document.getElementById('table-dialog-ok')?.addEventListener('click', insertTable);
    document.querySelector('#table-dialog .link-dialog-backdrop')?.addEventListener('click', closeTableDialog);
  }

  // ── Emoji-Picker ─────────────────────────────────────────
  const EMOJIS = [
    // Status
    '✅','❌','⚠️','ℹ️','🔴','🟡','🟢','🔵',
    // IT / Tech
    '💻','🖥️','🖨️','⌨️','🖱️','📱','📡','🔌','💾','💿','🖧',
    '🔧','🔩','⚙️','🛠️','🔑','🔐','🔒','🔓','🛡️',
    // Netzwerk / Cloud
    '🌐','📶','☁️','🔗','🌍',
    // Dokumente / Dateien
    '📄','📋','📁','📂','🗂️','📝','📊','📈','📉',
    // Aktionen
    '▶️','⏹️','⏸️','🔄','♻️','📥','📤','⬆️','⬇️',
    '➕','➖','✏️','🗑️','📌','📍','🔍','🔎',
    // Personen / Teams
    '👤','👥','👨‍💻','👩‍💻','🤝','👋',
    // Misc
    '⭐','💡','🚀','🎯','🏷️','💬','📢','🔔',
    '✨','🎉','🚨','⚡','🔥','❄️','🌟',
  ];

  // Zeigt aktuell immer alle Emojis unabhaengig von der Sucheingabe – eine
  // echte Suche nach Namen (z.B. "warnung" -> ⚠️) braeuchte ein eigenes
  // Emoji->Stichwort-Mapping, das hier bewusst noch nicht angelegt wurde.
  function renderEmojiGrid(list) {
    const grid = document.getElementById('ge-emoji-grid');
    grid.replaceChildren();
    list.forEach(emoji => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ge-emoji-btn';
      btn.textContent = emoji;
      btn.title = emoji;
      btn.addEventListener('click', () => {
        insertRaw(textarea, emoji);
        document.getElementById('ge-emoji-picker').hidden = true;
      });
      grid.appendChild(btn);
    });
  }

  // Positioniert den Picker unterhalb des Toolbar-Buttons. Der Picker ist
  // im DOM ein Geschwister-Element von .ge-toolbar (kein Nachfahre) und
  // nutzt deshalb position:fixed mit per getBoundingClientRect() berechneten
  // Viewport-Koordinaten statt sich auf einen position:relative-Vorfahren
  // zu verlassen – das waere hier nicht wirksam.
  function positionEmojiPicker(anchorBtn) {
    const picker = document.getElementById('ge-emoji-picker');
    const rect = anchorBtn.getBoundingClientRect();
    const pickerWidth = 280;
    let left = rect.left;
    if (left + pickerWidth > window.innerWidth - 8) left = window.innerWidth - pickerWidth - 8;
    picker.style.top  = (rect.bottom + 4) + 'px';
    picker.style.left = Math.max(8, left) + 'px';
  }

  function toggleEmojiPicker(anchorBtn) {
    const picker = document.getElementById('ge-emoji-picker');
    const willShow = picker.hidden;
    picker.hidden = !willShow;
    if (willShow) {
      positionEmojiPicker(anchorBtn);
      document.getElementById('ge-emoji-search')?.focus();
    }
  }

  function initEmojiPicker() {
    const picker = document.getElementById('ge-emoji-picker');
    const search = document.getElementById('ge-emoji-search');
    if (!picker || !search) return;

    renderEmojiGrid(EMOJIS);

    search.addEventListener('input', () => {
      // Einfache Filterung (Emojis haben keinen Text-Index, daher
      // vorerst immer alle zeigen – siehe Kommentar bei renderEmojiGrid).
      renderEmojiGrid(EMOJIS);
    });

    document.addEventListener('click', (e) => {
      if (!picker.hidden && !picker.contains(e.target) && !e.target.closest('[data-action="emoji"]')) {
        picker.hidden = true;
      }
    });
  }

  // ── Bild-Upload (Toolbar + Drag&Drop) ───────────────────
  function sanitizeFilename(name) {
    return (name || '').replace(/[^a-zA-Z0-9._-]/g, '_') || ('image-' + Date.now() + '.png');
  }

  // Muss sowohl gegen bereits ausgewählte (pendingAssets) als auch gegen
  // bereits auf der Platte gespeicherte Bilder (existingAssetNames) prüfen –
  // sonst bekommt ein zweites eingefügtes Bild mit gleichem Namen (z.B. zwei
  // per Strg+V eingefügte Screenshots heißen oft beide "image.png") beim
  // Speichern denselben Dateinamen und überschreibt so lautlos das zuvor
  // bereits gespeicherte Bild (Ursache für "Bilder manchmal kaputt").
  function uniqueAssetName(name) {
    let candidate = sanitizeFilename(name);
    let i = 1;
    while (pendingAssets.has(candidate) || existingAssetNames.has(candidate)) {
      const dot = candidate.lastIndexOf('.');
      const base = dot > -1 ? candidate.slice(0, dot) : candidate;
      const ext  = dot > -1 ? candidate.slice(dot) : '';
      candidate = base + '-' + (++i) + ext;
    }
    return candidate;
  }

  const MAX_ASSET_SIZE_MB = 10;
  const MAX_ASSET_SIZE    = MAX_ASSET_SIZE_MB * 1024 * 1024;

  function handleImageFile(file) {
    if (!file.type || !file.type.startsWith('image/')) {
      notify('Nur Bilddateien werden unterstützt.', 'error');
      return;
    }
    if (file.size > MAX_ASSET_SIZE) {
      notify('Datei zu groß: ' + (file.size / 1024 / 1024).toFixed(1) + ' MB. Maximum: ' + MAX_ASSET_SIZE_MB + ' MB.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify('Große Datei: ' + (file.size / 1024 / 1024).toFixed(1) + ' MB – das kann die Performance beeinflussen.', 'warning');
    }
    const filename = uniqueAssetName(file.name);
    registerPendingAsset(filename, file);
    assetPreviewUrls.set(filename, URL.createObjectURL(file));
    insertRaw(textarea, '![' + filename + '](assets/' + filename + ')');
  }

  function initImageUpload() {
    const fileInput = document.getElementById('ge-image-input');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) handleImageFile(file);
    });

    textarea.addEventListener('dragover', (e) => { e.preventDefault(); textarea.classList.add('ge-drag'); });
    textarea.addEventListener('dragleave', () => textarea.classList.remove('ge-drag'));
    textarea.addEventListener('drop', (e) => {
      e.preventDefault();
      textarea.classList.remove('ge-drag');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleImageFile(file);
    });

    // Screenshot/Bild per Strg+V direkt aus der Zwischenablage einfügen.
    // Nur abfangen wenn wirklich ein Bild im Clipboard liegt – normales
    // Text-Einfügen bleibt sonst unangetastet.
    textarea.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) handleImageFile(file);
          break;
        }
      }
    });
  }

  // ── Bilder-Browser (bereits gespeicherte Bilder anzeigen/umbenennen) ────
  // Zeigt nur Bilder, die schon auf der Platte liegen (Edit-Modus) – neu
  // eingefügte, noch ungespeicherte Bilder (pendingAssets) landen ohnehin
  // sofort als Referenz im Text und müssen hier nicht separat auftauchen.
  const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

  async function buildImageRow(filename) {
    const row = document.createElement('div');
    row.className = 'ge-image-row';

    const thumb = document.createElement('img');
    thumb.className = 'ge-image-thumb';
    if (currentGuideId) {
      const urlRes = await window.GuidesDB.getAssetUrl(currentGuideId, sourceNameOf(filename)); // vorgemerkte Umbenennung: Daten des alten Namens
      if (urlRes.success) thumb.src = urlRes.url;
    }
    row.appendChild(thumb);

    const name = document.createElement('span');
    name.className = 'ge-image-name';
    name.textContent = filename;
    row.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'ge-image-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'gs-folder-btn';
    renameBtn.textContent = '✏️ Umbenennen';
    renameBtn.addEventListener('click', () => renameExistingImage(filename));
    actions.appendChild(renameBtn);

    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'gs-folder-btn';
    insertBtn.textContent = '📋 In Guide einfügen';
    insertBtn.addEventListener('click', () => insertRaw(textarea, '![' + filename + '](assets/' + filename + ')'));
    actions.appendChild(insertBtn);

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'gs-folder-btn';
    downloadBtn.textContent = '📥 Herunterladen';
    downloadBtn.addEventListener('click', () => downloadImage(filename, downloadBtn));
    actions.appendChild(downloadBtn);

    row.appendChild(actions);
    return row;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function downloadImage(filename, btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Lade…';
    try {
      const urlRes = await window.GuidesDB.getAssetUrl(currentGuideId, sourceNameOf(filename));
      if (!urlRes.success) throw new Error(urlRes.error || 'Bild nicht gefunden.');
      const blob = await (await fetch(urlRes.url)).blob();
      downloadBlob(blob, filename);
    } catch (err) {
      notify('Download fehlgeschlagen: ' + (err?.message || err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  async function renderImageBrowser() {
    const listEl = document.getElementById('ge-images-list');
    if (!listEl) return;
    const images = [...existingAssetNames].map(displayNameOf).filter((name) => IMAGE_EXT_RE.test(name));
    listEl.replaceChildren();
    if (!images.length) {
      const empty = document.createElement('div');
      empty.className = 'ge-images-empty';
      empty.textContent = currentGuideId ? 'Keine Bilder gespeichert.' : 'Noch kein Guide gespeichert – hier erscheinen Bilder erst nach dem ersten Speichern.';
      listEl.appendChild(empty);
      return;
    }
    for (const name of images) {
      listEl.appendChild(await buildImageRow(name));
    }
  }

  // Umbenennen wird nur VORGEMERKT: im Formular wird der Text umgeschrieben (alle Schreibweisen der Verweise,
  // GuidesDB.rewriteAssetReferences), auf Platte und in der Datenbank aendert sich nichts. Erst "Speichern" legt das
  // neue Asset an, speichert den Guide und verschiebt danach das alte in den Asset-Papierkorb (siehe saveGuide).
  // Schliesst man ohne Speichern, ist alles unveraendert; die Vormerkung steht im Entwurf.
  function sourceNameOf(shownName) { const r = pendingRenames.find((x) => x.to === shownName); return r ? r.from : shownName; }
  function displayNameOf(storedName) { const r = pendingRenames.find((x) => x.from === storedName); return r ? r.to : storedName; }
  function assetNameTaken(name) {
    return existingAssetNames.has(name) || pendingAssets.has(name) || pendingRenames.some((r) => r.to === name);
  }

  async function renameExistingImage(shownName) {
    const source = sourceNameOf(shownName);
    const input = (prompt('Neuer Dateiname:', shownName) || '').trim();
    if (!input || input === shownName) return;
    // bereinigen: nur [A-Za-z0-9._-] (keine Pfadzeichen), keine fuehrenden Punkte, Dateiendung des Bilds bleibt
    const ext = (/\.[A-Za-z0-9]+$/.exec(source) || [''])[0];
    let newName = sanitizeAttachmentName(input).replace(/^\.+/, '');
    if (ext && !newName.toLowerCase().endsWith(ext.toLowerCase())) newName = newName.replace(/\.[A-Za-z0-9]+$/, '') + ext;
    if (!newName || newName === ext) { notify('Ungültiger Dateiname.', 'error'); return; }
    if (newName === shownName) return;
    const backToOrigin = newName === source;   // zurueck auf den gespeicherten Namen: keine Umbenennung mehr
    if (!backToOrigin && assetNameTaken(newName)) {
      notify('Datei „' + newName + '“ existiert bereits (oder ist für eine andere Umbenennung vorgemerkt).', 'error');
      return;
    }
    textarea.value = window.GuidesDB.rewriteAssetReferences(textarea.value, shownName, newName);
    pendingRenames = pendingRenames.filter((r) => r.from !== source);   // Kette: am Ende gilt nur der letzte Name
    if (!backToOrigin) pendingRenames.push({ from: source, to: newName });
    await updatePreview();
    scheduleAutosave();
    notify(backToOrigin ? 'Umbenennung zurückgenommen.' : 'Umbenennung vorgemerkt – sie wird beim Speichern angewendet.', 'success');
    await renderImageBrowser();
  }

  function initImageBrowser() {
    const toggleBtn = document.getElementById('ge-images-toggle');
    const listEl = document.getElementById('ge-images-list');
    if (!toggleBtn || !listEl) return;
    toggleBtn.addEventListener('click', async () => {
      const willShow = listEl.hidden;
      listEl.hidden = !willShow;
      toggleBtn.textContent = willShow ? '🖼️ Gespeicherte Bilder ausblenden' : '🖼️ Gespeicherte Bilder anzeigen';
      if (willShow) await renderImageBrowser();
    });
  }

  // ── Live-Vorschau ────────────────────────────────────────
  async function resolveAssetsForPreview(md) {
    const regex = /assets\/([^\s)"'\]]+)/g;
    const names = new Set();
    let m;
    while ((m = regex.exec(md))) names.add(m[1]);
    if (!names.size) return md;

    const map = new Map();
    await Promise.all([...names].map(async (name) => {
      if (assetPreviewUrls.has(name)) { map.set(name, assetPreviewUrls.get(name)); return; }
      if (currentGuideId) {
        const res = await window.GuidesDB.getAssetUrl(currentGuideId, sourceNameOf(name)); // vorgemerkte Umbenennung: Vorschau aus den Daten des alten Assets
        if (res.success) map.set(name, res.url);
      }
    }));

    return md.replace(regex, (match, name) => map.get(name) || match);
  }

  async function updatePreview() {
    const md = textarea.value;
    if (window.SafeMarkdown) {
      // Auch der eigene Text kann eingefügten oder importierten Fremdinhalt enthalten: gefiltert rendern (siehe js/safe-markdown.js)
      const resolved = await resolveAssetsForPreview(md);
      window.SafeMarkdown.renderInto(preview, preserveBlankLines(resolved));
    } else {
      const pre = document.createElement('pre');
      pre.textContent = md;
      preview.replaceChildren(pre);
    }
  }

  function initLivePreview() {
    let timer;
    textarea.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(updatePreview, 300);
    });
  }

  // ── Kategorien laden ─────────────────────────────────────
  async function loadCategories() {
    const res = await window.GuidesDB.getCategories();
    categories = res.categories || [];
    categorySelect.replaceChildren();
    categories.forEach((cat) => {
      const o = document.createElement('option');
      o.value = cat.name;
      o.textContent = cat.name;
      categorySelect.appendChild(o);
    });
  }

  // ── Entwurf (localStorage) ───────────────────────────────
  // Modell (js/guides-drafts.js): ein Entwurf je Guide, "gs-draft:<guideId>"; neue Guides "gs-draft:new:<uuid>".
  // Geschrieben wird SYNCHRON (Schreibpuffer): bei Eingabe (hoechstens alle 300 ms), sofort bei Fokusverlust,
  // wenn der Tab versteckt wird und bei pagehide. Misslingt das Schreiben (auch Speicher voll), steht ein
  // dauerhaftes Banner mit "Als Datei sichern". Geloescht wird ein Entwurf erst, wenn die Datenbank das
  // Speichern bestaetigt hat. Bilder aus pendingAssets liegen als Base64 im Entwurf – sonst verweist der
  // wiederhergestellte Text auf assets/*, die nie gespeichert wurden; die Umwandlung laeuft beim Hinzufuegen
  // (asynchron), damit das Schreiben des Entwurfs selbst synchron bleiben kann.
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mime = (header.match(/data:(.*?);base64/) || [, 'image/png'])[1];
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function registerPendingAsset(filename, blob) {
    pendingAssets.set(filename, blob);
    fileToDataUrl(blob)
      .then((url) => { if (pendingAssets.has(filename)) { pendingAssetData.set(filename, url); scheduleAutosave(); } })
      .catch(() => { /* einzelnes Bild bleibt ohne Entwurfskopie, Rest des Entwurfs wird trotzdem gesichert */ });
  }

  function currentDraftKey() {
    if (currentGuideId) return window.GuidesDrafts.keyFor(currentGuideId);
    if (!newDraftKey) newDraftKey = window.GuidesDrafts.newKey();
    return newDraftKey;
  }

  // Formularzustand (Grundlage von "ungespeicherte Aenderungen" und vom Entwurf)
  function formState() {
    return {
      title: titleInput.value, category: categorySelect.value, subcategory: subcategoryInput.value,
      tags: [...tags], content: textarea.value, privateNote: privateNoteInput.value,
      links: links.map((l) => ({ id: l.id, text: l.text || '', url: l.url || '', offlineAsset: l.offlineAsset || null, offlineSavedAt: l.offlineSavedAt || null })),
      attachments: attachments.map((a) => ({ id: a.id, name: a.name, size: a.size, type: a.type, assetFile: a.assetFile })),
      pendingImages: [...pendingAssets.keys()], pendingFiles: [...pendingAttachmentFiles.keys()],
      renames: pendingRenames.map((r) => r.from + '>' + r.to),
    };
  }

  function isDirty() { return window.GuidesDrafts.signature(formState()) !== baselineSig; }

  // Gespeicherter Stand = dieser Zustand (beim Laden, nach erfolgreichem Speichern)
  function setBaseline(state) {
    baselineState = state || formState();
    baselineSig = window.GuidesDrafts.signature(baselineState);
    editorReady = true;
  }

  const hhmm = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  // Zustandsanzeige: "Gespeichert um hh:mm" / "Ungespeicherte Änderungen" / "… – Entwurf gesichert um hh:mm"
  function updateStatus() {
    const el = document.getElementById('ge-autosave-status');
    if (!el || !editorReady) return;
    if (isDirty()) el.textContent = 'Ungespeicherte Änderungen' + (draftAt ? ' – Entwurf gesichert um ' + hhmm(draftAt) : '');
    else el.textContent = lastSavedAt ? 'Gespeichert um ' + hhmm(lastSavedAt) : '';
  }

  function buildDraft() {
    const st = formState();
    const assets = {};
    st.pendingImages.forEach((n) => { if (pendingAssetData.has(n)) assets[n] = pendingAssetData.get(n); });
    return {
      v: 2, key: currentDraftKey(), guideId: currentGuideId || null,
      baseVersion: currentGuideId ? loadedVersion : null, savedAt: new Date().toISOString(),
      title: st.title, category: st.category, subcategory: st.subcategory, tags: st.tags, content: st.content,
      privateNote: st.privateNote, links: st.links,
      // Dateien, die noch nicht gespeichert sind, passen nicht in den Entwurf (beliebig gross): nur ihre Namen
      attachments: st.attachments.filter((a) => !pendingAttachmentFiles.has(a.assetFile)),
      pendingAttachmentNames: st.pendingFiles.map((f) => (attachments.find((a) => a.assetFile === f) || {}).name || f),
      pendingRenames: pendingRenames.map((r) => ({ from: r.from, to: r.to })),
      assets,
    };
  }

  // Schreibt den Entwurf sofort und synchron. Rueckgabe true bei Erfolg. force: auch ohne Aenderung schreiben.
  function flushDraft(opts) {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    if (!editorReady || recoveryPending) return false; // solange ein gefundener Entwurf unentschieden ist, nie ueberschreiben
    const force = !!(opts && opts.force);
    if (!force && !isDirty()) {
      // Formular entspricht dem gespeicherten Stand: ein eigener Entwurf ist ueberfluessig
      if (draftWritten) { window.GuidesDrafts.remove(currentDraftKey()); draftWritten = false; draftAt = null; }
      hideDraftAlert();
      updateStatus();
      return true;
    }
    try {
      const written = window.GuidesDrafts.write(buildDraft());
      draftWritten = true;
      draftAt = new Date();
      hideDraftAlert();
      // Text ist gesichert; passten Bilder nicht in den Speicher, steht ein Hinweis (kein rotes Banner)
      if (written && written.missing && written.missing.length) showDraftNotice(written.missing); else hideDraftNotice();
      updateStatus();
      return true;
    } catch (err) {
      showDraftAlert(err);
      updateStatus();
      return false;
    }
  }

  // Aufruf bei jeder Aenderung: gedrosselt (hoechstens alle 300 ms), Anzeige sofort
  function scheduleAutosave() {
    if (!editorReady) return; // Aufrufe beim Aufbau der Seite ignorieren
    updateStatus();
    if (draftTimer) return;
    draftTimer = setTimeout(() => { draftTimer = null; flushDraft(); }, 300);
  }

  // Manuelles "Zwischenspeichern" und Aufrufe aus Konflikt-/Fehlerwegen
  async function saveDraft(silent) {
    const ok = flushDraft({ force: true });
    if (!silent) notify(ok ? 'Entwurf gespeichert.' : 'Entwurf konnte nicht gesichert werden (Speicher voll?) – bitte „Als Datei sichern (.md)“ nutzen.', ok ? 'success' : 'error', ok ? undefined : PERSIST);
    return ok;
  }

  function initAutosave() {
    [titleInput, categorySelect, subcategoryInput, textarea, privateNoteInput].forEach(el => {
      el.addEventListener('input', scheduleAutosave);
      el.addEventListener('change', scheduleAutosave);
    });
  }

  // Sofort sichern: Fokusverlust, Tab versteckt, pagehide. beforeunload warnt bei ungespeicherten Aenderungen.
  function initDraftFlush() {
    document.addEventListener('blur', () => { flushDraft(); }, true);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDraft(); });
    window.addEventListener('pagehide', () => { flushDraft(); revokeAssetPreviewUrls(); });
    window.addEventListener('beforeunload', (e) => {
      if (editorReady && isDirty()) {
        flushDraft();            // der Entwurf bleibt als Rueckfall
        e.preventDefault();      // Warnung des Browsers
        e.returnValue = '';
      }
    });
  }

  // ── Banner (dauerhaft, role="alert") ──
  function hostFor(id) {
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('div');
      host.id = id;
      const anchor = document.getElementById('ge-draft-panel');
      anchor.parentNode.insertBefore(host, anchor);
    }
    return host;
  }

  function hideDraftAlert() {
    const box = document.getElementById('ge-draft-alert');
    if (box) box.remove();
  }

  function hideDraftNotice() {
    const box = document.getElementById('ge-draft-notice');
    if (box) box.remove();
  }

  // Hinweis (keine rote Fehlermeldung): der Text ist gesichert, aber nicht alle Bilder passen in den Entwurf
  function showDraftNotice(missing) {
    const host = hostFor('ge-draft-alert-host');
    let box = document.getElementById('ge-draft-notice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ge-draft-notice';
      box.className = 'ge-recover-banner';
      box.setAttribute('role', 'status');
      host.appendChild(box);
    }
    box.textContent = 'Der Text ist gesichert. Bilder passen nicht in den Entwurf: ' + missing.join(', ') + '. Speichere zwischendurch.';
  }

  function downloadCurrentAsFile() {
    const title = titleInput.value.trim();
    const body = (title ? '# ' + title + '\n\n' : '') + textarea.value;
    const name = (title || 'entwurf').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'entwurf';
    downloadBlob(new Blob([body], { type: 'text/markdown;charset=utf-8' }), name + '.md');
  }

  function showDraftAlert(err) {
    const host = hostFor('ge-draft-alert-host');
    let box = document.getElementById('ge-draft-alert');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ge-draft-alert';
      box.className = 'ge-conflict-banner';
      box.setAttribute('role', 'alert');
      const head = document.createElement('strong');
      head.textContent = 'Entwurf kann nicht gesichert werden. ';
      const why = document.createElement('span');
      why.className = 'ge-draft-alert-why';
      const actions = document.createElement('div');
      actions.className = 'ge-conflict-actions';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'ge-draft-download'; btn.className = 'gs-folder-btn';
      btn.textContent = 'Als Datei sichern (.md)';
      btn.addEventListener('click', downloadCurrentAsFile);
      actions.appendChild(btn);
      box.append(head, why, actions);
      host.appendChild(box);
    }
    const reason = err && err.name === 'QuotaExceededError' ? 'Der Browser-Speicher ist voll.' : ((err && err.message) || 'Unbekannter Fehler.');
    box.querySelector('.ge-draft-alert-why').textContent = reason + ' Bis das Sichern wieder gelingt, bleibt diese Meldung stehen – dein Text geht verloren, wenn du die Seite jetzt verlässt.';
  }

  // ── Entwurf anwenden ──
  function applyDraft(draft) {
    if (!draft.guideId) newDraftKey = draft.key; // weiter in denselben Entwurf schreiben
    titleInput.value = draft.title || '';
    if (draft.category) categorySelect.value = draft.category;
    subcategoryInput.value = draft.subcategory || '';
    tags = Array.isArray(draft.tags) ? [...draft.tags] : [];
    renderTagPills();
    textarea.value = draft.content || '';
    privateNoteInput.value = draft.privateNote || '';
    privateNoteDetails.open = !!draft.privateNote;
    links = Array.isArray(draft.links) ? draft.links.map((l) => ({ ...l })) : [];
    renderLinks();
    attachments = Array.isArray(draft.attachments) ? draft.attachments.map((a) => ({ ...a })) : [];
    renderAttachments();

    pendingAssets.clear(); pendingAssetData.clear(); revokeAssetPreviewUrls();
    {
      Object.entries(window.GuidesDrafts.imagesOf(draft).assets).forEach(([filename, dataUrl]) => {
        try {
          const blob = dataUrlToBlob(dataUrl);
          pendingAssets.set(filename, blob);
          pendingAssetData.set(filename, dataUrl);
          assetPreviewUrls.set(filename, URL.createObjectURL(blob));
        } catch { /* einzelnes Bild überspringen */ }
      });
    }
    // vorgemerkte Umbenennungen zurueckholen (nur, wenn das Bild noch existiert und der neue Name frei ist)
    pendingRenames = [];
    const lostRenames = [];
    (draft.pendingRenames || []).forEach((r) => {
      if (r && existingAssetNames.has(r.from) && !pendingRenames.some((x) => x.to === r.to) && !existingAssetNames.has(r.to)) pendingRenames.push({ from: r.from, to: r.to });
      else if (r) lostRenames.push(r.from + ' → ' + r.to);
    });
    if (lostRenames.length) notify('Diese vorgemerkten Umbenennungen sind nicht mehr möglich (Bild fehlt oder Name vergeben): ' + lostRenames.join(', '), 'warning');
    const imgBrowser = document.getElementById('ge-images-list');
    if (imgBrowser && !imgBrowser.hidden) renderImageBrowser();
    if ((draft.pendingAttachmentNames || []).length) {
      notify('Diese Dateien waren nicht im Entwurf und müssen neu angehängt werden: ' + draft.pendingAttachmentNames.join(', '), 'warning');
    }
    updatePreview();
    scheduleAutosave();
  }

  function fmtDraftDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' })
      + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  }

  // ── Entwurfsliste beim Anlegen eines NEUEN Guides ──
  function buildDraftRow(draft, panel, listEl) {
    const row = document.createElement('div');
    row.className = 'ge-draft-row';

    const info = document.createElement('div');
    info.className = 'ge-draft-row-info';
    const title = document.createElement('strong');
    title.className = 'ge-draft-row-title';
    title.textContent = draft.title ? draft.title : '(Ohne Titel)';
    const meta = document.createElement('span');
    meta.className = 'ge-draft-row-meta';
    meta.textContent = fmtDraftDate(draft.savedAt);
    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'ge-draft-row-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'gs-folder-btn';
    restoreBtn.textContent = 'Wiederherstellen';
    restoreBtn.addEventListener('click', () => {
      applyDraft(draft);
      panel.hidden = true;
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'gv-confirm-btn gv-confirm-btn--cancel';
    dismissBtn.textContent = 'Verwerfen';
    dismissBtn.addEventListener('click', () => {
      window.GuidesDrafts.remove(draft.key);
      row.remove();
      if (!listEl.children.length) panel.hidden = true;
    });

    actions.append(restoreBtn, dismissBtn);
    row.append(info, actions);
    return row;
  }

  function checkForDrafts() {
    const drafts = window.GuidesDrafts.listNew();
    if (!drafts.length) return;

    const panel  = document.getElementById('ge-draft-panel');
    const listEl = document.getElementById('ge-draft-list');
    listEl.replaceChildren();
    drafts.forEach((draft) => listEl.appendChild(buildDraftRow(draft, panel, listEl)));
    panel.hidden = false;
  }

  // ── Wiederherstellung beim Oeffnen eines BESTEHENDEN Guides ──
  // Nichts wird still angewendet und nichts still verworfen: bis zur Entscheidung zeigt das Formular den
  // gespeicherten Stand und ist gesperrt (sonst wuerde die erste Eingabe den gefundenen Entwurf ueberschreiben).
  function setFormInert(on) {
    ['.ge-form-header', '#ge-view-toggle', '#ge-toolbar', '#ge-editor-wrap', '#ge-images-list'].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) el.toggleAttribute('inert', on);
    });
    const imgToggle = document.getElementById('ge-images-toggle');
    if (imgToggle && imgToggle.parentElement) imgToggle.parentElement.toggleAttribute('inert', on);
  }

  function clearRecoverBanner() {
    hostFor('ge-recover-host').replaceChildren();
    recoveryPending = false;
    setFormInert(false);
  }

  function checkRecovery() {
    const d = window.GuidesDrafts.forGuide(currentGuideId);
    if (!d) return;
    if (window.GuidesDrafts.sameAsSaved(d, baselineState)) { window.GuidesDrafts.remove(d.key); return; } // ohne Unterschied: still entfernen

    recoveryPending = true;
    setFormInert(true);
    const newer = Number.isInteger(d.baseVersion) && Number.isInteger(loadedVersion) && d.baseVersion < loadedVersion;
    const host = hostFor('ge-recover-host');
    host.replaceChildren();
    const box = document.createElement('div');
    box.id = 'ge-recover-banner';
    box.className = 'ge-recover-banner';
    box.setAttribute('role', 'alert');
    const head = document.createElement('strong');
    head.textContent = 'Nicht gespeicherte Änderungen vom ' + fmtDraftDate(d.savedAt) + ' gefunden. ';
    const missingImages = window.GuidesDrafts.imagesOf(d).missing;
    const msg = document.createElement('span');
    msg.textContent = (missingImages.length ? 'Achtung: Diese Bilder fehlen im Entwurf (sie passten nicht in den Speicher): ' + missingImages.join(', ') + '. ' : '') + (newer
      ? 'Der Guide wurde seitdem geändert (Version ' + d.baseVersion + ' → ' + loadedVersion + '): „Wiederherstellen“ würde diese neueren Änderungen überschreiben – „Als neuen Guide sichern“ überschreibt nichts. '
      : '') + 'Das Formular zeigt bis zu deiner Entscheidung den gespeicherten Stand.';
    const actions = document.createElement('div');
    actions.className = 'ge-conflict-actions';
    const mk = (id, label, emphasis, handler) => {
      const b = document.createElement('button');
      b.type = 'button'; b.id = id; b.className = 'gs-folder-btn' + (emphasis ? ' ge-btn-emphasis' : ''); b.textContent = label;
      b.addEventListener('click', handler);
      actions.appendChild(b);
    };
    mk('ge-recover-apply', 'Wiederherstellen', !newer, () => {
      applyDraft(d);
      clearRecoverBanner();
      flushDraft({ force: true });
    });
    mk('ge-recover-discard', 'Verwerfen', false, () => {
      if (!confirm('Die nicht gespeicherten Änderungen vom ' + fmtDraftDate(d.savedAt) + ' endgültig verwerfen? Der gespeicherte Stand bleibt unverändert.')) return;
      window.GuidesDrafts.remove(d.key);
      clearRecoverBanner();
    });
    mk('ge-recover-copy', 'Als neuen Guide sichern', newer, () => recoverAsCopy(d));
    box.append(head, msg, actions);
    host.appendChild(box);
  }

  async function recoverAsCopy(d) {
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const meta = {
      title: (d.title || 'Entwurf').trim() + ' (Entwurf ' + time + ')',
      category: d.category || 'Allgemein', subcategory: (d.subcategory || '').trim(), tags: [...(d.tags || [])],
      privateNote: (d.privateNote || '').trim(),
      links: (d.links || []).filter((l) => l.url && String(l.url).trim()).map((l) => ({ ...l, text: (l.text || '').trim(), url: String(l.url).trim() })),
      attachments: (d.attachments || []).map((a) => ({ ...a })),
      favorite: false, source: 'manual', importTag: null,
    };
    const images = new Map();
    Object.entries(window.GuidesDrafts.imagesOf(d).assets).forEach(([n, u]) => { try { images.set(n, dataUrlToBlob(u)); } catch { /* überspringen */ } });
    const r = await createCopyGuide({ meta, content: d.content || '', sourceId: currentGuideId, images, files: new Map(), renames: d.pendingRenames || [] });
    if (!r.ok) {
      showSaveAlert('Der Entwurf wurde nicht als neuer Guide gesichert: ' + r.error + ' Er bleibt erhalten.');
      notify('Der Entwurf wurde nicht als neuer Guide gesichert: ' + r.error, 'error', PERSIST);
      return;
    }
    window.GuidesDrafts.remove(d.key);
    clearRecoverBanner();
    notify('Die nicht gespeicherten Änderungen wurden als neuer Guide „' + meta.title + '“ gesichert.', 'success');
  }

  // ── Bestehenden Guide laden (Bearbeiten-Modus) ──────────
  async function loadForEdit(id) {
    const res = await window.GuidesDB.getGuide(id);
    if (!res.success) {
      notify(res.error || 'Guide konnte nicht geladen werden.', 'error');
      return;
    }
    currentGuideId = id;
    existingMeta = res.meta;
    loadedVersion = Number.isInteger(res.meta.version) && res.meta.version >= 1 ? res.meta.version : 1; // alte Guides ohne Feld = 1
    loadedStamp = res.stamp || null;
    const assetsRes = await window.GuidesDB.listAssets(id);
    existingAssetNames = new Set(assetsRes.assets || []);

    titleInput.value = res.meta.title || '';
    if (res.meta.category) categorySelect.value = res.meta.category;
    subcategoryInput.value = res.meta.subcategory || '';
    tags = Array.isArray(res.meta.tags) ? [...res.meta.tags] : [];
    renderTagPills();
    textarea.value = res.content || '';
    privateNoteInput.value = res.meta.privateNote || '';
    if (res.meta.privateNote) privateNoteDetails.open = true;
    links = Array.isArray(res.meta.links) ? res.meta.links.map((l) => ({ ...l })) : [];
    renderLinks();
    attachments = Array.isArray(res.meta.attachments) ? res.meta.attachments.map((a) => ({ ...a })) : [];
    renderAttachments();

    document.getElementById('ge-page-title').textContent = 'Guide bearbeiten';
    document.title = 'support.sheet – Guide bearbeiten';

    await updatePreview();
    // gespeicherter Stand = Formular jetzt; ein Entwurf zu genau diesem Guide wird angeboten (nie still angewendet)
    clearRecoverBanner();
    pendingRenames = [];
    const modified = new Date(res.meta.modified);
    lastSavedAt = isNaN(modified.getTime()) ? new Date() : modified;
    draftWritten = false; draftAt = null;
    setBaseline();
    updateStatus();
    checkRecovery();
  }

  // ── Speichern ────────────────────────────────────────────
  // Reine Speicherlogik ohne Navigation – gibt true/false zurueck, damit
  // die beiden Bottom-Bar-Buttons ("Speichern" vs. "Speichern & Schließen")
  // je nach Erfolg selbst entscheiden koennen, wohin es geht.
  //
  // Im Bearbeiten-Modus wird mit der beim Laden gelesenen Version (und im Ordnermodus den
  // Dateizeiten) gespeichert. Hat sich der Guide inzwischen geaendert (anderes Fenster, Ansicht,
  // andere Anwendung), wird NICHTS geschrieben: Banner mit drei Wegen, der eigene Text bleibt im
  // Formular und im Entwurf.
  function collectFormMeta() {
    const title = titleInput.value.trim();
    const meta = {
      title,
      category: categorySelect.value || 'Allgemein',
      subcategory: subcategoryInput.value.trim(),
      tags: [...tags],
      privateNote: privateNoteInput.value.trim(),
      links: links.filter((l) => l.url && l.url.trim()).map((l) => ({ ...l, text: (l.text || '').trim(), url: l.url.trim() })),
      attachments: attachments.map((a) => ({ ...a })),
      favorite:  existingMeta ? existingMeta.favorite  : false,
      source:    existingMeta ? existingMeta.source    : 'manual',
      importTag: existingMeta ? existingMeta.importTag : null,
    };
    if (existingMeta && existingMeta.created) meta.created = existingMeta.created;
    return meta;
  }

  // ── Vorgemerkte Umbenennungen von Bildern (pendingRenames) beim Speichern ──
  // Reihenfolge: (1) neue Assets aus den Daten der alten schreiben und bestaetigen, (2) Guide speichern,
  // (3) erst nach bestaetigtem Speichern die alten Assets in den Asset-Papierkorb legen (nie endgueltig loeschen,
  // und nur wenn sie im neuen Text nicht mehr vorkommen). Scheitert (1) oder (2), bleibt das alte Asset an seinem
  // Platz, in diesem Versuch erzeugte neue Assets wandern in den Papierkorb und die Vormerkung bleibt erhalten.
  async function createRenamedAssets(id, created) {
    const db = window.GuidesDB;
    const list = await db.listAssets(id);
    const existing = new Set(list.assets || []);
    for (const r of pendingRenames) {
      if (existing.has(r.to)) return { ok: false, error: 'Das Bild „' + r.to + '“ existiert inzwischen im Guide (Umbenennung von „' + r.from + '“) und wird nicht überschrieben.' };
      created.push(r.to); // ab hier kann die Datei existieren (auch unvollstaendig): bei Misserfolg in den Papierkorb
      try {
        const url = await db.getAssetUrl(id, r.from);
        if (!url.success) throw new Error(url.error || 'altes Bild nicht gefunden');
        const blob = await (await fetch(url.url)).blob();
        URL.revokeObjectURL(url.url);
        const saved = await db.saveAsset(id, r.to, blob);
        if (!saved.success) throw new Error(saved.error);
      } catch (e) {
        return { ok: false, error: 'Umbenennung „' + r.from + '“ → „' + r.to + '“ fehlgeschlagen: ' + (e?.message || e) };
      }
    }
    return { ok: true };
  }

  async function undoCreatedAssets(id, created) {
    const failed = [];
    for (const name of created) {
      const t = await window.GuidesDB.trashAsset(id, name);
      if (!t.success && !/nicht gefunden|could not be found|NotFound/i.test(t.error || '')) failed.push(name);
    }
    if (failed.length) notify('Neu angelegte Bilder konnten nicht in den Papierkorb verschoben werden und liegen noch im Guide: ' + failed.join(', '), 'warning', PERSIST);
  }

  async function finishRenames(id, savedText, savedMeta) {
    const db = window.GuidesDB, notes = [];
    const o = await db.findOrphanedAssets(id, savedText, savedMeta);
    if (!o.success) notes.push('Die alten Bilder bleiben liegen (Prüfung fehlgeschlagen: ' + o.error + ')');
    const orphan = new Set(((o && o.orphans) || []).map((x) => x.filename));
    for (const r of pendingRenames) {
      if (!o.success) break;
      if (!orphan.has(r.from)) { notes.push('„' + r.from + '“ wird noch verwendet und bleibt liegen'); continue; }
      const t = await db.trashAsset(id, r.from);
      if (!t.success) notes.push('„' + r.from + '“ konnte nicht in den Papierkorb verschoben werden: ' + t.error);
    }
    pendingRenames = [];
    const list = await db.listAssets(id);
    existingAssetNames = new Set(list.assets || []);
    return notes;
  }

  async function saveGuide() {
    if (recoveryPending) {
      notify('Bitte zuerst über die gefundenen nicht gespeicherten Änderungen entscheiden (Banner oben).', 'error');
      return false;
    }
    const title = titleInput.value.trim();
    if (!title) { notify('Bitte einen Titel eingeben.', 'error'); titleInput.focus(); return false; }

    const isEditMode = !!currentGuideId;
    const id = currentGuideId || window.GuidesDB.generateId();
    const meta = collectFormMeta();
    const savedState = formState();           // Stand, der gespeichert wird (Eingaben waehrend des Speicherns bleiben "ungespeichert")
    const contentToSave = textarea.value;
    const draftKeyBefore = currentDraftKey();

    // Der Entwurf ist aktuell, bevor die Datenbank angefasst wird – und bleibt, bis sie das Speichern bestaetigt hat.
    flushDraft({ force: true });

    for (const [filename, file] of pendingAssets.entries()) {
      const res = await window.GuidesDB.saveAsset(id, filename, file);
      if (!res.success) notify('Bild „' + filename + '“ konnte nicht gespeichert werden: ' + res.error, 'error', PERSIST);
    }
    for (const [assetFile, file] of pendingAttachmentFiles.entries()) {
      const res = await window.GuidesDB.saveAsset(id, assetFile, file);
      if (!res.success) notify('Datei „' + assetFile + '“ konnte nicht gespeichert werden: ' + res.error, 'error', PERSIST);
    }

    // Umbenennungen, Schritt 1: neue Assets aus den Daten der alten schreiben und bestaetigen
    const createdNames = [];
    if (pendingRenames.length) {
      const r1 = await createRenamedAssets(id, createdNames);
      if (!r1.ok) {
        await undoCreatedAssets(id, createdNames);
        showSaveAlert('Nicht gespeichert: ' + r1.error + ' Das alte Bild bleibt unverändert, die Umbenennung bleibt vorgemerkt, dein Text ist als Entwurf gesichert.');
        notify('Nicht gespeichert: ' + r1.error, 'error', PERSIST);
        return false;
      }
    }

    // Schritt 2: Guide mit neuem Text speichern
    let res;
    try {
      res = await window.GuidesDB.saveGuide(id, meta, contentToSave,
        isEditMode ? { expectedVersion: loadedVersion, expectedStamp: loadedStamp } : undefined);
    } catch (err) {
      await undoCreatedAssets(id, createdNames);
      if (err && err.name === 'ConflictError') {
        showConflictBanner(err);
        notify('Nicht gespeichert: Der Guide wurde zwischenzeitlich geändert.', 'error', PERSIST);
        return false;
      }
      showSaveAlert('Speichern fehlgeschlagen: ' + (err?.message || err) + ' Dein Text ist als Entwurf gesichert.');
      notify('Speichern fehlgeschlagen: ' + (err?.message || err), 'error', PERSIST);
      return false;
    }
    if (!res.success) {
      await undoCreatedAssets(id, createdNames);
      showSaveAlert((res.error || 'Guide konnte nicht gespeichert werden.') + ' Dein Text ist als Entwurf gesichert.');
      notify(res.error || 'Guide konnte nicht gespeichert werden.', 'error', PERSIST);
      return false;
    }

    // Kein automatisches Aufräumen verwaister Assets beim Speichern: Die
    // Erkennung konnte Dateien mit Leerzeichen/Klammern/Sonderzeichen im Namen
    // nicht sicher zuordnen und hat sie endgültig gelöscht. Verwaiste Assets
    // werden nur noch bewusst über Lokale DB | Einstellungen geprüft
    // (Anzeige, Bestätigung, Papierkorb).

    // Schritt 3: erst jetzt – die Datenbank hat bestaetigt – kommen die alten Bilder in den Asset-Papierkorb
    const renameNotes = pendingRenames.length ? await finishRenames(id, contentToSave, res.meta) : [];

    // Erst jetzt wird der Entwurf geloescht
    clearAlerts();
    window.GuidesDrafts.remove(draftKeyBefore);
    newDraftKey = null; draftWritten = false; draftAt = null;
    pendingAssets.clear(); pendingAssetData.clear();
    revokeAssetPreviewUrls();
    pendingAttachmentFiles.clear();
    currentGuideId = id; // fuer einen etwaigen zweiten Save in derselben Session
    existingMeta = res.meta;
    loadedVersion = res.version;   // naechstes Speichern in dieser Session baut auf dem eben geschriebenen Stand auf
    loadedStamp = res.stamp || null;
    lastSavedAt = new Date();
    setBaseline(Object.assign({}, savedState, { pendingImages: [], pendingFiles: [], renames: [] }));
    hideDraftAlert();
    hideDraftNotice();
    updateStatus();
    if (renameNotes.length) notify('Guide gespeichert. Hinweis zu umbenannten Bildern: ' + renameNotes.join('; ') + '.', 'warning', PERSIST);
    else notify('Guide gespeichert.', 'success');
    if (document.getElementById('ge-images-list') && !document.getElementById('ge-images-list').hidden) renderImageBrowser();
    return true;
  }

  // ── Konflikt-Banner und Fehlermeldungen (dauerhaft, role="alert") ──
  function alertHost() { return hostFor('ge-alert-host'); }

  function clearAlerts() { alertHost().replaceChildren(); }

  function showSaveAlert(message) {
    const host = alertHost();
    host.replaceChildren();
    const box = document.createElement('div');
    box.id = 'ge-save-alert';
    box.className = 'ge-conflict-banner';
    box.setAttribute('role', 'alert');
    box.textContent = message;
    host.appendChild(box);
  }

  function showConflictBanner(err) {
    const host = alertHost();
    host.replaceChildren();
    const box = document.createElement('div');
    box.id = 'ge-conflict-banner';
    box.className = 'ge-conflict-banner';
    box.setAttribute('role', 'alert');

    const head = document.createElement('strong');
    head.textContent = 'Nicht gespeichert – Konflikt. ';
    const msg = document.createElement('span');
    msg.textContent = (err.message || '') + ' Dein Text steht unverändert im Formular und ist als Entwurf gesichert. Was möchtest du tun?';
    const actions = document.createElement('div');
    actions.className = 'ge-conflict-actions';

    const mk = (id, label, handler) => {
      const b = document.createElement('button');
      b.type = 'button'; b.id = id; b.className = 'gs-folder-btn'; b.textContent = label;
      b.addEventListener('click', handler);
      actions.appendChild(b);
    };
    mk('ge-conflict-copy', 'Meine Version als neuen Guide sichern', saveConflictCopy);
    mk('ge-conflict-reload', 'Stand aus dem anderen Fenster laden', reloadAfterConflict);
    mk('ge-conflict-continue', 'Weiter bearbeiten (nichts speichern)', clearAlerts);

    box.append(head, msg, actions);
    host.appendChild(box);
  }

  // Legt einen NEUEN Guide an (Konflikt-Kopie, Entwurf als neuer Guide): alle Assets des Quell-Guides werden
  // mitkopiert, dazu die uebergebenen noch nicht gespeicherten Bilder/Dateien. Der Quell-Guide bleibt unveraendert.
  // o: { meta, content, sourceId, images: Map, files: Map } → { ok, id, res } | { ok:false, error }
  async function createCopyGuide(o) {
    const db = window.GuidesDB;
    const newId = db.generateId();
    const copyFailed = [];
    const renameMap = new Map((o.renames || []).map((r) => [r.from, r.to])); // vorgemerkte Umbenennungen: Asset unter dem NEUEN Namen anlegen
    if (o.sourceId) {
      const list = await db.listAssets(o.sourceId);
      for (const name of (list.assets || [])) {
        try {
          const url = await db.getAssetUrl(o.sourceId, name);
          if (!url.success) throw new Error(url.error);
          const blob = await (await fetch(url.url)).blob();
          URL.revokeObjectURL(url.url);
          const saved = await db.saveAsset(newId, renameMap.get(name) || name, blob);
          if (!saved.success) throw new Error(saved.error);
        } catch (e) { copyFailed.push(name + ' (' + (e?.message || e) + ')'); }
      }
    }
    for (const [filename, file] of o.images.entries()) {
      const r = await db.saveAsset(newId, filename, file); if (!r.success) copyFailed.push(filename);
    }
    for (const [assetFile, file] of o.files.entries()) {
      const r = await db.saveAsset(newId, assetFile, file); if (!r.success) copyFailed.push(assetFile);
    }
    if (copyFailed.length) return { ok: false, error: 'Dateien konnten nicht kopiert werden: ' + copyFailed.join('; ') + '.' };
    const res = await db.saveGuide(newId, o.meta, o.content);
    if (!res.success) return { ok: false, error: res.error || 'Kopie konnte nicht gespeichert werden.' };
    return { ok: true, id: newId, res };
  }

  // 1. Eigene Version als neuen Guide: Titel mit "Konflikt" und Uhrzeit, alle Felder samt Anhaengen
  //    (die Dateien werden mitkopiert); der urspruengliche Guide bleibt unveraendert.
  async function saveConflictCopy() {
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const meta = collectFormMeta();
    meta.title = meta.title + ' (Konflikt ' + time + ')';
    delete meta.created;
    const draftKeyBefore = currentDraftKey();
    const savedState = formState();

    const r = await createCopyGuide({ meta, content: textarea.value, sourceId: currentGuideId, images: pendingAssets, files: pendingAttachmentFiles, renames: pendingRenames });
    if (!r.ok) {
      showSaveAlert('Kopie nicht angelegt – ' + r.error + ' Dein Text ist weiter im Formular und als Entwurf gesichert.');
      notify('Kopie nicht angelegt: ' + r.error, 'error', PERSIST);
      return;
    }
    clearAlerts();
    window.GuidesDrafts.remove(draftKeyBefore);
    newDraftKey = null; draftWritten = false; draftAt = null;
    pendingAssets.clear(); pendingAssetData.clear(); revokeAssetPreviewUrls(); pendingAttachmentFiles.clear();
    pendingRenames = []; // die Assets liegen im neuen Guide unter den neuen Namen
    currentGuideId = r.id;
    existingMeta = r.res.meta;
    loadedVersion = r.res.version;
    loadedStamp = r.res.stamp || null;
    titleInput.value = meta.title;
    const assetsRes = await window.GuidesDB.listAssets(r.id);
    existingAssetNames = new Set(assetsRes.assets || []);
    lastSavedAt = new Date();
    setBaseline(Object.assign({}, savedState, { title: meta.title, pendingImages: [], pendingFiles: [], renames: [] }));
    hideDraftAlert();
    updateStatus();
    notify('Deine Version wurde als neuer Guide „' + meta.title + '“ gespeichert.', 'success');
  }

  // 2. Stand aus dem anderen Fenster laden – die eigenen Aenderungen sind vorher als Entwurf gesichert.
  async function reloadAfterConflict() {
    if (!confirm('Die eigenen Änderungen werden verworfen und der aktuelle Stand geladen. Sie sind vorher als Entwurf gesichert und lassen sich unter „Nicht gespeicherte Entwürfe“ wiederherstellen.\n\nStand aus dem anderen Fenster laden?')) return;
    await saveDraft(true);
    pendingAssets.clear(); pendingAssetData.clear(); revokeAssetPreviewUrls(); pendingAttachmentFiles.clear();
    await loadForEdit(currentGuideId);
    clearAlerts();
  }

  // "Speichern" – wie bisher direkt zur Guide-Ansicht.
  async function handleSaveAndView() {
    const ok = await saveGuide();
    if (ok) window.location.href = 'guides-view.html?id=' + encodeURIComponent(currentGuideId);
  }

  // "Speichern & Schließen" – zurueck zur Guide-Uebersicht statt zur Ansicht.
  async function handleSaveAndClose() {
    const ok = await saveGuide();
    if (ok) window.location.href = 'guides.html';
  }

  // ── Import: Menü ─────────────────────────────────────────
  function initImportMenu() {
    const importBtn  = document.getElementById('ge-import-btn');
    const importMenu = document.getElementById('ge-import-menu');
    const fileInput  = document.getElementById('ge-import-file');

    importBtn.addEventListener('click', () => { importMenu.hidden = !importMenu.hidden; });
    document.addEventListener('click', (e) => {
      if (!importMenu.hidden && !e.target.closest('.ge-import-wrap')) importMenu.hidden = true;
    });

    importMenu.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        fileInput.accept = btn.dataset.accept || '';
        fileInput.dataset.kind = btn.dataset.kind;
        importMenu.hidden = true;
        fileInput.click();
      });
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      const kind = e.target.dataset.kind;
      e.target.value = '';
      if (!file) return;
      if (kind === 'docx') await importDocxFile(file);
      else await importTextFile(file);
    });
  }

  async function importTextFile(file) {
    try {
      const text = await file.text();
      textarea.value = text;
      await updatePreview();
      notify('„' + file.name + '“ importiert.', 'success');
    } catch (err) {
      notify('Import fehlgeschlagen: ' + (err?.message || err), 'error');
    }
  }

  function base64ToBlob(base64, contentType) {
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: contentType });
  }

  async function importDocxFile(file) {
    if (typeof mammoth === 'undefined') { notify('mammoth.js konnte nicht geladen werden.', 'error'); return; }
    if (typeof TurndownService === 'undefined') { notify('turndown.js konnte nicht geladen werden.', 'error'); return; }

    notify('Word-Dokument wird konvertiert…', 'success');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer }, {
        convertImage: mammoth.images.imgElement((image) => image.read('base64').then((base64) => {
          const ext = ((image.contentType || 'image/png').split('/').pop() || 'png').replace('jpeg', 'jpg');
          const filename = uniqueAssetName('docx-image-' + (++importImageCounter) + '.' + ext);
          const blob = base64ToBlob(base64, image.contentType);
          registerPendingAsset(filename, blob);
          assetPreviewUrls.set(filename, URL.createObjectURL(blob));
          return { src: 'assets/' + filename };
        })),
      });

      const turndown = new TurndownService();
      textarea.value = turndown.turndown(result.value);
      await updatePreview();
      notify('„' + file.name + '“ importiert – bitte vor dem Speichern prüfen.', 'success');
      if (result.messages && result.messages.length) console.warn('mammoth-Hinweise:', result.messages);
    } catch (err) {
      notify('DOCX-Import fehlgeschlagen: ' + (err?.message || err), 'error');
    }
  }

  // ── Init ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    titleInput       = document.getElementById('ge-title');
    categorySelect   = document.getElementById('ge-category');
    subcategoryInput = document.getElementById('ge-subcategory');
    tagInput         = document.getElementById('ge-tag-input');
    tagsPillsEl      = document.getElementById('ge-tags-pills');
    textarea         = document.getElementById('ge-textarea');
    preview          = document.getElementById('ge-preview');
    privateNoteInput   = document.getElementById('ge-private-note');
    privateNoteDetails = document.getElementById('ge-private-note-details');
    linksRowsEl        = document.getElementById('ge-links-rows');
    attachmentsRowsEl  = document.getElementById('ge-attachments-rows');
    attachmentsHintEl  = document.getElementById('ge-attachments-hint');

    initTagsInput();
    renderTagPills(); // zeigt die Tag-Vorschläge auch ohne vorhandene Tags sofort an
    initLinksInput();
    initAttachmentsInput();
    initViewToggle();
    initToolbar();
    initLinkDialog();
    initTableDialog();
    initEmojiPicker();
    initImageUpload();
    initImageBrowser();
    initLivePreview();
    initImportMenu();
    initAutosave();

    // Editor ohne Speichern verlassen (anderer Link, Tab schließen, Zurück-
    // Navigation): Entwurf sofort sichern (pagehide, Fokusverlust, Tab versteckt) und bei ungespeicherten
    // Änderungen warnen (beforeunload). Der Editor hat keinen eigenen "Abbrechen"-Knopf; "Speichern &
    // Schließen" speichert zuerst. Die Blob-URLs der Bildvorschau werden bei pagehide freigegeben.
    initDraftFlush();

    document.getElementById('ge-save-draft')?.addEventListener('click', () => saveDraft(false));
    document.getElementById('ge-save')?.addEventListener('click', handleSaveAndView);
    document.getElementById('ge-save-close')?.addEventListener('click', handleSaveAndClose);
    document.getElementById('ge-back-top')?.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    await window.GuidesDB.restoreFolder();
    await loadCategories();

    const editId = resolveEditId();
    if (editId) {
      await loadForEdit(editId);
    } else {
      setBaseline(); // leerer Stand; Vorbefuellung und wiederhergestellte Entwuerfe gelten als ungespeichert
      applyPrefillFromUrl();
      checkForDrafts();
    }
  });
})();
