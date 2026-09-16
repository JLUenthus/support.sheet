// ============================================================
// News Curator – Datenmodell-Initialisierung (localStorage)
// ============================================================
// Schritt 1 (Fundament): legt beim allerersten Laden alle sechs Keys mit den
// im Plan definierten Leerzuständen an. Existiert ein Key bereits, wird er
// nicht angetastet - kein Zurücksetzen bestehender Nutzerdaten.
//
// Key-Namen folgen bewusst der im Plan (news-sheet-plan.md, Abschnitt
// "Datenmodell") vorgegebenen Punktnotation ("news.settings" etc.), auch wenn
// der Rest des Repos unterschiedliche Präfix-Konventionen ohne Punkte nutzt
// (adminsheet_, supportsheet_, gs-, gpo-) - der Plan ist hier die verbindliche
// Spezifikation.
(function () {
  const KEYS = {
    settings: 'news.settings',
    topics:   'news.topics',
    feedback: 'news.feedback',
    history:  'news.history',
    saved:    'news.saved',
    carried:  'news.carried',
    // news.feed kam erst mit Schritt 6a dazu (die laufende Session wird
    // durchgehend mitgeschrieben statt nur im Speicher gehalten, damit ein
    // Reload während einer offenen Session nichts verliert).
    feed:     'news.feed',
  };

  function todayISO(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }

  function initIfMissing(key, buildDefault) {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify(buildDefault()));
    }
  }

  function initNewsDataModel() {
    initIfMissing(KEYS.settings, () => ({
      customInterests: [],
      excludeKeywords: [],
      sources: [],
      dateFrom: todayISO(-7),
      dateTo: todayISO(0),
      maxArticles: 20,
    }));
    initIfMissing(KEYS.topics, () => []);
    initIfMissing(KEYS.feedback, () => ({ topics: {}, keywords: {}, sources: {} }));
    initIfMissing(KEYS.history, () => ({ seenUrls: [], lastCompletedAt: null }));
    initIfMissing(KEYS.saved, () => []);
    initIfMissing(KEYS.carried, () => []);
    initIfMissing(KEYS.feed, () => ({ articles: [], highlights: [] }));
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  initNewsDataModel();

  // Von späteren Schritten (Quellen/Themen/Einstellungen/Prompt/Feed) sowie
  // von news-nav.js (Badge-Zähler) wiederverwendet, damit Key-Namen und die
  // Persistenz-Logik nur an einer Stelle stehen (keine zweite Persistenz-
  // Schicht pro Feature-Datei). todayISO wird ab Schritt 4 auch von
  // news-settings.js für die Zeitraum-Presets gebraucht.
  window.NewsStorage = { KEYS, readJSON, writeJSON, todayISO };
})();
