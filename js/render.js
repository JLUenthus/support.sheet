// ============================================================
// AdminSheet – Command Renderer
// Nutzt loadCommands() – kein eigener fetch()
// Vanilla JS, kein Framework
// ============================================================


// ── Copy Button ──────────────────────────────────────────

/**
 * Kopiert Text in die Zwischenablage.
 * Fallback für http / ältere Browser über execCommand.
 * @param {string} text
 * @param {HTMLElement} btn
 */
function copyToClipboard(text, btn, command) {
  const onSuccess = () => {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
    if (typeof showToast === 'function') showToast('Kopiert!', 'success');
    // Recent tracken – nur wenn Command-Objekt übergeben wurde
    if (command && typeof addRecent === 'function') {
      addRecent(command, text);
    }
  };

  const onError = err => {
    console.warn('Kopieren fehlgeschlagen', err);
    btn.classList.add('copy-error');
    setTimeout(() => btn.classList.remove('copy-error'), 1500);
    if (typeof showToast === 'function') showToast('Kopieren fehlgeschlagen', 'error');
  };

  // Clipboard API – funktioniert nur auf https
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
      execCommandFallback(text, onSuccess, onError);
    });
  } else {
    // Fallback: execCommand für http / ältere Browser
    execCommandFallback(text, onSuccess, onError);
  }
}

/**
 * Fallback-Kopieren via execCommand (deprecated, aber breite Unterstützung).
 * readonly verhindert mobile Keyboard-Popup.
 * try/catch weil execCommand in manchen Browsern wirft statt false zurückzugeben.
 * @param {string} text
 * @param {Function} onSuccess
 * @param {Function} onError
 */
function execCommandFallback(text, onSuccess, onError) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';

  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length); // iOS

  try {
    const ok = document.execCommand('copy');
    ok ? onSuccess() : onError(new Error('execCommand returned false'));
  } catch (err) {
    onError(err);
  } finally {
    document.body.removeChild(textarea); // immer aufräumen
  }
}


// ── Single Command Card ───────────────────────────────────

/**
 * Klont das Template und befüllt es mit Command-Daten.
 * QuerySelectors einmal pro Card – alle Referenzen gecacht.
 * Nur textContent – kein innerHTML.
 * @param {HTMLTemplateElement} template
 * @param {Object} cmd
 * @returns {DocumentFragment}
 */
function createCommandCard(template, cmd) {
  const clone = template.content.cloneNode(true);

  // Alle Referenzen einmal holen
  const nameEl       = clone.querySelector('[data-field="name"]');
  const descEl       = clone.querySelector('[data-field="desc"]');
  const cmdEl        = clone.querySelector('[data-field="cmd"]');
  const tagContainer = clone.querySelector('[data-field="tags"]');
  const copyBtn      = clone.querySelector('[data-action="copy"]');
  const starBtn      = clone.querySelector('[data-action="star"]');
  const card         = clone.querySelector('.command-card');

  // data-cmd-id für refreshStarButtons()
  if (card) card.dataset.cmdId = cmd.id;

  // Inhalte setzen – nur textContent
  nameEl.textContent = cmd.name;
  descEl.textContent = cmd.desc;
  cmdEl.textContent  = cmd.cmd;

  // Tags
  (Array.isArray(cmd.tags) ? cmd.tags : []).forEach(tag => {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = tag;
    tagContainer.appendChild(span);
  });

  // Copy Button
  copyBtn.addEventListener('click', () => copyWithVariables(cmd, copyBtn));

  // Star Button – defensiv falls favorites.js nicht geladen
  if (starBtn && typeof isFavorite === 'function') {
    updateStarBtn(starBtn, isFavorite(cmd));
    starBtn.addEventListener('click', () => {
      const isNow = toggleFavorite(cmd);
      updateStarBtn(starBtn, isNow);
      if (typeof renderFavorites === 'function') renderFavorites(_allCommands);
    });
  }

  return clone;
}


// ── Render All Commands ───────────────────────────────────

/**
 * Rendert alle Commands in das Container-Element.
 * DocumentFragment: ein einziger DOM-Write am Ende.
 * @param {Array} commands
 * @param {string} containerId
 */
// Globale Referenz – wird von createCommandCard für renderFavorites gebraucht
let _allCommands = [];

function renderCommands(commands, containerId = 'commands-container') {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`renderCommands: Container #${containerId} nicht gefunden`);
    return;
  }

  const template = document.getElementById('command-template');
  if (!template) {
    console.error('renderCommands: #command-template nicht gefunden');
    return;
  }

  _allCommands = commands; // für Star-Buttons und renderFavorites zugänglich

  const fragment = document.createDocumentFragment();
  commands.forEach(cmd => {
    fragment.appendChild(createCommandCard(template, cmd));
  });

  container.replaceChildren(fragment);
  console.log(`✅ ${commands.length} Commands gerendert`);

  // Zähler in Hero + Header aktualisieren
  if (typeof updateCommandCount === 'function') updateCommandCount(commands.length);

  // Favoriten-Section nach der Hauptliste rendern
  if (typeof renderFavorites === 'function') renderFavorites(commands);
}


// ── Start ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadCommands()
    .then(commands => {
      renderCommands(commands);
      if (typeof initSearch    === 'function') initSearch(commands);
      if (typeof initSearchUI  === 'function') initSearchUI();
    })
    .catch(err => console.error('❌ Fehler:', err.message));
});
