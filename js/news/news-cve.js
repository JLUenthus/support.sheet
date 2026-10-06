// ============================================================
// News Curator – CVE-Bericht: Einstellungen + Prompt-Generator (Teil 1)
// ============================================================
// Eigenständiger Modulteil, keine Abhängigkeit vom Feed-Zustand. Logik
// (Datum, Template, Normalisierung) liegt in news-cve-core.js, hier nur
// Persistenz und DOM. Alle Nutzereingaben (Hersteller-/Produktnamen) werden
// ausschließlich über textContent bzw. value dargestellt, nie als HTML.
// Tag-Eingabe pro Hersteller: bestehende Komponente window.NewsTags.
(function () {
  const core = window.NewsCveCore;
  const storage = window.NewsStorage;
  if (!core || !storage) return;

  let fieldSeq = 0;

  function getSettings() {
    return core.normalizeSettings(storage.readJSON(storage.KEYS.cveSettings, null));
  }
  function saveSettings(settings) {
    storage.writeJSON(storage.KEYS.cveSettings, settings);
  }
  function $(id) { return document.getElementById(id); }
  function toast(message, type) {
    if (typeof showToast === 'function') showToast(message, type);
  }

  // ── Prompt-Bereich ───────────────────────────────────────────
  function renderSummary() {
    const settings = getSettings();
    const summary = $('news-cve-summary');
    if (summary) summary.textContent = core.formatSummary(settings, new Date());
    const hasActive = core.countActive(settings) > 0;
    const empty = $('news-cve-empty');
    if (empty) empty.hidden = hasActive;
    const genBtn = $('news-cve-generate-btn');
    if (genBtn) genBtn.disabled = !hasActive;
  }

  // Ein bereits erzeugter Prompt passt nach einer Einstellungsänderung nicht
  // mehr. Statt ihn stehen zu lassen (und versehentlich zu kopieren), wird er
  // verworfen und ein Hinweis gezeigt.
  function markPromptStale() {
    const textarea = $('news-cve-prompt');
    const stale = $('news-cve-stale');
    if (textarea && textarea.value) {
      textarea.value = '';
      const details = $('news-cve-prompt-details');
      if (details) details.open = false;
      if (stale) stale.hidden = false;
    }
    renderSummary();
  }

  function handleGenerate() {
    const result = core.buildCvePrompt(getSettings(), new Date());
    const textarea = $('news-cve-prompt');
    const stale = $('news-cve-stale');
    if (stale) stale.hidden = true;
    renderSummary();
    if (!result.prompt) {
      if (textarea) textarea.value = '';
      return;
    }
    textarea.value = result.prompt;
    const details = $('news-cve-prompt-details');
    if (details) details.open = true;
  }

  function handleCopy() {
    const textarea = $('news-cve-prompt');
    const btn = $('news-cve-copy-btn');
    if (!textarea || !textarea.value) {
      toast('Noch kein Prompt erzeugt', 'warning');
      return;
    }
    const done = () => {
      toast('Prompt kopiert', 'success');
      if (!btn) return;
      const original = btn.textContent;
      btn.textContent = '✓ Kopiert';
      setTimeout(() => { btn.textContent = original; }, 1500);
    };
    const fallback = () => {
      textarea.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      if (ok) done(); else toast('Kopieren nicht möglich, Text ist markiert', 'error');
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(textarea.value).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  // ── Hersteller-Liste ─────────────────────────────────────────
  function updateVendor(vendorId, mutate) {
    const settings = getSettings();
    const vendor = settings.vendors.find(v => v.id === vendorId);
    if (!vendor) return;
    mutate(vendor);
    saveSettings(settings);
    markPromptStale();
  }

  function buildVendorRow(vendor) {
    const seq = ++fieldSeq;
    const row = document.createElement('div');
    row.className = 'news-cve-vendor';
    row.dataset.vendorId = vendor.id;

    const head = document.createElement('div');
    head.className = 'news-cve-vendor-head';

    const toggle = document.createElement('label');
    toggle.className = 'news-cve-vendor-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = vendor.enabled;
    checkbox.addEventListener('change', () => {
      updateVendor(vendor.id, v => { v.enabled = checkbox.checked; });
      row.classList.toggle('news-cve-vendor--off', !checkbox.checked);
    });
    const name = document.createElement('span');
    name.className = 'news-cve-vendor-name';
    name.textContent = vendor.name;
    toggle.append(checkbox, name);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'news-cve-vendor-delete';
    del.textContent = '✕';
    del.title = 'Hersteller löschen';
    del.setAttribute('aria-label', vendor.name + ' löschen');
    del.addEventListener('click', () => {
      if (!confirm('Hersteller „' + vendor.name + '" löschen?')) return;
      const settings = getSettings();
      settings.vendors = settings.vendors.filter(v => v.id !== vendor.id);
      saveSettings(settings);
      renderVendors();
      markPromptStale();
      $('news-cve-vendor-input')?.focus();
    });
    head.append(toggle, del);

    const tagBox = document.createElement('div');
    tagBox.className = 'news-tag-box news-cve-tagbox';
    tagBox.id = 'news-cve-tagbox-' + seq;
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.id = 'news-cve-taginput-' + seq;
    tagInput.className = 'news-tag-input';
    tagInput.placeholder = 'Produkt (Enter oder Komma)…';
    tagInput.setAttribute('aria-label', 'Produkte für ' + vendor.name);
    tagBox.appendChild(tagInput);

    row.classList.toggle('news-cve-vendor--off', !vendor.enabled);
    row.append(head, tagBox);

    // Die Tag-Komponente sucht ihre Elemente per ID im Dokument, daher erst
    // nach dem Einhängen initialisieren (siehe renderVendors).
    row._initTags = () => window.NewsTags?.initTagField({
      boxId: tagBox.id,
      inputId: tagInput.id,
      getValues: () => (getSettings().vendors.find(v => v.id === vendor.id) || { products: [] }).products,
      setValues: arr => updateVendor(vendor.id, v => { v.products = arr; }),
    });
    return row;
  }

  function renderVendors() {
    const list = $('news-cve-vendor-list');
    if (!list) return;
    const settings = getSettings();
    list.replaceChildren();
    const rows = settings.vendors.map(buildVendorRow);
    rows.forEach(r => list.appendChild(r));
    rows.forEach(r => r._initTags());
    if (!settings.vendors.length) {
      const empty = document.createElement('p');
      empty.className = 'news-placeholder';
      empty.textContent = 'Keine Hersteller vorhanden. Füge unten einen hinzu oder setze auf die Startwerte zurück.';
      list.appendChild(empty);
    }
  }

  function uniqueId(name, vendors) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'hersteller';
    let id = base, n = 2;
    while (vendors.some(v => v.id === id)) id = base + '-' + n++;
    return id;
  }

  function handleAddVendor() {
    const input = $('news-cve-vendor-input');
    const name = (input.value || '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const settings = getSettings();
    if (settings.vendors.some(v => v.name.toLowerCase() === name.toLowerCase())) {
      toast('Hersteller existiert bereits', 'warning');
      return;
    }
    settings.vendors.push({ id: uniqueId(name, settings.vendors), name, enabled: true, products: [] });
    saveSettings(settings);
    input.value = '';
    renderVendors();
    markPromptStale();
    input.focus();
  }

  function handleReset() {
    if (!confirm('Hersteller und Produkte auf die Startwerte zurücksetzen? Eigene Änderungen gehen verloren.')) return;
    const settings = getSettings();
    settings.vendors = core.defaultSettings().vendors;
    saveSettings(settings);
    renderVendors();
    markPromptStale();
  }

  function handlePeriodChange(e) {
    const settings = getSettings();
    settings.periodDays = Number(e.target.value);
    saveSettings(core.normalizeSettings(settings));
    markPromptStale();
  }

  function render() {
    const settings = getSettings();
    const select = $('news-cve-period');
    if (select) select.value = String(settings.periodDays);
    renderVendors();
    renderSummary();
    const stale = $('news-cve-stale');
    if (stale) stale.hidden = true;
    const textarea = $('news-cve-prompt');
    if (textarea) textarea.value = '';
  }

  function init() {
    $('news-cve-period')?.addEventListener('change', handlePeriodChange);
    $('news-cve-vendor-add-btn')?.addEventListener('click', handleAddVendor);
    $('news-cve-vendor-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); handleAddVendor(); }
    });
    $('news-cve-reset-btn')?.addEventListener('click', handleReset);
    $('news-cve-generate-btn')?.addEventListener('click', handleGenerate);
    $('news-cve-copy-btn')?.addEventListener('click', handleCopy);
    render();
  }

  document.addEventListener('DOMContentLoaded', init);

  // render(): Backup-Import (news-settings.js). refreshSummary(): news-tabs.js,
  // damit Datum/KW beim Wechsel auf den Reiter aktuell sind (Seite kann über
  // Mitternacht offen geblieben sein).
  window.NewsCve = { render, refreshSummary: renderSummary };
})();
