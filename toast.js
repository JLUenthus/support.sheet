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
 * @param {'success'|'error'} type
 */
function showToast(message, type = 'success') {
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
