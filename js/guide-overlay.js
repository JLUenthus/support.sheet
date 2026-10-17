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

    // Markdown gefiltert rendern (js/safe-markdown.js): auch die Support-Guides laufen über denselben Weg wie die übrigen Guides.
    // Ohne das Modul bleibt nur Text.
    if (window.SafeMarkdown) {
      window.SafeMarkdown.renderInto(contentEl, guide.content || '');
    } else {
      const pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;font-family:var(--font-ui)';
      pre.textContent = guide.content || '';
      contentEl.replaceChildren(pre);
    }

    // Links anhaengen, falls vorhanden (nur Textknoten und geprüfte Ziele, kein innerHTML)
    const links = Array.isArray(guide.links) ? guide.links.filter(l => l && l.url) : [];
    if (links.length) {
      const box = document.createElement('div');
      box.className = 'guide-overlay-links';
      const h3 = document.createElement('h3');
      h3.textContent = '🔗 Links';
      const ul = document.createElement('ul');
      links.forEach(l => {
        const url = String(l.url);
        const label = typeof l.text === 'string' && l.text.trim() ? l.text.trim() : url;
        const li = document.createElement('li');
        const safe = window.SafeMarkdown && window.SafeMarkdown.safeLink(url);
        if (safe) {
          const a = document.createElement('a');
          a.setAttribute('href', safe.href);
          if (safe.external) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
          a.textContent = label;
          li.appendChild(a);
        } else {
          li.textContent = label;   // unsicheres oder ungültiges Ziel: nur als Text
        }
        ul.appendChild(li);
      });
      box.appendChild(h3);
      box.appendChild(ul);
      contentEl.appendChild(box);
    }

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
