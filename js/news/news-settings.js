// ============================================================
// News Curator – Einstellungen (Schritt 4)
// ============================================================
// Selbes Grundmuster wie news-sources.js/news-topics.js: lokale
// get/save-Wrapper um NewsStorage.readJSON/writeJSON, render*()-Funktionen
// nach jeder Mutation neu aufgerufen. Datei-Export/Import orientiert sich an
// tools.js (Backup exportieren/importieren dort: Blob+createObjectURL zum
// Download, verstecktes <input type="file"> + FileReader zum Einlesen,
// showToast() aus js/toast.js für Erfolg/Fehler) - dieselben Konventionen,
// nur auf die sechs news.*-Keys statt supportsheet_settings angewendet.
(function () {
  const MIN_VOTES_FOR_WEIGHT = 3;

  function getSettings() {
    return window.NewsStorage.readJSON(window.NewsStorage.KEYS.settings, {
      customInterests: [], excludeKeywords: [], sources: [],
      dateFrom: '', dateTo: '', maxArticles: 20,
    });
  }
  function saveSettings(settings) {
    window.NewsStorage.writeJSON(window.NewsStorage.KEYS.settings, settings);
  }
  function getHistory() {
    return window.NewsStorage.readJSON(window.NewsStorage.KEYS.history, { seenUrls: [], lastCompletedAt: null });
  }

  // ── Tag-Felder (Interessen / Ausschluss-Keywords) ────────────
  // "bereits benutzte Werte" als Vorschläge sind für Interessen nicht sinnvoll
  // definierbar (kein Verlauf/keine Quelle dafür im Datenmodell) - stattdessen
  // (Prompt 10, UI-Feinschliff) eine kleine, feste Starter-Vorschlagsliste
  // analog zu Ausschluss-Keywords, damit das Feld nicht unfertig wirkt.
  let interestsField = null;
  let excludeField = null;

  // Prompt 19: Ausschluss-Keywords bekommen eine eigene, kategorisierte
  // Vorschlagsdarstellung (siehe renderExcludeCategories) statt der flachen
  // Vorschlags-Pillen-Reihe von initTagField - deshalb hier bewusst KEINE
  // suggestions/suggestionsId mehr übergeben, nur noch Chips + Eingabe.
  // Kein Aktiv/Inaktiv-Konzept wie bei Quellen/Themen: ein Keyword ist
  // einfach in excludeKeywords enthalten oder nicht.
  function initTagFields() {
    interestsField = window.NewsTags.initTagField({
      boxId: 'news-interests-tagbox',
      inputId: 'news-interests-input',
      suggestionsId: 'news-interests-suggestions',
      suggestions: ['PowerShell', 'Automatisierung', 'Security', 'Cloud'],
      getValues: () => getSettings().customInterests || [],
      setValues: (values) => { const s = getSettings(); s.customInterests = values; saveSettings(s); },
    });
    excludeField = window.NewsTags.initTagField({
      boxId: 'news-exclude-tagbox',
      inputId: 'news-exclude-input',
      getValues: () => getSettings().excludeKeywords || [],
      setValues: (values) => { const s = getSettings(); s.excludeKeywords = values; saveSettings(s); },
    });
  }

  // ── Ausschluss-Keywords: kategorisierte Vorschläge (Prompt 19) ───
  // Ersetzt die bisherigen sechs flachen Einzelvorschläge. Wächst auf 32
  // Begriffe in vier Kategorien, deshalb je Kategorie ein einklappbarer
  // Bereich (dasselbe <details>/<summary>-Muster wie die ausklappbaren
  // Prompt-Textfelder aus Prompt 10, .news-prompt-details/-summary
  // wiederverwendet) statt einer einzigen langen Pillen-Reihe.
  const EXCLUDE_KEYWORD_CATEGORIES = [
    {
      name: 'Kommerzielle Inhalte',
      keywords: ['Kaufberatung', 'Kaufempfehlung', 'Angebote', 'Rabatte', 'Rabattcode', 'Gutschein', 'Preisvergleich', 'Deals', 'Schnäppchen', 'Affiliate'],
    },
    {
      name: 'Werbung / PR',
      keywords: ['gesponsert', 'Sponsored', 'Anzeige', 'Werbung', 'Advertorial', 'Pressemitteilung', 'PR', 'Promotion', 'Markenbotschafter'],
    },
    {
      name: 'Content-Füller',
      keywords: ['Die besten', 'Top 10', 'Ranking', 'Ratgeber', 'Tipps', 'Produktvergleich', 'Testbericht'],
    },
    {
      name: 'Eigenwerbung / Sonstiges',
      keywords: ['Gewinnspiel', 'Newsletter', 'Podcast', 'Veranstaltung', 'Webinar', 'Stellenanzeige'],
    },
  ];

  function toggleExcludeKeyword(keyword) {
    const s = getSettings();
    const values = s.excludeKeywords || [];
    const isOn = values.some(v => v.toLowerCase() === keyword.toLowerCase());
    s.excludeKeywords = isOn ? values.filter(v => v.toLowerCase() !== keyword.toLowerCase()) : [...values, keyword];
    saveSettings(s);
    renderExcludeCategories();
    excludeField?.render();
  }

  // "Alle auswählen"/"Alle abwählen" wirken auf die gesamte Kategorie auf
  // einmal, statt jedes Keyword einzeln anklicken zu müssen.
  function setExcludeCategory(keywords, shouldInclude) {
    const s = getSettings();
    let values = s.excludeKeywords || [];
    if (shouldInclude) {
      keywords.forEach(k => {
        if (!values.some(v => v.toLowerCase() === k.toLowerCase())) values = [...values, k];
      });
    } else {
      const lower = new Set(keywords.map(k => k.toLowerCase()));
      values = values.filter(v => !lower.has(v.toLowerCase()));
    }
    s.excludeKeywords = values;
    saveSettings(s);
    renderExcludeCategories();
    excludeField?.render();
  }

  function buildExcludeCategory(category) {
    const values = getSettings().excludeKeywords || [];

    const details = document.createElement('details');
    details.className = 'news-prompt-details news-exclude-category';

    const summary = document.createElement('summary');
    summary.className = 'news-prompt-summary';
    summary.textContent = `${category.name} (${category.keywords.length})`;
    details.appendChild(summary);

    const actions = document.createElement('div');
    actions.className = 'news-btn-row';
    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.className = 'news-btn-secondary';
    selectAllBtn.textContent = 'Alle auswählen';
    selectAllBtn.addEventListener('click', () => setExcludeCategory(category.keywords, true));
    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.type = 'button';
    deselectAllBtn.className = 'news-btn-secondary';
    deselectAllBtn.textContent = 'Alle abwählen';
    deselectAllBtn.addEventListener('click', () => setExcludeCategory(category.keywords, false));
    actions.appendChild(selectAllBtn);
    actions.appendChild(deselectAllBtn);
    details.appendChild(actions);

    const pills = document.createElement('div');
    pills.className = 'news-tag-suggestions';
    category.keywords.forEach(k => {
      const isOn = values.some(v => v.toLowerCase() === k.toLowerCase());
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'news-tag-suggestion' + (isOn ? ' news-tag-suggestion--on' : '');
      pill.textContent = k;
      pill.addEventListener('click', () => toggleExcludeKeyword(k));
      pills.appendChild(pill);
    });
    details.appendChild(pills);

    return details;
  }

  function renderExcludeCategories() {
    const container = document.getElementById('news-exclude-categories');
    if (!container) return;
    // open-Zustand je Kategorie über einen Rebuild hinweg erhalten, sonst
    // klappt jede Änderung (auch nur ein Pill-Klick) alle Kategorien wieder zu.
    const openNames = new Set(
      [...container.querySelectorAll('details[open]')].map(d => d.querySelector('summary')?.textContent)
    );
    container.replaceChildren();
    EXCLUDE_KEYWORD_CATEGORIES.forEach(category => {
      const el = buildExcludeCategory(category);
      if (openNames.has(`${category.name} (${category.keywords.length})`)) el.open = true;
      container.appendChild(el);
    });
  }

  // ── Zeitraum ──────────────────────────────────────────────
  function applyDatePreset(kind) {
    const settings = getSettings();
    const todayISO = window.NewsStorage.todayISO;
    const to = todayISO(0);
    let from;
    if (kind === 'since_last') {
      const history = getHistory();
      from = history.lastCompletedAt ? history.lastCompletedAt.slice(0, 10) : todayISO(-7);
    } else if (kind === '24h') {
      from = todayISO(-1);
    } else {
      from = todayISO(-7);
    }
    settings.dateFrom = from;
    settings.dateTo = to;
    saveSettings(settings);
    renderDateFields();
  }

  function renderDateFields() {
    const settings = getSettings();
    const dateFrom = document.getElementById('news-date-from');
    const dateTo = document.getElementById('news-date-to');
    const maxArticles = document.getElementById('news-max-articles');
    if (dateFrom) dateFrom.value = settings.dateFrom || '';
    if (dateTo) dateTo.value = settings.dateTo || '';
    if (maxArticles) maxArticles.value = settings.maxArticles ?? 20;

    const hint = document.getElementById('news-last-run-hint');
    if (hint) {
      const history = getHistory();
      hint.textContent = history.lastCompletedAt
        ? `Letzter Abschluss: ${new Date(history.lastCompletedAt).toLocaleString('de-DE')}`
        : 'Noch kein abgeschlossener Durchlauf, „Seit letztem Mal" fällt aktuell auf 7 Tage zurück.';
    }
  }

  function initDateAndArticleFields() {
    document.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => applyDatePreset(btn.dataset.preset));
    });
    document.getElementById('news-date-from')?.addEventListener('change', e => {
      const s = getSettings(); s.dateFrom = e.target.value; saveSettings(s);
    });
    document.getElementById('news-date-to')?.addEventListener('change', e => {
      const s = getSettings(); s.dateTo = e.target.value; saveSettings(s);
    });
    document.getElementById('news-max-articles')?.addEventListener('change', e => {
      const s = getSettings();
      const val = parseInt(e.target.value, 10);
      s.maxArticles = isNaN(val) ? s.maxArticles : val;
      saveSettings(s);
    });
    renderDateFields();
  }

  // ── Gelerntes Feedback ────────────────────────────────────
  function renderFeedbackOverview() {
    const container = document.getElementById('news-feedback-overview');
    if (!container) return;
    const feedback = window.NewsStorage.readJSON(window.NewsStorage.KEYS.feedback, { topics: {}, keywords: {}, sources: {} });
    const groups = [
      { label: 'Themen', bucket: feedback.topics || {} },
      { label: 'Schlagworte', bucket: feedback.keywords || {} },
      { label: 'Quellen', bucket: feedback.sources || {} },
    ];

    container.replaceChildren();
    let anyEntries = false;

    groups.forEach(g => {
      const entries = Object.entries(g.bucket)
        .map(([name, v]) => ({ name, score: (v.likes || 0) - (v.dislikes || 0), total: (v.likes || 0) + (v.dislikes || 0) }))
        .sort((a, b) => b.total - a.total);
      if (!entries.length) return;
      anyEntries = true;

      const group = document.createElement('div');
      group.className = 'news-feedback-group';
      const head = document.createElement('div');
      head.className = 'news-feedback-group-head';
      head.textContent = g.label;
      group.appendChild(head);

      entries.forEach(e => {
        const pending = e.total < MIN_VOTES_FOR_WEIGHT;
        const row = document.createElement('div');
        row.className = 'news-feedback-row' + (pending ? ' news-feedback-row--pending' : e.score > 0 ? ' news-feedback-row--pos' : e.score < 0 ? ' news-feedback-row--neg' : '');
        const nameEl = document.createElement('span');
        nameEl.textContent = e.name;
        const scoreEl = document.createElement('span');
        scoreEl.className = 'news-feedback-score';
        scoreEl.textContent = `${e.score > 0 ? '+' : ''}${e.score} (${e.total} Bewertung${e.total === 1 ? '' : 'en'})` + (pending ? ' · noch nicht berücksichtigt' : '');
        row.appendChild(nameEl);
        row.appendChild(scoreEl);
        group.appendChild(row);
      });
      container.appendChild(group);
    });

    if (!anyEntries) {
      const empty = document.createElement('p');
      empty.className = 'news-placeholder';
      empty.textContent = 'Noch kein Feedback aus abgeschlossenen Sessions.';
      container.appendChild(empty);
    }
  }

  // ── Sichern & wiederherstellen ────────────────────────────
  function exportBackup() {
    const KEYS = window.NewsStorage.KEYS;
    const payload = {
      version: '1.0',
      app: 'News Curator',
      exportedAt: new Date().toISOString(),
      settings: window.NewsStorage.readJSON(KEYS.settings, {}),
      topics: window.NewsStorage.readJSON(KEYS.topics, []),
      feedback: window.NewsStorage.readJSON(KEYS.feedback, {}),
      history: window.NewsStorage.readJSON(KEYS.history, {}),
      saved: window.NewsStorage.readJSON(KEYS.saved, []),
      carried: window.NewsStorage.readJSON(KEYS.carried, []),
      // news.feed kam erst mit Schritt 6a dazu, siehe news-storage.js.
      feed: window.NewsStorage.readJSON(KEYS.feed, { articles: [], highlights: [] }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `news-curator-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('Backup exportiert', 'success');
  }

  function importBackupFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!confirm('Backup importieren? Der aktuelle Stand wird ersetzt und kann nicht wiederhergestellt werden.')) {
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || typeof data !== 'object') throw new Error('Ungültiges Format');

        const KEYS = window.NewsStorage.KEYS;
        if (data.settings && typeof data.settings === 'object') window.NewsStorage.writeJSON(KEYS.settings, data.settings);
        if (Array.isArray(data.topics)) window.NewsStorage.writeJSON(KEYS.topics, data.topics);
        if (data.feedback && typeof data.feedback === 'object') window.NewsStorage.writeJSON(KEYS.feedback, data.feedback);
        if (data.history && typeof data.history === 'object') window.NewsStorage.writeJSON(KEYS.history, data.history);
        if (Array.isArray(data.saved)) window.NewsStorage.writeJSON(KEYS.saved, data.saved);
        if (Array.isArray(data.carried)) window.NewsStorage.writeJSON(KEYS.carried, data.carried);
        if (data.feed && typeof data.feed === 'object') window.NewsStorage.writeJSON(KEYS.feed, data.feed);

        // Alle betroffenen Render-Funktionen sofort erneut aufrufen - kein
        // manueller Reload nötig (Vorgabe Schritt 4, um Schritt 6a Feed und
        // Schritt 7 Später-lesen/Nav-Zähler ergänzt).
        window.NewsSources?.render();
        window.NewsTopics?.render();
        window.NewsFeed?.render();
        window.NewsSaved?.render();
        window.NewsNav?.updateSavedBadge();
        renderDateFields();
        renderFeedbackOverview();
        interestsField?.render();
        excludeField?.render();
        renderExcludeCategories();

        if (typeof showToast === 'function') showToast('Backup importiert', 'success');
      } catch (err) {
        if (typeof showToast === 'function') showToast('Import fehlgeschlagen: ' + err.message, 'error');
        else alert('Import fehlgeschlagen: ' + err.message);
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  function initBackup() {
    const fileInput = document.getElementById('news-backup-file');
    document.getElementById('news-backup-export-btn')?.addEventListener('click', exportBackup);
    document.getElementById('news-backup-import-btn')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => importBackupFile(fileInput));
  }

  function initSettingsSection() {
    initTagFields();
    renderExcludeCategories();
    initDateAndArticleFields();
    renderFeedbackOverview();
    initBackup();
  }

  document.addEventListener('DOMContentLoaded', initSettingsSection);

  // Schritt 6b ("Fertig") ruft renderFeedbackOverview() erneut auf, sonst
  // zeigt das Panel bis zum nächsten Reload veraltete Zahlen.
  window.NewsSettings = { renderFeedbackOverview };
})();
