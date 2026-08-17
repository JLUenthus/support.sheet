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
        // Konsistent + mehrfach definiert = redundant (Info-Charakter,
        // kein Wertkonflikt erkennbar).
        findings.push({
          type: 'redundant',
          settingKey: settingKey,
          scope: scope,
          entries: findingEntries,
          severity: 'info',
        });
      } else {
        // Unterschiedliche konfigurierte Werte = widerspruechlich, echter
        // Konflikt.
        findings.push({
          type: 'conflict',
          settingKey: settingKey,
          scope: scope,
          entries: findingEntries,
          severity: 'critical',
          hint: RSOP_HINT,
        });
      }
    });

    return findings;
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

  return { analyze };
})();
