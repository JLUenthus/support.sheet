// ============================================================
// gpo-xml-utils.js – Gemeinsame XML-Helfer fuer GPO-Report- und
// RSoP-Auswertung. Keine fachliche Bewertung, keine Compliance-Logik.
// ============================================================
window.GpoXmlUtils = (function() {
  function normalizeGuid(raw) {
    if (!raw) return null;
    const cleaned = String(raw).replace(/[{}]/g, '').trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cleaned) ? cleaned : null;
  }
  function byLocalName(root, name) {
    const out = [];
    if (!root || !root.getElementsByTagName) return out;
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (all[i].localName === name) out.push(all[i]);
    return out;
  }
  function directChildrenByLocalName(el, name) {
    const out = [];
    if (!el || !el.children) return out;
    for (let i = 0; i < el.children.length; i++) if (el.children[i].localName === name) out.push(el.children[i]);
    return out;
  }
  function directChildByLocalName(el, name) {
    const found = directChildrenByLocalName(el, name);
    return found.length ? found[0] : null;
  }
  function textOf(el) { return el ? el.textContent.trim() : null; }
  function textOfChild(el, name) { return textOf(directChildByLocalName(el, name)); }

  const SYSTEM_ACCESS_POLICY_DISPLAY_NAMES = {
    'ForceLogoffWhenHourExpire': 'Microsoft-Netzwerkserver: Clients nach Ablauf der Anmeldezeiten trennen',
    'LSAAnonymousNameLookup': 'Netzwerkzugriff: Anonyme SID-/Namensübersetzung zulassen',
  };

  function getCategoryPath(policyNode) {
    let current = directChildByLocalName(policyNode, 'Category');
    const names = [];
    while (current) {
      const nameNode = directChildByLocalName(current, 'Name');
      if (nameNode && textOf(nameNode)) names.push(textOf(nameNode));
      else if (current.children.length === 0 && textOf(current)) names.push(textOf(current));
      current = directChildByLocalName(current, 'Category');
    }
    return names.length ? names.join(' > ') : null;
  }

  function getPolicyValueSummary(policyNode) {
    const ignore = new Set(['Name','State','Category','Explain','Supported','Precedence']);
    const parts = [];
    function walk(node) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const local = child.localName;
        if (!local || ignore.has(local)) continue;
        if (child.children.length > 0) {
          const nameNode = directChildByLocalName(child, 'Name');
          const valueNode = directChildByLocalName(child, 'Value') || directChildByLocalName(child, 'State');
          if (nameNode && valueNode) parts.push(textOf(nameNode) + '=' + textOf(valueNode));
          else walk(child);
        } else if (textOf(child)) {
          parts.push(local + '=' + textOf(child));
        }
      }
    }
    walk(policyNode);
    return parts.join('; ');
  }

  function getPolicyValue(policyNode) {
    const state = textOfChild(policyNode, 'State');
    const summary = getPolicyValueSummary(policyNode);
    if (state && summary) return state + (summary ? '; ' + summary : '');
    return state || summary || null;
  }

  function decodeReportBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    let encoding = 'utf-8';
    let offset = 0;
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; offset = 2; }
    else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; offset = 2; }
    else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) { offset = 3; }
    return new TextDecoder(encoding).decode(bytes.slice(offset));
  }

  return {
    normalizeGuid, byLocalName, directChildrenByLocalName, directChildByLocalName,
    textOf, textOfChild, SYSTEM_ACCESS_POLICY_DISPLAY_NAMES,
    getCategoryPath, getPolicyValueSummary, getPolicyValue, decodeReportBuffer,
  };
})();
