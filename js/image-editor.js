// ============================================================
// image-editor.js – Dialog des Bildeditors: Bereiche endgültig schwärzen, mit Kasten und Pfeil markieren, zuschneiden.
//   ImageEditor.open(file) -> Promise<{ action: 'apply' | 'raw' | 'cancel', file? }>
//     apply: bearbeitetes Bild (neu kodiert aus der Zeichenfläche: PNG, bei JPEG-Quellen JPEG 0,92; keine Metadaten, keine Originalbytes)
//     raw:   das Bild unverändert (nach Rückfrage), Originalbytes unberührt
//     cancel: verwirft alles
// Alles lokal: kein Netzwerk, keine Speicherung (kein localStorage, kein IndexedDB). Das Original liegt nur im Arbeitsspeicher des Dialogs und wird beim Schließen freigegeben.
// Alle Texte über textContent. Bildlogik: js/image-editor-core.js.
// ============================================================
(function () {
  'use strict';
  const Core = window.ImageEditorCore;
  const MAX_RESULT_BYTES = 10 * 1024 * 1024;     // wie das Limit des Editors für Bilder (js/guides-editor.js, MAX_ASSET_SIZE_MB)
  let queue = Promise.resolve();

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
  function btn(id, text, cls) { const b = el('button', cls || 'ie-btn', text); b.type = 'button'; b.id = id; return b; }

  async function decode(file) {
    if (typeof createImageBitmap === 'function') { try { return await createImageBitmap(file); } catch (e) { /* Rückfall über Image */ } }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('nicht lesbar')); };
      img.src = url;
    });
  }

  function open(file) { const run = queue.then(() => openNow(file), () => openNow(file)); queue = run.then(() => {}, () => {}); return run; }

  async function openNow(file) {
    const opener = document.activeElement;
    const st = { tool: 'blackout', color: '#e11d48', width: 4, bitmap: null, cv: null, ctx: null, hist: null, drag: null, cropRect: null, busy: false, decoded: false };
    return new Promise((resolve) => {
      // ── Aufbau ──
      const dlg = el('dialog', 'ie-dialog'); dlg.id = 'ie-dialog'; dlg.setAttribute('aria-labelledby', 'ie-title');
      const head = el('div', 'ie-head'); const h = el('h2', 'ie-heading', 'Bild bearbeiten'); h.id = 'ie-title'; head.appendChild(h);
      const note = el('p', 'ie-note', 'Schwärzen ist endgültig: Die Pixel werden im Bild durch Schwarz ersetzt, es bleibt keine Ebene. Das Original wird nicht gespeichert.');
      const msgs = el('div', 'ie-msgs'); msgs.id = 'ie-msgs'; msgs.setAttribute('role', 'status'); msgs.setAttribute('aria-live', 'polite');

      const tools = el('div', 'ie-tools'); tools.id = 'ie-tools'; tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', 'Werkzeuge');
      const toolBtns = {};
      [['blackout', '⬛ Schwärzen'], ['box', '▭ Kasten'], ['arrow', '➚ Pfeil'], ['crop', '✂ Zuschneiden']].forEach(([k, t]) => { const b = btn('ie-tool-' + k, t, 'ie-btn ie-tool'); b.setAttribute('aria-pressed', k === 'blackout' ? 'true' : 'false'); toolBtns[k] = b; tools.appendChild(b); });
      const colorLab = el('label', 'ie-lab', 'Farbe'); colorLab.htmlFor = 'ie-color'; const color = el('input', 'ie-color'); color.type = 'color'; color.id = 'ie-color'; color.value = st.color;
      const widthLab = el('label', 'ie-lab', 'Stärke'); widthLab.htmlFor = 'ie-width'; const width = el('select', 'ie-select'); width.id = 'ie-width';
      for (let i = 2; i <= 8; i++) { const o = el('option', '', i + ' px'); o.value = String(i); if (i === st.width) o.selected = true; width.appendChild(o); }
      const bCrop = btn('ie-crop-apply', 'Zuschnitt anwenden'); bCrop.hidden = true;
      const bUndo = btn('ie-undo', '↶ Rückgängig'), bRedo = btn('ie-redo', '↷ Wiederholen'), bReset = btn('ie-reset', '⟲ Zurücksetzen');
      tools.append(colorLab, color, widthLab, width, bCrop, bUndo, bRedo, bReset);

      const stage = el('div', 'ie-stage'); stage.id = 'ie-stage';
      const holder = el('div', 'ie-holder');
      const cv = el('canvas', 'ie-canvas'); cv.id = 'ie-canvas';
      const ov = el('canvas', 'ie-overlay'); ov.id = 'ie-overlay';
      holder.append(cv, ov); stage.appendChild(holder);

      const foot = el('div', 'ie-foot');
      const nameWrap = el('div', 'ie-name-wrap'); const nameLab = el('label', 'ie-lab', 'Name und Alternativtext'); nameLab.htmlFor = 'ie-name';
      const name = el('input', 'ie-name'); name.type = 'text'; name.id = 'ie-name'; name.autocomplete = 'off'; name.spellcheck = false; name.value = (file && file.name) || 'bild.png';
      nameWrap.append(nameLab, name);
      const actions = el('div', 'ie-actions');
      const bApply = btn('ie-apply', 'Übernehmen', 'ie-btn ie-btn--primary'), bRaw = btn('ie-raw', 'Unverändert einfügen'), bCancel = btn('ie-cancel', 'Abbrechen');
      actions.append(bApply, bRaw, bCancel); foot.append(nameWrap, actions);

      const conf = el('div', 'ie-confirm'); conf.id = 'ie-confirm'; conf.hidden = true; conf.setAttribute('role', 'alertdialog'); conf.setAttribute('aria-labelledby', 'ie-confirm-text');
      const confText = el('p', 'ie-confirm-text'); confText.id = 'ie-confirm-text';
      const confYes = btn('ie-confirm-yes', 'Ja', 'ie-btn ie-btn--danger'), confNo = btn('ie-confirm-no', 'Zurück');
      const confRow = el('div', 'ie-confirm-row'); confRow.append(confYes, confNo); conf.append(confText, confRow);
      dlg.append(head, note, msgs, tools, stage, foot, conf);
      document.body.appendChild(dlg);

      // ── Hilfen ──
      const say = (text, kind) => { msgs.textContent = ''; if (text) msgs.appendChild(el('div', 'ie-msg' + (kind ? ' ie-msg--' + kind : ''), text)); };
      const changed = () => !!(st.hist && st.hist.undoCount > 0);
      function syncButtons() {
        const ok = st.decoded && !st.busy;
        [bApply, bUndo, bRedo, bReset, bCrop].forEach((b) => { b.disabled = !ok; });
        bUndo.disabled = !ok || !st.hist || st.hist.undoCount === 0; bRedo.disabled = !ok || !st.hist || st.hist.redoCount === 0; bReset.disabled = !ok || !changed();
        bRaw.disabled = st.busy; bCancel.disabled = st.busy; Object.values(toolBtns).forEach((b) => { b.disabled = !st.decoded || st.busy; });
        bCrop.disabled = !ok || !st.cropRect;
      }
      let fitScale = 1;   // Anzeigegröße je Pixel der vollen Auflösung (nur Anzeige: Bearbeitung in voller Auflösung)
      function fit() {
        if (!st.decoded) return;
        const aw = Math.max(80, stage.clientWidth - 16), ah = Math.max(80, stage.clientHeight - 16);
        fitScale = Math.min(1, aw / cv.width, ah / cv.height);
        const w = Math.max(1, Math.round(cv.width * fitScale)), h = Math.max(1, Math.round(cv.height * fitScale));
        cv.style.width = w + 'px'; cv.style.height = h + 'px'; ov.style.width = w + 'px'; ov.style.height = h + 'px'; ov.width = w; ov.height = h;
        drawOverlay();
      }
      const pt = (e) => { const r = ov.getBoundingClientRect(); const sx = cv.width / r.width, sy = cv.height / r.height; return { cssX: e.clientX - r.left, cssY: e.clientY - r.top, x: Core.toImage(e.clientX - r.left, sx), y: Core.toImage(e.clientY - r.top, sy) }; };
      function drawOverlay() {
        const o = ov.getContext('2d'); o.clearRect(0, 0, ov.width, ov.height);
        const k = ov.width / Math.max(1, cv.width);
        const r = st.drag && st.drag.rect ? st.drag.rect : (st.tool === 'crop' ? st.cropRect : null);
        if (st.drag && st.tool === 'arrow' && st.drag.a) { o.strokeStyle = st.color; o.lineWidth = Math.max(1, st.width * k); o.beginPath(); o.moveTo(st.drag.a.x * k, st.drag.a.y * k); o.lineTo(st.drag.b.x * k, st.drag.b.y * k); o.stroke(); return; }
        if (!r) return;
        o.save();
        if (st.tool === 'crop') { o.fillStyle = 'rgba(0,0,0,.45)'; o.fillRect(0, 0, ov.width, ov.height); o.clearRect(r.x * k, r.y * k, r.w * k, r.h * k); }
        else if (st.tool === 'blackout') { o.fillStyle = 'rgba(0,0,0,.55)'; o.fillRect(r.x * k, r.y * k, r.w * k, r.h * k); }
        o.setLineDash([6, 4]); o.lineWidth = 1.5; o.strokeStyle = st.tool === 'box' ? st.color : '#fff'; o.strokeRect(r.x * k + .5, r.y * k + .5, Math.max(0, r.w * k - 1), Math.max(0, r.h * k - 1));
        o.restore();
      }
      function setTool(t) { st.tool = t; Object.keys(toolBtns).forEach((k) => toolBtns[k].setAttribute('aria-pressed', k === t ? 'true' : 'false')); bCrop.hidden = t !== 'crop'; if (t !== 'crop') st.cropRect = null; st.drag = null; drawOverlay(); syncButtons(); }

      // ── Zeichnen mit Zeigereingaben (Maus, Stift, Touch) ──
      ov.addEventListener('pointerdown', (e) => {
        if (!st.decoded || st.busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault(); try { ov.setPointerCapture(e.pointerId); } catch (x) { /* ohne Capture weiter */ }
        const p = pt(e); st.drag = { id: e.pointerId, a: p, b: p, rect: null }; st.cropRect = st.tool === 'crop' ? null : st.cropRect; bCrop.disabled = true; drawOverlay();
      });
      ov.addEventListener('pointermove', (e) => {
        if (!st.drag || st.drag.id !== e.pointerId) return;
        const p = pt(e); st.drag.b = p; st.drag.rect = Core.clampRect(st.drag.a.x, st.drag.a.y, p.x, p.y, cv.width, cv.height); drawOverlay();
      });
      const endDrag = (e, commit) => {
        if (!st.drag || st.drag.id !== e.pointerId) return;
        const d = st.drag; st.drag = null; try { ov.releasePointerCapture(e.pointerId); } catch (x) { /* schon frei */ }
        if (commit) { const p = pt(e); d.b = p; commitDrag(d); }
        drawOverlay(); syncButtons();
      };
      ov.addEventListener('pointerup', (e) => endDrag(e, true));
      ov.addEventListener('pointercancel', (e) => endDrag(e, false));
      function commitDrag(d) {
        const ctx = st.ctx, W = cv.width, H = cv.height;
        const rect = Core.clampRect(d.a.x, d.a.y, d.b.x, d.b.y, W, H);
        if (st.tool === 'crop') { st.cropRect = rect; return; }
        if (st.tool === 'arrow') {
          const b = Core.arrowBounds(d.a.x, d.a.y, d.b.x, d.b.y, st.width, W, H);
          if (!b || Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) < 2) return;
          st.hist.begin(b); Core.arrow(ctx, d.a.x, d.a.y, d.b.x, d.b.y, st.color, st.width); st.hist.commit(); return;
        }
        if (!rect) return;                                   // Breite oder Höhe 0: nichts verändert, kein Verlaufseintrag
        st.hist.begin(rect);
        if (st.tool === 'blackout') Core.blackout(ctx, rect); else Core.box(ctx, rect, st.color, st.width);
        st.hist.commit();
      }

      // ── Knöpfe und Tastatur ──
      Object.keys(toolBtns).forEach((k) => toolBtns[k].addEventListener('click', () => setTool(k)));
      color.addEventListener('input', () => { st.color = color.value; drawOverlay(); });
      width.addEventListener('change', () => { st.width = Number(width.value) || 4; });
      bCrop.addEventListener('click', () => { if (st.cropRect && Core.crop(st.ctx, st.cropRect, st.hist)) { st.cropRect = null; fit(); } syncButtons(); });
      const doUndo = () => { if (st.hist && st.hist.undo()) { fit(); syncButtons(); } };
      const doRedo = () => { if (st.hist && st.hist.redo()) { fit(); syncButtons(); } };
      bUndo.addEventListener('click', doUndo); bRedo.addEventListener('click', doRedo);
      bReset.addEventListener('click', () => { if (!st.decoded) return; paintOriginal(); st.hist.clear(); st.cropRect = null; fit(); say('Auf das Original zurückgesetzt.'); syncButtons(); });
      dlg.addEventListener('keydown', (e) => {
        if (conf.hidden === false) return;
        const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
        if (mod && k === 'z' && e.target !== name) { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
        else if (mod && k === 'y' && e.target !== name) { e.preventDefault(); doRedo(); }
      });

      // ── Rückfragen und Abschluss ──
      let onYes = null;
      function ask(text, yes, yesLabel) { confText.textContent = text; confYes.textContent = yesLabel || 'Ja'; conf.hidden = false; onYes = yes; confNo.focus(); }
      function closeAsk() { conf.hidden = true; onYes = null; }
      confYes.addEventListener('click', () => { const f = onYes; closeAsk(); if (f) f(); });
      confNo.addEventListener('click', () => { closeAsk(); bApply.focus(); });
      let finished = false;
      function finish(result) {
        if (finished) return; finished = true;
        try { if (st.bitmap && st.bitmap.close) st.bitmap.close(); } catch (e) { /* */ }
        st.bitmap = null; st.hist && st.hist.clear(); st.hist = null; st.ctx = null;
        cv.width = 0; cv.height = 0; ov.width = 0; ov.height = 0;       // Zeichenfläche freigeben: das Original bleibt nicht im Arbeitsspeicher des Dialogs
        window.removeEventListener('resize', fit);
        try { dlg.close(); } catch (e) { /* schon zu */ }
        dlg.remove();
        if (opener && opener.focus && document.contains(opener)) opener.focus();
        resolve(result);
      }
      const requestCancel = () => { if (st.busy) return; if (changed()) ask('Änderungen verwerfen und das Bild nicht einfügen?', () => finish({ action: 'cancel' }), 'Ja, verwerfen'); else finish({ action: 'cancel' }); };
      bCancel.addEventListener('click', requestCancel);
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (conf.hidden === false) { closeAsk(); return; } requestCancel(); });   // Esc
      bRaw.addEventListener('click', () => { if (st.busy) return; ask('Bild enthält möglicherweise sensible Daten. Trotzdem unverändert einfügen?', () => finish({ action: 'raw', file }), 'Ja, unverändert einfügen'); });
      bApply.addEventListener('click', async () => {
        if (st.busy || !st.decoded) return;
        st.busy = true; syncButtons();
        try {
          const blob = await Core.encode(cv, file && file.type);
          if (blob.size > MAX_RESULT_BYTES) { say('Das bearbeitete Bild ist ' + (blob.size / 1024 / 1024).toFixed(1) + ' MB groß, erlaubt sind ' + (MAX_RESULT_BYTES / 1024 / 1024) + ' MB. Bitte zuschneiden.', 'error'); st.busy = false; syncButtons(); return; }
          finish({ action: 'apply', file: new File([blob], Core.resultName(name.value, blob.type), { type: blob.type }) });
        } catch (e) { say('Das Bild konnte nicht kodiert werden.', 'error'); st.busy = false; syncButtons(); }
      });

      function paintOriginal() {
        const f = Core.fitSize(st.bitmap.width, st.bitmap.height);
        cv.width = f.w; cv.height = f.h;
        st.ctx.imageSmoothingEnabled = true; st.ctx.drawImage(st.bitmap, 0, 0, f.w, f.h);
        return f;
      }

      // ── Öffnen und Bild lesen ──
      setTool('blackout'); syncButtons();
      window.addEventListener('resize', fit);
      dlg.showModal();
      bRaw.focus();
      (async () => {
        try {
          st.bitmap = await decode(file);
          st.ctx = cv.getContext('2d', { willReadFrequently: true });
          const f = paintOriginal();
          st.hist = Core.createHistory(st.ctx); st.decoded = true;
          if (f.scaled) say('Bild wurde auf ' + f.w + '×' + f.h + ' verkleinert (Obergrenze der Zeichenfläche).', 'warn');
          fit(); syncButtons(); toolBtns.blackout.focus();
        } catch (e) {
          st.decoded = false; holder.hidden = true;
          say('Das Bild konnte nicht gelesen werden. Es lässt sich nicht bearbeiten; "Unverändert einfügen" bleibt möglich.', 'error'); syncButtons();
        }
      })();
    });
  }

  window.ImageEditor = { open, MAX_RESULT_BYTES };
})();
