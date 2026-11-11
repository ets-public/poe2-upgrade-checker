'use strict';

// Parses the text PoE2 (and PoE1) puts on the clipboard when you hover an item and press
// Ctrl+C (or Ctrl+Alt+C for the advanced version with mod tiers; since PoE1 3.29 a plain
// Ctrl+C gives the advanced text there).
//
// Output:
// {
//   itemClass, rarity, name, baseType, slot, twoHanded,
//   itemLevel, requiredLevel, corrupted, unidentified,
//   stats: { "<template>": number, ... },   // what gets scored
//   lines: [ { text, key, value, tag } ]    // for display
// }
//
// PoE1 extras, set only when the item has them (so PoE2 items keep their exact shape):
//   sockets: "R-R-G-B B", links: 3, socketCount: 5,
//   influences: ['shaper', 'elder', ...], eldritch: { exarch, eater, exarchRank, eaterRank },
//   synthesised, fractured, veiled, mirrored, split, unmodifiable, foulborn, talismanTier,
//   flask (all flasks), abyss (abyss jewels), cluster: { size, passives, jewelSockets, smallGrants, notables }
// Socket, influence, flask-charge, requirement, cluster-structure and help lines never become stats.

const { slotForClass, isTwoHanded } = require('./slots');

const SEPARATOR = /^-{4,}\s*$/;
const NUM = /[+-]?\d+(?:\.\d+)?/g;
const TAG = /\s*\((implicit|rune|enchant|crafted|fractured|desecrated|augmented|unmet|veiled|mutated|scourge|crucible)\)\s*$/i;

const SKIP_LINE = [
  /^Requirements:?$/i, /^Requires\b/i, /^Level:/i, /^Str:/i, /^Dex:/i, /^Int:/i,
  /^Item Level:/i, /^Sockets:/i, /^Quality\b/i, /^Corrupted$/i, /^Unidentified$/i,
  /^Mirrored$/i, /^Note:/i, /^Rarity:/i, /^Item Class:/i, /^Stack Size:/i,
  /^Waystone Tier:/i, /^Item Tier:/i, /^Unmodifiable$/i, /^Sanctified$/i, /^Twice Corrupted$/i,
];

// Base properties shown at the top of armour / weapon / shield items.
const PROPERTY_KEYS = {
  'armour': '[Base] Armour',
  'evasion rating': '[Base] Evasion Rating',
  'energy shield': '[Base] Energy Shield',
  'block chance': '[Base] Block Chance',
  'chance to block': '[Base] Block Chance',
  'spirit': '[Base] Spirit',
  'runic ward': '[Base] Runic Ward',
  'ward': '[Base] Ward', // PoE1
};

// Mods that really mean several stats at once. Expanded so you only have to
// weight e.g. Fire Resistance once and "all Elemental Resistances" counts too.
const RES = { fire: 'Fire', cold: 'Cold', lightning: 'Lightning', chaos: 'Chaos' };
const ATTR = { strength: 'Strength', dexterity: 'Dexterity', intelligence: 'Intelligence' };

