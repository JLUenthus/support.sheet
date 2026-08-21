// ============================================================
// gpo-loader.js – Upload-Zone (Drag & Drop + Klick), entpackt die
// ZIP mit js/jszip.min.js und liest die erwarteten JSON-Dateien aus
// (5 Kern-Dateien + optional computers.json, siehe
// SILENT_OPTIONAL_FILES). Fehlt eine Kern-Datei, laeuft der Analyzer
// trotzdem weiter - gpo-renderer.js zeigt dann sichtbar, welche
// Auswertung dadurch eingeschraenkt ist. Reicht die rohen JSON-Objekte
// an gpo-parser.js weiter.
// ============================================================
window.GpoLoader = (function() {

  const FILE_TO_KEY = {
    'gpos.json': 'gpos',
    'links.json': 'links',
    'filters.json': 'filters',
    'wmi-filters.json': 'wmiFilters',
    'metadata.json': 'metadata',
    'computers.json': 'computers',
  };

  // computers.json wird zwar wie jede andere Datei eingelesen (siehe Schleife
  // unten), erscheint aber bewusst NICHT in der "fehlende Datei(en)"-Warnung:
  // sie ist eine optionale, aktuell noch von keiner Funktion konsumierte
  // Datenquelle (keine BSI-Coverage implementiert) - eine Warnung "Analyzer
  // läuft eingeschränkt weiter" waere hier irrefuehrend, da tatsaechlich
  // nichts eingeschraenkt ist. Sobald eine Funktion computers.json
  // tatsaechlich auswertet, gehoert sie hier wieder heraus.
  const SILENT_OPTIONAL_FILES = ['computers.json'];

  // V3.6 Loading-State: reiner UX-Zustand um denselben processFile()-Ablauf
  // herum - keine neue Verarbeitungslogik, kein neuer Snapshot-Lifecycle.
  // isProcessing verhindert nur, dass ein zweiter Upload waehrend eines
  // laufenden Uploads denselben Ablauf ueberlappend startet (Auftrag
  // Abschnitt 7 - "alter Loading-State darf nicht haengen bleiben, neuer
  // Upload startet einen neuen Loading-State"): ein bereits laufender
  // Upload wird zu Ende gefuehrt, ein weiterer Drop/Klick waehrenddessen
  // wird ignoriert statt zwei parallele renderOverview()-Aufrufe zu
  // riskieren, die sich vermischen koennten.
  let isProcessing = false;

  // Gibt die Kontrolle einmal an den Event-Loop zurueck, damit der Browser
  // die Chance bekommt, den zuvor gesetzten Loading-Text/Spinner zu
  // zeichnen, bevor der naechste synchrone Verarbeitungsschritt (JSON.
  // parse/normalize/analyze/renderOverview) den Haupt-Thread blockiert.
  // Bewusst setTimeout(0) statt requestAnimationFrame: rAF wird von
  // Browsern in nicht sichtbaren/inaktiven Tabs ausgesetzt und wuerde den
  // gesamten Upload dort auf unbestimmte Zeit haengen lassen (genau der in
  // Auftrag Abschnitt 6 ausdruecklich verbotene Zustand) - setTimeout(0)
  // feuert dagegen auch in Hintergrund-Tabs zuverlaessig. Keine kuenstliche
  // Wartezeit "damit der Spinner sichtbar wird" unabhaengig vom Ablauf -
  // sie haengt direkt an echten, bereits vorhandenen Verarbeitungsschritten.
  function nextTick() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function setLoadingStatus(text) {
    const textEl = document.getElementById('gpo-upload-loading-text');
    if (textEl) textEl.textContent = text;
  }

  function showLoading(zone) {
    zone.classList.remove('gpo-upload-zone--done');
    zone.classList.add('gpo-upload-zone--loading');
    const loading = document.getElementById('gpo-upload-loading');
    if (loading) loading.hidden = false;
    setLoadingStatus('Snapshot wird verarbeitet …');
  }

  function hideLoading(zone) {
    zone.classList.remove('gpo-upload-zone--loading');
    const loading = document.getElementById('gpo-upload-loading');
    if (loading) loading.hidden = true;
  }

  function showUploadError() {
    const error = document.getElementById('gpo-upload-error');
    if (error) error.hidden = false;
  }

  function hideUploadError() {
    const error = document.getElementById('gpo-upload-error');
    if (error) error.hidden = true;
  }

  function init() {
    const zone = document.getElementById('gpo-upload-zone');
    const input = document.getElementById('gpo-file-input');
    if (!zone || !input) return;

    zone.addEventListener('click', () => { if (!isProcessing) input.click(); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); if (!isProcessing) zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      if (isProcessing) return;
      if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', (e) => {
      if (isProcessing) return;
      if (e.target.files[0]) processFile(e.target.files[0]);
    });
  }

  async function processFile(file) {
    const zone = document.getElementById('gpo-upload-zone');
    isProcessing = true;
    hideUploadError();
    showLoading(zone);
    await nextTick();

    try {
      setLoadingStatus('Snapshot wird geladen …');
      const buffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      await nextTick();

      setLoadingStatus('Dateien werden eingelesen …');
      const raw = {};
      const missingFiles = [];

      for (const filename of Object.keys(FILE_TO_KEY)) {
        const entry = zip.file(filename);
        if (!entry) {
          if (SILENT_OPTIONAL_FILES.indexOf(filename) === -1) missingFiles.push(filename);
          continue;
        }
        const text = await entry.async('string');
        raw[FILE_TO_KEY[filename]] = JSON.parse(text);
      }

      // Nur gegen die Kern-Dateien pruefen (ohne SILENT_OPTIONAL_FILES) -
      // sonst wuerde ein ZIP, das ausschliesslich computers.json enthaelt,
      // faelschlich als "gueltiger" Snapshot durchgehen.
      const coreFileCount = Object.keys(FILE_TO_KEY).length - SILENT_OPTIONAL_FILES.length;
      if (missingFiles.length === coreFileCount) {
        throw new Error('Keine der erwarteten Dateien (gpos.json, links.json, filters.json, wmi-filters.json, metadata.json) im ZIP gefunden.');
      }

      setLoadingStatus('GPO-Daten werden verarbeitet …');
      await nextTick();
      const model = window.GpoParser.normalize(raw);
      const rules = await window.GpoRules.loadRules();
      const findings = window.GpoAnalyzer.analyze(model, rules);

      setLoadingStatus('Auswertung wird dargestellt …');
      await nextTick();
      await window.GpoRenderer.renderOverview(model, findings, missingFiles);

      hideLoading(zone);
      zone.classList.add('gpo-upload-zone--done');
      const textEl = zone.querySelector('.gpo-upload-text');
      if (textEl) textEl.textContent = '✅ ' + file.name;

      const results = document.getElementById('gpo-results');
      setTimeout(() => results.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    } catch (err) {
      // Technisches Detail nur in die Konsole, nie als primaere
      // Nutzerinformation (Auftrag Abschnitt 6) - die UI zeigt
      // ausschliesslich die stabile, verstaendliche Meldung in
      // #gpo-upload-error.
      console.error('[GpoLoader] Fehler beim Verarbeiten des Snapshots:', err);
      hideLoading(zone);
      zone.classList.remove('gpo-upload-zone--done');
      const textEl = zone.querySelector('.gpo-upload-text');
      if (textEl) textEl.textContent = 'ZIP-Datei hier ablegen oder klicken';
      showUploadError();
    } finally {
      isProcessing = false;
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => window.GpoLoader.init());
