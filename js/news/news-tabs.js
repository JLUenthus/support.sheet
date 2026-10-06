// ============================================================
// News Curator – Reiter "News" | "CVE-Bericht"
// ============================================================
// WAI-ARIA-Tabs-Muster mit automatischer Aktivierung: Pfeiltasten (links/
// rechts, mit Umbruch), Home/End; Enter/Leertaste wirken über den normalen
// Button-Klick. Roving tabindex: nur der aktive Reiter ist per Tab
// erreichbar. Die Reiter-Buttons sind statisch und werden nie neu
// aufgebaut, dadurch kann der Fokus nicht verloren gehen (der Fokus-Bug der
// Themen-Pillen aus Prompt 8 entsteht durch Neuaufbau beim Rendern).
// Direktaufruf: news.html#cve öffnet den CVE-Reiter.
(function () {
  const TABS = [
    { id: 'news', hash: '' },
    { id: 'cve', hash: '#cve' },
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
    if (id === 'cve') window.NewsCve?.refreshSummary();
    if (options.focus) tabEl(id)?.focus();
    if (options.updateHash) {
      const target = TABS.find(t => t.id === id).hash;
      history.replaceState(null, '', location.pathname + location.search + target);
    }
  }

  function idFromHash() {
    return location.hash === '#cve' ? 'cve' : 'news';
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
    if (location.hash === '#cve') { select('cve'); return; }
    if (!location.hash) { select('news'); return; }
    // Anker aus dem News-Bereich: war der CVE-Reiter offen, war das Ziel
    // verborgen und der Browser hat nicht gescrollt, also nachholen.
    const target = document.getElementById(location.hash.slice(1));
    if (target && target.closest('#news-panel-news') && activeId !== 'news') {
      select('news');
      target.scrollIntoView();
    }
  }

  function init() {
    if (!tabEl('news') || !tabEl('cve')) return;
    TABS.forEach(t => {
      tabEl(t.id).addEventListener('click', () => select(t.id, { updateHash: true }));
      tabEl(t.id).addEventListener('keydown', onKeydown);
    });
    select(idFromHash());
    window.addEventListener('hashchange', onHashChange);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
