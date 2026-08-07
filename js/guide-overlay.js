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

  // HTML-Escaping fuer Links (Titel/URL koennen Sonderzeichen enthalten)
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Guide-Objekt ins Overlay rendern (Titel, Inhalt, Links)
  function renderGuide(guide) {
    const overlay  = document.getElementById('guide-overlay');
    const titleEl  = document.getElementById('guide-overlay-title');
    const contentEl = document.getElementById('guide-overlay-content');
    const openBtn  = document.getElementById('guide-overlay-open');

    if (!overlay) return;

    titleEl.textContent = guide.title;
    openBtn.href = 'guides-view.html?id=' + guide.id;
    openBtn.removeAttribute('target'); // direkt navigieren statt neuer Tab
    openBtn.title = 'Guide in guide.sheet öffnen';

    // Markdown rendern falls marked.js verfuegbar
    let html;
    if (typeof marked !== 'undefined') {
      html = marked.parse(guide.content || '');
    } else {
      // Fallback: plain text mit <br> fuer Zeilenumbrueche
      html = '<pre style="white-space:pre-wrap;font-family:var(--font-ui)">'
        + escapeHtml(guide.content || '') + '</pre>';
    }

    // Links anhaengen, falls vorhanden
    const links = Array.isArray(guide.links) ? guide.links.filter(l => l && l.url) : [];
    if (links.length) {
      html += '<div class="guide-overlay-links">'
        + '<h3>🔗 Links</h3><ul>'
        + links.map(l => {
            const label = l.text && l.text.trim() ? l.text.trim() : l.url;
            return '<li><a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener">'
              + escapeHtml(label) + '</a></li>';
          }).join('')
        + '</ul></div>';
    }

    contentEl.innerHTML = html;

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('guide-overlay-close')?.focus();
  }

  // Overlay oeffnen per Guide-ID (laedt/durchsucht support-guides.json)
  async function open(guideId) {
    await loadGuides();
    const guide = findGuide(guideId);
    if (!guide) return;
    renderGuide(guide);
  }

  // Overlay oeffnen mit bereits vorhandenem Guide-Objekt
  // (z.B. Support-Guide-Kacheln in guides.html, die den Guide
  // schon geladen haben und nicht nochmal per ID suchen muessen)
  function openFromData(guide) {
    if (!guide) return;
    renderGuide(guide);
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

  return { open, openFromData, close, init, loadGuides };

})();

document.addEventListener('DOMContentLoaded', () => {
  GuideOverlay.init();
  // Guides vorausladen damit erstes Oeffnen schnell ist
  GuideOverlay.loadGuides();
});
