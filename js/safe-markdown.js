// ============================================================
// support.sheet – safe-markdown.js
// Sicheres Rendern von Markdown aus nicht vertrauenswürdiger Herkunft (Guides aus IndexedDB oder einem gemeinsam genutzten Ordner,
// Importe, Vorschläge aus der Mitmachen-Seite, eingefügter Text aus dem Web). Global, ohne Build: window.SafeMarkdown.
//
// Zwei Schutzschichten (Muster: js/news/news-cve-report-core.js und news-cve-reports.js):
//  1. Eigene marked-Instanz (die globale Konfiguration anderer Seiten bleibt unberührt). Rohes HTML im Markdown wird als Text ausgegeben;
//     nur wenige feste, attributlose Tags und die beiden vom Editor erzeugten Container-Tags (siehe RAW_PASS) bleiben erhalten.
//  2. Die HTML-Ausgabe von marked wird in einem inerten <template> geparst und über eine Whitelist von Elementen und Attributen in
//     DOM-Knoten kopiert. Alles andere (Elemente, Ereignisattribute, style, unsichere Link- und Bildziele) entfällt. Selbst wenn ein künftiges
//     marked etwas anderes ausgäbe, entsteht dadurch kein Skript-, Bild- oder Event-Handler-Knoten.
//
// Die Markdown-Quelle wird nie verändert; gefiltert wird nur bei der Ausgabe.
//
// Erlaubt ist genau das, was marked (GFM) aus den vorhandenen Guides und der Editor-Werkzeugleiste erzeugt:
//   Überschriften, Absätze, Zeilenumbrüche, Trennlinien, Listen (auch Aufgabenlisten mit deaktiviertem Kontrollkästchen), Zitate, Tabellen
//   (mit align), Code und pre (Klasse nur language-… mit sicheren Zeichen), Hervorhebungen (strong, em, del), Links, Bilder, dazu aus rohem HTML
//   die attributlosen Tags br, kbd, mark, details (optional open), summary, den Ausrichtungs-Container <div style="text-align:left|center|right">
//   (Werkzeugleiste) und den Leerzeilen-Platzhalter <div class="gv-blank-line"> (guides-view.js / guides-editor.js).
// Alles andere wird als Text angezeigt.
//
// Links:  nur http:, https: und mailto:, dazu relative Verweise und Anker. Externe Links bekommen target="_blank" rel="noopener noreferrer".
// Bilder: lokale Assets über blob: des eigenen Ursprungs, data:image/(png|jpeg|gif|webp|bmp);base64, relative Pfade. Entfernte Bilder (http:/https:)
//         werden NICHT geladen (IP-Adresse und Referrer würden an Dritte gehen, Tracking-Pixel, Inhalt kann nach der Prüfung ausgetauscht
//         werden); der Bestand und die Werkzeugleiste erzeugen sie nicht. Sie erscheinen als Link mit dem Alt-Text.
// id:     nur an Überschriften, nur [A-Za-z0-9_-], immer mit festem Präfix "sm-" (Namen wie body oder __proto__ überlagern nichts).
// ============================================================
(function () {
  'use strict';

  const ID_PREFIX = 'sm-';
  const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
  const LANG_CLASS = /^language-[A-Za-z0-9_+#.-]{1,30}$/;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Schicht 1: rohes HTML im Markdown ────────────────────────
  // Ein Token aus dem Roh-HTML bleibt nur erhalten, wenn es GENAU einem dieser Muster entspricht (keine weiteren Attribute möglich).
  const RAW_PASS = [
    /^<br\s*\/?>$/i,
    /^<(kbd|mark|summary)>$/i,
    /^<details(\s+open)?>$/i,
    /^<\/(kbd|mark|summary|details|div)>$/i,
    /^<div style="text-align:\s*(left|center|right);?">$/i,
    /^<div class="gv-blank-line">$/,
  ];
  // Zerlegt Roh-HTML in Tags und Text; erlaubte Tags bleiben, alles andere (auch Tags mit Attributen) wird zu Text.
  function filterRawHtml(text) {
    let passed = 0;
    const out = String(text).split(/(<\/?[A-Za-z][^<>]*>)/).map((seg, i) => {
      if (i % 2 === 1 && RAW_PASS.some(re => re.test(seg))) { passed++; return seg; }
      return escapeHtml(seg);
    }).join('');
    return { html: out, passed };
  }

  const instanceCache = new WeakMap();
  function getInstance(lib) {
    if (instanceCache.has(lib)) return instanceCache.get(lib);
    const md = new lib.Marked({ gfm: true, breaks: false });
    md.use({
      renderer: {
        html(text, block) {
          const f = filterRawHtml(text);
          if (!block) return f.html;
          if (f.passed) return f.html;                       // Block mit erlaubten Tags: so lassen (kein <p>, sonst bricht der Aufbau von details/div)
          return '<p>' + f.html.trim() + '</p>\n';            // reiner Text: als Absatz
        },
      },
    });
    instanceCache.set(lib, md);
    return md;
  }

  // ── Link- und Bildziele ──────────────────────────────────────
  // Entfernt, was der URL-Parser ohnehin überliest (Tabulator/Zeilenumbruch überall, Steuerzeichen und Leerzeichen an den Rändern), damit
  // geprüft wird, was der Browser später tatsächlich auswertet.
  function probeOf(raw) {
    return String(raw == null ? '' : raw).replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
  }
  function schemeOf(probe) {
    const m = /^([A-Za-z][A-Za-z0-9+.\-]*):/.exec(probe);
    return m ? m[1].toLowerCase() : null;
  }
  function isSameOriginRelative(probe) {
    if (!probe) return false;
    if (/^[\/\\]{2}/.test(probe)) return false;          // protokollrelativ (//host, \\host, /\host)
    try {
      const u = new URL(probe, document.baseURI), b = new URL(document.baseURI);
      return u.protocol === b.protocol && u.host === b.host;
    } catch (e) { return false; }
  }
  // Liefert { href, external } oder null (dann bleibt nur der Linktext).
  function checkLink(raw) {
    const probe = probeOf(raw);
    const scheme = schemeOf(probe);
    if (scheme === 'http' || scheme === 'https') {
      try { new URL(probe); } catch (e) { return null; }
      return { href: probe, external: true };
    }
    if (scheme === 'mailto') return /^mailto:[^\s<>"]+$/i.test(probe) ? { href: probe, external: false } : null;
    if (scheme) return null;
    return isSameOriginRelative(probe) ? { href: probe, external: false } : null;
  }
  // Liefert { src } (wird geladen), { remote } (http/https: wird nicht geladen) oder null.
  function checkImage(raw) {
    const probe = probeOf(raw);
    const scheme = schemeOf(probe);
    if (scheme === 'blob') return probe.startsWith('blob:' + location.origin + '/') ? { src: probe } : null;
    if (scheme === 'data') return /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+\/=]+$/i.test(probe) ? { src: probe } : null;
    if (scheme === 'http' || scheme === 'https') { try { new URL(probe); } catch (e) { return null; } return { remote: probe }; }
    if (scheme) return null;
    return isSameOriginRelative(probe) ? { src: probe } : null;
  }

  // ── Schicht 2: Whitelist-Kopie ───────────────────────────────
  // Elemente, die unverändert (mit ihren erlaubten Attributen) übernommen werden.
  const ALLOWED_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BR', 'HR', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'EM', 'STRONG', 'DEL',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'KBD', 'MARK', 'DETAILS', 'SUMMARY']);
  // Elemente, die samt Inhalt entfallen (Skript, Rahmen, Formulare, Medien, Vorlagen …); alle übrigen unbekannten Elemente werden aufgelöst (Inhalt bleibt).
  const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'APPLET', 'LINK', 'META', 'SVG', 'MATH', 'FORM', 'BUTTON', 'TEXTAREA', 'SELECT',
    'OPTION', 'DATALIST', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'BASE', 'NOSCRIPT', 'TEMPLATE', 'CANVAS', 'FRAME', 'FRAMESET', 'NOFRAMES', 'PORTAL', 'DIALOG',
    'HEAD', 'TITLE', 'XMP', 'PLAINTEXT', 'PARAM', 'MARQUEE']);

  function copyChildren(src, dest) {
    src.childNodes.forEach(child => { const c = copyNode(child); if (c) dest.appendChild(c); });
  }
  function unwrap(node) {
    const frag = document.createDocumentFragment();
    copyChildren(node, frag);
    return frag;
  }
  function link(el, checked, title) {
    const a = document.createElement('a');
    a.setAttribute('href', checked.href);
    if (checked.external) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    if (title) a.setAttribute('title', title);
    return a;
  }

  function copyNode(node) {
    if (node.nodeType === 3) return document.createTextNode(node.data);
    if (node.nodeType !== 1) return null;                 // Kommentare, Verarbeitungsanweisungen entfallen
    const tag = node.tagName.toUpperCase();
    if (DROPPED_TAGS.has(tag)) return null;

    if (tag === 'INPUT') {                                // nur das Kontrollkästchen einer Aufgabenliste
      if ((node.getAttribute('type') || '').toLowerCase() !== 'checkbox' || !node.parentNode || node.parentNode.nodeName !== 'LI') return null;
      const box = document.createElement('input');
      box.setAttribute('type', 'checkbox');
      box.setAttribute('disabled', '');
      if (node.hasAttribute('checked')) box.setAttribute('checked', '');
      return box;
    }

    if (tag === 'A') {
      const checked = checkLink(node.getAttribute('href'));
      if (!checked) return unwrap(node);
      const a = link(node, checked, node.getAttribute('title'));
      copyChildren(node, a);
      return a;
    }

    if (tag === 'IMG') {
      const alt = node.getAttribute('alt') || '';
      const checked = checkImage(node.getAttribute('src'));
      if (checked && checked.src) {
        const img = document.createElement('img');
        img.setAttribute('src', checked.src);
        img.setAttribute('alt', alt);
        const title = node.getAttribute('title'); if (title) img.setAttribute('title', title);
        img.setAttribute('loading', 'lazy');
        img.setAttribute('referrerpolicy', 'no-referrer');
        return img;
      }
      if (checked && checked.remote) {                    // entferntes Bild: nicht laden, als Link anzeigen
        const a = link(node, { href: checked.remote, external: true }, 'Externes Bild (wird nicht geladen): ' + checked.remote);
        a.textContent = alt || checked.remote;
        return a;
      }
      return alt ? document.createTextNode(alt) : null;
    }

    if (tag === 'DIV') {                                  // nur Leerzeilen-Platzhalter und Ausrichtungs-Container
      if (node.getAttribute('class') === 'gv-blank-line' && !node.hasAttribute('style')) {
        const d = document.createElement('div'); d.className = 'gv-blank-line'; copyChildren(node, d); return d;
      }
      const m = /^\s*text-align:\s*(left|center|right)\s*;?\s*$/i.exec(node.getAttribute('style') || '');
      if (m && !node.hasAttribute('class')) {
        const d = document.createElement('div'); d.style.textAlign = m[1].toLowerCase(); copyChildren(node, d); return d;
      }
      return unwrap(node);
    }

    if (!ALLOWED_TAGS.has(tag)) return unwrap(node);

    const el = document.createElement(tag.toLowerCase());
    if (/^H[1-6]$/.test(tag) && ID_PATTERN.test(node.getAttribute('id') || '')) el.setAttribute('id', ID_PREFIX + node.getAttribute('id'));
    if ((tag === 'TH' || tag === 'TD') && /^(left|center|right)$/.test(node.getAttribute('align') || '')) el.setAttribute('align', node.getAttribute('align'));
    if (tag === 'OL' && /^\d{1,6}$/.test(node.getAttribute('start') || '')) el.setAttribute('start', node.getAttribute('start'));
    if (tag === 'CODE' && LANG_CLASS.test(node.getAttribute('class') || '')) el.setAttribute('class', node.getAttribute('class'));
    if (tag === 'DETAILS' && node.hasAttribute('open')) el.setAttribute('open', '');
    copyChildren(node, el);
    return el;
  }

  // HTML-Text (von marked oder von außen) -> bereinigter DocumentFragment. Das <template> ist inert: nichts darin wird geladen oder ausgeführt.
  function sanitizeHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html == null ? '' : html);
    const frag = document.createDocumentFragment();
    copyChildren(tpl.content, frag);
    return frag;
  }

  // ── Rendern ──────────────────────────────────────────────────
  function plainTextFragment(text) {
    const frag = document.createDocumentFragment();
    const pre = document.createElement('pre');
    pre.textContent = text;
    frag.appendChild(pre);
    return frag;
  }
  function highlightCode(frag) {
    const h = window.hljs;
    if (!h || typeof h.highlightElement !== 'function') return;
    frag.querySelectorAll('pre > code').forEach(code => {
      try { h.highlightElement(code); } catch (e) { /* Sprache nicht erkannt: Rohtext bleibt */ }
    });
  }

  // Markdown -> DocumentFragment. options.highlight: Code-Hervorhebung (hljs, falls geladen) NACH der Bereinigung auf den sicheren Knoten.
  // Eingaben, die kein Text sind, ergeben einen leeren Fragment; fällt marked aus, wird der Text als reiner Text ausgegeben.
  function render(markdown, options) {
    const src = typeof markdown === 'string' ? markdown : (typeof markdown === 'number' || typeof markdown === 'boolean' ? String(markdown) : '');
    if (!src) return document.createDocumentFragment();
    const lib = window.marked;
    if (!lib || typeof lib.Marked !== 'function') return plainTextFragment(src);
    let html;
    try { html = getInstance(lib).parse(src); } catch (e) { return plainTextFragment(src); }
    const frag = sanitizeHtml(html);
    if (options && options.highlight) highlightCode(frag);
    return frag;
  }
  function renderInto(target, markdown, options) {
    target.replaceChildren(render(markdown, options));
    return target;
  }

  // Für Stellen, die Links selbst aufbauen (Link-Liste im Overlay): geprüftes Ziel oder null.
  function safeLink(url) {
    const c = checkLink(url);
    return c ? { href: c.href, external: c.external } : null;
  }

  window.SafeMarkdown = { render, renderInto, sanitizeHtml, safeLink, escapeHtml };
})();
