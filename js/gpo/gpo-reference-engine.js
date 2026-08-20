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
      description: 'Microsoft-Baselines können als getrennte Referenzdaten importiert werden; der Import erzeugt noch keinen Kundenvergleich.',
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
  Object.values(STANDARD_META).forEach(meta => registry.set(meta.id, { ...meta, requirements: [], baseline: null }));

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


  function normalizeBaselineSetting(item) {
    if (!item || !item.id || !item.settingKey) throw new Error('Baseline-Setting benötigt ID und settingKey.');
    return {
      id: String(item.id),
      standardId: 'microsoft',
      baselineVersion: item.baselineVersion || null,
      gpoId: item.gpoId || null,
      gpoName: item.gpoName || null,
      settingKey: String(item.settingKey),
      name: item.name || item.settingKey,
      category: item.category || null,
      scope: item.scope || null,
      value: item.value === undefined ? null : item.value,
      state: item.state || null,
      supported: item.supported || null,
      comparability: item.comparability === 'not_comparable' ? 'not_comparable' : 'comparable',
      sourceFile: item.sourceFile || null,
    };
  }

  function registerBaselineSettings(settings, meta) {
    const standard = registry.get('microsoft');
    standard.baseline = {
      ...(meta || {}),
      settings: (settings || []).map(normalizeBaselineSetting),
    };
    standard.state = 'active';
    return getBaseline();
  }

  function getBaseline() {
    const standard = registry.get('microsoft');
    if (!standard || !standard.baseline) return null;
    return { ...standard.baseline, settings: standard.baseline.settings.map(s => ({ ...s })) };
  }
  function getStandard(standardId) {
    const standard = registry.get(standardId);
    if (!standard) return null;
    return {
      ...standard,
      baseline: standard.baseline ? { ...standard.baseline, settings: standard.baseline.settings.map(s => ({ ...s })) } : null,
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
    registerBaselineSettings,
    getBaseline,
  };
})();
