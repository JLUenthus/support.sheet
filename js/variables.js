// ============================================================
// AdminSheet – Copy mit Variablen
// Vanilla JS, kein Framework, kein innerHTML für User-Input
// ============================================================

// Zentrale Regex – einmal definiert, überall verwendet
const VARIABLE_REGEX = /\{([a-z][a-z0-9_]*)\}/g;

// Erlaubte Zeichen für Variablenwerte: Buchstaben der lateinischen Schrift (auch Umlaute, ß und Akzentbuchstaben), Ziffern, Leerzeichen und . _ @ - \ : / sowie die feste Folge (x86)
// (Laufwerke D:\Daten, C:\Program Files (x86)\App, UNC- und URL-Pfade). Verhindert Command-Injection wie: max && del c:\
// Klammern sind nur als (x86) erlaubt: In PowerShell ist ein Wert in Klammern ohne Anführungszeichen ein Unterausdruck und würde ausgeführt.
// Abgelehnt bleiben alle Zeichen, die in einem Befehl etwas auslösen: ; & | " ' ` < > $ * ? ^ % { } [ ] ! , = ( ) (außer als (x86)) und Steuerzeichen,
// dazu Buchstaben anderer Schriften (kyrillische und griechische Lookalikes), typografische Anführungszeichen (‘ ’ “ ”), Gedanken- und Minuszeichen (– — ― −, PowerShell behandelt sie wie -)
// und Leerzeichen-Varianten (geschütztes Leerzeichen u. a.); erlaubt ist nur das normale Leerzeichen. \p{Script=Latin} mit dem Flag u: Chrome 64, Edge 79, Firefox 78, Safari 11.1.
const SAFE_VALUE_REGEX = /^(?:[\p{Script=Latin}0-9._@\-\\:\/ ]|\(x86\))+$/iu;


// ── Variablen erkennen ────────────────────────────────────

/**
 * Extrahiert alle {variable} aus einem Command-String.
 * Gibt einzigartige Variablennamen zurück.
 * @param {string} cmd
 * @returns {string[]}  z.B. ['username', 'server']
 */
function extractVariables(cmd) {
  const names = [];
  let match;
  const regex = new RegExp(VARIABLE_REGEX.source, 'g');
  while ((match = regex.exec(cmd)) !== null) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}


// ── Variablen ersetzen ────────────────────────────────────

/**
 * Ersetzt alle {variable} im Command mit den gegebenen Werten.
 * @param {string} cmd
 * @param {Object} values  z.B. { username: 'max', server: 'SRV01' }
 * @returns {string}
 */
function substituteVariables(cmd, values) {
  return cmd.replace(new RegExp(VARIABLE_REGEX.source, 'g'),
    (match, name) => values[name] ?? match
  );
}


// ── Input validieren ──────────────────────────────────────

/**
 * Prüft ob ein Variablenwert sicher ist.
 * Verhindert Command-Injection.
 * @param {string} value
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateValue(value) {
  if (!value.trim()) {
    return { ok: false, reason: 'Wert darf nicht leer sein' };
  }
  if (!SAFE_VALUE_REGEX.test(value)) {
    return { ok: false, reason: `Ungültige Zeichen in "${value}". Erlaubt sind Buchstaben (auch Umlaute und Akzentbuchstaben), Ziffern, Leerzeichen und . _ @ - \\ : / sowie (x86).` };
  }
  return { ok: true };
}


// ── Modal bauen ───────────────────────────────────────────

/**
 * Baut das Modal-DOM ohne innerHTML.
 * @param {string[]} variables
 * @param {string} cmdPreview
 * @returns {{ overlay, inputs, confirmBtn, cancelBtn }}
 */
