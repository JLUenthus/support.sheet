// ============================================================
// News Curator – Themen-Verwaltung (Schritt 3)
// ============================================================
// Selbes Grundmuster wie news-sources.js (Schritt 2): lokale
// get/save-Wrapper um NewsStorage.readJSON/writeJSON, ein render*()
// pro Abschnitt, das nach jeder Mutation neu aufgerufen wird.
(function () {
  function getTopics() {
    return window.NewsStorage.readJSON(window.NewsStorage.KEYS.topics, []);
  }

  function saveTopics(topics) {
    window.NewsStorage.writeJSON(window.NewsStorage.KEYS.topics, topics);
  }

  function getSettings() {
    return window.NewsStorage.readJSON(window.NewsStorage.KEYS.settings, { sources: [] });
  }

  // Normalisierung für den Abgleich (keine ID wie bei Quellen, nur Vergleich) -
  // Kleinschreibung, Bindestriche/Sonderzeichen entfernt, damit "IT-Security"
  // und "IT Security" nicht doppelt landen (Edge Case "Beinahe-Duplikate" im Plan).
  // Ab Schritt 6a in news-json.js ausgelagert (Artikel-Titel brauchen exakt
  // dieselbe Regel) - hier nur noch aufgerufen, keine zweite Implementierung.
  function normalizeTopic(name) {
    return window.NewsJSON.normalizeText(name);
  }

  // ── Themen-Discovery-Prompt ───────────────────────────────
  function generateDiscoveryPrompt() {
    const settings = getSettings();
    const sources = (settings.sources || []).filter(s => s.active).map(s => s.name).join(', ');
    return `Du hilfst mir, die Themenbereiche folgender Newsseiten zu erfassen:
${sources}

Liste für diese Seiten die Rubriken/Themenbereiche, in die sie ihre Inhalte
typischerweise einteilen (Navigation, Kategorien, Tags). Fasse sehr ähnliche
Rubriken über die Seiten hinweg zu einer zusammen, keine Duplikate.

Gib AUSSCHLIESSLICH valides JSON zurück, ohne Markdown-Codeblock, ohne
einleitenden oder abschließenden Text, exakt in diesem Schema:

{
  "topics": ["string", "string", ...]
}`;
  }

  function handleGeneratePrompt() {
    const textarea = document.getElementById('news-discovery-prompt');
    if (!textarea) return;
    textarea.value = generateDiscoveryPrompt();
  }

  function handleCopyPrompt() {
    const textarea = document.getElementById('news-discovery-prompt');
    const btn = document.getElementById('news-discovery-copy-btn');
    if (!textarea || !textarea.value) return;
    const flashCopied = () => {
      if (!btn) return;
      const original = btn.textContent;
      btn.textContent = '✓ Kopiert';
      setTimeout(() => { btn.textContent = original; }, 1500);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(textarea.value).then(flashCopied).catch(() => textarea.select());
    } else {
      // Fallback lt. Plan: Text bleibt in der Textarea selektierbar.
      textarea.select();
    }
  }

  // ── Import ────────────────────────────────────────────────
  function importTopics() {
    const textarea = document.getElementById('news-discovery-import');
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

    const names = Array.isArray(data.topics) ? data.topics : [];
    const topics = getTopics();
    names.forEach(name => {
      const trimmed = String(name || '').trim();
      if (!trimmed) return;
      const norm = normalizeTopic(trimmed);
      if (!topics.some(t => normalizeTopic(t.name) === norm)) {
        // Neue Themen landen unausgewählt - bestehende Einträge (inkl.
        // selected/description) bleiben beim Merge unangetastet.
        topics.push({ name: trimmed, selected: false, description: '' });
      }
    });
    saveTopics(topics);
    textarea.value = '';
    renderTopics();
  }

  // ── Manuelles Hinzufügen ──────────────────────────────────
  function addTopicManually() {
    const input = document.getElementById('news-topic-input');
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;
    const norm = normalizeTopic(raw);
    if (!norm) { input.value = ''; return; }

    const topics = getTopics();
    if (topics.some(t => normalizeTopic(t.name) === norm)) {
      input.value = '';
      return;
    }
    topics.push({ name: raw, selected: true, description: '' });
    saveTopics(topics);
    input.value = '';
    renderTopics();
  }

  // ── Mutationen ────────────────────────────────────────────
  function toggleTopic(index) {
    const topics = getTopics();
    if (!topics[index]) return;
    topics[index].selected = !topics[index].selected;
    saveTopics(topics);
    renderTopics();
  }

  function deleteTopic(index) {
    const topics = getTopics();
    if (!topics[index]) return;
    topics.splice(index, 1);
    saveTopics(topics);
    renderTopics();
  }

  function editTopicDescription(index) {
    const topics = getTopics();
    const topic = topics[index];
    if (!topic) return;
    const val = prompt(
      `Kurzbeschreibung für "${topic.name}" (fließt später in den Prompt ein, z. B. "Exchange, Entra ID, Conditional Access"):`,
      topic.description || ''
    );
    if (val === null) return;
    topic.description = val.trim();
    saveTopics(topics);
    renderTopics();
  }

  // ── Rendering ─────────────────────────────────────────────
  function buildTopicPill(topic, index) {
    const pill = document.createElement('span');
    pill.className = 'news-topic-pill' + (topic.selected ? ' news-topic-pill--on' : '');

    const label = document.createElement('span');
    label.className = 'news-topic-label' + (topic.description ? ' news-topic-label--has-desc' : '');
    label.textContent = topic.name;
    if (topic.description) label.title = topic.description;
    // Per Klick auswählbar, aber auch per Tastatur: role/tabindex + Enter/Space,
    // sonst ist die Kernaktion des Pills (Auswahl umschalten) nicht per Tab
    // erreichbar (Prompt 8, Tastaturfokus-Check).
    label.setAttribute('role', 'button');
    label.setAttribute('tabindex', '0');
    label.setAttribute('aria-pressed', String(!!topic.selected));
    label.addEventListener('click', () => toggleTopic(index));
    label.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTopic(index);
      }
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'news-topic-icon-btn';
    editBtn.title = 'Beschreibung bearbeiten';
    editBtn.setAttribute('aria-label', 'Beschreibung für ' + topic.name + ' bearbeiten');
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => editTopicDescription(index));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'news-topic-icon-btn';
    removeBtn.title = 'Thema endgültig löschen';
    removeBtn.setAttribute('aria-label', topic.name + ' endgültig löschen');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => deleteTopic(index));

    pill.appendChild(label);
    pill.appendChild(editBtn);
    pill.appendChild(removeBtn);
    return pill;
  }

  function renderTopics() {
    const selectedEl = document.getElementById('news-topics-selected');
    const unselectedEl = document.getElementById('news-topics-unselected');
    const unselectedWrap = document.getElementById('news-topics-unselected-wrap');
    if (!selectedEl || !unselectedEl || !unselectedWrap) return;

    const topics = getTopics();
    selectedEl.replaceChildren();
    unselectedEl.replaceChildren();

    const selectedIdx = [];
    const unselectedIdx = [];
    topics.forEach((t, i) => (t.selected ? selectedIdx : unselectedIdx).push(i));

    if (!selectedIdx.length) {
      const empty = document.createElement('p');
      empty.className = 'news-hint';
      empty.style.margin = '0';
      empty.textContent = 'Noch keine Themen ausgewählt.';
      selectedEl.appendChild(empty);
    } else {
      selectedIdx.forEach(i => selectedEl.appendChild(buildTopicPill(topics[i], i)));
    }

    unselectedIdx.forEach(i => unselectedEl.appendChild(buildTopicPill(topics[i], i)));
    unselectedWrap.hidden = unselectedIdx.length === 0;
  }

  function initTopicsSection() {
    document.getElementById('news-discovery-generate-btn')?.addEventListener('click', handleGeneratePrompt);
    document.getElementById('news-discovery-copy-btn')?.addEventListener('click', handleCopyPrompt);
    document.getElementById('news-discovery-import-btn')?.addEventListener('click', importTopics);

    const topicInput = document.getElementById('news-topic-input');
    document.getElementById('news-topic-add-btn')?.addEventListener('click', addTopicManually);
    topicInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addTopicManually(); }
    });

    renderTopics();
  }

  document.addEventListener('DOMContentLoaded', initTopicsSection);

  // Schritt 4 (Einstellungen/Backup-Import) ruft renderTopics() nach einem
  // Restore erneut auf, damit die Pillen ohne Reload den wiederhergestellten
  // Stand zeigen.
  window.NewsTopics = { render: renderTopics };
})();
