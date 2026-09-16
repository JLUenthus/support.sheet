// ============================================================
// News Curator – Feed: Import, Verifizierung, Anzeige (Schritt 6a)
// + Bewerten, Merken, Nicht relevant, Fortschritt, Fertig (Schritt 6b)
// ============================================================
// Selbes Grundmuster wie news-sources.js/news-topics.js: lokale
// get/save-Wrapper um NewsStorage.readJSON/writeJSON, refreshFeedUI() nach
// jeder Mutation neu aufgerufen. Nutzt NewsJSON.extractJson (Schritt 3) und
// NewsJSON.normalizeText - keine zweite Parser-/Normalisierungs-
// Implementierung.
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
  function getSaved() {
    return window.NewsStorage.readJSON(window.NewsStorage.KEYS.saved, []);
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

  // Edge Case "Markdown-verpackte URLs" (Bugfix nach Abschluss aller 8
  // Schritte): manche KI-Tools mit Websuche/Zitierfunktion liefern url/
  // image_url trotz expliziter Prompt-Regel als Markdown-Link zurück, z. B.
  // "[https://a.de/x](https://a.de/x)". Erkennt genau dieses Muster und
  // schält die eigentliche URL heraus, sonst der String unverändert
  // (nur getrimmt) zurück. Nachtrag: nur bereinigen, wenn Klammer- und
  // Rundklammer-URL exakt identisch sind - bei Abweichung wäre unklar,
  // welche der beiden echt ist, dann lieber unverändert lassen und über die
  // normale https-Validierung als "Auffällig" auffallen, statt zu raten.
  function stripMarkdownLink(str) {
    if (typeof str !== 'string') return str;
    const trimmed = str.trim();
    const match = trimmed.match(/^\[(https?:\/\/[^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (match && match[1] === match[2]) return match[1];
    return trimmed;
  }

  function verifyArticle(article, settings) {
    const reasons = [];
    const urlOk = isValidHttpsUrl(article.url);
    if (!urlOk) reasons.push('URL ungültig oder kein https');

    const dateOk = isValidDate(article.published_at);
    if (!dateOk) reasons.push('Datum ungültig');
    // Bugfix: Obergrenze muss gegen das eingestellte dateTo prüfen, nicht
    // gegen "heute" - sonst rutscht bei einem bewusst historischen Zeitraum
    // (z.B. Von 01.09./Bis 10.09.) ein Artikel vom 15.09. durch, weil er
    // nicht "in der Zukunft" liegt. Fallback auf todayISO(0) nur falls
    // dateTo ausnahmsweise fehlt/leer ist.
    const dateTo = settings.dateTo || window.NewsStorage.todayISO(0);
    if (dateOk && (article.published_at < settings.dateFrom || article.published_at > dateTo)) {
      reasons.push('Datum außerhalb Zeitraum');
    }

    const host = urlOk ? urlHost(article.url) : null;
    const sourceNorm = String(article.source || '').toLowerCase().replace(/^www\./, '');
    const sourceOk = !!host && !!sourceNorm && (host.includes(sourceNorm) || sourceNorm.includes(host));
    if (!sourceOk) reasons.push('Quelle passt nicht zur URL');

    return { verified: reasons.length === 0, reasons };
  }

  // Ein Artikel gilt als erledigt: gelesen ODER bewertet ODER "nicht
  // relevant" markiert ODER gemerkt (Plan-Abschnitt "Fertig"-Button).
  // Eine Funktion, von Fortschrittsleiste UND finishSession() gleichermaßen
  // genutzt, damit beide Stellen exakt dieselbe Definition verwenden.
  function isArticleDone(article, savedUrls) {
    return !!(article.read || article.vote !== 0 || article.notRelevant || savedUrls.has(article.url));
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
    const saved = getSaved();
    const carried = window.NewsStorage.readJSON(window.NewsStorage.KEYS.carried, []);

    // Highlights zusammenführen (Edge Case "Mehrfacher Import"): neueste
    // zuerst, gedeckelt auf insgesamt 6, nicht überschrieben.
    const newHighlights = Array.isArray(data.highlights) ? data.highlights : [];
    feed.highlights = [...newHighlights, ...feed.highlights].slice(0, 6);

    // news.carried nur beim ALLERERSTEN Import einer Session vorne anhängen -
    // "erster Import dieser Session" heißt hier: feed.articles war vor diesem
    // Import noch leer. Danach wird carried geleert und wirkt bei weiteren
    // Imports derselben Session nicht mehr.
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
        // Bereinigung VOR verifyArticle, sonst zeigt ein an sich seriöser
        // Artikel nur wegen der Markdown-Verpackung fälschlich "Auffällig".
        const cleaned = { ...a, url: stripMarkdownLink(a.url), image_url: stripMarkdownLink(a.image_url) };
        const check = verifyArticle(cleaned, settings);
        return {
          ...cleaned,
          read: false, vote: 0, notRelevant: false,
          verified: check.verified, checkReasons: check.reasons,
          carried: false, carriedCount: 0,
        };
      });

    feed.articles = [...feed.articles, ...carriedOver, ...fresh];
    saveFeed(feed);
    textarea.value = '';
    refreshFeedUI();
  }

  // ── Artikel-Interaktionen (Schritt 6b) ───────────────────────
  function markRead(index) {
    const feed = getFeed();
    if (!feed.articles[index]) return;
    feed.articles[index].read = true;
    saveFeed(feed);
    refreshFeedUI();
  }

  // Klick setzt vote auf 1/-1, erneuter Klick auf denselben Wert setzt
  // zurück auf 0 (Toggle), siehe Artikelstatus im Plan.
  function toggleVote(index, value) {
    const feed = getFeed();
    const article = feed.articles[index];
    if (!article) return;
    article.vote = article.vote === value ? 0 : value;
    saveFeed(feed);
    refreshFeedUI();
  }

  // Merken ist unabhängig von vote - ein vollständiger Snapshot landet in
  // news.saved (Schritt 7 zeigt die Liste an, hier nur Schreib-/Toggle-Logik).
  function toggleSave(index) {
    const feed = getFeed();
    const article = feed.articles[index];
    if (!article) return;
    let saved = getSaved();
    if (saved.some(s => s.url === article.url)) {
      saved = saved.filter(s => s.url !== article.url);
    } else {
      saved.push({
        title: article.title, url: article.url, source: article.source, topic: article.topic,
        tags: article.tags, summary: article.summary, published_at: article.published_at,
        image_url: article.image_url, why_relevant: article.why_relevant, read_time_minutes: article.read_time_minutes,
        verified: article.verified, checkReasons: article.checkReasons,
        savedAt: new Date().toISOString(),
      });
    }
    window.NewsStorage.writeJSON(window.NewsStorage.KEYS.saved, saved);
    refreshFeedUI();
    // Schritt 7: Später-lesen-Liste + Nav-Zähler sofort mit aktualisieren,
    // ohne dass man erst zur Später-lesen-Sektion navigiert oder neu lädt
    // (derselbe Cross-Modul-Aufruf wie "Fertig" -> Feedback-Panel in 6b).
    window.NewsSaved?.render();
    window.NewsNav?.updateSavedBadge();
  }

  // "Nicht relevant" ist bewusst KEIN Dislike (siehe Artikelstatus im Plan):
  // sagt nur "gerade kein Interesse", berührt news.feedback nicht, im
  // Unterschied zu vote===-1, das dauerhaft lernt.
  function toggleNotRelevant(index) {
    const feed = getFeed();
    const article = feed.articles[index];
    if (!article) return;
    article.notRelevant = !article.notRelevant;
    saveFeed(feed);
    refreshFeedUI();
  }

  // ── Rendering: Artikel-Karte ──────────────────────────────
  function buildArticleCard(article, index, savedUrls) {
    const card = document.createElement('div');
    card.className = 'news-article'
      + (article.read ? ' news-article--read' : '')
      + (article.notRelevant ? ' news-article--dismissed' : '');

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
    // "Öffnen" absichern (Bugfix Markdown-verpackte URLs): trotz Bereinigung
    // beim Import und trotz Verifizierung hier noch einmal explizit prüfen,
    // statt dem nativen href-Klick blind zu vertrauen - sonst landet ein
    // kaputter String als relativer Pfad auf der eigenen Domain (404) statt
    // beim echten Artikel.
    titleLink.addEventListener('click', e => {
      e.preventDefault();
      if (!isValidHttpsUrl(article.url)) {
        if (typeof showToast === 'function') showToast('Ungültige URL, Artikel kann nicht geöffnet werden.', 'error');
        return;
      }
      markRead(index);
      window.open(article.url, '_blank', 'noopener,noreferrer');
    });
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

    // "Nicht relevant" - dezenter Link, unabhängig von vote/Merken.
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'news-dismiss-btn' + (article.notRelevant ? ' news-dismiss-btn--active' : '');
    dismissBtn.textContent = article.notRelevant ? 'Nicht relevant ✕' : 'Nicht relevant';
    dismissBtn.addEventListener('click', () => toggleNotRelevant(index));
    body.appendChild(dismissBtn);

    card.appendChild(body);

    // Bewerten (👍/👎) + Merken - drei unabhängige Buttons.
    const actions = document.createElement('div');
    actions.className = 'news-article-actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'news-vote-btn news-vote-btn--up' + (article.vote === 1 ? ' news-vote-btn--active' : '');
    upBtn.title = 'Interessant';
    upBtn.setAttribute('aria-label', 'Als interessant bewerten');
    upBtn.textContent = '👍';
    upBtn.addEventListener('click', () => toggleVote(index, 1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'news-vote-btn news-vote-btn--down' + (article.vote === -1 ? ' news-vote-btn--active' : '');
    downBtn.title = 'Nicht interessant';
    downBtn.setAttribute('aria-label', 'Als nicht interessant bewerten');
    downBtn.textContent = '👎';
    downBtn.addEventListener('click', () => toggleVote(index, -1));

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'news-vote-btn news-vote-btn--save' + (savedUrls.has(article.url) ? ' news-vote-btn--active' : '');
    saveBtn.title = 'Für später merken';
    saveBtn.setAttribute('aria-label', 'Für später merken');
    saveBtn.textContent = '🔖';
    saveBtn.addEventListener('click', () => toggleSave(index));

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(saveBtn);
    card.appendChild(actions);

    return card;
  }

  function renderBoard() {
    const board = document.getElementById('news-feed-board');
    if (!board) return;
    const feed = getFeed();
    const savedUrls = new Set(getSaved().map(s => s.url));
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

      articles.forEach(a => group.appendChild(buildArticleCard(a, feed.articles.indexOf(a), savedUrls)));
      board.appendChild(group);
    });
  }

  // ── Session-Übersicht (Schritt 6b) ───────────────────────────
  // Bewusst "Interessant"/"Nicht interessant" statt "Nicht relevant" als
  // Spaltentitel: vote===-1 ist etwas anderes als das separate notRelevant-
  // Feld (siehe Artikelstatus im Plan) - dieselbe Formulierung für beide
  // hätte die beiden unabhängigen Mechanismen im UI vermischt.
  function renderSessionSummary() {
    const el = document.getElementById('news-session-summary');
    if (!el) return;
    const feed = getFeed();
    const liked = feed.articles.filter(a => a.vote === 1);
    const disliked = feed.articles.filter(a => a.vote === -1);
    el.replaceChildren();
    if (!liked.length && !disliked.length) return;

    const inner = document.createElement('div');
    inner.className = 'news-session-summary-inner';

    function buildCol(label, modifier, items) {
      const col = document.createElement('div');
      col.className = 'news-summary-col';
      const head = document.createElement('div');
      head.className = 'news-summary-head news-summary-head--' + modifier;
      head.textContent = `${label} · ${items.length}`;
      col.appendChild(head);
      items.forEach(a => {
        const item = document.createElement('div');
        item.className = 'news-summary-item';
        item.textContent = a.title;
        col.appendChild(item);
      });
      return col;
    }

    inner.appendChild(buildCol('Interessant', 'like', liked));
    inner.appendChild(buildCol('Nicht interessant', 'dislike', disliked));
    el.appendChild(inner);
  }

  // ── Fortschrittsleiste (Schritt 6b) ───────────────────────────
  function renderProgressBar() {
    const bar = document.getElementById('news-progress-bar');
    if (!bar) return;
    const feed = getFeed();
    const total = feed.articles.length;
    if (total === 0) { bar.hidden = true; return; }
    const savedUrls = new Set(getSaved().map(s => s.url));
    const done = feed.articles.filter(a => isArticleDone(a, savedUrls)).length;
    const countEl = document.getElementById('news-progress-count');
    if (countEl) countEl.textContent = `${done} erledigt · ${total - done} offen`;
    bar.hidden = false;
  }

  function refreshFeedUI() {
    renderBoard();
    renderProgressBar();
    renderSessionSummary();
  }

  // ── "Fertig" (Schritt 6b) ─────────────────────────────────────
  function finishSession() {
    const feed = getFeed();
    if (!feed.articles.length) return;

    const feedback = window.NewsStorage.readJSON(window.NewsStorage.KEYS.feedback, { topics: {}, keywords: {}, sources: {} });
    const history = getHistory();
    const savedUrls = new Set(getSaved().map(s => s.url));

    function bump(bucket, key, isLike) {
      if (!key) return;
      if (!bucket[key]) bucket[key] = { likes: 0, dislikes: 0 };
      if (isLike) bucket[key].likes++; else bucket[key].dislikes++;
    }

    let readCount = 0, votedCount = 0, notRelevantCount = 0, carriedOverCount = 0;
    const newSeenUrls = [];
    const newCarried = [];

    feed.articles.forEach(a => {
      if (a.vote !== 0) {
        votedCount++;
        const isLike = a.vote === 1;
        bump(feedback.topics, a.topic, isLike);
        (a.tags || []).forEach(tag => bump(feedback.keywords, tag, isLike));
        bump(feedback.sources, a.source, isLike);
      }
      if (a.read) readCount++;
      if (a.notRelevant) notRelevantCount++;

      if (isArticleDone(a, savedUrls)) {
        newSeenUrls.push(a.url);
      } else {
        // Wirklich unberührter Artikel: carriedCount erhöhen, ab >3
        // (also nach 3 übersprungenen Sessions) doch nach seenUrls.
        const nextCount = (a.carriedCount || 0) + 1;
        if (nextCount > 3) {
          newSeenUrls.push(a.url);
        } else {
          newCarried.push({ ...a, read: false, vote: 0, notRelevant: false, carriedCount: nextCount });
          carriedOverCount++;
        }
      }
    });

    window.NewsStorage.writeJSON(window.NewsStorage.KEYS.feedback, feedback);

    // seenUrls: Cap bei ~500 Einträgen, älteste zuerst raus (Datenmodell im Plan).
    const combinedSeen = [...(history.seenUrls || []), ...newSeenUrls];
    history.seenUrls = combinedSeen.slice(Math.max(0, combinedSeen.length - 500));
    history.lastCompletedAt = new Date().toISOString();
    window.NewsStorage.writeJSON(window.NewsStorage.KEYS.history, history);

    window.NewsStorage.writeJSON(window.NewsStorage.KEYS.carried, newCarried);
    saveFeed({ articles: [], highlights: [] });

    if (typeof showToast === 'function') {
      const parts = [`${readCount} gelesen`, `${votedCount} bewertet`];
      if (notRelevantCount) parts.push(`${notRelevantCount} nicht relevant markiert`);
      if (carriedOverCount) parts.push(`${carriedOverCount} für nächstes Mal übernommen`);
      showToast(parts.join(', '), 'success');
    }

    refreshFeedUI();
    // Zeigt sonst bis zum nächsten Reload veraltete Zahlen (Vorgabe Schritt 6b).
    window.NewsSettings?.renderFeedbackOverview();
  }

  function initFeedSection() {
    document.getElementById('news-feed-import-btn')?.addEventListener('click', importArticles);
    document.getElementById('news-finish-btn')?.addEventListener('click', finishSession);
    refreshFeedUI();
  }

  document.addEventListener('DOMContentLoaded', initFeedSection);

  // Schritt 4 (Backup-Import) ruft render() nach einem Restore erneut auf,
  // analog zu NewsSources/NewsTopics - jetzt refreshFeedUI, damit auch
  // Fortschrittsleiste/Session-Übersicht nach einem Restore stimmen.
  window.NewsFeed = { render: refreshFeedUI };
})();
