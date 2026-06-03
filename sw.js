// ============================================================
// support.sheet – Service Worker v2
// ============================================================
const CACHE_VERSION = '20260603-0702';
const CACHE_NAME = `support.sheet-${CACHE_VERSION}`;

const ASSETS = [
  './index.html',
  './exchange.html',
  './forti.html',
  './scripts.html',
  './mitmachen.html',
  './tools.html',
  './eventlog.html',
  './data/eventlog-rules.json',
  './data/improvement-rules.json',
  './data/known-harmless.json',
  './data/correlation-rules.json',
  './data/commands.json',
  './data/forti-commands.json',
  './data/exchange-commands.json',
  './nav.js',
  './sw.js',
  './manifest.json',
  './apple-touch-icon.png',
  './favicon-512.png',
  './favicon-192.png',
  './favicon-32.png',
  './favicon.ico',
  './css/main.css',
  './css/toast.css',
  './css/variables.css',
  './css/recent.css',
  './css/favorites.css',
  './css/search.css',
  './css/tools.css',
  './js/loader.js',
  './js/toast.js',
  './js/variables.js',
  './js/recent.js',
  './js/favorites.js',
  './js/search.js',
  './js/render.js',
  './js/settings-store.js',
  './js/tools.js',
  './powershell/Get-SystemInventory.ps1',
  './powershell/Get-LocalAdmins.ps1',
  './powershell/Test-NetworkConnectivity.ps1',
  './powershell/Get-InstalledSoftware.ps1',
  './powershell/Set-PowerPlan-Win11.ps1',
  './powershell/Get-EventLogCollector-Client.ps1',
  './powershell/Get-EventLogCollector-Server.ps1',
  './powershell/Exchange-PreflightCheck.ps1',
  './powershell/Set-BraveDebloat.ps1',
];

// ── INSTALL: Cache alle eigenen Assets ───────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(err => console.warn('[support.sheet SW] Cache miss:', url, err)))
      ))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: Alte Caches löschen + Clients übernehmen ───
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[support.sheet SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
      .then(() => {
        // Alle offenen Tabs über das Update informieren
        self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({
            type: 'SW_UPDATED',
            version: CACHE_VERSION
          }));
        });
      })
  );
});

// ── FETCH: Smarte Cache-Strategie ────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Nur GET, kein chrome-extension
  if (e.request.method !== 'GET' || url.protocol === 'chrome-extension:') return;

  // ── HTML-Seiten: Network First ──────────────────────────
  // Immer frische HTML laden – fällt auf Cache zurück wenn offline
  if (e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok && url.origin === self.location.origin) {
            caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // ── Fonts: Network First ────────────────────────────────
  if (url.hostname.includes('fonts.googleapis') || url.hostname.includes('fonts.gstatic')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // ── Alles andere (JS, JSON, PS1 etc.): Cache First ─────
  // Schnell aus Cache, nur eigene Assets nachcachen
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Nur eigene Assets cachen – kein Müll von externen Quellen
        if (res.ok && url.origin === self.location.origin) {
          caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
        }
        return res;
      });
    })
  );
});

// ── MESSAGE: Manueller Skip-Waiting Trigger ───────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
