// ============================================================
// support.sheet – mitmachen-export.js
// Baut aus pendingChanges eine ZIP-Datei zum Download (Prompt 4 /
// Schritt 6 aus dem Mitmachen-Konzept). Reine Bau-Logik, kein State –
// bekommt alles als Parameter von js/mitmachen.js uebergeben.
// Erwartet js/jszip.min.js vor dieser Datei.
// ============================================================
window.MitmachenExport = (function () {

  const LIES_MICH_TEXT =
    'Diese ZIP enthaelt neue Beitraege fuer support.sheet.\n' +
    '\n' +
    'Enthalten:\n' +
    '- commands-additions.json: neue Befehle zum Einfuegen in die jeweilige\n' +
    '  commands-Datei\n' +
    '- support-guides-additions.json: neue Guides zum Einfuegen in\n' +
    '  support-guides.json\n' +
    '- merge-info.json: Metadaten zum Beitrag\n' +
    '\n' +
    'Nach dem Merge bitte sw.js CACHE_VERSION bumpen.\n' +
    'Format: YYYYMMDD-HHMM';

  function pad2(n) { return String(n).padStart(2, '0'); }

  function todayDateString() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // commands-additions.json: neue Commands nach Kategorie gruppiert, im
  // jeweiligen Original-Dateiformat (Windows: { commands: [...] } wie
  // commands.json, Exchange/Forti: flaches Array wie die jeweilige Datei).
  // _category/_pending sind reine UI-interne Felder dieser Seite und
  // werden entfernt, damit der Maintainer die Eintraege 1:1 uebernehmen
  // kann. guideRef wird nur gesetzt, wenn eine Verknuepfung existiert –
  // genau wie im Bestand, wo das Feld sonst komplett fehlt statt null zu sein.
  function buildCommandsAdditions(newCommands, links) {
    function stripForExport(cmd) {
      const { _category, _pending, guideRef, ...rest } = cmd;
      const link = links.find(l => l.commandId === cmd.id);
      if (link) rest.guideRef = link.guideId;
      return rest;
    }

    const windows  = newCommands.filter(c => c._category === 'windows').map(stripForExport);
    const exchange = newCommands.filter(c => c._category === 'exchange').map(stripForExport);
    const forti    = newCommands.filter(c => c._category === 'forti').map(stripForExport);

    return {
      windows: { commands: windows },
      exchange,
      forti,
    };
  }

  function buildGuidesAdditions(newGuides) {
    return { guides: newGuides.map(g => ({ ...g })) };
  }

  function buildMergeInfo(opts) {
    return {
      exportedAt: new Date().toISOString(),
      exportedBy: opts.exportedBy,
      baseChecksum: opts.baseChecksum,
      newCommands: opts.newCommandsCount,
      newGuides: opts.newGuidesCount,
      newLinks: opts.newLinksCount,
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // pendingChanges: { newCommands, newGuides, links }
  // baseChecksum: beim Laden berechneter Pruefwert der Arbeitskopie
  // exportedBy: eingegebener Name
  async function buildAndDownload({ pendingChanges, baseChecksum, exportedBy }) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip konnte nicht geladen werden.');
    }

    const zip = new JSZip();

    zip.file('commands-additions.json', JSON.stringify(
      buildCommandsAdditions(pendingChanges.newCommands, pendingChanges.links), null, 2
    ));
    zip.file('support-guides-additions.json', JSON.stringify(
      buildGuidesAdditions(pendingChanges.newGuides), null, 2
    ));
    zip.file('merge-info.json', JSON.stringify(
      buildMergeInfo({
        exportedBy,
        baseChecksum,
        newCommandsCount: pendingChanges.newCommands.length,
        newGuidesCount: pendingChanges.newGuides.length,
        newLinksCount: pendingChanges.links.length,
      }), null, 2
    ));
    zip.file('LIES_MICH.txt', LIES_MICH_TEXT);

    const blob = await zip.generateAsync({ type: 'blob' });
    const filename = 'mitmachen-export-' + todayDateString() + '.zip';
    downloadBlob(blob, filename);

    return { filename };
  }

  return { buildAndDownload };
})();
