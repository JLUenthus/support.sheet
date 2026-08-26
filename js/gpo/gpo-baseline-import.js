// ============================================================
// gpo-baseline-import.js (V5.1-C, erweitert in V5.3-D)
// Importiert eine Microsoft-Security-Baseline-ZIP als getrennte
// Referenzdaten. Kein Zugriff auf _model, _findings oder
// BSI-Coverage. Keine Compliance-Berechnung.
//
// V5.3-D: zusaetzlich zu den bestehenden gpreport.xml-Settings wird, wenn
// im selben GPO-Backup-Ordner vorhanden, registry.pol (Machine/User)
// gelesen (window.GpoRegistryPol, real getestet in V5.3-B) und jeder
// Eintrag ueber Key+ValueName gegen einen vorab generierten ADMX-
// Referenzindex aufgeloest (window.GpoAdmxResolver, real getestet in
// V5.3-C). Rein additiv: bestehende settings/notComparable und die
// Vergleichslogik in gpo-renderer.js (collectMicrosoftBaselineComparison)
// bleiben unveraendert. Keine Bewertung, kein Score, kein Raten bei
// missing/ambiguous.
// ============================================================
window.GpoBaselineImporter = (function() {
  let _state = { status: 'empty', fileName: null, sha256: null, baselineVersion: null, settings: [], notComparable: [], registryEvidence: [], admxIndexError: null, gpoCount: 0, error: null };

  function reset() {
    _state = { status: 'empty', fileName: null, sha256: null, baselineVersion: null, settings: [], notComparable: [], registryEvidence: [], admxIndexError: null, gpoCount: 0, error: null };
  }
  function getState() {
    return { ..._state, settings: _state.settings.map(s => ({ ...s })), notComparable: _state.notComparable.map(s => ({ ...s })), registryEvidence: (_state.registryEvidence || []).map(s => ({ ...s })) };
  }

  // ---- V5.3-D: Registry.pol- und ADMX-Evidenz (additiv) ----------------

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Sucht die zu einem gpreport.xml-Eintrag gehoerende registry.pol im
  // selben GPO-Backup-Ordner (Standard-Backup-GPO-Layout, real bestaetigt
  // an allen 5 Microsoft-Baseline-ZIPs aus V5.3-B:
  // GPOs/<GUID>/DomainSysvol/GPO/<Machine|User>/registry.pol, Geschwister
  // von GPOs/<GUID>/gpreport.xml). Case-insensitiver Vergleich, da das
  // Backup-Tooling hier nicht als garantiert gross-/kleinschreibungsstabil
  // angenommen wird.
  function findSiblingRegistryPol(zip, baseDir, scope) {
    const re = new RegExp('^' + escapeRegExp(baseDir) + 'DomainSysvol/GPO/' + scope + '/registry\\.pol$', 'i');
    const key = Object.keys(zip.files).find(k => re.test(k));
    return key ? zip.files[key] : null;
  }

  // Liest Machine- und User-registry.pol (falls vorhanden) fuer ein
  // einzelnes Baseline-GPO. Ein Parse-Fehler in einer Datei bricht nicht
  // den gesamten Import ab (wie bei nicht eindeutig abbildbaren
  // gpreport.xml-Inhalten auch), sondern wird als eigener Fehler-Eintrag
  // sichtbar gemacht statt stillschweigend zu fehlen.
  async function parseGpoRegistryEvidence(zip, baseDir, gpo) {
    const evidence = [];
    for (const scope of ['Machine', 'User']) {
      const file = findSiblingRegistryPol(zip, baseDir, scope);
      if (!file) continue;
      let parsed;
      try {
        const buffer = await file.async('arraybuffer');
        parsed = window.GpoRegistryPol.parseRegistryPol(buffer);
      } catch (err) {
        evidence.push({
          id: [gpo.id || gpo.name, scope, 'parse-error'].join('|'),
          gpoId: gpo.id, gpoName: gpo.name, scope,
          origin: 'registry.pol', sourceFile: file.name,
          error: 'registry.pol konnte nicht gelesen werden: ' + err.message,
        });
        continue;
      }
      parsed.entries.forEach(e => {
        evidence.push({
          id: [gpo.id || gpo.name, scope, e.key, e.valueName].join('|'),
          gpoId: gpo.id,
          gpoName: gpo.name,
          scope,
          key: e.key,
          valueName: e.valueName,
          valueNameClass: e.valueNameClass,
          type: e.type,
          typeName: e.typeName,
          data: e.data,
          origin: 'registry.pol',
          sourceFile: file.name,
        });
      });
    }
    return evidence;
  }

  let _admxKeyIndexPromise = null;
  let _admxDisplayIndexPromise = null;

  // Der ADMX-Referenzindex ist eine vorab (offline, siehe
  // V5.3-D-ADMX-INTEGRATION-BERICHT.md) mit dem unveraenderten
  // window.GpoAdmxResolver.parseAdmxFile() gegen die 224 lokalen
  // Windows-ADMX-Dateien erzeugte statische JSON-Datei - keine
  // Kundendaten, kein Live-Download. Wird genau einmal pro Seitenaufruf
  // geladen und wiederverwendet.
  function loadAdmxKeyIndex() {
    if (!_admxKeyIndexPromise) {
      _admxKeyIndexPromise = fetch('./data/gpo/admx-index.json')
        .then(r => { if (!r.ok) throw new Error('ADMX-Referenzindex konnte nicht geladen werden (HTTP ' + r.status + ').'); return r.json(); })
        .then(entries => window.GpoAdmxResolver.buildKeyIndex(entries));
    }
    return _admxKeyIndexPromise;
  }

  // ADML-Anzeigeindex ist rein zusaetzlich (Abschnitt 6 des Auftrags):
  // fehlt er, bleibt die technische ADMX-Aufloesung unveraendert gueltig,
  // nur ohne lokalisierte Anzeige. Ladefehler duerfen die Aufloesung
  // deshalb nicht blockieren.
  function loadAdmxDisplayIndex() {
    if (!_admxDisplayIndexPromise) {
      _admxDisplayIndexPromise = fetch('./data/gpo/admx-display-de-DE.json')
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(entries => {
          const map = new Map();
          entries.forEach(e => map.set(e.admxFile + '|' + e.name, e));
          return map;
        })
        .catch(() => new Map());
    }
    return _admxDisplayIndexPromise;
  }

  // Bildet das Ergebnis von GpoAdmxResolver.matchRegistryEvidence() auf das
  // im Auftrag geforderte 3-Zustands-Vokabular ab (Abschnitt 4):
  // resolved / missing / ambiguous. Kategorie A (eindeutiger Skalar-Match)
  // und D (eindeutiger Match nur ueber ein list/multiText-Element, siehe
  // gpo-admx-resolver.js) zaehlen beide als "resolved", da in beiden
  // Faellen genau eine ADMX-Policy gefunden wurde (matchType dokumentiert
  // den Unterschied fuer die Anzeige). Kategorie B -> missing, C -> ambiguous.
  // Es wird an keiner Stelle geraten.
  function mapAdmxMatch(match, displayIndex) {
    if (match.category === 'B') {
      return { status: 'missing', reason: match.reason };
    }
    if (match.category === 'C') {
      return { status: 'ambiguous', reason: match.reason, candidates: match.candidates };
    }
    const policy = match.admxPolicy;
    const display = displayIndex.get(policy.admxFile + '|' + policy.name) || null;
    return {
      status: 'resolved',
      matchType: match.category === 'D' ? 'list-element' : 'scalar',
      policy: {
        admxFile: policy.admxFile,
        namespace: policy.namespace,
        name: policy.name,
        class: policy.class,
        key: policy.key,
        valueName: policy.valueName,
      },
      display: display ? { displayName: display.displayName || null, explainText: display.explainText || null } : null,
    };
  }

  // Reichert eine Liste von Registry-Evidenz-Eintraegen (in-place) um
  // admx:{status,...} an. Gibt eine Fehlermeldung zurueck, falls der
  // Referenzindex selbst nicht geladen werden konnte (dann bleibt admx
  // bewusst {status:'unavailable'} statt faelschlich 'missing' zu zeigen -
  // "missing" heisst ausschliesslich "im geladenen ADMX-Satz nicht
  // gefunden", nicht "Aufloesung nicht versucht").
  async function resolveAdmxForEvidence(evidence) {
    let keyIndex = null, indexError = null;
    try {
      keyIndex = await loadAdmxKeyIndex();
    } catch (err) {
      indexError = 'ADMX-Referenzindex konnte nicht geladen werden: ' + err.message;
    }
    const displayIndex = await loadAdmxDisplayIndex();
    evidence.forEach(item => {
      if (item.error) { item.admx = null; return; }
      if (indexError) { item.admx = { status: 'unavailable', reason: indexError }; return; }
      const match = window.GpoAdmxResolver.matchRegistryEvidence({ key: item.key, valueName: item.valueName }, keyIndex);
      item.admx = mapAdmxMatch(match, displayIndex);
    });
    return indexError;
  }
  async function sha256(buffer) {
    if (!window.crypto || !window.crypto.subtle) return null;
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('gpreport.xml konnte nicht als XML gelesen werden.');
    const root = window.GpoXmlUtils.byLocalName(doc, 'GPO')[0];
    if (!root) throw new Error('Kein Microsoft-GPO-Report erkannt (Wurzelelement „GPO“ fehlt).');
    return { doc, root };
  }
  function rootGpoId(root, fallbackId) {
    const identifier = window.GpoXmlUtils.directChildByLocalName(root, 'Identifier');
    const nested = identifier ? window.GpoXmlUtils.directChildByLocalName(identifier, 'Identifier') : null;
    return window.GpoXmlUtils.normalizeGuid(window.GpoXmlUtils.textOf(nested)) || window.GpoXmlUtils.normalizeGuid(fallbackId);
  }
  function rootGpoName(root, fallbackId) {
    return window.GpoXmlUtils.textOfChild(root, 'Name') || fallbackId || 'Unbenannte Baseline-GPO';
  }
  function pushSetting(out, gpo, scope, node, category, name, value, extra) {
    if (!name) return;
    const settingKey = category ? category + ' > ' + name : name;
    out.push({
      id: [gpo.id || gpo.name, scope, settingKey].join('|'),
      baselineVersion: null,
      gpoId: gpo.id,
      gpoName: gpo.name,
      settingKey,
      name,
      category,
      scope,
      value: value === undefined ? null : value,
      state: extra && extra.state || null,
      supported: extra && extra.supported || null,
      comparability: 'comparable',
      sourceFile: gpo.sourceFile,
    });
  }
  function parseGpoReport(text, sourceFile, fallbackId) {
    const { root } = parseXml(text);
    const gpo = { id: rootGpoId(root, fallbackId), name: rootGpoName(root, fallbackId), sourceFile };
    const settings = [];
    const notComparable = [];
    const scopes = window.GpoXmlUtils.byLocalName(root, 'Computer').concat(window.GpoXmlUtils.byLocalName(root, 'User'));
    scopes.forEach(scopeNode => {
      const scope = scopeNode.localName;
      window.GpoXmlUtils.directChildrenByLocalName(scopeNode, 'ExtensionData').forEach(extData => {
        const extension = window.GpoXmlUtils.directChildByLocalName(extData, 'Extension');
        if (!extension) return;
        window.GpoXmlUtils.directChildrenByLocalName(extension, 'Policy').forEach(policy => {
          const name = window.GpoXmlUtils.textOfChild(policy, 'Name');
          const category = window.GpoXmlUtils.getCategoryPath(policy);
          if (!name) {
            notComparable.push({ gpoId: gpo.id, gpoName: gpo.name, scope, type: 'Administrative Template', name: '(unbekannt)', reason: 'Kein eindeutiger Policy-Name im gpreport.xml.' });
            return;
          }
          pushSetting(settings, gpo, scope, policy, category, name, window.GpoXmlUtils.getPolicyValue(policy), {
            state: window.GpoXmlUtils.textOfChild(policy, 'State'),
            supported: window.GpoXmlUtils.textOfChild(policy, 'Supported'),
          });
        });
        window.GpoXmlUtils.directChildrenByLocalName(extension, 'Account').forEach(account => {
          const name = window.GpoXmlUtils.textOfChild(account, 'Name');
          const value = window.GpoXmlUtils.textOfChild(account, 'SettingNumber') || window.GpoXmlUtils.textOfChild(account, 'SettingBoolean') || window.GpoXmlUtils.textOfChild(account, 'SettingString');
          if (!name || value === null) {
            notComparable.push({ gpoId: gpo.id, gpoName: gpo.name, scope: 'Computer', type: 'Account Policy', name: name || '(unbekannt)', reason: 'Account-Policy enthält keine eindeutige Name/Wert-Kombination.' });
            return;
          }
          pushSetting(settings, gpo, 'Computer', account, 'Security Settings > Account Policies', name, value, { state: 'Configured' });
        });
        window.GpoXmlUtils.directChildrenByLocalName(extension, 'SecurityOptions').forEach(opt => {
          const display = window.GpoXmlUtils.directChildByLocalName(opt, 'Display');
          const displayName = display ? window.GpoXmlUtils.textOfChild(display, 'Name') : null;
          const keyName = window.GpoXmlUtils.textOfChild(opt, 'KeyName');
          const sys = window.GpoXmlUtils.textOfChild(opt, 'SystemAccessPolicyName');
          const name = displayName || keyName || (sys && (window.GpoXmlUtils.SYSTEM_ACCESS_POLICY_DISPLAY_NAMES[sys] || ('Unbekannte Security Option (' + sys + ')')));
          const valueNode = display ? (window.GpoXmlUtils.textOfChild(display, 'DisplayBoolean') || window.GpoXmlUtils.textOfChild(opt, 'SettingNumber')) : null;
          const value = valueNode !== null && valueNode !== undefined ? valueNode : window.GpoXmlUtils.textOfChild(opt, 'SettingNumber') || window.GpoXmlUtils.textOfChild(opt, 'SettingBoolean') || window.GpoXmlUtils.textOfChild(opt, 'SettingString');
          if (!name) {
            notComparable.push({ gpoId: gpo.id, gpoName: gpo.name, scope, type: 'Security Option', name: '(unbekannt)', reason: 'Keine verifizierte Bezeichnung im gpreport.xml.' });
            return;
          }
          pushSetting(settings, gpo, 'Computer', opt, 'Security Settings > Security Options', name, value, { state: 'Configured' });
        });
        window.GpoXmlUtils.directChildrenByLocalName(extension, 'UserRightsAssignment').forEach(right => {
          const name = window.GpoXmlUtils.textOfChild(right, 'Name');
          const members = [];
          window.GpoXmlUtils.directChildrenByLocalName(right, 'Member').forEach(member => {
            const memberName = window.GpoXmlUtils.textOfChild(member, 'Name');
            if (memberName) members.push(memberName);
          });
          if (!name) {
            notComparable.push({ gpoId: gpo.id, gpoName: gpo.name, scope, type: 'User Rights Assignment', name: '(unbekannt)', reason: 'Kein Name im gpreport.xml.' });
            return;
          }
          pushSetting(settings, gpo, 'Computer', right, 'Security Settings > User Rights Assignment', name, members.join(', '), { state: 'Configured' });
        });
        // Andere Extension-Typen sind bewusst nicht in eine erfundene settingKey-Struktur gezwungen.
        for (let i = 0; i < extension.children.length; i++) {
          const child = extension.children[i];
          if (!['Policy','Account','SecurityOptions','UserRightsAssignment'].includes(child.localName)) {
            notComparable.push({ gpoId: gpo.id, gpoName: gpo.name, scope, type: child.localName, name: '(Extension)', reason: 'Extension-Typ ist in der bestehenden Snapshot-Struktur nicht eindeutig als settingKey abbildbar.' });
          }
        }
      });
    });
    return { gpo, settings, notComparable };
  }
  async function processFile(file) {
    reset();
    _state.status = 'loading';
    try {
      const buffer = await file.arrayBuffer();
      const hash = await sha256(buffer);
      const zip = await JSZip.loadAsync(buffer);
      const entries = Object.values(zip.files).filter(e => !e.dir && /(?:^|\/)gpreport\.xml$/i.test(e.name) && /(?:^|\/)GPOs\//i.test(e.name));
      if (!entries.length) throw new Error('Keine GPOs/<GUID>/gpreport.xml-Dateien in der Baseline-ZIP gefunden.');
      const allSettings = [], allUnmapped = [], allRegistryEvidence = [];
      let baselineVersion = file.name.replace(/\.zip$/i, '');
      for (const entry of entries) {
        const text = window.GpoXmlUtils.decodeReportBuffer(await entry.async('arraybuffer'));
        const folderMatch = entry.name.match(/(?:^|\/)GPOs\/([^\/]+)\/gpreport\.xml$/i);
        const parsed = parseGpoReport(text, entry.name, folderMatch ? folderMatch[1] : null);
        parsed.settings.forEach(s => { s.baselineVersion = baselineVersion; });
        parsed.notComparable.forEach(s => { s.baselineVersion = baselineVersion; });
        allSettings.push(...parsed.settings);
        allUnmapped.push(...parsed.notComparable);

        if (window.GpoRegistryPol) {
          const baseDirMatch = entry.name.match(/^(.*)gpreport\.xml$/i);
          if (baseDirMatch) {
            const evidence = await parseGpoRegistryEvidence(zip, baseDirMatch[1], parsed.gpo);
            evidence.forEach(e => { e.baselineVersion = baselineVersion; });
            allRegistryEvidence.push(...evidence);
          }
        }
      }
      const unique = new Map();
      allSettings.forEach(s => unique.set(s.id, s));
      const settings = Array.from(unique.values());

      let admxIndexError = null;
      if (window.GpoAdmxResolver && allRegistryEvidence.length) {
        admxIndexError = await resolveAdmxForEvidence(allRegistryEvidence);
      }

      const meta = { fileName: file.name, sha256: hash, baselineVersion, gpoCount: entries.length, importedAt: new Date().toISOString(), notComparableCount: allUnmapped.length };
      if (window.GpoReferenceEngine && typeof window.GpoReferenceEngine.registerBaselineSettings === 'function') {
        window.GpoReferenceEngine.registerBaselineSettings(settings, meta);
      }
      _state = { status: 'loaded', ...meta, settings, notComparable: allUnmapped, registryEvidence: allRegistryEvidence, admxIndexError, error: null };
      document.dispatchEvent(new CustomEvent('gpo-baseline-loaded'));
      return getState();
    } catch (err) {
      console.error('[GpoBaselineImporter] Baseline konnte nicht verarbeitet werden:', err);
      _state.status = 'error';
      _state.error = 'Microsoft-Baseline konnte nicht verarbeitet werden. Bitte prüfe die ZIP-Datei.';
      document.dispatchEvent(new CustomEvent('gpo-baseline-loaded'));
      return getState();
    }
  }
  function initUpload() {
    const zone = document.getElementById('gpo-baseline-upload-zone');
    const input = document.getElementById('gpo-baseline-file-input');
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });
  }
  document.addEventListener('DOMContentLoaded', initUpload);
  return { processFile, getState, reset };
})();
