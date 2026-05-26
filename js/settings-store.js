// ============================================================
// support.sheet – settings-store.js
// Gemeinsamer Settings-Zugriff für alle Seiten.
// Wird vor variables.js und tools.js geladen.
// ============================================================

const SETTINGS_KEY = 'supportsheet_settings';

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {
      defaultDomain:   '',
      defaultServer:   '',
      defaultUsername: '',
      preferredTags:   [],
    };
    const parsed = JSON.parse(raw);
    return {
      defaultDomain:   String(parsed.defaultDomain   || ''),
      defaultServer:   String(parsed.defaultServer   || ''),
      defaultUsername: String(parsed.defaultUsername || ''),
      preferredTags:   Array.isArray(parsed.preferredTags) ? parsed.preferredTags : [],
      savedAt:         parsed.savedAt || '',
    };
  } catch {
    return { defaultDomain: '', defaultServer: '', defaultUsername: '', preferredTags: [] };
  }
}
