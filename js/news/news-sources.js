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

  function buildSourceRow(source) {
    const row = document.createElement('div');
    row.className = 'news-source-row' + (source.active ? '' : ' news-source-row--inactive');
    row.dataset.id = source.id;

    const badge = document.createElement('span');
    badge.className = 'news-source-badge';
    badge.textContent = source.name.slice(0, 2).toUpperCase();

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

    row.appendChild(badge);
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
    const name = input.value.trim();
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
  }

  document.addEventListener('DOMContentLoaded', initSourcesSection);

  // Schritt 4 (Einstellungen/Backup-Import) ruft renderSources() nach einem
  // Restore erneut auf, damit die Liste ohne Reload den wiederhergestellten
  // Stand zeigt.
  window.NewsSources = { render: renderSources };
})();
