// ============================================================
// gpo-loader.js – Upload-Zone (Drag & Drop + Klick), entpackt die
// ZIP mit js/jszip.min.js und liest die 5 erwarteten JSON-Dateien
// aus. Fehlt eine Datei, laeuft der Analyzer trotzdem weiter -
// gpo-renderer.js zeigt dann sichtbar, welche Auswertung dadurch
// eingeschraenkt ist. Reicht die rohen JSON-Objekte an
// gpo-parser.js weiter.
// ============================================================
window.GpoLoader = (function() {

  const FILE_TO_KEY = {
    'gpos.json': 'gpos',
    'links.json': 'links',
    'filters.json': 'filters',
    'wmi-filters.json': 'wmiFilters',
    'metadata.json': 'metadata',
  };

  function init() {
    const zone = document.getElementById('gpo-upload-zone');
    const input = document.getElementById('gpo-file-input');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', (e) => {
      if (e.target.files[0]) processFile(e.target.files[0]);
    });
  }

  async function processFile(file) {
    const zone = document.getElementById('gpo-upload-zone');
    try {
      const buffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);

      const raw = {};
      const missingFiles = [];

      for (const filename of Object.keys(FILE_TO_KEY)) {
        const entry = zip.file(filename);
        if (!entry) {
          missingFiles.push(filename);
          continue;
        }
        const text = await entry.async('string');
        raw[FILE_TO_KEY[filename]] = JSON.parse(text);
      }

      if (missingFiles.length === Object.keys(FILE_TO_KEY).length) {
        throw new Error('Keine der erwarteten Dateien (gpos.json, links.json, filters.json, wmi-filters.json, metadata.json) im ZIP gefunden.');
      }

      const model = window.GpoParser.normalize(raw);
      const rules = await window.GpoRules.loadRules();
      const findings = window.GpoAnalyzer.analyze(model, rules);
      await window.GpoRenderer.renderOverview(model, findings, missingFiles);

      zone.classList.add('gpo-upload-zone--done');
      const textEl = zone.querySelector('.gpo-upload-text');
      if (textEl) textEl.textContent = '✅ ' + file.name;

      const results = document.getElementById('gpo-results');
      setTimeout(() => results.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    } catch (err) {
      alert('Fehler beim Lesen der ZIP-Datei: ' + (err.message || err));
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => window.GpoLoader.init());
