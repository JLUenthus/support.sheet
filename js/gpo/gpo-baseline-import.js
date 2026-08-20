// ============================================================
// gpo-baseline-import.js (V5.1-C)
// Importiert eine Microsoft-Security-Baseline-ZIP als getrennte
// Referenzdaten. Kein Zugriff auf _model, _findings oder
// BSI-Coverage. Keine Compliance-Berechnung.
// ============================================================
window.GpoBaselineImporter = (function() {
  let _state = { status: 'empty', fileName: null, sha256: null, baselineVersion: null, settings: [], notComparable: [], gpoCount: 0, error: null };

  function reset() {
    _state = { status: 'empty', fileName: null, sha256: null, baselineVersion: null, settings: [], notComparable: [], gpoCount: 0, error: null };
  }
  function getState() {
    return { ..._state, settings: _state.settings.map(s => ({ ...s })), notComparable: _state.notComparable.map(s => ({ ...s })) };
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
      const allSettings = [], allUnmapped = [];
      let baselineVersion = file.name.replace(/\.zip$/i, '');
      for (const entry of entries) {
        const text = window.GpoXmlUtils.decodeReportBuffer(await entry.async('arraybuffer'));
        const folderMatch = entry.name.match(/(?:^|\/)GPOs\/([^\/]+)\/gpreport\.xml$/i);
        const parsed = parseGpoReport(text, entry.name, folderMatch ? folderMatch[1] : null);
        parsed.settings.forEach(s => { s.baselineVersion = baselineVersion; });
        parsed.notComparable.forEach(s => { s.baselineVersion = baselineVersion; });
        allSettings.push(...parsed.settings);
        allUnmapped.push(...parsed.notComparable);
      }
      const unique = new Map();
      allSettings.forEach(s => unique.set(s.id, s));
      const settings = Array.from(unique.values());
      const meta = { fileName: file.name, sha256: hash, baselineVersion, gpoCount: entries.length, importedAt: new Date().toISOString(), notComparableCount: allUnmapped.length };
      if (window.GpoReferenceEngine && typeof window.GpoReferenceEngine.registerBaselineSettings === 'function') {
        window.GpoReferenceEngine.registerBaselineSettings(settings, meta);
      }
      _state = { status: 'loaded', ...meta, settings, notComparable: allUnmapped, error: null };
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
