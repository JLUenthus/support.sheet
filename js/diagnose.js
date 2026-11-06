// ============================================================
// diagnose.js – Anbindung der Diagnoseseite (diagnose.html) an js/diagnose-core.js
// Alle Texte gehen über textContent (nie innerHTML). Die Schnittstellen des Browsers werden bei jedem Aufruf frisch gelesen (nicht beim Laden festgehalten),
// fehlt eine (kein Service Worker, kein File System Access, kein caches), zeigt der Abschnitt "nicht unterstützt" und es entsteht kein Konsolenfehler.
// Nichts wird gespeichert (kein localStorage, kein IndexedDB-Schreiben). Der Bericht entsteht nur aus den Ergebnissen von DiagnoseCore.
// ============================================================
(function () {
  'use strict';
  const C = window.DiagnoseCore;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = { app: null, files: null, storage: null, env: null, selftest: null, action: null, persist: null };
  let running = { files: null, selftest: null };

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
  function ampel(status) { return el('span', 'dg-ampel dg-ampel--' + status, C.AMPEL_TEXT[status] || status); }
  function setAmpel(id, status) { const s = $(id); if (!s) return; s.textContent = ''; s.appendChild(ampel(status)); }
  function setTodo(id, text) { const t = $(id); if (t) t.textContent = text; }
  function rows(id, list) {
    const box = $(id); if (!box) return;
    box.textContent = '';
    list.forEach(([key, val, status]) => {
      const r = el('div', 'dg-row');
      r.appendChild(el('div', 'dg-row-key', key));
      const v = el('div', 'dg-row-val');
      v.appendChild(el('span', '', val));
      if (status) v.appendChild(ampel(status));
      r.appendChild(v); box.appendChild(r);
    });
  }
  const firstHint = (...hints) => (hints.map((h) => (h || '').trim()).find(Boolean)) || '';
  function refreshReport() { const ta = $('dg-report-text'); if (ta) ta.value = C.buildReport(state, Date.now()); }

  // ── Schnittstellen (frisch gelesen) ──
  const hasPicker = () => typeof window.showDirectoryPicker === 'function';
  function appEnv() { return { serviceWorker: navigator.serviceWorker || undefined, caches: window.caches || undefined, fetchFn: (u, i) => window.fetch(u, i), baseUrl: location.href, now: Date.now() }; }
  function safeLS() { try { return window.localStorage; } catch (e) { return undefined; } }

  // Liest nur den gespeicherten Ordner-Handle (lesende Transaktion; öffnet ohne Versionsnummer, eine fehlende Datenbank wird nicht angelegt). Der Kern fragt davon nur die Berechtigung ab.
  function readHandle() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      let req; try { req = window.indexedDB.open('guidesheet-db'); } catch (e) { return resolve(null); }
      let created = false;
      req.onupgradeneeded = () => { created = true; try { req.transaction.abort(); } catch (e) { /* */ } };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        if (created || !db.objectStoreNames.contains('fs-handles')) { try { db.close(); } catch (e) { /* */ } return resolve(null); }
        try {
          const g = db.transaction('fs-handles', 'readonly').objectStore('fs-handles').get('root-handle');
          g.onsuccess = () => { try { db.close(); } catch (e) { /* */ } resolve(g.result || null); };
          g.onerror = () => { try { db.close(); } catch (e) { /* */ } resolve(null); };
        } catch (e) { try { db.close(); } catch (e2) { /* */ } resolve(null); }
      };
    });
  }
  const storageEnv = () => ({ hasPicker: hasPicker(), hasIndexedDB: !!window.indexedDB, indexedDB: window.indexedDB || undefined, getHandle: readHandle, storage: navigator.storage || undefined, localStorage: safeLS(), now: Date.now() });

  // ── 1. Stand der App ──
  async function refreshApp() {
    setTodo('dg-app-todo', 'Prüfe …');
    let app;
    try { app = await C.collectApp(appEnv()); } catch (e) { app = null; }
    state.app = app;
    if (!app) { setAmpel('dg-app-ampel', 'warn'); setTodo('dg-app-todo', 'Die Prüfung ist fehlgeschlagen.'); refreshReport(); return null; }
    const v = app.version, w = app.sw, c = app.cache;
    const list = [
      ['Version der laufenden Seite', v.running || 'unbekannt (kein App-Cache)'],
      ['Version auf dem Server', v.server || ('unbekannt' + (app.serverError ? ' (' + app.serverError + ')' : ''))],
      ['Vergleich', v.text, v.status],
      ['Service Worker', w.state + (w.scope ? ', Geltungsbereich ' + safePath(w.scope) : ''), w.status],
      ['Einträge im Cache gegenüber ASSETS', c.expected === null ? 'unbekannt' : c.cached + ' von ' + c.expected, c.status],
    ];
    if (c.missing && c.missing.length && c.expected !== null && c.missing.length < c.expected) list.push(['Fehlende Cache-Einträge', c.missing.slice(0, 25).join(', ') + (c.missing.length > 25 ? ' … (+' + (c.missing.length - 25) + ')' : '')]);
    rows('dg-app-rows', list);
    setAmpel('dg-app-ampel', app.status);
    setTodo('dg-app-todo', firstHint(v.hint, w.hint, c.hint) || 'Nichts zu tun.');
    refreshReport();
    return app;
  }
  function safePath(url) { try { return new URL(url).pathname; } catch (e) { return String(url); } }

  // ── 2. Dateien auf dem Server ──
  async function ensureAssets() {
    if (state.app && state.app.assets) return state.app.assets;
    const app = await refreshApp();
    return app && app.assets ? app.assets : null;
  }
  function renderFiles(f) {
    rows('dg-files-rows', [['Geprüft', f.checked + ' von ' + f.total + (f.aborted ? ' (abgebrochen)' : ''), f.aborted ? 'warn' : null], ['Fehlend', String(f.missing.length), f.missing.length ? 'err' : 'ok']]);
    const ul = $('dg-files-missing'); ul.textContent = '';
    f.missing.forEach((m) => { const li = el('li', 'dg-li--err', m.name); li.appendChild(el('span', 'dg-li-sub', m.problem)); ul.appendChild(li); });
    setAmpel('dg-files-ampel', f.status);
    setTodo('dg-files-todo', f.text + (f.hint ? ' ' + f.hint : ''));
  }
  async function runFiles() {
    if (running.files) return null;
    const run = $('dg-files-run'), cancel = $('dg-files-cancel'), prog = $('dg-files-progress'), cnt = $('dg-files-count');
    run.disabled = true; setTodo('dg-files-todo', 'Lese die Dateiliste …'); $('dg-files-missing').textContent = '';
    const assets = await ensureAssets();
    if (!assets) { run.disabled = false; setAmpel('dg-files-ampel', 'warn'); setTodo('dg-files-todo', 'Die Dateiliste (sw.js) ist nicht lesbar. Verbindung prüfen.'); return null; }
    const ac = new AbortController(); running.files = ac; cancel.disabled = false;
    prog.max = assets.length; prog.value = 0; cnt.textContent = '0 von ' + assets.length; setTodo('dg-files-todo', 'Prüfe …');
    let f;
    try {
      f = await C.checkFiles({ assets, fetchFn: (u, i) => window.fetch(u, i), signal: ac.signal, onProgress: (d, t) => { prog.value = d; cnt.textContent = d + ' von ' + t; } });
    } finally { running.files = null; run.disabled = false; cancel.disabled = true; }
    state.files = f; renderFiles(f); refreshReport();
    return f;
  }

  // ── 3. Speicher ──
  async function refreshStorage() {
    setTodo('dg-storage-todo', 'Prüfe …');
    let s;
    try { s = await C.collectStorage(storageEnv()); } catch (e) { s = null; }
    state.storage = s;
    if (!s) { setAmpel('dg-storage-ampel', 'warn'); setTodo('dg-storage-todo', 'Die Prüfung ist fehlgeschlagen.'); refreshReport(); return null; }
    const list = [
      ['Speichermodus', s.mode.text, s.mode.mode === 'keiner' ? 'err' : null],
      ['Guide-Ordner', s.folder.state, s.mode.mode === 'Ordner' ? s.folder.status : null],
      ['Dauerhafter Speicher', s.persist.text, s.persist.status],
      ['Belegung', s.estimate.text, s.estimate.status],
    ];
    s.databases.forEach((d) => list.push(['Datenbank ' + d.name, d.state + (d.counts ? ' (' + Object.keys(d.counts).map((k) => k + ' ' + d.counts[k]).join(', ') + ')' : '')]));
    list.push(['Letztes Backup', s.backup.state === 'nie' ? 'nie gesichert' : s.backup.at + ', vor ' + s.backup.ageDays + ' Tagen', s.backup.status]);
    rows('dg-storage-rows', list);
    setAmpel('dg-storage-ampel', s.status);
    const hint = firstHint(s.backup.status === 'ok' ? '' : s.backup.hint, s.mode.mode === 'Ordner' && s.folder.status !== 'ok' && s.folder.status !== 'na' ? s.folder.hint : '', s.persist.hint, s.estimate.status === 'ok' || s.estimate.status === 'na' ? '' : 'Speicher fast voll: nicht benötigte Daten löschen.');
    setTodo('dg-storage-todo', hint || 'Nichts zu tun.');
    refreshReport();
    return s;
  }
  async function persist() {
    const r = await C.requestPersist({ storage: navigator.storage || undefined });
    state.persist = r;
    refreshReport();   // das Berichtsfeld ist aktuell, sobald das Ergebnis erscheint (nicht erst nach dem erneuten Lesen des Speichers)
    const box = $('dg-persist-result'); box.textContent = '';
    box.appendChild(ampel(r.status)); box.appendChild(document.createTextNode(' ' + r.text + (r.hint ? ' ' + r.hint : '')));
    await refreshStorage();
    return r;
  }

  // ── 4. Umgebung ──
  async function refreshEnv() {
    let brave = false;
    try { brave = !!(navigator.brave && (await navigator.brave.isBrave())); } catch (e) { brave = false; }
    let e;
    try {
      e = C.collectEnv({ navigator, innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio, isSecureContext: window.isSecureContext, matchMedia: window.matchMedia ? (q) => window.matchMedia(q) : undefined,
        hasPicker: hasPicker(), hasCaches: !!window.caches, hasIndexedDB: !!window.indexedDB, queryCommandSupported: (c) => document.queryCommandSupported(c), brave });
    } catch (err) { e = null; }
    state.env = e;
    if (!e) { setAmpel('dg-env-ampel', 'warn'); setTodo('dg-env-todo', 'Die Prüfung ist fehlgeschlagen.'); refreshReport(); return null; }
    const list = [['Browser', e.browser], ['Betriebssystem', e.os], ['Sprache', e.language], ['Sicherer Kontext', e.secureContext ? 'ja' : 'nein', e.secureContext ? null : 'err'], ['Verbindung', e.online ? 'online' : 'offline', e.online ? null : 'warn'],
      ['Fenstergröße', e.window], ['Pixeldichte (Zoom)', e.zoomHint], ['Bewegung (prefers-reduced-motion)', e.reducedMotion]];
    Object.keys(e.features).forEach((k) => list.push(['Unterstützung ' + k, e.features[k] ? 'ja' : 'nein']));
    rows('dg-env-rows', list);
    setAmpel('dg-env-ampel', e.status);
    setTodo('dg-env-todo', e.hint || 'Nichts zu tun.');
    refreshReport();
    return e;
  }

  // ── 5. Selbsttest Bedienbarkeit ──
  // Dieselbe Logik wie tests/lib/hit-test.js: Mitte des Elements nach scrollIntoView, document.elementFromPoint muss das Element oder einen Nachfahren liefern. Es wird nichts geklickt.
  const CONTROLS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])';
  function describe(node) {
    if (!node) return '(nichts)';
    const cls = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    return node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (cls ? '.' + cls : '');
  }
  function labelOf(node) {
    const plain = /^(a|button|summary)$/i.test(node.tagName) || node.getAttribute('role') === 'button';
    const t = ((node.getAttribute('aria-label') || (plain ? node.textContent : '') || '') + '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return node.id ? '#' + node.id : describe(node) + (t ? ' "' + t + '"' : '');
  }
  function isVisible(win, node) {
    if (node.closest('[hidden], [aria-hidden="true"]')) return false;
    const dlg = node.closest('dialog'); if (dlg && !dlg.open) return false;
    for (let d = node.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) { if (!d.open && !(node.closest('summary') && node.closest('summary').parentElement === d)) return false; }
    const cs = win.getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = node.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false;
    for (let p = node.parentElement; p && p !== win.document.body; p = p.parentElement) { if (win.getComputedStyle(p).display === 'none') return false; }
    return true;
  }
  function stuck(win, node) { for (let n = node; n && n.nodeType === 1; n = n.parentElement) { const p = win.getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; }
  const firstRect = (node) => { const q = [...node.getClientRects()].filter((x) => x.width > 0 && x.height > 0); return q.length ? q[0] : node.getBoundingClientRect(); };
  // Füllt ein fest positioniertes Element (Dialog mit Hintergrund, zum Beispiel der Hinweis auf der GPO-Seite) das ganze Fenster, liegt der Rest der Seite absichtlich dahinter: das ist kein Fehler,
  // die Bedienelemente dahinter sind aber nicht prüfbar und werden gezählt (behind), nicht als verdeckt gemeldet. Erkannt an den vier Ecken und der Mitte des Fensters.
  function fullscreenOverlay(win, doc) {
    const w = win.innerWidth, h = win.innerHeight; let found = null;
    for (const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3], [w / 2, h / 2]]) {
      let e = doc.elementFromPoint(x, y);
      while (e && e !== doc.body && e !== doc.documentElement && win.getComputedStyle(e).position !== 'fixed') e = e.parentElement;
      if (!e || e === doc.body || e === doc.documentElement || (found && found !== e)) return null;
      found = e;
    }
    const r = found.getBoundingClientRect();
    return r.width >= w * 0.95 && r.height >= h * 0.95 ? found : null;
  }
  function checkOne(win, doc, node) {
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
    let r = firstRect(node);
    if (r.width <= 0 || r.height <= 0) return { outside: true };
    let cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > win.innerWidth || cy > win.innerHeight) return { outside: true };
    let hit = doc.elementFromPoint(cx, cy);
    if (hit && !(hit === node || node.contains(hit)) && stuck(win, hit) && !stuck(win, node)) {   // fest oder klebend verdeckt: einmal ans untere Ende rollen
      node.scrollIntoView({ block: 'end', inline: 'nearest' });
      r = firstRect(node);
      const h2 = r.width > 0 && r.height > 0 ? doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      if (h2 && (h2 === node || node.contains(h2))) hit = h2;
    }
    if (!hit || !(hit === node || node.contains(hit))) return { blocked: true, element: labelOf(node), blocker: describe(hit) };
    return {};
  }

  async function checkPage(page, vp, timeoutMs, signal) {
    const t0 = Date.now(), deadline = t0 + timeoutMs;
    const aborted = () => !!(signal && signal.aborted);
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts');   // keine Dialoge, keine Navigation des Hauptfensters, kein Popup
    frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1; frame.title = 'Selbsttest: ' + page; frame.className = 'dg-testframe';
    frame.style.width = vp.w + 'px'; frame.style.height = vp.h + 'px';
    let loads = 0, lastLoad = 0, obs = null, obsDoc = null, mutated = 0;
    frame.addEventListener('load', () => { let href = ''; try { href = frame.contentWindow.location.href; } catch (e) { /* anderer Ursprung */ } if (href !== 'about:blank') { loads++; lastLoad = Date.now(); } });   // das Laden des leeren Anfangsdokuments zählt nicht
    const res = { page, status: 'geprüft', checked: 0, blocked: 0, outside: 0, behind: 0, modal: '', blockedList: [], reason: '' };
    try {
      frame.src = page;
      document.body.appendChild(frame);
      while (!loads && Date.now() < deadline && !aborted()) await sleep(40);
      if (aborted()) { res.status = 'abgebrochen'; return res; }
      if (!loads) { res.status = 'zeitlimit'; res.reason = 'Seite in ' + Math.round(timeoutMs / 1000) + ' s nicht geladen'; return res; }
      // ruhig werden lassen: kein weiterer Ladevorgang und 600 ms ohne Änderung am Dokument (höchstens 60 Prozent der Zeit)
      const settleLimit = t0 + timeoutMs * 0.6;
      for (;;) {
        let doc = null; try { doc = frame.contentDocument; } catch (e) { res.status = 'fehler'; res.reason = 'Seite nicht lesbar (anderer Ursprung)'; return res; }
        if (doc && doc !== obsDoc) { if (obs) { try { obs.disconnect(); } catch (e) { /* */ } } obsDoc = doc; mutated = Date.now(); try { obs = new frame.contentWindow.MutationObserver(() => { mutated = Date.now(); }); obs.observe(doc.documentElement, { childList: true, subtree: true, attributes: true }); } catch (e) { obs = null; } }
        if (aborted()) { res.status = 'abgebrochen'; return res; }
        if (doc && doc.readyState === 'complete' && Date.now() - Math.max(lastLoad, mutated) >= 600) break;
        if (Date.now() > settleLimit) break;
        await sleep(60);
      }
      const win = frame.contentWindow, doc = frame.contentDocument;
      const want = page.split('?')[0].split('/').pop(), got = new URL(win.location.href).pathname.split('/').pop();
      if (want !== got) { res.status = 'fehler'; res.reason = 'Weiterleitung nach ' + got; return res; }
      const root = doc.documentElement, oldBehavior = root.style.scrollBehavior; root.style.scrollBehavior = 'auto';
      const overlay = fullscreenOverlay(win, doc);
      if (overlay) res.modal = describe(overlay);
      const els = [...new Set([...doc.querySelectorAll(CONTROLS)])].filter((n) => !n.disabled && isVisible(win, n)).filter((n) => !(n.closest('.as-update-bar') && !n.closest('.as-update-bar.show'))).filter((n) => { if (overlay && !overlay.contains(n)) { res.behind++; return false; } return true; });
      for (let i = 0; i < els.length; i++) {
        if (aborted()) { res.status = 'abgebrochen'; return res; }
        if (Date.now() > deadline) { res.status = 'zeitlimit'; res.reason = 'Zeitlimit nach ' + res.checked + ' von ' + els.length + ' Elementen'; return res; }
        const c = checkOne(win, doc, els[i]);
        if (c.outside) res.outside++; else { res.checked++; if (c.blocked) { res.blocked++; res.blockedList.push({ element: c.element, blocker: c.blocker }); } }
        if (i % 40 === 39) await sleep(0);
      }
      root.style.scrollBehavior = oldBehavior;
      return res;
    } catch (e) {
      res.status = 'fehler'; res.reason = String(e && e.message || e).slice(0, 120); return res;
    } finally {
      if (obs) { try { obs.disconnect(); } catch (e) { /* */ } }
      try { frame.src = 'about:blank'; } catch (e) { /* */ }
      frame.remove();
    }
  }

  function renderSelftest(results, vpText, done) {
    const sum = C.selftestSummary(results);
    const ul = $('dg-st-list'); ul.textContent = '';
    results.forEach((x) => {
      const li = el('li', x.status === 'übersprungen' ? 'dg-li--skip' : (x.blocked ? 'dg-li--err' : (x.status === 'geprüft' ? '' : 'dg-li--warn')));
      if (x.status === 'übersprungen') { li.appendChild(document.createTextNode(x.page + ': übersprungen')); li.appendChild(el('span', 'dg-li-sub', x.reason)); }
      else if (x.status === 'fehler' || x.status === 'abgebrochen') { li.appendChild(document.createTextNode(x.page + ': ' + x.status)); if (x.reason) li.appendChild(el('span', 'dg-li-sub', x.reason)); }
      else {
        li.appendChild(document.createTextNode(x.page + ': ' + x.checked + ' geprüft, ' + x.blocked + ' verdeckt' + (x.outside ? ', ' + x.outside + ' außerhalb des Fensters' : '') + (x.behind ? ', ' + x.behind + ' hinter dem Dialog ' + x.modal + ' nicht geprüft' : '') + (x.status === 'zeitlimit' ? ' (Zeitlimit, unvollständig)' : '')));
        x.blockedList.forEach((b) => li.appendChild(el('span', 'dg-li-sub', 'verdeckt: ' + b.element + ' durch ' + b.blocker)));
      }
      ul.appendChild(li);
    });
    setAmpel('dg-st-ampel', sum.status);
    setTodo('dg-st-todo', done
      ? (sum.blocked ? sum.blocked + ' verdeckte Bedienelemente gefunden (siehe Liste). Seite und Element der Entwicklung melden.' : (sum.problems ? 'Keine verdeckten Elemente, aber ' + sum.problems + ' Seite(n) nicht vollständig geprüft.' : 'Alle geprüften Bedienelemente sind klickbar. Nichts zu tun.'))
      : 'Läuft …');
    state.selftest = { results, viewport: vpText };
    refreshReport();
  }

  // opts: { check: [Seiten], skip: [{page, reason}], viewport: {w,h}, timeoutMs, signal, onProgress }. Ohne check/skip: Seiten aus ASSETS des Servers.
  async function runSelftest(opts) {
    const o = opts || {};
    if (running.selftest && !o.force) return null;
    const run = $('dg-st-run'), cancel = $('dg-st-cancel'), prog = $('dg-st-progress'), cnt = $('dg-st-count');
    const ac = new AbortController(); running.selftest = ac; run.disabled = true; cancel.disabled = false;
    if (o.signal) o.signal.addEventListener('abort', () => ac.abort());
    const results = [];
    try {
      let check = o.check, skip = o.skip;
      if (!check) {
        setTodo('dg-st-todo', 'Lese die Seitenliste …');
        const assets = await ensureAssets();
        if (!assets) { setAmpel('dg-st-ampel', 'warn'); setTodo('dg-st-todo', 'Die Seitenliste (sw.js) ist nicht lesbar. Verbindung prüfen.'); return null; }
        const sel = C.selftestPages(assets); check = sel.check; skip = sel.skip;
      }
      const size = $('dg-st-size') ? $('dg-st-size').value : 'own';
      const vp = o.viewport || (size === '1280x720' ? { w: 1280, h: 720 } : size === '375x800' ? { w: 375, h: 800 } : { w: window.innerWidth, h: window.innerHeight });
      const vpText = vp.w + ' × ' + vp.h;
      const total = check.length;
      prog.max = Math.max(total, 1); prog.value = 0; cnt.textContent = '0 von ' + total;
      (skip || []).forEach((s) => results.push({ page: s.page, status: 'übersprungen', reason: s.reason, checked: 0, blocked: 0 }));
      renderSelftest(results, vpText, false);
      for (let i = 0; i < check.length; i++) {
        if (ac.signal.aborted) break;
        setTodo('dg-st-todo', 'Prüfe ' + check[i] + ' …');
        const r = await checkPage(check[i], vp, o.timeoutMs || 8000, ac.signal);
        results.push(r);
        prog.value = i + 1; cnt.textContent = (i + 1) + ' von ' + total;
        renderSelftest(results, vpText, false);
        if (o.onProgress) o.onProgress(r);
      }
      if (ac.signal.aborted) results.push({ page: 'Selbsttest', status: 'abgebrochen', reason: 'vom Nutzer abgebrochen', checked: 0, blocked: 0 });
      renderSelftest(results, vpText, true);
      return results;
    } finally { running.selftest = null; run.disabled = false; cancel.disabled = true; }
  }

  // ── 6. App-Dateien neu laden ──
  const CONFIRM_TEXT = 'App-Dateien neu laden?\n\nEntfernt die Service-Worker-Registrierungen und die gespeicherten App-Dateien (Cache) dieser Seite, sonst nichts.\nDeine Daten bleiben erhalten (Guides, Notizen, Vorlagen, Einstellungen).\n\nDanach alle Tabs der App schließen und neu öffnen.';
  async function clearFiles() {
    const r = await C.clearAppFiles({ serviceWorker: navigator.serviceWorker || undefined, caches: window.caches || undefined, confirm: async () => window.confirm(CONFIRM_TEXT) });
    const box = $('dg-clear-result'); box.textContent = '';
    if (r.cancelled) { box.appendChild(document.createTextNode(r.text)); return r; }
    state.action = r;
    box.appendChild(ampel(r.status)); box.appendChild(document.createTextNode(' ' + r.text + ' ' + r.hint));
    refreshReport();
    await refreshApp();
    return r;
  }

  // ── 7. Bericht ──
  async function copyReport() {
    refreshReport();
    const ta = $('dg-report-text'), st = $('dg-report-status'), text = ta.value;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') { await navigator.clipboard.writeText(text); st.textContent = 'Bericht kopiert (' + text.length + ' Zeichen).'; return true; }
    } catch (e) { /* weiter mit dem Rückfall */ }
    try { ta.focus(); ta.select(); if (document.execCommand('copy')) { st.textContent = 'Bericht kopiert (' + text.length + ' Zeichen).'; return true; } } catch (e) { /* */ }
    st.textContent = 'Kopieren nicht möglich. Den Text im Feld markieren und mit Strg+C kopieren.';
    return false;
  }
  function saveReport() {
    refreshReport();
    const text = $('dg-report-text').value, name = C.reportFileName(Date.now());
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    $('dg-report-status').textContent = 'Als Datei gespeichert: ' + name;
    return name;
  }

  // ── Verdrahtung ──
  function on(id, fn) { const b = $(id); if (b) b.addEventListener('click', () => { Promise.resolve().then(fn).catch(() => { /* Fehler stehen im jeweiligen Abschnitt */ }); }); }
  on('dg-app-refresh', refreshApp);
  on('dg-files-run', runFiles);
  on('dg-files-cancel', () => { if (running.files) running.files.abort(); });
  on('dg-storage-refresh', refreshStorage);
  on('dg-persist-btn', persist);
  on('dg-st-run', () => runSelftest());
  on('dg-st-cancel', () => { if (running.selftest) running.selftest.abort(); });
  on('dg-clear-btn', clearFiles);
  on('dg-copy-btn', copyReport);
  on('dg-save-btn', saveReport);

  const ready = Promise.all([refreshApp(), refreshStorage(), refreshEnv()]).then(refreshReport);
  window.DiagnoseApp = { ready, state, refreshApp, refreshStorage, refreshEnv, runFiles, runSelftest, persist, clearFiles, copyReport, saveReport, refreshReport };
})();
