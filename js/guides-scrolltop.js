// ============================================================
// guide.sheet – guides-scrolltop.js (Pfeil nach oben auf den Guide-Seiten: Ansicht, Editor, Übersicht)
// nav.js erzeugt den Pfeil (.as-scroll-top) und blendet ihn nach dem Scrollen von .gs-main ein. Bis 900 px Fensterbreite rollt aber die Seite (gestapeltes Layout, css/guides.css),
// nicht .gs-main: dort erschien er nie. Dieses Skript bindet den vorhandenen Pfeil an den Bereich, der tatsächlich rollt (ab 901 px .gs-main, darunter das Fenster):
//   - sichtbar, sobald dieser Bereich um mehr als 300 px gerollt ist
//   - Klick bringt diesen Bereich nach oben (glatt, bei prefers-reduced-motion sofort); der Klick-Handler aus nav.js wird dafür nicht mehr erreicht
//   - Aussehen und Beschriftung bleiben die aus nav.js, die Lage steht in css/guides-wide.css und css/guides-scrolltop.css
// nav.js bleibt unverändert. Kein Speicherzugriff.
// ============================================================
(function () {
  'use strict';

  const THRESHOLD = 300;
  const STACK_MAX = 900;

  function init() {
    const btn = document.querySelector('.as-scroll-top');
    if (!btn) return false;
    const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
    const main = () => document.querySelector('.gs-main');

    // Der Bereich, der gerade rollt: bis 900 px das Fenster, darüber .gs-main (null = Fenster)
    function scroller() {
      if (window.innerWidth <= STACK_MAX) return null;
      const m = main();
      return m && getComputedStyle(m).overflowY !== 'visible' ? m : null;
    }
    const pos = () => { const s = scroller(); return s ? s.scrollTop : window.scrollY; };

    function update() { btn.classList.toggle('visible', pos() > THRESHOLD); }

    btn.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      const s = scroller();
      const o = { top: 0, behavior: reduced() ? 'auto' : 'smooth' };
      if (s) s.scrollTo(o); else window.scrollTo(o);
    }, true);

    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const m = main(); if (m) m.addEventListener('scroll', update, { passive: true });
    update();
    // Editor: Höhe der festen Fußleiste für die Lage des Pfeils (css/guides-wide.css: bottom = --gs-bar-h + 57 px)
    const bar = document.getElementById('ge-bottom-bar');
    if (bar) { const sync = () => document.documentElement.style.setProperty('--gs-bar-h', bar.offsetHeight + 'px'); sync(); window.addEventListener('resize', sync); if (window.ResizeObserver) new ResizeObserver(sync).observe(bar); }
    return true;
  }

  // nav.js legt den Pfeil beim Laden an (Skript am Ende der Seite); falls er noch fehlt, nach dem Laden erneut versuchen
  if (!init()) window.addEventListener('load', init);
})();
