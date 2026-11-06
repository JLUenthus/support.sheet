// ============================================================
// diagnose-core.js – reine Logik der Diagnoseseite (diagnose.html), ohne DOM.
// Alle Schnittstellen des Browsers (caches, serviceWorker, fetch, indexedDB, storage, localStorage, navigator …) werden übergeben,
// damit die Logik in Node (tests/diagnose-core.test.js) mit Ersatzobjekten geprüft werden kann.
//
// Grundsätze (Auftrag Diagnose):
//   - Der Bericht enthält nur Zustände, Versionen, Zahlen und Namen der App-Dateien. Nie Titel, Notizen, Ordnernamen, Pfade, Kundennamen, Tokens.
//     Deshalb liest die Logik von Datenbanken nur Zahlen (count), vom Ordner nur den Berechtigungszustand, vom Backup-Datensatz nur den Zeitpunkt.
//   - Nur lesend. Ausnahmen: persist() (Knopf "Dauerhaften Speicher anfordern") und clearAppFiles() (Knopf "App-Dateien neu laden"):
//     sie entfernt ausschließlich Service-Worker-Registrierungen und Cache-Speicher, nie IndexedDB, OPFS, localStorage oder den Guide-Ordner.
//   - Prüfung der Dateien auf dem Server: HEAD mit cache:'no-store'. Grund: Der Service Worker (sw.js) beantwortet jede GET-Anfrage für JS, JSON und Bilder
//     zuerst aus seinem Cache (und legt Treffer vom Netz dort ab). Ein GET würde eine auf dem Server fehlende Datei also als vorhanden melden und den Cache
//     verändern. Der Service Worker behandelt nur GET: HEAD geht direkt zum Server. Nur die Datei sw.js selbst wird mit GET und einem Zeitstempel-Parameter
//     gelesen (Treffer im Cache ausgeschlossen); der eine dabei vom Service Worker abgelegte Probe-Eintrag wird danach wieder entfernt (probeAufraeumen).
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiagnoseCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;
  const AMPEL = { ok: 'ok', warn: 'warn', err: 'err', na: 'na' };
  const AMPEL_TEXT = { ok: 'in Ordnung', warn: 'Hinweis', err: 'Fehler', na: 'nicht unterstützt' };
  const CACHE_PREFIX = 'support.sheet-';
  const BACKUP_KEY = 'gs-last-backup';           // localStorage, geschrieben von js/guides-backup.js (recordBackup)
  const BACKUP_WARN_DAYS = 7;
  const REPORT_MISSING_MAX = 25;

  // Bekannte Datenbanken der App (nur Namen und Speicher, aus denen gezählt wird; Inhalte werden nie gelesen)
  const DATABASES = [
    { name: 'guidesheet-db', label: 'Guides', stores: [['guides', 'Guides'], ['assets', 'Anhänge und Bilder']] },
    { name: 'quicknotes-db', label: 'Quicknotes', stores: [['notes', 'Notizen']] },
    { name: 'guide-templates-db', label: 'Vorlagen', stores: [['templates', 'Vorlagen']] },
  ];

  // Seiten, die der Selbsttest Bedienbarkeit nicht lädt (geprüft per Ladetest in frischem Profil, siehe Bericht zum Auftrag): Grund steht im Bericht
  const SELFTEST_AUSNAHMEN = {
    'diagnose.html': 'die Diagnoseseite selbst (würde sich selbst laden)',
    'ticketassistent.html': 'bettet eine fremde Seite ein (jluenthus.github.io): Netzwerkzugriff außerhalb der App',
    'guides.html': 'stellt beim Laden den Guide-Speicher wieder her und schreibt dabei (IndexedDB guidesheet-db, im Ordnermodus _meta.json im Guide-Ordner)',
    'guides-howto.html': 'stellt beim Laden den Guide-Speicher wieder her und schreibt dabei (IndexedDB guidesheet-db, im Ordnermodus _meta.json im Guide-Ordner)',
    'guides-create.html': 'stellt beim Laden den Guide-Speicher wieder her und schreibt dabei (IndexedDB guidesheet-db, im Ordnermodus _meta.json im Guide-Ordner)',
    'guides-manage.html': 'stellt beim Laden den Guide-Speicher wieder her und schreibt dabei (IndexedDB guidesheet-db, im Ordnermodus _meta.json im Guide-Ordner)',
    'guides-view.html': 'stellt beim Laden den Guide-Speicher wieder her und schreibt dabei (IndexedDB guidesheet-db, im Ordnermodus _meta.json im Guide-Ordner)',
    'quicknotes.html': 'legt beim Laden Datenbank und eine Notiz an (quicknotes-db, qn.session) und fordert dauerhaften Speicher an',
    'news.html': 'schreibt beim Laden zwölf Einträge in localStorage (news.*)',
  };

  const worst = (list) => {
    const rank = { na: 0, ok: 1, warn: 2, err: 3 };
    return list.reduce((w, s) => (rank[s] > rank[w] ? s : w), 'na');
  };
  const round1 = (n) => Math.round(n * 10) / 10;
  const fmtMB = (bytes) => { const mb = bytes / 1048576; return mb >= 100 ? String(Math.round(mb)) : String(round1(mb)); };

  // ── Version ───────────────────────────────────────────────────────────────────────────────
  function parseServerSw(text) {
    const t = String(text || '');
    const v = /const\s+CACHE_VERSION\s*=\s*'([^']+)'/.exec(t);
    let assets = null;
    const start = t.indexOf('const ASSETS');
    if (start >= 0) {
      const end = t.indexOf('];', start);
      if (end > start) assets = [...t.slice(start, end).matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
    }
    return { version: v ? v[1] : null, assets: assets && assets.length ? assets : null };
  }

  function versionFromCacheKeys(keys) {
    const mine = (keys || []).filter((k) => typeof k === 'string' && k.startsWith(CACHE_PREFIX));
    return { versions: mine.map((k) => k.slice(CACHE_PREFIX.length)), names: mine };
  }

  function cmpVersion(a, b) {                       // natürlicher Vergleich: Zahlenfolgen numerisch (20261105-export-1 < 20261105-export-10)
    const ta = String(a).match(/\d+|[^\d]+/g) || [], tb = String(b).match(/\d+|[^\d]+/g) || [];
    for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
      const x = ta[i], y = tb[i];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      if (x === y) continue;
      if (/^\d/.test(x) && /^\d/.test(y)) return Number(x) < Number(y) ? -1 : 1;
      return x < y ? -1 : 1;
    }
    return 0;
  }

  function compareVersions(running, server) {
    if (!running) return { state: 'cache-unbekannt', status: AMPEL.warn, running: null, server: server || null, text: 'Kein App-Cache gefunden: die laufende Version ist unbekannt.', hint: 'Seite über http oder https öffnen und einmal neu laden. Wenn der Cache leer bleibt, Service Worker prüfen (Abschnitt unten).' };
    if (!server) return { state: 'server-unbekannt', status: AMPEL.warn, running, server: null, text: 'Version auf dem Server nicht lesbar.', hint: 'Verbindung prüfen. Offline ist das normal.' };
    const dateOf = (v) => { const m = /^(\d{8})/.exec(v); return m ? m[1] : null; };   // Versionen beginnen mit dem Datum; der Rest (export-1, diagnose-1) ist nicht ordenbar
    const dr = dateOf(running), ds = dateOf(server);
    const c = running === server ? 0 : (dr && ds && dr !== ds ? (dr < ds ? -1 : 1) : (dr && ds ? -1 : cmpVersion(running, server)));
    if (c === 0) return { state: 'gleich', status: AMPEL.ok, running, server, text: 'Version ' + running + ' ist aktuell.', hint: '' };
    if (c < 0) return { state: 'update', status: AMPEL.warn, running, server, text: 'Update verfügbar: ' + running + ' läuft, auf dem Server liegt ' + server + '.', hint: 'Alle Tabs der App schließen und neu öffnen.' };
    return { state: 'lokal-neuer', status: AMPEL.warn, running, server, text: 'Die laufende Version ' + running + ' ist neuer als die auf dem Server (' + server + ').', hint: 'Der Server liefert einen älteren Stand. Veröffentlichung prüfen.' };
  }

  // ── Service Worker und Cache ──────────────────────────────────────────────────────────────
  function workerState(info) {
    const i = info || {};
    if (!i.supported) return { state: 'nicht unterstützt', status: AMPEL.na, text: 'Service Worker werden in diesem Browser oder Kontext nicht unterstützt.', hint: 'Seite über https oder localhost öffnen.', scope: null };
    if (!i.registered) return { state: 'nicht registriert', status: AMPEL.warn, text: 'Es ist kein Service Worker registriert: kein Offline-Betrieb, keine Update-Meldung.', hint: 'Eine Seite der App einmal neu laden.', scope: null };
    const scope = i.scope || null;
    if (i.installing) return { state: 'installierend', status: AMPEL.warn, text: 'Ein neuer Service Worker wird gerade installiert.', hint: 'Einen Moment warten, dann Diagnose neu starten.', scope };
    if (i.waiting) return { state: 'wartend', status: AMPEL.warn, text: 'Ein neuer Service Worker wartet auf die Übernahme.', hint: 'Alle Tabs der App schließen und neu öffnen.', scope };
    if (i.active) return { state: 'aktiv', status: i.controlled === false ? AMPEL.warn : AMPEL.ok, text: i.controlled === false ? 'Service Worker aktiv, diese Seite wird aber (noch) nicht von ihm kontrolliert.' : 'Service Worker aktiv und kontrolliert diese Seite.', hint: i.controlled === false ? 'Seite einmal neu laden.' : '', scope };
    return { state: 'unbekannt', status: AMPEL.warn, text: 'Zustand des Service Workers unklar.', hint: 'Seite neu laden.', scope };
  }

  function pathOf(url, base) {
    try { const p = new URL(url, base || 'http://x/').pathname; return p.replace(/^\//, ''); } catch (e) { return String(url).replace(/^\.?\//, ''); }
  }

  function compareCache(assets, cacheUrls, baseUrl) {
    if (!assets || !assets.length) return { status: AMPEL.warn, expected: null, cached: null, missing: [], text: 'Die Liste der App-Dateien (ASSETS) ist nicht lesbar.', hint: 'Verbindung prüfen.' };
    const basePath = baseUrl ? new URL('.', baseUrl).pathname.replace(/^\//, '') : '';
    const have = new Set((cacheUrls || []).map((u) => { const p = pathOf(u, baseUrl); return basePath && p.startsWith(basePath) ? p.slice(basePath.length) : p; }));
    const missing = assets.filter((a) => !have.has(a));
    const cached = assets.length - missing.length;
    if (!missing.length) return { status: AMPEL.ok, expected: assets.length, cached, missing, text: 'Alle ' + assets.length + ' App-Dateien liegen im Cache.', hint: '' };
    return { status: AMPEL.warn, expected: assets.length, cached, missing, text: cached + ' von ' + assets.length + ' App-Dateien im Cache, ' + missing.length + ' fehlen.', hint: missing.length === assets.length ? 'Der Cache ist leer: Seite einmal neu laden, damit der Service Worker ihn füllt.' : 'Offline fehlen diese Dateien. Unter "App-Dateien neu laden" lässt sich der Cache neu aufbauen.' };
  }

  // Abschnitt 1: Stand der App. env: { serviceWorker, caches, fetchFn, baseUrl, now }
  async function collectApp(env) {
    const out = { sw: null, version: null, cache: null, assets: null, serverError: null, status: AMPEL.na };
    const swApi = env.serviceWorker;
    const info = { supported: !!swApi, registered: false, controlled: undefined };
    if (swApi) {
      try {
        const reg = await (swApi.getRegistration ? swApi.getRegistration() : null);
        if (reg) { info.registered = true; info.scope = reg.scope; info.installing = !!reg.installing; info.waiting = !!reg.waiting; info.active = !!reg.active; }
        info.controlled = !!swApi.controller;
      } catch (e) { info.supported = true; }
    }
    out.sw = workerState(info);
    let keys = [], urls = null;
    if (env.caches) {
      try {
        keys = await env.caches.keys();
        const mine = versionFromCacheKeys(keys).names;
        if (mine.length) { const c = await env.caches.open(mine[mine.length - 1]); urls = (await c.keys()).map((r) => r.url); }
      } catch (e) { keys = []; }
    }
    const vk = versionFromCacheKeys(keys);
    const running = vk.versions.length ? vk.versions.slice().sort(cmpVersion).pop() : null;
    let server = null, assets = null;
    if (env.fetchFn) {
      const probeUrl = 'sw.js?diag=' + (env.now || Date.now());
      try {
        const res = await env.fetchFn(probeUrl, { cache: 'no-store' });
        if (res && res.ok) { const p = parseServerSw(await res.text()); server = p.version; assets = p.assets; } else out.serverError = 'HTTP ' + (res && res.status);
      } catch (e) { out.serverError = 'Netzwerkfehler'; }
      await probeAufraeumen(env.caches, vk.names, probeUrl, env.baseUrl);
    }
    out.assets = assets;
    out.version = compareVersions(running, server);
    if (vk.versions.length > 1) out.version = Object.assign({}, out.version, { status: worst([out.version.status, AMPEL.warn]), hint: 'Mehrere App-Caches vorhanden (' + vk.versions.join(', ') + '). Unter "App-Dateien neu laden" aufräumen. ' + out.version.hint });
    out.cache = env.caches ? (urls ? compareCache(assets || null, urls, env.baseUrl) : { status: AMPEL.warn, expected: assets ? assets.length : null, cached: 0, missing: assets || [], text: 'Kein App-Cache vorhanden.', hint: 'Seite einmal neu laden, damit der Service Worker den Cache füllt.' }) : { status: AMPEL.na, expected: null, cached: null, missing: [], text: 'Cache-Speicher wird nicht unterstützt.', hint: '' };
    out.cacheKeys = vk.names.length;
    out.status = worst([out.sw.status, out.version.status, out.cache.status]);
    return out;
  }

  // Der Service Worker legt Treffer vom Netz im Cache ab; der eine Probe-Eintrag (sw.js?diag=…) wird entfernt (mit kurzen Wiederholungen, weil das Ablegen nachläuft).
  async function probeAufraeumen(caches, names, probeUrl, baseUrl) {
    if (!caches || !names || !names.length) return 0;
    const abs = new URL(probeUrl, baseUrl || 'http://x/').href;
    let removed = 0;
    for (let i = 0; i < 4; i++) {
      for (const n of names) { try { const c = await caches.open(n); if (await c.delete(abs)) removed++; } catch (e) { /* weiter */ } }
      if (removed) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    return removed;
  }

  // ── Abschnitt 2: Dateien auf dem Server ──────────────────────────────────────────────────
  // fetchFn(url, { method, cache, signal }). Rückfall auf GET nur, wenn der Server HEAD nicht kennt (405, 501): dann kann der Service Worker aus dem Cache antworten.
  async function checkFiles(opts) {
    const assets = opts.assets || [];
    const fetchFn = opts.fetchFn;
    const signal = opts.signal;
    const conc = Math.max(1, opts.concurrency || 6);
    const missing = [];
    let next = 0, done = 0, viaGet = 0, aborted = false;
    const isAborted = () => !!(signal && signal.aborted);
    async function one(name) {
      const init = { method: 'HEAD', cache: 'no-store' };
      if (signal) init.signal = signal;
      try {
        let res = await fetchFn(name, init);
        if (res && (res.status === 405 || res.status === 501)) { viaGet++; res = await fetchFn(name, { method: 'GET', cache: 'no-store', signal }); try { res.body && res.body.cancel && res.body.cancel(); } catch (e) { /* */ } }
        if (!res || !res.ok) missing.push({ name, problem: 'HTTP ' + (res ? res.status : '?') });
      } catch (e) {
        if (isAborted() || (e && e.name === 'AbortError')) { aborted = true; return; }
        missing.push({ name, problem: 'Netzwerkfehler' });
      }
    }
    async function worker() {
      while (!aborted && !isAborted()) {
        const i = next++;
        if (i >= assets.length) return;
        await one(assets[i]);
        if (aborted) return;
        done++;
        if (opts.onProgress) opts.onProgress(done, assets.length);
      }
      if (isAborted()) aborted = true;
    }
    await Promise.all(Array.from({ length: Math.min(conc, Math.max(assets.length, 1)) }, worker));
    if (isAborted()) aborted = true;
    const status = aborted ? AMPEL.warn : (missing.length ? AMPEL.err : AMPEL.ok);
    const text = aborted ? 'Abgebrochen nach ' + done + ' von ' + assets.length + ' Dateien (' + missing.length + ' fehlen bisher).'
      : (missing.length ? missing.length + ' von ' + assets.length + ' Dateien fehlen auf dem Server oder sind nicht erreichbar.' : 'Alle ' + assets.length + ' Dateien sind auf dem Server vorhanden.');
    const hint = aborted ? 'Prüfung erneut starten.' : (missing.length ? 'Fehlende Dateien beim Veröffentlichen ergänzen (Namen siehe Liste).' : '');
    return { checked: done, total: assets.length, missing, aborted, viaGet, status, text, hint };
  }

  // ── Abschnitt 3: Speicher ────────────────────────────────────────────────────────────────
  function permissionToFolder(p) {
    if (p === 'granted') return { state: 'verbunden', status: AMPEL.ok, text: 'Guide-Ordner verbunden.', hint: '' };
    if (p === 'prompt') return { state: 'Zugriff erneut bestätigen nötig', status: AMPEL.warn, text: 'Der Browser verlangt für den Guide-Ordner eine erneute Bestätigung.', hint: 'In Guides (Lokale DB | Einstellungen) den Zugriff erneut bestätigen.' };
    if (p === 'denied') return { state: 'nicht verbunden', status: AMPEL.warn, text: 'Der Zugriff auf den Guide-Ordner ist verweigert.', hint: 'In Guides (Lokale DB | Einstellungen) den Ordner neu auswählen.' };
    return { state: 'unbekannt', status: AMPEL.warn, text: 'Zustand des Guide-Ordners nicht lesbar.', hint: '' };
  }

  // env: { hasPicker, getHandle() -> Handle|null }. Vom Handle wird nur queryPermission gelesen (der Name des Ordners wird nie benutzt).
  async function folderState(env) {
    if (!env.hasPicker) return { state: 'nicht unterstützt', status: AMPEL.na, text: 'Ordner-Anbindung (File System Access) wird in diesem Browser nicht unterstützt.', hint: 'Guides speichern dann in der Browser-Datenbank (IndexedDB).' };
    let handle = null;
    try { handle = env.getHandle ? await env.getHandle() : null; } catch (e) { return permissionToFolder(null); }
    if (!handle) return { state: 'nicht verbunden', status: AMPEL.warn, text: 'Es ist kein Guide-Ordner verbunden.', hint: 'In Guides (Lokale DB | Einstellungen) einen Ordner wählen, sonst können Guides nicht gespeichert werden.' };
    try { return permissionToFolder(await handle.queryPermission({ mode: 'readwrite' })); } catch (e) { return permissionToFolder(null); }
  }

  function storageMode(env) {
    if (env.hasPicker) return { mode: 'Ordner', text: 'Ordner (File System Access)' };
    if (env.hasIndexedDB) return { mode: 'IndexedDB', text: 'Browser-Datenbank (IndexedDB)' };
    return { mode: 'keiner', text: 'kein Speicher verfügbar' };
  }

  function persistInfo(persisted) {
    if (persisted === null || persisted === undefined) return { value: null, status: AMPEL.na, text: 'nicht unterstützt', hint: '' };
    if (persisted) return { value: true, status: AMPEL.ok, text: 'dauerhaft', hint: '' };
    return { value: false, status: AMPEL.warn, text: 'nicht dauerhaft', hint: 'Der Browser darf Daten bei Platzmangel löschen. "Dauerhaften Speicher anfordern" drücken (Firefox fragt je nach Nutzung).' };
  }

  function estimateInfo(est) {
    if (!est || typeof est.usage !== 'number' || typeof est.quota !== 'number' || est.quota <= 0) return { value: null, status: AMPEL.na, text: 'nicht verfügbar', usedMB: null, quotaMB: null, percent: null };
    const percent = round1(est.usage / est.quota * 100);
    const status = percent >= 95 ? AMPEL.err : percent >= 80 ? AMPEL.warn : AMPEL.ok;
    return { value: true, status, usedMB: fmtMB(est.usage), quotaMB: fmtMB(est.quota), percent, text: fmtMB(est.usage) + ' MB von ' + fmtMB(est.quota) + ' MB (' + percent + ' %)' };
  }

  // Zählt Datensätze je Speicher, ohne Inhalte zu lesen. Öffnet nie mit Versionsnummer; eine nicht vorhandene Datenbank wird nicht angelegt (Upgrade wird abgebrochen).
  function countDatabase(idb, spec, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(Object.assign({ name: spec.name, label: spec.label }, v)); } };
      const timer = setTimeout(() => done({ state: 'nicht prüfbar', counts: null, problem: 'Zeitlimit' }), timeoutMs || 5000);
      let req;
      try { req = idb.open(spec.name); } catch (e) { clearTimeout(timer); return done({ state: 'nicht prüfbar', counts: null, problem: 'open: ' + (e && e.name) }); }
      let created = false;
      req.onupgradeneeded = () => { created = true; try { req.transaction.abort(); } catch (e) { /* */ } };
      req.onerror = () => { clearTimeout(timer); done(created ? { state: 'nicht vorhanden', counts: null } : { state: 'nicht prüfbar', counts: null, problem: 'Fehler beim Öffnen' }); };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        if (created) { try { db.close(); } catch (e) { /* */ } return done({ state: 'nicht vorhanden', counts: null }); }
        const present = spec.stores.filter(([s]) => db.objectStoreNames.contains(s));
        const counts = {};
        if (!present.length) { try { db.close(); } catch (e) { /* */ } return done({ state: 'vorhanden', counts }); }
        let pending = present.length;
        let tx;
        try { tx = db.transaction(present.map(([s]) => s), 'readonly'); } catch (e) { try { db.close(); } catch (e2) { /* */ } return done({ state: 'nicht prüfbar', counts: null, problem: 'Transaktion' }); }
        present.forEach(([s, label]) => {
          const c = tx.objectStore(s).count();
          c.onsuccess = () => { counts[label] = c.result; if (--pending === 0) { try { db.close(); } catch (e) { /* */ } done({ state: 'vorhanden', counts }); } };
          c.onerror = () => { counts[label] = null; if (--pending === 0) { try { db.close(); } catch (e) { /* */ } done({ state: 'vorhanden', counts }); } };
        });
      };
    });
  }

  function backupInfo(raw, now) {
    let at = null;
    try { const rec = JSON.parse(raw); if (rec && typeof rec.at === 'string' && !isNaN(Date.parse(rec.at))) at = rec.at; } catch (e) { /* kein Datensatz */ }
    if (!at) return { state: 'nie', at: null, ageDays: null, status: AMPEL.err, text: 'Es wurde noch nie ein vollständiges Backup erstellt.', hint: 'In Guides (Lokale DB | Einstellungen) ein Backup erstellen.' };
    const ageDays = Math.max(0, Math.floor(((now || Date.now()) - Date.parse(at)) / DAY));
    if (ageDays > BACKUP_WARN_DAYS) return { state: 'alt', at, ageDays, status: AMPEL.warn, text: 'Letztes Backup vor ' + ageDays + ' Tagen (' + at + ').', hint: 'Ein neues Backup erstellen (älter als ' + BACKUP_WARN_DAYS + ' Tage).' };
    return { state: 'aktuell', at, ageDays, status: AMPEL.ok, text: ageDays === 0 ? 'Letztes Backup heute (' + at + ').' : 'Letztes Backup vor ' + ageDays + ' Tagen (' + at + ').', hint: '' };
  }

  // Abschnitt 3 gesamt. env: { hasPicker, hasIndexedDB, indexedDB, getHandle, storage, localStorage, now }
  async function collectStorage(env) {
    const out = {};
    out.mode = storageMode(env);
    out.folder = await folderState(env);
    let persisted = null;
    try { if (env.storage && typeof env.storage.persisted === 'function') persisted = await env.storage.persisted(); } catch (e) { persisted = null; }
    out.persist = persistInfo(persisted);
    let est = null;
    try { if (env.storage && typeof env.storage.estimate === 'function') est = await env.storage.estimate(); } catch (e) { est = null; }
    out.estimate = estimateInfo(est);
    out.databases = [];
    for (const spec of DATABASES) {
      if (!env.indexedDB) { out.databases.push({ name: spec.name, label: spec.label, state: 'nicht unterstützt', counts: null }); continue; }
      out.databases.push(await countDatabase(env.indexedDB, spec));
    }
    let rawBackup = null;
    try { rawBackup = env.localStorage ? env.localStorage.getItem(BACKUP_KEY) : null; } catch (e) { rawBackup = null; }
    out.backup = backupInfo(rawBackup, env.now);
    const statuses = [out.persist.status, out.estimate.status, out.backup.status];
    if (out.mode.mode === 'Ordner') statuses.push(out.folder.status);
    if (out.mode.mode === 'keiner') statuses.push(AMPEL.err);
    out.status = worst(statuses);
    return out;
  }

  // Knopf "Dauerhaften Speicher anfordern". env: { storage }
  async function requestPersist(env) {
    const st = env.storage;
    if (!st || typeof st.persist !== 'function') return { result: 'nicht unterstützt', granted: null, status: AMPEL.na, text: 'Dauerhafter Speicher wird in diesem Browser nicht unterstützt.', hint: '' };
    try {
      const granted = await st.persist();
      if (granted) return { result: 'gewährt', granted: true, status: AMPEL.ok, text: 'Dauerhafter Speicher gewährt.', hint: '' };
      return { result: 'verweigert', granted: false, status: AMPEL.warn, text: 'Dauerhafter Speicher verweigert.', hint: 'Firefox fragt je nach Nutzung (Hinweisleiste, Lesezeichen, häufige Nutzung); Chrome und Edge entscheiden selbst, zum Beispiel nach Installation als App oder Lesezeichen.' };
    } catch (e) { return { result: 'Fehler', granted: null, status: AMPEL.warn, text: 'Anfrage fehlgeschlagen.', hint: '' }; }
  }

  // ── Abschnitt 4: Umgebung ────────────────────────────────────────────────────────────────
  function parseBrowser(ua, opts) {
    const s = String(ua || ''), o = opts || {};
    const major = (re) => { const m = re.exec(s); return m ? m[1] : null; };
    if (o.brave) { const v = major(/Chrome\/(\d+)/); return { name: 'Brave', major: v, text: 'Brave (Chromium ' + (v || '?') + ')' }; }
    let name = 'Unbekannt', v = null;
    if (/Edg\//.test(s)) { name = 'Edge'; v = major(/Edg\/(\d+)/); }
    else if (/OPR\//.test(s)) { name = 'Opera'; v = major(/OPR\/(\d+)/); }
    else if (/Firefox\//.test(s)) { name = 'Firefox'; v = major(/Firefox\/(\d+)/); }
    else if (/Chrome\//.test(s)) { name = 'Chrome'; v = major(/Chrome\/(\d+)/); }
    else if (/Safari\//.test(s)) { name = 'Safari'; v = major(/Version\/(\d+)/); }
    return { name, major: v, text: name + (v ? ' ' + v : '') };
  }

  function parseOs(ua) {
    const s = String(ua || '');
    if (/Windows/.test(s)) return 'Windows';
    if (/Android/.test(s)) return 'Android';
    if (/iPhone|iPad|iPod/.test(s)) return 'iOS';
    if (/Mac OS X|Macintosh/.test(s)) return 'macOS';
    if (/CrOS/.test(s)) return 'ChromeOS';
    if (/Linux|X11/.test(s)) return 'Linux';
    return 'unbekannt';
  }

  // env: { navigator, innerWidth, innerHeight, devicePixelRatio, isSecureContext, matchMedia, hasPicker, hasCaches, queryCommandSupported, brave }
  function collectEnv(env) {
    const nav = env.navigator || {};
    const yn = (b) => (b ? 'ja' : 'nein');
    let reduced = 'unbekannt';
    try { if (env.matchMedia) reduced = env.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduziert' : 'normal'; } catch (e) { /* */ }
    let insertText = false;
    try { insertText = !!(env.queryCommandSupported && env.queryCommandSupported('insertText')); } catch (e) { insertText = false; }
    const dpr = Number(env.devicePixelRatio) || 1;
    const browser = parseBrowser(nav.userAgent, { brave: !!env.brave });
    const features = {
      'Service Worker': !!nav.serviceWorker,
      'Cache-Speicher': !!env.hasCaches,
      'File System Access': !!env.hasPicker,
      'OPFS': !!(nav.storage && typeof nav.storage.getDirectory === 'function'),
      'Zwischenablage (schreiben)': !!(nav.clipboard && typeof nav.clipboard.writeText === 'function'),
      "execCommand('insertText')": insertText,
      'IndexedDB': !!env.hasIndexedDB,
    };
    const out = {
      browser: browser.text,
      os: parseOs(nav.userAgent),
      language: nav.language || 'unbekannt',
      secureContext: !!env.isSecureContext,
      online: nav.onLine !== false,
      window: Math.round(env.innerWidth || 0) + ' × ' + Math.round(env.innerHeight || 0),
      pixelRatio: round1(dpr),
      zoomHint: dpr === 1 ? 'Pixeldichte 1,0' : 'Pixeldichte ' + String(round1(dpr)).replace('.', ',') + ' (Bildschirmskalierung oder Browser-Zoom)',
      reducedMotion: reduced,
      features,
    };
    const st = [];
    if (!out.secureContext) st.push(AMPEL.err);
    if (!out.online) st.push(AMPEL.warn);
    if (!features['Service Worker']) st.push(AMPEL.warn);
    st.push(AMPEL.ok);
    out.status = worst(st);
    out.hint = !out.secureContext ? 'Die Seite läuft nicht in einem sicheren Kontext (https oder localhost): Service Worker, Speicher-Funktionen und Zwischenablage sind eingeschränkt.' : (!out.online ? 'Der Browser meldet "offline".' : '');
    return out;
  }

  // ── Abschnitt 5: Selbsttest Bedienbarkeit (Auswahl der Seiten, Auswertung) ───────────────
  function selftestPages(assets, exceptions) {
    const ex = exceptions || SELFTEST_AUSNAHMEN;
    const html = (assets || []).filter((a) => /\.html$/i.test(a) && a.indexOf('/') < 0);
    return { check: html.filter((p) => !ex[p]), skip: html.filter((p) => ex[p]).map((p) => ({ page: p, reason: ex[p] })) };
  }

  function selftestSummary(results) {
    const r = results || [];
    const checked = r.filter((x) => x.status === 'geprüft' || x.status === 'zeitlimit');
    const blocked = checked.reduce((n, x) => n + (x.blocked || 0), 0);
    const problems = r.filter((x) => x.status === 'fehler' || x.status === 'zeitlimit').length;
    const elements = checked.reduce((n, x) => n + (x.checked || 0), 0);
    const behind = checked.reduce((n, x) => n + (x.behind || 0), 0);
    const status = blocked ? AMPEL.err : (problems || r.some((x) => x.status === 'abgebrochen') ? AMPEL.warn : (checked.length ? AMPEL.ok : AMPEL.na));
    return { pages: r.length, checkedPages: checked.length, skippedPages: r.filter((x) => x.status === 'übersprungen').length, elements, behind, blocked, problems, status };
  }

  // ── Aktion: App-Dateien neu laden ────────────────────────────────────────────────────────
  // Ruft ausschließlich serviceWorker.getRegistrations()[].unregister() und caches.keys()/caches.delete() auf. env: { serviceWorker, caches, confirm }
  async function clearAppFiles(env) {
    if (env.confirm && !(await env.confirm())) return { cancelled: true, unregistered: 0, cachesDeleted: 0, status: AMPEL.na, text: 'Abgebrochen. Es wurde nichts verändert.' };
    let unregistered = 0, cachesDeleted = 0;
    const errors = [];
    if (env.serviceWorker && typeof env.serviceWorker.getRegistrations === 'function') {
      try { const regs = await env.serviceWorker.getRegistrations(); for (const r of regs) { try { if (await r.unregister()) unregistered++; } catch (e) { errors.push('unregister'); } } } catch (e) { errors.push('getRegistrations'); }
    }
    if (env.caches && typeof env.caches.keys === 'function') {
      try { const keys = await env.caches.keys(); for (const k of keys) { try { if (await env.caches.delete(k)) cachesDeleted++; } catch (e) { errors.push('delete'); } } } catch (e) { errors.push('keys'); }
    }
    const status = errors.length ? AMPEL.warn : AMPEL.ok;
    return { cancelled: false, unregistered, cachesDeleted, errors, status, text: unregistered + ' Service-Worker-Registrierung(en) und ' + cachesDeleted + ' Cache-Speicher entfernt. Deine Daten sind unverändert.' + (errors.length ? ' Fehler bei: ' + errors.join(', ') + '.' : ''), hint: 'Jetzt alle Tabs der App schließen und die App neu öffnen.' };
  }

  // ── Bericht ──────────────────────────────────────────────────────────────────────────────
  const SECTION = {
    app: '1. Stand der App',
    files: '2. Dateien auf dem Server',
    storage: '3. Speicher',
    env: '4. Umgebung',
    selftest: '5. Selbsttest Bedienbarkeit',
    action: '6. App-Dateien neu laden',
  };

  function line(key, value) { return key + ': ' + value; }
  const ampelWord = (s) => (AMPEL_TEXT[s] || String(s));
  const dateOnly = (iso) => iso;

  // state: { app, files, storage, env, selftest: { results, viewport }, action, persist }. Enthält nur Zustände, Zahlen, Versionen und Dateinamen der App.
  function buildReport(state, now) {
    const st = state || {};
    const L = [];
    L.push('support.sheet Diagnosebericht');
    L.push(line('Zeitpunkt', new Date(now || Date.now()).toISOString()));
    L.push('Hinweis: ohne Nutzerdaten (keine Titel, Notizen, Ordnernamen, Pfade, Kundennamen, Tokens)');
    L.push('');
    L.push('== ' + SECTION.app + ' ==');
    if (st.app) {
      const a = st.app;
      L.push(line('Ampel', ampelWord(a.status)));
      L.push(line('Version der laufenden Seite (Cache)', a.version.running || 'unbekannt'));
      L.push(line('Version auf dem Server', a.version.server || 'unbekannt' + (a.serverError ? ' (' + a.serverError + ')' : '')));
      L.push(line('Vergleich', a.version.text));
      if (a.version.hint) L.push(line('Hinweis', a.version.hint.trim()));
      L.push(line('Service Worker', a.sw.state + (a.sw.scope ? ', Geltungsbereich ' + new URL(a.sw.scope).pathname : '')));
      L.push(line('App-Caches', String(a.cacheKeys)));
      L.push(line('Einträge im Cache gegenüber ASSETS', a.cache.expected === null ? 'unbekannt' : a.cache.cached + ' von ' + a.cache.expected));
      if (a.cache.missing && a.cache.missing.length && a.cache.expected !== null && a.cache.missing.length < a.cache.expected) L.push(line('Fehlende Cache-Einträge', listNames(a.cache.missing)));
    } else L.push('nicht geprüft');
    L.push('');
    L.push('== ' + SECTION.files + ' ==');
    if (st.files) {
      const f = st.files;
      L.push(line('Ampel', ampelWord(f.status)));
      L.push(line('Geprüft', f.checked + ' von ' + f.total + (f.aborted ? ' (abgebrochen)' : '')));
      L.push(line('Fehlend', String(f.missing.length)));
      if (f.missing.length) L.push(line('Fehlende Dateien', listNames(f.missing.map((m) => m.name + ' (' + m.problem + ')'))));
      if (f.viaGet) L.push(line('Hinweis', 'Der Server kennt HEAD nicht; ' + f.viaGet + ' Datei(en) wurden per GET geprüft (Treffer im Cache möglich)'));
    } else L.push('nicht geprüft');
    L.push('');
    L.push('== ' + SECTION.storage + ' ==');
    if (st.storage) {
      const s = st.storage;
      L.push(line('Ampel', ampelWord(s.status)));
      L.push(line('Speichermodus', s.mode.text));
      L.push(line('Guide-Ordner', s.folder.state));
      L.push(line('Dauerhafter Speicher', s.persist.text));
      if (st.persist) L.push(line('Anfrage "Dauerhaften Speicher anfordern"', st.persist.result));
      L.push(line('Belegung', s.estimate.text));
      s.databases.forEach((d) => {
        const counts = d.counts ? Object.keys(d.counts).map((k) => k + ' ' + d.counts[k]).join(', ') : '';
        L.push(line('Datenbank ' + d.name, d.state + (counts ? ' (' + counts + ')' : '')));
      });
      L.push(line('Letztes Backup', s.backup.state === 'nie' ? 'nie' : dateOnly(s.backup.at) + ', vor ' + s.backup.ageDays + ' Tagen'));
      L.push(line('Backup-Ampel', ampelWord(s.backup.status)));
    } else L.push('nicht geprüft');
    L.push('');
    L.push('== ' + SECTION.env + ' ==');
    if (st.env) {
      const e = st.env;
      L.push(line('Ampel', ampelWord(e.status)));
      L.push(line('Browser', e.browser));
      L.push(line('Betriebssystem', e.os));
      L.push(line('Sprache', e.language));
      L.push(line('Sicherer Kontext', e.secureContext ? 'ja' : 'nein'));
      L.push(line('Verbindung', e.online ? 'online' : 'offline'));
      L.push(line('Fenstergröße', e.window));
      L.push(line('Pixeldichte', String(e.pixelRatio).replace('.', ',')));
      L.push(line('Bewegung (prefers-reduced-motion)', e.reducedMotion));
      Object.keys(e.features).forEach((k) => L.push(line('Unterstützung ' + k, e.features[k] ? 'ja' : 'nein')));
    } else L.push('nicht geprüft');
    L.push('');
    L.push('== ' + SECTION.selftest + ' ==');
    if (st.selftest && st.selftest.results && st.selftest.results.length) {
      const r = st.selftest.results, sum = selftestSummary(r);
      L.push(line('Ampel', ampelWord(sum.status)));
      L.push(line('Fenstergröße des Tests', st.selftest.viewport || 'unbekannt'));
      L.push(line('Seiten', sum.checkedPages + ' geprüft, ' + sum.skippedPages + ' übersprungen, ' + sum.problems + ' mit Problem'));
      L.push(line('Elemente geprüft', String(sum.elements)));
      L.push(line('Verdeckt', String(sum.blocked)));
      r.forEach((x) => {
        if (x.status === 'übersprungen') L.push(line(x.page, 'übersprungen: ' + x.reason));
        else if (x.status === 'fehler' || x.status === 'abgebrochen') L.push(line(x.page, x.status + (x.reason ? ': ' + x.reason : '')));
        else {
          L.push(line(x.page, x.checked + ' geprüft, ' + x.blocked + ' verdeckt' + (x.outside ? ', ' + x.outside + ' außerhalb des Fensters' : '') + (x.behind ? ', ' + x.behind + ' hinter dem Dialog ' + x.modal + ' nicht geprüft' : '') + (x.status === 'zeitlimit' ? ' (Zeitlimit, unvollständig)' : '')));
          (x.blockedList || []).forEach((b) => L.push('  verdeckt: ' + b.element + ' durch ' + b.blocker));
        }
      });
    } else L.push('nicht geprüft');
    if (st.action) {
      L.push('');
      L.push('== ' + SECTION.action + ' ==');
      L.push(line('Ergebnis', st.action.cancelled ? 'abgebrochen' : st.action.unregistered + ' Registrierung(en), ' + st.action.cachesDeleted + ' Cache-Speicher entfernt'));
    }
    return L.join('\n') + '\n';
  }

  function listNames(names) {
    const n = names.slice(0, REPORT_MISSING_MAX);
    return n.join(', ') + (names.length > n.length ? ', … (+' + (names.length - n.length) + ')' : '');
  }

  function reportFileName(now) {
    const d = new Date(now || Date.now()), p = (n) => String(n).padStart(2, '0');
    return 'support-sheet-diagnose-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.txt';
  }

  return {
    AMPEL, AMPEL_TEXT, DATABASES, BACKUP_KEY, SELFTEST_AUSNAHMEN, SECTION, CACHE_PREFIX,
    worst, parseServerSw, versionFromCacheKeys, cmpVersion, compareVersions, workerState, compareCache, collectApp, probeAufraeumen,
    checkFiles, folderState, storageMode, persistInfo, estimateInfo, countDatabase, backupInfo, collectStorage, requestPersist,
    parseBrowser, parseOs, collectEnv, selftestPages, selftestSummary, clearAppFiles, buildReport, reportFileName,
  };
}));
