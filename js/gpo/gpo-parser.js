// ============================================================
// gpo-parser.js – normalisiert rohe Collector-JSONs (gpos/links/
// filters/wmiFilters/metadata) in ein einheitliches, Collector-
// unabhaengiges Datenmodell. Reine Datentransformation, keine
// Bewertung/Analyse (siehe Konzept Abschnitt 19).
// ============================================================
window.GpoParser = (function() {

  function normalize(raw) {
    const rawGpos       = raw.gpos       || [];
    const rawLinks      = raw.links      || [];
    const rawFilters    = raw.filters    || [];
    const rawWmiFilters = raw.wmiFilters || [];

    const links = flattenLinks(rawLinks);

    // Vereinfachte Sicht je GPO: "wird irgendwo enforced verlinkt" /
    // "liegt an mindestens einem Block-Inheritance-Ziel". Die
    // vollstaendigen Einzel-Links bleiben im "links"-Array erhalten.
    const enforcedGpoIds = new Set();
    const blockedGpoIds  = new Set();
    rawLinks.forEach(target => {
      const blocked = !!target.blockInheritance;
      (target.gpoLinks || []).forEach(gl => {
        if (gl.enforced) enforcedGpoIds.add(gl.gpoId);
        if (blocked) blockedGpoIds.add(gl.gpoId);
      });
    });

    const filtersByGpo = {};
    rawFilters.forEach(f => {
      if (!filtersByGpo[f.gpoId]) filtersByGpo[f.gpoId] = [];
      filtersByGpo[f.gpoId].push({
        trustee: f.trustee,
        trusteeSid: f.trusteeSid,
        permission: f.permission,
      });
    });

    const wmiFilterById = {};
    rawWmiFilters.forEach(w => { wmiFilterById[w.id] = w; });

    const gpos = rawGpos.map(g => ({
      id: g.id,
      guid: g.id,
      name: g.name,
      status: g.status,
      created: g.created,
      modified: g.modified,
      computerEnabled: !!g.computerConfigEnabled,
      userEnabled: !!g.userConfigEnabled,
      settings: (g.settings || []).map(s => ({
        key: s.category ? s.category + ' > ' + s.name : s.name,
        scope: s.scope,
        value: effectiveValue(s),
      })),
      securityFilter: filtersByGpo[g.id] || [],
      wmiFilter: g.wmiFilterId
        ? (wmiFilterById[g.wmiFilterId] || { id: g.wmiFilterId, name: null, query: null })
        : null,
      enforced: enforcedGpoIds.has(g.id),
      blockInheritance: blockedGpoIds.has(g.id),
    }));

    const ouTree = buildOuTree(rawLinks);

    return { gpos, links, ouTree };
  }

  // Fuer reine Enabled/Disabled-Policies ohne zusaetzlichen Parameter ist
  // der State (aus dem Collector) selbst die eigentliche Information. Ohne
  // ihn wuerden zwei GPOs, die dieselbe Policy einmal ein- und einmal
  // ausschalten, im Vergleich faelschlich gleich aussehen (beide
  // value=""). "Configured"-Settings (Account/SecurityOptions/
  // UserRights) haben bereits einen aussagekraeftigen Wert und bleiben
  // unveraendert.
  function effectiveValue(setting) {
    if (!setting.state || setting.state === 'Configured') return setting.value || '';
    return setting.value ? setting.state + ' (' + setting.value + ')' : setting.state;
  }

  // Ein Eintrag pro (GPO, Ziel) statt eines Eintrags pro Ziel mit
  // gpoLinks[] - einfacher fuer die weitere Verarbeitung im Analyzer.
  function flattenLinks(rawLinks) {
    const links = [];
    rawLinks.forEach(target => {
      const targetType = (target.targetType || '').toLowerCase();
      (target.gpoLinks || []).forEach(gl => {
        links.push({
          gpoId: gl.gpoId,
          target: target.target,
          targetType: targetType,
          order: gl.order,
        });
      });
    });
    return links;
  }

  // "OU=Name,..." -> "Name"
  function leafLabel(dn) {
    if (!dn) return '';
    const first = (dn.split(',')[0] || '').trim();
    const eq = first.indexOf('=');
    return eq >= 0 ? first.slice(eq + 1) : first;
  }

  // "DC=fabrikam,DC=local" -> "fabrikam.local"
  function domainLabel(dn) {
    return (dn || '').split(',')
      .map(p => p.trim())
      .filter(p => /^dc=/i.test(p))
      .map(p => p.slice(3))
      .join('.');
  }

  // Eltern-DN einer OU (eine Ebene nach oben). Domain-Root hat keinen
  // weiteren Eltern-Container in dieser Baumsicht.
  function parentDn(dn) {
    const parts = (dn || '').split(',');
    if (parts.length <= 1) return null;
    if (!/^ou=/i.test(parts[0].trim())) return null;
    return parts.slice(1).join(',');
  }

  // Baum aus Domain-/OU-Zielen in links.json. Sites gehoeren nicht zur
  // OU-Hierarchie und bleiben ausserhalb dieses Baums (weiterhin flach
  // ueber "links" abrufbar).
  function buildOuTree(rawLinks) {
    const relevant = rawLinks.filter(t => {
      const tt = (t.targetType || '').toLowerCase();
      return tt === 'domain' || tt === 'ou';
    });

    const nodeByDn = {};
    relevant.forEach(t => {
      const tt = (t.targetType || '').toLowerCase();
      nodeByDn[t.target] = {
        target: t.target,
        targetType: tt,
        name: tt === 'domain' ? domainLabel(t.target) : leafLabel(t.target),
        // blockInheritance ist eine Eigenschaft dieses Ziels, nicht der GPO
        // selbst - eine GPO kann an einem Ziel enforced sein und an einem
        // anderen nicht, deshalb bleibt "enforced" hier ebenfalls pro Link
        // erhalten statt auf die GPO aggregiert zu werden (Baum-Ansicht,
        // Konzept Abschnitt 11, braucht die Werte pro Vorkommen).
        blockInheritance: !!t.blockInheritance,
        gpoLinks: (t.gpoLinks || []).map(gl => ({ gpoId: gl.gpoId, order: gl.order, enforced: !!gl.enforced })),
        children: [],
      };
    });

    const roots = [];
    relevant.forEach(t => {
      const node = nodeByDn[t.target];
      const tt = (t.targetType || '').toLowerCase();
      if (tt === 'domain') { roots.push(node); return; }
      const pDn = parentDn(t.target);
      const parent = pDn ? nodeByDn[pDn] : null;
      if (parent) parent.children.push(node);
      else roots.push(node); // Eltern-Container nicht im Snapshot enthalten
    });

    return roots;
  }

  return { normalize };
})();
