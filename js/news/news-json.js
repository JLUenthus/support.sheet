// ============================================================
// News Curator – Hilfsfunktionen für KI-Antworten (JSON + Text)
// ============================================================
// Eigenständige Funktionen statt Inline-Logik in einzelnen Import-Handlern:
// extractJson wird identisch von Schritt 3 (Themen-Import) und Schritt 6a
// (Feed-Import) genutzt (Architektur-Hinweise im Plan: "eine einzige JSON-
// Extraktions-/Parser-Funktion für beide Import-Stellen"). normalizeText war
// ursprünglich lokal in news-topics.js als "normalizeTopic" - Schritt 6a
// braucht dieselbe Regel (Kleinschreibung, Sonderzeichen entfernt) für
// Artikel-Titel, daher hierher gezogen und von news-topics.js aus wieder
// aufgerufen statt eine zweite, identische Implementierung anzulegen.
(function () {
  // KI haelt sich oft nicht an "kein Markdown" (Edge Case im Plan) - zuerst
  // ```json-Codeblock-Marker entfernen, dann alles vor der ersten { und
  // nach der letzten } abschneiden.
  function extractJson(raw) {
    let text = String(raw || '').trim();
    text = text.replace(/```json/gi, '```').split('```').join('').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      throw new Error('Kein JSON gefunden');
    }
    return JSON.parse(text.slice(start, end + 1));
  }

  // Kleinschreibung, Bindestriche/Sonderzeichen entfernt - für Beinahe-
  // Duplikat-Abgleich (Themen-Namen wie Artikel-Titel), keine Fuzzy-Logik.
  function normalizeText(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '');
  }

  window.NewsJSON = { extractJson, normalizeText };
})();
