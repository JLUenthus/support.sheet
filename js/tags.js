// ============================================================
// AdminSheet – Tag System
// Vanilla JS, kein Framework
// ============================================================


/**
 * Gibt alle einzigartigen Tags aus einem Commands-Array zurück.
 * Sortiert alphabetisch.
 *
 * @param {Array} commands - Array von Command-Objekten
 * @returns {Array<string>} Sortiertes Array einzigartiger Tags
 *
 * @example
 * getAllTags(commands)
 * // → ['active-directory', 'eventlog', 'network', 'powershell', ...]
 */
function getAllTags(commands) {
  const tagSet = new Set();

  commands.forEach(cmd => {
    cmd.tags.forEach(tag => tagSet.add(tag));
  });

  return [...tagSet].sort();
}


/**
 * Gruppiert Commands nach Tag.
 * Ein Command mit 3 Tags taucht in 3 Gruppen auf.
 *
 * @param {Array} commands - Array von Command-Objekten
 * @returns {Object} { tagName: [cmd, cmd, ...], ... }
 *
 * @example
 * groupByTag(commands)
 * // → { network: [...], powershell: [...], ... }
 */
function groupByTag(commands) {
  const groups = {};

  commands.forEach(cmd => {
    cmd.tags.forEach(tag => {
      if (!groups[tag]) groups[tag] = [];
      groups[tag].push(cmd);
    });
  });

  // Gruppen alphabetisch sortieren
  return Object.fromEntries(
    Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  );
}


/**
 * Filtert Commands nach einem oder mehreren Tags.
 * Gibt nur Commands zurück die ALLE gesuchten Tags haben.
 *
 * @param {Array} commands - Array von Command-Objekten
 * @param {Array<string>} filterTags - Tags nach denen gefiltert wird
 * @returns {Array} Gefilterte Commands
 *
 * @example
 * filterByTags(commands, ['network', 'troubleshooting'])
 * // → nur Commands die BEIDE Tags haben
 */
function filterByTags(commands, filterTags) {
  if (!filterTags || filterTags.length === 0) return commands;

  return commands.filter(cmd =>
    filterTags.every(tag => cmd.tags.includes(tag))
  );
}


// ── Demo: Laden + alle Funktionen ausprobieren ──────────
async function loadAndDemo() {
  const response = await fetch('./commands.json');
  const data     = await response.json();
  const commands = data.commands;

  // 1) Alle einzigartigen Tags
  const allTags = getAllTags(commands);
  console.log('── getAllTags() ──────────────────────');
  console.log(allTags);
  // → ['active-directory', 'eventlog', 'network', 'powershell', 'quick', 'troubleshooting', 'windows']

  // 2) Nach Tags gruppieren
  const grouped = groupByTag(commands);
  console.log('\n── groupByTag() ─────────────────────');
  Object.entries(grouped).forEach(([tag, cmds]) => {
    console.log(`  [${tag}] → ${cmds.length} Commands`);
    cmds.forEach(c => console.log(`    • ${c.name}`));
  });

  // 3) Filtern: nur Commands mit 'network' UND 'troubleshooting'
  const filtered = filterByTags(commands, ['network', 'troubleshooting']);
  console.log('\n── filterByTags(network + troubleshooting) ──');
  filtered.forEach(c => console.log(`  • ${c.name}`));
  // → nur Commands die BEIDE Tags haben

  return { commands, allTags, grouped };
}

document.addEventListener('DOMContentLoaded', () => {
  loadAndDemo().then(result => {
    console.log('\nBereit für Rendering:', result);
    // Nächster Schritt: renderCommands(result.commands)
  });
});
