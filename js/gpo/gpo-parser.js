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

    // raw.links ist nur dann undefined, wenn links.json im ZIP komplett
    // fehlte (gpo-loader.js setzt den Key sonst immer, auch fuer eine
    // Datei mit leerem Array) - das unterscheidet "keine Verknuepfungen
    // bekannt" (leere Datei) von "Verknuepfungsdaten fehlen komplett"
    // (Datei fehlt). Wird von Analyzer (GPO_NO_LINKS) UND Renderer
    // (Uebersicht "Unverknuepfte GPOs") aus genau diesem einen Feld
    // gelesen, siehe .md/todo/GPO_Analyzer_Pre_Real_Data_Hardening.md,
    // Abschnitt 8: eine fehlende Links-Datei darf nicht als
    // "alle GPOs unverknuepft" interpretiert werden.
    const linksFileMissing = raw.links === undefined;

    const links = flattenLinks(rawLinks);

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
      reportError: g.reportError || null,
      // Fehlt parseStatus (aeltere Snapshots vor der Phase-2-Erweiterung des
      // Collectors), wird "complete" angenommen - diese Snapshots kannten
      // die Unterscheidung noch nicht, hatten aber schon reportError; ein
      // erfolgreicher Report (reportError=null) ohne parseStatus-Feld war
      // faktisch immer vollstaendig lesbar.
      parseStatus: g.parseStatus || 'complete',
      parseWarnings: g.parseWarnings || [],
      // Bewusst KEIN enforced/blockInheritance mehr hier: beides ist eine
      // Eigenschaft eines einzelnen Links bzw. Ziels, nicht der GPO selbst -
      // eine GPO kann an einem Ziel enforced sein und an einem anderen
      // nicht (siehe .md/todo/GPO_Analyzer_Pre_Real_Data_Hardening.md,
      // Abschnitt 4/5). Die frueher hier aggregierten GPO-weiten Booleans
      // wurden nirgends mehr gebraucht (einzige Nutzung war ein falscher
      // GPO-Level-Badge in gpo-renderer.js, jetzt durch Link-Ebene ersetzt)
      // und deshalb ersatzlos entfernt statt als irrefuehrendes Feld
      // stehenzubleiben. Verbindliche Werte stehen ausschliesslich in
      // "links" (enforced/linkEnabled) und "ouTree" (blockInheritance je
      // Zielknoten).
    }));

    const ouTree = buildOuTree(rawLinks, links);

    return { gpos, links, ouTree, dataQuality: { linksFileMissing } };
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
  // enforced/linkEnabled sind Eigenschaften genau dieses einen Links,
  // blockInheritance ist eine Eigenschaft des Ziels und wird hier je Link
  // mitgefuehrt (denormalisiert), damit der Renderer sie ohne Zusatz-Lookup
  // direkt neben dem jeweiligen Link anzeigen kann. Dies ist die EINZIGE
  // Stelle, die diese drei Werte aus den rohen Collector-Daten liest -
  // buildOuTree() liest sie unten aus genau diesem "links"-Array statt sie
  // ein zweites Mal aus rawLinks zu berechnen (keine zwei unabhaengigen,
  // potenziell divergierenden Berechnungen derselben Sache).
  function flattenLinks(rawLinks) {
    const links = [];
    rawLinks.forEach(target => {
      const targetType = (target.targetType || '').toLowerCase();
      const blockInheritance = !!target.blockInheritance;
      (target.gpoLinks || []).forEach(gl => {
        links.push({
          gpoId: gl.gpoId,
          target: target.target,
          targetType: targetType,
          order: gl.order,
          enforced: !!gl.enforced,
          // Fehlt linkEnabled (aeltere/unvollstaendige Snapshots), wird
          // standardmaessig true angenommen: ein im GPMC neu angelegter
          // Link ist per Default aktiv, und "unbekannt" darf hier nicht
          // stillschweigend zu "deaktiviert" werden (das waere eine
          // fachlich falsche, nicht durch die Daten gedeckte Aussage).
          linkEnabled: gl.linkEnabled === undefined ? true : !!gl.linkEnabled,
          blockInheritance: blockInheritance,
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
  //
  // "links" (bereits von flattenLinks() normalisiert) ist hier die einzige
  // Quelle fuer enforced/linkEnabled je Vorkommen - vorher wurden diese
  // Werte ein zweites Mal direkt aus rawLinks/t.gpoLinks gelesen, was bei
  // kuenftigen Aenderungen an einer der beiden Stellen zu divergierenden
  // Ergebnissen zwischen OU-Baum und dem Rest des Modells haette fuehren
  // koennen. rawLinks wird weiterhin fuer die Ziel-/Knoten-Struktur selbst
  // gebraucht (Name, targetType, blockInheritance je Ziel - keine GPO-
  // bezogene Information, siehe Kommentar am Knoten unten).
  function buildOuTree(rawLinks, links) {
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
        gpoLinks: links
          .filter(l => l.target === t.target)
          .map(l => ({ gpoId: l.gpoId, order: l.order, enforced: l.enforced, linkEnabled: l.linkEnabled })),
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
