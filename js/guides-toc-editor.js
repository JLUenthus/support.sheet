// ============================================================
// guide.sheet – guides-toc-editor.js (Inhaltsverzeichnis im Editor: Anzeigen, Springen, Anlegen)
// Erweitert den Editor von außen (wie js/guide-templates.js): Knopf und Panel entstehen per Skript, das Textfeld #ge-textarea wird nur über das DOM und Ereignisse bedient.
// js/guides-editor.js bleibt unverändert.
//   - Leser: ATX-Überschriften (# bis ####, bis zu drei Leerzeichen Einrückung) aus dem aktuellen Text im Textfeld (live, auch ungespeichert); Codeblöcke (``` und ~~~ nach der
//     Regel der Zaunlänge) und HTML-Kommentare werden übersprungen. Bekannte Grenze: Überschriften in Zitaten und Listen sowie Setext-Überschriften (Unterstreichung) erscheinen hier nicht.
//   - Sprung: wählt die Überschriftenzeile aus, rollt sie in die obere Hälfte und gibt dem Textfeld den Fokus; bei sichtbarer Vorschau wird dort die n-te Überschrift mit angezeigt.
//   - Anlegen: hängt eine Überschrift ans ENDE des Textes an (nie an der Cursorposition, nie über eine Auswahl): per document.execCommand('insertText'), damit Strg+Z den Anhang
//     wieder entfernt; danach löst der Browser das input-Ereignis aus, Entwurf, Zustandsanzeige und Vorschau laufen unverändert im Editor. Der vorhandene Text wird nie ersetzt oder gekürzt.
//   - Schreibt in keinen Speicher (außer dem Merken von Offen/Zu in guides-toc-core.js, localStorage['gs-toc-open']). Alle Texte nur über textContent.
// ============================================================
(function () {
  'use strict';

  const MAX_TITLE = 120;
  const LEVELS = [2, 3, 4];
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ── Leser (rein, ohne DOM) ──
  // Liefert [{ level, text, line, start }] (line nullbasiert, start = Zeichenposition des Zeilenanfangs)
  function parse(text, docTitle) {
    const lines = String(text == null ? '' : text).split('\n');
    const title = norm(docTitle);
    const out = [];
    let pos = 0, fence = null, comment = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      const start = pos; pos += lines[i].length + 1;
      if (comment) { if (line.indexOf('-->') >= 0) comment = false; continue; }
      if (fence) {
        const c = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
        if (c && c[1].charAt(0) === fence.ch && c[1].length >= fence.len) fence = null;
        continue;
      }
      const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (f && !(f[1].charAt(0) === '`' && f[2].indexOf('`') >= 0)) { fence = { ch: f[1].charAt(0), len: f[1].length }; continue; }
      const k = line.indexOf('<!--');
      if (/^ {0,3}<!--/.test(line)) { if (line.indexOf('-->', k + 4) < 0) comment = true; continue; }
      const m = /^ {0,3}(#{1,4})[ \t]+(.*?)[ \t]*$/.exec(line);
      if (!m) continue;
      let t = m[2].replace(/(^|[ \t]+)#+[ \t]*$/, '').trim();       // abschließende # entfernen ("## C#" bleibt: kein Leerzeichen davor)
      t = t.replace(/\s+/g, ' ');
      if (!t) continue;
      const level = m[1].length;
      if (norm(t) === 'inhaltsverzeichnis') continue;               // handgeschriebenes Verzeichnis bleibt unangetastet
      if (level === 1 && norm(t) === title) continue;               // Titelüberschrift des Guides
      out.push({ level, text: t, line: i, start });
    }
    return out;
  }

  // Liegt am Ende des Textes ein offener Codeblock? Dann wäre eine angefügte Überschrift Teil des Codes.
  function endsInOpenFence(content) {
    let open = null;
    String(content).split('\n').forEach((line) => {
      const m = /^\s*(`{3,}|~{3,})/.exec(line);
      if (!m) return;
      if (open === null) open = m[1].charAt(0);
      else if (m[1].charAt(0) === open) open = null;
    });
    return open !== null;
  }

  // Titel bereinigen (rein): Zeilenumbrüche (CR, LF, U+2028, U+2029) samt Leerraum zu einem Leerzeichen, führende # und Leerraum weg
  function cleanTitle(raw) {
    const LB = new RegExp('\\s*[' + String.fromCharCode(13, 10, 0x2028, 0x2029) + ']+\\s*', 'g');
    return String(raw == null ? '' : raw).replace(LB, ' ').replace(/\s+/g, ' ').trim().replace(/^[#\s]+/, '').trim();   // Leerraum zu einem Leerzeichen (Markdown zeigt es ohnehin so)
  }

  // Nummernvorschlag: Beginnen die Überschriften der Ebene mit einer Nummer ("11." oder "6.3"), die nächste Nummer; sonst leer.
  function suggest(entries, level) {
    const same = entries.filter((e) => e.level === level && /^\d+(?:\.\d+)*\.?\s/.test(e.text));
    if (!same.length) return '';
    const m = /^(\d+(?:\.\d+)*)(\.?)\s/.exec(same[same.length - 1].text);
    const parts = m[1].split('.');
    parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
    return parts.join('.') + m[2] + ' ';
  }

  // Der anzufügende Block: höchstens eine Leerzeile an der Nahtstelle, nach der Überschrift eine Leerzeile; leerer Text: nur die Überschrift
  function buildBlock(text, level, title) {
    const t = String(text == null ? '' : text);
    let prefix = '';
    if (t.length) {
      const n = (/\n*$/.exec(t) || [''])[0].length;                 // Zeilenumbrüche am Ende
      prefix = n >= 2 ? '' : '\n'.repeat(2 - n);
    }
    return prefix + '#'.repeat(level) + ' ' + title + '\n\n';
  }

  // ── DOM-Anbindung ──
  function init() {
    const ta = document.getElementById('ge-textarea');
    const wrap = document.getElementById('ge-editor-wrap');
    const row = document.querySelector('.ge-images-row');
    if (!ta || !wrap || !row || !window.GuidesTocCore) return;
    const titleInput = document.getElementById('ge-title');
    const preview = document.getElementById('ge-preview');
    const main = document.querySelector('.gs-main');

    const btn = el('button', 'gs-folder-btn gv-toc-btn', '📑 Inhaltsverzeichnis anzeigen');
    btn.type = 'button'; btn.id = 'ge-toc-btn'; btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'gv-toc-panel');
    row.appendChild(btn);

    let entries = [];
    let lastValue = null, lastTitle = null;
    let lockUntil = 0;
    let lastSuggestion = '';

    let panel = null;
    const layoutLater = () => requestAnimationFrame(() => { if (panel) panel.layout(); });
    panel = window.GuidesTocCore.create({
      mode: 'editor', button: btn,
      dock: () => ({ parent: wrap, before: wrap.firstChild }),
      emptyText: 'Noch keine Überschriften. Lege unten den ersten Punkt an.',
      onJump: jump,
      onOpen: () => { reparse(true); layoutLater(); },
    });

    // ── Formular "Neuen Punkt anlegen" ──
    const form = el('form', 'gv-toc-add'); form.id = 'gv-toc-add'; form.noValidate = true;
    const addHead = el('div', 'gv-toc-add-head', 'Neuen Punkt anlegen');
    const rowEl = el('div', 'gv-toc-add-row');
    const title = el('input', 'gv-toc-title'); title.type = 'text'; title.id = 'gv-toc-title'; title.placeholder = 'Titel der neuen Überschrift'; title.autocomplete = 'off'; title.spellcheck = false; title.setAttribute('aria-label', 'Titel der neuen Überschrift');
    const level = el('select', 'gv-toc-level'); level.id = 'gv-toc-level'; level.setAttribute('aria-label', 'Ebene');
    LEVELS.forEach((l) => { const o = el('option', null, 'H' + l); o.value = String(l); if (l === 2) o.selected = true; level.appendChild(o); });
    const submit = el('button', 'gv-toc-append', 'Am Ende anfügen'); submit.type = 'submit'; submit.id = 'gv-toc-append';
    const msg = el('div', 'gv-toc-msg'); msg.id = 'gv-toc-msg'; msg.hidden = true;
    rowEl.append(title, level);
    form.append(addHead, rowEl, submit, msg);
    panel.extra.appendChild(form);

    function message(text, type) {
      msg.hidden = !text;
      msg.className = 'gv-toc-msg' + (type ? ' gv-toc-msg--' + type : '');
      msg.setAttribute('role', type === 'error' ? 'alert' : 'status');
      msg.textContent = text || '';
    }

    function fillSuggestion() {
      const next = suggest(entries, Number(level.value));
      if (title.value === '' || title.value === lastSuggestion) { title.value = next; lastSuggestion = next; }
    }

    // Formular sperren, solange das Textfeld nicht bedienbar ist (deaktiviert, schreibgeschützt oder der Editor sperrt gerade)
    const taLocked = () => ta.disabled || ta.readOnly || !!ta.closest('[inert]');
    function syncLock() { const on = taLocked(); [title, level, submit].forEach((e) => { e.disabled = on; }); }
    new MutationObserver(syncLock).observe(ta, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
    new MutationObserver(syncLock).observe(wrap, { attributes: true, attributeFilter: ['inert'] });
    syncLock();

    // ── Lesen ──
    function reparse(force) {
      const v = ta.value, t = titleInput ? titleInput.value : '';
      if (!force && v === lastValue && t === lastTitle) return;
      lastValue = v; lastTitle = t;
      entries = parse(v, t);
      panel.setEntries(entries.map((e) => ({ text: e.text, level: e.level })));
      follow();
      fillSuggestion();
    }

    // Mitführen: Eintrag des Abschnitts, in dem der Cursor steht
    function follow() {
      const caret = ta.selectionStart || 0;
      let cur = -1;
      entries.forEach((e, i) => { if (e.start <= caret) cur = i; });
      panel.setCurrent(cur);
    }
    let fq = null;
    const followSoon = () => { clearTimeout(fq); fq = setTimeout(follow, 90); };
    let pq = null;
    const reparseSoon = () => { clearTimeout(pq); pq = setTimeout(() => reparse(false), 140); };

    ta.addEventListener('input', () => { reparseSoon(); followSoon(); });
    ['click', 'keyup', 'focus', 'select'].forEach((n) => ta.addEventListener(n, followSoon));
    if (titleInput) titleInput.addEventListener('input', reparseSoon);
    // Entwurf-Wiederherstellung, Vorlagen und Import setzen den Text ohne input-Ereignis: bei offenem Panel nachsehen
    setInterval(() => { if (panel.isOpen() && (ta.value !== lastValue || (titleInput && titleInput.value !== lastTitle))) reparse(false); }, 700);

    // ── Position einer Zeile im Textfeld (Spiegel-Element mit denselben Maßen) ──
    function lineTop(index) {
      const cs = getComputedStyle(ta);
      const m = document.createElement('div');
      const s = m.style;
      s.position = 'absolute'; s.visibility = 'hidden'; s.top = '0'; s.left = '-9999px'; s.height = 'auto';
      s.boxSizing = 'border-box'; s.width = ta.clientWidth + 'px';
      ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach((k) => { s[k] = cs[k]; });
      s.whiteSpace = 'pre-wrap'; s.overflowWrap = 'break-word'; s.wordBreak = cs.wordBreak; s.border = '0';
      m.textContent = ta.value.slice(0, index);
      const mark = document.createElement('span'); mark.textContent = '​';
      m.appendChild(mark);
      document.body.appendChild(m);
      const y = mark.offsetTop;
      m.remove();
      return y;
    }

    function previewHeading(i) {
      if (!preview || !preview.offsetParent) return null;
      const t = titleInput ? titleInput.value : '';
      const hs = [...preview.querySelectorAll('h1,h2,h3,h4')].filter((h) => {
        const x = h.textContent.replace(/\s+/g, ' ').trim();
        if (!x || norm(x) === 'inhaltsverzeichnis') return false;
        return !(h.tagName === 'H1' && norm(x) === norm(t));
      });
      return hs[i] || null;
    }

    // Das Textfeld wächst im Split-Modus mit der Vorschau (dann rollt .gs-main), im Modus "Nur Editor" rollt es selbst
    function scrollTo(i) {
      const e = entries[i];
      const visible = !!ta.offsetParent;
      const mr = main ? main.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      const mainH = main ? main.clientHeight : window.innerHeight;
      const want = Math.max(190, Math.round(mainH * 0.38));           // Zielhöhe der Zeile im Rollbereich: unter der festen Werkzeugleiste, in der oberen Hälfte
      if (visible) {
        const y = lineTop(e.start);
        const inner = ta.scrollHeight > ta.clientHeight + 1;
        if (inner) ta.scrollTop = Math.max(0, y - Math.round(ta.clientHeight * 0.3));
        const scrolled = inner ? ta.scrollTop : 0;
        const taScreen = ta.getBoundingClientRect().top + (parseFloat(getComputedStyle(ta).borderTopWidth) || 0) + y - scrolled;
        let L = mr.top + want;                                         // Zielhöhe der Zeile; sie bleibt in der oberen Hälfte (zwischen Werkzeugleiste und Mitte)
        const ph = previewHeading(i);
        if (ph && !inner) {                                            // die Überschrift der Vorschau mitsichtbar machen, solange die Zeile dafür in der oberen Hälfte bleiben kann
          const d = ph.getBoundingClientRect().top - taScreen;        // Abstand Vorschau-Überschrift zu Textzeile (bleibt beim Rollen gleich)
          const lo = Math.max(mr.top + 150, mr.top + 30 - d), hi = Math.min(mr.top + mainH * 0.5, mr.top + mainH - 60 - d);
          if (lo <= hi) L = Math.min(hi, Math.max(lo, L));
        }
        const delta = taScreen - L;
        if (main) main.scrollTop += delta; else window.scrollBy(0, delta);
      } else {
        const ph = previewHeading(i);
        if (ph) ph.scrollIntoView({ block: 'start' });
      }
    }

    function jump(index, ev) {
      const e = entries[index];
      if (!e) return;
      const keep = ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey);
      if (panel.isOverlay() && !keep) panel.close({ persist: false });
      const end = ta.value.indexOf('\n', e.start);
      try { ta.focus({ preventScroll: true }); } catch (x) { ta.focus(); }
      ta.setSelectionRange(e.start, end < 0 ? ta.value.length : end);
      scrollTo(index);
      panel.setCurrent(index);
    }

    // ── Anfügen ──
    function append() {
      if (Date.now() < lockUntil) return;                              // Doppelklick: genau ein Punkt
      if (taLocked()) { message('Das Textfeld ist gerade gesperrt.', 'error'); return; }
      const t = cleanTitle(title.value);
      const lv = Number(level.value);
      if (!t || t === lastSuggestion.trim()) { message('Bitte einen Titel eingeben.', 'error'); return; }   // leer oder nur der unveränderte Nummernvorschlag
      if (t.length > MAX_TITLE) { message('Der Titel ist zu lang (' + t.length + ' Zeichen, höchstens ' + MAX_TITLE + ').', 'error'); return; }
      if (!LEVELS.includes(lv)) { message('Ungültige Ebene.', 'error'); return; }
      const before = ta.value;
      if (endsInOpenFence(before)) { message('Der Text endet in einem offenen Codeblock. Eine angefügte Überschrift wäre Teil des Codes. Nichts wurde geändert, bitte den Codeblock schließen.', 'error'); return; }
      const block = buildBlock(before, lv, t);
      lockUntil = Date.now() + 500;
      let ok = false;
      try {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(before.length, before.length);          // immer am Ende, unabhängig von Cursor und Auswahl
        ok = document.execCommand('insertText', false, block);       // Strg+Z entfernt den Anhang wieder
      } catch (x) { ok = false; }
      if (!ok || ta.value !== before + block) {
        if (ta.value === before) {                                    // Weg über den Rückgängig-Speicher nicht verfügbar: nur am Ende ergänzen (Strg+Z geht dann nicht)
          ta.setRangeText(block, before.length, before.length, 'end');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (ta.value !== before + block) { message('Der Punkt konnte nicht angefügt werden. Der Text ist unverändert oder nur am Ende ergänzt, bitte prüfen.', 'error'); return; }
      }
      ta.setSelectionRange(ta.value.length, ta.value.length);
      reparse(true);
      lastSuggestion = ''; title.value = ''; fillSuggestion();
      message('Punkt am Ende des Textes angefügt. Strg+Z macht es rückgängig.', 'ok');
      // Textfeld ans Ende, neuer Eintrag hervorgehoben und in der Liste sichtbar, Fokus zurück ins Feld für den nächsten Punkt
      if (ta.offsetParent) { ta.scrollTop = ta.scrollHeight; if (entries.length) scrollTo(entries.length - 1); }
      panel.setCurrent(entries.length - 1);
      try { title.focus({ preventScroll: true }); } catch (x) { title.focus(); }
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); append(); });
    level.addEventListener('change', fillSuggestion);

    reparse(true);
  }

  window.GuidesTocEditor = { parse, endsInOpenFence, cleanTitle, suggest, buildBlock };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
