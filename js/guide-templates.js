// ============================================================
// support.sheet – guide-templates.js (Vorlagen beim ANLEGEN eines Guides, guides-create.html)
// Knopf "Vorlagen" unmittelbar vor "Importieren" (nur beim Anlegen, nie beim Bearbeiten, ?id=). Der Knopf oeffnet einen Dialog:
// links die Liste (Mitgeliefert: data/guide-templates.json, nur lesend; Eigene: guide-templates-db), rechts Vorschau oder Vorlagen-Editor.
// "Uebernehmen" setzt die Werte ueber die Felder des Editors (DOM und Ereignisse input/change) – guides-editor.js bleibt unveraendert,
// der Entwurf, die Zustandsanzeige und beforeunload laufen wie bei Eingaben von Hand.
// Sicherungskette (nichts wird still ueberschrieben): leeres Formular -> direkt setzen; sonst Auswahl Ersetzen/Anhaengen/Abbrechen;
// vor jeder Aenderung wird der vorherige Stand als EIGENER Entwurf gesichert (GuidesDrafts, mit Rueckgelesen-Pruefung; misslingt das,
// wird nichts veraendert); danach Meldung "Vorlage angewendet" mit "Rueckgaengig" (stellt den Stand wieder her; wurde inzwischen weiter
// editiert, wird auch dieser Zwischenstand zuerst als Entwurf gesichert).
// Alle Werte werden nur ueber textContent/value ausgegeben; die Vorschau rendert ueber SafeMarkdown.renderInto.
// Die Datenbank guide-templates-db wird erst geoeffnet, wenn der Dialog geoeffnet wird.
// Erwartet: js/guide-templates-core.js, js/guide-templates-db.js, js/guides-drafts.js, js/safe-markdown.js, js/guides-editor.js (DOM).
// ============================================================
(function () {
  const Core = window.GuideTemplatesCore;
  const DB = window.GuideTemplatesDB;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const errText = (e) => (e && e.name && e.name !== 'Error' && e.name !== 'ValidationError' ? e.name + ': ' : '') + ((e && e.message) || 'Unbekannter Fehler');
  const SRC = 'data/guide-templates.json';

  // ── Formular des Editors (nur ueber DOM und Ereignisse) ──
  const F = {
    tagsNow: () => [...document.querySelectorAll('#ge-tags-pills .ge-tag-pill')].map((p) => (p.firstChild ? p.firstChild.textContent : '')),
    categories: () => [...$('ge-category').options].map((o) => o.value),
    state() {
      return { title: $('ge-title').value, category: $('ge-category').value, subcategory: $('ge-subcategory').value, tags: F.tagsNow(), tagInput: $('ge-tag-input').value, content: $('ge-textarea').value, privateNote: $('ge-private-note').value };
    },
    links: () => [...document.querySelectorAll('#ge-links-rows .ge-link-row')].map((r, i) => { const [t, u] = r.querySelectorAll('input'); return { id: 'link-tpl-' + i, text: t ? t.value : '', url: u ? u.value : '', offlineAsset: null, offlineSavedAt: null }; }),
    fire(e) { e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); },
    set(id, v) { const e = $(id); if (e.value !== v) e.value = v; F.fire(e); },
    setTags(list) {
      let guard = 0, b;
      while ((b = document.querySelector('#ge-tags-pills .ge-tag-remove')) && guard++ < 500) b.click();
      list.forEach((t) => { $('ge-tag-input').value = t; $('ge-tag-add-btn').click(); });
    },
    // st: Teilmenge von { title, category, subcategory, tags, content }
    apply(st) {
      if ('title' in st) F.set('ge-title', st.title);
      if ('category' in st) F.set('ge-category', st.category);
      if ('subcategory' in st) F.set('ge-subcategory', st.subcategory);
      if ('tags' in st) F.setTags(st.tags);
      if ('content' in st) F.set('ge-textarea', st.content);
    },
  };

  // ── Sicherung des vorherigen Formularstands als eigener Entwurf ──
  // Rueckgabe: Entwurfsschluessel. Wirft, wenn der Entwurf nicht geschrieben oder nicht zurueckgelesen werden kann.
  function writeBackup(form) {
    const D = window.GuidesDrafts;
    if (!D) throw new Error('Der Entwurfsspeicher ist nicht verfügbar.');
    const key = D.newKey();
    const tags = form.tags.concat(String(form.tagInput || '').trim() ? [String(form.tagInput).trim()] : []);
    // Noch nicht gespeicherte Bilder liegen im Entwurf des Editors: Kopie mitnehmen, wenn dieser Entwurf zum Formular passt
    let assets = {};
    try {
      const own = D.listNew().find((d) => d.content === form.content && d.title === form.title && Array.isArray(d.imageNames) && d.imageNames.length);
      if (own) assets = D.imagesOf(own).assets;
    } catch (e) { /* ohne Bilder sichern */ }
    D.write({ v: 2, key, guideId: null, baseVersion: null, savedAt: new Date().toISOString(), title: form.title, category: form.category, subcategory: form.subcategory,
      tags, content: form.content, privateNote: form.privateNote, links: F.links(), attachments: [], pendingAttachmentNames: [], pendingRenames: [], assets });
    const back = D.read(key);
    if (!back || back.content !== form.content || back.title !== form.title || back.subcategory !== form.subcategory || back.category !== form.category || JSON.stringify(back.tags) !== JSON.stringify(tags)) {
      try { D.remove(key); } catch (e) { /* nichts zu tun */ }
      throw new Error('Der vorherige Stand konnte nicht als Entwurf gesichert werden.');
    }
    return key;
  }

  // ── Meldung im Editor ("Vorlage angewendet" mit Rueckgaengig) ──
  let lastApplied = null;   // { before, after, name, backupKey }
  function showApplied(text, kind, undoable) {
    let box = $('gt-applied');
    if (!box) {
      box = el('div', 'gt-applied');
      box.id = 'gt-applied';
      box.setAttribute('role', 'status');
      const header = document.querySelector('.ge-form-header');
      header.parentNode.insertBefore(box, header);
    }
    box.className = 'gt-applied' + (kind ? ' gt-applied--' + kind : '');
    box.replaceChildren(el('span', 'gt-applied-text', text));
    if (undoable) { const u = el('button', 'gs-folder-btn', 'Rückgängig'); u.type = 'button'; u.id = 'gt-undo'; u.addEventListener('click', undo); box.appendChild(u); }
    const c = el('button', 'gv-confirm-btn gv-confirm-btn--cancel', 'Schließen'); c.type = 'button'; c.id = 'gt-applied-close';
    c.addEventListener('click', () => { box.remove(); });
    box.appendChild(c);
  }

  function undo() {
    const a = lastApplied;
    if (!a) return;
    const now = F.state();
    const same = ['title', 'category', 'subcategory', 'content'].every((k) => now[k] === a.after[k]) && JSON.stringify(now.tags) === JSON.stringify(a.after.tags);
    let extra = '';
    if (!same) {   // seit dem Anwenden weiter editiert: auch diesen Zwischenstand zuerst sichern
      try { writeBackup(now); extra = ' Der Zwischenstand (spätere Änderungen) wurde als Entwurf gesichert.'; }
      catch (err) { showApplied('Rückgängig nicht ausgeführt: ' + errText(err) + ' Das Formular wurde nicht verändert.', 'error', true); return; }
    }
    F.apply({ title: a.before.title, category: a.before.category, subcategory: a.before.subcategory, tags: a.before.tags, content: a.before.content });
    $('ge-tag-input').value = a.before.tagInput || '';
    lastApplied = null;
    showApplied('Vorlage „' + a.name + '“ rückgängig gemacht: der vorherige Stand ist wieder im Formular.' + extra, '', false);
  }

  // ── Anwenden ──
  // mode: 'direct' | 'replace' | 'append'. Rueckgabe: { ok, message }
  function applyTemplate(t, mode) {
    const now = new Date();
    const resolved = Core.resolve(t, now);
    const form = F.state();
    const cats = F.categories();
    const plan = Core.plan(mode, form, resolved, cats, { categoryIsDefault: form.category === cats[0] });
    let backupKey = null;
    if (mode !== 'direct') {
      try { backupKey = writeBackup(form); }
      catch (err) { return { ok: false, message: 'Nichts wurde verändert: ' + errText(err) }; }
    }
    F.apply(plan.set);
    if (mode === 'replace' && plan.set.tags) $('ge-tag-input').value = '';
    const after = F.state();
    lastApplied = { before: form, after, name: t.name, backupKey };
    const label = mode === 'append' ? 'angehängt' : mode === 'replace' ? 'ersetzt' : 'gesetzt';
    let text = 'Vorlage „' + t.name + '“ angewendet (' + label + ').' + (backupKey ? ' Der vorherige Stand liegt als Entwurf bereit.' : '');
    if (plan.missingCategory) text += ' Kategorie „' + plan.missingCategory + '“ existiert nicht, das Feld bleibt unverändert.';
    if (backupKey && /\(assets\//.test(form.content) && !Object.keys((window.GuidesDrafts.imagesOf(window.GuidesDrafts.read(backupKey)).assets)).length) text += ' Hinweis: Bilder im vorherigen Text sind nicht Teil der Sicherung.';
    showApplied(text, plan.missingCategory ? 'warn' : '', true);
    return { ok: true };
  }

  // ── Dialog ──
  async function openDialog(opener) {
    if ($('gt-dialog')) return;
    let builtins = [], customs = [];
    let dbError = null, loadError = null;
    let selectedId = null, view = 'none', mdMode = false, filter = '';
    let editing = null;      // { id|null, rev|null, base: Signatur }
    let choiceOpen = false;
    let offChange = null, refreshTimer = null;

    const dlg = el('dialog', 'gt-dialog');
    dlg.id = 'gt-dialog';
    dlg.setAttribute('aria-labelledby', 'gt-title');
    const head = el('div', 'gt-head');
    const h = el('h2', 'gt-heading', 'Vorlagen'); h.id = 'gt-title';
    const closeBtn = el('button', 'gs-folder-btn', 'Schließen'); closeBtn.type = 'button'; closeBtn.id = 'gt-close';
    head.append(h, closeBtn);
    const note = el('p', 'gt-note', 'Eigene Vorlagen liegen im Browser-Speicher dieses Geräts, nicht in der Guide-Sicherung. Sichern: Exportieren.'); note.id = 'gt-note';
    const msgs = el('div', 'gt-msgs'); msgs.id = 'gt-msgs'; msgs.setAttribute('role', 'status');

    const body = el('div', 'gt-body');
    const left = el('div', 'gt-left');
    const sLabel = el('label', 'gt-label', 'Vorlagen suchen'); sLabel.htmlFor = 'gt-search';
    const search = el('input', 'gt-input'); search.type = 'search'; search.id = 'gt-search'; search.autocomplete = 'off'; search.placeholder = 'Name oder Beschreibung …';
    const tools = el('div', 'gt-tools');
    const mk = (id, text, cls) => { const b = el('button', cls || 'gs-folder-btn', text); b.type = 'button'; b.id = id; return b; };
    const bNew = mk('gt-new', '+ Neue Vorlage'), bForm = mk('gt-from-form', 'Aus aktuellem Formular'), bImport = mk('gt-import', 'Importieren'), bExport = mk('gt-export', 'Exportieren');
    const fileIn = el('input'); fileIn.type = 'file'; fileIn.id = 'gt-import-file'; fileIn.accept = '.json,application/json'; fileIn.hidden = true;
    tools.append(bNew, bForm, bImport, bExport, fileIn);
    const list = el('div', 'gt-list'); list.id = 'gt-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Vorlagen');
    left.append(sLabel, search, tools, list);
    const right = el('div', 'gt-right'); right.id = 'gt-pane';
    body.append(left, right);

    const choice = el('div', 'gt-choice'); choice.id = 'gt-choice'; choice.hidden = true; choice.setAttribute('role', 'alertdialog'); choice.setAttribute('aria-labelledby', 'gt-choice-text');
    const choiceText = el('p', 'gt-choice-text'); choiceText.id = 'gt-choice-text';
    const choiceBtns = el('div', 'gt-choice-btns');
    const bRepl = mk('gt-choice-replace', 'Ersetzen'), bApp = mk('gt-choice-append', 'Anhängen'), bCh = mk('gt-choice-cancel', 'Abbrechen');
    choiceBtns.append(bRepl, bApp, bCh);
    choice.append(choiceText, choiceBtns);

    const foot = el('div', 'gt-foot');
    const bCancel = mk('gt-cancel', 'Abbrechen'), bApply = mk('gt-apply', 'Übernehmen', 'gs-folder-btn gt-primary');
    bApply.disabled = true;
    foot.append(bCancel, bApply);
    dlg.append(head, note, msgs, body, choice, foot);
    document.body.appendChild(dlg);

    // ── Meldungen (bleiben bis zum Schliessen des Dialogs) ──
    function say(text, kind, undoFn) {
      const box = el('div', 'gt-msg' + (kind ? ' gt-msg--' + kind : ''));
      box.appendChild(el('span', 'gt-msg-text', text));
      if (undoFn) {
        const u = el('button', 'gs-folder-btn', 'Rückgängig'); u.type = 'button'; u.className += ' gt-undo';
        u.addEventListener('click', async () => { u.disabled = true; try { await undoFn(); box.remove(); } catch (err) { u.disabled = false; say('Rückgängig fehlgeschlagen: ' + errText(err), 'error'); } });
        box.appendChild(u);
      }
      msgs.appendChild(box);
      return box;
    }

    // ── Daten ──
    async function loadBuiltins() {
      try {
        const res = await fetch(SRC, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const r = Core.readBuiltins(await res.json());
        if (!r.ok) throw new Error(r.error);
        builtins = r.templates;
      } catch (err) { loadError = 'Die mitgelieferten Vorlagen konnten nicht geladen werden: ' + errText(err); }
    }
    async function loadCustoms() {
      try {
        const all = await DB.list();
        customs = all.filter((x) => !x.trashedAt).sort((a, b) => b.updatedAt - a.updatedAt);
        dbError = null;
      } catch (err) { customs = []; dbError = errText(err); }
    }
    const all = () => builtins.concat(customs);
    const byId = (id) => all().find((x) => x.id === id) || null;
    const isBuiltin = (t) => !!(t && t.builtin);
    const visible = (arr) => { const q = filter.trim().toLowerCase(); return q ? arr.filter((x) => (x.name + ' ' + x.description).toLowerCase().includes(q)) : arr; };

    // ── Liste ──
    function renderList() {
      list.replaceChildren();
      const section = (label, items, emptyText) => {
        const g = el('div', 'gt-group'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
        g.appendChild(el('div', 'gt-group-title', label));
        if (!items.length && emptyText) g.appendChild(el('div', 'gt-empty', emptyText));
        items.forEach((t) => {
          const o = el('div', 'gt-opt' + (t.id === selectedId ? ' gt-opt--sel' : ''));
          o.setAttribute('role', 'option'); o.id = 'gt-opt-' + t.id; o.dataset.id = t.id;
          o.setAttribute('aria-selected', String(t.id === selectedId)); o.tabIndex = t.id === selectedId ? 0 : -1;
          const top = el('div', 'gt-opt-top');
          top.appendChild(el('span', 'gt-opt-name', t.name));
          if (isBuiltin(t) && t.draft) top.appendChild(el('span', 'gt-badge', 'Entwurf'));
          o.append(top, el('div', 'gt-opt-desc', t.description));
          o.addEventListener('click', () => select(t.id));
          g.appendChild(o);
        });
        list.appendChild(g);
      };
      section('Mitgeliefert', visible(builtins), loadError || 'Keine Treffer.');
      if (dbError) { const g = el('div', 'gt-group'); g.appendChild(el('div', 'gt-group-title', 'Eigene')); const m = el('div', 'gt-empty gt-empty--err', 'Eigene Vorlagen sind nicht verfügbar: ' + dbError + ' Die mitgelieferten Vorlagen bleiben nutzbar.'); m.setAttribute('role', 'alert'); g.appendChild(m); list.appendChild(g); }
      else section('Eigene', visible(customs), customs.length ? 'Keine Treffer.' : 'Noch keine eigenen Vorlagen.');
      const off = !!dbError;
      [bNew, bForm, bImport, bExport].forEach((b) => { b.disabled = off; });
    }

    function syncApply() { bApply.disabled = !(selectedId && view === 'preview' && byId(selectedId)) || choiceOpen; }

    function editorDirty() { return view === 'editor' && editing && Core.signature(readEditor()) !== editing.base; }
    function leaveEditorOk() { return !editorDirty() || window.confirm('Die Änderungen an der Vorlage sind nicht gespeichert. Verwerfen?'); }

    function select(id) {
      if (id === selectedId && view === 'preview') return;
      if (!leaveEditorOk()) return;
      selectedId = id; view = byId(id) ? 'preview' : 'none'; editing = null; edEls = null; closeChoice();
      renderList(); renderPane(); syncApply();
      const o = $('gt-opt-' + id); if (o && document.activeElement && list.contains(document.activeElement)) o.focus();
    }

    // ── Vorschau ──
    function categoryExists(c) { return F.categories().includes(c); }
    function renderPane() {
      right.replaceChildren();
      const t = byId(selectedId);
      if (view === 'editor') { renderEditor(); return; }
      if (!t) { right.appendChild(el('p', 'gt-placeholder', 'Wähle links eine Vorlage, um die Vorschau zu sehen.')); return; }
      const r = Core.resolve(t, new Date());
      const hd = el('div', 'gt-pane-head');
      const hh = el('h3', 'gt-pane-title', t.name); hh.id = 'gt-pane-title';
      hd.appendChild(hh);
      if (isBuiltin(t) && t.draft) hd.appendChild(el('span', 'gt-badge', 'Mitgeliefert, Entwurf'));
      right.appendChild(hd);
      if (t.description) right.appendChild(el('p', 'gt-pane-desc', t.description));
      const acts = el('div', 'gt-acts'); acts.id = 'gt-actions';
      const act = (id, text, fn, cls) => { const b = mk(id, text, cls); b.addEventListener('click', fn); if (dbError) b.disabled = true; acts.appendChild(b); return b; };
      if (isBuiltin(t)) act('gt-duplicate', 'Duplizieren', () => duplicate(t));
      else { act('gt-edit', 'Bearbeiten', () => startEditor(t)); act('gt-duplicate', 'Duplizieren', () => duplicate(t)); act('gt-delete', 'Löschen', () => remove(t), 'gs-folder-btn gt-danger'); }
      right.appendChild(acts);
      const tbl = el('table', 'gt-fields'); tbl.id = 'gt-fields';
      tbl.appendChild(el('caption', 'gt-cap', 'Felder, die gesetzt werden'));
      const row = (k, v, extra) => { const tr = el('tr'); tr.appendChild(el('th', null, k)); const td = el('td', v ? '' : 'gt-unch', v || 'unverändert'); tr.appendChild(td); if (extra) td.appendChild(extra); tbl.appendChild(tr); return tr; };
      row('Titel', r.title); row('Kategorie', r.category); row('Unterkategorie', r.subcategory); row('Tags', r.tags.join(', '));
      right.appendChild(tbl);
      if (r.category && !categoryExists(r.category)) { const hint = el('p', 'gt-hint', 'Kategorie „' + r.category + '“ existiert nicht, bleibt unverändert.'); hint.id = 'gt-cat-hint'; right.appendChild(hint); }
      const bar = el('div', 'gt-md-bar');
      const tog = mk('gt-md-toggle', mdMode ? 'Vorschau anzeigen' : 'Markdown anzeigen'); tog.setAttribute('aria-pressed', String(mdMode));
      tog.addEventListener('click', () => { mdMode = !mdMode; renderPane(); const b = $('gt-md-toggle'); if (b) b.focus(); });
      bar.appendChild(tog); right.appendChild(bar);
      if (mdMode) { const pre = el('pre', 'gt-md'); pre.id = 'gt-markdown'; pre.textContent = r.content; right.appendChild(pre); }
      else { const c = el('div', 'gt-content gv-content'); c.id = 'gt-content'; if (window.SafeMarkdown) window.SafeMarkdown.renderInto(c, r.content); else c.textContent = r.content; right.appendChild(c); }
    }

    // ── Eigene Vorlagen: Anlegen, Bearbeiten, Duplizieren, Loeschen ──
    async function afterChange(selectId) {
      await loadCustoms();
      if (selectId !== undefined) selectedId = selectId;
      if (selectedId && !byId(selectedId)) { selectedId = null; view = 'none'; }
      renderList(); renderPane(); syncApply();
    }

    async function duplicate(t) {
      if (!leaveEditorOk()) return;
      const name = ('Kopie von ' + t.name).slice(0, Core.LIMITS.name);
      try {
        const rec = await DB.create({ name, description: t.description, title: t.title, category: t.category, subcategory: t.subcategory, tags: t.tags, content: t.content });
        view = 'preview'; editing = null;
        await afterChange(rec.id);
        say('Vorlage „' + name + '“ angelegt.', 'ok');
        const o = $('gt-opt-' + rec.id); if (o) o.scrollIntoView({ block: 'nearest' });
      } catch (err) { say('Duplizieren fehlgeschlagen: ' + errText(err), 'error'); }
    }

    async function remove(t) {
      if (!window.confirm('Vorlage „' + t.name + '“ löschen? Direkt danach lässt sie sich mit „Rückgängig“ wiederherstellen.')) return;
      try {
        const res = await DB.setTrashed(t.id, true, t.rev);
        if (!res.ok) { say(res.missing ? 'Die Vorlage existiert nicht mehr.' : 'Die Vorlage wurde in einem anderen Fenster geändert und nicht gelöscht.', 'warn'); await afterChange(); return; }
        const rev = res.template.rev;
        await afterChange(null);
        say('Vorlage „' + t.name + '“ gelöscht.', 'ok', async () => {
          const r = await DB.setTrashed(t.id, false, rev);
          if (!r.ok) throw new Error(r.missing ? 'existiert nicht mehr' : 'seit dem Löschen geändert');
          await afterChange(t.id); view = 'preview'; renderPane(); syncApply();
        });
      } catch (err) { say('Löschen fehlgeschlagen: ' + errText(err), 'error'); }
    }

    // ── Vorlagen-Editor ──
    let edEls = null;
    function readEditor() {
      if (!edEls) return { name: '', description: '', title: '', category: '', subcategory: '', tags: [], content: '' };
      return { name: edEls.name.value, description: edEls.desc.value, title: edEls.title.value, category: edEls.cat.value, subcategory: edEls.sub.value, tags: Core.parseTags(edEls.tags.value), content: edEls.content.value };
    }
    function startEditor(t, preset) {
      if (!leaveEditorOk()) return;
      view = 'editor'; closeChoice();
      const init = preset || t || { name: '', description: '', title: '', category: '', subcategory: '', tags: [], content: '' };
      editing = { id: t && !isBuiltin(t) ? t.id : null, rev: t && !isBuiltin(t) ? t.rev : null, init, base: '' };
      renderPane(); syncApply();
      editing.base = preset ? Core.signature({}) : Core.signature(readEditor());   // bei Vorbefuellung zaehlt alles als ungespeichert
      const f = edEls && edEls.name; if (f) f.focus();
    }
    function renderEditor() {
      const i = editing.init;
      const wrap = el('form', 'gt-editor'); wrap.id = 'gt-editor'; wrap.noValidate = true;
      wrap.addEventListener('submit', (e) => e.preventDefault());
      const field = (id, label, node, hint) => { const d = el('div', 'gt-field'); const l = el('label', 'gt-label', label); l.htmlFor = id; node.id = id; d.append(l, node); if (hint) d.appendChild(el('div', 'gt-field-hint', hint)); wrap.appendChild(d); return node; };
      const input = (v) => { const n = el('input', 'gt-input'); n.type = 'text'; n.value = v || ''; n.autocomplete = 'off'; return n; };
      const name = field('gt-ed-name', 'Name (Pflicht, höchstens 80 Zeichen)', input(i.name));
      const desc = field('gt-ed-desc', 'Beschreibung (höchstens 200 Zeichen)', input(i.description));
      const title = field('gt-ed-title', 'Titel (Vorschlag, höchstens 120 Zeichen)', input(i.title));
      const cat = el('select', 'gt-input');
      cat.appendChild(Object.assign(el('option', null, '(keine)'), { value: '' }));
      F.categories().forEach((c) => cat.appendChild(Object.assign(el('option', null, c), { value: c })));
      if (i.category && !F.categories().includes(i.category)) cat.appendChild(Object.assign(el('option', null, i.category + ' (nicht vorhanden)'), { value: i.category }));
      cat.value = i.category || '';
      field('gt-ed-category', 'Kategorie', cat);
      const sub = field('gt-ed-sub', 'Unterkategorie (höchstens 60 Zeichen)', input(i.subcategory));
      const tags = field('gt-ed-tags', 'Tags (durch Komma getrennt, höchstens 20 zu je 40 Zeichen)', input((i.tags || []).join(', ')));
      const content = el('textarea', 'gt-input gt-textarea'); content.value = i.content || ''; content.spellcheck = false; content.rows = 10;
      field('gt-ed-content', 'Inhalt (Markdown)', content, 'Platzhalter beim Anwenden: {{datum}} wird zu TT.MM.JJJJ, {{uhrzeit}} zu HH:MM. Texte in spitzen Klammern wie <Kunde> bleiben sichtbar im Text.');
      const pvLabel = el('div', 'gt-label', 'Vorschau'); const pv = el('div', 'gt-content gv-content gt-ed-preview'); pv.id = 'gt-ed-preview';
      wrap.append(pvLabel, pv);
      const errs = el('div', 'gt-errors'); errs.id = 'gt-ed-errors'; errs.setAttribute('role', 'alert'); wrap.appendChild(errs);
      const conflict = el('div', 'gt-conflict'); conflict.id = 'gt-ed-conflict'; conflict.hidden = true; conflict.setAttribute('role', 'alert'); wrap.appendChild(conflict);
      const btns = el('div', 'gt-ed-btns');
      const save = mk('gt-ed-save', 'Speichern', 'gs-folder-btn gt-primary'), cancel = mk('gt-ed-cancel', 'Abbrechen');
      btns.append(save, cancel); wrap.appendChild(btns);
      edEls = { name, desc, title, cat, sub, tags, content, pv, errs, save, conflict };

      let pvTimer = null;
      const updatePv = () => { const r = Core.resolve(readEditor(), new Date()); if (window.SafeMarkdown) window.SafeMarkdown.renderInto(pv, r.content); else pv.textContent = r.content; };
      const check = () => {
        const problems = Core.validate(readEditor());
        errs.replaceChildren();
        if (problems.length) { const ul = el('ul', 'gt-errors-list'); problems.forEach((p) => ul.appendChild(el('li', null, p))); errs.appendChild(ul); }
        save.disabled = problems.length > 0;
      };
      [name, desc, title, sub, tags, content].forEach((x) => x.addEventListener('input', () => { check(); if (x === content) { clearTimeout(pvTimer); pvTimer = setTimeout(updatePv, 200); } }));
      cat.addEventListener('change', check);
      updatePv(); check();
      cancel.addEventListener('click', () => { if (!leaveEditorOk()) return; view = byId(selectedId) ? 'preview' : 'none'; editing = null; edEls = null; renderPane(); syncApply(); });
      save.addEventListener('click', () => saveEditor());
      right.appendChild(wrap);
    }

    async function saveEditor() {
      const vals = readEditor();
      const problems = Core.validate(vals);
      if (problems.length) return;
      edEls.save.disabled = true;
      try {
        let rec;
        if (editing.id) {
          const res = await DB.save(editing.id, vals, editing.rev);
          if (res.conflict) { showConflict(res.current, vals); edEls.save.disabled = false; return; }
          if (res.missing) { say('Die Vorlage existiert nicht mehr. Sie wurde in einem anderen Fenster gelöscht.', 'warn'); edEls.save.disabled = false; return; }
          rec = res.template;
        } else rec = await DB.create(vals);
        view = 'preview'; editing = null; edEls = null;
        await afterChange(rec.id);
        say('Vorlage „' + rec.name + '“ gespeichert.', 'ok');
        const o = $('gt-opt-' + rec.id); if (o) o.scrollIntoView({ block: 'nearest' });
      } catch (err) { say('Speichern fehlgeschlagen: ' + errText(err), 'error'); if (edEls) edEls.save.disabled = false; }
    }

    // Zwei Fenster: das zweite Speichern ueberschreibt nichts (rev-Pruefung)
    function showConflict(current, mine) {
      const box = edEls.conflict;
      box.hidden = false; box.replaceChildren();
      box.appendChild(el('p', 'gt-conflict-text', 'Diese Vorlage wurde in einem anderen Fenster geändert (Stand ' + current.rev + ', geladen war ' + editing.rev + '). Dein Stand wurde nicht gespeichert und nichts überschrieben.'));
      const b1 = mk('gt-conflict-copy', 'Meine Version als neue Vorlage sichern', 'gs-folder-btn gt-primary');
      const b2 = mk('gt-conflict-load', 'Stand aus dem anderen Fenster laden');
      const b3 = mk('gt-conflict-keep', 'Weiter bearbeiten');
      b1.addEventListener('click', async () => {
        const copy = Object.assign({}, mine, { name: (mine.name + ' (Kopie)').length <= Core.LIMITS.name ? mine.name + ' (Kopie)' : mine.name });
        try { const rec = await DB.create(copy); view = 'preview'; editing = null; edEls = null; await afterChange(rec.id); say('Deine Version wurde als neue Vorlage „' + rec.name + '“ gesichert.', 'ok'); }
        catch (err) { say('Sichern fehlgeschlagen: ' + errText(err), 'error'); }
      });
      b2.addEventListener('click', () => { if (!window.confirm('Deine nicht gespeicherten Änderungen gehen verloren. Den Stand aus dem anderen Fenster laden?')) return; const t = Object.assign({}, current); editing = null; edEls = null; view = 'preview'; afterChange(t.id).then(() => startEditor(byId(t.id) || t)); });
      b3.addEventListener('click', () => { box.hidden = true; box.replaceChildren(); });
      const row = el('div', 'gt-ed-btns'); row.append(b1, b2, b3); box.appendChild(row);
      b3.focus();
    }

    // ── Export und Import ──
    function download(text, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    bExport.addEventListener('click', async () => {
      await loadCustoms();
      if (!customs.length) { say('Es gibt keine eigenen Vorlagen zum Exportieren.', 'warn'); return; }
      const now = new Date();
      download(JSON.stringify(Core.buildExport(customs, now), null, 2) + '\n', 'guide-vorlagen-' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + '.json');
      say(customs.length + (customs.length === 1 ? ' Vorlage' : ' Vorlagen') + ' exportiert.', 'ok');
    });
    bImport.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      let text;
      try { text = await f.text(); } catch (err) { say('Die Datei konnte nicht gelesen werden: ' + errText(err), 'error'); return; }
      await loadCustoms();
      const r = Core.parseImport(text, customs.map((x) => x.id).concat((await DB.list()).map((x) => x.id)), () => crypto.randomUUID());
      if (!r.ok) { say('Import abgelehnt, nichts wurde importiert: ' + r.error, 'error'); return; }
      try { await DB.addMany(r.accepted); } catch (err) { say('Import fehlgeschlagen, nichts wurde importiert: ' + errText(err), 'error'); return; }
      await afterChange();
      let t = r.accepted.length + ' importiert';
      if (r.renewed) t += ' (' + r.renewed + ' mit neuer ID, vorhandene wurden nicht überschrieben)';
      if (r.skipped.length) t += ', ' + r.skipped.length + ' übersprungen: ' + r.skipped.slice(0, 5).map((s) => '„' + s.name + '“ (' + s.reason + ')').join(', ') + (r.skipped.length > 5 ? ' und ' + (r.skipped.length - 5) + ' weitere' : '');
      say(t + '.', r.skipped.length ? 'warn' : 'ok');
    });

    bNew.addEventListener('click', () => startEditor(null));
    bForm.addEventListener('click', () => {
      const s = F.state();
      const tags = s.tags.concat(s.tagInput.trim() ? [s.tagInput.trim()] : []);
      startEditor(null, { name: '', description: '', title: s.title, category: s.category, subcategory: s.subcategory, tags, content: s.content });
    });

    // ── Uebernehmen ──
    function closeChoice() { choiceOpen = false; choice.hidden = true; }
    function onApply() {
      const t = byId(selectedId);
      if (!t || view !== 'preview') return;
      const form = F.state();
      if (Core.isFormEmpty(form)) { finish(t, 'direct'); return; }
      choiceText.textContent = 'Das Formular enthält schon Eingaben. „Ersetzen“ setzt die Felder der Vorlage „' + t.name + '“ und sichert den vorherigen Stand als Entwurf. „Anhängen“ setzt den Vorlageninhalt mit einer Leerzeile unter den vorhandenen Text, vereinigt die Tags und lässt belegte Felder stehen (ebenfalls mit gesichertem Stand).';
      choice.hidden = false; choiceOpen = true; syncApply();
      bCh.focus();
    }
    function finish(t, mode) {
      const r = applyTemplate(t, mode);
      if (!r.ok) { say(r.message, 'error'); closeChoice(); syncApply(); return; }
      closeDialog(true);
    }
    bApply.addEventListener('click', onApply);
    bRepl.addEventListener('click', () => finish(byId(selectedId), 'replace'));
    bApp.addEventListener('click', () => finish(byId(selectedId), 'append'));
    bCh.addEventListener('click', () => { closeChoice(); syncApply(); bApply.focus(); });

    // ── Schliessen, Tastatur ──
    function closeDialog(applied) {
      if (!applied && !leaveEditorOk()) return;
      if (offChange) offChange();
      clearTimeout(refreshTimer);
      try { dlg.close(); } catch (e) { /* schon zu */ }
      dlg.remove();
      if (opener && opener.focus) opener.focus();
    }
    closeBtn.addEventListener('click', () => closeDialog(false));
    bCancel.addEventListener('click', () => closeDialog(false));
    dlg.addEventListener('cancel', (e) => {   // Esc
      e.preventDefault();
      if (choiceOpen) { closeChoice(); syncApply(); bApply.focus(); return; }
      closeDialog(false);
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...dlg.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter((x) => !x.disabled && !x.hidden && x.type !== 'hidden' && x.getClientRects().length && !x.closest('[hidden]'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dlg.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    list.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const opts = [...list.querySelectorAll('.gt-opt')];
      if (!opts.length) return;
      e.preventDefault();
      let i = opts.findIndex((o) => o.dataset.id === selectedId);
      if (i < 0) i = e.key === 'ArrowUp' ? opts.length : -1;
      i = e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1 : Math.max(0, Math.min(opts.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      select(opts[i].dataset.id);
      const o = $('gt-opt-' + opts[i].dataset.id); if (o) o.focus();
    });
    search.addEventListener('input', () => { filter = search.value; renderList(); });

    // ── Start ──
    dlg.showModal();
    search.focus();
    await Promise.all([loadBuiltins(), loadCustoms()]);
    renderList(); renderPane(); syncApply();
    try {
      offChange = DB.onChange(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { if (view !== 'editor') afterChange(); else loadCustoms().then(renderList); }, 200); });
    } catch (e) { /* ohne BroadcastChannel */ }
  }

  // ── Knopf (nur beim Anlegen, nie beim Bearbeiten) ──
  function init() {
    if (new URLSearchParams(location.search).get('id')) return;
    const imp = $('ge-import-btn');
    if (!imp || !Core || !DB || $('ge-templates-btn')) return;
    const b = el('button', 'gs-folder-btn', '📋 Vorlagen');
    b.type = 'button'; b.id = 'ge-templates-btn'; b.setAttribute('aria-haspopup', 'dialog');
    b.addEventListener('click', () => openDialog(b));
    imp.parentNode.insertBefore(b, imp);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.GuideTemplates = { applyTemplate, undo, state: F.state, open: () => openDialog($('ge-templates-btn')) };
})();
