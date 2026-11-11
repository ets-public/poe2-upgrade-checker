'use strict';

// The games the app knows, and how to tell which one you're playing. Everything that differs between
// them lives here: trade site paths, poe.ninja paths and the everyday currency prices are counted in.
// See docs/POE1-SUPPORT.md.

const GAMES = {
  poe2: {
    id: 'poe2', name: 'Path of Exile 2', short: 'PoE2', supported: true,
    windowTitle: 'Path of Exile 2', steamAppId: 2694490, pobRoot: 'PathOfBuilding2', pobName: 'Path of Building 2',
    // /api/trade2/search/poe2/<league>, results at /trade2/search/poe2/<league>/<id>
    trade: { api: 'trade2', page: 'trade2', realm: 'poe2' },
    ninja: 'poe2',
    // prices are counted in this currency ("base"); budgets in these
    base: 'exalted', baseShort: 'ex', budgetCurrencies: ['divine', 'exalted', 'chaos'],
  },
  poe1: {
    id: 'poe1', name: 'Path of Exile 1', short: 'PoE1', supported: true, beta: false,
    windowTitle: 'Path of Exile', steamAppId: 238960, pobRoot: 'PathOfBuilding', pobName: 'Path of Building Community',
    // /api/trade/search/<league>, results at /trade/search/<league>/<id>
    trade: { api: 'trade', page: 'trade', realm: null },
    ninja: 'poe1',
    base: 'chaos', baseShort: 'chaos', budgetCurrencies: ['divine', 'chaos'],
  },
};
const DEFAULT_GAME = 'poe2';
const isGame = (g) => Object.prototype.hasOwnProperty.call(GAMES, g);
const gameOf = (g) => GAMES[isGame(g) ? g : DEFAULT_GAME];

// From what the key sender saw: "game=poe1" (Linux, from the Steam app id in the window class)
// or "title=Path of Exile 2" (Windows). The titles must match exactly: "Path of Exile" is the
// start of "Path of Exile 2", and both games use the same executable names.
function gameFromWindow(sent) {
  const s = String(sent || '');
  const g = (s.match(/(?:^|;)game=(poe[12])(?:;|$)/) || [])[1];
  if (g) return g;
  const title = ((s.match(/(?:^|;)title=([^;]*)/) || [])[1] || '').trim();
  return gameFromTitle(title);
}
function gameFromTitle(title) {
  const t = String(title || '').trim();
  if (t === GAMES.poe2.windowTitle) return 'poe2';
  if (t === GAMES.poe1.windowTitle) return 'poe1';
  return null;
}

// From the item text, for copies where the window can't tell (you pressed Ctrl+C yourself).
// Only things that exist in one game count; anything unclear says nothing.
const POE1_CLASSES = /^(claws|rune daggers|warstaves|thrusting one hand swords|fishing rods|abyss jewels|hybrid flasks|utility flasks|tinctures|trinkets|contracts|blueprints|heist (?:cloaks|brooches|gear|tools)|sentinels|memory lines|divination cards|incubators|leaguestones)$/i;
const POE2_CLASSES = /^(charms|quarterstaves|crossbows|foci|bucklers|traps|soul cores|waystones|precursor tablets)$/i;
function gameFromItemText(text) {
  const t = String(text || '');
  let p1 = 0; let p2 = 0;
  const cls = (t.match(/^Item Class:\s*(.+)$/im) || [])[1];
  if (cls && POE1_CLASSES.test(cls.trim())) p1 += 3;
  if (cls && POE2_CLASSES.test(cls.trim())) p2 += 3;
  // PoE1 sockets have colours and links ("Sockets: R-G-B B"); PoE2 rune sockets are "S S"
  if (/^Sockets:\s*[RGBWAD](?:[- ][RGBWAD])*\s*$/m.test(t)) p1 += 3;
  if (/^Sockets:\s*S(?: S)*\s*$/m.test(t)) p2 += 3;
  if (/^(?:Shaper|Elder|Crusader|Hunter|Redeemer|Warlord) Item$/m.test(t)) p1 += 3;
  if (/^(?:Searing Exarch|Eater of Worlds) Item$/m.test(t) || /^Synthesised Item$/m.test(t)) p1 += 3;
  if (/^Spirit:\s*\d+/m.test(t) || /\(rune\)\s*$/m.test(t) || /\(desecrated\)\s*$/m.test(t)) p2 += 2;
  // PoE1-only lines and mod headers (the advanced copy is the default Ctrl+C since 3.29)
  if (/^(?:Talisman Tier:\s*\d+|Abyss|Veiled (?:Prefix|Suffix))$/m.test(t)) p1 += 3;
  if (/^\{ (?:Master Crafted (?:Prefix|Suffix)|Searing Exarch Implicit|Eater of Worlds Implicit)/m.test(t)) p1 += 3;
  if (/^(?:Small|Medium|Large) Cluster Jewel$/m.test(t) || /^Has \d+ Abyssal Sockets?\b/m.test(t)) p1 += 3;
  // PoE2 renamed critical strikes to critical hits
  if (/Critical Strike/.test(t)) p1 += 2;
  if (/Critical Hit/.test(t)) p2 += 2;
  if (p1 > p2) return 'poe1';
  if (p2 > p1) return 'poe2';
  return null;
}

// From a Path of Building export: the root element says which Path of Building made it.
function gameFromPobXml(xml) {
  const s = String(xml || '');
  if (/<PathOfBuilding2[\s>]/.test(s)) return 'poe2';
  if (/<PathOfBuilding[\s>]/.test(s)) return 'poe1';
  return null;
}

// Which game a press was for: the window first, then the item text, then the game you played last.
function detectGame({ sent, text, last } = {}) {
  return gameFromWindow(sent) || gameFromItemText(text) || (isGame(last) ? last : null);
}

module.exports = { GAMES, DEFAULT_GAME, isGame, gameOf, gameFromWindow, gameFromTitle, gameFromItemText, gameFromPobXml, detectGame };
