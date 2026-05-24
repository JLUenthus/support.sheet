// ============================================================
// AdminSheet – Command Loader + Tag System
// Vanilla JS, kein Framework
// ============================================================


/**
 * Lädt die commands.json und gibt das geparste Objekt zurück.
 * @returns {Promise<Array>} Array aller Commands
 */
async function loadCommands() {
  const response = await fetch('./data/commands.json');

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.commands || !Array.isArray(data.commands)) {
    throw new Error('commands.json hat kein gültiges "commands" Array');
  }

  // Default-Werte: Tags immer als Array, auch wenn leer oder fehlend
  // Pflichtfelder validieren – fehlendes id/name/cmd → Command überspringen
  const commands = data.commands
    .filter(cmd => {
      if (!cmd.id || !cmd.name || !cmd.cmd) {
        console.warn('loadCommands: Command übersprungen (fehlendes id/name/cmd)', cmd);
        return false;
      }
      return true;
    })
    .map(cmd => ({
      ...cmd,
      tags: Array.isArray(cmd.tags) ? cmd.tags : []
    }));

  console.log('✅ Commands geladen');
  console.log(`   Version:  ${data.version}`);
  console.log(`   Stand:    ${data.lastUpdated}`);
  console.log(`   Commands: ${commands.length}`);

  commands.forEach(cmd => {
    console.log(`  • ${cmd.name}`);
    console.log(`    cmd:  ${cmd.cmd}`);
    console.log(`    tags: [${cmd.tags.join(', ')}]`);
  });

  return commands;
}


/**
 * Gibt alle einzigartigen Tags zurück, sortiert alphabetisch.
 * @param {Array} commands
 * @returns {Array<string>}
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
 * @param {Array} commands
 * @returns {Object} { tagName: [cmd, ...], ... }
 */
function groupByTag(commands) {
  const groups = {};

  commands.forEach(cmd => {
    cmd.tags.forEach(tag => {
      if (!groups[tag]) groups[tag] = [];
      groups[tag].push(cmd);
    });
  });

  return Object.fromEntries(
    Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  );
}


/**
 * Filtert Commands – gibt nur Commands zurück die ALLE gesuchten Tags haben.
 * @param {Array} commands
 * @param {Array<string>} filterTags
 * @returns {Array}
 */
function filterByTags(commands, filterTags) {
  if (!filterTags || filterTags.length === 0) return commands;

  return commands.filter(cmd =>
    filterTags.every(tag => cmd.tags.includes(tag))
  );
}


// Kein eigener Start – render.js übernimmt die Kontrolle.
