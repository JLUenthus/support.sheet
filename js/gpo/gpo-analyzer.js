// ============================================================
// gpo-analyzer.js – Konflikt-/Redundanz-Analyse (Konzept Abschnitt
// 5, 6, 7) sowie Hygiene-/Security-Filter-/WMI-Filter-Pruefungen
// (Abschnitt 8, 9, 10). Reine Berechnung auf dem normalisierten
// Datenmodell aus gpo-parser.js, kein DOM-Zugriff. Regel-Texte
// (Name/Beschreibung/Empfehlung) kommen ausschliesslich aus den
// via gpo-rules.js geladenen data/gpo/rules.json - hier stehen nur
// die Pruef-Bedingungen.
// ============================================================
window.GpoAnalyzer = (function() {

  // Exakter Wortlaut aus dem Konzept, Abschnitt 5 - der Analyzer behauptet
  // bewusst nicht, welche GPO "gewinnt".
  const RSOP_HINT = 'Potenzieller Konflikt. Die effektive Einstellung sollte auf einem betroffenen System über RSoP / gpresult geprüft werden.';

  // Schwellwert fuer "sehr alte GPO" (Konzept Abschnitt 8) - zentral hier
  // konfigurierbar, nicht verstreut im Code.
  const VERY_OLD_THRESHOLD_YEARS = 2;

  // OU-Pfad-Heuristik fuer "Server-/RDS-artige" Ziele (Konzept Abschnitt 9).
  const SERVER_OU_KEYWORDS = ['rds', 'server', 'terminal'];

  // Trustee-Namen, die auf einen Computer-basierten Filter hindeuten
  // (statt eines reinen Benutzerfilters).
  const COMPUTER_TRUSTEE_PATTERNS = ['computer', 'authenticated users'];

  function analyze(model, rules) {
    const findings = [];
    findings.push(...analyzeSettingConflicts(model));
    (model.gpos || []).forEach(gpo => {
      findings.push(...analyzeHygiene(model, gpo, rules));
      const secFilterFinding = analyzeSecurityFilter(model, gpo, rules);
      if (secFilterFinding) findings.push(secFilterFinding);
      const wmiFinding = analyzeWmiFilter(gpo, rules);
      if (wmiFinding) findings.push(wmiFinding);
    });
    return findings;
  }

  // ── Konflikte / Redundanzen (Abschnitt 5, 6, 7) ────────────
  function analyzeSettingConflicts(model) {
    const groups = groupSettingsByKeyAndScope(model.gpos || []);
    const findings = [];

    Object.keys(groups).forEach(groupKey => {
      const entries = groups[groupKey];
      // Nur 1 GPO definiert diese Einstellung: weder Konflikt noch
      // Redundanz - alle anderen GPOs sind hier "Not Configured", was per
      // Abwesenheit aus dem Snapshot bereits korrekt abgebildet ist
      // (Konzept Abschnitt 7) und keine eigene Bewertung braucht.
      if (entries.length <= 1) return;

      const distinctValues = new Set(entries.map(e => e.value));
      const settingKey = entries[0].settingKey;
      const scope = entries[0].scope;
      const findingEntries = entries.map(e => ({ gpoId: e.gpoId, gpoName: e.gpoName, value: e.value }));

      if (distinctValues.size === 1) {
        // Identischer Wert ueber mehrere GPOs - der Scope-Bezug entscheidet,
        // ob das eine "identische Mehrfachdefinition" (alle Ziele
        // ueberlappen), eine "Mehrfachdefinition ohne direkten Konflikt"
        // (eindeutig getrennte Ziele) oder ein gemischtes Bild ist (Roadmap
        // .md/todo/GPO_Analyzer_Roadmap_vor_v2_v2_spaeter.md, Abschnitt 1.2).
        // Anders als bei Konflikten (unten) werden hier ALLE Paare der
        // Gruppe verglichen, nicht nur Paare mit unterschiedlichem Wert -
        // bei identischem Wert gibt es diese Einschraenkung nicht.
        const overlap = computeGroupOverlap(entries, model, null);
        const scopeRelation = aggregateOverlapResults(overlap.flatResults);

        findings.push({
          type: 'redundant',
          settingKey: settingKey,
          scope: scope,
          entries: findingEntries,
          severity: 'info',
          // scopeRelation ist NICHT dasselbe Feld wie conflictLevel bei
          // Konflikten (siehe Hinweis vor Prompt 2: "mixed" bleibt bei
          // Konflikten "real", bekommt bei Mehrfachdefinitionen aber einen
          // eigenen Zustand statt in eine bestehende Kategorie gepresst zu
          // werden) - deshalb ein eigener, vierwertiger Zustand.
          scopeRelation: scopeRelation,
          scopePairs: overlap.comparisons.map(c => ({
            gpoAName: c.gpoAName,
            gpoBName: c.gpoBName,
            result: c.overlap.result,
          })),
          scopeExplanation: buildRedundantScopeExplanation(scopeRelation),
        });
        return;
      }

      // Unterschiedliche konfigurierte Werte allein sind noch kein echter
      // Konflikt (siehe .md/todo/GPO_Analyzer_Roadmap_vor_v2_v2_spaeter.md,
      // Abschnitt 1.1: "GPO A wirkt auf Terminalserver, GPO B auf normale
      // Computer" ist technisch eine unterschiedliche Definition, aber kein
      // Konflikt). Scope-Ueberlappung wird deshalb NUR zwischen GPO-Paaren
      // mit tatsaechlich unterschiedlichem Wert bestimmt - zwei GPOs mit
      // demselben Wert stehen nicht im Konflikt zueinander und duerfen das
      // Ergebnis nicht verwaessern.
      const conflictOverlap = computeGroupOverlap(entries, model, (a, b) => a.value !== b.value);
      const comparisons = conflictOverlap.comparisons;
      const aggregated = aggregateOverlapResults(conflictOverlap.flatResults);

      // "none" bei ALLEN Paaren der Gruppe = fachlich kein Konflikt,
      // sondern zwei getrennt gueltige Definitionen an eindeutig
      // getrennten Zielbereichen (Roadmap Abschnitt 1.1, "Kein Konflikt") -
      // kein Finding.
      if (aggregated === 'none') return;

      // "mixed" enthaelt per Definition von aggregateOverlapResults() immer
      // mindestens ein bestaetigtes "overlap" - ein echter Konflikt liegt
      // also in jedem Fall vor, auch wenn nicht ALLE Paare ueberlappen.
      // Diese Zuordnung ist eine bewusste Erweiterung ueber die explizit
      // vorgegebene Tabelle hinaus (die "mixed" nicht auffuehrt), da ein
      // bestaetigter Overlap nicht zu einer schwaecheren Aussage
      // heruntergestuft werden darf.
      const conflictLevel = aggregated === 'unknown' ? 'potential' : 'real';
      const severity = conflictLevel === 'real' ? 'critical' : 'warning';

      findings.push({
        type: 'conflict',
        settingKey: settingKey,
        scope: scope,
        entries: findingEntries,
        severity: severity,
        // WICHTIGE EINSCHRAENKUNG: conflictLevel "real" bedeutet in dieser
        // Phase ausschliesslich, dass sich die Ziel-Links nach der
        // OU-/Domain-Logik in determineScopeOverlap() ueberlappen.
        // Security Filtering und WMI-Filtering fliessen bewusst NICHT in
        // diese Pruefung ein und koennen einen scheinbaren Overlap spaeter
        // einschraenken (zwei GPOs an derselben OU koennen ueber
        // unterschiedliche Security-Filter trotzdem auf unterschiedliche
        // Computer wirken). "real" ist deshalb keine Aussage ueber
        // tatsaechlich effektiv wirksame Konflikte, sondern ueber
        // ueberlappende Ziel-Bereiche im Snapshot (vollstaendige RSoP-/
        // Vererbungssimulation ist SPAETER-Scope, Roadmap Abschnitt 3.1/3.2).
        conflictLevel: conflictLevel,
        scopeExplanation: buildScopeExplanation(conflictLevel, aggregated, comparisons),
        hint: RSOP_HINT,
      });
    });

    return findings;
  }

  function gpoById(model, id) {
    return (model.gpos || []).find(g => g.id === id) || { id: id };
  }

  // Nur Links mit linkEnabled !== false beruecksichtigen - ein deaktivierter
  // Link wendet die GPO nirgends an und darf keinen (scheinbaren) Scope-
  // Overlap erzeugen.
  function activeLinksForGpo(gpoId, model) {
    return (model.links || []).filter(l => l.gpoId === gpoId && l.linkEnabled !== false);
  }

  // Reihenfolge der Pruefung ist absichtlich: Site vor Domain, damit sich
  // die beiden Regeln nicht widersprechen (eine Site-Verknuepfung neben
  // einer Domain-Verknuepfung bleibt "unknown", nicht faelschlich
  // "overlap").
  function determineLinkPairOverlap(linkA, linkB) {
    // 1. Site-zu-OU-/Domain-Zuordnung ist ohne Subnetz-Daten nicht
    // zuverlaessig bestimmbar - gilt auch wenn die andere Seite "domain" ist.
    if (linkA.targetType === 'site' || linkB.targetType === 'site') {
      return 'unknown';
    }
    // 2. Domain-Link wirkt potenziell auf alles darunter.
    if (linkA.targetType === 'domain' || linkB.targetType === 'domain') {
      return 'overlap';
    }
    // 3. Beide OU: Pfad-Vergleich (Vorfahre/Nachfahre oder identisch).
    return ouPathsOverlap(linkA.target, linkB.target) ? 'overlap' : 'none';
  }

  // AD-Distinguished-Names listen vom Blatt zur Wurzel - die DN einer
  // Eltern-OU ist deshalb immer ein exaktes Komma-getrenntes Suffix der DN
  // jeder Kind-OU darunter. Case-insensitiv, wie in AD ueblich.
  //
  // Bewusste 1:1-Kopie fuer die BSI-Schicht.
  // Siehe auch bsi-mapping.js:isAncestorOrEqualOu().
  // Bei Aenderungen beide Stellen synchron halten.
  function isAncestorOrEqualOu(ancestorDn, dn) {
    const a = (ancestorDn || '').toLowerCase();
    const d = (dn || '').toLowerCase();
    if (!a || !d) return false;
    return a === d || d.endsWith(',' + a);
  }

  function ouPathsOverlap(dnA, dnB) {
    return isAncestorOrEqualOu(dnA, dnB) || isAncestorOrEqualOu(dnB, dnA);
  }

  // Ermittelt den Scope-Overlap zwischen zwei GPOs anhand ihrer aktiven
  // Ziel-Links. Bewusst begrenzte Logik (keine vollstaendige RSoP-/
  // Vererbungssimulation, das ist SPAETER-Scope laut Roadmap Abschnitt
  // 3.1/3.2): siehe determineLinkPairOverlap() fuer die eigentliche
  // Paar-Logik.
  function determineScopeOverlap(gpoA, gpoB, model) {
    const linksA = activeLinksForGpo(gpoA.id, model);
    const linksB = activeLinksForGpo(gpoB.id, model);

    // Hat eine der beiden GPOs keinen aktiven Link, ist der Scope-Vergleich
    // nicht durchfuehrbar - "unknown" statt "kein Konflikt" (Grundsatz
    // "Unbekannt ist nicht gleich Nein").
    if (!linksA.length || !linksB.length) {
      return { result: 'unknown', pairs: [] };
    }

    const pairs = [];
    linksA.forEach(la => {
      linksB.forEach(lb => {
        pairs.push({
          targetA: la.target,
          targetTypeA: la.targetType,
          targetB: lb.target,
          targetTypeB: lb.targetType,
          result: determineLinkPairOverlap(la, lb),
        });
      });
    });

    return { result: aggregateOverlapResults(pairs.map(p => p.result)), pairs: pairs };
  }

  // Ruft determineScopeOverlap() fuer jedes (gefilterte) GPO-Paar aus
  // "entries" auf. Gemeinsam von Konflikt- und Mehrfachdefinitions-Zweig
  // genutzt (Prompt 2: "keine eigene, zweite Aggregationslogik... dieselbe
  // Funktion wiederverwenden") - liefert sowohl die flache Liste aller
  // atomaren Link-Paar-Ergebnisse (fuer aggregateOverlapResults) als auch
  // die GPO-Paar-Ergebnisse selbst (fuer die Anzeige, z.B. die "mixed"-
  // Aufschluesselung bei Mehrfachdefinitionen).
  function computeGroupOverlap(entries, model, shouldCompare) {
    const flatResults = [];
    const comparisons = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (shouldCompare && !shouldCompare(entries[i], entries[j])) continue;
        const gpoA = gpoById(model, entries[i].gpoId);
        const gpoB = gpoById(model, entries[j].gpoId);
        const overlap = determineScopeOverlap(gpoA, gpoB, model);
        if (overlap.pairs.length === 0) {
          // Mind. eine der beiden GPOs hat keinen aktiven Link - dieses
          // Paar traegt "unknown" bei, statt aus der Aggregation zu
          // verschwinden (leere pairs-Liste wuerde sonst stillschweigend
          // uebergangen).
          flatResults.push(overlap.result);
        } else {
          overlap.pairs.forEach(p => flatResults.push(p.result));
        }
        comparisons.push({
          gpoAId: entries[i].gpoId,
          gpoAName: entries[i].gpoName,
          gpoBId: entries[j].gpoId,
          gpoBName: entries[j].gpoName,
          overlap: overlap,
        });
      }
    }
    return { flatResults: flatResults, comparisons: comparisons };
  }

  // Fasst die Einzelergebnisse mehrerer Link-/GPO-Paare zu EINEM
  // Gesamtergebnis zusammen. Separat/exportierbar gehalten (nicht in
  // determineScopeOverlap() verschachtelt) - wird in einem spaeteren
  // Prompt auf einer anderen Ebene wiederverwendet (z.B. Mehrfach-
  // definitionen mit unterschiedlichem Scope, Roadmap Abschnitt 1.2).
  function aggregateOverlapResults(results) {
    const list = results || [];
    const hasOverlap = list.includes('overlap');
    const hasNone = list.includes('none');
    const hasUnknown = list.includes('unknown');

    if (hasOverlap && !hasNone && !hasUnknown) return 'overlap';
    if (hasNone && !hasOverlap && !hasUnknown) return 'none';
    if (hasOverlap && hasNone) return 'mixed';
    if (hasOverlap && hasUnknown) return 'mixed';
    if (hasUnknown) return 'unknown';
    // Leere Liste - kann nur vorkommen, wenn keine Link-Paare uebergeben
    // wurden; sicherer Fallback statt eines stillschweigenden "none".
    return 'unknown';
  }

  function describeTarget(targetType, target) {
    return '[' + (targetType || '?') + '] ' + (target || '?');
  }

  // Einfacher, sachlicher Satz (bessere Finding-Texte sind ein spaeterer
  // Prompt, Roadmap Abschnitt 1.6/2.6) - haelt aber bereits die wichtige
  // Einschraenkung fest, dass Security-/WMI-Filter hier nicht einfliessen.
  function buildScopeExplanation(conflictLevel, aggregatedResult, comparisons) {
    const CAVEAT = ' (Security-/WMI-Filter nicht berücksichtigt).';

    if (conflictLevel === 'potential') {
      return 'Zielbereich nicht sicher überlappend bestimmbar, z. B. über eine Site-Verknüpfung oder einen fehlenden aktiven Link' + CAVEAT;
    }

    const singlePair = (comparisons.length === 1 && comparisons[0].overlap.pairs.length === 1)
      ? comparisons[0].overlap.pairs[0]
      : null;

    if (singlePair) {
      return 'Zielbereiche überlappen sich: ' + describeTarget(singlePair.targetTypeA, singlePair.targetA) +
        ' und ' + describeTarget(singlePair.targetTypeB, singlePair.targetB) + CAVEAT;
    }

    const suffix = aggregatedResult === 'mixed' ? ' teilweise' : '';
    return 'Zielbereiche überlappen sich' + suffix + CAVEAT;
  }

  // Analog zu buildScopeExplanation(), aber fuer Mehrfachdefinitionen
  // (identischer Wert). "mixed" bekommt hier bewusst nur den allgemeinen
  // Hinweis auf die Aufschluesselung - die eigentliche Paar-fuer-Paar-Liste
  // steht in finding.scopePairs und wird vom Renderer separat dargestellt
  // (Prompt 2: "nicht nur das Label 'mixed' ohne Aufschluesselung
  // anzeigen").
  function buildRedundantScopeExplanation(scopeRelation) {
    const CAVEAT = ' (Security-/WMI-Filter nicht berücksichtigt).';
    if (scopeRelation === 'overlap') {
      return 'Alle beteiligten GPOs überlappen sich paarweise' + CAVEAT;
    }
    if (scopeRelation === 'none') {
      return 'Alle beteiligten GPOs liegen in eindeutig getrennten Zielbereichen' + CAVEAT;
    }
    if (scopeRelation === 'unknown') {
      return 'Scope-Bezug nicht sicher bestimmbar, z. B. über eine Site-Verknüpfung oder einen fehlenden aktiven Link' + CAVEAT;
    }
    // mixed
    return 'Nicht alle beteiligten GPOs überlappen sich - siehe Aufschlüsselung unten' + CAVEAT;
  }

  // Gruppiert nach (scope + settingKey), nicht nur settingKey - eine
  // Computer- und eine User-Einstellung mit zufaellig gleichem Namen
  // duerfen nicht gegeneinander verglichen werden.
  function groupSettingsByKeyAndScope(gpos) {
    const groups = {};
    gpos.forEach(gpo => {
      (gpo.settings || []).forEach(s => {
        const groupKey = (s.scope || '') + '::' + s.key;
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push({
          settingKey: s.key,
          scope: s.scope,
          value: s.value,
          gpoId: gpo.id,
          gpoName: gpo.name,
        });
      });
    });
    return groups;
  }

  // ── GPO-Hygiene (Abschnitt 8) ───────────────────────────────
  // Jede Pruefung erzeugt hoechstens 1 Finding pro GPO. Formulierung immer
  // "pruefen, ob noch benoetigt" statt einer Loesch-Empfehlung - das steht
  // in rules.json, nicht hier.
  function analyzeHygiene(model, gpo, rules) {
    const findings = [];

    // Ein deaktivierter Link wendet die GPO nirgends an - fachlich
    // gleichbedeutend mit "keine Verknuepfung" fuer diese Regel (siehe
    // .md/todo/GPO_Analyzer_Pre_Real_Data_Hardening.md, Abschnitt 3:
    // "Analyzer muss deaktivierte Links beruecksichtigen"). Beide Faelle
    // ("gar kein Link" vs. "Link vorhanden, aber deaktiviert") sind aber
    // beim GPMC-Abgleich fachlich unterschiedlich zu verifizieren - ein
    // Techniker soll nicht denken, das Tool haette sich geirrt, wenn er
    // einen (deaktivierten) Link vorfindet. Deshalb wird unterschieden
    // und im detail-Objekt an den Renderer weitergegeben (siehe
    // buildHygieneCard() in gpo-renderer.js).
    // Fehlt links.json komplett, waere "kein Link gefunden" fuer JEDE GPO
    // wahr und wuerde die Hygiene-Liste mit lauter falschen "unverknuepft"-
    // Befunden fluten - das ist derselbe Fehler wie bei der Uebersichtszahl
    // "Unverknuepfte GPOs" (siehe unlinkedGpoCount() in gpo-renderer.js),
    // nur auf Finding-Ebene: eine fehlende Datei bedeutet "unbekannt", nicht
    // "kein Link" (Abschnitt 8). Die Regel wird deshalb komplett
    // uebersprungen statt falsche Findings zu erzeugen.
    const noLinksRule = findRule(rules, 'GPO_NO_LINKS');
    if (noLinksRule && !(model.dataQuality && model.dataQuality.linksFileMissing)) {
      const gpoLinks = model.links.filter(l => l.gpoId === gpo.id);
      const hasEnabledLink = gpoLinks.some(l => l.linkEnabled);
      if (!hasEnabledLink) {
        const detail = gpoLinks.length === 0
          ? { linkStatus: 'none' }
          : { linkStatus: 'disabled', disabledLinkCount: gpoLinks.length };
        findings.push(buildHygieneFinding(noLinksRule, gpo, detail));
      }
    }

    // "Keine Einstellungen" ist nur eine sichere Aussage, wenn der Report
    // dieser GPO auch tatsaechlich vollstaendig gelesen werden konnte -
    // sonst ist die leere settings-Liste nur eine fehlende Datengrundlage,
    // kein fachlicher Befund (siehe .md/todo/GPO_Analyzer_Pre_Real_Data_
    // Hardening.md, Abschnitt 5/7/10: "Unbekannt ist nicht gleich Nein").
    // Der analysierbare Status selbst wird separat im Snapshot-Integritaets-
    // Bereich angezeigt (renderIntegrityPanel() in gpo-renderer.js), nicht
    // als Finding mit Severity - Datenqualitaet und Finding-Severity werden
    // bewusst nicht vermischt.
    const noSettingsRule = findRule(rules, 'GPO_NO_SETTINGS');
    if (noSettingsRule && gpo.parseStatus === 'complete' && (gpo.settings || []).length === 0) {
      findings.push(buildHygieneFinding(noSettingsRule, gpo));
    }

    const veryOldRule = findRule(rules, 'GPO_VERY_OLD');
    if (veryOldRule && gpo.modified) {
      const modifiedDate = new Date(gpo.modified);
      if (!isNaN(modifiedDate.getTime())) {
        const ageYears = (Date.now() - modifiedDate.getTime()) / (365.25 * 24 * 3600 * 1000);
        if (ageYears >= VERY_OLD_THRESHOLD_YEARS) {
          findings.push(buildHygieneFinding(veryOldRule, gpo, {
            modified: gpo.modified,
            ageYears: Math.floor(ageYears),
            // rules.json's Name traegt einen "{years}"-Platzhalter statt
            // eines hart codierten Schwellwerts (Roadmap Abschnitt 1.4) -
            // thresholdYears liefert dem Renderer den Wert zur Substitution,
            // ohne VERY_OLD_THRESHOLD_YEARS selbst exportieren zu muessen.
            thresholdYears: VERY_OLD_THRESHOLD_YEARS,
          }));
        }
      }
    }

    const hasComputerSettings = (gpo.settings || []).some(s => s.scope === 'Computer');
    const hasUserSettings = (gpo.settings || []).some(s => s.scope === 'User');

    // Beide DISABLED_ONLY-Regeln behaupten "der jeweils andere Scope hat
    // keine Einstellungen" - bei einem nur teilweise gelesenen Report kann
    // das schlicht heissen, dass genau dieser Scope nicht ausgewertet
    // werden konnte, nicht dass er wirklich leer ist. Deshalb ebenfalls nur
    // bei parseStatus 'complete' auswerten.
    const computerDisabledRule = findRule(rules, 'GPO_COMPUTER_DISABLED_ONLY');
    if (computerDisabledRule && gpo.parseStatus === 'complete' && !gpo.computerEnabled && hasComputerSettings && !hasUserSettings) {
      findings.push(buildHygieneFinding(computerDisabledRule, gpo));
    }

    const userDisabledRule = findRule(rules, 'GPO_USER_DISABLED_ONLY');
    if (userDisabledRule && gpo.parseStatus === 'complete' && !gpo.userEnabled && hasUserSettings && !hasComputerSettings) {
      findings.push(buildHygieneFinding(userDisabledRule, gpo));
    }

    return findings;
  }

  function buildHygieneFinding(rule, gpo, detail) {
    return {
      type: 'hygiene',
      rule: rule,
      severity: rule.severity,
      gpoId: gpo.id,
      gpoName: gpo.name,
      detail: detail || {},
    };
  }

  // ── Security Filtering (Abschnitt 9) ────────────────────────
  // Nur eine Auffaelligkeit, keine Fehlermeldung: eine Server-/RDS-OU mit
  // reinem Benutzerfilter ist nicht automatisch falsch.
  function analyzeSecurityFilter(model, gpo, rules) {
    const rule = findRule(rules, 'SECURITY_FILTER_SERVER_OU_USER_FILTER');
    if (!rule) return null;
    if (!gpo.securityFilter || !gpo.securityFilter.length) return null;

    const gpoLinks = model.links.filter(l => l.gpoId === gpo.id);
    const serverLink = gpoLinks.find(l => isServerLikeTarget(l.target));
    if (!serverLink) return null;

    const hasComputerFilter = gpo.securityFilter.some(f => looksLikeComputerTrustee(f.trustee));
    if (hasComputerFilter) return null;

    return {
      type: 'security-filter',
      rule: rule,
      severity: rule.severity,
      gpoId: gpo.id,
      gpoName: gpo.name,
      target: serverLink.target,
      targetType: serverLink.targetType,
      securityFilter: gpo.securityFilter,
    };
  }

  function isServerLikeTarget(target) {
    const lower = (target || '').toLowerCase();
    return SERVER_OU_KEYWORDS.some(kw => lower.includes(kw));
  }

  function looksLikeComputerTrustee(name) {
    const lower = (name || '').toLowerCase();
    return COMPUTER_TRUSTEE_PATTERNS.some(p => lower.includes(p));
  }

  // ── WMI-Filter (Abschnitt 10) ────────────────────────────────
  // Reine Darstellung: welcher Filter, welche GPO. Keine Bewertung der
  // Query-Syntax selbst.
  function analyzeWmiFilter(gpo, rules) {
    const rule = findRule(rules, 'WMI_FILTER_ASSIGNED');
    if (!rule || !gpo.wmiFilter) return null;

    return {
      type: 'wmi-filter',
      rule: rule,
      severity: rule.severity,
      gpoId: gpo.id,
      gpoName: gpo.name,
      wmiFilter: gpo.wmiFilter,
    };
  }

  function findRule(rules, id) {
    return (rules || []).find(r => r.id === id) || null;
  }

  // aggregateOverlapResults() ist exportiert, da sie in einem spaeteren
  // Prompt auf einer anderen Ebene wiederverwendet wird (siehe Kommentar
  // an der Funktion selbst).
  return { analyze, aggregateOverlapResults };
})();
