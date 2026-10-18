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

  // Kategorien + Tag-Wolke mit echten Daten befüllen. Läuft auf allen
  // guide.sheet-Seiten AUSSER guides.html selbst – dort rendert
  // guides-overview.js dieselben Container bereits mit Klick-Filter und
  // Live-Suche. Beide Skripte sind async; welches zuletzt fertig wird,
  // ist nicht garantiert (Registrierungsreihenfolge ≠ Abschlussreihenfolge),
  // daher hier explizit per #gg-grid (existiert nur auf guides.html)
  // komplett aussteigen, statt auf ein "wird sowieso überschrieben" zu bauen.
  function initCategories() {
    if (document.getElementById('gg-grid')) return;

    const listEl = document.querySelector('.gs-cat-list');
    const tagEl  = document.getElementById('gg-tag-cloud');
    const addBtn = document.getElementById('gs-add-cat-btn');
    const db     = window.GuidesDB;
    if (!db || (!listEl && !tagEl)) return;

    let categories = [];

    function renderCategoryList(guides) {
      if (!listEl) return;
      listEl.replaceChildren();
      const counts = {};
      guides.forEach(g => {
        const c = g.meta.category || 'Allgemein';
        counts[c] = (counts[c] || 0) + 1;
      });
      categories.forEach(cat => {
        const link = document.createElement('a');
        link.className = 'gs-cat-item';
        link.href = 'guides.html?category=' + encodeURIComponent(cat.name);

        const dot = document.createElement('span');
        dot.className = 'gs-cat-dot';
        dot.style.background = cat.color || 'var(--dim)';

        const name = document.createElement('span');
        name.className = 'gs-cat-name';
        name.textContent = cat.name;

        const count = document.createElement('span');
        count.className = 'gs-cat-count';
        count.textContent = String(counts[cat.name] || 0);

        link.append(dot, name, count);
        listEl.appendChild(link);
      });
    }

    function renderTagCloud(guides) {
      if (!tagEl) return;
      tagEl.replaceChildren();
      const tagCounts = {};
      guides.forEach(g => (g.meta.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
      const tagNames = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b, 'de'));

      if (!tagNames.length) {
        const empty = document.createElement('div');
        empty.className = 'gg-tag-cloud-empty';
        empty.textContent = 'Noch keine Tags';
        tagEl.appendChild(empty);
        return;
      }

      tagNames.forEach(tag => {
        const link = document.createElement('a');
        link.className = 'gg-tag-chip';
        link.href = 'guides.html?tag=' + encodeURIComponent(tag);
        link.textContent = tag + ' (' + tagCounts[tag] + ')';
        tagEl.appendChild(link);
      });
    }

    // Ruft bewusst KEIN restoreFolder() auf: initFolderStatus() (unten)
    // erledigt das bereits einmalig und feuert dabei "guides-db-connected" –
    // würde refresh() das hier erneut tun, löst das im IndexedDB-Modus
    // (der Event bei jedem restoreFolder()-Aufruf unbedingt feuert) eine
    // Endlosschleife aus. getCategories()/listGuides() liefern ohne
    // Verbindung einfach eine leere Liste statt zu werfen.
    async function refresh() {
      const catRes = await db.getCategories();
      categories = catRes.categories || [];
      const guidesRes = await db.listGuides();
      const guides = guidesRes.guides || [];
      renderCategoryList(guides);
      renderTagCloud(guides);
    }

    if (addBtn) {
      addBtn.addEventListener('click', async () => {
        const name = (prompt('Name der neuen Kategorie:') || '').trim();
        if (!name) return;
        if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
          notify('Kategorie „' + name + '“ existiert bereits.', 'error');
          return;
        }
        const updated = [...categories, { name, color: 'var(--accent2)', subcategories: [] }];
        const res = await db.saveCategories(updated);
        if (res.success) {
          notify('Kategorie „' + name + '“ angelegt.', 'success');
          await refresh();
        } else {
          notify(res.error || 'Kategorie konnte nicht gespeichert werden.', 'error');
        }
      });
    }

    refresh();
    document.addEventListener('guides-db-connected', refresh);
    document.addEventListener('guides-db-disconnected', refresh);
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

  // ── Backup-Ampel ─────────────────────────────────────────
  // Grün: es gibt eine vollständige Sicherung und seit ihr wurde kein Guide
  // geändert, angelegt, gelöscht oder wiederhergestellt. Rot: nie gesichert oder
  // es gibt Änderungen seit der Sicherung (Anzahl wird angezeigt). Nur eine
  // vollständige Sicherung (GuidesBackup.recordBackup) setzt den Zeitpunkt –
  // weder das lesbare Archiv noch der Export einer einzelnen Kategorie.
  function initBackupStatus() {
    const db  = window.GuidesDB;
    const GB  = window.GuidesBackup;
    const row = document.getElementById('gs-backup-row');
    const dot = document.getElementById('gs-backup-dot');
    if (!row || !dot || !db || !GB) return;

    let info = document.getElementById('gs-backup-info');
    if (!info) {
      info = document.createElement('span');
      info.id = 'gs-backup-info';
      info.className = 'gs-backup-info';
      row.appendChild(info);
    }

    function fmt(iso) {
      if (!iso) return 'nie';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
    }

    let runId = 0;
    async function refresh() {
      const mine = ++runId;
      const st = await GB.getStatus(db);
      if (mine !== runId) return; // ein neuerer Aufruf hat übernommen
      const isOk = !!st.at && st.changed === 0;
      row.classList.toggle('ok', isOk);
      row.classList.toggle('stale', !isOk);
      info.textContent = !st.at ? 'noch keine vollständige Sicherung'
        : st.changed == null ? 'Stand nicht lesbar'
        : st.changed + (st.changed === 1 ? ' Änderung' : ' Änderungen') + ' seit der Sicherung';
      row.title = 'Letzte vollständige Sicherung: ' + fmt(st.at) + (st.changed == null ? '' : '\nGeänderte Guides seitdem: ' + st.changed);
    }

    refresh();
    document.addEventListener('guides-db-connected', refresh);
    document.addEventListener('guides-db-disconnected', refresh);
    document.addEventListener('guides-backup-updated', refresh);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSidebarNav();
    initCategories();
    initFolderStatus();
    initBackupStatus();
  });
})();
