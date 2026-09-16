// ============================================================
// News Curator – Später lesen: Anzeige (Schritt 7)
// ============================================================
// Reines Anzeige-/Entfernen-Modul. Das Schreiben (Merken) passiert weiterhin
// ausschließlich in news-feed.js (toggleSave, Schritt 6b) - hier nur
// Rendering, "Entfernen" und der Cross-Modul-Refresh, den toggleSave() nach
// jeder Änderung aufruft (dieselbe Art Aufruf wie "Fertig" -> Feedback-Panel
// in Schritt 6b).
(function () {
  function getSaved() {
    return window.NewsStorage.readJSON(window.NewsStorage.KEYS.saved, []);
  }
  function writeSaved(list) {
    window.NewsStorage.writeJSON(window.NewsStorage.KEYS.saved, list);
  }

  // Gleiche Regel wie im Feed (news-feed.js): nur bei gültiger https-URL
  // rendern, onerror entfernt ein kaputtes Bild leise statt eines Icons.
  function isValidHttpsUrl(url) {
    try { return new URL(url).protocol === 'https:'; } catch { return false; }
  }

  function removeSaved(url) {
    writeSaved(getSaved().filter(s => s.url !== url));
    renderSavedList();
    window.NewsNav?.updateSavedBadge();
  }

  function buildSavedItem(entry) {
    const item = document.createElement('div');
    item.className = 'news-saved-item';

    if (entry.image_url && isValidHttpsUrl(entry.image_url)) {
      const img = document.createElement('img');
      img.className = 'news-article-thumb';
      img.src = entry.image_url;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => img.remove());
      item.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'news-saved-body';

    // Öffnet in neuem Tab, aber setzt bewusst KEIN "gelesen" - das ist ein
    // reiner Feed-Session-Zustand (news.feed), unabhängig von news.saved.
    const titleLink = document.createElement('a');
    titleLink.className = 'news-article-title';
    titleLink.href = entry.url;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = entry.title;
    body.appendChild(titleLink);

    const meta = document.createElement('div');
    meta.className = 'news-article-meta';
    const metaParts = [entry.source, entry.topic, entry.published_at];
    if (entry.read_time_minutes) metaParts.push(`~${entry.read_time_minutes} Min.`);
    meta.appendChild(document.createTextNode(metaParts.filter(Boolean).join(' · ')));
    if (entry.verified === false) {
      meta.appendChild(document.createTextNode(' · '));
      const badge = document.createElement('span');
      badge.className = 'news-verify-badge news-verify-badge--warn';
      badge.textContent = 'Auffällig';
      badge.title = (entry.checkReasons || []).join(', ');
      meta.appendChild(badge);
    }
    body.appendChild(meta);

    const summary = document.createElement('p');
    summary.className = 'news-article-summary';
    summary.textContent = entry.summary || '';
    body.appendChild(summary);

    if (entry.why_relevant) {
      const why = document.createElement('p');
      why.className = 'news-article-why';
      const strong = document.createElement('strong');
      strong.textContent = 'Warum relevant: ';
      why.appendChild(strong);
      why.appendChild(document.createTextNode(entry.why_relevant));
      body.appendChild(why);
    }

    item.appendChild(body);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'news-btn-secondary news-saved-remove';
    removeBtn.textContent = 'Entfernen';
    removeBtn.addEventListener('click', () => removeSaved(entry.url));
    item.appendChild(removeBtn);

    return item;
  }

  function renderSavedList() {
    const list = document.getElementById('news-saved-list');
    if (!list) return;
    const saved = [...getSaved()].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    list.replaceChildren();
    if (!saved.length) {
      const empty = document.createElement('p');
      empty.className = 'news-placeholder';
      empty.textContent = 'Noch nichts gemerkt.';
      list.appendChild(empty);
      return;
    }
    saved.forEach(entry => list.appendChild(buildSavedItem(entry)));
  }

  document.addEventListener('DOMContentLoaded', renderSavedList);

  // Schritt 4 (Backup-Import) und news-feed.js (Merken im Feed, Schritt 6b)
  // rufen render() erneut auf, analog zu NewsSources/NewsTopics/NewsFeed.
  window.NewsSaved = { render: renderSavedList };
})();
