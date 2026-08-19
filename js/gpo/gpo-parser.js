// ============================================================
// gpo-parser.js – normalisiert rohe Collector-JSONs (gpos/links/
// filters/wmiFilters/metadata) in ein einheitliches, Collector-
// unabhaengiges Datenmodell. Reine Datentransformation, keine
// Bewertung/Analyse (siehe Konzept Abschnitt 19).
// ============================================================
window.GpoParser = (function() {

  // Verteidigt gegen eine bekannte PowerShell-ConvertTo-Json-Eigenart:
  // ein leeres oder einzelnes Ergebnis kann statt eines reinen Arrays
  // [...] als {"value": [...], "Count": N}-Wrapper serialisiert werden
  // (Get-GPOAnalyzerSnapshot.ps1's Write-JsonArray() ist dagegen bereits
  // abgesichert - siehe deren eigener Kommentar zur selben, frueher schon
  // einmal aufgetretenen Eigenart - aeltere oder anders erzeugte Snapshots
  // im Feld koennen das Format trotzdem noch enthalten). Erkennt den
  // bekannten Wrapper und entpackt ihn automatisch; laesst `undefined`
  // unveraendert durch (unterscheidet weiterhin "Feld fehlt komplett" von
  // "Feld ist leer", siehe linksFileMissing unten). Ein voellig
  // unerwartetes, nicht-Array-Format erzeugt eine klare Fehlermeldung
  // statt eines stillen Absturzes weiter unten (z.B. "X.forEach is not a
  // function"). Zentral hier statt in gpo-loader.js, damit auch direkte
  // GpoParser.normalize()-Aufrufe (z.B. Tests) abgesichert sind.
  function coerceRawArray(value, fieldName) {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && Array.isArray(value.value)) return value.value;
    throw new Error('GPO Analyzer: ' + fieldName + ' hat ein unerwartetes Format (kein Array).');
  }

  // Get-GPOAnalyzerSnapshot.ps1's Get-AccountPolicySettings() liest jedes
  // <Account>-XML-Element (Get-GPOReport, Kennwort-/Sperr-/Kerberos-
  // Richtlinie) per ChildNodes-Schleife aus und haengt dabei JEDES Kind-
  // Element als eigene Zeile an - nicht den eigentlichen Policy-Parameter.
  // Ein einzelnes <Account>-Element hat aber immer genau 3 Kinder in fester
  // Dokumentreihenfolge: <Name> (der eigentliche Parametername, z.B.
  // "MinimumPasswordLength"), genau eines von <SettingNumber>/
  // <SettingBoolean>/<SettingString> (der Wert) und <Type> (Kategorie:
  // Password/Account Lockout/Kerberos). Ohne diese Rekonstruktion landen
  // "Name"/"Type"/"SettingNumber" selbst als settingKey in der Analyse -
  // inhaltlich unterschiedliche Parameter (z.B. MinimumPasswordLength vs.
  // LockoutBadCount) werden dann faelschlich als "derselbe Setting-Key mit
  // widerspruechlichen Werten" gemeldet (V3.1-BSI-Review, groesste bekannte
  // Konfliktgruppe). Da der Collector jedes <Account>-Element vollstaendig
  // abarbeitet bevor er zum naechsten wechselt (siehe dessen eigener
  // foreach-Aufbau), sind die 3 Zeilen eines Elements im Ergebnis-Array
  // immer garantiert zusammenhaengend und nie mit denen eines anderen
  // <Account>-Elements vermischt - die 3er-Gruppierung ist damit kein
  // Raten "welches Feld gehoert vermutlich zusammen", sondern folgt direkt
  // aus dem Kontrollfluss des Collectors. Weicht eine Gruppe von diesem
  // Muster ab (z.B. anderes Schema, unvollstaendige Daten), wird das nicht
  // stillschweigend geraten, sondern als klarer Fehler gemeldet.
  const ACCOUNT_POLICIES_CATEGORY = 'Security Settings > Account Policies';
  const ACCOUNT_POLICY_VALUE_FIELDS = ['SettingNumber', 'SettingBoolean', 'SettingString'];

  function reconstructAccountPolicyGroup(group) {
    const nameEntry = group.find(s => s.name === 'Name');
    const valueEntry = group.find(s => ACCOUNT_POLICY_VALUE_FIELDS.indexOf(s.name) !== -1);
    if (group.length !== 3 || !nameEntry || !valueEntry) {
      throw new Error('GPO Analyzer: ' + ACCOUNT_POLICIES_CATEGORY + ' hat ein unerwartetes Format (keine 3er-Gruppe Name/Wert/Type je Datensatz).');
    }
    return {
      key: ACCOUNT_POLICIES_CATEGORY + ' > ' + nameEntry.value,
      scope: nameEntry.scope,
      value: valueEntry.value,
    };
  }

  // Baut settings[] fuer eine GPO. Account-Policies-Rohzeilen werden zu
  // echten Name->Wert-Eintraegen rekonstruiert (siehe oben), alle anderen
  // Kategorien (Administrative Templates, Security Options, User Rights
  // Assignment) bleiben unveraendert im bisherigen Format - deren Rohdaten
  // sind bereits ein Eintrag pro tatsaechlichem Setting.
  function buildSettings(rawSettings) {
    const result = [];
    let i = 0;
    while (i < rawSettings.length) {
      const s = rawSettings[i];
      if (s.category === ACCOUNT_POLICIES_CATEGORY) {
        result.push(reconstructAccountPolicyGroup(rawSettings.slice(i, i + 3)));
        i += 3;
      } else {
        result.push({
          key: s.category ? s.category + ' > ' + s.name : s.name,
          scope: s.scope,
          value: effectiveValue(s),
        });
        i += 1;
      }
    }
    return result;
  }

  // Klassifiziert ein Computerobjekt in genau eine von vier Kategorien.
  // Verwendet ausschliesslich isDomainController (strukturelles AD-Signal
  // aus dem Collector, siehe computers.json) und operatingSystem - niemals
  // distinguishedName, Computername oder GPO-/OU-Namen (das waere eine
  // Namens-/Positionsheuristik, die hier explizit nicht erlaubt ist;
  // distinguishedName bleibt ausschliesslich fuer eine spaetere Scope-
  // Zuordnung reserviert). Domain Controller werden IMMER zuerst und
  // unabhaengig vom OS-Wert erkannt (auch bei fehlendem/unerwartetem OS,
  // z.B. ein RODC bleibt "domain_controllers", nie "unknown"). Ein
  // "server"-Bestandteil im OS-Namen hat immer Vorrang vor einer Client-
  // Regel. "unknown" ist ein gewollter First-Class-Zustand (leer/null,
  // unbekannte oder nicht eindeutig zuordenbare Werte, IoT/Embedded-
  // Varianten) - es wird bewusst NICHT versucht, moeglichst viele Werte in
  // Server/Client zu pressen.
  const SPECIALIZED_OS_MARKERS = ['iot', 'embedded'];
  const CLIENT_OS_VERSION_MARKERS = ['windows 11', 'windows 10', 'windows 8.1', 'windows 8', 'windows 7'];

  function classifyComputerCategory(operatingSystem, isDomainController) {
    if (isDomainController) return 'domain_controllers';
    const os = (operatingSystem || '').toLowerCase().trim();
    if (!os) return 'unknown';
    if (os.indexOf('server') !== -1) return 'member_servers';
    if (SPECIALIZED_OS_MARKERS.some(m => os.indexOf(m) !== -1)) return 'unknown';
    if (CLIENT_OS_VERSION_MARKERS.some(m => os.indexOf(m) !== -1)) return 'clients';
    return 'unknown';
  }

  function normalize(raw) {
    const rawGpos       = coerceRawArray(raw.gpos, 'gpos.json')             || [];
    const rawLinks      = coerceRawArray(raw.links, 'links.json')          || [];
    const rawFilters    = coerceRawArray(raw.filters, 'filters.json')       || [];
    const rawWmiFilters = coerceRawArray(raw.wmiFilters, 'wmi-filters.json') || [];
    const rawComputers  = coerceRawArray(raw.computers, 'computers.json')    || [];

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

    // Identisches Prinzip wie linksFileMissing: computers.json fehlt nur,
    // wenn der Key im ZIP komplett nicht vorhanden war (aeltere Snapshots
    // vor dieser Erweiterung) - eine vorhandene, aber leere Datei ([])
    // bedeutet dagegen "Computerdaten erfasst, aber keine Objekte
    // gefunden" und ist NICHT dasselbe wie "Computer-Daten wurden in
    // diesem Snapshot nicht erfasst". model.computers darf im
    // computersFileMissing-Fall nicht als "0 Computer" interpretiert
    // werden.
    const computersFileMissing = raw.computers === undefined;

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
      settings: buildSettings(g.settings || []),
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

    // Rohdaten bleiben unveraendert (distinguishedName/operatingSystem/
    // operatingSystemVersion/enabled/isDomainController/
    // isReadOnlyDomainController) - category ist das einzige neu
    // hinzugefuegte, abgeleitete Feld. Deaktivierte Computer bleiben im
    // Modell (enabled=false wird nicht gefiltert) - eine etwaige spaetere
    // Ausklammerung aus einer BSI-Coverage-Population ist bewusst nicht
    // Teil dieser reinen Datennormalisierung.
    const computers = rawComputers.map(c => ({
      distinguishedName: c.distinguishedName,
      operatingSystem: c.operatingSystem,
      operatingSystemVersion: c.operatingSystemVersion,
      enabled: !!c.enabled,
      isDomainController: !!c.isDomainController,
      isReadOnlyDomainController: !!c.isReadOnlyDomainController,
      category: classifyComputerCategory(c.operatingSystem, !!c.isDomainController),
    }));

    return { gpos, links, ouTree, computers, dataQuality: { linksFileMissing, computersFileMissing } };
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
