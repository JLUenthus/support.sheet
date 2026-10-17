// ============================================================
// News Curator – Reiter "News" | "CVE-Bericht" | "Patchday"
// ============================================================
// WAI-ARIA-Tabs-Muster mit automatischer Aktivierung: Pfeiltasten (links/
// rechts, mit Umbruch), Home/End; Enter/Leertaste wirken über den normalen
// Button-Klick. Roving tabindex: nur der aktive Reiter ist per Tab
// erreichbar. Die Reiter-Buttons sind statisch und werden nie neu
// aufgebaut, dadurch kann der Fokus nicht verloren gehen (der Fokus-Bug der
// Themen-Pillen aus Prompt 8 entsteht durch Neuaufbau beim Rendern).
// Direktaufruf: news.html#cve öffnet den CVE-Reiter, news.html#patch den
// Patchday-Reiter. Ein Hash auf einen Abschnitt innerhalb eines Panels
// (z. B. #news-cve-archive-section) öffnet das zugehörige Panel.
(function () {
  const TABS = [
    { id: 'news', hash: '' },
    { id: 'cve', hash: '#cve' },
    { id: 'patch', hash: '#patch' },
  ];
  let activeId = 'news';

  function tabEl(id) { return document.getElementById('news-tab-' + id); }
  function panelEl(id) { return document.getElementById('news-panel-' + id); }

  function select(id, opts) {
    const options = opts || {};
    activeId = id;
    TABS.forEach(t => {
      const active = t.id === id;
      const tab = tabEl(t.id);
      const panel = panelEl(t.id);
      if (!tab || !panel) return;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle('news-tab--active', active);
      panel.hidden = !active;
    });
    // Die fixierte Fortschrittsleiste gehört zum Feed (News-Reiter).
    document.body.classList.toggle('news-tab-cve', id === 'cve');
    document.body.classList.toggle('news-tab-patch', id === 'patch');
    if (id === 'cve') window.NewsCve?.refreshSummary();
    if (id === 'patch') window.NewsPatch?.refreshSummary();
    if (options.focus) tabEl(id)?.focus();
    if (options.updateHash) {
      const target = TABS.find(t => t.id === id).hash;
      history.replaceState(null, '', location.pathname + location.search + target);
    }
  }

  // Ziel eines Hashs innerhalb des Panels dieses Reiters (z. B. #news-cve-archive-section)?
  function targetInPanel(tabId) {
    const own = TABS.find(t => t.id === tabId).hash;
    if (!location.hash || location.hash === own) return null;
    let id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* kaputtes Escape: Rohwert verwenden */ }
    const target = document.getElementById(id);
    return target && target.closest('#news-panel-' + tabId) ? target : null;
  }

  function idFromHash() {
    for (const t of TABS) {
      if (t.hash && (location.hash === t.hash || targetInPanel(t.id))) return t.id;
    }
    return 'news';
  }

  function onKeydown(e) {
    const current = TABS.findIndex(t => tabEl(t.id) === document.activeElement);
    if (current < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (current + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(TABS[next].id, { focus: true, updateHash: true });
  }

  function onHashChange() {
    const direct = TABS.find(t => t.hash && t.hash === location.hash);
    if (direct) { select(direct.id); return; }
    if (!location.hash) { select('news'); return; }
    // Anker aus dem News-Bereich: war ein anderer Reiter offen, war das Ziel
    // verborgen und der Browser hat nicht gescrollt, also nachholen.
    const target = document.getElementById(location.hash.slice(1));
    if (target && target.closest('#news-panel-news') && activeId !== 'news') {
      select('news');
      target.scrollIntoView();
    }
    // Gleiches für Abschnitte des CVE- und des Patchday-Panels (Zurück/Vorwärts zwischen Reitern).
    TABS.forEach(t => {
      if (!t.hash) return;
      const inPanel = targetInPanel(t.id);
      if (inPanel && activeId !== t.id) {
        select(t.id);
        inPanel.scrollIntoView();
      }
    });
  }

  function init() {
    if (!TABS.every(t => tabEl(t.id))) return;
    TABS.forEach(t => {
      tabEl(t.id).addEventListener('click', () => select(t.id, { updateHash: true }));
      tabEl(t.id).addEventListener('keydown', onKeydown);
    });
    const initial = idFromHash();
    select(initial);
    // Beim Laden mit Hash auf einen Abschnitt eines Panels war das Ziel noch
    // verborgen, der Browser hat nicht gescrollt: nachholen.
    if (initial !== 'news') targetInPanel(initial)?.scrollIntoView();
    window.addEventListener('hashchange', onHashChange);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
