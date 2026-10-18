// ============================================================
// AdminSheet – Toast System
// Global via <script> – kein import/export
// ============================================================

let currentToast = null;

/**
 * Zeigt eine kurze Toast-Nachricht unten rechts.
 * Ersetzt einen laufenden Toast sofort – kein Stapeln bei Mehrfachklick.
 * fade-in + scale-in, automatisch nach 2s entfernt.
 * @param {string} message
 * @param {'success'|'error'|'warning'} type
 * @param {{ persistent?: boolean }} [options]  persistent: bleibt bis zum Schließen (×) stehen und wird weder
 *   von einer späteren Meldung ersetzt noch nach 2 s entfernt – für Fehler, die Datenverlust betreffen.
 *   Ohne Option bleibt das Verhalten unverändert.
 */
function showToast(message, type = 'success', options) {
  if (options && options.persistent) return showPersistentToast(message, type);
  if (currentToast) currentToast.remove();

  const toast = document.createElement('div');
  currentToast = toast;

  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => {
      toast.remove();
      if (currentToast === toast) currentToast = null;
    }, { once: true });
  }, 2000);
}

// Dauerhafte Meldung: eigener Container, unabhängig von currentToast (siehe showToast, options.persistent).
function showPersistentToast(message, type = 'error') {
  let host = document.getElementById('toast-persistent-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-persistent-host';
    host.className = 'toast-persistent-host';
    document.body.appendChild(host);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast--${type} toast--persistent toast--visible`;
  toast.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Meldung schließen');
  close.textContent = '×';
  close.addEventListener('click', () => toast.remove());
  toast.append(text, close);
  host.appendChild(toast);
  while (host.children.length > 5) host.firstChild.remove(); // nicht beliebig viele stapeln
  return toast;
}
