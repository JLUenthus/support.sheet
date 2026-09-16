// ============================================================
// News Curator – Tag-Input-Komponente (Schritt 4)
// ============================================================
// Recherche vorab (siehe Auftrag Schritt 4): js/guides-editor.js ist eng an
// modul-lokale Variablen und feste Element-IDs gekoppelt, nicht direkt
// wiederverwendbar. Statt sie umzubauen, bekommt News Curator eine eigene,
// unabhängige Komponente - bewusste, akzeptierte Doppelung zum Guide-Tag-
// Input für dieses eine Feature (keine versehentliche Abweichung vom
// "eine Quelle der Wahrheit"-Prinzip). EINE Funktion für beide Felder
// (Interessen, Ausschluss-Keywords), keine zwei separaten Implementierungen.
(function () {
  // config:
  //   boxId          - Container mit den Chips + dem Text-Input
  //   inputId        - das Text-Input-Element selbst
  //   suggestionsId  - Container für die Vorschlags-Pills (optional)
  //   getValues()    - liest den aktuellen string[]-Wert aus dem Datenmodell
  //   setValues(arr) - persistiert den geänderten string[]-Wert
  //   suggestions    - string[] fester/bekannter Vorschlagswerte (optional)
  function initTagField(config) {
    const box = document.getElementById(config.boxId);
    const input = document.getElementById(config.inputId);
    const suggestEl = config.suggestionsId ? document.getElementById(config.suggestionsId) : null;
    if (!box || !input) return null;

    function render() {
      const values = config.getValues();
      box.querySelectorAll('.news-tag-chip').forEach(c => c.remove());
      values.forEach(v => {
        const chip = document.createElement('span');
        chip.className = 'news-tag-chip';
        const text = document.createElement('span');
        text.textContent = v;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'news-tag-chip-remove';
        removeBtn.textContent = '×';
        removeBtn.setAttribute('aria-label', v + ' entfernen');
        removeBtn.addEventListener('click', () => removeValue(v));
        chip.appendChild(text);
        chip.appendChild(removeBtn);
        box.insertBefore(chip, input);
      });

      if (suggestEl) {
        suggestEl.replaceChildren();
        (config.suggestions || []).forEach(s => {
          const isOn = values.some(v => v.toLowerCase() === s.toLowerCase());
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'news-tag-suggestion' + (isOn ? ' news-tag-suggestion--on' : '');
          pill.textContent = s;
          pill.addEventListener('click', () => toggleSuggestion(s));
          suggestEl.appendChild(pill);
        });
      }
    }

    function addValue(raw) {
      const v = raw.trim();
      if (!v) return;
      const values = config.getValues();
      if (!values.some(x => x.toLowerCase() === v.toLowerCase())) {
        config.setValues([...values, v]);
      }
      render();
    }

    function removeValue(v) {
      config.setValues(config.getValues().filter(x => x !== v));
      render();
    }

    function toggleSuggestion(s) {
      const values = config.getValues();
      if (values.some(v => v.toLowerCase() === s.toLowerCase())) removeValue(s);
      else addValue(s);
    }

    // Commit per Enter, Komma oder Klick woanders (Blur) - kein separater
    // "Hinzufügen"-Button, siehe Auftragsbeschreibung.
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addValue(input.value.replace(/,$/, ''));
        input.value = '';
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim()) {
        addValue(input.value);
        input.value = '';
      }
    });

    render();
    return { render };
  }

  window.NewsTags = { initTagField };
})();
