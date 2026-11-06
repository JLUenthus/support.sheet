// ============================================================
// image-editor-core.js – reine Bildlogik des Bildeditors (Schwärzen, Kasten, Pfeil, Zuschneiden, Rückgängig, Ausgabe), ohne Dialog.
// Arbeitet auf einem 2D-Kontext (CanvasRenderingContext2D) in ganzzahligen Pixelkoordinaten der vollen Auflösung.
//
// Datensicherheit:
//   - Schwärzen ist vollflächig (0, 0, 0, 255) und endgültig: kein Verpixeln, kein Weichzeichnen, keine Ebene. Die Pixel werden in der Zeichenfläche überschrieben.
//   - Die Ausgabe wird immer aus der Zeichenfläche neu kodiert (PNG, bei JPEG-Quellen JPEG mit Qualität 0,92): keine Originalbytes, keine Metadaten (EXIF, GPS, Software).
//   - Rückgängig sichert nur die betroffenen Teilbereiche im Arbeitsspeicher (höchstens 20 Schritte); nichts wird gespeichert.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImageEditorCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_STEPS = 20;
  const JPEG_QUALITY = 0.92;
  const MAX_SIDE = 16384;                 // Obergrenze einer Seite der Zeichenfläche (Chrome und Firefox; Messung in der Vorprüfung)
  const MAX_PIXELS = 100 * 1000 * 1000;   // Obergrenze der Fläche (RGBA = 4 Byte je Pixel, also höchstens 400 MB); darüber wird verkleinert
  const BLACK = '#000000';

  // ── Koordinaten ──
  // Anzeigekoordinate (CSS-Pixel im Dialog) in Pixel der vollen Auflösung: Faktor, auf ganze Pixel gerundet.
  const toImage = (v, scale) => Math.round(v * scale);
  // Rechteck aus zwei Eckpunkten (beliebige Reihenfolge) in ganzen Pixeln, auf die Bildgrenzen begrenzt; null, wenn die Fläche leer ist.
  function clampRect(x1, y1, x2, y2, W, H) {
    let x0 = Math.min(x1, x2), y0 = Math.min(y1, y2), xe = Math.max(x1, x2), ye = Math.max(y1, y2);
    x0 = Math.max(0, Math.min(W, Math.round(x0))); xe = Math.max(0, Math.min(W, Math.round(xe)));
    y0 = Math.max(0, Math.min(H, Math.round(y0))); ye = Math.max(0, Math.min(H, Math.round(ye)));
    const w = xe - x0, h = ye - y0;
    return w > 0 && h > 0 ? { x: x0, y: y0, w, h } : null;
  }
  // Größe, auf die ein Bild für die Zeichenfläche verkleinert wird (gleiches Seitenverhältnis); unverändert, wenn es passt.
  function fitSize(w, h) {
    if (w <= MAX_SIDE && h <= MAX_SIDE && w * h <= MAX_PIXELS) return { w, h, scaled: false };
    const f = Math.min(MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_PIXELS / (w * h)));
    return { w: Math.max(1, Math.floor(w * f)), h: Math.max(1, Math.floor(h * f)), scaled: true };
  }

  // ── Werkzeuge (verändern die Zeichenfläche, geben das betroffene Rechteck zurück) ──
  // Schwärzen: ersetzt jedes Pixel im Rechteck durch (0, 0, 0, 255). Deckkraft 1, source-over, ganze Pixel: kein Anti-Aliasing, kein Rest des Originals.
  function blackout(ctx, rect) {
    if (!rect) return null;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = BLACK;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    return rect;
  }
  // Kasten: Rahmen der Stärke t innerhalb des Rechtecks, aus vier gefüllten Rechtecken (ganze Pixel, keine Kantenglättung).
  function box(ctx, rect, color, t) {
    if (!rect) return null;
    const w = Math.max(1, Math.min(Math.round(t), Math.floor(Math.min(rect.w, rect.h) / 2) || 1));
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = color;
    ctx.fillRect(rect.x, rect.y, rect.w, w);
    ctx.fillRect(rect.x, rect.y + rect.h - w, rect.w, w);
    ctx.fillRect(rect.x, rect.y + w, w, Math.max(0, rect.h - 2 * w));
    ctx.fillRect(rect.x + rect.w - w, rect.y + w, w, Math.max(0, rect.h - 2 * w));
    ctx.restore();
    return rect;
  }
  // Pfeil von (x1, y1) nach (x2, y2): Schaft und zwei Linien der Spitze; liefert das umgebende Rechteck (mit Rand für Linienstärke und Spitze).
  function arrowBounds(x1, y1, x2, y2, t, W, H) {
    const head = Math.max(12, t * 4), pad = Math.ceil(head + t);
    return clampRect(Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad, W, H);
  }
  function arrow(ctx, x1, y1, x2, y2, color, t) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const ux = dx / len, uy = dy / len, head = Math.min(Math.max(12, t * 4), len);
    const spread = Math.PI / 7;
    const bx = (a) => [x2 - head * (ux * Math.cos(a) - uy * Math.sin(a)), y2 - head * (uy * Math.cos(a) + ux * Math.sin(a))];
    const l = bx(spread), r = bx(-spread);
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = color; ctx.lineWidth = t; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();                       // Schaft
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(l[0], l[1]); ctx.stroke();                   // Spitze, erste Linie
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(r[0], r[1]); ctx.stroke();                   // Spitze, zweite Linie
    ctx.restore();
    return { x1, y1, x2, y2 };
  }

  // ── Verlauf: Rückgängig und Wiederholen über gesicherte Teilbereiche ──
  // Vor jeder Operation: history.begin(rect) sichert die Pixel des Rechtecks; nach der Operation: history.commit() sichert den neuen Stand dieses Rechtecks (für Wiederholen).
  // Zuschnitt: history.beginCrop() / commitCrop(): sichert die gesamte Fläche vor und nach dem Zuschnitt.
  function createHistory(ctx, limit) {
    const max = limit || MAX_STEPS;
    const undoStack = [], redoStack = [];
    let pending = null;
    const cv = () => ctx.canvas;
    function begin(rect) { pending = rect ? { type: 'rect', x: rect.x, y: rect.y, w: rect.w, h: rect.h, before: ctx.getImageData(rect.x, rect.y, rect.w, rect.h), after: null } : null; return !!pending; }
    function beginCrop() { pending = { type: 'crop', x: 0, y: 0, w: cv().width, h: cv().height, before: ctx.getImageData(0, 0, cv().width, cv().height), after: null }; return true; }
    function commit() {
      if (!pending) return false;
      const p = pending; pending = null;
      p.after = p.type === 'crop' ? ctx.getImageData(0, 0, cv().width, cv().height) : ctx.getImageData(p.x, p.y, p.w, p.h);
      undoStack.push(p); if (undoStack.length > max) undoStack.shift();
      redoStack.length = 0;
      return true;
    }
    function cancel() { pending = null; }
    function apply(e, which) {
      const data = e[which];
      if (e.type === 'crop') { cv().width = data.width; cv().height = data.height; ctx.putImageData(data, 0, 0); } else ctx.putImageData(data, e.x, e.y);
    }
    function undo() { const e = undoStack.pop(); if (!e) return false; apply(e, 'before'); redoStack.push(e); return true; }
    function redo() { const e = redoStack.pop(); if (!e) return false; apply(e, 'after'); undoStack.push(e); return true; }
    function clear() { undoStack.length = 0; redoStack.length = 0; pending = null; }
    return { begin, beginCrop, commit, cancel, undo, redo, clear, get undoCount() { return undoStack.length; }, get redoCount() { return redoStack.length; }, get limit() { return max; } };
  }

  // Zuschneiden: ersetzt die Zeichenfläche durch den Ausschnitt (Auflösung bleibt). Mit history: rückgängig machbar.
  function crop(ctx, rect, history) {
    if (!rect) return false;
    const cv = ctx.canvas;
    if (rect.x === 0 && rect.y === 0 && rect.w === cv.width && rect.h === cv.height) return false;
    const part = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    if (history) history.beginCrop();
    cv.width = rect.w; cv.height = rect.h;
    ctx.putImageData(part, 0, 0);
    if (history) history.commit();
    return true;
  }

  // ── Ausgabe ──
  // PNG, bei JPEG-Quellen JPEG; immer neu kodiert aus der Zeichenfläche (keine Metadaten, keine Originalbytes).
  const outputType = (type) => (/^image\/jpe?g$/i.test(type || '') ? 'image/jpeg' : 'image/png');
  function extensionFor(type) { return type === 'image/jpeg' ? '.jpg' : '.png'; }
  function encode(canvas, type) {
    const mime = outputType(type);
    return new Promise((resolve, reject) => {
      try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Kodieren fehlgeschlagen'))), mime, mime === 'image/jpeg' ? JPEG_QUALITY : undefined); } catch (e) { reject(e); }
    });
  }
  // Dateiname des Ergebnisses: Name ohne Endung plus passende Endung (PNG oder JPEG); leerer Name ergibt "bild".
  function resultName(name, type) {
    const mime = outputType(type);
    let base = String(name || '').trim().replace(/\.[A-Za-z0-9]{1,5}$/, '');
    if (!base) base = 'bild';
    return base + extensionFor(mime);
  }

  return { MAX_STEPS, JPEG_QUALITY, MAX_SIDE, MAX_PIXELS, toImage, clampRect, fitSize, blackout, box, arrow, arrowBounds, createHistory, crop, outputType, extensionFor, encode, resultName };
}));