function buildVariableModal(variables, cmdPreview) {
  const overlay = document.createElement('div');
  overlay.className = 'var-modal-overlay';

  const box = document.createElement('div');
  box.className = 'var-modal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');

  const title = document.createElement('h3');
  title.className = 'var-modal-title';
  title.textContent = 'Variablen ausfüllen';
  box.appendChild(title);

  const preview = document.createElement('code');
  preview.className = 'var-modal-preview';
  preview.textContent = cmdPreview;
  box.appendChild(preview);

  const divider = document.createElement('hr');
  divider.className = 'var-modal-divider';
  box.appendChild(divider);

  const inputs = {};
  variables.forEach(varName => {
    const group = document.createElement('div');
    group.className = 'var-modal-group';

    const label = document.createElement('label');
    label.className = 'var-modal-label';
    label.textContent = varName;

    const input = document.createElement('input');
    input.type        = 'text';
    input.className   = 'var-modal-input';
    input.placeholder = varName;
    input.dataset.var = varName;

    // Default-Werte aus Einstellungen vorbelegen (aus tools.js getSettings)
    if (typeof getSettings === 'function') {
      const s = getSettings();
      const MAP = { domain: s.defaultDomain, server: s.defaultServer, username: s.defaultUsername };
      const def = MAP[varName.toLowerCase()];
      if (def) {
        input.value = def;
        input.placeholder = `${varName} (Standard: ${def})`;
      }
    }

    // Fehlermeldung unter dem Input
    const hint = document.createElement('span');
    hint.className = 'var-modal-hint';
    hint.dataset.hintFor = varName;

    label.appendChild(input);
    group.appendChild(label);
    group.appendChild(hint);
    box.appendChild(group);

    inputs[varName] = input;
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'var-modal-btns';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'var-modal-btn var-modal-btn--cancel';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Abbrechen';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'var-modal-btn var-modal-btn--confirm';
  confirmBtn.type = 'button';
  confirmBtn.textContent = '📋 Kopieren';

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  box.appendChild(btnRow);
  overlay.appendChild(box);

  return { overlay, inputs, confirmBtn, cancelBtn };
}


// ── Modal zeigen ──────────────────────────────────────────

/**
 * Zeigt das Variablen-Modal.
 * Resolved mit validierten Werten, rejects bei Abbrechen.
 * @param {string[]} variables
 * @param {string} cmdPreview
 * @returns {Promise<Object>}
 */
function showVariableModal(variables, cmdPreview) {
  return new Promise((resolve, reject) => {
    const { overlay, inputs, confirmBtn, cancelBtn } =
      buildVariableModal(variables, cmdPreview);

    const close = () => {
      // Escape-Listener entfernen
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('var-modal-overlay--visible');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    };

    const confirm = () => {
      const values = {};
      let valid = true;

      Object.entries(inputs).forEach(([name, input]) => {
        const value = input.value.trim();
        const hint  = overlay.querySelector(`[data-hint-for="${name}"]`);
        const check = validateValue(value);

        if (!check.ok) {
          // Inline-Fehlermeldung zeigen
          hint.textContent = check.reason;
          input.classList.add('var-modal-input--error');
          valid = false;
        } else {
          hint.textContent = '';
          input.classList.remove('var-modal-input--error');
          values[name] = value;
        }
      });

      if (!valid) return; // Modal offen lassen, Fehler anzeigen

      close();
      resolve(values);
    };

    confirmBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', () => { close(); reject(new Error('Abgebrochen')); });

    // ESC schließt, Enter bestätigt
    const onKey = e => {
      if (e.key === 'Escape') { cancelBtn.click(); }
      if (e.key === 'Enter')  { confirm(); }
    };
    document.addEventListener('keydown', onKey);

    // Klick auf Overlay schließt
    overlay.addEventListener('click', e => {
      if (e.target === overlay) cancelBtn.click();
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('var-modal-overlay--visible'));

    // Erstes Input fokussieren
    const first = Object.values(inputs)[0];
    if (first) setTimeout(() => first.focus(), 50);
  });
}


// ── Haupt-Funktion ────────────────────────────────────────

/**
 * Kopiert einen Command – mit Variablen-Prompt wenn nötig.
 * Drop-in Ersatz für copyToClipboard(cmd, btn).
 * @param {Object} cmd  – Volles Command-Objekt { id, name, cmd, tags, ... }
 * @param {HTMLElement} btn
 */
function copyWithVariables(cmd, btn) {
  const variables = extractVariables(cmd.cmd);

  if (variables.length === 0) {
    copyToClipboard(cmd.cmd, btn, cmd);
    return;
  }

  showVariableModal(variables, cmd.cmd)
    .then(values => {
      const resolved = substituteVariables(cmd.cmd, values);
      copyToClipboard(resolved, btn, cmd);
    })
    .catch(() => {
      // Abgebrochen – kein Feedback nötig
    });
}
