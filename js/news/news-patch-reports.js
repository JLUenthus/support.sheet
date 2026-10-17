// ============================================================
// News Curator – Patchday-Bericht: Einfügen, Anzeige, Archiv
// ============================================================
// Reine Logik (Vorverarbeitung, Metadaten, Datensatz) liegt in news-patch-core.js, hier nur DOM und
// Persistenz (news.patch.reports). Der Berichtstext ist nicht vertrauenswürdig (KI-Ausgabe aus dem
// Web): gerendert wird ausschließlich über js/safe-markdown.js (eigene marked-Instanz, Whitelist-Kopie
// über ein inertes <template>), nicht über den News-Renderer des CVE-Reiters. Fehlt das Modul,
// erscheint nur Text.
(function () {
  const core = window.NewsPatchCore;
  const storage = window.NewsStorage;
  if (!core || !storage) return;

  let viewedId = null;

  function $(id) { return document.getElementById(id); }
  function toast(message, type) { if (typeof showToast === 'function') showToast(message, type); }

  function getReports() { return core.normalizeReports(storage.readJSON(storage.KEYS.patchReports, [])); }
  // Schreibfehler (voller localStorage) werden gemeldet statt verschluckt.
  function saveReports(list) {
    try {
      storage.writeJSON(storage.KEYS.patchReports, list);
      return { ok: true };
    } catch (err) {
      const quota = !!err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
        || err.code === 22 || err.code === 1014 || /quota/i.test(String(err.message || '')));
      return { ok: false, quota, error: err };
    }
  }
  function currentPatchday() {
    const raw = storage.readJSON(storage.KEYS.patchSettings, null);
    return core.getDates(new Date(), core.normalizeSettings(raw).patchdayOffset).patchday;
  }

  // ── Anzeige ──────────────────────────────────────────────────
  // Markdown nur über SafeMarkdown; Tabellen werden in einen scrollenden Container gesetzt.
  function renderMarkdownInto(container, markdown) {
    if (window.SafeMarkdown) window.SafeMarkdown.renderInto(container, markdown);
    else { const pre = document.createElement('pre'); pre.textContent = markdown; container.replaceChildren(pre); }
    container.querySelectorAll('table').forEach(table => {
      const wrap = document.createElement('div');
      wrap.className = 'news-cve-table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  // ── Meldungen und Rückfragen ─────────────────────────────────
  function showMessage(kind, headline, details) {
    const box = $('news-patch-import-msg');
    box.className = 'news-cve-import-msg news-cve-import-msg--' + kind;
    box.replaceChildren();
    const p = document.createElement('p');
    p.textContent = headline;
    box.appendChild(p);
    if (details && details.length) {
      const ul = document.createElement('ul');
      details.forEach(d => { const li = document.createElement('li'); li.textContent = d; ul.appendChild(li); });
      box.appendChild(ul);
    }
    box.hidden = false;
  }
  function hideMessage() { $('news-patch-import-msg').hidden = true; }

  // Kleine Inline-Auswahl statt verkettetem confirm() (confirm kennt nur zwei Antworten, die Dubletten-Rückfrage braucht drei).
  function showDecision(text, choices) {
    $('news-patch-decision-text').textContent = text;
    const row = $('news-patch-decision-buttons');
    row.replaceChildren();
    choices.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = c.primary ? 'news-btn-primary' : 'news-btn-secondary';
      b.textContent = c.label;
      b.addEventListener('click', () => { hideDecision(); c.run(); });
      row.appendChild(b);
    });
    $('news-patch-decision').hidden = false;
    row.firstElementChild?.focus();
  }
  function hideDecision() { $('news-patch-decision').hidden = true; }

  // ── Einfügen ─────────────────────────────────────────────────
  function startImport() {
    hideMessage();
    hideDecision();
    const prepared = core.preprocessReport($('news-patch-import-text').value, currentPatchday());
    if (prepared.status === 'empty') { showMessage('warn', 'Bitte zuerst den Bericht der KI einfügen.'); return; }
    if (prepared.status === 'no-search') { showMessage('error', prepared.message); return; }
    const tabs = prepared.warnings.find(w => w.code === 'tabs');
    if (tabs) {
      showDecision(tabs.message, [
        { label: 'Trotzdem übernehmen', primary: true, run: () => checkDuplicate(prepared) },
        { label: 'Abbrechen', run: () => {} },
      ]);
      return;
    }
    checkDuplicate(prepared);
  }

  function checkDuplicate(prepared) {
    const existing = getReports().find(r => r.patchday && r.patchday === prepared.meta.patchday);
    if (!existing) { commitReport(prepared, 'add'); return; }
    showDecision(
      `Für den Patchday ${formatDate(existing.patchday)} (${existing.month}) gibt es bereits einen Bericht (${formatImported(existing.importedAt)}). Was soll passieren?`,
      [
        { label: 'Ersetzen', primary: true, run: () => commitReport(prepared, 'replace') },
        { label: 'Zusätzlich behalten', run: () => commitReport(prepared, 'add') },
        { label: 'Abbrechen', run: () => {} },
      ]
    );
  }

  function commitReport(prepared, mode) {
    const record = core.buildReportRecord(prepared, new Date());
    const list = getReports();
    if (mode === 'replace') {
      const i = list.findIndex(r => r.patchday === record.patchday);
      if (i >= 0) list.splice(i, 1);
    }
    list.unshift(record);
    const result = saveReports(list);
    if (!result.ok) {
      showMessage('error', result.quota
        ? 'Speicher voll, ältere Berichte löschen. Der Bericht wurde nicht gespeichert, bestehende Berichte sind unverändert.'
        : 'Der Bericht konnte nicht gespeichert werden: ' + (result.error && result.error.message ? result.error.message : 'unbekannter Fehler'));
      return;
    }
    $('news-patch-import-text').value = '';
    const notes = prepared.warnings.filter(w => w.code !== 'tabs').map(w => w.message);
    if (prepared.warnings.some(w => w.code === 'tabs')) notes.unshift('Die Tabellen wurden als Text eingefügt und werden deshalb nicht als Tabellen dargestellt.');
    showMessage(notes.length ? 'warn' : 'ok', `Bericht ${record.month} übernommen (${record.kbCount} KB-Nummern).`, notes);
    renderArchive();
    openReport(record.id, { scroll: false });
    $('news-patch-import-msg').scrollIntoView({ block: 'nearest' });
  }

  // ── Anzeige ──────────────────────────────────────────────────
  function openReport(id, opts) {
    const report = getReports().find(r => r.id === id);
    if (!report) return;
    viewedId = id;
    $('news-patch-viewer-title').textContent = `Patchday-Bericht ${report.month || ''}`.trim();
    renderMarkdownInto($('news-patch-report'), report.markdown);
    const section = $('news-patch-viewer-section');
    section.hidden = false;
    if (!opts || opts.scroll !== false) {
      section.scrollIntoView({ block: 'start' });
      $('news-patch-viewer-title').focus({ preventScroll: true });
    }
    renderArchive();
  }
  function closeReport() {
    viewedId = null;
    $('news-patch-viewer-section').hidden = true;
    $('news-patch-report').replaceChildren();
    renderArchive();
  }

  // ── Kopieren / Download / Löschen ────────────────────────────
  function copyText(text) {
    const done = () => toast('Markdown kopiert', 'success');
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      document.body.removeChild(ta);
      if (ok) done(); else toast('Kopieren fehlgeschlagen', 'error');
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done).catch(fallback);
    else fallback();
  }

  function downloadReport(report) {
    const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = core.reportFileName(report.patchday);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function deleteReport(report) {
    if (!confirm(`Patchday-Bericht ${report.month || formatDate(report.patchday)} (importiert ${formatImported(report.importedAt)}) löschen?`)) return;
    const list = getReports().filter(r => r.id !== report.id);
    const result = saveReports(list);
    if (!result.ok) { toast('Löschen fehlgeschlagen', 'error'); return; }
    if (viewedId === report.id) closeReport();
    renderArchive();
    toast('Bericht gelöscht', 'success');
  }

  // ── Archiv ───────────────────────────────────────────────────
  function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || 'unbekannt');
  }
  function formatImported(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return iso || 'unbekannt';
    return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function actionButton(label, ariaLabel, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'news-btn-secondary';
    b.textContent = label;
    b.setAttribute('aria-label', ariaLabel);
    b.addEventListener('click', onClick);
    return b;
  }

  function renderArchive() {
    const list = $('news-patch-archive-list');
    const hint = $('news-patch-archive-hint');
    if (!list) return;
    const reports = getReports();
    list.replaceChildren();
    if (hint) {
      hint.hidden = reports.length < 20;
      hint.textContent = `${reports.length} Berichte gespeichert. Es wird nichts automatisch gelöscht, ältere Berichte bei Bedarf selbst löschen.`;
    }
    if (!reports.length) {
      const empty = document.createElement('p');
      empty.className = 'news-placeholder';
      empty.textContent = 'Noch kein Bericht archiviert. So kommst du zum ersten: im Bereich „Prompt“ den Prompt kopieren, in einer KI mit Websuche ausführen und das Ergebnis oben unter „Bericht einfügen“ einfügen.';
      list.appendChild(empty);
      return;
    }
    reports.forEach(report => {
      const item = document.createElement('div');
      item.className = 'news-cve-archive-item' + (report.id === viewedId ? ' news-cve-archive-item--open' : '');
      item.dataset.reportId = report.id;

      const info = document.createElement('div');
      info.className = 'news-cve-archive-info';
      const title = document.createElement('strong');
      title.textContent = report.month || formatDate(report.patchday);
      const meta = document.createElement('span');
      meta.className = 'news-cve-archive-meta';
      meta.textContent = `Patchday ${formatDate(report.patchday)} · ${report.kbCount} KB-Nummern · importiert ${formatImported(report.importedAt)}`;
      info.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'news-cve-archive-actions';
      const label = report.month || formatDate(report.patchday);
      actions.append(
        actionButton('Öffnen', `${label} öffnen`, () => openReport(report.id)),
        actionButton('Markdown kopieren', `${label} als Markdown kopieren`, () => copyText(report.markdown)),
        actionButton('Als .md herunterladen', `${label} als .md herunterladen`, () => downloadReport(report)),
        actionButton('Löschen', `${label} löschen`, () => deleteReport(report))
      );
      item.append(info, actions);
      list.appendChild(item);
    });
  }

  // Nach einem Backup-Import: Archiv neu zeichnen, geöffneten Bericht neu zeichnen oder schließen.
  function render() {
    hideMessage();
    hideDecision();
    const report = viewedId ? getReports().find(r => r.id === viewedId) : null;
    if (viewedId && !report) closeReport();
    else if (report) renderMarkdownInto($('news-patch-report'), report.markdown);
    renderArchive();
  }

  function init() {
    $('news-patch-import-btn')?.addEventListener('click', startImport);
    $('news-patch-viewer-close')?.addEventListener('click', closeReport);
    renderArchive();
  }

  document.addEventListener('DOMContentLoaded', init);
  window.NewsPatchReports = { render };
})();