function expand(key, value) {
  if (/^#% to all Elemental Resistances$/i.test(key)) {
    return ['Fire', 'Cold', 'Lightning'].map((e) => [`#% to ${e} Resistance`, value]);
  }
  let m = key.match(/^#% to (Fire|Cold|Lightning|Chaos) and (Fire|Cold|Lightning|Chaos) Resistances$/i);
  if (m) return [m[1], m[2]].map((e) => [`#% to ${RES[e.toLowerCase()]} Resistance`, value]);
  if (/^# to all Attributes$/i.test(key)) {
    return Object.values(ATTR).map((a) => [`# to ${a}`, value]);
  }
  m = key.match(/^# to (Strength|Dexterity|Intelligence) and (Strength|Dexterity|Intelligence)$/i);
  if (m) return [m[1], m[2]].map((a) => [`# to ${ATTR[a.toLowerCase()]}`, value]);
  return [[key, value]];
}

// Turn "+32% to Cold Resistance" into { key: "#% to Cold Resistance", value: 32 }.
function modToStat(text) {
  const nums = text.match(NUM);
  if (!nums) return null;
  let values = nums.map(Number);
  let key = text.replace(NUM, '#').replace(/\s+/g, ' ').trim();

  // "Adds 10 to 20 Fire Damage" -> average of the range
  let value;
  if (values.length === 2 && /# to #/.test(key)) value = (values[0] + values[1]) / 2;
  else value = values[0];

  // Normalise opposite wordings so they net against each other.
  if (/\breduced\b/i.test(key)) { key = key.replace(/\breduced\b/i, 'increased'); value = -Math.abs(value); }
  if (/\bless\b/i.test(key)) { key = key.replace(/\bless\b/i, 'more'); value = -Math.abs(value); }

  return { key, value };
}

function avgRanges(str) {
  // "20-38 (augmented), 5-9" -> sum of the averages of each range
  let total = 0;
  for (const m of str.matchAll(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/g)) {
    total += (Number(m[1]) + Number(m[2])) / 2;
  }
  return total;
}

// Mageblood's Mage's Legacies: each is a fixed always-on bonus (named after a PoE1 flask).
// Values from the community wikis (exiletown, urgametips) – the item text names the Legacy only.
// A Legacy you have twice applies once, but every duplicate raises the effect of all of them
// by the belt's "increased effect per duplicate" roll.
const LEGACY_LINE = /^Legacy of (Amethyst|Basalt|Bismuth|Diamond|Gold|Granite|Jade|Quicksilver|Ruby|Sapphire|Silver|Stibnite|Sulphur|Topaz)$/i;
const LEGACIES = {
  amethyst: [['#% to Chaos Resistance', 45]],
  basalt: [['#% increased Armour', 150]],
  bismuth: [['#% to all Elemental Resistances', 45]],
  diamond: [['#% increased Critical Hit Chance', 75]],
  gold: [['#% increased Rarity of Items found', 45]],
  granite: [['# to Armour', 2000]],
  jade: [['# to Evasion Rating', 2000]],
  quicksilver: [['#% increased Movement Speed', 30]],
  ruby: [['#% to Fire Resistance', 60], ['#% to Maximum Fire Resistance', 5]],
  sapphire: [['#% to Cold Resistance', 60], ['#% to Maximum Cold Resistance', 5]],
  silver: [['#% increased Skill Speed', 30]],
  stibnite: [['#% increased Evasion Rating', 150]],
  sulphur: [['#% increased Damage', 60]],
  topaz: [['#% to Lightning Resistance', 60], ['#% to Maximum Lightning Resistance', 5]],
};
function applyLegacies(item, names, add) {
  const dupKey = Object.keys(item.stats).find((k) => /increased effect per duplicate Mage's Legacy/i.test(k));
  const perDup = dupKey ? Number(item.stats[dupKey]) || 0 : 0;
  const unique = [...new Set(names)];
  const dups = names.length - unique.length;
  const mult = 1 + (perDup / 100) * dups;
  item.legacies = { names: unique, duplicates: dups, effect: mult };
  for (const n of unique) for (const [k, v] of LEGACIES[n] || []) add(k, Math.round(v * mult * 10) / 10);
}

// PoE1: influence lines (their own section), and the Eldritch lines that the game appends to the
// end of another section.
const INFLUENCE_LINE = /^(Shaper|Elder|Crusader|Hunter|Redeemer|Warlord) Item$/;
const ELDRITCH_LINE = /^(Searing Exarch|Eater of Worlds) Item$/;
// PoE1-only lines that say something about the item and are never mods.
const POE1_FLAG_LINE = /^(Synthesised Item|Split|Foil Unique(?: \(.*\))?|Abyss)$/;
// Help text at the bottom of jewels, flasks etc.
const HELP_LINE = /^(Place into an? |Right[ -]click to |Can only hold charges |Used automatically when condition is met|Can be used in (?:a|a personal) Map Device|Travel to this Map by using it in )/i;
// PoE1/PoE2 weapon property blocks start with the weapon type ("Claw", "Two Handed Sword")
const WEAPON_TYPE_LINE = /^(Bow|Claw|Dagger|Rune Dagger|Wand|Sceptre|Staff|Warstaff|Quarterstaff|Crossbow|Spear|Flail|Fishing Rod|Thrusting One Handed Sword|(?:One|Two) Hand(?:ed)? (?:Sword|Axe|Mace))$/;
// Flask / charm base properties
const FLASK_PROP = /^(Currently has \d+ Charges?|Consumes \d+ of \d+ Charges? on use|Lasts [\d.]+(?: \(augmented\))? Seconds?|Recovers [\d.,]+(?: \(augmented\))? (?:Life|Mana|Life and Mana)(?: over [\d.]+(?: \(augmented\))? Seconds?)?)$/i;
const CANNOT_USE = /^You cannot use this item\. Its stats will be ignored\.?$/i;

// Lines that only carry information: they never hold a mod.
const META_LINE = /^(Corrupted|Unidentified|Mirrored|Unmodifiable|Sanctified|Twice Corrupted|Split|Synthesised Item|Fractured Item|Foil Unique.*|(?:Shaper|Elder|Crusader|Hunter|Redeemer|Warlord|Searing Exarch|Eater of Worlds) Item|Note:.*|Sockets:.*|Item Level:.*)$/i;
// Prose: a flavour-text line starts lower case or with a quote, or ends with punctuation. Mod lines don't.
const PROSE = /^[a-z"'“‘«]|[.,;:!?"'”’»…]$/;

// A unique's flavour text is its last block of text: plain prose with no mod tags, no advanced-copy
// headers and no Mage's Legacies, after at least one other block.
function flavourBlock(blocks, rarity) {
  if (!/unique/i.test(rarity || '')) return -1;
  let last = -1; let content = 0;
  blocks.forEach((b, i) => {
    if (i === 0) return;
    if (b.some((l) => !META_LINE.test(l))) { last = i; content++; }
  });
  if (last < 0 || content < 2) return -1;
  const lines = blocks[last].filter((l) => !META_LINE.test(l));
  if (lines.some((l) => l.startsWith('{') || TAG.test(l) || LEGACY_LINE.test(l) || /^[A-Za-z ]+:\s/.test(l))) return -1;
  return lines.some((l) => PROSE.test(l)) ? last : -1;
}

// "R-R-G-B B" -> { sockets, links: 4, socketCount: 5 }. PoE1 colours: R G B W, A (abyssal), D (delve).
function readSockets(text) {
  const m = text.match(/^Sockets:\s*([RGBWAD](?:[- ][RGBWAD])*)\s*$/m);
  if (!m) return null;
  const groups = m[1].split(' ');
  return {
    sockets: m[1],
    links: Math.max(...groups.map((g) => g.split('-').length)),
    socketCount: groups.reduce((n, g) => n + g.split('-').length, 0),
  };
}

// Cluster jewel structure lines: recorded on item.cluster, never stats.
function clusterLine(c, text) {
  let m;
  if ((m = text.match(/^Adds (\d+) Passive Skills?$/i))) { c.passives = Number(m[1]); return true; }
  if ((m = text.match(/^(\d+) Added Passive Skills? (?:is a|are) Jewel Sockets?$/i))) { c.jewelSockets = Number(m[1]); return true; }
  if ((m = text.match(/^Added Small Passive Skills (?:also )?grant: (.+)$/i))) { c.smallGrants.push(m[1]); return true; }
  if ((m = text.match(/^1 Added Passive Skill is (.+)$/i))) { c.notables.push(m[1]); return true; }
  return false;
}

// PoE1-only things about the item as a whole (each field only when the item has it).
function readPoe1Extras(item, text, names) {
  const cls = String(item.itemClass || '').toLowerCase();
  const sock = readSockets(text);
  if (sock) Object.assign(item, sock);
  const infl = [...text.matchAll(/^(Shaper|Elder|Crusader|Hunter|Redeemer|Warlord) Item$/gm)].map((m) => m[1].toLowerCase());
  if (infl.length) item.influences = [...new Set(infl)];
  const exarch = /^Searing Exarch Item$/m.test(text) || /Searing Exarch Implicit Modifier/.test(text);
  const eater = /^Eater of Worlds Item$/m.test(text) || /Eater of Worlds Implicit Modifier/.test(text);
  if (exarch || eater) item.eldritch = { exarch, eater, exarchRank: null, eaterRank: null };
  if (/^Synthesised Item$/m.test(text)) {
    item.synthesised = true;
    if (names[1]) item.baseType = names[1].replace(/^Synthesised /, '');
  }
  if (/^Fractured Item$/m.test(text)) item.fractured = true;
  if (/^Mirrored$/m.test(text)) item.mirrored = true;
  if (/^Split$/m.test(text)) item.split = true;
  if (/^Unmodifiable$/m.test(text)) item.unmodifiable = true;
  const tier = text.match(/^Talisman Tier:\s*(\d+)/m);
  if (tier) item.talismanTier = Number(tier[1]);
  if (/unique/i.test(item.rarity || '') && /^Foulborn /.test(item.name || '')) {
    item.foulborn = true; item.name = item.name.replace(/^Foulborn /, '');
  }
  if (/flask/.test(cls)) item.flask = true;
  if (cls === 'abyss jewels') item.abyss = true;
  let cm = String(item.baseType || '').match(/^(Small|Medium|Large) Cluster Jewel$/);
  // a magic cluster jewel has no base type line ("Blunt Large Cluster Jewel of Potency"): the base
  // is in its name
  if (!cm && cls === 'jewels') {
    const n = String(names[0] || '').match(/\b(Small|Medium|Large) Cluster Jewel\b/);
    if (n) { cm = n; item.baseType = `${n[1]} Cluster Jewel`; }
  }
  if (cm) item.cluster = { size: cm[1].toLowerCase(), passives: null, jewelSockets: 0, smallGrants: [], notables: [] };
}

function parseItem(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!/^Item Class:/i.test(text)) return null;

  const blocks = [];
  let cur = [];
  for (const line of text.split('\n')) {
    if (SEPARATOR.test(line)) { blocks.push(cur); cur = []; }
    else if (line.trim()) cur.push(line.trim());
  }
  blocks.push(cur);
  // "You cannot use this item. Its stats will be ignored" sits under Rarity, and the name lines
  // follow in the next section
  if (blocks[0] && blocks[0].some((l) => CANNOT_USE.test(l)) && blocks[1]) {
    blocks.splice(0, 2, [...blocks[0].filter((l) => !CANNOT_USE.test(l)), ...blocks[1]]);
  }

  const header = blocks[0] || [];
  const item = {
    raw: text, // the game's own text, for Path of Building
    itemClass: null, rarity: null, name: null, baseType: null,
    slot: null, twoHanded: false, itemLevel: null, requiredLevel: null,
    corrupted: false, unidentified: false, stats: {}, lines: [],
  };

  const names = [];
  for (const line of header) {
    let m;
    if ((m = line.match(/^Item Class:\s*(.+)$/i))) item.itemClass = m[1].trim();
    else if ((m = line.match(/^Rarity:\s*(.+)$/i))) item.rarity = m[1].trim();
    else names.push(line);
  }
  item.name = names[0] || null;
  item.baseType = names[1] || names[0] || null;
  // a magic item's only name line includes its affixes ("Hale Gold Ring of the Whelpling"), and
  // normal items can be "Superior …": neither is a base type the trade site knows
  const rarLower = String(item.rarity || '').toLowerCase();
  if (!names[1] && rarLower === 'magic') item.baseType = null;
  if (item.baseType && rarLower === 'normal') item.baseType = item.baseType.replace(/^Superior /, '');
  item.slot = slotForClass(item.itemClass);
  item.twoHanded = isTwoHanded(item.itemClass);
  readPoe1Extras(item, text, names);

  const add = (key, value) => {
    for (const [k, v] of expand(key, value)) {
      item.stats[k] = (item.stats[k] || 0) + v;
    }
  };

  // Advanced copy ({ Prefix Modifier ... } headers) tells us how many affixes
  // are used, so we can say how many are still open for crafting.
  let prefixes = 0; let suffixes = 0; let sawHeaders = false;

  const legacies = []; // Mageblood: "Legacy of Bismuth" lines

  // Weapon damage bits, collected from the property block.
  let phys = 0, ele = 0, chaos = 0, aps = 0, crit = 0;

  const flavour = flavourBlock(blocks, item.rarity);

  blocks.slice(1).forEach((block, bi) => {
    if (bi + 1 === flavour) {
      // flavour text: keep only the lines that matter (Corrupted etc.)
      if (block.some((l) => /^Corrupted$/i.test(l))) item.corrupted = true;
      if (block.some((l) => /^Unidentified$/i.test(l))) item.unidentified = true;
      return;
    }
    // in advanced text the header line says what kind of mod follows; the line itself has no tag
    let headerTag = null;
    let headerTier = null; let headerAffix = null; let lineRoll = null;
    // advanced copy: every mod line under a { ... (Tier: N) } header gets its tier, and its roll (how high
    // in its range it rolled, 0-100%) from "+89(80-99)"
    const push0 = item.lines.push;
    item.lines.push = function (...xs) {
      for (const x of xs) if (x && x.tag !== 'info') { if (headerTier != null) { x.tier = headerTier; if (headerAffix) x.affix = headerAffix; } if (lineRoll != null) x.roll = lineRoll; }
      return push0.apply(this, xs);
    };
    let inReminder = false;
    // a flask's (or charm's) property block: charges, duration, recovery and the flask's own buff
    const flaskBlock = block.some((l) => /^(Currently has \d+ Charges?|Consumes \d+ of \d+ Charges? on use)$/i.test(l));
    let hasMod = null;
    const blockHasMod = () => {
      if (hasMod == null) hasMod = block.some((l) => !l.startsWith('{') && !l.startsWith('(') && !!modToStat(l.replace(/\((-?\d+(?:\.\d+)?)[-–](-?\d+(?:\.\d+)?)\)/g, '').replace(TAG, '').trim()));
      return hasMod;
    };
    block.forEach((line) => {
      const rr = line.match(/(-?\d+(?:\.\d+)?)\((-?\d+(?:\.\d+)?)[-–](-?\d+(?:\.\d+)?)\)/);
      lineRoll = rr && Number(rr[3]) !== Number(rr[2]) ? Math.max(0, Math.min(100, Math.round(((Number(rr[1]) - Number(rr[2])) / (Number(rr[3]) - Number(rr[2]))) * 100))) : null;
      // reminder text, "(Maximum Resistances cannot be raised above 90%)", is never a mod;
      // it can run over several lines
      if (inReminder) { if (/\)\s*$/.test(line)) inReminder = false; return; }
      if (line.startsWith('(')) {
        if (!/\)\s*$/.test(line)) inReminder = true;
        return;
      }
      // Advanced (Ctrl+Alt+C) descriptor lines like { Prefix Modifier "Hale" (Tier: 3) }
      if (line.startsWith('{')) {
        sawHeaders = true;
        if (/Prefix Modifier/i.test(line)) prefixes++;
        else if (/Suffix Modifier/i.test(line)) suffixes++;
        const eld = line.match(/(Searing Exarch|Eater of Worlds) Implicit Modifier(?: \((\w+)\))?/i);
        if (eld && item.eldritch) {
          const which = /exarch/i.test(eld[1]) ? 'exarch' : 'eater';
          item.eldritch[which] = true;
          if (eld[2]) item.eldritch[which + 'Rank'] = eld[2];
        }
        const tm = line.match(/\((?:Tier|Rank):\s*(\d+)\)/i); headerTier = tm ? Number(tm[1]) : null;
        const am = line.match(/Modifier\s+"([^"]+)"/i); headerAffix = am ? am[1] : null;
        headerTag = /Implicit Modifier/i.test(line) ? 'implicit'
          : /Enchant/i.test(line) ? 'enchant'
          : /Master Crafted/i.test(line) ? 'crafted'
          : /Rune Modifier|Augment/i.test(line) ? 'rune'
          : /Fractured/i.test(line) ? 'fractured'
          : /Desecrated/i.test(line) ? 'desecrated'
          : 'explicit';
        return;
      }
      // Advanced text puts mod ranges in brackets: +89(80-99) to maximum Life
      const clean = line.replace(/\((-?\d+(?:\.\d+)?)[-–](-?\d+(?:\.\d+)?)\)/g, '')
        .replace(/\s+[—–-]+\s*Unscalable Value\s*$/i, ''); // advanced-copy note

      let m;
      if ((m = clean.match(/^Item Level:\s*(\d+)/i))) { item.itemLevel = Number(m[1]); return; }
      if ((m = clean.match(/^Level:\s*(\d+)/i))) { item.requiredLevel = Number(m[1]); return; }
      if ((m = clean.match(/^Requires:?\s*Level\s*(\d+)/i))) { item.requiredLevel = Number(m[1]); return; }
      if ((m = clean.match(/^Limited to:\s*(\d+)/i))) { item.limitedTo = Number(m[1]); return; }
      if (/^Corrupted$/i.test(clean)) { item.corrupted = true; return; }
      if (/^Unidentified$/i.test(clean)) { item.unidentified = true; return; }
      if (SKIP_LINE.some((r) => r.test(clean))) return;
      // PoE1 section lines (read in readPoe1Extras) are never mods
      if (INFLUENCE_LINE.test(clean) || ELDRITCH_LINE.test(clean) || POE1_FLAG_LINE.test(clean)) return;
      if (/^Talisman Tier:/i.test(clean)) return;
      if (flaskBlock) {
        item.lines.push({ text: line, key: null, value: null, tag: FLASK_PROP.test(clean) ? 'info' : 'flask' });
        return;
      }
      if (item.cluster && clusterLine(item.cluster, clean.replace(TAG, ''))) {
        const t = clean.match(TAG);
        item.lines.push({ text: line, key: null, value: null, tag: t ? t[1].toLowerCase() : (headerTag || 'explicit') });
        return;
      }

      // "Key: value" property lines
      const prop = clean.match(/^([A-Za-z ]+):\s*(.+)$/);
      if (prop) {
        const pk = prop[1].trim().toLowerCase();
        const pv = prop[2].replace(TAG, '');
        if (PROPERTY_KEYS[pk]) {
          const n = pv.match(NUM);
          if (n) {
            const key = PROPERTY_KEYS[pk];
            add(key, Number(n[0]));
            item.lines.push({ text: line, key, value: Number(n[0]), tag: 'base' });
          }
          return;
        }
        if (pk === 'physical damage') { phys += avgRanges(pv); return; }
        if (pk === 'elemental damage' || /^(fire|cold|lightning) damage$/.test(pk)) { ele += avgRanges(pv); return; }
        if (pk === 'chaos damage') { chaos += avgRanges(pv); return; }
        if (pk === 'attacks per second') { aps = Number((pv.match(NUM) || [0])[0]); return; }
        if (pk === 'critical hit chance' || pk === 'critical strike chance') {
          crit = Number((pv.match(NUM) || [0])[0]); return;
        }
        // Other "X: Y" lines (Grants Skill, Reload Time, etc.) are shown but not scored.
        item.lines.push({ text: line, key: null, value: null, tag: 'info' });
        return;
      }

      const tagMatch = clean.match(TAG);
      const tag = tagMatch ? tagMatch[1].toLowerCase() : (headerTag || 'explicit');
      const modText = clean.replace(TAG, '').replace(TAG, '').trim();
      const leg = modText.match(LEGACY_LINE);
      if (leg) {
        legacies.push(leg[1].toLowerCase());
        item.lines.push({ text: line, key: null, value: null, tag });
        return;
      }
      const stat = modToStat(modText);
      if (!stat) {
        // flavour text / keyword mods with no numbers - keep a flag stat for keyword mods
        if (/^Veiled (Prefix|Suffix)$/.test(modText)) item.veiled = true;
        // a unique's keyword mods ("Cannot be Ignited") sit in the block with its other mods; its
        // flavour text is a block of its own, with no numbers in it
        if (/^(maps|waystones|tablets?|precursor tablets?)$/i.test(item.itemClass || '') || (block.length <= 6 && item.rarity !== 'Unique') || (item.rarity === 'Unique' && blockHasMod())) {
          // help text, the weapon-type line and "Fractured Item" are shown as info, not as mods
          const info = HELP_LINE.test(modText) || WEAPON_TYPE_LINE.test(modText) || /^Fractured Item$/i.test(modText);
          // kw: the mod's own words, for matching it to a trade stat (it has no number to make a key)
          item.lines.push({ text: line, key: null, value: null, tag: info ? 'info' : tag, ...(info ? {} : { kw: modText }) });
        }
        return;
      }
      add(stat.key, stat.value);
      item.lines.push({ text: line, key: stat.key, value: stat.value, tag });
    });
    delete item.lines.push; // back to the normal push (the tier tagging is for this block's lines only)
  });

  if (legacies.length) applyLegacies(item, legacies, add);
  if (!item.fractured && item.lines.some((l) => l.tag === 'fractured')) item.fractured = true;

  const rar = String(item.rarity || '').toLowerCase();
  if (sawHeaders && (rar === 'rare' || rar === 'magic')) {
    const max = rar === 'rare' ? (item.slot === 'Jewel' ? 2 : 3) : 1; // rare jewels: 2 prefixes, 2 suffixes
    item.affixes = {
      known: true, prefixes, suffixes,
      openPrefix: item.corrupted ? 0 : Math.max(0, max - prefixes),
      openSuffix: item.corrupted ? 0 : Math.max(0, max - suffixes),
    };
  } else {
    item.affixes = { known: false };
  }

  if (aps > 0) {
    const r = (x) => Math.round(x * 10) / 10;
    item.stats['[Weapon] Physical DPS'] = r(phys * aps);
    item.stats['[Weapon] Elemental DPS'] = r(ele * aps);
    if (chaos) item.stats['[Weapon] Chaos DPS'] = r(chaos * aps);
    item.stats['[Weapon] Total DPS'] = r((phys + ele + chaos) * aps);
    if (crit) item.stats['[Weapon] Critical Hit Chance'] = crit;
    item.stats['[Weapon] Attacks per Second'] = aps;
  }

  return item;
}

module.exports = { parseItem, modToStat, expand, LEGACIES };
