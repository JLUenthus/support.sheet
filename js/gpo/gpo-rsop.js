// ============================================================
// gpo-rsop.js (V4.9) – Liest einen hochgeladenen RSoP-XML- oder
// gpresult-HTML-Bericht eines konkreten Computers ein und normalisiert
// ihn zu einem eigenstaendigen rsopReport-Modell. Reine Leselogik, kein
// WinRM/Netzwerkzugriff, keine Aenderung an gpo-analyzer.js/gpo-parser.js/
// bsi-mapping.js/rules.json.
//
// Real-data-verifiziert an einem echten RSoP-XML-Export (GPMC "Bericht
// speichern als" / gpresult /x) und vier echten gpresult /h HTML-Berichten
// (siehe V4.9-Abschlussbericht). Nur Faelle implementiert, die sich gegen
// diese echten Dateien nachvollziehen liessen - siehe Abschnitt "Bewusst
// NICHT interpretiert" im Bericht:
//  - Administrative-Template-Settings sind im RSoP-XML nur als rohe
//    Registry-Werte (RSOP_PolmkrRegistrySetting) vorhanden, ohne Bruecke
//    zum im Snapshot gespeicherten Anzeigenamen - deshalb NICHT ueber XML
//    vergleichbar.
//  - Die "Verweigerte Gruppenrichtlinienobjekte"-Sektion im HTML-Bericht
//    konnte an keinem der vier echten Beispiele verifiziert werden (keines
//    enthielt eine verweigerte GPO) - wird best-effort im selben Muster
//    wie die verifizierte "Angewendete..."-Sektion gesucht, faellt aber
//    bei abweichender Struktur einfach leer aus statt zu raten.
//  - Aus dem Windows-Ereignisprotokoll im HTML-Bericht ("...wurde nicht
//    angewendet, da...") wird NICHTS ausgelesen - die Zuordnung von
//    Freitext zu einer konkreten GPO waere Raten, kein Parsing.
// ============================================================
window.GpoRsop = (function() {

  // Gemeinsame XML-Helfer werden aus gpo-xml-utils.js wiederverwendet.
  // Dadurch gibt es fuer RSoP und Microsoft-gpreport nur eine Parser-Basis.
  const Xml = window.GpoXmlUtils;
  if (!Xml) throw new Error('GpoXmlUtils muss vor gpo-rsop.js geladen werden.');
  const normalizeGuid = Xml.normalizeGuid;
  const byLocalName = Xml.byLocalName;
  const directChildrenByLocalName = Xml.directChildrenByLocalName;
  const directChildByLocalName = Xml.directChildByLocalName;
  const textOf = Xml.textOf;
  const textOfChild = Xml.textOfChild;
  const SYSTEM_ACCESS_POLICY_DISPLAY_NAMES = Xml.SYSTEM_ACCESS_POLICY_DISPLAY_NAMES;

  function pushSetting(settings, settingEl, key, value) {
    if (!key || value === null || value === undefined) return;
    const gpoRefEl = directChildByLocalName(settingEl, 'GPO');
    const identifierEl = gpoRefEl ? directChildByLocalName(gpoRefEl, 'Identifier') : null;
    const gpoId = normalizeGuid(textOf(identifierEl));
    const precedenceText = textOfChild(settingEl, 'Precedence');
    const precedence = precedenceText ? parseInt(precedenceText, 10) : null;
    settings.push({ key, value, gpoId, gpoName: null, precedence, source: 'xml' });
  }

  // Nur die drei Kategorien, fuer die eine real-data-verifizierte,
  // eindeutige Namenszuordnung zum Snapshot-settingKey existiert (siehe
  // Bericht). Administrative Templates/Registry-Settings werden hier
  // bewusst NICHT gelesen.
  function parseSettingsFromExtensionData(resultsBlock) {
    const settings = [];
    directChildrenByLocalName(resultsBlock, 'ExtensionData').forEach(extData => {
      const extension = directChildByLocalName(extData, 'Extension');
      if (!extension) return;

      directChildrenByLocalName(extension, 'Account').forEach(el => {
        const name = textOfChild(el, 'Name');
        if (!name) return;
        const boolVal = textOfChild(el, 'SettingBoolean');
        const value = boolVal !== null ? boolVal : textOfChild(el, 'SettingNumber');
        pushSetting(settings, el, 'Security Settings > Account Policies > ' + name, value);
      });

      directChildrenByLocalName(extension, 'UserRightsAssignment').forEach(el => {
        const name = textOfChild(el, 'Name');
        if (!name) return;
        const members = directChildrenByLocalName(el, 'Member').map(m => textOfChild(m, 'Name')).filter(Boolean);
        pushSetting(settings, el, 'Security Settings > User Rights Assignment > ' + name, members.join(', '));
      });

      directChildrenByLocalName(extension, 'SecurityOptions').forEach(el => {
        const displayEl = directChildByLocalName(el, 'Display');
        const displayName = displayEl ? textOfChild(displayEl, 'Name') : null;
        const keyName = textOfChild(el, 'KeyName');
        const sysAccessName = textOfChild(el, 'SystemAccessPolicyName');
        let name = null;
        if (displayName) name = displayName;
        else if (keyName) name = keyName;
        else if (sysAccessName) {
          name = SYSTEM_ACCESS_POLICY_DISPLAY_NAMES[sysAccessName] || ('Unbekannte Security Option (' + sysAccessName + ')');
        }
        if (!name) return;
        const displayBool = displayEl ? textOfChild(displayEl, 'DisplayBoolean') : null;
        const value = displayBool !== null ? displayBool : textOfChild(el, 'SettingNumber');
        pushSetting(settings, el, 'Security Settings > Security Options > ' + name, value);
      });
    });
    return settings;
  }

  // GPO.Name ist manchmal selbst die GUID (IsValid=false, Name konnte nicht
  // aufgeloest werden) - dann keinen "Anzeigenamen" behaupten.
  function parseGpoList(resultsBlock) {
    return directChildrenByLocalName(resultsBlock, 'GPO').map(gpoEl => {
      const pathEl = directChildByLocalName(gpoEl, 'Path');
      const identifierEl = pathEl ? directChildByLocalName(pathEl, 'Identifier') : null;
      const id = normalizeGuid(textOf(identifierEl));
      const rawName = textOfChild(gpoEl, 'Name');
      const nameIsGuid = id && normalizeGuid(rawName) === id;
      const enabledText = textOfChild(gpoEl, 'Enabled');
      const isValidText = textOfChild(gpoEl, 'IsValid');
      const filterAllowedText = textOfChild(gpoEl, 'FilterAllowed');
      const accessDeniedText = textOfChild(gpoEl, 'AccessDenied');
      const linkEl = directChildByLocalName(gpoEl, 'Link');
      const appliedOrderText = linkEl ? textOfChild(linkEl, 'AppliedOrder') : null;
      const appliedOrder = appliedOrderText !== null ? parseInt(appliedOrderText, 10) : null;
      const securityFilters = directChildrenByLocalName(gpoEl, 'SecurityFilter').map(textOf).filter(Boolean);
      return {
        id,
        name: nameIsGuid ? null : rawName,
        enabled: enabledText === null ? null : enabledText === 'true',
        isValid: isValidText === null ? null : isValidText === 'true',
        filterAllowed: filterAllowedText === null ? null : filterAllowedText === 'true',
        accessDenied: accessDeniedText === null ? null : accessDeniedText === 'true',
        appliedOrder,
        securityFilters,
        // "applied" ist eine reine Ableitung aus dem bereits vorhandenen
        // RSoP-Feld AppliedOrder (>0 = tatsaechlich verarbeitet, 0 = nicht) -
        // keine neue Ursachenermittlung, siehe Bericht Abschnitt 15.
        applied: appliedOrder !== null && appliedOrder > 0,
        source: 'xml',
      };
    });
  }

  function parseResultsBlock(root, blockLocalName) {
    const block = byLocalName(root, blockLocalName)[0];
    if (!block) return null;
    return {
      name: textOfChild(block, 'Name'),
      domain: textOfChild(block, 'Domain'),
      gpos: parseGpoList(block),
      settings: parseSettingsFromExtensionData(block),
    };
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Datei konnte nicht als XML gelesen werden (ungültiges XML).');
    }
    const root = byLocalName(doc, 'Rsop')[0];
    if (!root) {
      throw new Error('Kein RSoP-XML erkannt (Wurzelelement „Rsop" fehlt).');
    }
    const readTime = textOfChild(root, 'ReadTime');
    const dataType = textOfChild(root, 'DataType');
    const computerBlock = parseResultsBlock(root, 'ComputerResults');
    const userBlock = parseResultsBlock(root, 'UserResults');
    if (!computerBlock && !userBlock) {
      throw new Error('RSoP-XML enthält weder ComputerResults noch UserResults.');
    }
    return {
      reportType: 'xml',
      generatedAt: readTime,
      dataType,
      computer: computerBlock ? computerBlock.name : null,
      domain: (computerBlock && computerBlock.domain) || (userBlock && userBlock.domain) || null,
      user: userBlock ? userBlock.name : null,
      gpos: (computerBlock ? computerBlock.gpos : []).concat(userBlock ? userBlock.gpos : []),
      settings: (computerBlock ? computerBlock.settings : []).concat(userBlock ? userBlock.settings : []),
    };
  }

  // ── HTML (gpresult /h) ───────────────────────────────────
  const GUID_IN_BRACKETS_RE = /^(.*)\s\[\{?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}?\]$/;

  function findInfoRowValue(doc, label) {
    const cells = Array.from(doc.querySelectorAll('table.info td strong, table.info th strong'));
    const match = cells.find(el => el.textContent.trim() === label);
    if (!match) return null;
    const row = match.closest('tr');
    const tds = row ? row.querySelectorAll('td') : null;
    return tds && tds.length > 1 ? tds[1].textContent.trim() : null;
  }

  // Sammelt "Name [{GUID}]"-Ueberschriften (.sectionTitle) in flacher
  // Dokumentreihenfolge, beginnend direkt nach dem Abschnittstitel
  // startText, bis der erste nicht passende Titel erscheint (= naechster
  // Hauptabschnitt). Real-data-verifiziert fuer "Angewendete
  // Gruppenrichtlinienobjekte" - "Verweigerte..." folgt bewusst demselben,
  // ungetesteten Muster und faellt bei Abweichung einfach leer aus.
  function collectGposAfterSectionTitle(sectionTitles, startText, applied, out) {
    const idx = sectionTitles.findIndex(el => el.textContent.trim() === startText);
    if (idx === -1) return;
    for (let i = idx + 1; i < sectionTitles.length; i++) {
      const m = GUID_IN_BRACKETS_RE.exec(sectionTitles[i].textContent.trim());
      if (!m) break;
      out.push({
        id: normalizeGuid(m[2]),
        name: m[1].trim(),
        enabled: null, isValid: null, filterAllowed: null, accessDenied: null,
        appliedOrder: null, securityFilters: [],
        applied,
        source: 'html',
      });
    }
  }

  // Administrative-Template-Settings ueber die vom Report selbst
  // mitgelieferten gpmc_settingName/gpmc_settingPath-Attribute (real-data-
  // verifiziert). Der Kategorie-Pfad wird nur im Trennzeichen an das
  // Snapshot-Format (" > ") angenaehert, keine neue Kategorisierung. Ob die
  // Kategorie-Bezeichnungen selbst exakt mit dem Snapshot uebereinstimmen,
  // ist NICHT gegen dieselbe Umgebung verifiziert (Bericht: "best effort") -
  // bei Abweichung entsteht dadurch hoechstens ein Nicht-Treffer ("? nicht
  // vergleichbar"), keine falsche Abweichungs-Behauptung.
  function parseAdmxSettingsFromHtml(doc) {
    const settings = [];
    doc.querySelectorAll('span.explainlink[gpmc_settingname]').forEach(span => {
      const settingName = span.getAttribute('gpmc_settingname');
      const settingPath = span.getAttribute('gpmc_settingpath');
      if (!settingName || !settingPath) return;
      const row = span.closest('tr');
      const tds = row ? row.querySelectorAll('td') : null;
      if (!tds || tds.length < 3) return;
      const value = tds[1].textContent.trim();
      const gpoName = tds[2].textContent.trim();
      const category = settingPath.replace(/\//g, ' > ');
      settings.push({
        key: category + ' > ' + settingName,
        value,
        gpoId: null,
        gpoName,
        precedence: null,
        source: 'html-admx',
      });
    });
    return settings;
  }

  function parseHtml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    if (!doc || !doc.documentElement || !doc.body) {
      throw new Error('Datei konnte nicht als HTML gelesen werden.');
    }

    const titleText = (doc.title || '').trim();
    let user = null;
    let computer = null;
    if (titleText) {
      const parts = titleText.split(/\s+auf\s+/i);
      if (parts.length === 2) {
        user = parts[0].trim();
        computer = parts[1].trim();
      } else {
        computer = titleText;
      }
    }

    const computerFromTable = findInfoRowValue(doc, 'Computername');
    if (computerFromTable) computer = computerFromTable;
    const domain = findInfoRowValue(doc, 'Domäne');

    const sectionTitles = Array.from(doc.querySelectorAll('.sectionTitle'));
    const gpos = [];
    collectGposAfterSectionTitle(sectionTitles, 'Angewendete Gruppenrichtlinienobjekte', true, gpos);
    const deniedTitleEl = sectionTitles.find(el => el.textContent.trim().indexOf('Verweigerte Gruppenrichtlinienobjekte') === 0);
    if (deniedTitleEl) {
      collectGposAfterSectionTitle(sectionTitles, deniedTitleEl.textContent.trim(), false, gpos);
    }

    const hasRecognizableContent = titleText || computer || gpos.length;
    if (!hasRecognizableContent) {
      throw new Error('Kein gpresult-Bericht erkannt (erwartete Struktur nicht gefunden).');
    }

    return {
      reportType: 'html',
      generatedAt: null,
      dataType: null,
      computer,
      domain,
      user,
      gpos,
      settings: parseAdmxSettingsFromHtml(doc),
    };
  }

  // Real-data-Fund: RSoP-XML und gpresult-HTML werden von GPMC/gpresult
  // durchgaengig als UTF-16 (mit BOM) geschrieben. Blob.text()/Response.
  // text() decodieren per Spezifikation IMMER als UTF-8 und wuerden die
  // Datei damit unlesbar machen (jedes ASCII-Zeichen erscheint dann von
  // einem Nullbyte gefolgt) - deshalb wird hier bewusst ueber ArrayBuffer +
  // TextDecoder anhand der echten BOM decodiert, mit UTF-8 als Fallback
  // fuer Dateien ohne BOM.
  const decodeReportBuffer = Xml.decodeReportBuffer;

  function parseReport(text, filename) {
    const trimmed = (text || '').replace(/^﻿/, '').trimStart();
    const looksLikeXml = trimmed.indexOf('<?xml') === 0 || /^<Rsop[\s>]/.test(trimmed);
    try {
      if (looksLikeXml) return { ok: true, report: parseXml(text) };
      return { ok: true, report: parseHtml(text) };
    } catch (err) {
      console.error('[GpoRsop] Fehler beim Parsen von "' + filename + '":', err);
      return { ok: false, error: err.message || 'Bericht konnte nicht gelesen werden.' };
    }
  }

  return { parseReport, normalizeGuid, decodeReportBuffer };
})();
