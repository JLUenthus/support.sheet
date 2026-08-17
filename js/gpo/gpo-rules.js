// ============================================================
// gpo-rules.js – laedt data/gpo/rules.json (Hygiene-/Security-
// Filter-/WMI-Filter-Regeln, siehe Konzept Abschnitt 8, 9, 10).
// gpo-analyzer.js verwendet diese Regeln als einzige Quelle fuer
// Name/Beschreibung/Empfehlung - keine Regel-Texte im Analyzer
// oder Renderer hart verdrahtet.
// ============================================================
window.GpoRules = (function() {
  let rulesPromise = null;

  function loadRules() {
    if (!rulesPromise) {
      rulesPromise = fetch('./data/gpo/rules.json')
        .then(r => r.json())
        .then(data => data.rules || [])
        .catch(() => []);
    }
    return rulesPromise;
  }

  function getRuleById(rules, id) {
    return (rules || []).find(r => r.id === id) || null;
  }

  return { loadRules, getRuleById };
})();
