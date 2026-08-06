// ============================================================
// support.sheet – Guide Overlay
// Zeigt Support-Guides (data/support-guides.json) inline auf
// den Command-Seiten an, ohne Seitenwechsel.
// ============================================================

window.GuideOverlay = (function() {

  let _guides = [];
  let _loaded = false;

  // Support-Guides einmalig laden
  async function loadGuides() {
    if (_loaded) return;
    try {
      const r = await fetch('./data/support-guides.json');
      const d = await r.json();
      _guides = d.guides || [];
      _loaded = true;
    } catch(e) {
      console.warn('support-guides.json nicht geladen:', e);
      _guides = [];
      _loaded = true;
    }
  }

  // Guide per ID finden
  function findGuide(id) {
    return _guides.find(g => g.id === id) || null;
  }

  // Overlay oeffnen
  async function open(guideId) {
    await loadGuides();
    const guide = findGuide(guideId);
    if (!guide) return;

    const overlay  = document.getElementById('guide-overlay');
    const titleEl  = document.getElementById('guide-overlay-title');
    const contentEl = document.getElementById('guide-overlay-content');
    const openBtn  = document.getElementById('guide-overlay-open');

    if (!overlay) return;

    titleEl.textContent = guide.title;
    openBtn.href = 'guides-view.html?id=' + guide.id;
    openBtn.title = 'Guide "' + guide.title + '" in guide.sheet öffnen';

    // Markdown rendern falls marked.js verfuegbar
    if (typeof marked !== 'undefined') {
      contentEl.innerHTML = marked.parse(guide.content || '');
    } else {
      // Fallback: plain text mit <br> fuer Zeilenumbrueche
      contentEl.innerHTML = '<pre style="white-space:pre-wrap;font-family:var(--font-ui)">'
        + (guide.content || '').replace(/</g, '&lt;') + '</pre>';
    }

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('guide-overlay-close')?.focus();
  }

  // Overlay schliessen
  function close() {
    const overlay = document.getElementById('guide-overlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = '';
  }

  // Event-Handler registrieren
  function init() {
    const overlay  = document.getElementById('guide-overlay');
    const closeBtn = document.getElementById('guide-overlay-close');
    const backdrop = overlay?.querySelector('.guide-overlay-backdrop');

    closeBtn?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });
  }

  return { open, close, init, loadGuides };

})();

document.addEventListener('DOMContentLoaded', () => {
  GuideOverlay.init();
  // Guides vorausladen damit erstes Oeffnen schnell ist
  GuideOverlay.loadGuides();
});
