// ============================================================
// News Curator – Patchday-Bericht: Navigationslink "Geöffneter Bericht"
// ============================================================
// Gleiches Muster wie news-cve-nav.js. Der Abschnitt "Bericht" (#news-patch-viewer-section) ist nur
// sichtbar, solange ein Bericht geöffnet ist. Der zugehörige Link in der Bereichsnavigation folgt diesem
// Zustand über das hidden-Attribut. Beobachtet wird das Attribut statt openReport()/closeReport() zu
// ändern. Die übrigen Links stehen statisch im HTML und werden vom bestehenden Scroll-Spy in
// news-nav.js eingesammelt.
(function () {
  function init() {
    const section = document.getElementById('news-patch-viewer-section');
    const link = document.getElementById('news-patch-nav-viewer');
    if (!section || !link) return;
    const sync = () => { link.hidden = section.hidden; };
    sync();
    new MutationObserver(sync).observe(section, { attributes: true, attributeFilter: ['hidden'] });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
