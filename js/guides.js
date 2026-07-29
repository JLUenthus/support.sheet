// ============================================================
// guide.sheet – Sidebar-Logik (Phase 2 – Datenhaltung angebunden)
// Navigation-Highlight, Kategorien-Ausklappen, Ordner-Status.
// Datenzugriff läuft ausschließlich über window.GuidesDB
// (js/guides-db.js – muss vor dieser Datei geladen werden).
// ============================================================
(function() {
  function notify(message, type) {
    if (typeof showToast === 'function') showToast(message, type);
  }

  function initSidebarNav() {
    const current = document.body.dataset.gsPage;
    document.querySelectorAll('.gs-nav-item').forEach(a => {
      if (a.dataset.page === current) a.classList.add('active');
    });
  }

  function initCategories() {
    document.querySelectorAll('.gs-cat-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const sub = btn.nextElementSibling;
        const isOpen = btn.classList.toggle('open');
        if (sub && sub.classList.contains('gs-cat-sub')) sub.classList.toggle('open', isOpen);
      });
    });

    const addBtn = document.getElementById('gs-add-cat-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const name = (prompt('Name der neuen Kategorie:') || '').trim();
        if (!name) return;
        notify('„' + name + '“ – Kategorieverwaltung im Kategoriebaum folgt in Phase 3.', 'success');
      });
    }
  }

  function initFolderStatus() {
    const db = window.GuidesDB;
    const box = document.getElementById('gs-folder-status');
    if (!box || !db) return;

    const banner        = document.getElementById('gs-idb-banner');
    const labelEl        = document.getElementById('gs-folder-label');
    const pathEl         = document.getElementById('gs-folder-path');
    const hintEl         = document.getElementById('gs-folder-hint');
    const connectBtn     = document.getElementById('gs-folder-connect');
    const reconnectBtn   = document.getElementById('gs-folder-reconnect');
    const disconnectBtn  = document.getElementById('gs-folder-disconnect');

    function render() {
      if (db.isIndexedDBMode()) {
        if (banner) banner.hidden = false;
        box.classList.add('connected');
        box.classList.remove('pending');
        labelEl.textContent   = '💾 Browser-Speicher aktiv';
        pathEl.hidden         = true;
        connectBtn.hidden     = true;
        reconnectBtn.hidden   = true;
        disconnectBtn.hidden  = true;
        hintEl.textContent    = 'Kategorien & Guides werden im Browser gespeichert (kein echter Ordner).';
        return;
      }

      if (banner) banner.hidden = true;
      const connected = db.isConnected();
      const perm      = db.getPermissionState();

      if (connected) {
        box.classList.add('connected');
        box.classList.remove('pending');
        labelEl.textContent   = 'Verbunden';
        pathEl.textContent    = db.getFolderPath();
        pathEl.hidden         = false;
        connectBtn.hidden     = true;
        reconnectBtn.hidden   = true;
        disconnectBtn.hidden  = false;
        hintEl.textContent    = 'Ordner-Zugriff wird lokal gecacht (IndexedDB).';
      } else if (perm === 'prompt') {
        box.classList.remove('connected');
        box.classList.add('pending');
        labelEl.textContent   = 'Zugriff abgelaufen';
        pathEl.textContent    = db.getFolderPath();
        pathEl.hidden         = false;
        connectBtn.hidden     = true;
        reconnectBtn.hidden   = false;
        disconnectBtn.hidden  = false;
        hintEl.textContent    = 'Berechtigung erneut bestätigen, um weiterzuarbeiten.';
      } else {
        box.classList.remove('connected', 'pending');
        labelEl.textContent   = 'Kein Ordner verbunden';
        pathEl.hidden         = true;
        connectBtn.hidden     = false;
        reconnectBtn.hidden   = true;
        disconnectBtn.hidden  = true;
        hintEl.textContent    = 'Ordner-Handle wird lokal gecacht (IndexedDB).';
      }
    }

    if (connectBtn) {
      connectBtn.addEventListener('click', async () => {
        const res = await db.openFolder();
        if (res.success) notify('Ordner verbunden: ' + res.path, 'success');
        else if (res.error) notify(res.error, 'error');
        render();
      });
    }

    if (reconnectBtn) {
      reconnectBtn.addEventListener('click', async () => {
        const res = await db.requestPermission();
        if (res.success) notify('Zugriff bestätigt.', 'success');
        else notify(res.error || 'Zugriff wurde nicht gewährt.', 'error');
        render();
      });
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async () => {
        const res = await db.closeFolder();
        if (res.success) notify('Ordner getrennt.', 'success');
        else if (res.error) notify(res.error, 'error');
        render();
      });
    }

    document.addEventListener('guides-db-connected', render);
    document.addEventListener('guides-db-disconnected', render);

    (async () => {
      const res = await db.restoreFolder();
      if (!res.success && res.error) notify(res.error, 'error');
      if (res.permission === 'denied') await db.closeFolder();
      render();
    })();
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSidebarNav();
    initCategories();
    initFolderStatus();
  });
})();
