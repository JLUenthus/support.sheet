// ============================================================
// mailheader.js – Anbindung des Mail-Header-Analyzers (mailheader.html) an js/mailheader-core.js
// Alles lokal: keine Netzwerkabfragen, kein localStorage, kein IndexedDB, kein Cookie, keine Historie. Alle Anzeigewerte über textContent (nie innerHTML).
// Adressen, Domains und URLs aus den Headern werden nie zu Links und nie geladen. Dieses Skript steht hinter nav.js (setzt die Beschriftung im Logo).
// ============================================================
(function () {
  'use strict';
  const C = window.MailHeaderCore;
  const $ = (id) => document.getElementById(id);
  let current = null;            // nur im Speicher: Ergebnis der letzten Auswertung (wird von "Alles löschen" verworfen)
  let rawText = '';

  // nav.js kennt die Seite nur über den Eintrag in PAGES und setzt das Logo-Suffix ".tools": hier auf ".mail" stellen
  const logoSuffix = document.querySelector('#as-logo-label span');
  if (logoSuffix) logoSuffix.textContent = '.mail';

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
  function row(box, key, val, sub, head) {
    const r = el('div', 'mh-row' + (head ? ' mh-row--head' : ''));
    r.appendChild(el('div', 'mh-row-key', key));
    const v = el('div', 'mh-row-val'); v.appendChild(document.createTextNode(val === undefined || val === null || val === '' ? '-' : String(val)));
    (Array.isArray(sub) ? sub : sub ? [sub] : []).forEach((s) => v.appendChild(el('span', 'mh-row-sub', s)));
    r.appendChild(v); box.appendChild(r);
  }
  function setMsg(text, err) { const m = $('mh-msg'); m.textContent = text || ''; m.className = 'mh-msg' + (err ? ' mh-msg--err' : ''); }
  const addr = (list) => (list || []).map((a) => (a.display ? a.display + ' ' : '') + (a.address ? '<' + a.address + '>' : a.raw)).join(', ');

  function clearOutput() {
    ['mh-summary', 'mh-hints', 'mh-hops-body', 'mh-auth', 'mh-ms', 'mh-raw'].forEach((id) => { const n = $(id); while (n.firstChild) n.removeChild(n.firstChild); });
    $('mh-results').hidden = true; $('mh-copy-msg').textContent = ''; $('mh-search-count').textContent = ''; $('mh-search').value = '';
    current = null;
  }

  function renderSummary(a) {
    const box = $('mh-summary'), s = a.summary;
    row(box, 'Betreff', s.subject); row(box, 'Datum', s.date, s.dateUtc ? 'UTC: ' + s.dateUtc : '');
    row(box, 'Message-ID', s.messageId, s.messageIdDomain ? 'Domain: ' + s.messageIdDomain : '');
    row(box, 'From', addr(s.from)); if (s.sender.length) row(box, 'Sender', addr(s.sender)); if (s.replyTo.length) row(box, 'Reply-To', addr(s.replyTo)); if (s.returnPath.length) row(box, 'Return-Path', addr(s.returnPath));
    row(box, 'To / Cc', s.toCount + ' Empfänger in To, ' + s.ccCount + ' in Cc (ohne Prüfung)');
    row(box, 'Größe der Header', s.headerBytes + ' Zeichen'); row(box, 'Hops', String(s.hopCount)); row(box, 'Gesamtlaufzeit', s.totalMs === null ? 'nicht ermittelbar' : C.fmtDur(s.totalMs));
    if (s.mailer) row(box, 'X-Mailer', s.mailer);
    if (a.bodyDiscarded) row(box, 'Rumpf', 'wurde verworfen und nicht ausgewertet');
  }
  function renderHints(a) {
    const ul = $('mh-hints');
    if (!a.hints.length) { ul.appendChild(el('li', 'mh-empty', 'Keine Auffälligkeiten gefunden. Das ist kein Beleg für Echtheit: die Auswertung prüft nur die Header.')); return; }
    const label = { warnung: 'Warnung', hinweis: 'Hinweis', info: 'Info' };
    a.hints.forEach((h) => {
      const li = el('li', 'mh-hint mh-hint--' + h.severity), head = el('div', 'mh-hint-head');
      head.appendChild(el('span', 'mh-badge mh-badge--' + h.severity, label[h.severity])); head.appendChild(el('span', 'mh-hint-title', h.titel)); li.appendChild(head);
      li.appendChild(el('div', 'mh-hint-why', h.begruendung));
      if (h.werte.length) li.appendChild(el('div', 'mh-hint-vals', h.werte.join('  |  ')));
      ul.appendChild(li);
    });
  }
  function renderHops(a) {
    const tb = $('mh-hops-body');
    if (!a.hops.length) { const tr = el('tr'), td = el('td', 'mh-empty', 'Keine Received-Header gefunden.'); td.colSpan = 7; tr.appendChild(td); tb.appendChild(tr); return; }
    a.hops.forEach((h) => {
      const tr = el('tr', (h.maxDelay ? 'mh-row-max ' : '') + (h.clockSkew ? 'mh-row-skew ' : '') + (!h.ok ? 'mh-row-bad' : ''));
      tr.appendChild(el('td', 'mh-num', String(h.nr)));
      if (!h.ok) { const td = el('td', '', 'nicht auswertbar: ' + h.reason); td.colSpan = 6; td.appendChild(el('span', 'mh-sub', h.raw.slice(0, 300))); tr.appendChild(td); tb.appendChild(tr); return; }
      const from = el('td', '', h.from.name || '?'); if (h.from.ip) from.appendChild(el('span', 'mh-sub', h.from.ip + ' (' + h.from.ipKind + ')')); if (h.fromExo) from.appendChild(el('span', 'mh-sub', 'Exchange Online')); tr.appendChild(from);
      const by = el('td', '', h.by || '?'); if (h.byExo) by.appendChild(el('span', 'mh-sub', 'Exchange Online')); tr.appendChild(by);
      const pr = el('td', '', h.protocol || '-'); pr.appendChild(el('span', 'mh-sub', h.tls === true ? 'verschlüsselt (TLS)' + (h.tlsVersion ? ' ' + h.tlsVersion : '') : h.tls === false ? 'ohne Verschlüsselung erkennbar' : 'Verschlüsselung unbekannt')); tr.appendChild(pr);
      const t = el('td', 'mh-num', h.utc || '-'); if (h.zone) t.appendChild(el('span', 'mh-sub', 'Zone ' + h.zone)); tr.appendChild(t);
      tr.appendChild(el('td', 'mh-num', h.clockSkew ? 'Uhr weicht ab' : h.delayMs === null ? '-' : '+' + C.fmtDur(h.delayMs)));
      const note = []; if (h.maxDelay) note.push('größte Verzögerung'); if (h.delaySeverity === 'warnung') note.push('Warnung: ab 5 Minuten'); else if (h.delaySeverity === 'hinweis') note.push('Hinweis: ab 60 Sekunden'); if (h.einlieferer) note.push('mutmaßlicher Einlieferer'); if (h.clockSkew) note.push('Verzögerung nicht gerechnet');
      tr.appendChild(el('td', '', note.join('; ') || '-')); tb.appendChild(tr);
    });
  }
  function renderAuth(a) {
    const box = $('mh-auth'), u = a.auth;
    const one = (name, x, extra) => {
      if (!x) { row(box, name, 'kein Ergebnis in den Headern'); return; }
      row(box, name, x.result + (extra ? ' (' + extra + ')' : ''), [x.erklaerung].filter(Boolean).concat(x.server ? ['ausgewertet von: ' + x.server] : []));
    };
    one('SPF', u.spf, u.spf ? 'smtp.mailfrom ' + (u.spf.mailfrom || '-') + (u.spf.aligned ? ', ausgerichtet' : ', nicht ausgerichtet') : '');
    one('DKIM', u.dkim, u.dkim ? 'header.d ' + (u.dkim.domain || '-') + (u.dkim.aligned ? ', ausgerichtet' : ', nicht ausgerichtet') : '');
    if (u.dmarc) row(box, 'DMARC', u.dmarc.result + (u.dmarc.policy ? ', Richtlinie p=' + u.dmarc.policy : '') + (u.dmarc.action ? ', action=' + u.dmarc.action : ''), [u.dmarc.erklaerung, u.dmarc.actionErklaerung, u.dmarc.action && !u.dmarc.actionErklaerung ? 'action ' + u.dmarc.action + ': ohne Erklärung' : ''].filter(Boolean)); else row(box, 'DMARC', 'kein Ergebnis in den Headern');
    if (u.compauth) row(box, 'compauth', u.compauth.result + (u.compauth.reason ? ' (reason=' + u.compauth.reason + ')' : ''), [u.compauth.erklaerung, u.compauth.reason ? (u.compauth.reasonText ? 'reason ' + u.compauth.reason + ': ' + u.compauth.reasonText : 'reason ' + u.compauth.reason + ': ohne Erklärung') : ''].filter(Boolean));
    u.instances.forEach((i, n) => row(box, 'Authentication-Results ' + (n + 1), i.server || '(ohne Servername)', [n === 0 ? 'oberster Eintrag: der des letzten Empfängers' : ''].filter(Boolean).concat(i.results.map((r) => r.method + '=' + r.result + (r.comment ? ' (' + r.comment + ')' : ''))), true));
    u.spfHeaders.forEach((s, n) => row(box, 'Received-SPF ' + (n + 1), s.result || '-', s.raw.slice(0, 300)));
    u.arc.seals.forEach((s) => row(box, 'ARC-Seal i=' + s.instance, 'cv=' + (s.cv || '-'), 'd=' + s.d + ' s=' + s.s + ' a=' + s.a));
    u.arc.results.forEach((r) => row(box, 'ARC-Authentication-Results i=' + r.instance, r.server || '(ohne Servername)', r.results.map((x) => x.method + '=' + x.result)));
    u.dkimSignatures.forEach((d, n) => row(box, 'DKIM-Signature ' + (n + 1), 'd=' + d.d + ' s=' + d.s, ['a=' + d.a, 'h=' + d.h]));
  }
  function renderMs(a) {
    const box = $('mh-ms'), m = a.ms; let any = false;
    m.forefront.forEach((fields, n) => { any = true; row(box, 'X-Forefront-Antispam-Report' + (m.forefront.length > 1 ? ' ' + (n + 1) : ''), fields.length + ' Felder', null, true); fields.forEach((f) => row(box, f.key, f.value || '(leer)', f.erklaert ? [f.erklaerung, f.wertErklaerung ? 'Wert: ' + f.wertErklaerung : ''].filter(Boolean) : ['ohne Erklärung'])); });
    m.antispam.forEach((fields) => { any = true; row(box, 'X-Microsoft-Antispam', fields.length + ' Felder', null, true); fields.forEach((f) => row(box, f.key, f.value || '(leer)', f.erklaert ? [f.erklaerung] : ['ohne Erklärung'])); });
    m.org.forEach((o) => { any = true; row(box, o.name, o.value, [o.erklaerung, o.wertErklaerung ? 'Wert: ' + o.wertErklaerung : ''].filter(Boolean), true); });
    m.crossTenant.forEach((o) => { any = true; row(box, o.name, o.value, 'ohne Erklärung', true); });
    if (!any) box.appendChild(el('div', 'mh-empty', 'Keine Microsoft-Spam-Header in dieser Nachricht.'));
  }
  function renderRaw(a) {
    const box = $('mh-raw');
    a.raw.forEach((h) => { const d = el('div', 'mh-raw-line' + (h.key ? ' mh-raw-line--key' : '')); d.appendChild(el('span', 'mh-raw-name', h.name + ': ')); d.appendChild(document.createTextNode(h.value)); box.appendChild(d); });
    a.unparsable.forEach((l) => { const d = el('div', 'mh-raw-line mh-raw-line--bad'); d.appendChild(document.createTextNode('(nicht lesbar) ' + l)); box.appendChild(d); });
    if (!a.raw.length && !a.unparsable.length) box.appendChild(el('div', 'mh-empty', 'Keine Header.'));
  }

  function analyzeText(text) {
    clearOutput();
    rawText = text;
    if (!String(text).trim()) { setMsg('Bitte Header einfügen oder eine Datei ablegen.', true); return null; }
    const p = C.parse(text);
    if (!p.ok) { setMsg(p.error, true); return null; }
    if (!p.headers.length) { setMsg('In der Eingabe wurden keine Header erkannt (erwartet: Zeilen der Form "Name: Wert").', true); return null; }
    const a = C.analyze(p);
    current = a;
    renderSummary(a); renderHints(a); renderHops(a); renderAuth(a); renderMs(a); renderRaw(a);
    $('mh-results').hidden = false;
    setMsg(a.hops.length + ' Hops, ' + a.hints.filter((h) => h.severity !== 'info').length + ' Hinweise und Warnungen ausgewertet. Es wurde nichts übertragen oder gespeichert.', false);
    return a;
  }

  async function copyText(text) {
    try { if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* weiter mit dem Rückfall */ }
    try { const t = document.createElement('textarea'); t.value = text; t.readOnly = true; t.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return !!ok; } catch (e) { return false; }
  }

  function handleFile(file) {
    if (!file) return;
    const name = String(file.name || '');
    if (/\.msg$/i.test(name)) { clearOutput(); setMsg('.msg-Dateien (Binärformat) werden nicht unterstützt. Bitte die Header aus Outlook kopieren oder die Nachricht als .eml speichern.', true); return; }
    if (!/\.(eml|txt)$/i.test(name)) { clearOutput(); setMsg('Nur .eml- und .txt-Dateien werden unterstützt.', true); return; }
    if (file.size > C.MAX_CHARS) { clearOutput(); setMsg('Die Datei ist größer als 5 MB und wird nicht ausgewertet.', true); return; }
    const reader = new FileReader();
    reader.onload = () => { $('mh-input').value = String(reader.result || ''); analyzeText($('mh-input').value); };
    reader.onerror = () => { clearOutput(); setMsg('Die Datei konnte nicht gelesen werden.', true); };
    reader.readAsText(file);
  }

  $('mh-run').addEventListener('click', () => { analyzeText($('mh-input').value); });
  $('mh-clear').addEventListener('click', () => { $('mh-input').value = ''; $('mh-file').value = ''; rawText = ''; clearOutput(); setMsg('Eingabe und Ausgabe sind geleert.', false); });
  $('mh-copy-summary').addEventListener('click', async () => {
    if (!current) return;
    const ok = await copyText(C.buildSummaryText(current));
    $('mh-copy-msg').textContent = ok ? 'Zusammenfassung kopiert.' : 'Kopieren nicht möglich.';
  });
  $('mh-copy-raw').addEventListener('click', async () => {
    if (!current) return;
    const ok = await copyText(current.raw.map((h) => h.name + ': ' + h.value).join('\n'));
    $('mh-copy-msg').textContent = ok ? 'Rohdaten kopiert.' : 'Kopieren nicht möglich.';
  });
  $('mh-search').addEventListener('input', () => {
    if (!current) return;
    const hits = new Set(C.searchRaw(current.raw, $('mh-search').value));
    [...$('mh-raw').children].forEach((d, i) => d.classList.toggle('mh-hit', hits.has(i)));
    $('mh-search-count').textContent = $('mh-search').value ? hits.size + ' Treffer' : '';
    if (hits.size) { const first = $('mh-raw').children[[...hits][0]]; if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' }); }
  });
  const drop = $('mh-drop');
  drop.addEventListener('click', () => $('mh-file').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('mh-file').click(); } });
  $('mh-file').addEventListener('change', () => handleFile($('mh-file').files[0]));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => { handleFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { if (!drop.contains(e.target)) e.preventDefault(); });

  window.MailHeaderApp = { analyzeText, handleFile, clear: () => $('mh-clear').click(), get current() { return current; } };
})();
