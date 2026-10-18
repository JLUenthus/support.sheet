// ============================================================
// support.sheet – quicknotes-convert.js (Quicknote -> neuer Guide)
// Regel: Die Notiz wird nie veraendert oder entfernt, bevor der Guide nachweislich gespeichert ist.
// Ablauf: (1) Notiz speichern (Flush) und den GESPEICHERTEN Stand lesen, rev merken – (2) Text aufbereiten – (3) neuen Guide
// anlegen (freie ID, vorhandene Guides bleiben unberuehrt) – (4) Guide zuruecklesen und Zeichen fuer Zeichen vergleichen –
// (5) erst dann convertedGuideId/convertedAt (und auf Wunsch trashedAt, weich) an der Notiz setzen – (6) Erfolgsmeldung.
// Jeder Fehler laesst die Notiz unveraendert; die Meldung nennt die Ursache und bietet den aufbereiteten Text als .md an.
// guides-db.js wird erst beim ersten Klick auf den Knopf nachgeladen (auf quicknotes.html beim Laden wird der Guide-Speicher
// nie angefasst). Keine Aenderung an GuidesDB oder am Editor: nur die vorhandene Schnittstelle (saveGuide, getGuide, getCategories).
// Alle Texte aus Notizen/Eingaben werden nur ueber textContent/value ausgegeben.
// Erwartet js/quicknotes-db.js, js/quicknotes-io.js und js/quicknotes.js (window.QuickNotesPageInternal) vor dieser Datei.
// ============================================================
(function () {
  const DB = window.QuickNotesDB;
  const IO = window.QuickNotesIO;
  const P = window.QuickNotesPageInternal;
  const $ = (id) => document.getElementById(id);

  const BTN_LABEL = 'In Guide umwandeln';
  const BTN_LABEL_AGAIN = 'Erneut umwandeln';
  const MAX_ID_TRIES = 25;
  const TITLE_MAX = 120;

  // ── Aufbereitung (reine Funktionen) ───────────────────
  function normalizeLf(t) { return String(t == null ? '' : t).replace(/\r\n?/g, '\n'); }

  // Umzaeunung fuer "Als Codeblock": laenger als jede Folge von Backticks im Text, mindestens drei
  function fenceFor(text) {
    let max = 0;
    (String(text).match(/`+/g) || []).forEach((run) => { if (run.length > max) max = run.length; });
    return '`'.repeat(Math.max(3, max + 1));
  }

  // Einzelne Zeilenumbrueche ausserhalb von Codebloecken werden zu harten Umbruechen (zwei Leerzeichen am Zeilenende).
  // Leerzeilen, Codebloecke (``` und ~~~) und eingerueckte Codebloecke bleiben unveraendert.
  function toHardBreaks(text) {
    const lines = text.split('\n');
    let fence = null;      // { ch, len } innerhalb eines Codeblocks
    let prevCode = false;  // vorherige Zeile war eingerueckter Code
    return lines.map((line, i) => {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (m && m[1][0] === fence.ch && m[1].length >= fence.len && line.trim().replace(/[`~]/g, '') === '') fence = null;
        return line;
      }
      if (m) { fence = { ch: m[1][0], len: m[1].length }; prevCode = false; return line; }
      const blank = line.trim() === '';
      const prevBlank = i === 0 || lines[i - 1].trim() === '';
      const indented = /^( {4}|\t)/.test(line) && (prevBlank || prevCode);
      prevCode = indented;
      if (blank || indented) return line;
      const next = lines[i + 1];
      if (next === undefined || next.trim() === '' || /^ {0,3}(`{3,}|~{3,})/.test(next)) return line;
      if (/ {2,}$/.test(line) || /\\$/.test(line)) return line;
      return line + '  ';
    }).join('\n');
  }

  function prepare(text, format) {
    const n = normalizeLf(text);
    if (format === 'breaks') return toHardBreaks(n);
    if (format === 'code') { const f = fenceFor(n); return f + '\n' + n + (n.endsWith('\n') ? '' : '\n') + f + '\n'; }
    return n;
  }

  // Standardtitel -> erste nicht leere Zeile (auf 80 Zeichen gekuerzt); eigener Titel bleibt
  function suggestTitle(rec) {
    if (rec.title !== DB.defaultTitle(rec.createdAt)) return rec.title;
    const first = normalizeLf(rec.text).split('\n').map((s) => s.trim()).find((s) => s) || '';
    return first.slice(0, 80).trim() || rec.title;
  }

  function parseTags(str) {
    const out = [];
    String(str || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((t) => { if (!out.includes(t)) out.push(t); });
    return out;
  }

  // ── Guide-Speicher: erst bei Bedarf laden ─────────────
  let scriptPromise = null;
  function loadGuidesDb() {
    if (window.GuidesDB) return Promise.resolve(window.GuidesDB);
    if (!scriptPromise) {
      scriptPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/guides-db.js';
        s.onload = () => (window.GuidesDB ? resolve(window.GuidesDB) : reject(new Error('guides-db.js stellt GuidesDB nicht bereit.')));
        s.onerror = () => { scriptPromise = null; reject(new Error('guides-db.js konnte nicht geladen werden.')); };
        document.head.appendChild(s);
      });
    }
    return scriptPromise;
  }

  let restored = null;
  async function connect() {
    const G = await loadGuidesDb();
    if (!restored) restored = G.restoreFolder();     // liest ggf. den Ordner-Handle (guidesheet-db) – erst nach dem Klick
    const r = await restored;
    if (!r || r.success === false) restored = null;
    return { G, result: r };
  }

  // Schreibbereit? Im Ordnermodus muss ein Ordner verbunden und freigegeben sein; die Berechtigung wird (aus der Benutzeraktion
  // heraus) bei Bedarf erneut abgefragt.
  async function ensureWritable() {
    const G = window.GuidesDB;
    if (!G.isFilesystemMode() || G.isConnected()) return { ok: true };
    if (G.getPermissionState() === 'prompt' || G.getPermissionState() === 'denied') {
      const r = await G.requestPermission();
      if (r.success) return { ok: true };
      return { ok: false, error: 'Der Guide-Ordner ist nicht freigegeben (' + (r.error || 'Zugriff verweigert') + '). Bitte auf der Seite „Guides“ den Zugriff bestätigen.' };
    }
    return { ok: false, error: 'Es ist kein Guide-Ordner verbunden. Bitte auf der Seite „Guides“ einen Ordner auswählen.' };
  }

  const NOT_FOUND = /nicht gefunden|could not be found|not be found|NotFound/i;

  // Freie Guide-ID: vorhandene Guides (auch im Papierkorb) bleiben unberuehrt
  async function freeId(G) {
    const base = Number((G.generateId().match(/(\d+)$/) || [])[1]) || Date.now();
    for (let i = 0; i < MAX_ID_TRIES; i++) {
      const id = 'guide-' + (base + i);
      const r = await G.getGuide(id);
      if (!r.success && NOT_FOUND.test(r.error || '')) return id;    // gibt es nicht
      // vorhanden – oder nicht eindeutig lesbar: lieber die naechste ID probieren, nie auf einen Guide schreiben
    }
    throw new Error('Es konnte keine freie Guide-ID gefunden werden.');
  }

  // ── Umwandlung (Schritte 2 bis 5) ─────────────────────
  // p: { rec (gespeicherter Stand mit rev), title, category, subcategory, tags, format, trash }
  async function convert(p) {
    const fail = (stage, error, extra) => Object.assign({ ok: false, stage, error, prepared }, extra || {});
    let prepared = '';
    try { prepared = prepare(p.rec.text, p.format); }
    catch (err) { return fail('prepare', 'Der Text konnte nicht aufbereitet werden: ' + (err && err.message || err)); }
    const G = window.GuidesDB;
    if (!G) return fail('create', 'Der Guide-Speicher ist nicht geladen.');

    const w = await ensureWritable();
    if (!w.ok) return fail('create', w.error);

    let id;
    try { id = await freeId(G); } catch (err) { return fail('create', 'Der Guide konnte nicht angelegt werden: ' + (err && err.message || err)); }
    const now = new Date().toISOString();
    const meta = {
      title: p.title, category: p.category, subcategory: p.subcategory, tags: p.tags.slice(), type: 'guide',
      created: now, modified: now, version: 1, favorite: false, source: 'manual', importTag: null, privateNote: '', links: [], attachments: [],
    };
    let saved;
    try { saved = await G.saveGuide(id, meta, prepared); }
    catch (err) { return fail('create', 'Der Guide konnte nicht gespeichert werden: ' + (err && err.message || err), { guideId: id, maybePartial: true }); }
    if (!saved || !saved.success) return fail('create', (saved && saved.error) || 'Der Guide konnte nicht gespeichert werden.', saved && saved.partial ? { guideId: id, maybePartial: true } : {});

    // Nachpruefen: zuruecklesen und Zeichen fuer Zeichen vergleichen
    let back;
    try { back = await G.getGuide(id); } catch (err) { back = { success: false, error: (err && err.message) || String(err) }; }
    if (!back || !back.success) return fail('verify', 'Der neue Guide konnte nicht zurückgelesen werden: ' + ((back && back.error) || 'unbekannter Fehler'), { guideId: id });
    const diffs = [];
    if (back.meta.title !== p.title) diffs.push('Titel');
    if (back.meta.category !== p.category) diffs.push('Kategorie');
    if ((back.meta.subcategory || '') !== p.subcategory) diffs.push('Unterkategorie');
    if (JSON.stringify(back.meta.tags || []) !== JSON.stringify(p.tags)) diffs.push('Tags');
    if (back.content !== prepared) diffs.push('Inhalt');
    if (diffs.length) return fail('verify', 'Der gespeicherte Guide weicht vom erwarteten ab (' + diffs.join(', ') + ').', { guideId: id });
    try { G.invalidateCache(); } catch (e) { /* nur Zwischenspeicher */ }

    // Erst jetzt die Notiz aendern (Text bleibt unveraendert)
    let r;
    try { r = await DB.markConverted(p.rec.id, p.rec.rev, id, !!p.trash); }
    catch (err) { return fail('update', 'Die Notiz konnte nicht aktualisiert werden: ' + (err && err.message || err), { guideId: id }); }
    if (!r.ok) return fail('update', r.conflict ? 'Die Notiz wurde in der Zwischenzeit in einem anderen Fenster geändert und nicht aktualisiert.' : 'Die Notiz existiert nicht mehr.', { guideId: id });
    return { ok: true, id, note: r.note, prepared, title: p.title };
  }

  // ── Oberflaeche ───────────────────────────────────────
  let preparing = false, converting = false, dialogRev = null;
  const guideState = new Map();   // guideId -> { state: 'exists'|'gone'|'unknown', title }

  function guideHref(id) { return 'guides-view.html?id=' + encodeURIComponent(id); }
  function fmtTime(ts) { const d = new Date(ts); const p2 = (n) => String(n).padStart(2, '0'); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }

  function checkGuide(id) {
    if (guideState.has(id)) return;
    guideState.set(id, { state: 'checking' });
    (async () => {
      try {
        const { G } = await connect();
        const r = await G.getGuide(id);
        if (r.success) guideState.set(id, { state: 'exists', title: r.meta && r.meta.title });
        else if (NOT_FOUND.test(r.error || '')) guideState.set(id, { state: 'gone' });
        else guideState.set(id, { state: 'unknown' });
      } catch (e) { guideState.set(id, { state: 'unknown' }); }
      refreshUi();
    })();
  }

  function refreshUi() {
    const btn = $('qn-convert');
    if (!btn) return;
    const doc = P.activeDoc();
    const gid = doc && doc.convertedGuideId;
    const gs = gid ? guideState.get(gid) : null;
    const again = !!gid && !(gs && gs.state === 'gone');
    btn.textContent = '⇒ ' + (again ? BTN_LABEL_AGAIN : BTN_LABEL);
    btn.disabled = !doc || doc.text.trim() === '' || preparing || converting;
    btn.title = doc && doc.text.trim() === '' ? 'Leere Notizen lassen sich nicht umwandeln' : 'Aus dieser Notiz einen neuen Guide anlegen';
    const st = $('qn-st-conv');
    if (!st) return;
    st.replaceChildren();
    if (!gid) { st.hidden = true; return; }
    if (!gs) checkGuide(gid);
    st.hidden = false;
    if (gs && gs.state === 'gone') { st.appendChild(document.createTextNode('Umgewandelt am ' + fmtTime(doc.convertedAt) + ' – der Guide existiert nicht mehr')); return; }
    st.appendChild(document.createTextNode('Umgewandelt am ' + fmtTime(doc.convertedAt) + ' in Guide '));
    const a = document.createElement('a');
    a.href = guideHref(gid);
    a.textContent = gs && gs.title ? '„' + gs.title + '“' : 'öffnen';
    st.appendChild(a);
  }

  function showDialog(rec, cats, catMsg) {
    const dlg = $('qn-convert-dialog');
    $('qn-cv-titlein').value = suggestTitle(rec).slice(0, TITLE_MAX);
    const sel = $('qn-cv-cat');
    sel.replaceChildren();
    const names = cats.map((c) => c.name).filter(Boolean);
    if (!names.length) names.push('Allgemein');
    names.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
    sel.value = names.includes('Allgemein') ? 'Allgemein' : names[0];
    sel.disabled = !!catMsg;
    $('qn-cv-sub').value = '';
    $('qn-cv-tags').value = '';
    dlg.querySelector('input[name="qn-cv-format"][value="markdown"]').checked = true;
    $('qn-cv-trash').checked = true;
    $('qn-cv-open').checked = true;
    $('qn-cv-msg').textContent = catMsg || '';
    $('qn-cv-msg').hidden = !catMsg;
    $('qn-cv-err').hidden = true;
    dialogRev = rec.rev;
    dlg.dataset.noteId = rec.id;
    setFormBusy(false);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    $('qn-cv-titlein').focus();
    $('qn-cv-titlein').select();
  }

  function setFormBusy(on) {
    const dlg = $('qn-convert-dialog');
    dlg.querySelectorAll('input, select, button').forEach((e) => { e.disabled = on || (e.id === 'qn-cv-cat' && dlg.dataset.catFixed === '1'); });
    $('qn-cv-ok').textContent = on ? 'Wird erstellt …' : 'Guide erstellen';
  }

  function closeDialog() {
    const dlg = $('qn-convert-dialog');
    if (dlg.open) dlg.close();
    dlg.removeAttribute('open');
  }

  function errorBanner(res, titleForFile) {
    const idNote = res.guideId
      ? (res.stage === 'create' ? ' Möglicherweise ist ein unvollständiger Guide mit der ID „' + res.guideId + '“ entstanden – bitte prüfen.' : ' Der neue Guide mit der ID „' + res.guideId + '“ bleibt bestehen.')
      : '';
    const kept = ' Die Notiz wurde nicht verändert' + (res.stage === 'update' || res.stage === 'verify' ? ' und nicht in den Papierkorb gelegt' : '') + '.';
    P.banner('convert', 'error', 'Nicht umgewandelt: ' + res.error + idNote + kept, [
      { label: 'Als Markdown-Datei sichern', primary: true, onClick: () => P.download(res.prepared, IO.safeFileName(titleForFile) + '.md') },
    ]);
  }

  async function onButton() {
    if (preparing || converting) return;
    const doc = P.activeDoc();
    if (!doc || doc.text.trim() === '') return;
    const gs = doc.convertedGuideId ? guideState.get(doc.convertedGuideId) : null;
    if (doc.convertedGuideId && !(gs && gs.state === 'gone')) {
      if (!window.confirm('Diese Notiz wurde bereits in einen Guide umgewandelt. Beim erneuten Umwandeln entsteht ein weiterer, neuer Guide (der vorhandene bleibt unverändert). Fortfahren?')) return;
    }
    preparing = true; refreshUi();
    try {
      P.removeBanner('convert');
      // (1) Notiz speichern; umgewandelt wird der gespeicherte Stand
      const rec = await storedStateAfterFlush(doc);
      if (!rec) return;
      const { G } = await connect();
      let cats = [], catMsg = '';
      try {
        const cr = await G.getCategories();
        if (cr && cr.success && Array.isArray(cr.categories) && cr.categories.length) cats = cr.categories;
        else catMsg = 'Die Kategorien konnten nicht geladen werden – es wird „Allgemein“ verwendet.';
      } catch (e) { catMsg = 'Die Kategorien konnten nicht geladen werden – es wird „Allgemein“ verwendet.'; }
      $('qn-convert-dialog').dataset.catFixed = catMsg ? '1' : '0';
      if (!G.isConnected() && G.isFilesystemMode()) {
        catMsg = (catMsg ? catMsg + ' ' : '') + 'Hinweis: Es ist (noch) kein Guide-Ordner freigegeben – beim Erstellen wird der Zugriff abgefragt.';
      }
      showDialog(rec, cats, catMsg);
    } catch (err) {
      P.banner('convert', 'error', 'Die Umwandlung konnte nicht vorbereitet werden: ' + (err && err.message || err) + ' Die Notiz wurde nicht verändert.', []);
    } finally { preparing = false; refreshUi(); }
  }

  // Notiz sofort speichern und den gespeicherten Stand aus quicknotes-db lesen (rev pruefen)
  async function storedStateAfterFlush(doc) {
    await P.flush(doc);
    if (doc.state !== 'saved') {
      P.banner('convert', 'error', 'Nicht umgewandelt: Die Notiz ist noch nicht gespeichert (' + (doc.state === 'conflict' ? 'Konflikt mit einem anderen Fenster' : 'Speichern fehlgeschlagen') + '). Es wurde nichts verändert.', []);
      return null;
    }
    let rec;
    try { rec = await DB.get(doc.id); }
    catch (err) { P.banner('convert', 'error', 'Nicht umgewandelt: Die Notiz konnte nicht gelesen werden (' + (err && err.message || err) + '). Es wurde nichts verändert.', []); return null; }
    if (!rec) { P.banner('convert', 'error', 'Nicht umgewandelt: Die Notiz existiert nicht mehr. Es wurde nichts verändert.', []); return null; }
    if (rec.rev !== doc.savedRev) {
      P.banner('convert', 'error', 'Nicht umgewandelt: Die Notiz wurde in einem anderen Fenster geändert. Bitte den aktuellen Stand laden und es erneut versuchen. Es wurde nichts verändert.', []);
      return null;
    }
    return rec;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    if (converting) return;
    const titleIn = $('qn-cv-titlein');
    const title = titleIn.value.trim();
    if (!title || title.length > TITLE_MAX) {
      $('qn-cv-err').textContent = !title ? 'Bitte einen Titel eingeben.' : 'Der Titel darf höchstens ' + TITLE_MAX + ' Zeichen lang sein.';
      $('qn-cv-err').hidden = false;
      titleIn.focus();
      return;
    }
    $('qn-cv-err').hidden = true;
    converting = true; setFormBusy(true); refreshUi();
    const noteId = $('qn-convert-dialog').dataset.noteId;
    const params = {
      title, category: $('qn-cv-cat').value || 'Allgemein', subcategory: $('qn-cv-sub').value.trim(), tags: parseTags($('qn-cv-tags').value),
      format: (document.querySelector('input[name="qn-cv-format"]:checked') || {}).value || 'markdown',
      trash: $('qn-cv-trash').checked, open: $('qn-cv-open').checked,
    };
    let res;
    try {
      const doc = P.docById(noteId);
      if (!doc) { res = { ok: false, stage: 'prepare', error: 'Die Notiz ist nicht mehr geöffnet.', prepared: '' }; }
      else {
        // (1) erneut speichern und den gespeicherten Stand lesen: hat sich die Notiz seit dem Oeffnen des Dialogs geaendert, Abbruch
        const rec = await storedStateAfterFlush(doc);
        if (!rec) { res = { ok: false, handled: true }; }
        else if (rec.rev !== dialogRev) {
          res = { ok: false, handled: true };
          P.banner('convert', 'error', 'Nicht umgewandelt: Die Notiz hat sich seit dem Öffnen des Dialogs geändert (anderes Fenster). Es wurde nichts verändert.', []);
        } else res = await convert(Object.assign({ rec }, params));
      }
    } catch (err) { res = { ok: false, stage: 'create', error: (err && err.message) || String(err), prepared: '' }; }
    closeDialog();
    converting = false;
    if (res.ok) {
      P.adoptConverted(res.note);
      P.banner('convert', 'info', 'Guide „' + res.title + '“ angelegt (ID ' + res.id + ')' + (params.trash ? '; die Quicknote liegt im Papierkorb (wiederherstellbar).' : '; die Quicknote bleibt erhalten.'), [
        { label: 'Guide öffnen', primary: true, href: guideHref(res.id) },
      ]);
      guideState.set(res.id, { state: 'exists', title: res.title });
      if (params.open) window.location.href = 'guides-create.html?id=' + encodeURIComponent(res.id);
    } else if (!res.handled) {
      errorBanner(res, params.title);
    }
    refreshUi();
  }

  function bind() {
    const btn = $('qn-convert');
    if (!btn) return;
    btn.addEventListener('click', onButton);
    $('qn-convert-dialog').addEventListener('cancel', (e) => { if (converting) e.preventDefault(); });
    $('qn-cv-cancel').addEventListener('click', () => { if (!converting) closeDialog(); });
    $('qn-cv-form').addEventListener('submit', onSubmit);
    refreshUi();
  }

  window.QuickNotesConvert = { prepare, fenceFor, toHardBreaks, suggestTitle, parseTags, loadGuidesDb, connect, convert, refreshUi, normalizeLf };
  document.addEventListener('DOMContentLoaded', bind);
})();
