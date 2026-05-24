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
  const section   = document.getElementById('recent-section');
  const container = document.getElementById('recent-container');
  if (!section || !container) return;

  const list = getRecent();

  // Section ausblenden wenn leer
  section.hidden = list.length === 0;
  if (list.length === 0) return;

  const fragment = document.createDocumentFragment();

  list.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.title = entry.resolved;

    const nameEl = document.createElement('span');
    nameEl.className = 'recent-name';
    nameEl.textContent = entry.name;

    const cmdEl = document.createElement('code');
    cmdEl.className = 'recent-cmd';
    cmdEl.textContent = entry.resolved;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'recent-copy-btn';
    copyBtn.textContent = '📋';
    const safeName = String(entry.name || '').replace(/[<>"']/g, '');
    copyBtn.setAttribute('aria-label', `${safeName} erneut kopieren`);
    copyBtn.addEventListener('click', () => {
      copyToClipboard(entry.resolved, copyBtn);
      // Nutzung erneut tracken → nach oben schieben
      addRecent({ id: entry.id, name: entry.name }, entry.resolved);
    });

    item.appendChild(nameEl);
    item.appendChild(cmdEl);
    item.appendChild(copyBtn);
    fragment.appendChild(item);
  });

  container.replaceChildren(fragment);
}


// ── Init ──────────────────────────────────────────────────
// Beim Laden direkt rendern (könnte bereits Einträge in localStorage geben)
document.addEventListener('DOMContentLoaded', () => renderRecent());
