// ============================================================
// AdminSheet – Recently Used Commands
// Vanilla JS, kein Framework, kein fetch()
// ============================================================

const RECENT_KEY      = 'adminsheet_recent_commands';
const RECENT_MAX      = 5;


// ── Storage ───────────────────────────────────────────────

/**
 * Liest die Recent-Liste aus localStorage.
 * @returns {Array}
 */
function getRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Schreibt die Recent-Liste in localStorage.
 * @param {Array} list
 */
function saveRecent(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    console.warn('recent.js: localStorage nicht verfügbar');
  }
}

/**
 * Fügt einen Command zur Recent-Liste hinzu.
 * - Keine Duplikate nach command.id
 * - Wenn bereits vorhanden → nach oben schieben
 * - Maximal RECENT_MAX Einträge
 *
 * @param {Object} command         – Original Command-Objekt { id, name, cmd, ... }
 * @param {string} resolvedCommand – Fertiger Command (Variablen bereits ersetzt)
 */
function addRecent(command, resolvedCommand) {
  const list = getRecent();

  // Duplikat entfernen – selbe id raus egal wo sie steht
  const filtered = list.filter(entry => entry.id !== command.id);

  // Neuen Eintrag oben einfügen
  const entry = {
    id:       command.id,
    name:     command.name,
    resolved: resolvedCommand,
    usedAt:   new Date().toISOString(),
  };

  const updated = [entry, ...filtered].slice(0, RECENT_MAX);
  saveRecent(updated);
  renderRecent();
}


// ── Render ────────────────────────────────────────────────

/**
 * Rendert die Recent-Section.
 * Blendet die Section aus wenn keine Einträge vorhanden.
 * Nutzt textContent – kein innerHTML.
 */
function renderRecent() {
  // Recent-Section ist deaktiviert – Recent ist jetzt ein Filter-Button
  // Nur den Zähler im Filter-Button aktualisieren
  const list = getRecent();
  const btn  = document.getElementById('filter-btn-recent');

  if (btn) {
    // Zähler aktualisieren
    const countEl = btn.querySelector('.filter-recent-count');
    if (countEl) countEl.textContent = list.length;
    // Button ausblenden wenn keine Einträge
    btn.style.display = list.length === 0 ? 'none' : '';
    // Wenn gerade Recent-Filter aktiv und Liste jetzt leer → zurück zu Alle
    if (list.length === 0 && btn.classList.contains('active')) {
      btn.classList.remove('active');
      const allBtn = document.querySelector('[data-tag="all"]');
      if (allBtn) allBtn.click();
    }
  }

  // Falls noch eine alte recent-section im HTML vorhanden ist, ausblenden
  const section = document.getElementById('recent-section');
  if (section) section.hidden = true;
}

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => renderRecent());
