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
  //
  // Bugfix Prompt 21: reale KI-Antworten enthalten gelegentlich eine
  // typografische schließende Anführung („Text") als GERADES " geschrieben,
  // ohne es zu escapen - das beendet den JSON-String an dieser Stelle
  // vorzeitig, JSON.parse bricht dort mit einem SyntaxError ab (per
  // Bug-Report-Datei byte-genau reproduziert, zweimal im selben Durchlauf:
  // einmal im Artikel-Titel, einmal in dessen summary). Root Cause bestätigt
  // durch Debugging mit der echten Bug-Report-JSON: JSON.parse() allein
  // wirft exakt an der Stelle des ersten unescapten Anführungszeichens ab,
  // ein Regex-Objekt mit gemeinsamem Zustand war NICHT die Ursache (gezielt
  // gesucht, keins gefunden - stripMarkdownLink()/normalizeText() nutzen
  // beide frische, literale Regexes pro Aufruf, kein wiederverwendetes
  // Objekt). Deshalb hier ein gezielter Reparaturversuch als Fallback, NUR
  // wenn der erste, strikte JSON.parse()-Versuch scheitert (Normalfall
  // unverändert: sauberes JSON parst weiterhin ohne jeden Umweg).
  function repairUnescapedQuotes(text) {
    let result = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString && ch === '\\') {
        // Bereits escapetes Zeichen (\", \\, \n, ...) unverändert übernehmen,
        // das nächste Zeichen gehört dazu und darf nicht separat geprüft werden.
        result += ch + (text[i + 1] || '');
        i++;
        continue;
      }
      if (ch === '"') {
        if (!inString) {
          inString = true;
          result += ch;
          continue;
        }
        // Innerhalb eines Strings: nur ein " mit einem der JSON-Struktur-
        // zeichen (bzw. Textende) direkt danach (optional Leerraum davor)
        // ist ein echter String-Abschluss. Alles andere ist ein literales
        // Anführungszeichen im Inhalt, das escapet werden muss statt den
        // String hier fälschlich zu beenden.
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        const next = text[j];
        const isRealClose = next === undefined || ',:}]'.includes(next);
        if (isRealClose) {
          inString = false;
          result += ch;
        } else {
          result += '\\"';
        }
        continue;
      }
      result += ch;
    }
    return result;
  }

  function extractJson(raw) {
    let text = String(raw || '').trim();
    text = text.replace(/```json/gi, '```').split('```').join('').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      throw new Error('Kein JSON gefunden');
    }
    const candidate = text.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (err) {
      try {
        return JSON.parse(repairUnescapedQuotes(candidate));
      } catch {
        throw err; // ursprünglichen Fehler melden, nicht den Reparaturversuch
      }
    }
  }

  // Kleinschreibung, Bindestriche/Sonderzeichen entfernt - für Beinahe-
  // Duplikat-Abgleich (Themen-Namen wie Artikel-Titel), keine Fuzzy-Logik.
  function normalizeText(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '');
  }

  window.NewsJSON = { extractJson, normalizeText };
})();
