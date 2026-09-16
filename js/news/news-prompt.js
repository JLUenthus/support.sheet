// ============================================================
// News Curator – Content-Prompt-Generator (Schritt 5)
// ============================================================
// Liest ausschließlich news.settings/.topics/.feedback über
// NewsStorage.readJSON, schreibt nichts - reine Anzeige-/Text-Logik.
(function () {
  const MIN_VOTES_FOR_WEIGHT = 3;

  // Gemeinsame Gewichtungsfunktion für alle drei Feedback-Buckets
  // (topics/keywords/sources) - identische Regeln, keine drei separaten
  // Implementierungen. Score = likes - dislikes, total = likes + dislikes.
  // Nur Einträge mit total >= minVotes sind für preferred/avoid zugelassen.
  function computeWeighted(bucket, minVotes = MIN_VOTES_FOR_WEIGHT) {
    const entries = Object.entries(bucket || {}).map(([name, v]) => ({
      name,
      score: (v.likes || 0) - (v.dislikes || 0),
      total: (v.likes || 0) + (v.dislikes || 0),
    }));
    const eligible = entries.filter(e => e.total >= minVotes);
    const preferred = eligible.filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(e => e.name);
    const avoid = eligible.filter(e => e.score <= -2).map(e => e.name);
    return { preferred, avoid };
  }

  function generateContentPrompt() {
    const settings = window.NewsStorage.readJSON(window.NewsStorage.KEYS.settings, {
      customInterests: [], excludeKeywords: [], sources: [], dateFrom: '', dateTo: '', maxArticles: 20,
    });
    const topics = window.NewsStorage.readJSON(window.NewsStorage.KEYS.topics, []);
    const feedback = window.NewsStorage.readJSON(window.NewsStorage.KEYS.feedback, { topics: {}, keywords: {}, sources: {} });

    // Themen-Beschreibungen im Prompt: "Name (Beschreibung)" statt nur "Name",
    // wenn eine description hinterlegt ist (Plan-Abschnitt gleichen Namens).
    const interests = [
      ...topics.filter(t => t.selected).map(t => t.description ? `${t.name} (${t.description})` : t.name),
      ...(settings.customInterests || []),
    ].join(', ') || '(keine ausgewählt)';

    const topicWeights   = computeWeighted(feedback.topics);
    const keywordWeights = computeWeighted(feedback.keywords);
    const sourceWeights  = computeWeighted(feedback.sources);

    const activeSources = (settings.sources || []).filter(s => s.active).map(s => s.name).join(', ');

    // Textbaustein 1:1 aus news-sheet-plan.md ("Prompt-Templates -> Content-
    // Prompt") übernommen - wird unverändert in eine externe KI eingefügt,
    // daher wortwörtlich, nicht umformuliert.
    return `Du bist ein Nachrichten-Kurator. Nutze deine Web-Suche, um aktuelle Nachrichten
zu folgenden Themen zu finden, veröffentlicht zwischen ${settings.dateFrom} und ${settings.dateTo}:

Interessen: ${interests}
Bevorzugte Themen (stärker gewichten, falls vorhanden): ${topicWeights.preferred.join(', ') || '–'}
Bevorzugte Schlagworte (stärker gewichten, falls vorhanden): ${keywordWeights.preferred.join(', ') || '–'}
Zu meidende Themen (falls vorhanden, ignorieren): ${topicWeights.avoid.join(', ') || '–'}
Zu meidende Schlagworte (falls vorhanden, ignorieren): ${keywordWeights.avoid.join(', ') || '–'}
Ausschließen: reine Werbung, Produktplatzierungen, Rabattcodes/Deals, Gewinnspiele,
Sponsored Content, sowie folgende Begriffe: ${(settings.excludeKeywords || []).join(', ') || '–'}
Bevorzugte Quellen (nicht ausschließlich): ${activeSources || '–'}
Quellen mit bisher schwacher Resonanz (weniger stark gewichten, falls vorhanden): ${sourceWeights.avoid.join(', ') || '–'}

Regeln:
- Maximal ${settings.maxArticles} Artikel insgesamt.
- Nur echte, per Websuche gefundene URLs zurückgeben, keine erfundenen Links.
- Bei derselben Meldung aus mehreren Quellen nur die beste Version behalten, keine Duplikate.
- Jeder Artikel: Zusammenfassung in maximal 2 Sätzen.
- Thematisch sinnvoll gruppieren (topic-Feld).
- Zusätzlich maximal 3 kurze "highlights" (je ein Satz) mit den wichtigsten Kernpunkten über alle Artikel hinweg.
- Pro Artikel, falls über die Websuche auffindbar, die URL des Artikelbilds mitliefern ("image_url"), sonst das Feld weglassen. Keine erfundenen Bild-URLs.
- "url" und "image_url" immer als reiner String zurückgeben, niemals als Markdown-Link (kein "[Text](URL)"-Format).
- Pro Artikel in einem Satz begründen, warum er zu den genannten Interessen passt ("why_relevant").
- Pro Artikel eine grobe geschätzte Lesezeit in Minuten ("read_time_minutes").
- Ausschließlich valides JSON zurückgeben, ohne Markdown-Codeblock, ohne
  einleitenden oder abschließenden Text, exakt in diesem Schema:

{
  "generated_at": "YYYY-MM-DDTHH:MM:SSZ",
  "highlights": ["string", "string"],
  "articles": [
    {
      "title": "string",
      "url": "string",
      "source": "string",
      "topic": "string",
      "tags": ["string"],
      "summary": "string",
      "published_at": "YYYY-MM-DD",
      "image_url": "string (optional)",
      "why_relevant": "string",
      "read_time_minutes": "number"
    }
  ]
}`;
  }

  function handleGeneratePrompt() {
    const textarea = document.getElementById('news-content-prompt');
    if (!textarea) return;
    textarea.value = generateContentPrompt();
  }

  // Selbes Copy-Muster wie news-topics.js (Schritt 3): Clipboard-API mit
  // Fallback - Text bleibt in der Textarea selektierbar, falls der Zugriff
  // verweigert wird.
  function handleCopyPrompt() {
    const textarea = document.getElementById('news-content-prompt');
    const btn = document.getElementById('news-content-copy-btn');
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
      textarea.select();
    }
  }

  function initPromptSection() {
    document.getElementById('news-content-generate-btn')?.addEventListener('click', handleGeneratePrompt);
    document.getElementById('news-content-copy-btn')?.addEventListener('click', handleCopyPrompt);
  }

  document.addEventListener('DOMContentLoaded', initPromptSection);

  // Für Tests/spätere Wiederverwendung (z.B. falls ein anderer Abschnitt
  // dieselbe Gewichtung braucht) zugänglich, analog zu den anderen Modulen.
  window.NewsPrompt = { computeWeighted, generateContentPrompt };
})();
