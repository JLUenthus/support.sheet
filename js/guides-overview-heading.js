// ============================================================
// guides-overview-heading.js – Zähler der Überschrift "Guides" auf guides.html (#gs-guides-count)
// Zählt die sichtbaren Guide-Kacheln (#gg-grid > .gg-tile, 0 bei verborgenem Raster: keine Treffer, kein Bestand, Ordner fehlt, Ladezustand) und schreibt die Zahl per
// textContent in den Zähler. Beobachtet nur das Raster (Kacheln kommen und gehen, Attribut hidden), mit kurzer Drosselung gegen Flackern. Liest nur das DOM, kein Speicher,
// keine Eingriffe in js/guides-overview.js. Fehlt das Raster oder der Zähler, tut das Skript nichts.
// ============================================================
(function () {
  'use strict';

  function init() {
    const grid = document.getElementById('gg-grid');
    const out = document.getElementById('gs-guides-count');
    if (!grid || !out) return;

    let timer = null;
    function update() {
      timer = null;
      const n = grid.hidden ? 0 : grid.querySelectorAll(':scope > .gg-tile').length;
      if (out.textContent !== String(n)) out.textContent = String(n);
    }
    function schedule() { if (timer === null) timer = setTimeout(update, 40); }

    update();
    new MutationObserver(schedule).observe(grid, { childList: true, attributes: true, attributeFilter: ['hidden'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
