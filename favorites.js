// ============================================================
// AdminSheet – Favorites
// Vanilla JS, kein Framework, kein fetch()
// ============================================================

const FAVORITES_KEY = 'adminsheet_favorites';


// ── Storage ───────────────────────────────────────────────

/**
 * Liest die Favoriten-IDs aus localStorage.
 * @returns {string[]}
 */
function getFavoriteIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Speichert die Favoriten-IDs in localStorage.
 * @param {string[]} ids
 */
function saveFavoriteIds(ids) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    console.warn('favorites.js: localStorage nicht verfügbar');
  }
}


// ── Logik ─────────────────────────────────────────────────

/**
 * Prüft ob ein Command favorisiert ist.
 * @param {Object} command
 * @returns {boolean}
 */
function isFavorite(command) {
  return getFavoriteIds().includes(command.id);
}

/**
 * Toggelt den Favoriten-Status eines Commands.
 * @param {Object} command
 * @returns {boolean} Neuer Status (true = jetzt Favorit)
 */
function toggleFavorite(command) {
  const ids     = getFavoriteIds();
  const idx     = ids.indexOf(command.id);
  const isNow   = idx === -1;

  if (isNow) {
    ids.push(command.id);
  } else {
    ids.splice(idx, 1);
  }

  saveFavoriteIds(ids);
  return isNow;
}


// ── Render ────────────────────────────────────────────────

/**
 * Aktualisiert den visuellen Zustand eines Stern-Buttons.
 * @param {HTMLElement} btn
 * @param {boolean} active
 */
function updateStarBtn(btn, active) {
  btn.classList.toggle('star-btn--active', active);
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.setAttribute('aria-label', active ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen');
  btn.title = active ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen';
}

/**
 * Rendert die Favoriten-Section.
 * Benötigt alle geladenen Commands um sie nach ID zu filtern.
 * @param {Object[]} allCommands
 */
function renderFavorites(allCommands) {
  const section   = document.getElementById('favorites-section');
  const container = document.getElementById('favorites-container');
  if (!section || !container) return;

  const ids  = getFavoriteIds();
  const favs = allCommands.filter(cmd => ids.includes(cmd.id));

  section.hidden = favs.length === 0;
  if (favs.length === 0) return;

  const template = document.getElementById('command-template');
  if (!template) return;

  const fragment = document.createDocumentFragment();

  favs.forEach(cmd => {
    const clone = template.content.cloneNode(true);

    clone.querySelector('[data-field="name"]').textContent = cmd.name;
    clone.querySelector('[data-field="desc"]').textContent = cmd.desc;
    clone.querySelector('[data-field="cmd"]').textContent  = cmd.cmd;

    const tagContainer = clone.querySelector('[data-field="tags"]');
    (Array.isArray(cmd.tags) ? cmd.tags : []).forEach(tag => {
      const span = document.createElement('span');
      span.className   = 'tag';
      span.textContent = tag;
      tagContainer.appendChild(span);
    });

    // Copy Button
    const copyBtn = clone.querySelector('[data-action="copy"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => copyWithVariables(cmd, copyBtn));
    }

    // Star Button (bereits als Favorit → aktiv)
    const starBtn = clone.querySelector('[data-action="star"]');
    if (starBtn) {
      updateStarBtn(starBtn, true);
      starBtn.addEventListener('click', () => {
        toggleFavorite(cmd);
        renderFavorites(allCommands);    // Section neu rendern
        refreshStarButtons(allCommands); // Hauptliste aktualisieren
      });
    }

    fragment.appendChild(clone);
  });

  container.replaceChildren(fragment);
}

/**
 * Aktualisiert alle Stern-Buttons in der Hauptliste.
 * Wird nach jedem Toggle aufgerufen.
 * @param {Object[]} allCommands
 */
function refreshStarButtons(allCommands) {
  document.querySelectorAll('[data-cmd-id]').forEach(card => {
    const cmd = allCommands.find(c => c.id === card.dataset.cmdId);
    if (!cmd) return;
    const btn = card.querySelector('[data-action="star"]');
    if (btn) updateStarBtn(btn, isFavorite(cmd));
  });
}


// ── Init ──────────────────────────────────────────────────
// renderFavorites() wird von render.js nach loadCommands() aufgerufen
