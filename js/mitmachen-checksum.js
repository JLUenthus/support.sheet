// ============================================================
// support.sheet – mitmachen-checksum.js
// Gemeinsame Checksum-Logik fuer js/mitmachen.js (Prompt 1: berechnet
// baseChecksum beim Laden) und den kuenftigen Merge-Helfer aus dem
// Mitmachen-Konzept, Schritt 7 (vergleicht baseChecksum gegen frisch
// hochgeladene Original-Dateien). Beide MUESSEN fuer identische Dateien
// exakt denselben Wert berechnen, sonst schlaegt der Staleness-Vergleich
// beim Merge grundlos an oder erkennt eine echte Abweichung nicht.
// Einfacher, nicht-kryptografischer Hash – kein Sicherheitsanspruch,
// nur Drift-Erkennung.
// ============================================================
window.MitmachenChecksum = (function () {

  // 32-Bit-Rolling-Hash (djb2-artig), als Hex-String. Deterministisch fuer
  // denselben String, keine kryptografischen Eigenschaften noetig.
  function simpleChecksum(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16);
  }

  // datasets: { commandsWindows, commandsExchange, commandsForti, guides }
  // Erwartet die ROHEN, unveraenderten JSON.parse()-Ergebnisse der vier
  // Originaldateien (commands.json wie geliefert inkl. Wrapper, exchange-/
  // forti-commands.json als flaches Array, support-guides.json inkl.
  // Wrapper) – NICHT die in mitmachen.js normalisierten Arbeitskopie-Arrays
  // (die haengen zusaetzlich ein internes _category-Feld an jeden Command,
  // das in den echten Dateien nicht existiert und den Vergleich mit frisch
  // hochgeladenen Originaldateien sonst verfaelschen wuerde).
  //
  // Reihenfolge/Format hier sind willkuerlich, aber fixiert: jede Aenderung
  // an dieser Funktion aendert alle kuenftig berechneten Checksums – beide
  // Seiten (mitmachen.js und der Merge-Helfer) muessen darum immer dieselbe
  // Version dieser Datei verwenden.
  function computeDatasetsChecksum(datasets) {
    const basis = JSON.stringify(datasets.commandsWindows) + '|' +
                  JSON.stringify(datasets.commandsExchange) + '|' +
                  JSON.stringify(datasets.commandsForti) + '|' +
                  JSON.stringify(datasets.guides);
    return simpleChecksum(basis);
  }

  return { simpleChecksum, computeDatasetsChecksum };
})();
