// GPO Analyzer – CIS localization guard
// Only exact keys or explicitly verified aliases may match.
// No automatic translation, fuzzy matching, or language guessing.
window.GpoCisLocalization = (function() {
  const _aliases = Object.create(null);

  function normalize(value) {
    return String(value || '').trim();
  }

  function registerVerifiedAlias(cisKey, snapshotKey, locale, evidence) {
    const c = normalize(cisKey), s = normalize(snapshotKey), l = normalize(locale);
    if (!c || !s || !l || !evidence) throw new Error('Verified CIS alias requires key, snapshot key, locale and evidence.');
    const key = c + '|' + l;
    _aliases[key] = { snapshotKey: s, locale: l, evidence: String(evidence) };
  }

  function resolve(cisKey, snapshotKeys, locale) {
    const c = normalize(cisKey);
    const keys = Array.isArray(snapshotKeys) ? snapshotKeys.map(normalize).filter(Boolean) : [];
    if (keys.includes(c)) return { state: 'exact', snapshotKey: c };
    const alias = _aliases[c + '|' + normalize(locale)];
    if (alias && keys.includes(alias.snapshotKey)) {
      return { state: 'verified_alias', snapshotKey: alias.snapshotKey, evidence: alias.evidence, locale: alias.locale };
    }
    return {
      state: locale ? 'locale_sensitive_unresolved' : 'unresolved',
      snapshotKey: null,
      locale: normalize(locale) || null
    };
  }

  function isLocaleSensitive(mappingStatus) {
    return mappingStatus === 'exact-ui-path-locale-sensitive';
  }

  return { normalize, registerVerifiedAlias, resolve, isLocaleSensitive };
})();
