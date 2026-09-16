// ============================================================
// News Curator – Bereichsnavigation (Sprungmarken + Scroll-Spy)
// ============================================================
// Selbes Muster wie in eventlog.html/gpo.html (dort: initElNavHighlight()) -
// hebt den Nav-Link der gerade sichtbaren Sektion hervor. Eigenständige
// Datei statt Kopie, da news.html (noch) keine vergleichbare "renderer"-Datei
// hat, in die das sonst gehören würde.
(function () {
  function initNewsNavHighlight() {
    if (typeof IntersectionObserver !== 'function') return;
    const linksById = {};
    document.querySelectorAll('.news-page-nav-link').forEach(a => {
      const id = (a.getAttribute('href') || '').replace('#', '');
      if (id) linksById[id] = a;
    });
    const sections = Object.keys(linksById).map(id => document.getElementById(id)).filter(Boolean);
    if (!sections.length) return;

    let activeId = null;
    function setActive(id) {
      if (id === activeId) return;
      activeId = id;
      Object.keys(linksById).forEach(linkId => {
        linksById[linkId].classList.toggle('news-page-nav-link--active', linkId === id);
      });
    }
    const ratioById = new Map();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => { ratioById.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0); });
      let bestId = null, bestRatio = 0;
      ratioById.forEach((ratio, id) => { if (ratio > bestRatio) { bestRatio = ratio; bestId = id; } });
      if (bestId) setActive(bestId);
    }, { root: null, rootMargin: '-96px 0px -55% 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });

    sections.forEach(sec => observer.observe(sec));
  }

  // "Später lesen"-Badge: reiner Zähler aus dem bereits initialisierten
  // news.saved-Array (siehe news-storage.js), keine Feed-/Board-Logik.
  function initSavedBadge() {
    const badge = document.getElementById('news-saved-badge');
    if (!badge || !window.NewsStorage) return;
    const saved = window.NewsStorage.readJSON(window.NewsStorage.KEYS.saved, []);
    badge.textContent = saved.length ? String(saved.length) : '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNewsNavHighlight();
    initSavedBadge();
  });
})();
