// ============================================================
// bsi-mapping.js - eigenstaendige BSI-/Compliance-Bewertungsschicht.
// Liest ausschliesslich das bereits normalisierte gpo-parser.js-Modell
// und die bestehenden technischen Findings (gpo-analyzer.js), veraendert
// beide aber niemals. Kein Zugriff auf rohe Collector-Daten, kein Import
// von gpo-renderer.js (DOM-Layer) - die Scope-Aufloesung wird bewusst
// unabhaengig dupliziert (siehe resolveGpoScope unten), damit diese
// Schicht architektonisch von der Darstellung getrennt bleibt (siehe
// V3.1-BSI-Architektur-Review, Abschnitt 8).
//
// Ergebnisformat: pro BSI-Anforderung ein Array von Ergebnisobjekten,
// je eines pro GPO, die mindestens eines der zugehoerigen Settings
// konfiguriert (siehe evaluate() unten). Jedes Ergebnisobjekt ist fuer
// sich vollstaendig nachvollziehbar (BSI-Requirement-ID, Setting, GPO,
// Wert, Scope, Status, Begruendung) - keine implizite Aggregation ueber
// mehrere GPOs hinweg, da unterschiedliche GPOs unterschiedliche Scopes
// haben koennen.
// ============================================================
window.GpoBsiMapping = (function() {

  const SECURITY_OPTIONS_PREFIX = 'Security Settings > Security Options > ';

  // Bewusst niemals als Evidenz fuer eine der drei Anforderungen
  // referenziert - ein Setting, dessen konkreter Name dem Collector
  // nicht bekannt ist, darf keinem BSI-Requirement zugeordnet werden
  // (weder per Position noch per Wert geraten).
  const UNKNOWN_SECURITY_OPTION_KEY = SECURITY_OPTIONS_PREFIX + 'Unbekannte Security Option';

  // Identische Erkennung wie gpo-renderer.js (V3.0/Locale-Fix): SID-first,
  // Name-Fallback nur ohne SID, feste bilinguale Liste, exakter Vergleich.
  // Bewusst hier dupliziert statt aus gpo-renderer.js importiert, siehe
  // Architektur-Kommentar oben - kuenftige Aenderungen an dieser Logik
  // muessen an beiden Stellen nachgezogen werden.
  const AUTHENTICATED_USERS_SID = 'S-1-5-11';
  const AUTHENTICATED_USERS_NAMES = ['authenticated users', 'authentifizierte benutzer'];

  function isDefaultSecurityFilterTrustee(filter) {
    if (filter.trusteeSid) return filter.trusteeSid.toUpperCase() === AUTHENTICATED_USERS_SID;
    return AUTHENTICATED_USERS_NAMES.indexOf((filter.trustee || '').trim().toLowerCase()) !== -1;
  }

  // Scope-Aufloesung fuer eine einzelne GPO. Nutzt ausschliesslich bereits
  // vorhandene Modell-Daten (model.links, model.dataQuality, gpo.parseStatus/
  // securityFilter/wmiFilter) - keine zweite Scope-Engine, keine erneute
  // Collector-Daten-Auswertung.
  //
  // 'daten_unvollstaendig' / 'kein_aktiver_link' -> Bewertung grundsaetzlich
  // nicht moeglich (nicht_bewertbar). 'eingeschraenkt' -> Wert ist bekannt,
  // aber der tatsaechlich betroffene Empfaengerkreis ist wegen Security-/
  // WMI-Filter nicht auflösbar (fuehrt zu "pruefen", niemals zu "erfuellt").
  // 'eindeutig' -> Wert kann direkt bewertet werden.
  function resolveGpoScope(gpo, model) {
    if (gpo.parseStatus !== 'complete') {
      return { scopeStatus: 'daten_unvollstaendig', detail: 'GPO-Report fuer "' + gpo.name + '" wurde nicht vollstaendig gelesen (parseStatus: ' + gpo.parseStatus + ') - Bewertung nicht moeglich.' };
    }
    if (model.dataQuality.linksFileMissing) {
      return { scopeStatus: 'daten_unvollstaendig', detail: 'links.json fehlt im Snapshot komplett - Scope fuer keine GPO bestimmbar.' };
    }
    const activeLinks = model.links.filter(l => l.gpoId === gpo.id && l.linkEnabled !== false);
    if (activeLinks.length === 0) {
      return { scopeStatus: 'kein_aktiver_link', detail: 'Fuer "' + gpo.name + '" ist keine aktive Verknuepfung im Snapshot vorhanden - unklar, ob die Einstellung ueberhaupt irgendwo wirksam wird.' };
    }
    const hasWmiFilter = !!gpo.wmiFilter;
    const hasNonDefaultFilter = (gpo.securityFilter || []).some(f => !isDefaultSecurityFilterTrustee(f));
    if (hasWmiFilter || hasNonDefaultFilter) {
      const parts = [];
      if (hasNonDefaultFilter) parts.push('Security Filter weicht vom Standard ("Authentifizierte Benutzer") ab');
      if (hasWmiFilter) parts.push('WMI-Filter zugewiesen');
      return {
        scopeStatus: 'eingeschraenkt',
        detail: parts.join('; ') + ' - der tatsaechlich betroffene Kreis an Computern/Benutzern ist damit nicht auflösbar.',
        links: activeLinks,
      };
    }
    return { scopeStatus: 'eindeutig', detail: null, links: activeLinks };
  }

  function settingsForKey(gpo, key) {
    return gpo.settings.filter(s => s.key === key);
  }

  // Manche fachlichen Sub-Aspekte lassen sich in echten GPOs auf mehr als
  // eine Weise konfigurieren - z.B. SMB-Server-Signierung ueber die
  // getrennte "(wenn Client zustimmt)"-Variante ODER die staerkere
  // "(immer)"-Variante, oder Secure Channel ueber die beiden getrennten
  // "(wenn möglich)"-Settings ODER die kombinierte, staerkere "(immer)"-
  // Einstellung. sub.keys traegt deshalb eine Liste gleichwertiger realer
  // Setting-Namen statt eines einzelnen Keys (V3.3-Real-Data-Validierung,
  // Mapping-Luecken-Befund). Liefert alle tatsaechlich konfigurierten
  // Rohwerte ueber alle Alternativen hinweg - reine Erkennung, keine
  // Bewertung (siehe resolveSubSettingValue() fuer die Wert-Verdichtung).
  function settingsForAnyKey(gpo, keys) {
    const results = [];
    keys.forEach(k => settingsForKey(gpo, k).forEach(s => results.push(s)));
    return results;
  }

  // Verdichtet die (ggf. mehreren) Rohwerte eines Sub-Aspekts einer GPO zu
  // einem einzigen Ergebnis: 'missing' (keine Alternative konfiguriert),
  // 'ambiguous' (mehrere konfigurierte Alternativen mit UNTERSCHIEDLICHEM
  // Wert - bewusst konservativ wie beim bestehenden Grenzfall-Prinzip:
  // im Zweifel nicht raten, welche Variante gilt) oder 'value' (eindeutig,
  // eine oder mehrere Alternativen mit demselben Wert). Reine Erkennungs-
  // Ebene - berechnet nicht, wie daraus Coverage/Status wird.
  function resolveSubSettingValue(gpo, sub) {
    const entries = settingsForAnyKey(gpo, sub.keys);
    if (entries.length === 0) return { status: 'missing', entries: [] };
    const values = new Set(entries.map(e => e.value));
    if (values.size > 1) return { status: 'ambiguous', entries };
    return { status: 'value', value: entries[0].value, entries };
  }

  function findConflictFinding(findings, settingKey) {
    return (findings || []).find(f => f.type === 'conflict' && f.settingKey === settingKey) || null;
  }

  // ---- Scope Coverage (V3.2) ---------------------------------------------
  // "Domain Controllers" ist die einzige Zielbereich-Kategorie, die sich aus
  // dem vorhandenen ouTree/Link-Modell belastbar ableiten laesst: der Pfad
  // "OU=Domain Controllers,<Domain-Root>" ist ein von Windows bei der
  // Domaenenerstellung automatisch angelegter Standard-Systemcontainer, in
  // den jeder heraufgestufte Domain Controller automatisch verschoben wird -
  // kein Namens-Raten wie bei Admin-gewaehlten OUs ("Server", "Windows10"
  // etc.), sondern ein strukturell garantierter Pfad, unabhaengig von
  // Sprache/Namenskonvention der Domaene (im Gegensatz zu lokalisierten
  // Security-Principal-Anzeigenamen wie "Authenticated Users"). Siehe
  // V3.1.1-BSI-Scope-Coverage-Review: Member Server/Clients sind aus den
  // aktuellen Collector-Daten NICHT belastbar abgrenzbar (keine Computer-
  // Objekt-/Rollendaten vorhanden) und werden deshalb bewusst NICHT als
  // eigene Kategorie behandelt.
  function findDomainControllersOu(model) {
    const domainRoots = model.ouTree.filter(n => n.targetType === 'domain');
    for (let i = 0; i < domainRoots.length; i++) {
      const rootNode = domainRoots[i];
      const expectedTarget = 'OU=Domain Controllers,' + rootNode.target;
      const dcNode = rootNode.children.find(n => n.targetType === 'ou' && n.target === expectedTarget);
      if (dcNode) return { dcNode, rootNode };
    }
    return null;
  }

  // Identischer DN-Ancestor/Descendant-Vergleich wie isAncestorOrEqualOu()
  // in gpo-analyzer.js (determineScopeOverlap()): AD-DNs listen vom Blatt
  // zur Wurzel, die DN einer Eltern-OU ist deshalb ein exaktes Komma-Suffix
  // jeder Kind-DN darunter, case-insensitiv. Bewusst hier dupliziert statt
  // aus gpo-analyzer.js importiert/exportiert (das darf laut Auftrag nicht
  // veraendert werden, auch kein zusaetzlicher Export) - genau wie
  // isDefaultSecurityFilterTrustee() oben nicht aus gpo-renderer.js
  // importiert wird. Verwendet dieselbe einzige kanonische Vergleichsformel
  // statt einer eigenen dritten Variante (V3.2-Reachability-Review).
  //
  // Bewusste 1:1-Kopie der kanonischen Scope-Formel.
  // Siehe auch gpo-analyzer.js:isAncestorOrEqualOu().
  // Bei Aenderungen beide Stellen synchron halten.
  function isAncestorOrEqualOu(ancestorDn, dn) {
    const a = (ancestorDn || '').toLowerCase();
    const d = (dn || '').toLowerCase();
    if (!a || !d) return false;
    return a === d || d.endsWith(',' + a);
  }

  // Erreicht eine GPO die Domain-Controllers-OU ueber einen aktiven, nicht
  // blockierten Link? Ein Link zaehlt, wenn sein Ziel die DC-OU selbst ODER
  // ein Vorfahre davon ist (isAncestorOrEqualOu) - direkte Links auf die
  // DC-OU zaehlen immer, Links auf einen Vorfahren (z.B. Domain-Root) nur,
  // wenn die DC-OU kein blockInheritance traegt oder der Link enforced ist
  // (Standard-GPO-Vererbungsregel). Site-Links werden wie in
  // determineLinkPairOverlap() als nicht zuverlaessig zuordenbar behandelt.
  // Nutzt ausschliesslich model.links/model.ouTree - keine zweite Scope-
  // Engine, determineScopeOverlap()/computeGroupOverlap()/
  // aggregateOverlapResults() bleiben unangetastet.
  function gpoReachesDomainControllersOu(gpo, model, dcInfo) {
    const activeLinks = model.links.filter(l => l.gpoId === gpo.id && l.linkEnabled !== false);
    return activeLinks.some(l => {
      if (l.targetType === 'site') return false;
      if (!isAncestorOrEqualOu(l.target, dcInfo.dcNode.target)) return false;
      if (l.target === dcInfo.dcNode.target) return true;
      return dcInfo.dcNode.blockInheritance !== true || l.enforced;
    });
  }

  const MEMBER_SERVER_CLIENTS_NOTE = 'Zielbereich Member Server/Clients im aktuellen Snapshot nicht zuverlaessig abgrenzbar (keine Computer-Objekt-/Rollendaten im Collector-Snapshot enthalten, OU-Namen wie "Server"/"Windows10" sind reine Admin-Konvention dieser einen Domaene) - Collector-Erweiterung noetig, bevor eine Coverage-Aussage moeglich ist.';

  function buildMemberServerClientsEntry(requirementId) {
    return {
      requirementId,
      gpoId: null,
      gpoName: null,
      scopeCategory: null,
      categoryDerivable: false,
      coverage: 'not_determinable',
      status: null,
      evidence: [],
      reason: MEMBER_SERVER_CLIENTS_NOTE,
    };
  }

  // Ergaenzt die bestehenden, unveraendert berechneten Pro-GPO-Ergebnisse
  // eines Requirements um scopeCategory/categoryDerivable/coverage. Bestehende
  // Felder (status/evidence/reason/scopeStatus) werden dabei nicht angefasst -
  // die BSI-Foundation-v1-Bewertung bleibt inhaltlich identisch, es werden
  // nur Felder ergaenzt bzw. zusaetzliche Coverage-Eintraege angehaengt.
  function addScopeCoverage(model, requirementId, baseResults) {
    const dcInfo = findDomainControllersOu(model);

    if (!dcInfo || model.dataQuality.linksFileMissing) {
      const reason = !dcInfo
        ? 'Domain Controllers OU (Standard-Systemcontainer "OU=Domain Controllers,<Domain-Root>") wurde im ouTree/Link-Modell dieses Snapshots nicht gefunden - Coverage fuer diese Kategorie nicht bestimmbar.'
        : 'links.json fehlt im Snapshot komplett - Scope-Coverage fuer keine Kategorie bestimmbar.';
      const results = baseResults.map(r => Object.assign({}, r, { scopeCategory: null, categoryDerivable: false, coverage: null }));
      results.push({
        requirementId, gpoId: null, gpoName: null,
        scopeCategory: 'domain_controllers', categoryDerivable: false, coverage: 'not_determinable',
        status: null, evidence: [], reason,
      });
      results.push(buildMemberServerClientsEntry(requirementId));
      return results;
    }

    const augmented = baseResults.map(r => {
      const gpo = r.gpoId ? model.gpos.find(g => g.id === r.gpoId) : null;
      const reachesDc = gpo && gpoReachesDomainControllersOu(gpo, model, dcInfo);
      if (!reachesDc) {
        return Object.assign({}, r, { scopeCategory: null, categoryDerivable: false, coverage: null });
      }
      const coverage = r.scopeStatus === 'eindeutig' ? 'covered' : 'not_determinable';
      return Object.assign({}, r, { scopeCategory: 'domain_controllers', categoryDerivable: true, coverage });
    });

    const hasDcCoverageEntry = augmented.some(r => r.scopeCategory === 'domain_controllers');
    if (!hasDcCoverageEntry) {
      const reachingGpos = model.gpos.filter(g => gpoReachesDomainControllersOu(g, model, dcInfo));
      const unreadable = reachingGpos.filter(g => g.parseStatus !== 'complete');
      if (unreadable.length > 0) {
        augmented.push({
          requirementId, gpoId: null, gpoName: null,
          scopeCategory: 'domain_controllers', categoryDerivable: true, coverage: 'not_determinable',
          status: null, evidence: [],
          reason: unreadable.length + ' von ' + reachingGpos.length + ' die Domain-Controllers-OU erreichenden GPO(s) konnten nicht vollstaendig gelesen werden (parseStatus != complete) - Abwesenheit des Settings kann nicht positiv bestaetigt werden.',
        });
      } else {
        augmented.push({
          requirementId, gpoId: null, gpoName: null,
          scopeCategory: 'domain_controllers', categoryDerivable: true, coverage: 'not_covered',
          status: null, evidence: [],
          reason: reachingGpos.length === 0
            ? 'Keine GPO erreicht die Domain-Controllers-OU (weder direkt noch ueber einen nicht blockierten Link vom Domain-Root) - kein Datenpunkt fuer diese Kategorie vorhanden.'
            : 'Keine der ' + reachingGpos.length + ' die Domain-Controllers-OU erreichenden GPO(s) konfiguriert dieses Setting - bestaetigte Luecke.',
        });
      }
    }

    augmented.push(buildMemberServerClientsEntry(requirementId));
    return augmented;
  }

  // ---- Requirement 1: NTLM / LM-Authentifizierungsebene ------------------
  // Bekannte Stufen (Get-GPOReport-Rohwert 0-5): >= 3 erzwingt NTLMv2,
  // Stufe 5 ist die staerkste ("NTLMv2 only, LM & NTLM verweigern"). Referenz
  // aus dem V3.1-BSI-Architektur-Review: Stufe >= 3 gewuenschte Richtung,
  // Stufe 5 ideal.
  const NTLM_SETTING_KEY = SECURITY_OPTIONS_PREFIX + 'Netzwerksicherheit: LAN Manager-Authentifizierungsebene';
  const NTLM_REQUIREMENT_ID = 'BSI-SYS.2.2.3-NTLM-LM-LEVEL';

  // Reine Wert->Status-Klassifikation, unabhaengig vom Scope (V3.3-
  // Refactoring: vorher inline in evaluateNtlmLevel(), jetzt hier
  // extrahiert, damit sowohl die bestehende GPO-zentrierte Bewertung ALS
  // AUCH die neue computerbasierte Coverage-Aggregation (siehe unten)
  // dieselbe, einzige Klassifikationsformel verwenden - keine zweite
  // Kopie der Stufen-Logik. level:null signalisiert "Wert nicht als
  // Stufe 0-5 interpretierbar", wird von evaluateNtlmLevel() fuer den
  // Scope-abhaengigen "eingeschraenkt"-Sondertext benoetigt.
  function classifyNtlmLevelValue(rawValue) {
    const level = Number(rawValue);
    const levelKnown = Number.isInteger(level) && level >= 0 && level <= 5;
    if (!levelKnown) {
      return { status: 'pruefen', level: null, reason: 'Wert "' + rawValue + '" ist keine bekannte LAN-Manager-Authentifizierungsstufe (0-5) - manuelle Pruefung noetig.' };
    }
    if (level >= 3) {
      return { status: 'erfuellt', level: level, reason: 'Stufe ' + level + ' erzwingt NTLMv2 (Mindestanforderung >= 3 erfuellt' + (level === 5 ? ', Stufe 5 = staerkste Auspraegung' : '') + ').' };
    }
    return { status: 'nicht_erfuellt', level: level, reason: 'Stufe ' + level + ' liegt unter der geforderten Mindeststufe 3 (NTLMv2-only) - LM- bzw. NTLMv1-Antworten werden noch zugelassen.' };
  }

  function evaluateNtlmLevel(model, findings) {
    const gposWithSetting = model.gpos.filter(g => settingsForKey(g, NTLM_SETTING_KEY).length > 0);

    if (gposWithSetting.length === 0) {
      return [{
        requirementId: NTLM_REQUIREMENT_ID,
        gpoId: null,
        gpoName: null,
        status: 'nicht_bewertbar',
        evidence: [],
        scopeStatus: 'keine_konfiguration',
        reason: 'Kein GPO im Snapshot konfiguriert "Netzwerksicherheit: LAN Manager-Authentifizierungsebene" explizit - der wirksame Wert (z.B. ein Windows-Standardwert) kann aus den GPO-Daten allein nicht ermittelt werden.',
      }];
    }

    const conflict = findConflictFinding(findings, NTLM_SETTING_KEY);
    const results = [];

    gposWithSetting.forEach(gpo => {
      const scope = resolveGpoScope(gpo, model);
      settingsForKey(gpo, NTLM_SETTING_KEY).forEach(entry => {
        const evidence = [{ gpoName: gpo.name, settingKey: NTLM_SETTING_KEY, value: entry.value, scope: entry.scope }];
        let status, reason;

        if (scope.scopeStatus === 'daten_unvollstaendig' || scope.scopeStatus === 'kein_aktiver_link') {
          status = 'nicht_bewertbar';
          reason = scope.detail;
        } else {
          const classification = classifyNtlmLevelValue(entry.value);
          if (classification.level !== null && scope.scopeStatus === 'eingeschraenkt') {
            status = 'pruefen';
            reason = 'Stufe ' + classification.level + ' ' + (classification.level >= 3 ? 'wuerde die Mindestanforderung (>= 3, NTLMv2-only) erfuellen' : 'liegt unter der Mindestanforderung (>= 3, NTLMv2-only)') + ', aber ' + scope.detail;
          } else {
            status = classification.status;
            reason = classification.reason;
          }
        }
        if (conflict) {
          reason += ' Hinweis: fuer dieses Setting besteht zusaetzlich ein bestehendes Konflikt-Finding (abweichende Werte in anderen GPOs moeglich).';
        }

        results.push({
          requirementId: NTLM_REQUIREMENT_ID,
          gpoId: gpo.id,
          gpoName: gpo.name,
          status,
          evidence,
          scopeStatus: scope.scopeStatus,
          reason,
        });
      });
    });

    return results;
  }

  // ---- Requirement 2 (Secure Channel) und 3 (SMB Signing) ----------------
  // Beide folgen demselben Muster: zwei fachlich zusammengehoerige, aber
  // getrennt gepflegte Security-Options-Settings pro GPO, jeweils als
  // eigener Evidenz-Eintrag ausgewiesen. Werte sind bei diesen beiden
  // Anforderungen im echten Snapshot als "1" (aktiviert) / "0" (deaktiviert)
  // vorhanden (Get-SecurityOptionsSettings liest SettingNumber).
  // Reine Wert->Status-Klassifikation fuer die beiden Paar-Requirements
  // (Secure Channel/SMB-Signierung), unabhaengig vom Scope (V3.3-
  // Refactoring, siehe classifyNtlmLevelValue() oben fuer die Begruendung).
  // anyMissing/anyAmbiguous/anyDisabled sind bereits vorher aus den
  // konkreten Werten abgeleitet (Aufrufer-Verantwortung) - hier steht nur
  // noch die reine Entscheidungslogik.
  function classifyPairedBooleanValues(flags) {
    if (flags.anyAmbiguous) {
      return { status: 'pruefen', reason: 'Mindestens ein Wert ist kein bekanntes Enabled/Disabled-Muster (erwartet "1"/"0") - manuelle Pruefung noetig.' };
    }
    if (flags.anyMissing) {
      return { status: 'pruefen', reason: 'Mindestens eines der beiden zugehoerigen Settings ist in dieser GPO nicht konfiguriert - der BSI-Pruefpunkt betrachtet beide gemeinsam und kann daher nicht abschliessend bewertet werden.' };
    }
    if (flags.anyDisabled) {
      return { status: 'nicht_erfuellt', reason: 'Mindestens eine der beiden zugehoerigen Einstellungen ist deaktiviert (Wert "0").' };
    }
    return { status: 'erfuellt', reason: 'Beide zugehoerigen Einstellungen sind aktiviert (Wert "1").' };
  }

  function evaluatePairedBooleanRequirement(model, findings, requirementId, subSettings) {
    const gposInvolved = model.gpos.filter(g => subSettings.some(s => settingsForAnyKey(g, s.keys).length > 0));

    if (gposInvolved.length === 0) {
      return [{
        requirementId,
        gpoId: null,
        gpoName: null,
        status: 'nicht_bewertbar',
        evidence: [],
        scopeStatus: 'keine_konfiguration',
        reason: 'Keines der zugehoerigen Settings (' + subSettings.map(s => '"' + s.label + '"').join(', ') + ') ist in irgendeiner GPO im Snapshot konfiguriert.',
      }];
    }

    return gposInvolved.map(gpo => {
      const scope = resolveGpoScope(gpo, model);
      const evidence = [];
      let anyMissing = false;
      let anyDisabled = false;
      let anyAmbiguous = false;

      subSettings.forEach(sub => {
        const resolved = resolveSubSettingValue(gpo, sub);
        if (resolved.status === 'missing') {
          anyMissing = true;
          evidence.push({ gpoName: gpo.name, settingKey: sub.keys[0], label: sub.label, value: null, scope: null, note: 'nicht konfiguriert' });
          return;
        }
        resolved.entries.forEach(entry => {
          evidence.push({ gpoName: gpo.name, settingKey: entry.key, label: sub.label, value: entry.value, scope: entry.scope });
        });
        if (resolved.status === 'ambiguous') {
          // Mehrere alternative Settings fuer denselben Sub-Aspekt mit
          // unterschiedlichem Wert - Grenzfall, bewusst konservativ: nicht
          // raten, welche Variante gilt.
          anyAmbiguous = true;
        } else if (resolved.value === '1') {
          // aktiviert - kein Hinweis noetig
        } else if (resolved.value === '0') {
          anyDisabled = true;
        } else {
          anyAmbiguous = true;
        }
      });

      let status, reason;
      if (scope.scopeStatus === 'daten_unvollstaendig' || scope.scopeStatus === 'kein_aktiver_link') {
        status = 'nicht_bewertbar';
        reason = scope.detail;
      } else if (scope.scopeStatus === 'eingeschraenkt' && !anyAmbiguous && !anyMissing) {
        status = 'pruefen';
        reason = (anyDisabled ? 'Mindestens eine der beiden Einstellungen ist deaktiviert. ' : 'Beide Einstellungen sind aktiviert. ') + scope.detail;
      } else {
        const classification = classifyPairedBooleanValues({ anyMissing, anyAmbiguous, anyDisabled });
        status = classification.status;
        reason = classification.reason;
      }

      return {
        requirementId,
        gpoId: gpo.id,
        gpoName: gpo.name,
        status,
        evidence,
        scopeStatus: scope.scopeStatus,
        reason,
      };
    });
  }

  // "... verschluesseln oder signieren (immer)" ist eine einzelne, staerkere
  // Einstellung (immer statt bedingt), die inhaltlich BEIDE getrennten
  // "(wenn möglich)"-Aspekte gleichzeitig abdeckt (V3.3-Real-Data-
  // Validierung, norddeutsche-wohnbau.local) - deshalb bei BEIDEN Sub-
  // Aspekten als gleichwertige Alternative eingetragen, nicht als
  // eigenstaendiger dritter Sub-Aspekt.
  const SECURE_CHANNEL_ENCRYPT_OR_SIGN_ALWAYS_KEY = SECURITY_OPTIONS_PREFIX + 'Domänenmitglied: Daten des sicheren Kanals digital verschlüsseln oder signieren (immer)';

  const SECURE_CHANNEL_REQUIREMENT_ID = 'BSI-APP.2.2-SECURE-CHANNEL';
  const SECURE_CHANNEL_SUB_SETTINGS = [
    { label: 'Secure Channel verschluesseln', keys: [
        SECURITY_OPTIONS_PREFIX + 'Domänenmitglied: Daten des sicheren Kanals digital verschlüsseln (wenn möglich)',
        SECURE_CHANNEL_ENCRYPT_OR_SIGN_ALWAYS_KEY,
      ] },
    { label: 'Secure Channel signieren', keys: [
        SECURITY_OPTIONS_PREFIX + 'Domänenmitglied: Daten des sicheren Kanals digital signieren (wenn möglich)',
        SECURE_CHANNEL_ENCRYPT_OR_SIGN_ALWAYS_KEY,
      ] },
  ];

  const SMB_SIGNING_REQUIREMENT_ID = 'BSI-SYS.2.2.3-SMB-SIGNING';
  const SMB_SIGNING_SUB_SETTINGS = [
    { label: 'SMB-Signierung Server', keys: [
        SECURITY_OPTIONS_PREFIX + 'Microsoft-Netzwerk (Server): Kommunikation digital signieren (wenn Client zustimmt)',
        SECURITY_OPTIONS_PREFIX + 'Microsoft-Netzwerk (Server): Kommunikation digital signieren (immer)',
      ] },
    { label: 'SMB-Signierung Client', keys: [SECURITY_OPTIONS_PREFIX + 'Microsoft-Netzwerk (Client): Kommunikation digital signieren (wenn Server zustimmt)'] },
  ];

  // ---- Computerbasierte Coverage (V3.3) -----------------------------------
  // Ergaenzt die bestehende, unveraenderte OU-basierte Domain-Controller-
  // Coverage (addScopeCoverage() oben, V3.2) um eine Computer-Instanz-
  // Ebene fuer alle drei Kategorien (domain_controllers/member_servers/
  // clients aus computers.json/gpo-parser.js). "unknown"-Computer werden
  // separat gezaehlt, nie in eine der drei Kategorien eingerechnet. Coverage
  // bleibt strikt von Compliance getrennt: "covered" heisst nur "eindeutig
  // bewertbar", nicht "erfuellt".

  // Baustein 2: flacht den ouTree einmalig ab - Hilfsfunktion fuer die
  // blockInheritance-Kette unten, KEINE neue DN-Vergleichsformel (die bleibt
  // ausschliesslich isAncestorOrEqualOu()).
  function flattenOuTree(nodes, out) {
    out = out || [];
    (nodes || []).forEach(n => {
      out.push(n);
      flattenOuTree(n.children, out);
    });
    return out;
  }

  // Alle ouTree-Knoten, die Vorfahre (oder das Ziel selbst) der gegebenen DN
  // sind, tiefster Knoten zuerst. Wird gebraucht, weil ein Computer -
  // anders als die feste, immer genau 1 Ebene unter dem Domain-Root
  // liegende Domain-Controllers-OU - beliebig tief verschachtelt sein
  // kann: blockInheritance muss deshalb entlang der gesamten Kette
  // zwischen Link-Ziel und Computer geprueft werden, nicht nur an einem
  // einzelnen Knoten.
  function findAncestorChain(model, dn) {
    return flattenOuTree(model.ouTree)
      .filter(n => isAncestorOrEqualOu(n.target, dn))
      .sort((a, b) => b.target.length - a.target.length);
  }

  // Erreicht eine GPO einen konkreten Computer ueber einen aktiven, nicht
  // blockierten Link? Direkter Analogiefall zu
  // gpoReachesDomainControllersOu(), aber mit computer.distinguishedName
  // statt der festen DC-OU als Ziel und mit voller blockInheritance-Ketten-
  // Pruefung (siehe findAncestorChain() oben) statt nur einem Knoten, da
  // ein Computer beliebig tief unter dem Link-Ziel liegen kann. enforced
  // ueberwindet blockInheritance an jeder Zwischen-OU, exakt wie beim
  // bestehenden Vorbild. Site-Links werden wie dort ausgeschlossen.
  function computerReachesGpo(gpo, computer, model) {
    if (!computer.distinguishedName) return false;
    const activeLinks = model.links.filter(l => l.gpoId === gpo.id && l.linkEnabled !== false);
    const ancestorChain = findAncestorChain(model, computer.distinguishedName);
    return activeLinks.some(l => {
      if (l.targetType === 'site') return false;
      if (!isAncestorOrEqualOu(l.target, computer.distinguishedName)) return false;
      if (l.target === computer.distinguishedName) return true;
      const blockedByIntermediateOu = ancestorChain.some(n =>
        n.target !== l.target && isAncestorOrEqualOu(l.target, n.target) && n.blockInheritance === true
      );
      return !blockedByIntermediateOu || l.enforced;
    });
  }

  // Baustein 1 (Fortsetzung): bindet classifyPairedBooleanValues() an ein
  // konkretes Sub-Settings-Paar, damit dieselbe Klassifikationsformel wie
  // bei der GPO-zentrierten Bewertung auch fuer aggregierte, ueber mehrere
  // erreichende GPOs hinweg abgeglichene Werte verwendet wird.
  function classifyPairedValuesForSubSettings(subSettings) {
    return function(valuesByKey) {
      let anyMissing = false, anyAmbiguous = false, anyDisabled = false;
      subSettings.forEach(sub => {
        // Mehrere alternative reale Settings koennen denselben Sub-Aspekt
        // abdecken (siehe resolveSubSettingValue()) - hier werden die
        // bereits pro Key ueber die erreichenden GPOs abgeglichenen Werte
        // (valuesByKey, von evaluateComputerRequirement befuellt) je
        // Sub-Aspekt zusammengefuehrt: fehlt jede Alternative, ist der
        // Aspekt "missing"; haben mehrere konfigurierte Alternativen
        // unterschiedliche Werte, ist er "ambiguous" (konservativ, keine
        // Alternative wird bevorzugt).
        const presentValues = sub.keys.map(k => valuesByKey[k]).filter(v => v !== undefined);
        if (presentValues.length === 0) { anyMissing = true; return; }
        const distinct = new Set(presentValues);
        if (distinct.size > 1) { anyAmbiguous = true; return; }
        const v = presentValues[0];
        if (v === '1') {
          // aktiviert - kein Hinweis noetig
        } else if (v === '0') {
          anyDisabled = true;
        } else {
          anyAmbiguous = true;
        }
      });
      return classifyPairedBooleanValues({ anyMissing, anyAmbiguous, anyDisabled });
    };
  }

  // Reine Durchreichung der bereits im Modell vorhandenen Computer-
  // Rohfelder (V3.5.1) - keine neue Ableitung, kein Anzeigename aus dem
  // DN, kein DNSHostName/SamAccountName (im Collector/Modell nicht
  // vorhanden, siehe V3.5.0-Architektur-Check).
  function computerCoverageIdentity(computer) {
    return {
      distinguishedName: computer.distinguishedName,
      category: computer.category,
      operatingSystem: computer.operatingSystem,
      operatingSystemVersion: computer.operatingSystemVersion,
      enabled: computer.enabled,
      isDomainController: computer.isDomainController,
      isReadOnlyDomainController: computer.isReadOnlyDomainController,
    };
  }

  // Baustein 3: Coverage-Ermittlung fuer einen einzelnen Computer. Gibt
  // niemals eine Gewinner-GPO zurueck - bei abweichenden Werten unter den
  // erreichenden, konfigurierenden GPOs ist das Ergebnis IMMER
  // not_determinable, unabhaengig von Link-Reihenfolge/enforced/
  // blockInheritance/OU-Tiefe.
  //
  // V3.5.1: die Rueckgabe traegt zusaetzlich computer/reachingGpoIds/
  // configuringGpoIds/values - ausschliesslich bereits innerhalb dieser
  // Funktion berechnete Zwischenwerte, die vorher nur lokal existierten
  // und beim Verlassen der Funktion verworfen wurden (siehe V3.5.0-
  // Architektur-Check, Abschnitt 4). coverage/status/reason bleiben
  // wertmaessig unveraendert - keine neue Reachability-/Scope-/
  // Klassifikationslogik, keine Gewinner-GPO.
  function evaluateComputerRequirement(computer, model, settingKeys, classifyValues) {
    const identity = computerCoverageIdentity(computer);

    if (!computer.distinguishedName) {
      return {
        computer: identity, coverage: 'not_determinable',
        reason: 'Computerobjekt ohne distinguishedName - Scope nicht bestimmbar.',
        reachingGpoIds: [], configuringGpoIds: [], values: {},
      };
    }
    if (model.dataQuality.linksFileMissing) {
      return {
        computer: identity, coverage: 'not_determinable',
        reason: 'links.json fehlt im Snapshot komplett - Scope nicht bestimmbar.',
        reachingGpoIds: [], configuringGpoIds: [], values: {},
      };
    }

    const reachingGpos = model.gpos.filter(g => computerReachesGpo(g, computer, model));
    const reachingGpoIds = reachingGpos.map(g => g.id);
    const configuringReaching = reachingGpos.filter(g => settingKeys.some(k => settingsForKey(g, k).length > 0));
    const configuringGpoIds = configuringReaching.map(g => g.id);

    if (configuringReaching.length === 0) {
      const unreadableReaching = reachingGpos.filter(g => g.parseStatus !== 'complete');
      if (unreadableReaching.length > 0) {
        return {
          computer: identity, coverage: 'not_determinable',
          reason: unreadableReaching.length + ' von ' + reachingGpos.length + ' diesen Computer erreichenden GPO(s) konnten nicht vollstaendig gelesen werden - Abwesenheit des Settings kann nicht positiv bestaetigt werden.',
          reachingGpoIds, configuringGpoIds, values: {},
        };
      }
      return {
        computer: identity, coverage: 'not_covered',
        reason: reachingGpos.length === 0
          ? 'Keine GPO erreicht diesen Computer (weder direkt noch ueber einen nicht blockierten Vorfahren-Link).'
          : 'Keine der ' + reachingGpos.length + ' diesen Computer erreichenden GPO(s) konfiguriert dieses Setting - bestaetigte Luecke.',
        reachingGpoIds, configuringGpoIds, values: {},
      };
    }

    const scopes = configuringReaching.map(g => resolveGpoScope(g, model));
    if (scopes.some(s => s.scopeStatus !== 'eindeutig')) {
      return {
        computer: identity, coverage: 'not_determinable',
        reason: 'Mindestens eine konfigurierende, erreichende GPO hat einen nicht eindeutigen Scope (Non-Default Security Filter, WMI-Filter oder unvollstaendige Daten) - der tatsaechlich betroffene Kreis ist nicht auflösbar.',
        reachingGpoIds, configuringGpoIds, values: {},
      };
    }

    const valuesByKey = {};
    for (let i = 0; i < settingKeys.length; i++) {
      const key = settingKeys[i];
      const values = new Set();
      configuringReaching.forEach(g => settingsForKey(g, key).forEach(s => values.add(s.value)));
      if (values.size > 1) {
        return {
          computer: identity, coverage: 'not_determinable',
          reason: 'Erreichende GPOs setzen "' + key + '" mit unterschiedlichen Werten - keine Gewinner-GPO wird ermittelt, effektive Einstellung ueber RSoP/gpresult pruefen.',
          reachingGpoIds, configuringGpoIds, values: Object.assign({}, valuesByKey),
        };
      }
      valuesByKey[key] = values.size === 1 ? Array.from(values)[0] : undefined;
    }

    const classification = classifyValues(valuesByKey);
    return {
      computer: identity, coverage: 'covered', status: classification.status, reason: classification.reason,
      reachingGpoIds, configuringGpoIds, values: valuesByKey,
    };
  }

  const COMPUTER_COVERAGE_CATEGORIES = ['domain_controllers', 'member_servers', 'clients'];

  // Baustein 4: Aggregation pro Requirement x Kategorie. "unknown"-
  // Computer fliessen niemals in total/covered/not_covered/
  // not_determinable einer Kategorie ein, sondern ausschliesslich in das
  // separate unknown-Feld - siehe geklaerte Grundlage im Auftrag.
  //
  // V3.5.1: zusaetzlich zu den bereits bestehenden Summen wird jetzt eine
  // Pro-Computer-Liste (computers) zurueckgegeben - ein Eintrag pro
  // ausgewertetem Computer (inkl. "unknown", der dort zwar erscheinen
  // darf, aber weiterhin nicht in categories/unknown-Zaehlung als eigener
  // Coverage-Zustand einfliesst). Die bestehende Summen-Aggregation
  // (categories[...]total/[coverage]++, unknown++) ist unveraendert -
  // "computers" wird nur zusaetzlich befuellt, aendert keinen bestehenden
  // Zaehlwert.
  function aggregateComputerCoverage(model, requirementId, settingKeys, classifyValues) {
    const categories = {};
    COMPUTER_COVERAGE_CATEGORIES.forEach(cat => {
      categories[cat] = { total: 0, covered: 0, not_covered: 0, not_determinable: 0 };
    });
    let unknown = 0;
    const computers = [];

    (model.computers || []).forEach(computer => {
      const isKnownCategory = COMPUTER_COVERAGE_CATEGORIES.indexOf(computer.category) !== -1;
      if (!isKnownCategory && computer.category !== 'unknown') return;

      const result = evaluateComputerRequirement(computer, model, settingKeys, classifyValues);
      computers.push(result);

      if (computer.category === 'unknown') { unknown++; return; }
      categories[computer.category].total++;
      categories[computer.category][result.coverage]++;
    });

    return { requirementId, categories, unknown, computers };
  }

  // Oeffentlicher Einstiegspunkt fuer die computerbasierte Coverage aller
  // drei bestehenden Requirements. Getrennt von evaluate() (GPO-zentrierte
  // BSI-Foundation-v1/V3.2-Ergebnisse) gehalten - unterschiedliche
  // Ergebnisform (Kategorie-Aggregation statt Pro-GPO-Evidenzliste), keine
  // Vermischung der beiden Sichten.
  // Flacht die (ggf. je Sub-Aspekt mehreren, teils gemeinsam genutzten)
  // Alternativ-Keys zu einer eindeutigen Liste ab - z.B. traegt die
  // "(immer)"-Secure-Channel-Einstellung zu beiden Sub-Aspekten bei und
  // soll trotzdem nur einmal in settingKeys erscheinen.
  function flattenSubSettingKeys(subSettings) {
    return Array.from(new Set(subSettings.reduce((acc, s) => acc.concat(s.keys), [])));
  }

  function evaluateComputerCoverage(model) {
    return {
      [NTLM_REQUIREMENT_ID]: aggregateComputerCoverage(
        model, NTLM_REQUIREMENT_ID, [NTLM_SETTING_KEY],
        values => classifyNtlmLevelValue(values[NTLM_SETTING_KEY])
      ),
      [SECURE_CHANNEL_REQUIREMENT_ID]: aggregateComputerCoverage(
        model, SECURE_CHANNEL_REQUIREMENT_ID, flattenSubSettingKeys(SECURE_CHANNEL_SUB_SETTINGS),
        classifyPairedValuesForSubSettings(SECURE_CHANNEL_SUB_SETTINGS)
      ),
      [SMB_SIGNING_REQUIREMENT_ID]: aggregateComputerCoverage(
        model, SMB_SIGNING_REQUIREMENT_ID, flattenSubSettingKeys(SMB_SIGNING_SUB_SETTINGS),
        classifyPairedValuesForSubSettings(SMB_SIGNING_SUB_SETTINGS)
      ),
    };
  }

  // Haupteinstiegspunkt: liest normalisiertes Modell + bestehende Findings
  // (nur lesend, siehe Kopf-Kommentar), gibt pro Requirement-ID ein Array
  // von Ergebnisobjekten zurueck. Faengt niemals _findings, passesFilters()
  // oder bestehende Finding-Kategorien/Zaehlungen an - komplett eigener
  // Rueckgabewert.
  function evaluate(model, findings) {
    const ntlmResults = evaluateNtlmLevel(model, findings);
    const secureChannelResults = evaluatePairedBooleanRequirement(model, findings, SECURE_CHANNEL_REQUIREMENT_ID, SECURE_CHANNEL_SUB_SETTINGS);
    const smbSigningResults = evaluatePairedBooleanRequirement(model, findings, SMB_SIGNING_REQUIREMENT_ID, SMB_SIGNING_SUB_SETTINGS);

    return {
      [NTLM_REQUIREMENT_ID]: addScopeCoverage(model, NTLM_REQUIREMENT_ID, ntlmResults),
      [SECURE_CHANNEL_REQUIREMENT_ID]: addScopeCoverage(model, SECURE_CHANNEL_REQUIREMENT_ID, secureChannelResults),
      [SMB_SIGNING_REQUIREMENT_ID]: addScopeCoverage(model, SMB_SIGNING_REQUIREMENT_ID, smbSigningResults),
    };
  }

  return {
    evaluate,
    evaluateComputerCoverage,
    UNKNOWN_SECURITY_OPTION_KEY,
    REQUIREMENT_IDS: {
      NTLM_LM_LEVEL: NTLM_REQUIREMENT_ID,
      SECURE_CHANNEL: SECURE_CHANNEL_REQUIREMENT_ID,
      SMB_SIGNING: SMB_SIGNING_REQUIREMENT_ID,
    },
  };
})();
