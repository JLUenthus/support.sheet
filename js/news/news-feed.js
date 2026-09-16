// ============================================================
// News Curator – Feed: Import, Verifizierung, Anzeige (Schritt 6a)
// ============================================================
// Selbes Grundmuster wie news-sources.js/news-topics.js: lokale
// get/save-Wrapper um NewsStorage.readJSON/writeJSON, renderBoard() nach
// jeder Mutation neu aufgerufen. Nutzt NewsJSON.extractJson (Schritt 3) und
// NewsJSON.normalizeText (hierher erweitert, siehe news-json.js) - keine
// zweite Parser-/Normalisierungs-Implementierung.
//
// Bewertung (👍/👎), Merken, "Nicht relevant", Fortschrittsleiste und
// "Fertig" kommen erst mit Schritt 6b - diese Datei wird dort erweitert,
// nicht durch eine weitere Datei ersetzt.
(function () {
  function getFeed() {
    return window.NewsStorage.readJSON(window.NewsStorage.KEYS.feed, { articles: [], highlights: [] });
  }
  function saveFeed(feed) {
    window.NewsStorage.writeJSON(window.NewsStorage.KEYS.feed, feed);
  }
  function getSettings() {
    return window.NewsStorage.readJSON(window.NewsStorage.KEYS.settings, { dateFrom: '', dateTo: '', maxArticles: 20 });
  }
  function getHistory() {
    return window.NewsStorage.readJSON(window.NewsStorage.KEYS.history, { seenUrls: [], lastCompletedAt: null });
  }

  // ── Strukturelle Verifizierung statt Vertrauen (Edge Case im Plan) ───
  function isValidHttpsUrl(url) {
    try { return new URL(url).protocol === 'https:'; } catch { return false; }
  }
  function urlHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
  }
  function isValidDate(d) {
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
  }

  function verifyArticle(article, settings) {
    const reasons = [];
    const urlOk = isValidHttpsUrl(article.url);
    if (!urlOk) reasons.push('URL ungültig oder kein https');

    const dateOk = isValidDate(article.published_at);
    if (!dateOk) reasons.push('Datum ungültig');
    if (dateOk && (article.published_at < settings.dateFrom || article.published_at > window.NewsStorage.todayISO(0))) {
      reasons.push('Datum außerhalb Zeitraum');
    }

    const host = urlOk ? urlHost(article.url) : null;
    const sourceNorm = String(article.source || '').toLowerCase().replace(/^www\./, '');
    const sourceOk = !!host && !!sourceNorm && (host.includes(sourceNorm) || sourceNorm.includes(host));
    if (!sourceOk) reasons.push('Quelle passt nicht zur URL');

    return { verified: reasons.length === 0, reasons };
  }

  // ── Import ────────────────────────────────────────────────
  function importArticles() {
    const textarea = document.getElementById('news-feed-import');
    if (!textarea) return;
    const raw = textarea.value.trim();
    if (!raw) return;

    let data;
    try {
      data = window.NewsJSON.extractJson(raw);
    } catch (err) {
      alert('Konnte JSON nicht lesen: ' + err.message);
      return;
    }

    const feed = getFeed();
    const settings = getSettings();
    const history = getHistory();
    const saved = window.NewsStorage.readJSON(window.NewsStorage.KEYS.saved, []);
    const carried = window.NewsStorage.readJSON(window.NewsStorage.KEYS.carried, []);

    // Highlights zusammenführen (Edge Case "Mehrfacher Import"): neueste
    // zuerst, gedeckelt auf insgesamt 6, nicht überschrieben.
    const newHighlights = Array.isArray(data.highlights) ? data.highlights : [];
    feed.highlights = [...newHighlights, ...feed.highlights].slice(0, 6);

    // news.carried nur beim ALLERERSTEN Import einer Session vorne anhängen -
    // "erster Import dieser Session" heißt hier: feed.articles war vor diesem
    // Import noch leer. Danach wird carried geleert und wirkt bei weiteren
    // Imports derselben Session nicht mehr (carriedCount-Erhöhung bzw. das
    // endgültige Verschieben nach seenUrls ab 4 Versuchen ist Sache von
    // Schritt 6b/"Fertig", hier nur unverändert durchgereicht).
    let carriedOver = [];
    if (carried.length && feed.articles.length === 0) {
      carriedOver = carried.map(a => ({ ...a, carried: true }));
    }
    if (carried.length) {
      window.NewsStorage.writeJSON(window.NewsStorage.KEYS.carried, []);
    }

    const existingUrls   = new Set([...feed.articles, ...carriedOver].map(a => a.url));
    const existingTitles = new Set([...feed.articles, ...carriedOver].map(a => window.NewsJSON.normalizeText(a.title)));
    const savedUrls = new Set(saved.map(s => s.url));
    const seenUrls  = new Set(history.seenUrls || []);

    const seenUrlsInBatch   = new Set();
    const seenTitlesInBatch = new Set();
    const incoming = Array.isArray(data.articles) ? data.articles : [];

    const fresh = incoming.filter(a => {
      if (!a || !a.url) return false;
      if (seenUrls.has(a.url)) return false;
      if (savedUrls.has(a.url)) return false;
      if (existingUrls.has(a.url)) return false;
      if (seenUrlsInBatch.has(a.url)) return false;
      const key = window.NewsJSON.normalizeText(a.title);
      if (existingTitles.has(key)) return false;
      if (seenTitlesInBatch.has(key)) return false;
      seenUrlsInBatch.add(a.url);
      seenTitlesInBatch.add(key);
      return true;
    })
      // Edge Case "Zu viele Artikel": maxArticles wird im Prompt vorgegeben,
      // zusätzlich clientseitig auf diese Anzahl je Import gecappt.
      .slice(0, settings.maxArticles || undefined)
      .map(a => {
        const check = verifyArticle(a, settings);
        return {
          ...a,
          read: false, vote: 0, notRelevant: false,
          verified: check.verified, checkReasons: check.reasons,
          carried: false, carriedCount: 0,
        };
      });

    feed.articles = [...feed.articles, ...carriedOver, ...fresh];
    saveFeed(feed);
    textarea.value = '';
    renderBoard();
  }

  // ── Artikel öffnen (setzt "gelesen") ──────────────────────
  function markRead(index) {
    const feed = getFeed();
    if (!feed.articles[index]) return;
    feed.articles[index].read = true;
    saveFeed(feed);
    renderBoard();
  }

  // ── Rendering ─────────────────────────────────────────────
  function buildArticleCard(article, index) {
    const card = document.createElement('div');
    card.className = 'news-article' + (article.read ? ' news-article--read' : '');

    if (article.image_url && isValidHttpsUrl(article.image_url)) {
      const img = document.createElement('img');
      img.className = 'news-article-thumb';
      img.src = article.image_url;
      img.alt = '';
      img.loading = 'lazy';
      // Halluzinations-/CDN-Risiko bei Bild-URLs (Edge Case im Plan): kein
      // struktureller Domain-Abgleich wie bei Artikel-URLs, nur https-Check
      // vorab und ein leises Entfernen bei Ladefehler statt kaputtem Icon.
      img.addEventListener('error', () => img.remove());
      card.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'news-article-body';

    const titleLink = document.createElement('a');
    titleLink.className = 'news-article-title';
    titleLink.href = article.url;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = article.title;
    titleLink.addEventListener('click', () => markRead(index));
    body.appendChild(titleLink);

    const meta = document.createElement('div');
    meta.className = 'news-article-meta';
    const metaParts = [article.source, article.published_at];
    if (article.read_time_minutes) metaParts.push(`~${article.read_time_minutes} Min.`);
    meta.appendChild(document.createTextNode(metaParts.filter(Boolean).join(' · ') + ' · '));

    const verifyBadge = document.createElement('span');
    verifyBadge.className = 'news-verify-badge ' + (article.verified ? 'news-verify-badge--ok' : 'news-verify-badge--warn');
    verifyBadge.textContent = article.verified ? 'Plausibel' : 'Auffällig';
    verifyBadge.title = article.verified
      ? 'Strukturell plausibel: gültige https-URL, Datum im Zeitraum, Quelle passt zur URL'
      : (article.checkReasons || []).join(', ');
    meta.appendChild(verifyBadge);

    if (article.carried) {
      meta.appendChild(document.createTextNode(' '));
      const carriedBadge = document.createElement('span');
      carriedBadge.className = 'news-verify-badge news-verify-badge--carried';
      carriedBadge.textContent = 'Übertragen';
      carriedBadge.title = 'Aus der letzten Session nicht angesehen, wurde übernommen';
      meta.appendChild(carriedBadge);
    }
    body.appendChild(meta);

    const summary = document.createElement('p');
    summary.className = 'news-article-summary';
    summary.textContent = article.summary || '';
    body.appendChild(summary);

    if (article.why_relevant) {
      const why = document.createElement('p');
      why.className = 'news-article-why';
      const strong = document.createElement('strong');
      strong.textContent = 'Warum relevant: ';
      why.appendChild(strong);
      why.appendChild(document.createTextNode(article.why_relevant));
      body.appendChild(why);
    }

    card.appendChild(body);
    return card;
  }

  function renderBoard() {
    const board = document.getElementById('news-feed-board');
    if (!board) return;
    const feed = getFeed();
    board.replaceChildren();

    if (feed.highlights && feed.highlights.length) {
      const box = document.createElement('div');
      box.className = 'news-highlights';
      const head = document.createElement('div');
      head.className = 'news-highlights-head';
      head.textContent = 'Kurzüberblick';
      box.appendChild(head);
      feed.highlights.forEach(h => {
        const item = document.createElement('div');
        item.className = 'news-highlight-item';
        item.textContent = h;
        box.appendChild(item);
      });
      board.appendChild(box);
    }

    if (!feed.articles.length) {
      const empty = document.createElement('p');
      empty.className = 'news-placeholder';
      empty.textContent = 'Noch keine Artikel importiert.';
      board.appendChild(empty);
      return;
    }

    const groups = {};
    feed.articles.forEach(a => { (groups[a.topic] = groups[a.topic] || []).push(a); });

    Object.entries(groups).forEach(([topic, articles]) => {
      const group = document.createElement('div');
      group.className = 'news-topic-group';

      const head = document.createElement('div');
      head.className = 'news-topic-group-head';
      const dot = document.createElement('span');
      dot.className = 'news-topic-dot';
      head.appendChild(dot);
      head.appendChild(document.createTextNode(topic));
      const count = document.createElement('span');
      count.className = 'news-topic-group-count';
      count.textContent = articles.length;
      head.appendChild(count);
      group.appendChild(head);

      articles.forEach(a => group.appendChild(buildArticleCard(a, feed.articles.indexOf(a))));
      board.appendChild(group);
    });
  }

  function initFeedSection() {
    document.getElementById('news-feed-import-btn')?.addEventListener('click', importArticles);
    renderBoard();
  }

  document.addEventListener('DOMContentLoaded', initFeedSection);

  // Schritt 4 (Backup-Import) ruft render() nach einem Restore erneut auf,
  // analog zu NewsSources/NewsTopics.
  window.NewsFeed = { render: renderBoard };
})();
