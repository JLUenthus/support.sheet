// ============================================================
// support.sheet – Event-Referenz (eventlog-referenz.html)
// ============================================================
// Liest data/eventlog-codes.json (einzige Quelle) und zeigt die Event-Codes nach Thema gruppiert mit Einstufung,
// Beschreibung, "Wann wird es kritisch" und Quelle. Gleiche IDs bei verschiedenen Providern stehen in einer Karte.
//
// Sicherheit: Die Datei gehört zum Projekt, wird aber als nicht vertrauenswürdig behandelt.
//   - Alle Werte aus der Datei gelangen nur über textContent/createElement in die Seite, nie als HTML.
//   - Klassen für Stufen und Marker kommen ausschließlich aus Whitelist-Abbildungen (RATING_UI, MARKER_UI), nie aus Datenwerten.
//   - Links nur bei https:, mit rel="noopener noreferrer" und target="_blank".
//
// Aufbau: validate()/buildModel() sind reine Datenfunktionen, render(data, container) baut die ganze Seite ohne Netzwerk
// und liefert einen Controller (Filter, Sprung zu einer ID). run() lädt die Datei und ruft render() auf.
(function (root) {
  'use strict';

  const RATINGS = ['critical', 'error', 'warning', 'info', 'noise'];
  // Klassen und Symbole der Stufen (Whitelist). Definitionen nach .md/eventlog-referenz/DATENMODELL.md (Legende).
  // Das Symbol trägt zusammen mit dem Text die Bedeutung, die Farbe nie allein.
  const RATING_UI = {
    critical: { cls: 'er-r-critical', symbol: '‼', label: 'Kritisch', def: 'Sofort prüfen, Hinweis auf Datenverlust, Sicherheitsvorfall oder Ausfall.' },
    error:    { cls: 'er-r-error',    symbol: '✖', label: 'Fehler',   def: 'Fehler mit Auswirkung, zeitnah klären.' },
    warning:  { cls: 'er-r-warning',  symbol: '▲', label: 'Warnung',  def: 'Auffällig, oft erst bei Häufung relevant.' },
    info:     { cls: 'er-r-info',     symbol: 'ℹ︎', label: 'Info',     def: 'Zustandsmeldung ohne Handlungsbedarf, für die Diagnose nützlich.' },
    noise:    { cls: 'er-r-noise',    symbol: '≈', label: 'Rauschen', def: 'Tritt im Normalbetrieb häufig auf, nur bei Häufung oder im Zusammenhang mit anderen Ereignissen relevant.' },
  };
  const MARKER_UI = {
    draft:      { cls: 'er-m-draft',      text: 'Entwurf',              def: 'Noch nicht gegen die Herstellerdokumentation geprüft (Beschreibung, Kanal, Provider oder Quelle fehlen oder sind unsicher).' },
    provisional:{ cls: 'er-m-provisional', text: 'Einstufung vorläufig', def: 'Die Einstufung ist ein Vorschlag und noch nicht bestätigt.' },
    contextual: { cls: 'er-m-contextual', text: 'kontextabhängig',      def: 'Die Einstufung hängt von Häufung oder Kontext ab, siehe „Wann wird es kritisch“.' },
    disputed:   { cls: 'er-m-disputed',   text: 'Harmlos-Regel strittig', def: 'Die Harmlos-Regel des Analyzers widerspricht der Herstellerdokumentation, Einzelheiten in den Hinweisen.' },
    nocollector:{ cls: 'er-m-nocoll',     text: 'nicht im Standard-Collector', def: 'Der Standard-Collector sammelt diese ID nicht; sie erscheint nur in Logs mit anderen Quellen.' },
  };
  const COLLECTORS = ['client', 'server'];
  const NO_TOPIC = '__none';
  const NO_TOPIC_LABEL = 'Ohne Thema';
  // Einträge ohne gültiges Thema und ohne Collector: eigene Gruppe, gruppiert nach collector (leer = der Standard-Collector sammelt die ID nicht)
  const NO_COLLECTOR = '__nocollector';
  const NO_COLLECTOR_LABEL = 'Vom Standard-Collector nicht gesammelt';
  const NO_COLLECTOR_NOTE = 'Die Analyzer-Regeln kennen diese IDs, der Standard-Collector sammelt sie aber nicht. Sie erscheinen nur in Logs mit anderen Quellen.';
  const COLLISION_TEXT = 'Gleiche ID, unterschiedliche Bedeutung je Provider';
  const MAX_TEXT = 4000;

  // ── Daten prüfen ─────────────────────────────────────────────
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || MAX_TEXT) : null);
  const strOrNull = v => { const s = str(v); return s !== null && s.trim() !== '' ? s : null; };

  // Liefert den bereinigten Eintrag oder null (ungültig: kein Objekt, eventId keine ganze Zahl >= 0, title kein Text, rating nicht in der Liste).
  function normalizeEntry(e) {
    if (!isObj(e)) return null;
    if (!Number.isSafeInteger(e.eventId) || e.eventId < 0) return null;
    const title = strOrNull(e.title);
    if (title === null) return null;
    if (typeof e.rating !== 'string' || !RATINGS.includes(e.rating)) return null;
    const list = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim() !== '').map(x => x.slice(0, 200)).slice(0, 20) : []);
    return {
      channel: strOrNull(e.channel), provider: strOrNull(e.provider), providerHint: list(e.providerHint),
      eventId: e.eventId, topic: strOrNull(e.topic), title, description: strOrNull(e.description),
      rating: e.rating, contextual: e.contextual === true, escalation: strOrNull(e.escalation),
      collector: list(e.collector).filter(c => COLLECTORS.includes(c)),
      sourceUrl: strOrNull(e.sourceUrl), sourceLegacy: e.sourceLegacy === true, verified: e.verified === true,
      verifiedAt: strOrNull(e.verifiedAt), reviewed: e.reviewed === true, harmlessDisputed: e.harmlessDisputed === true,
      notes: strOrNull(e.notes),
    };
  }

  // Wirft bei falschem Aufbau (kein Objekt, "codes" keine Liste); sonst { entries, skipped, topics, labels }.
  function validate(data) {
    if (!isObj(data)) throw new Error('Aufbau ungültig: Die Datei enthält kein JSON-Objekt.');
    if (!Array.isArray(data.codes)) throw new Error('Aufbau ungültig: Das Feld "codes" fehlt oder ist keine Liste.');
    const entries = [];
    let skipped = 0;
    data.codes.forEach(e => { const n = normalizeEntry(e); if (n) entries.push(n); else skipped++; });
    const topics = Array.isArray(data.topics) ? data.topics.filter(t => typeof t === 'string' && t.trim() !== '').map(t => t.slice(0, 100)) : [];
    const labels = {};
    RATINGS.forEach(r => {
      const l = isObj(data.ratingLabels) ? str(data.ratingLabels[r], 40) : null;
      labels[r] = l && l.trim() !== '' ? l : RATING_UI[r].label;
    });
    return { entries, skipped, topics, labels };
  }

  const cmpNullLast = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
  function sortEntries(list) {
    return list.sort((a, b) => cmpNullLast(a.channel, b.channel) || cmpNullLast(a.provider, b.provider) || cmpNullLast(a.providerHint[0] || null, b.providerHint[0] || null));
  }

  // Gruppiert: Themen in der Reihenfolge von data.topics, danach "Ohne Thema" (kein gültiges Thema, aber ein Collector sammelt die ID) und zuletzt
  // "Vom Standard-Collector nicht gesammelt" (kein gültiges Thema, collector leer). Einträge mit Thema bleiben auch bei leerem collector in ihrem Thema.
  // Je Gruppe Karten je ID aufsteigend; Gegenstücke (gleiche ID in einer anderen Gruppe) stehen je Karte in others.
  function buildModel(data) {
    const v = validate(data);
    const idCount = new Map();
    v.entries.forEach(e => idCount.set(e.eventId, (idCount.get(e.eventId) || 0) + 1));
    const groupOf = e => (e.topic !== null && v.topics.includes(e.topic) ? e.topic : (e.collector.length === 0 ? NO_COLLECTOR : NO_TOPIC));
    const order = [...v.topics, NO_TOPIC, NO_COLLECTOR];
    const groupIndex = g => order.indexOf(g);
    const labelOf = g => (g === NO_TOPIC ? NO_TOPIC_LABEL : g === NO_COLLECTOR ? NO_COLLECTOR_LABEL : g);
    const sections = [];
    order.forEach((t, ti) => {
      const inGroup = v.entries.filter(e => groupOf(e) === t);
      if (!inGroup.length) return;
      const byId = new Map();
      inGroup.forEach(e => { if (!byId.has(e.eventId)) byId.set(e.eventId, []); byId.get(e.eventId).push(e); });
      const cards = [...byId.keys()].sort((x, y) => x - y).map(id => ({
        eventId: id, topic: t, topicIndex: ti, entries: sortEntries(byId.get(id)), collision: idCount.get(id) > 1,
        others: sortEntries(v.entries.filter(e => e.eventId === id && groupOf(e) !== t)),
      }));
      sections.push({ topic: t, label: labelOf(t), note: t === NO_COLLECTOR ? NO_COLLECTOR_NOTE : null, cards, count: inGroup.length });
    });
    return { entries: v.entries, skipped: v.skipped, topics: v.topics, labels: v.labels, sections, idCount, groupOf, topicOf: groupOf, groupIndex, labelOf };
  }

  // ── Filter ───────────────────────────────────────────────────
  function defaultFilters() { return { q: '', topic: '', ratings: [], collector: 'all', collisionOnly: false }; }
  // Suchrang eines Eintrags: null = kein Treffer. Reine Ziffern gelten als ID: Rang 0 = genau diese ID, Rang 1 = die Zahl kommt in Provider, Titel oder
  // Beschreibung als eigenes Wort vor (4104 zählt nicht für 41). Jede andere Eingabe ist Teilstring-Suche über ID, Provider, Titel und Beschreibung (Rang 0).
  function searchRank(e, query) {
    const q = String(query).trim().toLowerCase();
    if (q === '') return 0;
    if (/^\d+$/.test(q)) {
      const n = Number(q);
      if (Number.isSafeInteger(n) && e.eventId === n) return 0;
      const word = new RegExp('(?<![\\p{L}\\p{N}])' + q + '(?![\\p{L}\\p{N}])', 'u');
      return word.test((e.provider || '') + '\n' + e.title + '\n' + (e.description || '')) ? 1 : null;
    }
    return haystack(e).includes(q) ? 0 : null;
  }
  function haystack(e) { return (String(e.eventId) + '\n' + (e.provider || '') + '\n' + e.title + '\n' + (e.description || '')).toLowerCase(); }
  function entryMatches(e, f, model) {
    if (f.topic !== '' && model.topicOf(e) !== f.topic) return false;
    if (f.ratings.length && !f.ratings.includes(e.rating)) return false;
    if (f.collector !== 'all' && !e.collector.includes(f.collector)) return false;
    if (f.collisionOnly && !(model.idCount.get(e.eventId) > 1)) return false;
    if (searchRank(e, f.q) === null) return false;
    return true;
  }

  // ── DOM-Bausteine ────────────────────────────────────────────
  function el(doc, tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function badge(doc, rating, labels, small) {
    const ui = RATING_UI[rating];
    const b = el(doc, 'span', small ? 'er-badge er-badge-sm ' + ui.cls : 'er-badge ' + ui.cls);
    b.setAttribute('data-rating', rating);
    b.appendChild(el(doc, 'span', 'er-badge-sym', ui.symbol)).setAttribute('aria-hidden', 'true');
    b.appendChild(el(doc, 'span', 'er-badge-txt', labels[rating]));
    return b;
  }
  function marker(doc, key) {
    const ui = MARKER_UI[key];
    const m = el(doc, 'span', 'er-marker ' + ui.cls, ui.text);
    m.setAttribute('data-marker', key);
    return m;
  }
  function safeHttpsUrl(u) {
    if (typeof u !== 'string') return null;
    try { const x = new URL(u); return x.protocol === 'https:' && x.hostname ? x : null; } catch (err) { return null; }
  }
  function placeLabel(e) {
    return (e.provider !== null ? e.provider : 'Provider nicht belegt') + ' · ' + (e.channel !== null ? e.channel : 'Kanal offen');
  }

  function entryNode(doc, e, model, key) {
    const art = el(doc, 'article', 'er-entry');
    art.setAttribute('data-entry', '');
    art.setAttribute('data-event-id', String(e.eventId));
    art.setAttribute('data-rating', e.rating);
    art.setAttribute('data-key', key);

    const head = el(doc, 'div', 'er-entry-head');
    head.appendChild(badge(doc, e.rating, model.labels));
    const marks = el(doc, 'span', 'er-markers');
    if (e.contextual) marks.appendChild(marker(doc, 'contextual'));
    if (!e.verified) marks.appendChild(marker(doc, 'draft'));
    if (!e.reviewed) marks.appendChild(marker(doc, 'provisional'));
    if (e.harmlessDisputed) marks.appendChild(marker(doc, 'disputed'));
    if (e.collector.length === 0 && model.groupOf(e) !== NO_COLLECTOR) marks.appendChild(marker(doc, 'nocollector'));
    head.appendChild(marks);
    art.appendChild(head);

    art.appendChild(el(doc, 'h4', 'er-entry-title', e.title));

    const where = el(doc, 'p', 'er-where');
    const prov = el(doc, 'span', 'er-where-item');
    prov.appendChild(el(doc, 'span', 'er-where-k', 'Provider: '));
    prov.appendChild(el(doc, 'span', e.provider !== null ? 'er-where-v' : 'er-where-v er-unknown', e.provider !== null ? e.provider : 'Provider nicht belegt'));
    where.appendChild(prov);
    const ch = el(doc, 'span', 'er-where-item');
    ch.appendChild(el(doc, 'span', 'er-where-k', 'Kanal: '));
    ch.appendChild(el(doc, 'span', e.channel !== null ? 'er-where-v' : 'er-where-v er-unknown', e.channel !== null ? e.channel : 'nicht festgelegt'));
    where.appendChild(ch);
    if (e.provider === null && e.providerHint.length) {
      const hint = el(doc, 'span', 'er-where-item');
      hint.appendChild(el(doc, 'span', 'er-where-k', 'Hinweis auf Provider: '));
      hint.appendChild(el(doc, 'span', 'er-where-v', e.providerHint.join(', ')));
      where.appendChild(hint);
    }
    if (e.collector.length) {
      const co = el(doc, 'span', 'er-where-item');
      co.appendChild(el(doc, 'span', 'er-where-k', 'Collector: '));
      co.appendChild(el(doc, 'span', 'er-where-v', e.collector.map(c => (c === 'client' ? 'Client' : 'Server')).join(', ')));
      where.appendChild(co);
    }
    art.appendChild(where);

    art.appendChild(el(doc, 'p', e.description !== null ? 'er-desc' : 'er-desc er-none', e.description !== null ? e.description : 'Noch keine Beschreibung'));

    if (e.escalation !== null) {
      const esc = el(doc, 'div', 'er-esc');
      esc.appendChild(el(doc, 'div', 'er-esc-label', 'Wann wird es kritisch'));
      esc.appendChild(el(doc, 'p', 'er-esc-text', e.escalation));
      art.appendChild(esc);
    }

    // Quelle: Link nur bei https
    if (e.sourceUrl !== null) {
      const src = el(doc, 'p', 'er-source');
      src.appendChild(el(doc, 'span', 'er-where-k', 'Quelle: '));
      const url = safeHttpsUrl(e.sourceUrl);
      if (url) {
        const a = el(doc, 'a', 'er-link', 'Herstellerdokumentation (' + url.hostname + ')');
        a.href = url.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        src.appendChild(a);
      } else {
        src.appendChild(el(doc, 'span', 'er-unknown', 'Adresse nicht verlinkt (keine gültige https-Adresse)'));
      }
      const bits = [];
      if (e.sourceLegacy) bits.push('archivierte Dokumentation');
      if (e.verifiedAt !== null) bits.push('geprüft am ' + e.verifiedAt);
      if (bits.length) src.appendChild(el(doc, 'span', 'er-source-meta', ' · ' + bits.join(' · ')));
      art.appendChild(src);
    }

    if (e.notes !== null) {
      const warn = /Verwechslungsgefahr/.test(e.notes);
      const n = el(doc, 'div', warn ? 'er-notes er-notes-warn' : 'er-notes');
      n.appendChild(el(doc, 'div', 'er-notes-label', warn ? 'Hinweis: Verwechslungsgefahr' : 'Hinweis'));
      n.appendChild(el(doc, 'p', 'er-notes-text', e.notes));
      art.appendChild(n);
    }
    return art;
  }

  let instanceCounter = 0;

  // ── Seite aufbauen ───────────────────────────────────────────
  // Baut den gesamten Inhalt in container; ohne Netzwerk, mit beliebigen Daten. Wirft bei falschem Aufbau.
  function render(data, container, options) {
    const model = buildModel(data);
    const doc = container.ownerDocument;
    const uid = 'er' + (++instanceCounter);
    const opts = options || {};
    container.textContent = '';
    container.classList.add('er-root');

    const total = model.entries.length;
    const verified = data.codes.filter(e => isObj(e) && e.verified === true && normalizeEntry(e)).length;
    const reviewed = data.codes.filter(e => isObj(e) && e.reviewed === true && normalizeEntry(e)).length;

    // Kopf
    const top = el(doc, 'section', 'er-head');
    top.appendChild(el(doc, 'h1', 'er-h1', 'Event-Referenz'));
    top.appendChild(el(doc, 'p', 'er-intro',
      'Was bedeutet eine Windows-Event-ID, und wie auffällig ist sie? Die Einstufung ist eine Grundeinstufung: Ob aus einer Meldung ein Problem wird, ' +
      'entscheiden Häufung und Kontext (siehe „Wann wird es kritisch“). Dieselbe ID kann je Provider etwas völlig anderes bedeuten, deshalb stehen Kanal und Provider immer dabei.'));
    const stats = el(doc, 'dl', 'er-stats');
    [['Einträge', total], ['davon geprüft (Quelle belegt)', verified], ['davon Einstufung bestätigt', reviewed]].forEach(([k, v]) => {
      const box = el(doc, 'div', 'er-stat');
      box.appendChild(el(doc, 'dt', 'er-stat-k', k));
      box.appendChild(el(doc, 'dd', 'er-stat-v', String(v)));
      stats.appendChild(box);
    });
    top.appendChild(stats);
    container.appendChild(top);

    if (model.skipped > 0) {
      const w = el(doc, 'p', 'er-skipped', model.skipped + (model.skipped === 1 ? ' ungültiger Eintrag wurde übersprungen.' : ' ungültige Einträge wurden übersprungen.'));
      w.setAttribute('role', 'status');
      container.appendChild(w);
    }
    if (total === 0) {
      const a = el(doc, 'p', 'er-error', 'Die Datei enthält keine gültigen Einträge.');
      a.setAttribute('role', 'alert');
      container.appendChild(a);
      return { root: container, model, getFilters: defaultFilters, setFilters() {}, visibleCount: () => 0, goToId: () => false };
    }

    // Legende
    const leg = el(doc, 'section', 'er-legend');
    leg.appendChild(el(doc, 'h2', 'er-h2', 'Legende'));
    const ratingList = el(doc, 'ul', 'er-legend-list');
    RATINGS.forEach(r => {
      const li = el(doc, 'li', 'er-legend-item');
      li.appendChild(badge(doc, r, model.labels));
      li.appendChild(el(doc, 'span', 'er-legend-def', RATING_UI[r].def));
      ratingList.appendChild(li);
    });
    leg.appendChild(ratingList);
    const markList = el(doc, 'ul', 'er-legend-list');
    ['draft', 'provisional', 'contextual', 'disputed', 'nocollector'].forEach(k => {
      const li = el(doc, 'li', 'er-legend-item');
      li.appendChild(marker(doc, k));
      li.appendChild(el(doc, 'span', 'er-legend-def', MARKER_UI[k].def));
      markList.appendChild(li);
    });
    leg.appendChild(markList);
    container.appendChild(leg);

    // Bedienung
    const ctl = el(doc, 'section', 'er-controls');
    ctl.setAttribute('aria-label', 'Suche und Filter');
    const qWrap = el(doc, 'div', 'er-field er-field-q');
    const qLabel = el(doc, 'label', 'er-label', 'Suche (ID, Provider, Titel, Beschreibung)');
    qLabel.htmlFor = uid + '-q';
    const qIn = el(doc, 'input', 'er-input');
    qIn.type = 'search'; qIn.id = uid + '-q'; qIn.autocomplete = 'off'; qIn.placeholder = 'z. B. 41 oder Kernel-Power'; qIn.maxLength = 200;
    qWrap.appendChild(qLabel); qWrap.appendChild(qIn);
    ctl.appendChild(qWrap);

    const tWrap = el(doc, 'div', 'er-field');
    const tLabel = el(doc, 'label', 'er-label', 'Thema'); tLabel.htmlFor = uid + '-topic';
    const tSel = el(doc, 'select', 'er-input'); tSel.id = uid + '-topic';
    const addOpt = (v, t) => { const o = doc.createElement('option'); o.value = v; o.textContent = t; tSel.appendChild(o); };
    addOpt('', 'Alle Themen');
    model.sections.forEach(s => addOpt(s.topic, s.label));
    tWrap.appendChild(tLabel); tWrap.appendChild(tSel);
    ctl.appendChild(tWrap);

    const rSet = el(doc, 'fieldset', 'er-field er-fieldset');
    rSet.appendChild(el(doc, 'legend', 'er-label', 'Einstufung (mehrfach wählbar)'));
    const rBoxes = {};
    RATINGS.forEach(r => {
      const lab = el(doc, 'label', 'er-check');
      const cb = el(doc, 'input'); cb.type = 'checkbox'; cb.value = r; rBoxes[r] = cb;
      lab.appendChild(cb); lab.appendChild(badge(doc, r, model.labels));
      rSet.appendChild(lab);
    });
    ctl.appendChild(rSet);

    const cSet = el(doc, 'fieldset', 'er-field er-fieldset');
    cSet.appendChild(el(doc, 'legend', 'er-label', 'Collector'));
    const cRadios = {};
    [['all', 'Alle'], ['client', 'Client'], ['server', 'Server']].forEach(([v, t]) => {
      const lab = el(doc, 'label', 'er-check');
      const rb = el(doc, 'input'); rb.type = 'radio'; rb.name = uid + '-collector'; rb.value = v; cRadios[v] = rb;
      lab.appendChild(rb); lab.appendChild(el(doc, 'span', 'er-check-txt', t));
      cSet.appendChild(lab);
    });
    ctl.appendChild(cSet);

    const colLab = el(doc, 'label', 'er-check er-field');
    const colCb = el(doc, 'input'); colCb.type = 'checkbox';
    colLab.appendChild(colCb); colLab.appendChild(el(doc, 'span', 'er-check-txt', 'Nur Verwechslungsgefahr'));
    ctl.appendChild(colLab);

    const reset = el(doc, 'button', 'er-btn', 'Filter zurücksetzen'); reset.type = 'button';
    ctl.appendChild(reset);
    container.appendChild(ctl);

    const count = el(doc, 'p', 'er-count');
    count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite');
    container.appendChild(count);

    // Inhalt
    // Bei einer Suche nach reinen Ziffern stehen die Treffer in dieser Liste (genaue ID zuerst); die Karten werden dafür verschoben und beim Löschen zurückgesetzt.
    const results = el(doc, 'section', 'er-results');
    results.hidden = true;
    results.appendChild(el(doc, 'h2', 'er-h2', 'Suchergebnis: genaue ID zuerst, danach Nennungen im Text'));
    const resultsList = el(doc, 'div', 'er-results-list');
    results.appendChild(resultsList);
    container.appendChild(results);
    const content = el(doc, 'div', 'er-content');
    const entryRefs = [], cardRefs = [], sectionRefs = [];
    const firstCardOfId = new Map();
    const cardById = new Map();
    const cardIdOf = (eventId, group) => uid + '-card-' + eventId + '-' + model.groupIndex(group);
    function focusCard(target) {
      if (!target.visible) setFilters(defaultFilters());
      cardRefs.forEach(c => c.el.classList.remove('er-flash'));
      target.el.classList.add('er-flash');
      if (opts.noScroll !== true) {
        // Sprung ohne Animation (wie ein Anker); "instant" überschreibt scroll-behavior:smooth aus dem CSS
        try { target.el.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch (err) { target.el.scrollIntoView(); }
        try { target.el.focus({ preventScroll: true }); } catch (err) { /* ältere Browser */ }
      }
      const w = doc.defaultView;
      if (flashTimer && w) w.clearTimeout(flashTimer);
      if (w) flashTimer = w.setTimeout(() => target.el.classList.remove('er-flash'), 3000);
    }
    let flashTimer = null;
    model.sections.forEach(s => {
      const sec = el(doc, 'section', 'er-topic');
      sec.setAttribute('data-topic', s.topic);
      const h = el(doc, 'h2', 'er-h2');
      h.appendChild(el(doc, 'span', 'er-topic-name', s.label));
      const cnt = el(doc, 'span', 'er-topic-count', String(s.count));
      h.appendChild(cnt);
      sec.appendChild(h);
      if (s.note) sec.appendChild(el(doc, 'p', 'er-topic-note', s.note));
      const secRef = { el: sec, cnt, cards: [], total: s.count };
      s.cards.forEach(c => {
        const card = el(doc, 'section', 'er-card');
        card.id = cardIdOf(c.eventId, c.topic);
        card.tabIndex = -1;
        card.setAttribute('data-event-id', String(c.eventId));
        if (c.collision) card.setAttribute('data-collision', '');
        const ch = el(doc, 'h3', 'er-h3', 'ID ' + c.eventId);
        card.appendChild(ch);
        if (c.collision) {
          const hint = el(doc, 'p', 'er-collision', '⚠ ' + COLLISION_TEXT);
          hint.setAttribute('data-collision-hint', '');
          card.appendChild(hint);
        }
        const grid = el(doc, 'div', c.entries.length > 1 ? 'er-entries er-entries-multi' : 'er-entries');
        const cardRef = { el: card, sec, collision: c.collision, entries: [], eventId: c.eventId, groupIndex: c.topicIndex, visible: true };
        c.entries.forEach(e => {
          const key = String(e.channel) + '|' + String(e.provider) + '|' + e.eventId + '|' + (e.providerHint[0] || '');
          const node = entryNode(doc, e, model, key);
          grid.appendChild(node);
          const ref = { el: node, e, rank: 0 };
          entryRefs.push(ref); cardRef.entries.push(ref);
        });
        card.appendChild(grid);
        // Gegenstück: gleiche ID in einer anderen Gruppe, kompakt direkt in der Karte (zählt nicht als Eintrag), mit Link auf die andere Karte
        if (c.others.length) {
          const x = el(doc, 'div', 'er-xref');
          x.appendChild(el(doc, 'div', 'er-xref-label', 'Gegenstück mit gleicher ID in einem anderen Thema:'));
          const ul = el(doc, 'ul', 'er-xref-list');
          c.others.forEach(o => {
            const li = el(doc, 'li', 'er-xref-item');
            li.setAttribute('data-xref', '');
            const line = el(doc, 'div', 'er-xref-line');
            line.appendChild(badge(doc, o.rating, model.labels, true));
            const tt = el(doc, 'span', 'er-xref-title', o.title);
            tt.setAttribute('title', o.title);
            line.appendChild(tt);
            li.appendChild(line);
            li.appendChild(el(doc, 'div', 'er-xref-meta', placeLabel(o) + ' · ' + model.labelOf(model.groupOf(o))));
            const targetId = cardIdOf(o.eventId, model.groupOf(o));
            const a = el(doc, 'a', 'er-link er-xref-link', 'Zur Karte „ID ' + o.eventId + '“ im Thema ' + model.labelOf(model.groupOf(o)));
            a.href = '#' + targetId;
            a.setAttribute('data-target', targetId);
            a.addEventListener('click', ev => { const t = cardById.get(targetId); if (t) { ev.preventDefault(); focusCard(t); } });
            li.appendChild(a);
            ul.appendChild(li);
          });
          x.appendChild(ul);
          card.appendChild(x);
        }
        sec.appendChild(card);
        cardRefs.push(cardRef); secRef.cards.push(cardRef); cardById.set(card.id, cardRef);
        if (!firstCardOfId.has(c.eventId)) firstCardOfId.set(c.eventId, cardRef);
      });
      content.appendChild(sec);
      sectionRefs.push(secRef);
    });
    container.appendChild(content);

    const empty = el(doc, 'p', 'er-empty', 'Keine Einträge passen zu Suche und Filtern.');
    empty.hidden = true;
    container.appendChild(empty);

    // Zustand
    let filters = defaultFilters();
    let visibleTotal = total;
    let resultsMode = false;

    function apply() {
      let visible = 0;
      entryRefs.forEach(r => { const ok = entryMatches(r.e, filters, model); r.el.hidden = !ok; r.visible = ok; r.rank = ok ? searchRank(r.e, filters.q) : null; if (ok) visible++; });
      cardRefs.forEach(c => { const any = c.entries.some(r => r.visible); c.el.hidden = !any; c.visible = any; });
      // Ziffernsuche: Treffer als Liste, genaue ID zuerst, dann nach Gruppe und ID; sonst Karten an ihren Platz in den Gruppen zurücksetzen
      if (resultsMode) { cardRefs.forEach(c => c.sec.appendChild(c.el)); resultsMode = false; }
      if (/^\d+$/.test(filters.q.trim())) {
        const ranked = cardRefs.filter(c => c.visible).map(c => ({ c, rank: Math.min(...c.entries.filter(r => r.visible).map(r => r.rank)) }));
        ranked.sort((x, y) => x.rank - y.rank || x.c.groupIndex - y.c.groupIndex || x.c.eventId - y.c.eventId);
        ranked.forEach(x => resultsList.appendChild(x.c.el));
        resultsMode = ranked.length > 0;
      }
      results.hidden = !resultsMode;
      sectionRefs.forEach(s => {
        const n = s.cards.reduce((a, c) => a + c.entries.filter(r => r.visible).length, 0);
        s.el.hidden = n === 0;
        s.cnt.textContent = n === s.total ? String(s.total) : n + ' von ' + s.total;
      });
      visibleTotal = visible;
      count.textContent = visible === total ? total + ' Einträge' : visible + ' von ' + total + ' Einträgen';
      empty.hidden = visible !== 0;
    }
    function syncControls() {
      qIn.value = filters.q;
      tSel.value = filters.topic;
      RATINGS.forEach(r => { rBoxes[r].checked = filters.ratings.includes(r); });
      COLLECTORS.concat('all').forEach(v => { cRadios[v].checked = filters.collector === v; });
      colCb.checked = filters.collisionOnly;
    }
    function setFilters(part) {
      const f = Object.assign({}, filters, part || {});
      f.q = typeof f.q === 'string' ? f.q.slice(0, 200) : '';
      f.topic = typeof f.topic === 'string' && (f.topic === '' || model.sections.some(s => s.topic === f.topic)) ? f.topic : '';
      f.ratings = Array.isArray(f.ratings) ? RATINGS.filter(r => f.ratings.includes(r)) : [];
      f.collector = f.collector === 'client' || f.collector === 'server' ? f.collector : 'all';
      f.collisionOnly = f.collisionOnly === true;
      filters = f;
      syncControls();
      apply();
    }
    qIn.addEventListener('input', () => setFilters({ q: qIn.value }));
    tSel.addEventListener('change', () => setFilters({ topic: tSel.value }));
    RATINGS.forEach(r => rBoxes[r].addEventListener('change', () => setFilters({ ratings: RATINGS.filter(x => rBoxes[x].checked) })));
    COLLECTORS.concat('all').forEach(v => cRadios[v].addEventListener('change', () => { if (cRadios[v].checked) setFilters({ collector: v }); }));
    colCb.addEventListener('change', () => setFilters({ collisionOnly: colCb.checked }));
    reset.addEventListener('click', () => setFilters(defaultFilters()));

    // Springt zur ersten Karte der ID (Filter werden zurückgesetzt, falls die Karte ausgeblendet ist).
    function goToId(id) {
      const target = firstCardOfId.get(id);
      if (!target) {
        count.textContent = 'ID ' + id + ' steht nicht in der Referenz.';
        return false;
      }
      focusCard(target);
      return true;
    }

    setFilters(defaultFilters());
    return { root: container, model, getFilters: () => Object.assign({}, filters), setFilters, visibleCount: () => visibleTotal, goToId };
  }

  // ── Laden ────────────────────────────────────────────────────
  function showError(container, message) {
    container.textContent = '';
    const doc = container.ownerDocument;
    const a = el(doc, 'div', 'er-error');
    a.setAttribute('role', 'alert');
    a.appendChild(el(doc, 'strong', null, 'Die Event-Referenz kann nicht angezeigt werden. '));
    a.appendChild(doc.createTextNode(message));
    container.appendChild(a);
  }

  async function load(url) {
    let res;
    try { res = await fetch(url); } catch (err) { throw new Error('Die Datei konnte nicht geladen werden (Netzwerkfehler).'); }
    if (!res.ok) throw new Error('Die Datei konnte nicht geladen werden (HTTP ' + res.status + ').');
    const text = await res.text();
    try { return JSON.parse(text); } catch (err) { throw new Error('Die Datei ist kein gültiges JSON.'); }
  }

  // Lädt die Datei und baut die Seite; Hash (#41) und ?q= werden ausgewertet. Fehler erscheinen als Meldung (role="alert").
  async function run(container, url, loc) {
    const where = loc || root.location;
    let ctrl = null;
    try {
      const data = await load(url);
      ctrl = render(data, container);
    } catch (err) {
      showError(container, err && err.message ? err.message : 'Unbekannter Fehler.');
      return null;
    }
    const q = new URLSearchParams(where.search).get('q');
    if (q) ctrl.setFilters({ q });
    function fromHash() {
      const m = /^#(\d{1,10})$/.exec(where.hash || '');
      if (m) ctrl.goToId(Number(m[1]));
    }
    fromHash();
    root.addEventListener('hashchange', fromHash);
    return ctrl;
  }

  const API = { RATINGS, RATING_UI, MARKER_UI, COLLISION_TEXT, NO_COLLECTOR_LABEL, validate, buildModel, entryMatches, searchRank, defaultFilters, render, load, run, showError };
  root.EventlogReferenz = API;

  const auto = root.document && root.document.getElementById('er-root');
  if (auto && auto.getAttribute('data-src')) {
    auto.setAttribute('aria-busy', 'true');
    run(auto, auto.getAttribute('data-src')).then(c => { auto.removeAttribute('aria-busy'); root.__ER_CONTROLLER = c; root.__ER_READY = true; });
  }
})(typeof window !== 'undefined' ? window : this);
