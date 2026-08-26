// ============================================================
// gpo-disclaimer.js - Hinweis-Modal beim Aufruf von gpo.html.
// Vollstaendig isoliert: kein Zugriff auf _model/_findings, keine
// Abhaengigkeit von gpo-renderer.js/gpo-parser.js/gpo-loader.js und
// umgekehrt. Einzige Aufgabe: Modal anzeigen/verstecken + versionierte
// Bestaetigung in localStorage (siehe V5.3-DISCLAIMER-BERICHT.md).
//
// Versionsvergleich bewusst als reiner Exakt-Vergleich (kein Aelter-/
// Neuer-Parsing von Versionsstrings): gespeicherter Wert === aktuelle
// DISCLAIMER_VERSION -> nicht anzeigen, jede Abweichung (fehlt, aelter,
// abweichend, unerwartet neuer) -> anzeigen.
// ============================================================
(function() {
  var DISCLAIMER_VERSION = '1.0';
  var STORAGE_KEY = 'gpo-disclaimer-ack';

  function readAck() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }
  function writeAck() {
    try {
      localStorage.setItem(STORAGE_KEY, DISCLAIMER_VERSION);
    } catch (err) {
      // localStorage evtl. nicht verfuegbar (z.B. privater Modus) - dann
      // erscheint der Hinweis beim naechsten Aufruf erneut, kein Fehlerfall.
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    var overlay = document.getElementById('gpo-disclaimer-overlay');
    var btn = document.getElementById('gpo-disclaimer-ack-btn');
    if (!overlay || !btn) return;

    if (readAck() === DISCLAIMER_VERSION) return;

    overlay.classList.add('gpo-disclaimer-overlay--open');
    document.body.classList.add('gpo-disclaimer-open');
    btn.focus();

    // Der Bestaetigungs-Button ist das einzige interaktive Element im
    // Dialog - ein vollstaendiger Fokus-Trap reduziert sich damit darauf,
    // Tab/Shift+Tab immer wieder auf genau dieses Element zurueckzuholen.
    // Escape wird bewusst NICHT zum Schliessen verwendet (siehe Auftrag).
    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        btn.focus();
      }
    }
    overlay.addEventListener('keydown', onKeydown);

    btn.addEventListener('click', function() {
      writeAck();
      overlay.classList.remove('gpo-disclaimer-overlay--open');
      document.body.classList.remove('gpo-disclaimer-open');
      overlay.removeEventListener('keydown', onKeydown);
    });
  });
})();
