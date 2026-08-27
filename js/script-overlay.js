// ============================================================
// support.sheet – Script Overlay
// Zeigt den vollstaendigen Inhalt eines PS-Scripts (aus
// data/script-guides.json + powershell/*.ps1) inline auf der
// aufrufenden Seite an, ohne Seitenwechsel.
//
// Bewusst eine eigenstaendige Kopie des Verhaltens von
// js/guide-overlay.js (Backdrop/Panel/Escape/Fokus/Scroll-Lock),
// keine Erweiterung von GuideOverlay selbst - zwei getrennte
// Overlays fuer zwei unterschiedliche Inhaltstypen (Markdown-
// Guide vs. rohes Skript). Nutzt dieselben .guide-overlay-*-CSS-
// Klassen aus css/main.css, kein neues Grundgeruest-CSS.
// ============================================================

window.ScriptOverlay = (function() {

  const DEFAULT_EXECUTION_POLICY = 'RemoteSigned';

  let _entries = null;      // Array aus data/script-guides.json, einmalig geladen
  let _loadError = null;    // gesetzt, wenn das Laden der Liste selbst fehlschlug
  let _loadPromise = null;

  // data/script-guides.json einmalig laden/cachen, nicht bei jedem Oeffnen neu fetchen.
  function ensureEntriesLoaded() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = fetch('./data/script-guides.json')
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        _entries = Array.isArray(data.scripts) ? data.scripts : [];
        _loadError = null;
      })
      .catch(err => {
        _entries = [];
        _loadError = err;
      });
    return _loadPromise;
  }

  function findEntry(scriptId) {
    return (_entries || []).find(e => e.id === scriptId) || null;
  }

  function fileNameFromPath(path) {
    return (path || '').split('/').pop() || path;
  }

  function els() {
    return {
      overlay:  document.getElementById('script-overlay'),
      title:    document.getElementById('script-overlay-title'),
      close:    document.getElementById('script-overlay-close'),
      dl:       document.getElementById('script-overlay-download'),
      content:  document.getElementById('script-overlay-content'),
    };
  }

  // Baut den "Voraussetzungen"-Block nur, wenn es tatsaechlich etwas
  // Nennenswertes zu zeigen gibt - kein leerer Titel ohne Inhalt fuer
  // Skripte ohne besondere Voraussetzungen.
  function buildPrerequisitesBlock(prereq) {
    if (!prereq) return null;
    const rows = [];
    if (prereq.runAsAdmin === true) {
      rows.push(['Als Administrator ausführen', 'Ja']);
    }
    if (Array.isArray(prereq.modules) && prereq.modules.length) {
      rows.push(['Benötigte Module', prereq.modules.join(', ')]);
    }
    if (prereq.executionPolicy && prereq.executionPolicy !== DEFAULT_EXECUTION_POLICY) {
      rows.push(['Execution Policy', prereq.executionPolicy]);
    }
    const notes = Array.isArray(prereq.notes) ? prereq.notes.filter(Boolean) : [];
    if (!rows.length && !notes.length) return null;

    const wrap = document.createElement('div');
    wrap.className = 'script-overlay-prereqs';

    const heading = document.createElement('h3');
    heading.textContent = 'Voraussetzungen';
    wrap.appendChild(heading);

    if (rows.length) {
      const dl = document.createElement('dl');
      rows.forEach(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        dl.append(dt, dd);
      });
      wrap.appendChild(dl);
    }

    if (notes.length) {
      const ul = document.createElement('ul');
      notes.forEach(note => {
        const li = document.createElement('li');
        li.textContent = note;
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    }

    return wrap;
  }

  // Skriptinhalt ist Text aus einer Datei, kein vertrauenswuerdiges HTML -
  // ausschliesslich ueber textContent/createElement einfuegen, niemals
  // ueber innerHTML roh einsetzen. hljs.highlightElement() faerbt danach
  // nur noch den bereits sicher eingefuegten Textknoten ein (liest selbst
  // erneut .textContent und escaped intern) - ersetzt nicht die sichere
  // Einfuege-Methode, kommt immer erst DANACH zum Einsatz.
  function buildScriptBlock(scriptText) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = scriptText;
    // "language-powershell"-Klasse erzwingt die Sprache bei
    // hljs.highlightElement() (kein Auto-Detect noetig, alle Skripte sind
    // bekanntermassen PowerShell - siehe Auftrag Schritt 3 Teil B).
    code.className = 'language-powershell';
    pre.appendChild(code);
    if (window.hljs) {
      try { hljs.highlightElement(code); } catch { /* Highlighting optional, Rohtext bleibt sichtbar */ }
    }
    return pre;
  }

  // SHA-256 ueber das rohe ArrayBuffer (nicht ueber den bereits dekodierten
  // Text) - muss exakt dem entsprechen, was Get-FileHash/certutil auf die
  // heruntergeladene Datei anwenden wuerden. Kleingeschriebener Hex-String.
  async function computeSha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Selbststaendiger Kopieren-Helper (kein toast.js-Dependency - ist nicht
  // auf allen drei Host-Seiten eingebunden), Verhalten/Optik an den
  // bestehenden Kopieren-Button in js/guides-view.js angelehnt.
  function copyToClipboard(text, btn) {
    const done = (ok) => {
      if (!btn) return;
      btn.textContent = ok ? '✓ Kopiert' : '✗ Fehler';
      btn.classList.toggle('copied', ok);
      setTimeout(() => { btn.textContent = '📋 Kopieren'; btn.classList.remove('copied'); }, 1500);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => done(true)).catch(() => execFallbackCopy(text, done));
    } else {
      execFallbackCopy(text, done);
    }
  }

  function execFallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { done(document.execCommand('copy')); }
    catch { done(false); }
    document.body.removeChild(ta);
  }

  // Baut den SHA-256-Block mit Platzhalter - der eigentliche Hash wird
  // asynchron nachgetragen (siehe renderScript()), da crypto.subtle.digest()
  // ein Promise liefert, aber schnell genug ist, um nicht separat "geladen"
  // werden zu muessen wie der Skriptinhalt selbst.
  function buildHashBlock() {
    const wrap = document.createElement('div');
    wrap.className = 'script-overlay-hash';

    const heading = document.createElement('h3');
    heading.textContent = 'SHA-256';
    wrap.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'script-overlay-hash-row';

    const valueEl = document.createElement('code');
    valueEl.className = 'script-overlay-hash-value';
    valueEl.textContent = 'Wird berechnet …';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'script-overlay-hash-copy';
    copyBtn.textContent = '📋 Kopieren';
    copyBtn.disabled = true;
    copyBtn.addEventListener('click', () => copyToClipboard(valueEl.textContent, copyBtn));

    row.append(valueEl, copyBtn);
    wrap.appendChild(row);
    return { wrap, valueEl, copyBtn };
  }

  function buildErrorBlock(message) {
    const box = document.createElement('div');
    box.className = 'script-overlay-error';
    box.textContent = message;
    return box;
  }

  function showOverlay(title) {
    const { overlay, title: titleEl, close, dl, content } = els();
    if (!overlay) return;
    titleEl.textContent = title || 'Skript';
    dl.hidden = true;
    dl.removeAttribute('href');
    content.replaceChildren();
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    close?.focus();
  }

  function renderLoading(title) {
    showOverlay(title);
    const { content } = els();
    const loading = document.createElement('div');
    loading.className = 'script-overlay-loading';
    loading.textContent = 'Skript wird geladen …';
    content.appendChild(loading);
  }

  function renderError(title, message) {
    showOverlay(title);
    const { content } = els();
    content.appendChild(buildErrorBlock(message));
  }

  function renderScript(entry, scriptText, buffer) {
    const { title: titleEl, dl, content } = els();
    titleEl.textContent = fileNameFromPath(entry.path);
    dl.href = entry.path;
    dl.hidden = false;
    content.replaceChildren();

    const prereqBlock = buildPrerequisitesBlock(entry.prerequisites);
    if (prereqBlock) content.appendChild(prereqBlock);

    content.appendChild(buildScriptBlock(scriptText));

    const hash = buildHashBlock();
    content.appendChild(hash.wrap);
    // Pro Overlay-Oeffnung einmal berechnet, kein Caching ueber mehrere
    // Aufrufe hinweg. content.contains(...)-Guard verhindert, dass eine
    // veraltete Berechnung noch das inzwischen fuer ein anderes Skript
    // neu aufgebaute Overlay ueberschreibt (Nutzer klickt schnell
    // hintereinander zwei verschiedene Guide-Buttons).
    computeSha256Hex(buffer).then(hex => {
      if (!content.contains(hash.wrap)) return;
      hash.valueEl.textContent = hex;
      hash.copyBtn.disabled = false;
    }).catch(() => {
      if (!content.contains(hash.wrap)) return;
      hash.valueEl.textContent = 'Hash konnte nicht berechnet werden.';
    });
  }

  async function open(scriptId) {
    renderLoading('Wird geladen …');
    await ensureEntriesLoaded();

    if (_loadError) {
      renderError('Fehler', 'Die Skript-Liste (data/script-guides.json) konnte nicht geladen werden: ' + (_loadError.message || _loadError));
      return;
    }

    const entry = findEntry(scriptId);
    if (!entry) {
      renderError('Fehler', 'Für dieses Skript ("' + scriptId + '") wurde kein Guide-Eintrag gefunden.');
      return;
    }

    renderLoading(fileNameFromPath(entry.path));
    try {
      // Cache-Busting-Query-Parameter: der gemeinsame Service Worker
      // (sw.js) precached alle powershell/*.ps1-Dateien und beantwortet
      // GET-Requests dafuer per "Cache First" direkt aus der Cache
      // Storage API (caches.match()) - unabhaengig von {cache:'no-store'}
      // dieses fetch()-Aufrufs, das den SW-Intercept selbst nicht
      // umgeht (siehe Bericht, Abschnitt "Caching-Vorpruefung"). Ein pro
      // Aufruf eindeutiger Query-Parameter matched keinen precachten
      // Eintrag (die dort ohne Query-String abgelegt sind), erzwingt
      // dadurch einen echten Cache-Miss im SW-Handler und damit einen
      // frischen Netzwerk-Request. {cache:'no-store'} zusaetzlich als
      // zweite Absicherung fuer den Fall, dass kein SW aktiv ist.
      const freshUrl = './' + entry.path + '?_fresh=' + Date.now();
      const res = await fetch(freshUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buffer = await res.arrayBuffer();
      const text = new TextDecoder('utf-8').decode(buffer);
      renderScript(entry, text, buffer);
    } catch (err) {
      renderError(fileNameFromPath(entry.path), 'Skriptinhalt konnte nicht geladen werden: ' + (err.message || err));
    }
  }

  function close() {
    const { overlay } = els();
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = '';
  }

  function init() {
    const { overlay, close: closeBtn } = els();
    if (!overlay) return;
    const backdrop = overlay.querySelector('.guide-overlay-backdrop');

    closeBtn?.addEventListener('click', close);
    backdrop?.addEventListener('click', close);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });

    // Delegierter Klick-Handler fuer alle "Guide"-Buttons auf der Seite -
    // scripts.html muss dafuer keinen eigenen Listener registrieren.
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-script-guide]');
      if (!btn) return;
      e.preventDefault();
      open(btn.dataset.scriptGuide);
    });

    ensureEntriesLoaded();
  }

  return { open, close, init };

})();

document.addEventListener('DOMContentLoaded', () => {
  ScriptOverlay.init();
});
