// ============================================================
// guides-image-hook.js – Anbindung des Bildeditors an den Guide-Editor (nur guides-create.html), von außen.
// Der Editor (js/guides-editor.js) bleibt unverändert. Er nimmt Bilder über drei Wege an: Strg+V mit Bild und Ablegen auf das Textfeld (#ge-textarea) sowie das Dateiauswahlfeld #ge-image-input
// (Knopf "Bild" der Werkzeugleiste); alle münden in seine Funktion handleImageFile. Dieses Skript fängt die drei Wege in der Aufnahmephase am Dokument ab (vor den Handlern des Editors),
// öffnet den Bildeditor und gibt das Ergebnis über denselben Weg weiter, den der Editor selbst benutzt: #ge-image-input.files und ein change-Ereignis.
// Reiner Text und andere Dateitypen laufen unverändert weiter (kein Eingriff in das Einfügen von Text). Abbrechen verändert nichts: kein Asset, kein Verweis, Text und Auswahl bleiben.
// Kein Netzwerk, keine Speicherung.
// ============================================================
(function () {
  'use strict';
  if (!window.ImageEditor) return;
  const IE = window.ImageEditor;
  let passing = false;          // true, solange das Ergebnis an den Editor weitergegeben wird (dann greift der Abfang nicht)
  let chain = Promise.resolve();
  const isImg = (f) => !!f && /^image\//i.test(f.type || '');
  const textarea = () => document.getElementById('ge-textarea');
  const input = () => document.getElementById('ge-image-input');

  function selection() { const t = textarea(); return t ? { s: t.selectionStart, e: t.selectionEnd } : null; }
  function restore(sel) { const t = textarea(); if (!t) return; try { t.focus(); if (sel) t.setSelectionRange(sel.s, sel.e); } catch (e) { /* Fokus ohne Auswahl */ } }

  function deliver(file, sel) {
    const i = input(); if (!i) return;
    restore(sel);
    const dt = new DataTransfer(); dt.items.add(file); i.files = dt.files;
    passing = true;
    try { i.dispatchEvent(new Event('change', { bubbles: true })); } finally { passing = false; }
  }
  function start(file) {
    chain = chain.then(async () => {
      const sel = selection();   // erst wenn das Bild an der Reihe ist: bei zwei Bildern hintereinander steht der Cursor dann hinter dem ersten Verweis
      try {
        const res = await IE.open(file);
        if (res.action === 'cancel') { restore(sel); return; }
        deliver(res.file, sel);
      } catch (e) {
        restore(sel);
        if (typeof showToast === 'function') showToast('Der Bildeditor konnte nicht geöffnet werden. Das Bild wurde nicht eingefügt.', 'error');
      }
    });
  }

  document.addEventListener('paste', (e) => {
    const t = textarea(); if (!t || e.target !== t || passing) return;
    const cd = e.clipboardData; if (!cd) return;
    let file = null;
    for (const it of (cd.items || [])) { if (it.kind === 'file' && /^image\//i.test(it.type)) { file = it.getAsFile(); break; } }
    if (!file && cd.files) for (const f of cd.files) { if (isImg(f)) { file = f; break; } }
    if (!file) return;                                       // reiner Text und anderes: unverändert
    e.preventDefault(); e.stopPropagation();
    start(file);
  }, true);

  document.addEventListener('drop', (e) => {
    const t = textarea(); if (!t || e.target !== t) return;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!isImg(f)) return;                                   // andere Dateien: weiter wie bisher (Meldung des Editors)
    e.preventDefault(); e.stopPropagation();
    t.classList.remove('ge-drag');
    start(f);
  }, true);

  document.addEventListener('change', (e) => {
    if (passing || e.target !== input()) return;
    const f = e.target.files && e.target.files[0];
    if (!isImg(f)) return;
    e.stopImmediatePropagation();
    e.target.value = '';
    start(f);
  }, true);
})();
