// ============================================================
// support.sheet – wizard-renderer.js
// DOM-Rendering für alle 7 Wizard-Step-Typen. Erwartet
// js/render.js VOLLSTÄNDIG vor dieser Datei geladen –
// createCommandCard()/getRisk()/copyWithVariables() etc.
// werden 1:1 wiederverwendet, kein eigenes Command-Rendering.
//
// Vertrag mit dem Aufrufer (wizard.html Glue-Code):
//   callbacks.onAnswer(value) MUSS synchron das Ergebnis von
//   WizardEngine.submitAnswer() zurückgeben ({success, error?,
//   message?}) – der Renderer zeigt Validierungsfehler bei
//   Text-Fragen sonst nicht inline an.
// ============================================================
window.WizardRenderer = (function() {

  let _containerEl = null;
  let _sidebarEl   = null;
  let _engine      = null;
  let _currentCallbacks = null; // von renderStep() gesetzt, für Sidebar/Error-Buttons

  function init(containerEl, sidebarEl, engine) {
    _containerEl = containerEl;
    _sidebarEl   = sidebarEl;
    _engine      = engine;
  }

  // ── Start-Screen ─────────────────────────────────────────
  function renderWizardList(wizards, onSelect) {
    if (_sidebarEl) _sidebarEl.replaceChildren();
    if (!_containerEl) return;
    _containerEl.replaceChildren();

    const grid = document.createElement('div');
    grid.className = 'wz-list-grid';

    (wizards || []).forEach(wizard => {
      const card = document.createElement('div');
      card.className = 'wz-list-card';
      card.style.setProperty('--wz-color', wizard.color || 'var(--accent)');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');

      const icon = document.createElement('div');
      icon.className = 'wz-list-icon';
      icon.textContent = wizard.icon || '🧭';

      const title = document.createElement('div');
      title.className = 'wz-list-title';
      title.textContent = wizard.title;

      const desc = document.createElement('div');
      desc.className = 'wz-list-desc';
      desc.textContent = wizard.description || '';

      card.appendChild(icon);
      card.appendChild(title);
      card.appendChild(desc);

      const open = () => onSelect(wizard);
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });

      grid.appendChild(card);
    });

    if (!wizards || !wizards.length) {
      const empty = document.createElement('div');
      empty.className = 'wz-list-empty';
      empty.textContent = 'Keine Wizards verfügbar.';
      grid.appendChild(empty);
    }

    _containerEl.appendChild(grid);
  }

  // ── Fortschritt ──────────────────────────────────────────
  // Schätzung statt fester Gesamtzahl, da der Graph verzweigt
  // (variable Pfadlänge je nach Antworten). Text zeigt bewusst
  // nur "Schritt X", keine "X von Y"-Angabe.
  function renderProgress(session, wizardDef) {
    const el = document.getElementById('wz-progress-bar');
    if (!el || !session || !wizardDef) return;

    const currentStep   = wizardDef.steps.find(s => s.id === session.currentStepId);
    const totalEstimate = wizardDef.steps.filter(s => s.type !== 'end').length;
    const current        = session.history.length + 1;
    const pct = (currentStep && currentStep.type === 'end')
      ? 100
      : (totalEstimate > 0 ? Math.min(100, Math.round((current / totalEstimate) * 100)) : 0);

    el.replaceChildren();

    const label = document.createElement('div');
    label.className = 'wz-progress-label';
    label.textContent = `Schritt ${current}`;

    const track = document.createElement('div');
    track.className = 'wz-progress-track';
    const fill = document.createElement('div');
    fill.className = 'wz-progress-fill';
    fill.style.width = pct + '%';
    track.appendChild(fill);

    el.appendChild(label);
    el.appendChild(track);
  }

  // ── Sidebar ──────────────────────────────────────────────
  function renderSidebar(session, wizardDef) {
    if (!_sidebarEl) return;
    _sidebarEl.replaceChildren();
    if (!session || !wizardDef) return;

    const title = document.createElement('div');
    title.className = 'wz-sidebar-title';
    title.textContent = wizardDef.title;
    _sidebarEl.appendChild(title);

    const contextKeys = Object.keys(session.context || {});
    if (contextKeys.length) {
      const section = document.createElement('div');
      section.className = 'wz-sidebar-section';
      const label = document.createElement('div');
      label.className = 'wz-sidebar-label';
      label.textContent = 'Kontext';
      section.appendChild(label);
      contextKeys.forEach(key => {
        const row = document.createElement('div');
        row.className = 'wz-sidebar-context-row';
        row.title = key;
        row.textContent = '👤 ' + session.context[key];
        section.appendChild(row);
      });
      _sidebarEl.appendChild(section);
    }

    // Findings – von WizardEngine.submitAnswer() für result-Steps befüllt.
    // Shape: {stepId, stepTitle, result, label, severity, timestamp} –
    // severity ist 'error'|'ok', kein boolesches "ok"-Feld.
    if (Array.isArray(session.findings) && session.findings.length) {
      const section = document.createElement('div');
      section.className = 'wz-sidebar-section';
      const label = document.createElement('div');
      label.className = 'wz-sidebar-label';
      label.textContent = 'Findings';
      section.appendChild(label);
      session.findings.forEach(f => {
        const item = document.createElement('div');
        const isError = f.severity === 'error';
        item.className = 'wz-finding-item' + (isError ? ' wz-finding-item--bad' : ' wz-finding-item--ok');
        item.textContent = (isError ? '✗ ' : '✓ ') + f.label + (f.result ? ' (' + f.result + ')' : '');
        section.appendChild(item);
      });
      _sidebarEl.appendChild(section);
    }

    if (_currentCallbacks && typeof _currentCallbacks.onAbort === 'function') {
      const abortBtn = document.createElement('button');
      abortBtn.type = 'button';
      abortBtn.className = 'wz-sidebar-abort-btn';
      abortBtn.textContent = '✕ Abbrechen';
      abortBtn.addEventListener('click', () => _currentCallbacks.onAbort());
      _sidebarEl.appendChild(abortBtn);
    }
  }

  // ── Nav-Bar (Zurück/Abbrechen) – unter jedem Step außer end ──
  function buildNavBar(session, callbacks) {
    const bar = document.createElement('div');
    bar.className = 'wz-nav-bar';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'wz-nav-back-btn';
    backBtn.textContent = '← Zurück';
    backBtn.disabled = !session.history.length;
    backBtn.addEventListener('click', () => callbacks.onBack());

    const abortBtn = document.createElement('button');
    abortBtn.type = 'button';
    abortBtn.className = 'wz-nav-abort-btn';
    abortBtn.textContent = '✕ Abbrechen';
    abortBtn.addEventListener('click', () => callbacks.onAbort());

    bar.appendChild(backBtn);
    bar.appendChild(abortBtn);
    return bar;
  }

  function buildStepTitle(step) {
    const title = document.createElement('h2');
    title.className = 'wz-step-title';
    title.textContent = step.title || '';
    return title;
  }

  function buildLinks(links) {
    const wrap = document.createElement('div');
    wrap.className = 'wz-links';
    links.forEach(link => {
      const a = document.createElement('a');
      a.className = 'wz-link';
      a.textContent = '📖 ' + link.text;
      if (link.guideRef) a.href = 'guides-view.html?id=' + encodeURIComponent(link.guideRef);
      else if (link.href) a.href = link.href;
      wrap.appendChild(a);
    });
    return wrap;
  }

  function buildErrorBox(message, code) {
    const box = document.createElement('div');
    box.className = 'wz-error-box';
    box.textContent = (code ? '[' + code + '] ' : '') + message;
    return box;
  }

  // ── renderError (intern, nicht exportiert) ───────────────
  function renderError(message, callbacks) {
    if (!_containerEl) return;
    _containerEl.replaceChildren();

    const box = buildErrorBox(message);
    _containerEl.appendChild(box);

    if (callbacks && typeof callbacks.onRestart === 'function') {
      const restartBtn = document.createElement('button');
      restartBtn.type = 'button';
      restartBtn.className = 'wz-option-btn';
      restartBtn.textContent = 'Neu starten';
      restartBtn.addEventListener('click', () => callbacks.onRestart());
      _containerEl.appendChild(restartBtn);
    }
  }

  // ── 1. question ──────────────────────────────────────────
  function renderQuestion(step, session, callbacks) {
    const frag = document.createDocumentFragment();
    frag.appendChild(buildStepTitle(step));

    if (step.inputType === 'select' && Array.isArray(step.options)) {
      const optWrap = document.createElement('div');
      optWrap.className = 'wz-question-options';
      step.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wz-option-btn';
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          optWrap.querySelectorAll('.wz-option-btn').forEach(b => b.classList.remove('wz-option-btn--active'));
          btn.classList.add('wz-option-btn--active');
          callbacks.onAnswer(opt.value);
        });
        optWrap.appendChild(btn);
      });
      frag.appendChild(optWrap);
    } else {
      const form = document.createElement('div');
      form.className = 'wz-question-text';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'wz-question-input';
      input.placeholder = step.placeholder || '';
      input.autocomplete = 'off';

      const errorEl = document.createElement('div');
      errorEl.className = 'wz-question-error';
      errorEl.hidden = true;

      const submit = () => {
        const res = callbacks.onAnswer(input.value);
        if (res && res.success === false) {
          errorEl.textContent = res.message || 'Ungültiger Wert.';
          errorEl.hidden = false;
          input.classList.add('wz-question-input--error');
        }
      };

      input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      input.addEventListener('input', () => {
        errorEl.hidden = true;
        input.classList.remove('wz-question-input--error');
      });

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'wz-option-btn wz-option-btn--primary';
      confirmBtn.textContent = 'Bestätigen';
      confirmBtn.addEventListener('click', submit);

      form.appendChild(input);
      form.appendChild(confirmBtn);
      frag.appendChild(form);
      frag.appendChild(errorEl);

      setTimeout(() => input.focus(), 30);
    }

    frag.appendChild(buildNavBar(session, callbacks));
    return frag;
  }

  // ── 2. command ───────────────────────────────────────────
  function renderCommand(step, session, commandsIndex, callbacks) {
    const frag = document.createDocumentFragment();
    frag.appendChild(buildStepTitle(step));

    if (step.description) {
      const info = document.createElement('p');
      info.className = 'wz-step-description';
      info.textContent = step.description;
      frag.appendChild(info);
    }

    const res = _engine.resolveStepCommand(step, session.context, commandsIndex);
    if (!res.success) {
      frag.appendChild(buildErrorBox(res.message || 'Command konnte nicht geladen werden.', res.error));
      frag.appendChild(buildNavBar(session, callbacks));
      return frag;
    }

    const template = document.getElementById('command-template');
    if (template) {
      const cardWrap = document.createElement('div');
      cardWrap.className = 'wz-command-card-wrap';
      cardWrap.appendChild(createCommandCard(template, res.cmd));
      frag.appendChild(cardWrap);
    }

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'wz-option-btn wz-option-btn--primary';
    nextBtn.textContent = 'Weiter – Command ausgeführt';
    nextBtn.addEventListener('click', () => callbacks.onAnswer('done'));
    frag.appendChild(nextBtn);

    frag.appendChild(buildNavBar(session, callbacks));
    return frag;
  }

  // ── 3. result ────────────────────────────────────────────
  function renderResult(step, session, callbacks) {
    const frag = document.createDocumentFragment();
    frag.appendChild(buildStepTitle(step));

    if (step.referenceStepId) {
      const hint = document.createElement('p');
      hint.className = 'wz-step-hint';
      hint.textContent = 'Bezieht sich auf den Befehl aus dem vorherigen Schritt.';
      frag.appendChild(hint);
    }

    const optWrap = document.createElement('div');
    optWrap.className = 'wz-question-options';
    (step.options || []).forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wz-option-btn';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        optWrap.querySelectorAll('.wz-option-btn').forEach(b => b.classList.remove('wz-option-btn--active'));
        btn.classList.add('wz-option-btn--active');
        callbacks.onAnswer(opt.value);
      });
      optWrap.appendChild(btn);
    });
    frag.appendChild(optWrap);

    frag.appendChild(buildNavBar(session, callbacks));
    return frag;
  }

  // ── 4. information ───────────────────────────────────────
  function renderInformation(step, session, callbacks) {
    const frag = document.createDocumentFragment();
    frag.appendChild(buildStepTitle(step));

    const infoBox = document.createElement('div');
    infoBox.className = 'wz-information-box';
    infoBox.textContent = step.body || '';
    frag.appendChild(infoBox);

    if (Array.isArray(step.links) && step.links.length) {
      frag.appendChild(buildLinks(step.links));
    }

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'wz-option-btn wz-option-btn--primary';
    nextBtn.textContent = 'Verstanden – Weiter';
    nextBtn.addEventListener('click', () => callbacks.onAnswer('next'));
    frag.appendChild(nextBtn);

    frag.appendChild(buildNavBar(session, callbacks));
    return frag;
  }

  // ── 5. solution ──────────────────────────────────────────
  function renderSolution(step, session, commandsIndex, callbacks) {
    const frag = document.createDocumentFragment();
    frag.appendChild(buildStepTitle(step));

    const solBox = document.createElement('div');
    solBox.className = 'wz-solution-box';
    solBox.textContent = step.body || '';
    frag.appendChild(solBox);

    const template = document.getElementById('command-template');
    (step.recommendations || []).forEach(rec => {
      const res = _engine.resolveStepCommand(rec, session.context, commandsIndex);
      if (!res.success) {
        frag.appendChild(buildErrorBox(res.message || 'Command konnte nicht geladen werden.', res.error));
        return;
      }
      if (template) {
        const cardWrap = document.createElement('div');
        cardWrap.className = 'wz-command-card-wrap';
        cardWrap.appendChild(createCommandCard(template, res.cmd));
        frag.appendChild(cardWrap);
      }
    });

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'wz-option-btn wz-option-btn--primary';
    nextBtn.textContent = 'Weiter';
    nextBtn.addEventListener('click', () => callbacks.onAnswer('done'));
    frag.appendChild(nextBtn);

    frag.appendChild(buildNavBar(session, callbacks));
    return frag;
  }

  // ── 6. analyzer ──────────────────────────────────────────
  function renderAnalyzer(step, session, callbacks) {
    const frag = document.createDocumentFragment();
    frag.appendChild(buildStepTitle(step));

    if (step.description) {
      const info = document.createElement('p');
      info.className = 'wz-step-description';
      info.textContent = step.description;
      frag.appendChild(info);
    }

    const zone = document.createElement('div');
    zone.className = 'wz-analyzer-upload';
    zone.tabIndex = 0;

    const icon = document.createElement('div');
    icon.className = 'wz-analyzer-upload-icon';
    icon.textContent = '📂';
    const text = document.createElement('div');
    text.className = 'wz-analyzer-upload-text';
    text.textContent = 'Datei hier ablegen oder klicken';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = step.accept || '.json';
    input.hidden = true;

    zone.appendChild(icon);
    zone.appendChild(text);
    zone.appendChild(input);
    frag.appendChild(zone);

    const errorEl = document.createElement('div');
    errorEl.className = 'wz-question-error';
    errorEl.hidden = true;
    frag.appendChild(errorEl);

    function handleFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = JSON.parse(e.target.result);
          const events = data.Events || data.events || [];
          errorEl.hidden = true;
          zone.classList.add('wz-analyzer-upload--done');
          text.textContent = '✅ ' + file.name;
          callbacks.onAnalyzerUpload(events);
        } catch (err) {
          errorEl.textContent = 'Datei konnte nicht gelesen werden: ' + (err?.message || err);
          errorEl.hidden = false;
        }
      };
      reader.readAsText(file, 'UTF-8');
    }

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'wz-option-btn';
    skipBtn.textContent = 'Überspringen';
    skipBtn.addEventListener('click', () => callbacks.onAnswer('skip'));
    frag.appendChild(skipBtn);

    frag.appendChild(buildNavBar(session, callbacks));
    return frag;
  }

  // ── 7. end ───────────────────────────────────────────────
  const END_ICONS = {
    success:    { icon: '✅', cls: 'wz-end-icon--success' },
    unresolved: { icon: '⚠️', cls: 'wz-end-icon--unresolved' },
    escalate:   { icon: '🔄', cls: 'wz-end-icon--escalate' },
  };

  function buildTicketText(summary) {
    return 'Problem: ' + (summary.wizardTitle || '') + '\n' +
           'Benutzer: ' + (summary.context?.username || '–') + '\n' +
           'Diagnose: Schritt ' + summary.stepsVisited + ' besucht\n' +
           'Ergebnis: ' + (summary.outcome || '–');
  }

  // UTF-8-sicheres Base64 (btoa allein kann keine Umlaute etc.)
  function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function openTicketAssistant(summary) {
    const text = buildTicketText(summary);
    window.open('ticketassistent.html?note=' + encodeURIComponent(toBase64(text)), '_blank');
  }

  // getSummary() liefert wizardTitle/context/answers/outcome – guides-editor.js
  // erwartet dagegen title/category/tags/content (das tatsächliche Guide-
  // Datenmodell). Hier übersetzen statt die Summary 1:1 durchzureichen.
  // category bewusst weggelassen: die Wizard-category ("windows", aus dem
  // Commands-Tag-System) hat keine verlässliche Entsprechung in den
  // GuidesDB-Kategorienamen ("Windows Client" etc.) – ein Fehlmatch wäre
  // stiller als gar keine Vorauswahl.
  function buildGuidePrefill(summary, wizardDef) {
    const contextLines = Object.entries(summary.context || {})
      .map(([k, v]) => `- **${k}:** ${v}`).join('\n');
    const answerLines = Object.entries(summary.answers || {})
      .map(([k, v]) => `- ${k}: ${v}`).join('\n');

    const content =
      `# ${summary.wizardTitle || 'Wizard-Ergebnis'}\n\n` +
      `**Ergebnis:** ${summary.outcome || '–'}\n\n` +
      (contextLines ? `## Kontext\n${contextLines}\n\n` : '') +
      (answerLines  ? `## Verlauf\n${answerLines}\n`      : '');

    return {
      title:   (summary.wizardTitle || 'Wizard-Ergebnis') + (summary.outcome ? ' – ' + summary.outcome : ''),
      tags:    Array.isArray(wizardDef?.tags) ? wizardDef.tags : [],
      content,
    };
  }

  function openGuideCreatePrefill(summary, wizardDef) {
    const prefill = buildGuidePrefill(summary, wizardDef);
    // encodeURIComponent() ist Pflicht: Base64 kann "+" enthalten, das
    // URLSearchParams sonst als Leerzeichen dekodiert (kaputtes atob()).
    window.open('guides-create.html?prefill=' + encodeURIComponent(toBase64(JSON.stringify(prefill))), '_blank');
  }

  function renderEnd(step, session, wizardDef, callbacks) {
    const frag = document.createDocumentFragment();
    const cfg = END_ICONS[step.outcome] || { icon: 'ℹ️', cls: 'wz-end-icon--info' };

    const iconEl = document.createElement('div');
    iconEl.className = 'wz-end-icon ' + cfg.cls;
    iconEl.textContent = cfg.icon;
    frag.appendChild(iconEl);

    frag.appendChild(buildStepTitle(step));

    const body = document.createElement('p');
    body.className = 'wz-end-body';
    body.textContent = step.body || '';
    frag.appendChild(body);

    if (Array.isArray(step.links) && step.links.length) {
      frag.appendChild(buildLinks(step.links));
    }

    const actions = document.createElement('div');
    actions.className = 'wz-end-actions';

    const restartBtn = document.createElement('button');
    restartBtn.type = 'button';
    restartBtn.className = 'wz-option-btn';
    restartBtn.textContent = '🔄 Neu starten';
    restartBtn.addEventListener('click', () => callbacks.onRestart());
    actions.appendChild(restartBtn);

    const summary = _engine.getSummary(session, wizardDef);

    const ticketBtn = document.createElement('button');
    ticketBtn.type = 'button';
    ticketBtn.className = 'wz-option-btn';
    ticketBtn.textContent = '📋 Ticket erstellen';
    ticketBtn.addEventListener('click', () => openTicketAssistant(summary));
    actions.appendChild(ticketBtn);

    if (summary.context && Object.keys(summary.context).length) {
      const guideBtn = document.createElement('button');
      guideBtn.type = 'button';
      guideBtn.className = 'wz-option-btn';
      guideBtn.textContent = '📖 Als Guide speichern';
      guideBtn.addEventListener('click', () => openGuideCreatePrefill(summary, wizardDef));
      actions.appendChild(guideBtn);
    }

    frag.appendChild(actions);
    return frag;
  }

  // ── Haupt-Dispatch ───────────────────────────────────────
  function renderStep(step, session, wizardDef, commandsIndex, callbacks) {
    _currentCallbacks = callbacks;
    if (!_containerEl) return;

    renderSidebar(session, wizardDef);
    renderProgress(session, wizardDef);

    if (!step) { renderError('Step nicht gefunden.', callbacks); return; }

    let frag;
    switch (step.type) {
      case 'question':    frag = renderQuestion(step, session, callbacks); break;
      case 'command':     frag = renderCommand(step, session, commandsIndex, callbacks); break;
      case 'result':       frag = renderResult(step, session, callbacks); break;
      case 'information': frag = renderInformation(step, session, callbacks); break;
      case 'solution':     frag = renderSolution(step, session, commandsIndex, callbacks); break;
      case 'analyzer':     frag = renderAnalyzer(step, session, callbacks); break;
      case 'end':          frag = renderEnd(step, session, wizardDef, callbacks); break;
      default:
        renderError('Unbekannter Step-Typ: "' + step.type + '"', callbacks);
        return;
    }

    _containerEl.replaceChildren(frag);
  }

  return { init, renderWizardList, renderStep, renderProgress, renderSidebar };
})();
