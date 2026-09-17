// ============================================================
// News Curator – Quellen-Verwaltung (Schritt 2)
// ============================================================
// Nutzt ausschließlich die in news-storage.js (Schritt 1) bereitgestellte
// Persistenz (readJSON/writeJSON auf news.settings) - keine zweite
// Persistenz-Schicht. Es gibt in support.sheet keine bestehende Toggle-
// Switch-Komponente (geprüft: weder global in css/main.css noch in einem
// anderen Feature) - der Schalter hier ist daher neu, aber mit den echten
// Design-Tokens der App gebaut (siehe .news-switch in news.css), keine
// Übernahme aus dem Prototyp.
(function () {
  function getSettings() {
    return window.NewsStorage.readJSON(window.NewsStorage.KEYS.settings, {
      customInterests: [], excludeKeywords: [], sources: [],
      dateFrom: '', dateTo: '', maxArticles: 20,
    });
  }

  function saveSettings(settings) {
    window.NewsStorage.writeJSON(window.NewsStorage.KEYS.settings, settings);
  }

  // ID aus dem Namen: kleingeschrieben, nicht-alphanumerische Zeichen zu
  // Bindestrichen, führende/folgende Bindestriche entfernt.
  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Bugfix: rohe Eingabe wie "https://www.heise.de/" oder "www.heise.de"
  // vorab auf den reinen Domainnamen normalisieren, sonst kann die spätere
  // Domain-Prüfung in verifyArticle daran vorbeischrammen (der includes-
  // Abgleich selbst bleibt bewusst pragmatisch, nur die Eingabe wird bereinigt).
  function normalizeSourceInput(raw) {
    return raw.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  }

  // ── Favicon-Erkennung (Prompt 20) ──────────────────────────
  // Nur der Hostname wird gebraucht, auch wenn der Quellenname einen Pfad
  // enthält (z.B. "heise.de/newsticker"). new URL() übernimmt das Parsen,
  // die bereits vorhandene Normalisierung aus Prompt 9 (kein http(s)://,
  // kein www., kein abschließender /) hilft hier bereits vor, ersetzt eine
  // eigene Parsing-Implementierung aber nicht vollständig (Pfade bleiben ja
  // erlaubt), daher weiterhin über new URL() statt eigenem Regex.
  function extractHostname(name) {
    try {
      return new URL('https://' + name).hostname;
    } catch {
      return null;
    }
  }

  // Kein Byte-Caching der Bilddaten selbst hier (CORS/Canvas-Tainting,
  // siehe Plan) - das Caching übernimmt der Service Worker (sw.js). Diese
  // Funktion prüft nur per <img> onload/onerror, ob eine URL überhaupt lädt,
  // und persistiert ausschließlich die erfolgreiche URL plus favicon_checked.
  const faviconCheckInFlight = new Set();

  function detectFavicon(id, name) {
    const domain = extractHostname(name);

    function finish(url) {
      faviconCheckInFlight.delete(id);
      const settings = getSettings();
      const source = settings.sources.find(s => s.id === id);
      if (!source) return; // Quelle wurde inzwischen gelöscht
      source.favicon_checked = true;
      source.favicon_url = url;
      saveSettings(settings);
      renderSources();
    }

    if (!domain) { finish(null); return; }

    const directUrl = `https://${domain}/favicon.ico`;
    const direct = new Image();
    direct.onload = () => finish(directUrl);
    direct.onerror = () => {
      // Schritt 2: Google-Faviconservice als Fallback, erst NACH Fehlschlag
      // von Schritt 1, nicht parallel (siehe Plan: dreistufige Kette).
      const googleUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
      const viaGoogle = new Image();
      viaGoogle.onload = () => finish(googleUrl);
      viaGoogle.onerror = () => finish(null);
      viaGoogle.src = googleUrl;
    };
    direct.src = directUrl;
  }

  // Läuft nach jedem renderSources()-Aufruf: prüft alle Quellen ohne
  // favicon_checked:true (neu hinzugefügte UND einmalig nachgeholt für
  // bereits bestehende Quellen aus vor diesem Prompt), übersprungen wird nur
  // eine bereits laufende Prüfung derselben Quelle (faviconCheckInFlight),
  // damit z.B. ein Umschalten der aktiv/inaktiv-Leiste keine doppelten
  // Netzwerk-Anfragen für dieselbe, noch offene Prüfung auslöst.
  function checkPendingFavicons() {
    getSettings().sources.forEach(source => {
      if (source.favicon_checked === true) return;
      if (faviconCheckInFlight.has(source.id)) return;
      faviconCheckInFlight.add(source.id);
      detectFavicon(source.id, source.name);
    });
  }

  function buildSourceBadge(source) {
    const badge = document.createElement('span');
    badge.className = 'news-source-badge';
    badge.textContent = source.name.slice(0, 2).toUpperCase();
    return badge;
  }

  function buildSourceRow(source) {
    const row = document.createElement('div');
    row.className = 'news-source-row' + (source.active ? '' : ' news-source-row--inactive');
    row.dataset.id = source.id;

    let icon;
    if (source.favicon_url) {
      icon = document.createElement('img');
      icon.className = 'news-source-favicon';
      icon.src = source.favicon_url;
      icon.alt = '';
      icon.loading = 'lazy';
      // Herkunft im Tooltip aus Transparenzgründen (Schritt 2 bedeutet eine
      // Anfrage an einen Dritten) - aus der gespeicherten URL abgeleitet
      // statt einem zusätzlichen Datenmodell-Feld, das die Aufgabe nicht
      // vorsieht.
      icon.title = source.favicon_url.includes('google.com/s2/favicons')
        ? 'via Google'
        : (extractHostname(source.name) || source.name);
      // Schlägt ein bereits gespeichertes Favicon beim Rendern doch fehl
      // (z.B. zwischenzeitlich entfernt), live auf das Kürzel-Badge
      // zurückfallen, ohne favicon_checked/favicon_url anzurühren - kein
      // erneuter Check bei jedem Laden, nur dieser eine Anzeige-Versuch war
      // erfolglos.
      icon.addEventListener('error', () => icon.replaceWith(buildSourceBadge(source)), { once: true });
    } else {
      icon = buildSourceBadge(source);
    }

    const info = document.createElement('div');
    info.className = 'news-source-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'news-source-name';
    nameEl.textContent = source.name;
    const statusEl = document.createElement('div');
    statusEl.className = 'news-source-status';
    statusEl.textContent = source.active ? 'Wird für die Recherche verwendet' : 'Ausgeschaltet · bleibt gespeichert';
    info.appendChild(nameEl);
    info.appendChild(statusEl);

    const switchLabel = document.createElement('label');
    switchLabel.className = 'news-switch';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = source.active;
    checkbox.setAttribute('aria-label', source.name + (source.active ? ' deaktivieren' : ' aktivieren'));
    checkbox.addEventListener('change', () => toggleSource(source.id));
    const track = document.createElement('span');
    track.className = 'news-switch-track';
    switchLabel.appendChild(checkbox);
    switchLabel.appendChild(track);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'news-source-remove';
    removeBtn.title = 'Endgültig entfernen';
    removeBtn.setAttribute('aria-label', source.name + ' endgültig entfernen');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => deleteSource(source.id));

    row.appendChild(icon);
    row.appendChild(info);
    row.appendChild(switchLabel);
    row.appendChild(removeBtn);
    return row;
  }

  function renderSources() {
    const list = document.getElementById('news-source-list');
    if (!list) return;
    const settings = getSettings();
    list.replaceChildren();
    if (!settings.sources.length) {
      const empty = document.createElement('p');
      empty.className = 'news-placeholder';
      empty.textContent = 'Noch keine Quellen.';
      list.appendChild(empty);
      return;
    }
    settings.sources.forEach(source => list.appendChild(buildSourceRow(source)));
  }

  function addSource() {
    const input = document.getElementById('news-source-input');
    if (!input) return;
    const name = normalizeSourceInput(input.value);
    if (!name) return;
    const id = slugify(name);
    if (!id) { input.value = ''; return; }

    const settings = getSettings();
    if (settings.sources.some(s => s.id === id)) {
      // Gleicher Name bereits vorhanden - kein Duplikat anlegen.
      input.value = '';
      return;
    }
    settings.sources.push({ id, name, active: true });
    saveSettings(settings);
    input.value = '';
    renderSources();
    checkPendingFavicons();
  }

  function toggleSource(id) {
    const settings = getSettings();
    const source = settings.sources.find(s => s.id === id);
    if (!source) return;
    source.active = !source.active;
    saveSettings(settings);
    renderSources();
  }

  function deleteSource(id) {
    const settings = getSettings();
    settings.sources = settings.sources.filter(s => s.id !== id);
    saveSettings(settings);
    renderSources();
  }

  function initSourcesSection() {
    const addBtn = document.getElementById('news-source-add-btn');
    const input = document.getElementById('news-source-input');
    if (!addBtn || !input) return;
    addBtn.addEventListener('click', addSource);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addSource(); }
    });
    renderSources();
    // Einmalig für bereits bestehende Quellen ohne favicon_checked:true
    // nachgeholt (z.B. aus der Zeit vor diesem Prompt).
    checkPendingFavicons();
  }

  document.addEventListener('DOMContentLoaded', initSourcesSection);

  // Schritt 4 (Einstellungen/Backup-Import) ruft renderSources() nach einem
  // Restore erneut auf, damit die Liste ohne Reload den wiederhergestellten
  // Stand zeigt.
  window.NewsSources = { render: renderSources };
})();
