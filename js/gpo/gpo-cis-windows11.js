// ============================================================
// GPO Analyzer – CIS Windows 11 catalog
// V5.2 Mapping A: Account Policies, User Rights Assignment, Security Options.
// Katalog-only: no compliance calculation and no score.
// ============================================================
window.GpoCisWindows11 = (function() {
  let _catalog = null;

  function buildProvenance(catalog) {
    return {
      standard: 'CIS',
      role: 'Benchmark / Empfehlungen',
      source: String(catalog?.source || 'CIS Benchmarks'),
      benchmarks: (catalog?.benchmarks || []).map(b => ({
        id: b.id || '', platform: b.platform || '', version: b.version || '', releaseDate: b.releaseDate || '', document: b.document || ''
      }))
    };
  }

  async function load() {
    if (_catalog) return _catalog;
    const response = await fetch('./data/gpo/cis-windows11-baselines.json');
    if (!response.ok) throw new Error('CIS Windows 11-Katalog konnte nicht geladen werden.');
    _catalog = await response.json();
    _catalog.referenceProvenance = buildProvenance(_catalog);
    const summary = {};
    let mapped = 0;
    (_catalog.benchmarks || []).forEach(b => {
      const counts = { accountPolicy: 0, userRight: 0, securityOption: 0, administrativeTemplate: 0, advancedAuditPolicy: 0, windowsFirewall: 0, systemService: 0, notMapped: 0, localeSensitive: 0, referenceOnly: 0 };
      (b.recommendations || []).forEach(r => {
        if (r.mappingType === 'account-policy') counts.accountPolicy++;
        else if (r.mappingType === 'user-right') counts.userRight++;
        else if (r.mappingType === 'security-option') counts.securityOption++;
        else if (r.mappingType === 'administrative-template') counts.administrativeTemplate++;
        else if (r.mappingType === 'advanced-audit-policy') counts.advancedAuditPolicy++;
        else if (r.mappingType === 'windows-firewall') counts.windowsFirewall++;
        else if (r.mappingType === 'system-service') counts.systemService++;
        else counts.notMapped++;
      });
      counts.mapped = counts.accountPolicy + counts.userRight + counts.securityOption;
      counts.localeSensitive = counts.administrativeTemplate;
      counts.referenceOnly = counts.advancedAuditPolicy + counts.windowsFirewall + counts.systemService;
      mapped += counts.mapped;
      summary[b.id] = counts;
    });
    _catalog.mappingSummary = { mappedRecommendations: mapped, byBenchmark: summary };
    return _catalog;
  }

  return { load };
})();
