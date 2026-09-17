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
    return `WICHTIG: Antworte ausschließlich mit validem JSON, ohne Markdown-Codeblock, ohne einleitenden oder abschließenden Text.

Du hilfst mir, die Themenbereiche folgender Newsseiten zu erfassen:
${sources}

Liste für diese Seiten die Rubriken/Themenbereiche, in die sie ihre Inhalte
typischerweise einteilen (Navigation, Kategorien, Tags). Fasse sehr ähnliche
Rubriken über die Seiten hinweg zu einer zusammen, keine Duplikate.

Prüfe vor der Antwort: ist die Ausgabe reines JSON, ohne \`\`\`-Codeblock, ohne
Text davor oder danach?

Exaktes Schema:
{
  "topics": ["string", "string", ...]
}`;
  }

  function handleGeneratePrompt() {
    const textarea = document.getElementById('news-discovery-prompt');
    if (!textarea) return;
    textarea.value = generateDiscoveryPrompt();
    // Prompt 10: ausklappbarer Bereich (Details, siehe news.html) automatisch
    // öffnen, sonst verschwindet das frisch generierte Ergebnis unbemerkt
    // hinter dem standardmäßig eingeklappten Zustand.
    const details = document.getElementById('news-discovery-prompt-details');
    if (details) details.open = true;
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

  // ── Mutationen (Prompt 11 - Listenboxen mit Mehrfachauswahl) ──
  // Kein bestehendes Muster für eine fest-hohe, intern scrollbare Checkbox-
  // Listenbox mit Select-all + Massenaktionen gefunden (recherchiert:
  // guides-manage.js' Import-Tabelle hat Select-all, aber keinen festen
  // Scroll-Bereich; guides-overview.js' Kachel-Mehrfachauswahl hat eine
  // Bulk-Aktionsleiste, aber kein Select-all und keinen Scroll-Bereich) -
  // daher neu gebaut, angelehnt an mitmachen-merge.js' einfaches Muster
  // "Checkbox-Zustand erst beim Klick auf die Aktion auslesen", statt einen
  // zusätzlichen, separat zu synchronisierenden Auswahl-Zustand zu pflegen.
  function getCheckedIndexes(listEl) {
    return [...listEl.querySelectorAll('input[type="checkbox"]:checked')]
      .map(cb => parseInt(cb.dataset.index, 10))
      .filter(i => !isNaN(i));
  }

  // "Alle auswählen" ist ein echter Umschalter (an/aus), kein reines
  // Ankreuzen - erneuter Klick hebt die Auswahl wieder komplett auf.
  function toggleSelectAll(listId) {
    const list = document.getElementById(listId);
    if (!list) return;
    const boxes = [...list.querySelectorAll('input[type="checkbox"]')];
    if (!boxes.length) return;
    const allChecked = boxes.every(cb => cb.checked);
    boxes.forEach(cb => { cb.checked = !allChecked; });
  }

  // Verschieben (Aktivieren/Deaktivieren) für alle markierten Zeilen einer
  // Box auf einmal - news.topics bleibt sonst unverändert (Reihenfolge,
  // description etc.), nur "selected" der betroffenen Einträge kippt.
  function bulkSetSelected(listId, value) {
    const list = document.getElementById(listId);
    if (!list) return;
    const indexes = getCheckedIndexes(list);
    if (!indexes.length) return;
    const topics = getTopics();
    indexes.forEach(i => { if (topics[i]) topics[i].selected = value; });
    saveTopics(topics);
    renderTopics();
  }

  // Massenlöschung: mehrere markierte Themen auf einmal endgültig aus
  // news.topics entfernen. Da das mehrere, ggf. viele Einträge auf einen
  // Schlag endgültig löscht (mehr als der bisherige Einzel-"×"), zur
  // Sicherheit einmal nachfragen - selbes Muster wie beim Backup-Import.
  function bulkDelete(listId) {
    const list = document.getElementById(listId);
    if (!list) return;
    const indexes = getCheckedIndexes(list);
    if (!indexes.length) return;
    if (!confirm(`${indexes.length} ${indexes.length === 1 ? 'Thema' : 'Themen'} endgültig löschen?`)) return;
    const toDelete = new Set(indexes);
    const topics = getTopics().filter((_, i) => !toDelete.has(i));
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
  // Checkbox hier ist reiner, nicht persistenter Arbeits-Zustand für die
  // Massenaktionen (siehe oben) - unabhängig von topic.selected, das nur
  // bestimmt, in welcher der beiden Boxen eine Zeile überhaupt auftaucht.
  function buildTopicRow(topic, index) {
    const row = document.createElement('div');
    row.className = 'news-topic-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'news-topic-row-checkbox';
    checkbox.dataset.index = String(index);
    checkbox.setAttribute('aria-label', topic.name + ' auswählen');
    row.appendChild(checkbox);

    const name = document.createElement('span');
    name.className = 'news-topic-row-name' + (topic.description ? ' news-topic-row-name--has-desc' : '');
    name.textContent = topic.name;
    if (topic.description) name.title = topic.description;
    row.appendChild(name);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'news-topic-icon-btn';
    editBtn.title = 'Beschreibung bearbeiten';
    editBtn.setAttribute('aria-label', 'Beschreibung für ' + topic.name + ' bearbeiten');
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => editTopicDescription(index));
    row.appendChild(editBtn);

    return row;
  }

  function renderTopicList(listId, topics, indexes, emptyText) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.replaceChildren();
    if (!indexes.length) {
      const empty = document.createElement('p');
      empty.className = 'news-hint';
      empty.style.margin = '0';
      empty.textContent = emptyText;
      list.appendChild(empty);
      return;
    }
    indexes.forEach(i => list.appendChild(buildTopicRow(topics[i], i)));
  }

  function renderTopics() {
    const topics = getTopics();
    const activeIdx = [];
    const inactiveIdx = [];
    topics.forEach((t, i) => (t.selected ? activeIdx : inactiveIdx).push(i));

    renderTopicList('news-topics-active-list', topics, activeIdx, 'Keine aktiven Themen.');
    renderTopicList('news-topics-inactive-list', topics, inactiveIdx, 'Keine deaktivierten Themen.');
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

    document.getElementById('news-topics-active-selectall-btn')?.addEventListener('click', () => toggleSelectAll('news-topics-active-list'));
    document.getElementById('news-topics-inactive-selectall-btn')?.addEventListener('click', () => toggleSelectAll('news-topics-inactive-list'));
    // Prompt 15: die beiden Verschieben-Buttons sitzen jetzt gemeinsam in
    // einer mittleren Spalte statt je einer pro Box - Verschieben-Logik
    // selbst (bulkSetSelected) unverändert, nur die Button-Position/IDs.
    document.getElementById('news-topics-deactivate-btn')?.addEventListener('click', () => bulkSetSelected('news-topics-active-list', false));
    document.getElementById('news-topics-activate-btn')?.addEventListener('click', () => bulkSetSelected('news-topics-inactive-list', true));
    document.getElementById('news-topics-active-delete-btn')?.addEventListener('click', () => bulkDelete('news-topics-active-list'));
    document.getElementById('news-topics-inactive-delete-btn')?.addEventListener('click', () => bulkDelete('news-topics-inactive-list'));

    renderTopics();
  }

  document.addEventListener('DOMContentLoaded', initTopicsSection);

  // Schritt 4 (Einstellungen/Backup-Import) ruft renderTopics() nach einem
  // Restore erneut auf, damit die Listenboxen ohne Reload den
  // wiederhergestellten Stand zeigen.
  window.NewsTopics = { render: renderTopics };
})();
