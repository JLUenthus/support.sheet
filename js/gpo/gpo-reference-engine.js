// ============================================================
// GPO Analyzer – V5.0 Referenz-Engine
// Gemeinsame technische Struktur für externe Referenzstandards.
//
// Diese Schicht enthält bewusst KEINE fachliche Compliance-Berechnung,
// keine Scores und keine gemeinsame Bewertung verschiedener Standards.
// Standards/Requirements werden als getrennte Quellen registriert und
// können später über Adapter mit vorhandenen Setting-Keys verknüpft werden.
// ============================================================
window.GpoReferenceEngine = (function() {
  const STANDARD_META = {
    bsi: {
      id: 'bsi',
      label: 'BSI IT-Grundschutz',
      shortLabel: 'BSI',
      description: 'Hinterlegte BSI-Anforderungen und deren verifizierte Quellen.',
      state: 'active',
    },
    microsoft: {
      id: 'microsoft',
      label: 'Microsoft Security Baselines',
      shortLabel: 'Microsoft',
      description: 'Gemeinsame Referenzstruktur vorbereitet; Baseline-Regeln werden in V5.1 ergänzt.',
      state: 'prepared',
    },
    cis: {
      id: 'cis',
      label: 'CIS Benchmarks',
      shortLabel: 'CIS',
      description: 'Gemeinsame Referenzstruktur vorbereitet; Benchmark-Regeln werden in V5.2 ergänzt.',
      state: 'prepared',
    },
  };

  const registry = new Map();
  Object.values(STANDARD_META).forEach(meta => registry.set(meta.id, { ...meta, requirements: [] }));

  function normalizeSettingKeys(keys) {
    return Array.from(new Set((Array.isArray(keys) ? keys : []).filter(Boolean).map(String)));
  }

  function normalizeRequirement(standardId, item) {
    if (!item || !item.id) throw new Error('Referenzanforderung benötigt eine ID.');
    return {
      id: String(item.id),
      standardId,
      label: item.label || item.title || item.id,
      title: item.title || item.label || item.id,
      buildingBlock: item.buildingBlock || null,
      requirementNumber: item.requirementNumber || null,
      description: item.description || null,
      recommendation: item.recommendation || null,
      sourceLabel: item.sourceLabel || null,
      sourceUrl: item.sourceUrl || null,
      settingKeys: normalizeSettingKeys(item.settingKeys),
      state: item.state || 'active',
    };
  }

  function registerRequirements(standardId, requirements) {
    const standard = registry.get(standardId);
    if (!standard) throw new Error('Unbekannter Referenzstandard: ' + standardId);
    standard.requirements = (requirements || []).map(item => normalizeRequirement(standardId, item));
  }

  function getStandard(standardId) {
    const standard = registry.get(standardId);
    if (!standard) return null;
    return {
      ...standard,
      requirements: standard.requirements.map(r => ({ ...r, settingKeys: r.settingKeys.slice() })),
    };
  }

  function getCatalog() {
    return Array.from(registry.values()).map(standard => getStandard(standard.id));
  }

  function findRequirement(standardId, requirementId) {
    const standard = registry.get(standardId);
    if (!standard) return null;
    return standard.requirements.find(r => r.id === requirementId) || null;
  }

  return {
    STANDARD_META: JSON.parse(JSON.stringify(STANDARD_META)),
    registerRequirements,
    getStandard,
    getCatalog,
    findRequirement,
  };
})();
