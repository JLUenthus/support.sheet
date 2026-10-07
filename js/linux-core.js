// ============================================================
// support.sheet – Linux-Befehlsseite: reine Logik
// ============================================================
// Kein DOM- und kein localStorage-Zugriff (Node-testbar, siehe module.exports).
// Datenmodell (data/linux-commands.json):
//   distros:    [{ id, label, tag }]   Distributionen, beliebig erweiterbar
//   categories: [name, ...]            Reihenfolge der Abschnitte
//   commands:   [{ id, category, title, desc, tags, cmd, note?, notes? }]
//     cmd   = String (gilt für alle Distributionen)
//             oder Objekt { <distro-id>: String } (Varianten)
//     note  = allgemeiner Hinweis, notes = { <distro-id>: Hinweis }
// Neue Distributionen (rhel, suse, ...) brauchen nur einen Eintrag unter
// "distros" und Varianten in den Karten, keinen Eingriff in Renderer oder Logik.
(function () {
  const SUDO_TOKEN = '{sudo}';
  const ID_PREFIX = 'linux-';
  const DISTRO_ID = /^[a-z][a-z0-9_-]*$/;

  // Ersetzt exakt die Zeichenfolge "{sudo}" durch "sudo " bzw. nichts.
  // Andere geschweifte Klammern (z. B. "{}" in find ... {} +) bleiben unberührt.
  function resolveSudo(text, withSudo) {
    return String(text).split(SUDO_TOKEN).join(withSudo ? 'sudo ' : '');
  }

  function hasSudo(card) {
    return variantsOf(card).some(v => v.cmd.includes(SUDO_TOKEN));
  }

  function isString(v) { return typeof v === 'string' && v.trim() !== ''; }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  // Prüft und bereinigt die Datei. Wirft bei strukturellen Fehlern (dann zeigt
  // die Seite eine Fehlermeldung statt einer leeren Seite). Unbrauchbare
  // einzelne Karten werden übersprungen und als Warnung gemeldet.
  function normalizeData(raw) {
    if (!isPlainObject(raw)) throw new Error('Die Datei hat kein gültiges JSON-Objekt als Wurzel.');
    if (!Array.isArray(raw.distros) || !raw.distros.length) throw new Error('"distros" fehlt oder ist leer.');
    if (!Array.isArray(raw.categories)) throw new Error('"categories" fehlt oder ist kein Array.');
    if (!Array.isArray(raw.commands)) throw new Error('"commands" fehlt oder ist kein Array.');

    const warnings = [];
    const distros = [];
    const distroIds = new Set();
    raw.distros.forEach((d, i) => {
      if (!isPlainObject(d) || !DISTRO_ID.test(String(d.id || '')) || !isString(d.label) || !isString(d.tag) || distroIds.has(d.id)) {
        warnings.push(`Distribution Nr. ${i + 1} ungültig, übersprungen.`);
        return;
      }
      distroIds.add(d.id);
      distros.push({ id: d.id, label: d.label.trim(), tag: d.tag.trim() });
    });
    if (!distros.length) throw new Error('Keine gültige Distribution unter "distros".');

    const categories = raw.categories.filter(isString).map(c => c.trim());
    const seen = new Set();
    const commands = [];
    raw.commands.forEach((c, i) => {
      const where = `Befehl Nr. ${i + 1}`;
      if (!isPlainObject(c) || !isString(c.id) || !c.id.startsWith(ID_PREFIX)) { warnings.push(`${where}: id fehlt oder beginnt nicht mit "${ID_PREFIX}", übersprungen.`); return; }
      if (seen.has(c.id)) { warnings.push(`${where}: doppelte id ${c.id}, übersprungen.`); return; }
      if (!isString(c.title)) { warnings.push(`${where} (${c.id}): title fehlt, übersprungen.`); return; }
      let cmd;
      if (isString(c.cmd)) {
        cmd = c.cmd;
      } else if (isPlainObject(c.cmd)) {
        cmd = {};
        Object.keys(c.cmd).forEach(k => {
          if (!distroIds.has(k)) { warnings.push(`${c.id}: Variante "${k}" ist nicht unter "distros" definiert, ignoriert.`); return; }
          if (isString(c.cmd[k])) cmd[k] = c.cmd[k];
        });
        if (!Object.keys(cmd).length) { warnings.push(`${c.id}: keine gültige Variante, übersprungen.`); return; }
      } else { warnings.push(`${c.id}: cmd fehlt, übersprungen.`); return; }

      const notes = {};
      if (isPlainObject(c.notes)) Object.keys(c.notes).forEach(k => { if (distroIds.has(k) && isString(c.notes[k])) notes[k] = c.notes[k]; });
      const category = isString(c.category) ? c.category.trim() : 'Sonstiges';
      if (!categories.includes(category)) categories.push(category);
      seen.add(c.id);
      commands.push({
        id: c.id,
        category,
        title: c.title.trim(),
        desc: typeof c.desc === 'string' ? c.desc : '',
        tags: Array.isArray(c.tags) ? c.tags.filter(isString) : [],
        cmd,
        note: isString(c.note) ? c.note : '',
        notes,
      });
    });
    return { distros, categories, commands, warnings };
  }

  // [{ distro: null|id, cmd }] in der Reihenfolge von "distros" (nicht des Objekts).
  function variantsOf(card, distros) {
    if (typeof card.cmd === 'string') return [{ distro: null, cmd: card.cmd }];
    const order = distros ? distros.map(d => d.id) : Object.keys(card.cmd);
    return order.filter(id => id in card.cmd).map(id => ({ distro: id, cmd: card.cmd[id] }));
  }

  function hasVariants(card) { return typeof card.cmd !== 'string'; }

  // Modus "all": immer sichtbar. Modus <distro>: Einzelbefehl für alle,
  // Karten mit Varianten nur wenn es eine Variante für diese Distribution gibt.
  function isVisible(card, distro) {
    if (distro === 'all' || typeof card.cmd === 'string') return true;
    return distro in card.cmd;
  }

  // Der Befehl einer Karte für die gewählte Distribution (roh, mit {sudo} und
  // {platzhalter}); null, wenn es keinen gibt.
  function commandFor(card, distro) {
    if (typeof card.cmd === 'string') return card.cmd;
    return distro in card.cmd ? card.cmd[distro] : null;
  }

  // Dateitags plus automatische Distributions-Tags bei Karten mit Varianten.
  function tagsFor(card, distros) {
    const tags = card.tags.slice();
    if (hasVariants(card)) {
      distros.forEach(d => { if (d.id in card.cmd && !tags.includes(d.tag)) tags.push(d.tag); });
    }
    return tags;
  }

  // Hinweise: allgemeiner Hinweis immer, Distributions-Hinweise für die
  // gewählte Distribution bzw. im Modus "all" alle (mit Label).
  function notesFor(card, distro, distros) {
    const out = [];
    if (card.note) out.push({ label: null, text: card.note });
    distros.forEach(d => {
      if (!card.notes[d.id]) return;
      if (distro === 'all') out.push({ label: d.label, text: card.notes[d.id] });
      else if (distro === d.id) out.push({ label: null, text: card.notes[d.id] });
    });
    return out;
  }

  function countVisible(cards, distro) { return cards.filter(c => isVisible(c, distro)).length; }

  const api = {
    SUDO_TOKEN, ID_PREFIX, resolveSudo, hasSudo, normalizeData, variantsOf, hasVariants,
    isVisible, commandFor, tagsFor, notesFor, countVisible,
  };
  if (typeof window !== 'undefined') window.LinuxCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
