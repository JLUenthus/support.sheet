// ============================================================
// guide.sheet – guides-print.js (Drucken als PDF auf guides-view.html)
// Fehler vorher: js/safe-markdown.js setzt auf jedem Bild loading="lazy". Wer druckt, bevor man bis zum Ende gescrollt hat, bekommt für alle Bilder außerhalb des
// sichtbaren Bereichs leere Flächen im PDF (gemessen: 6 von 12 Bildern, Firefox lädt solche Bilder beim Drucken noch später).
// Dieses Skript lädt vor jedem Druck alle Bilder des Guides: loading="eager", Warten auf das Laden und Dekodieren (img.decode(), je Bild mit Zeitlimit), erst dann window.print().
//   - Knopf "Als PDF drucken" (#gv-print-btn) und der Menüpunkt "Als PDF (Drucken)" (#gv-export-pdf) nehmen denselben Weg (der Klick auf den Menüpunkt wird vor
//     js/guides-view.js abgefangen, js/guides-view.js bleibt unverändert)
//   - beforeprint (Strg+P, Menü des Browsers): alle Bilder sofort auf eager, mehr ist dort nicht möglich (ein Ereignis kann nicht warten)
//   - Bilder, die nicht laden, stehen in einer Meldung, gedruckt wird trotzdem
//   - die Blob-Adressen der Bilder bleiben gültig (nichts wird freigegeben)
// Der Knopf folgt dem Exportbereich: bei Support-Guides (Exportieren ausgeblendet) ist er ebenfalls ausgeblendet.
// Kein Speicherzugriff, kein Netzwerkzugriff. Druckregeln: css/guides-print.css (nur @media print).
// ============================================================
(function () {
  'use strict';

  const IMG_TIMEOUT_MS = 20000;      // je Bild
  let running = null;

  function notify(msg, type) { if (typeof showToast === 'function') showToast(msg, type || 'warning'); }
  const images = () => [...document.querySelectorAll('#gv-content img')];

  function eagerAll() { images().forEach((img) => { if (img.getAttribute('loading') !== 'eager') img.setAttribute('loading', 'eager'); }); }

  // wartet, bis ein Bild geladen und dekodiert ist; liefert true, wenn es dargestellt werden kann
  function ready(img) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (!done) { done = true; clearTimeout(timer); resolve(ok); } };
      const timer = setTimeout(() => finish(false), IMG_TIMEOUT_MS);
      const decode = () => { if (typeof img.decode === 'function') img.decode().then(() => finish(true), () => finish(false)); else finish(true); };
      if (img.complete) { if (img.naturalWidth > 0) decode(); else finish(false); return; }
      img.addEventListener('load', () => (img.naturalWidth > 0 ? decode() : finish(false)), { once: true });
      img.addEventListener('error', () => finish(false), { once: true });
    });
  }

  async function prepare() {
    eagerAll();
    const list = images();
    const oks = await Promise.all(list.map(ready));
    return { total: list.length, failed: oks.filter((ok) => !ok).length };
  }

  function busy(on) {
    const btn = document.getElementById('gv-print-btn');
    if (!btn) return;
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function printNow() {
    if (running) return running;             // ein zweiter Klick während des Ladens druckt nicht doppelt
    busy(true);
    running = (async () => {
      const r = await prepare();
      if (r.failed) notify(r.failed + ' von ' + r.total + (r.total === 1 ? ' Bild' : ' Bildern') + ' konnte' + (r.failed === 1 ? '' : 'n') + ' nicht geladen werden und fehlt' + (r.failed === 1 ? '' : 'en') + ' im Ausdruck.', 'warning');
      window.print();
    })().catch((err) => { notify('Drucken fehlgeschlagen: ' + (err && err.message || err), 'error'); })
      .finally(() => { running = null; busy(false); });
    return running;
  }

  // Klick auf den Knopf und auf den Menüpunkt: Aufnahmephase am document, damit js/guides-view.js (window.print() ohne Warten) nicht mehr erreicht wird
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('#gv-print-btn, #gv-export-pdf') : null;
    if (!t) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const menu = document.getElementById('gv-export-menu');
    if (menu) menu.hidden = true;
    printNow();
  }, true);

  window.addEventListener('beforeprint', eagerAll);

  // Knopf nur, wo der Exportbereich sichtbar ist (Support-Guides sind schreibgeschützt: dort ist "Exportieren" ausgeblendet)
  function syncVisibility() {
    const wrap = document.querySelector('.gv-export-wrap'), btn = document.getElementById('gv-print-btn');
    if (wrap && btn) btn.hidden = wrap.hidden;
  }
  const wrap = document.querySelector('.gv-export-wrap');
  if (wrap) { syncVisibility(); new MutationObserver(syncVisibility).observe(wrap, { attributes: true, attributeFilter: ['hidden'] }); }
})();
