// ============================================================
// support.sheet – wizard-engine.js
// Reine Wizard-Logik: Laden, Validieren, Session-State,
// Command-Resolution, Analyzer-Auswertung. KEIN DOM-Zugriff.
// Erwartet js/variables.js VOR dieser Datei (SAFE_VALUE_REGEX).
// ============================================================
window.WizardEngine = (function() {

  // Fehler-Codes, konsistent mit dem {success, error}-Muster aus
  // guides-db.js – hier als kurzer Code statt langem Fließtext,
  // damit der Renderer selbst entscheiden kann wie er das anzeigt.
  // WIZARD_NOT_FOUND · STEP_NOT_FOUND · COMMAND_NOT_FOUND ·
  // INVALID_ANSWER · VALIDATION_FAILED

  // ── Laden ─────────────────────────────────────────────────
  async function loadWizards() {
    try {
      const idxRes = await fetch('./data/wizards/_index.json');
      if (!idxRes.ok) {
        return { success: false, error: `Index konnte nicht geladen werden (HTTP ${idxRes.status}).` };
      }
      const idx = await idxRes.json();
      const entries = Array.isArray(idx.wizards) ? idx.wizards : [];

      const wizards = [];
      for (const entry of entries) {
        if (!entry || !entry.file) {
          console.warn('[wizard-engine] Index-Eintrag ohne "file" übersprungen:', entry);
          continue;
        }
        try {
          const res = await fetch(entry.file);
          if (!res.ok) {
            console.warn('[wizard-engine] Wizard-Datei nicht ladbar, übersprungen:', entry.file, res.status);
            continue;
          }
          const def = await res.json();
          const validation = validateWizardDefinition(def);
          if (!validation.valid) {
            console.warn('[wizard-engine] Wizard "' + (def?.id || entry.id) + '" ist ungültig, übersprungen:', validation.errors);
            continue;
          }
          if (validation.warnings.length) {
            console.warn('[wizard-engine] Wizard "' + def.id + '" hat Warnungen:', validation.warnings);
          }
          wizards.push(def);
        } catch (err) {
          console.warn('[wizard-engine] Wizard-Datei konnte nicht geladen/geparst werden:', entry.file, err);
        }
      }
      return { success: true, wizards };
    } catch (err) {
      return { success: false, error: 'Wizards konnten nicht geladen werden: ' + (err?.message || err) };
    }
  }

  function getWizardById(wizards, id) {
    if (!Array.isArray(wizards)) return null;
    return wizards.find(w => w.id === id) || null;
  }

  // ── Validierung ───────────────────────────────────────────
  function validateWizardDefinition(def) {
    const errors = [];
    const warnings = [];

    if (!def || typeof def !== 'object') {
      return { valid: false, errors: [{ stepId: null, field: null, message: 'Definition ist kein Objekt.' }], warnings };
    }

    if (def.schemaVersion == null) errors.push({ stepId: null, field: 'schemaVersion', message: 'schemaVersion fehlt.' });
    if (!def.id)        errors.push({ stepId: null, field: 'id',        message: 'id fehlt.' });
    if (!def.title)     errors.push({ stepId: null, field: 'title',     message: 'title fehlt.' });
    if (!def.startStep) errors.push({ stepId: null, field: 'startStep', message: 'startStep fehlt.' });

    if (!Array.isArray(def.steps) || def.steps.length === 0) {
      errors.push({ stepId: null, field: 'steps', message: 'steps muss ein nicht-leeres Array sein.' });
      return { valid: false, errors, warnings };
    }

    // Eindeutige Step-IDs
    const idCounts = {};
    def.steps.forEach(s => {
      if (!s || !s.id) { errors.push({ stepId: null, field: 'id', message: 'Step ohne id gefunden.' }); return; }
      idCounts[s.id] = (idCounts[s.id] || 0) + 1;
    });
    Object.entries(idCounts).forEach(([id, count]) => {
      if (count > 1) errors.push({ stepId: id, field: 'id', message: `Step-ID "${id}" ist ${count}× vergeben.` });
    });

    const stepById = new Map(def.steps.filter(s => s && s.id).map(s => [s.id, s]));

    // startStep existiert
    if (def.startStep && !stepById.has(def.startStep)) {
      errors.push({ stepId: null, field: 'startStep', message: `startStep "${def.startStep}" existiert nicht in steps.` });
    }

    // next/options[].next/detect[].next/skipNext referenzieren existierende Steps,
    // und jeder Nicht-end-Step braucht mindestens einen Weiterweg.
    def.steps.forEach(step => {
      if (!step || !step.id) return;
      const targets = [];
      if (typeof step.next === 'string') targets.push(step.next);
      if (Array.isArray(step.options)) step.options.forEach(o => { if (o && typeof o.next === 'string') targets.push(o.next); });
      if (Array.isArray(step.detect))  step.detect.forEach(r  => { if (r && typeof r.next === 'string') targets.push(r.next); });
      if (typeof step.skipNext === 'string') targets.push(step.skipNext);

      targets.forEach(target => {
        if (!stepById.has(target)) {
          errors.push({ stepId: step.id, field: 'next', message: `Verweist auf unbekannten Step "${target}".` });
        }
      });

      if (step.type !== 'end' && targets.length === 0) {
        errors.push({ stepId: step.id, field: 'next', message: 'Step hat keinen Weiterweg (next/options/detect/skipNext fehlen alle).' });
      }
    });

    // Erreichbarkeit per BFS ab startStep – nur Warnung, kein Fehler
    const reachable = new Set();
    if (def.startStep && stepById.has(def.startStep)) {
      const queue = [def.startStep];
      while (queue.length) {
        const id = queue.shift();
        if (reachable.has(id)) continue;
        reachable.add(id);
        const step = stepById.get(id);
        if (!step) continue;
        const targets = [];
        if (typeof step.next === 'string') targets.push(step.next);
        if (Array.isArray(step.options)) step.options.forEach(o => { if (o && typeof o.next === 'string') targets.push(o.next); });
        if (Array.isArray(step.detect))  step.detect.forEach(r  => { if (r && typeof r.next === 'string') targets.push(r.next); });
        if (typeof step.skipNext === 'string') targets.push(step.skipNext);
        targets.forEach(t => { if (stepById.has(t) && !reachable.has(t)) queue.push(t); });
      }
    }
    def.steps.forEach(step => {
      if (step && step.id && !reachable.has(step.id)) {
        warnings.push({ stepId: step.id, message: 'Step ist über keinen Pfad vom startStep aus erreichbar.' });
      }
    });

    return { valid: errors.length === 0, errors, warnings };
  }

  // ── Session ───────────────────────────────────────────────
  function startSession(wizardDef) {
    return {
      wizardId: wizardDef.id,
      startedAt: new Date().toISOString(),
      currentStepId: wizardDef.startStep,
      history: [],
      context: {},
      answers: {},
      status: 'in-progress',
    };
  }

  function getCurrentStep(session, wizardDef) {
    if (!session || !wizardDef || !Array.isArray(wizardDef.steps)) return null;
    return wizardDef.steps.find(s => s.id === session.currentStepId) || null;
  }

  // value-Semantik je Step-Typ:
  //  - question mit options: der gewählte options[].value
  //  - question ohne options (freier Text): der eingegebene String
  //  - result: der gewählte options[].value
  //  - analyzer: das von evaluateAnalyzerStep() ermittelte firstMatchNext,
  //    oder step.skipNext falls der Upload übersprungen wurde
  //  - information/command/solution: wird ignoriert, es gibt nur step.next
  function submitAnswer(session, wizardDef, value) {
    const step = getCurrentStep(session, wizardDef);
    if (!step) {
      return { success: false, session, error: 'STEP_NOT_FOUND', message: 'Aktueller Step wurde nicht gefunden.' };
    }

    let nextStepId;

    if (step.type === 'question' && Array.isArray(step.options) && step.options.length > 0) {
      const matched = step.options.find(o => o.value === value);
      if (!matched) return { success: false, session, error: 'INVALID_ANSWER', message: `Ungültige Auswahl "${value}".` };
      nextStepId = matched.next;
    } else if (step.type === 'question') {
      let val = value;
      if (step.validate === 'safeValue') {
        const re = (typeof SAFE_VALUE_REGEX !== 'undefined') ? SAFE_VALUE_REGEX : /^[a-zA-Z0-9._@\-\\ ]+$/;
        const trimmed = String(val ?? '').trim();
        if (!trimmed) return { success: false, session, error: 'INVALID_ANSWER', message: 'Wert darf nicht leer sein.' };
        if (!re.test(trimmed)) return { success: false, session, error: 'INVALID_ANSWER', message: `Ungültige Zeichen in "${trimmed}".` };
        val = trimmed;
      }
      if (step.contextKey) session.context[step.contextKey] = val;
      value = val;
      nextStepId = step.next;
    } else if (step.type === 'result' && Array.isArray(step.options)) {
      const matched = step.options.find(o => o.value === value);
      if (!matched) return { success: false, session, error: 'INVALID_ANSWER', message: `Ungültige Auswahl "${value}".` };
      nextStepId = matched.next;
    } else if (step.type === 'analyzer') {
      // 'skip' ist das Signalwort vom Ueberspringen-Button im Renderer
      // (kein echter Ziel-Step) – faellt wie ein leerer Wert auf
      // step.skipNext zurueck.
      nextStepId = (value && value !== 'skip') ? value : step.skipNext;
    } else {
      // information / command / solution: keine Verzweigung
      nextStepId = step.next;
    }

    if (!nextStepId) {
      return { success: false, session, error: 'STEP_NOT_FOUND', message: 'Kein Ziel-Step ermittelt.' };
    }
    if (!wizardDef.steps.some(s => s.id === nextStepId)) {
      return { success: false, session, error: 'STEP_NOT_FOUND', message: `Ziel-Step "${nextStepId}" existiert nicht.` };
    }

    session.history.push(session.currentStepId);
    session.answers[step.id] = value;
    session.currentStepId = nextStepId;

    // Finding fuer result-Steps sammeln – die Sidebar (wizard-renderer.js
    // renderSidebar()) zeigt session.findings an, wenn vorhanden.
    if (step.type === 'result') {
      const selectedOption = Array.isArray(step.options) ? step.options.find(o => o.value === value) : null;
      if (selectedOption) {
        if (!session.findings) session.findings = [];
        const v = String(value).toLowerCase();
        const isError = ['locked', 'expired', 'fail', 'error', 'unreachable'].some(kw => v.includes(kw));
        session.findings.push({
          stepId:    step.id,
          stepTitle: step.title || step.id,
          result:    value,
          label:     selectedOption.label,
          severity:  isError ? 'error' : 'ok',
          timestamp: new Date().toISOString(),
        });
      }
    }

    const nowStep = getCurrentStep(session, wizardDef);
    session.status = (nowStep && nowStep.type === 'end') ? 'completed' : 'in-progress';

    return { success: true, session };
  }

  function goBack(session) {
    if (!session || !session.history.length) return session;
    session.currentStepId = session.history.pop();
    session.status = 'in-progress';
    return session;
  }

  function restart(wizardDef) {
    return startSession(wizardDef);
  }

  function isComplete(session, wizardDef) {
    const step = getCurrentStep(session, wizardDef);
    return !!step && step.type === 'end';
  }

  // ── Command-Resolution ────────────────────────────────────
  function resolveStepCommand(step, context, commandsIndex) {
    if (!step || !step.commandId) {
      return { success: false, error: 'COMMAND_NOT_FOUND', message: 'Step hat keine commandId.' };
    }
    const original = commandsIndex && typeof commandsIndex.get === 'function'
      ? commandsIndex.get(step.commandId)
      : null;
    if (!original) {
      return { success: false, error: 'COMMAND_NOT_FOUND', message: `Command "${step.commandId}" wurde nicht gefunden.` };
    }

    // Tiefe Kopie – das Original im Index bleibt für andere Steps/Seiten unangetastet.
    const cmd = JSON.parse(JSON.stringify(original));

    if (step.placeholders) {
      Object.entries(step.placeholders).forEach(([literalToken, contextKey]) => {
        const raw = context ? context[contextKey] : undefined;
        if (raw == null) return; // kein Wert im Context -> Platzhalter unverändert lassen
        // Literale Ersetzung per split/join statt Regex – vermeidet ungewollte
        // Teilwort-/Sonderzeichen-Treffer bei Platzhaltern wie "BENUTZERNAME".
        cmd.cmd = cmd.cmd.split(literalToken).join(String(raw));
      });
    }

    return { success: true, cmd };
  }

  // ── Analyzer-Steps ────────────────────────────────────────
  function evaluateAnalyzerStep(step, uploadedEvents) {
    const events = Array.isArray(uploadedEvents) ? uploadedEvents : [];
    const idSet = new Set(events.map(e => Number(e.Id)));
    const matched = [];
    let firstMatchNext = null;

    (step?.detect || []).forEach(rule => {
      const hit = Array.isArray(rule.eventIds) && rule.eventIds.some(id => idSet.has(Number(id)));
      if (hit) {
        matched.push({ rule, next: rule.next, label: rule.label });
        if (!firstMatchNext) firstMatchNext = rule.next;
      }
    });

    return { matched, firstMatchNext };
  }

  // ── Zusammenfassung ───────────────────────────────────────
  function getSummary(session, wizardDef) {
    const currentStep = getCurrentStep(session, wizardDef);
    const startedMs = new Date(session.startedAt).getTime();
    const duration = isNaN(startedMs) ? null : (Date.now() - startedMs);

    return {
      wizardTitle: wizardDef ? wizardDef.title : null,
      startedAt: session.startedAt,
      duration,
      stepsVisited: session.history.length,
      context: { ...session.context },
      answers: { ...session.answers },
      outcome: (currentStep && currentStep.type === 'end') ? (currentStep.outcome || null) : null,
    };
  }

  return {
    loadWizards, getWizardById, validateWizardDefinition,
    startSession, getCurrentStep, submitAnswer, goBack, restart, isComplete,
    resolveStepCommand, evaluateAnalyzerStep, getSummary,
  };
})();
