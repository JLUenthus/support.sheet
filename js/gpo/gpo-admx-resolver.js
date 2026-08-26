// ============================================================
// gpo-admx-resolver.js - V5.3-C: ADMX/ADML als sprachunabhaengige
// Policy-Identitaet, gegen echte Registry-Evidenz (Key+ValueName)
// gematcht (siehe V5.3-C-ADMX-RESOLVER-BERICHT.md).
//
// V5.3-D: buildKeyIndex()/matchRegistryEvidence() sind produktiv in
// gpo-baseline-import.js eingebunden (Registry-/ADMX-Evidenz fuer
// importierte Microsoft-Baselines, siehe
// V5.3-D-ADMX-INTEGRATION-BERICHT.md). parseAdmxFile()/parseAdmlFile()
// selbst laufen NICHT im Produktivpfad (ein Browser kann
// C:\Windows\PolicyDefinitions eines Nutzers nicht lesen) - sie erzeugen
// offline die statischen Referenzdateien data/gpo/admx-index.json und
// data/gpo/admx-display-de-DE.json, die gpo-baseline-import.js laedt.
// Weiterhin NICHT an _model/gpo-parser.js/Collector/Microsoft-Vergleich/
// CIS-mappingStatus angebunden.
//
// Technische Policy-Identitaet (real an 224 lokalen ADMX-Dateien
// verifiziert, siehe Bericht Abschnitt 3): ADMX-Namespace + Policy-`name`
// + `class` (Machine/User/Both) + normalisierter Registry-Key + ValueName.
// ADML (displayName/explainText) ist AUSSCHLIESSLICH Darstellung und geht
// in diese Identitaet nicht ein.
//
// Normalisierung (Abschnitt 4 des Berichts, bewusst NICHT aggressiv):
// - Hive-Praefix entfernen (HKLM/HKEY_LOCAL_MACHINE, HKCU/HKEY_CURRENT_USER)
// - Gross-/Kleinschreibung angleichen
// - doppelte sowie fuehrende/abschliessende Backslashes bereinigen
// Ausdruecklich NICHT: Fuzzy-Matching von Namen/Kategorien, keine
// Aehnlichkeits-Heuristik auf Registry-Pfade.
// ============================================================
window.GpoAdmxResolver = (function() {

  function normalizeRegistryKey(key) {
    return String(key || '')
      .replace(/^HKEY_LOCAL_MACHINE\\/i, '')
      .replace(/^HKLM\\/i, '')
      .replace(/^HKEY_CURRENT_USER\\/i, '')
      .replace(/^HKCU\\/i, '')
      .replace(/\\+/g, '\\')
      .replace(/^\\+|\\+$/g, '')
      .toLowerCase();
  }

  // Liest eine ADMX-Datei encoding-sicher (real beobachtet: die meisten
  // lokalen ADMX sind UTF-8, mindestens Camera.admx/Search.admx sind
  // UTF-16LE mit BOM - dasselbe Muster wie gpreport.xml/registry.pol an
  // anderer Stelle in diesem Projekt). Ohne BOM-Erkennung wuerden diese
  // Dateien als unlesbares XML fehlschlagen (real reproduziert).
  async function fetchXmlText(url) {
    const buf = await (await fetch(url)).arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(buf.slice(2));
    }
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(buf.slice(3));
    }
    return new TextDecoder('utf-8').decode(buf);
  }

  // Parst eine einzelne ADMX-Datei in eine flache Liste von Policy-
  // Eintraegen. Jede Policy kann zusaetzlich <elements>-Kinder
  // (enum/decimal/boolean/text/list/multiText - alle real an lokalen
  // ADMX beobachtet, siehe Bericht Abschnitt 1/11) mit eigenem
  // valueName/key tragen.
  async function parseAdmxFile(url, filename) {
    const xmlText = await fetchXmlText(url);
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('ADMX-Datei nicht als XML lesbar: ' + filename);
    }
    const targetEl = doc.querySelector('policyNamespaces > target');
    const namespace = targetEl ? targetEl.getAttribute('namespace') : null;

    const entries = [];
    doc.querySelectorAll('policies > policy').forEach(p => {
      const parentCategory = p.querySelector(':scope > parentCategory');
      const supportedOnEl = p.querySelector(':scope > supportedOn');
      const enabledValueEl = p.querySelector(':scope > enabledValue');
      const disabledValueEl = p.querySelector(':scope > disabledValue');

      const elements = [];
      const elementsContainer = p.querySelector(':scope > elements');
      if (elementsContainer) {
        Array.from(elementsContainer.children).forEach(el => {
          elements.push({
            type: el.tagName,
            id: el.getAttribute('id'),
            key: el.getAttribute('key') || null,
            valueName: el.getAttribute('valueName') || null,
          });
        });
      }

      entries.push({
        admxFile: filename,
        namespace,
        name: p.getAttribute('name'),
        class: p.getAttribute('class'),
        key: p.getAttribute('key'),
        valueName: p.getAttribute('valueName'),
        parentCategoryRef: parentCategory ? parentCategory.getAttribute('ref') : null,
        supportedOnRef: supportedOnEl ? supportedOnEl.getAttribute('ref') : null,
        hasEnabledValue: !!enabledValueEl,
        hasDisabledValue: !!disabledValueEl,
        displayNameRef: p.getAttribute('displayName'),
        explainTextRef: p.getAttribute('explainText'),
        elements,
      });
    });
    return entries;
  }

  // V5.3-D: ADML ist ausschliesslich Darstellung/Evidenz, geht NICHT in die
  // technische Policy-Identitaet ein (siehe Kopfkommentar). Liest die
  // stringTable einer einzelnen ADML-Datei in eine flache { id: text }-Map -
  // dieselbe BOM-sichere fetchXmlText()-Grundlage wie parseAdmxFile().
  async function parseAdmlFile(url, filename) {
    const xmlText = await fetchXmlText(url);
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('ADML-Datei nicht als XML lesbar: ' + filename);
    }
    const strings = {};
    doc.querySelectorAll('resources > stringTable > string').forEach(s => {
      const id = s.getAttribute('id');
      if (id) strings[id] = (s.textContent || '').trim();
    });
    return strings;
  }

  // Loest eine ADMX-Referenz der Form "$(string.ID)" gegen eine per
  // parseAdmlFile() gelieferte stringTable auf. Liefert null (nicht: einen
  // erfundenen Text), wenn die Referenz fehlt oder die ID in der ADML-Datei
  // nicht vorhanden ist - "ADML fehlt" darf nie stillschweigend durch die
  // rohe Referenz oder einen Platzhaltertext ersetzt werden.
  function resolveAdmlRef(ref, stringTable) {
    if (!ref || !stringTable) return null;
    const m = /^\$\(string\.([^)]+)\)$/.exec(String(ref).trim());
    if (!m) return null;
    const text = stringTable[m[1]];
    return text === undefined ? null : text;
  }

  // Baut den Key-Index aus einer bereits geparsten Liste von ADMX-
  // Eintraegen (mehrere Dateien). Nur class=Machine/Both werden indiziert,
  // da alle bisher betrachteten CIS-Registry-Evidenzen HKLM-Praefixe
  // tragen (class=User schreibt nach HKCU und kann strukturell nicht
  // passen) - reale Pruefung, keine Annahme (siehe Bericht Abschnitt 3).
  function buildKeyIndex(admxEntries) {
    const byKey = new Map();
    admxEntries.forEach(p => {
      if (p.class !== 'Machine' && p.class !== 'Both') return;
      if (!p.key) return;
      const nk = normalizeRegistryKey(p.key);
      if (!byKey.has(nk)) byKey.set(nk, []);
      byKey.get(nk).push(p);
    });
    return byKey;
  }

  // Matched eine einzelne { key, valueName }-Registry-Evidenz gegen den
  // Index. Kategorien exakt nach V5.3-C-Auftrag:
  // A) exakt eindeutig gematcht
  // B) Key (evtl. mit anderen Policies belegt) oder ValueName nicht in
  //    lokaler ADMX gefunden
  // C) mehrere unterschiedliche ADMX-Policies matchen denselben Key+ValueName
  //    (echte Kollision, real beobachtet - siehe Bericht Abschnitt 5)
  // D) Match nur ueber ein list/multiText-Element moeglich (keine feste
  //    Skalar-Identitaet)
  function matchRegistryEvidence(registryEvidence, keyIndex) {
    const nk = normalizeRegistryKey(registryEvidence.key);
    const candidates = keyIndex.get(nk) || [];
    if (candidates.length === 0) {
      return { category: 'B', reason: 'Kein ADMX-Policy mit diesem Key in der uebergebenen ADMX-Menge gefunden.' };
    }
    const matches = [];
    candidates.forEach(p => {
      if (p.valueName === registryEvidence.valueName) matches.push({ policy: p, via: 'policy-level' });
      (p.elements || []).forEach(el => {
        if (el.valueName === registryEvidence.valueName) matches.push({ policy: p, via: 'element:' + el.type });
      });
    });
    if (matches.length === 0) {
      return { category: 'B', reason: 'Key vorhanden, aber kein Element mit passendem valueName.', otherPoliciesUnderKey: candidates.length };
    }
    const uniquePolicies = [...new Set(matches.map(m => m.policy.name + '|' + m.policy.admxFile))];
    if (uniquePolicies.length > 1) {
      return { category: 'C', reason: 'Mehrere unterschiedliche ADMX-Policies matchen denselben Key+ValueName.', candidates: uniquePolicies };
    }
    const via = matches[0].via;
    if (via.startsWith('element:list') || via.startsWith('element:multiText')) {
      return { category: 'D', reason: 'Match nur ueber list/multiText-Element (keine feste Skalar-Identitaet).', admxPolicy: matches[0].policy, via };
    }
    return { category: 'A', admxPolicy: matches[0].policy, via };
  }

  return { normalizeRegistryKey, fetchXmlText, parseAdmxFile, parseAdmlFile, resolveAdmlRef, buildKeyIndex, matchRegistryEvidence };
})();
