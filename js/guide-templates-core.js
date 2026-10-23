// ============================================================
// support.sheet – guide-templates-core.js (Vorlagen beim Anlegen eines Guides: reine Logik, ohne DOM und ohne Speicher)
// Grenzen und Validierung, Platzhalter ({{datum}}, {{uhrzeit}}), Anwenden (Plan fuer "direkt", "Ersetzen", "Anhaengen"),
// Export und Import (JSON, nie ueberschreibend). Laeuft im Browser (window.GuideTemplatesCore) und in Node (require).
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GuideTemplatesCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { name: 80, description: 200, title: 120, subcategory: 60, tags: 20, tag: 40, content: 200000 };
  const TOKENS = ['{{datum}}', '{{uhrzeit}}'];
  const EXPORT_KIND = 'guide-templates';
  const FORMAT_VERSION = 1;
  const pad = (n) => String(n).padStart(2, '0');

  // ── Platzhalter: lokale Zeitteile (nicht toISOString), alles andere in {{ }} bleibt unveraendert ──
  function dateText(now) { return pad(now.getDate()) + '.' + pad(now.getMonth() + 1) + '.' + now.getFullYear(); }
  function timeText(now) { return pad(now.getHours()) + ':' + pad(now.getMinutes()); }
  function applyTokens(text, now) {
    now = now || new Date();
    return String(text == null ? '' : text).split('{{datum}}').join(dateText(now)).split('{{uhrzeit}}').join(timeText(now));
  }

  // Werte, die eine Vorlage setzt (Platzhalter ersetzt). Leere Felder bleiben leer = "unveraendert".
  function resolve(t, now) {
    return {
      title: applyTokens(t.title, now), category: String(t.category || ''), subcategory: applyTokens(t.subcategory, now),
      tags: (Array.isArray(t.tags) ? t.tags : []).map((x) => applyTokens(x, now)), content: applyTokens(t.content, now),
    };
  }

  // ── Normalisieren und Pruefen (nichts wird gekuerzt; nur Leerraum an den Enden von Name, Beschreibung, Titel, Unterkategorie, Tags) ──
  const str = (v) => (typeof v === 'string' ? v : '');
  function normalize(t) {
    t = t || {};
    return {
      name: str(t.name).trim(), description: str(t.description).trim(), title: str(t.title).trim(), category: str(t.category).trim(),
      subcategory: str(t.subcategory).trim(), tags: (Array.isArray(t.tags) ? t.tags : []).map((x) => (typeof x === 'string' ? x.trim() : x)),
      content: typeof t.content === 'string' ? t.content : '',
    };
  }

  // Rueckgabe: Liste von Meldungen (leer = gueltig). Typfehler zuerst (an der Rohform), dann Grenzen.
  function validate(raw) {
    const out = [];
    if (!raw || typeof raw !== 'object') return ['Die Vorlage ist kein Objekt.'];
    ['name', 'description', 'title', 'category', 'subcategory', 'content'].forEach((k) => {
      if (raw[k] != null && typeof raw[k] !== 'string') out.push('Das Feld „' + k + '“ muss Text sein.');
    });
    if (raw.tags != null && !Array.isArray(raw.tags)) out.push('Das Feld „tags“ muss eine Liste sein.');
    if (Array.isArray(raw.tags) && raw.tags.some((x) => typeof x !== 'string')) out.push('Jeder Tag muss Text sein.');
    if (out.length) return out;
    const t = normalize(raw);
    if (!t.name) out.push('Der Name ist Pflicht.');
    if (t.name.length > LIMITS.name) out.push('Der Name ist zu lang (' + t.name.length + ' von höchstens ' + LIMITS.name + ' Zeichen).');
    if (t.description.length > LIMITS.description) out.push('Die Beschreibung ist zu lang (' + t.description.length + ' von höchstens ' + LIMITS.description + ' Zeichen).');
    if (t.title.length > LIMITS.title) out.push('Der Titel ist zu lang (' + t.title.length + ' von höchstens ' + LIMITS.title + ' Zeichen).');
    if (t.subcategory.length > LIMITS.subcategory) out.push('Die Unterkategorie ist zu lang (' + t.subcategory.length + ' von höchstens ' + LIMITS.subcategory + ' Zeichen).');
    if (t.tags.length > LIMITS.tags) out.push('Zu viele Tags (' + t.tags.length + ' von höchstens ' + LIMITS.tags + ').');
    t.tags.forEach((x, i) => {
      if (!x) out.push('Tag ' + (i + 1) + ' ist leer.');
      else if (x.length > LIMITS.tag) out.push('Der Tag „' + x.slice(0, 20) + '…“ ist zu lang (' + x.length + ' von höchstens ' + LIMITS.tag + ' Zeichen).');
    });
    if (t.content.length > LIMITS.content) out.push('Der Inhalt ist zu lang (' + t.content.length + ' von höchstens ' + LIMITS.content + ' Zeichen).');
    return out;
  }

  // Vergleichsform fuer "ungespeicherte Aenderungen" im Vorlagen-Editor
  function signature(t) { const n = normalize(t); return JSON.stringify([n.name, n.description, n.title, n.category, n.subcategory, n.tags, n.content]); }

  function parseTags(text) {
    return String(text == null ? '' : text).split(',').map((x) => x.trim()).filter(Boolean);
  }

  // Tags vereinigen (ohne Doppelte, Gross-/Kleinschreibung zaehlt nicht), vorhandene zuerst
  function mergeTags(existing, add) {
    const out = existing.slice(), seen = new Set(existing.map((x) => x.toLowerCase()));
    add.forEach((x) => { const k = x.toLowerCase(); if (x && !seen.has(k)) { seen.add(k); out.push(x); } });
    return out;
  }

  // Vorlageninhalt mit einer Leerzeile unter den vorhandenen Text; der vorhandene Text bleibt Zeichen fuer Zeichen erhalten
  function appendContent(existing, add) {
    if (!existing) return add;
    if (!add) return existing;
    const gap = /\n\n$/.test(existing) ? '' : /\n$/.test(existing) ? '\n' : '\n\n';
    return existing + gap + add;
  }

  // ── Anwenden ──
  // form: { title, category, subcategory, tags[], content, tagInput }   (aktueller Formularstand)
  function isFormEmpty(form) {
    return !String(form.title || '').trim() && !String(form.subcategory || '').trim() && !(form.tags || []).length &&
      !String(form.content || '').trim() && !String(form.tagInput || '').trim();
  }

  // mode: 'direct' (leeres Formular) | 'replace' | 'append'. resolved: Ergebnis von resolve(). categories: vorhandene Kategorienamen.
  // opts.categoryIsDefault: die Kategorie im Formular ist noch die voreingestellte (nur fuer 'append' wichtig).
  // Rueckgabe: { set: { title?, category?, subcategory?, tags?, content? }, missingCategory: string|null }
  function plan(mode, form, resolved, categories, opts) {
    opts = opts || {};
    const set = {};
    let missingCategory = null;
    const has = (s) => !!String(s || '').trim();
    const setCategory = () => {
      if (!resolved.category) return;
      if ((categories || []).includes(resolved.category)) set.category = resolved.category;
      else missingCategory = resolved.category;
    };
    if (mode === 'append') {
      if (has(resolved.title) && !has(form.title)) set.title = resolved.title;
      if (has(resolved.subcategory) && !has(form.subcategory)) set.subcategory = resolved.subcategory;
      if (opts.categoryIsDefault !== false) setCategory();
      else if (resolved.category && !(categories || []).includes(resolved.category)) missingCategory = resolved.category;
      if (resolved.tags.length) set.tags = mergeTags(form.tags || [], resolved.tags);
      if (resolved.content) set.content = appendContent(form.content || '', resolved.content);
    } else {
      if (has(resolved.title)) set.title = resolved.title;
      if (has(resolved.subcategory)) set.subcategory = resolved.subcategory;
      setCategory();
      if (resolved.tags.length) set.tags = resolved.tags.slice();
      if (resolved.content) set.content = resolved.content;
    }
    return { set, missingCategory };
  }

  // ── Export und Import ──
  const FIELDS = ['id', 'name', 'description', 'title', 'category', 'subcategory', 'tags', 'content', 'createdAt', 'updatedAt'];
  function buildExport(templates, now) {
    return {
      kind: EXPORT_KIND, formatVersion: FORMAT_VERSION, exportedAt: (now || new Date()).toISOString(),
      templates: templates.map((t) => { const o = {}; FIELDS.forEach((k) => { o[k] = t[k]; }); o.tags = (t.tags || []).slice(); return o; }),
    };
  }

  // text: Dateiinhalt. existingIds: IDs, die schon vorhanden sind. newId(): liefert eine frische ID.
  // Rueckgabe: { ok:false, error } (Datei abgelehnt, nichts importieren) oder { ok:true, accepted:[Datensaetze], skipped:[{ index, name, reason }], renewed: Anzahl neuer IDs }
  function parseImport(text, existingIds, newId, now) {
    now = (now || new Date()).getTime();
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'Die Datei ist kein gültiges JSON.' }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'Die Datei hat nicht das Format einer Vorlagen-Sicherung.' };
    if (data.kind !== EXPORT_KIND) return { ok: false, error: 'Die Datei ist keine Vorlagen-Sicherung (kind „' + EXPORT_KIND + '“ fehlt).' };
    if (data.formatVersion !== FORMAT_VERSION) return { ok: false, error: 'Unbekannte Formatversion (' + String(data.formatVersion) + ', erwartet ' + FORMAT_VERSION + ').' };
    if (!Array.isArray(data.templates)) return { ok: false, error: 'Die Datei enthält keine Liste „templates“.' };
    const used = new Set(existingIds || []);
    const accepted = [], skipped = [];
    let renewed = 0;
    data.templates.forEach((raw, index) => {
      const label = raw && typeof raw === 'object' && typeof raw.name === 'string' ? raw.name.slice(0, 40) : '(Eintrag ' + (index + 1) + ')';
      const problems = validate(raw);
      if (problems.length) { skipped.push({ index, name: label, reason: problems[0] }); return; }
      const n = normalize(raw);
      let id = typeof raw.id === 'string' && raw.id ? raw.id : null;
      if (!id || used.has(id)) { id = newId(); renewed++; }
      used.add(id);
      const created = Number.isFinite(raw.createdAt) ? raw.createdAt : now;
      const updated = Number.isFinite(raw.updatedAt) ? raw.updatedAt : created;
      accepted.push({ id, name: n.name, description: n.description, title: n.title, category: n.category, subcategory: n.subcategory, tags: n.tags, content: n.content, createdAt: created, updatedAt: updated, rev: 1, trashedAt: null });
    });
    return { ok: true, accepted, skipped, renewed };
  }

  // Mitgelieferte Datei (data/guide-templates.json): Form pruefen, gueltige Eintraege zurueckgeben
  function readBuiltins(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.templates)) return { ok: false, templates: [], error: 'Die Datei der mitgelieferten Vorlagen hat ein unerwartetes Format.' };
    const out = [], seen = new Set();
    data.templates.forEach((t) => {
      if (!t || typeof t.id !== 'string' || !t.id || seen.has(t.id) || validate(t).length) return;
      seen.add(t.id);
      out.push(Object.assign({}, normalize(t), { id: t.id, draft: t.draft !== false, builtin: true }));
    });
    return { ok: true, templates: out };
  }

  return { LIMITS, TOKENS, EXPORT_KIND, FORMAT_VERSION, applyTokens, dateText, timeText, resolve, normalize, validate, signature, parseTags, mergeTags, appendContent, isFormEmpty, plan, buildExport, parseImport, readBuiltins };
});
