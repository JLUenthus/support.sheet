// ============================================================
// News Curator – Patchday-Bericht: Einstellungen + Prompt-Generator
// ============================================================
// Eigenständig, keine Abhängigkeit vom Feed- oder CVE-Zustand. Logik (Datum, Template,
// Normalisierung) liegt in news-patch-core.js, hier nur Persistenz und DOM. Alle Nutzereingaben
// (Produktnamen und Details) werden ausschließlich über textContent bzw. value dargestellt,
// nie als HTML. Tag-Eingabe der Details pro Produkt: bestehende Komponente window.NewsTags.
(function () {
  const core = window.NewsPatchCore;
  const storage = window.NewsStorage;
  if (!core || !storage) return;

  let fieldSeq = 0;

  function $(id) { return document.getElementById(id); }
  function toast(message, type) { if (typeof showToast === 'function') showToast(message, type); }

  // Lesen ergibt bei kaputtem Inhalt Startwerte, ohne den Key zu überschreiben (geschrieben wird nur durch eine Nutzeraktion).
  function getSettings() { return core.normalizeSettings(storage.readJSON(storage.KEYS.patchSettings, null)); }
  // Speicher voll (QuotaExceededError) und andere Schreibfehler werden gemeldet statt verschluckt.
  function saveSettings(settings) {
    try {
      storage.writeJSON(storage.KEYS.patchSettings, settings);
      return true;
    } catch (err) {
      const quota = !!err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014 || /quota/i.test(String(err.message || '')));
      toast(quota ? 'Speicher voll, Einstellung nicht gespeichert. Ältere Patchday-Berichte löschen.' : 'Einstellung konnte nicht gespeichert werden: ' + (err && err.message ? err.message : 'unbekannter Fehler'), 'error');
      return false;
    }
  }

  function formatDe(iso) { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; }

  // ── Prompt-Bereich ───────────────────────────────────────────
  function renderPatchdaySelect() {
    const select = $('news-patch-offset');
    if (!select) return;
    const settings = getSettings();
    const labels = ['Aktueller Patchday', 'Davor', 'Zwei davor'];
    select.replaceChildren();
    core.patchdayChoices(new Date()).forEach(c => {
      const opt = document.createElement('option');
      opt.value = String(c.offset);
      opt.textContent = `${labels[c.offset]}: ${formatDe(c.patchday)} (${core.monthLabel(c.patchday)})`;
      select.appendChild(opt);
    });
    select.value = String(settings.patchdayOffset);
  }

  function renderSummary() {
    const settings = getSettings();
    const now = new Date();
    const summary = $('news-patch-summary');
    if (summary) summary.textContent = core.formatSummary(settings, now);
    const hint = $('news-patch-hint');
    if (hint) hint.textContent = core.patchdayHint(now);
    renderPatchdaySelect();
    const hasActive = core.countActive(settings) > 0;
    const empty = $('news-patch-empty');
    if (empty) empty.hidden = hasActive;
    const genBtn = $('news-patch-generate-btn');
    if (genBtn) genBtn.disabled = !hasActive;
  }

  // Ein bereits erzeugter Prompt passt nach einer Einstellungsänderung nicht mehr. Statt ihn stehen zu lassen (und versehentlich
  // zu kopieren), wird er verworfen und ein Hinweis gezeigt.
  function markPromptStale() {
    const textarea = $('news-patch-prompt');
    const stale = $('news-patch-stale');
    if (textarea && textarea.value) {
      textarea.value = '';
      const details = $('news-patch-prompt-details');
      if (details) details.open = false;
      if (stale) stale.hidden = false;
    }
    renderSummary();
  }

  function handleGenerate() {
    const result = core.buildPatchPrompt(getSettings(), new Date());
    const textarea = $('news-patch-prompt');
    const stale = $('news-patch-stale');
    if (stale) stale.hidden = true;
    renderSummary();
    if (!result.prompt) {
      if (textarea) textarea.value = '';
      return;
    }
    textarea.value = result.prompt;
    const details = $('news-patch-prompt-details');
    if (details) details.open = true;
  }

  function handleCopy() {
    const textarea = $('news-patch-prompt');
    const btn = $('news-patch-copy-btn');
    if (!textarea || !textarea.value) { toast('Noch kein Prompt erzeugt', 'warning'); return; }
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
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(textarea.value).then(done).catch(fallback);
    else fallback();
  }

  // ── Produktliste ─────────────────────────────────────────────
  function updateProduct(productId, mutate) {
    const settings = getSettings();
    const product = settings.products.find(p => p.id === productId);
    if (!product) return;
    mutate(product);
    if (saveSettings(settings)) markPromptStale();
  }

  function buildProductRow(product) {
    const seq = ++fieldSeq;
    const row = document.createElement('div');
    row.className = 'news-cve-vendor';
    row.dataset.productId = product.id;

    const head = document.createElement('div');
    head.className = 'news-cve-vendor-head';

    const toggle = document.createElement('label');
    toggle.className = 'news-cve-vendor-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = product.enabled;
    checkbox.addEventListener('change', () => {
      updateProduct(product.id, p => { p.enabled = checkbox.checked; });
      row.classList.toggle('news-cve-vendor--off', !checkbox.checked);
    });
    const name = document.createElement('span');
    name.className = 'news-cve-vendor-name';
    name.textContent = product.name;
    toggle.append(checkbox, name);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'news-cve-vendor-delete';
    del.textContent = '✕';
    del.title = 'Produkt löschen';
    del.setAttribute('aria-label', product.name + ' löschen');
    del.addEventListener('click', () => {
      if (!confirm('Produkt „' + product.name + '" löschen?')) return;
      const settings = getSettings();
      settings.products = settings.products.filter(p => p.id !== product.id);
      if (!saveSettings(settings)) return;
      renderProducts();
      markPromptStale();
      $('news-patch-product-input')?.focus();
    });
    head.append(toggle, del);

    const tagBox = document.createElement('div');
    tagBox.className = 'news-tag-box news-cve-tagbox';
    tagBox.id = 'news-patch-tagbox-' + seq;
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.id = 'news-patch-taginput-' + seq;
    tagInput.className = 'news-tag-input';
    tagInput.placeholder = 'Details, z. B. 24H2 (Enter oder Komma)…';
    tagInput.setAttribute('aria-label', 'Details für ' + product.name);
    tagBox.appendChild(tagInput);

    row.classList.toggle('news-cve-vendor--off', !product.enabled);
    row.append(head, tagBox);

    // Die Tag-Komponente sucht ihre Elemente per ID im Dokument, daher erst nach dem Einhängen initialisieren (siehe renderProducts).
    row._initTags = () => window.NewsTags?.initTagField({
      boxId: tagBox.id,
      inputId: tagInput.id,
      getValues: () => (getSettings().products.find(p => p.id === product.id) || { details: [] }).details,
      setValues: arr => updateProduct(product.id, p => { p.details = arr; }),
    });
    return row;
  }

  function renderProducts() {
    const list = $('news-patch-product-list');
    if (!list) return;
    const settings = getSettings();
    list.replaceChildren();
    const rows = settings.products.map(buildProductRow);
    rows.forEach(r => list.appendChild(r));
    rows.forEach(r => r._initTags());
    if (!settings.products.length) {
      const empty = document.createElement('p');
      empty.className = 'news-placeholder';
      empty.textContent = 'Keine Produkte vorhanden. Füge unten eines hinzu oder setze auf die Startwerte zurück.';
      list.appendChild(empty);
    }
  }

  function uniqueId(name, products) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'produkt';
    let id = base, n = 2;
    while (products.some(p => p.id === id)) id = base + '-' + n++;
    return id;
  }

  function handleAddProduct() {
    const input = $('news-patch-product-input');
    const name = (input.value || '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const settings = getSettings();
    if (settings.products.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast('Produkt existiert bereits', 'warning'); return; }
    settings.products.push({ id: uniqueId(name, settings.products), name, enabled: true, details: [] });
    if (!saveSettings(settings)) return;
    input.value = '';
    renderProducts();
    markPromptStale();
    input.focus();
  }

  function handleReset() {
    if (!confirm('Produkte auf die Startwerte zurücksetzen? Eigene Änderungen gehen verloren. Der gewählte Patchday bleibt.')) return;
    const settings = getSettings();
    settings.products = core.defaultSettings().products;
    if (!saveSettings(settings)) return;
    renderProducts();
    markPromptStale();
  }

  function handleOffsetChange(e) {
    const settings = getSettings();
    settings.patchdayOffset = Number(e.target.value);
    if (saveSettings(core.normalizeSettings(settings))) markPromptStale();
    else renderPatchdaySelect();
  }

  function render() {
    renderProducts();
    renderSummary();
    const stale = $('news-patch-stale');
    if (stale) stale.hidden = true;
    const textarea = $('news-patch-prompt');
    if (textarea) textarea.value = '';
  }

  function init() {
    $('news-patch-offset')?.addEventListener('change', handleOffsetChange);
    $('news-patch-product-add-btn')?.addEventListener('click', handleAddProduct);
    $('news-patch-product-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleAddProduct(); } });
    $('news-patch-reset-btn')?.addEventListener('click', handleReset);
    $('news-patch-generate-btn')?.addEventListener('click', handleGenerate);
    $('news-patch-copy-btn')?.addEventListener('click', handleCopy);
    render();
  }

  document.addEventListener('DOMContentLoaded', init);

  // render(): Backup-Import (news-settings.js). refreshSummary(): news-tabs.js, damit Datum und Hinweis beim Wechsel auf den Reiter
  // aktuell sind (Seite kann über Mitternacht offen geblieben sein).
  window.NewsPatch = { render, refreshSummary: renderSummary };
})();
