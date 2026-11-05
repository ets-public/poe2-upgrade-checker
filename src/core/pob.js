'use strict';

// Path of Building (PoB2) import: an export code is base64url(zlib(XML)).
// From the XML we take the active item set (what's in each slot), the
// jewels socketed in the tree, and your resistances, and turn each PoB item
// into the same text the game copies, so the normal parser can read it.

const zlib = require('zlib');
const { JEWEL_MAX } = require('./slots');

const MAX_XML = 20 * 1024 * 1024;
function decodeCode(code) {
  const s = String(code || '').trim();
  if (s.startsWith('<')) return s; // raw XML pasted
  const b64 = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('That code is empty.');
  // a real build is well under 20 MB unpacked: a bigger one would only be there to eat memory
  const opts = { maxOutputLength: MAX_XML };
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
    try { return fn(buf, opts).toString('utf8'); } catch (err) {
      if (err && (err.code === 'ERR_BUFFER_TOO_LARGE' || /larger than|too large/i.test(err.message || ''))) throw new Error('That build is too big to be a Path of Building export.');
    }
  }
  throw new Error("That doesn't look like a Path of Building code.");
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(t) {
  return String(t).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] != null ? ENT[e] : m;
  });
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? unescapeXml(m[1]) : null; };

const SLOT_MAP = {
  'Weapon 1': 'Weapon', 'Weapon 2': 'Offhand', 'Weapon 1 Swap': 'Weapon 2', 'Weapon 2 Swap': 'Offhand 2',
  Helmet: 'Helmet', 'Body Armour': 'Body Armour', Gloves: 'Gloves', Boots: 'Boots', Belt: 'Belt', Amulet: 'Amulet',
  'Ring 1': 'Ring 1', 'Ring 2': 'Ring 2', 'Flask 1': 'Life Flask', 'Flask 2': 'Mana Flask',
  'Charm 1': 'Charm 1', 'Charm 2': 'Charm 2', 'Charm 3': 'Charm 3',
};

const SLOT_CLASS = {
  Helmet: 'Helmets', 'Body Armour': 'Body Armours', Gloves: 'Gloves', Boots: 'Boots', Belt: 'Belts', Amulet: 'Amulets',
  'Ring 1': 'Rings', 'Ring 2': 'Rings', 'Life Flask': 'Life Flasks', 'Mana Flask': 'Mana Flasks',
  'Charm 1': 'Charms', 'Charm 2': 'Charms', 'Charm 3': 'Charms',
};
const WEAPON_CLASSES = [
  [/sceptre/i, 'Sceptres'], [/wand/i, 'Wands'], [/quarterstaff|warstaff/i, 'Quarterstaves'], [/staff/i, 'Staves'],
  [/crossbow/i, 'Crossbows'], [/bow/i, 'Bows'], [/spear/i, 'Spears'], [/flail/i, 'Flails'], [/dagger/i, 'Daggers'],
  [/claw/i, 'Claws'], [/talisman/i, 'Talismans'], [/focus/i, 'Foci'], [/buckler/i, 'Bucklers'], [/quiver/i, 'Quivers'],
  [/shield|targe/i, 'Shields'], [/maul|great/i, 'Two Hand Maces'], [/mace|club/i, 'One Hand Maces'], [/axe/i, 'One Hand Axes'], [/sword/i, 'One Hand Swords'],
];

function itemClassFor(slot, base) {
  if (SLOT_CLASS[slot]) return SLOT_CLASS[slot];
  if (/^Jewel/.test(slot)) return 'Jewels';
  for (const [re, cls] of WEAPON_CLASSES) if (re.test(base || '')) return cls;
  return /Offhand/.test(slot) ? 'Foci' : 'Sceptres';
}

const META = /^(Unique ID|Item Level|Quality|Sockets|LevelReq|Level Req|Implicits|Radius|Limited to|Crafted|Prefix|Suffix|Selected Variant|Has Alt Variant|Variant|League|Catalyst|CatalystQuality|Rune|Source|Talisman Tier|Requires|Evasion ?Rating ?Base ?Percentile|\w+BasePercentile|Cluster Jewel|Influence|Item Class|Spirit Base|Armour Base|Energy Shield Base|Evasion Base)\b/i;
const TAGS = { crafted: 'crafted', fractured: 'fractured', desecrated: 'desecrated', enchant: 'enchant', rune: 'rune', implicit: 'implicit', mutated: 'mutated' };

// One PoB item -> game-style item text
function convertItem(raw, slot) {
  const lines = unescapeXml(raw).replace(/<[^>]+>/g, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let i = 0;
  let rarity = 'Rare';
  if (/^Rarity:/i.test(lines[0] || '')) { rarity = lines[0].split(':')[1].trim(); i = 1; }
  rarity = rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase();
  const names = [];
  const twoNames = /rare|unique/i.test(rarity);
  while (i < lines.length && names.length < (twoNames ? 2 : 1) && !META.test(lines[i]) && !/^\{/.test(lines[i])) names.push(lines[i++]);
  const name = names[0] || 'Unknown';
  const base = names[1] || names[0] || '';
  let ilvl = null; let implicitCount = 0; let corrupted = false;
  const props = []; const implicits = []; const mods = [];
  // uniques with several versions: PoB keeps every version's lines, tagged {variant:1,2}, and says which one
  // the item is ("Selected Variant: 2", plus "Selected Alt Variant: N" for a second choice). Without a
  // "Selected" line PoB uses the last variant.
  const variantCount = lines.filter((l) => /^Variant:/i.test(l)).length;
  const selected = new Set(lines.map((l) => (l.match(/^Selected (?:Alt )?Variant(?: \w+)?:\s*(\d+)/i) || [])[1]).filter(Boolean).map(Number));
  if (!selected.size && variantCount) selected.add(variantCount);
  const otherVariant = (l) => {
    const v = l.match(/\{variant:([\d,\s]+)\}/i);
    return !!v && selected.size > 0 && !v[1].split(',').map(Number).some((n) => selected.has(n));
  };
  for (; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if (otherVariant(l)) { if (implicitCount > 0 && !/^\w[\w ]*:\s/.test(l)) implicitCount--; continue; }
    if ((m = l.match(/^Item Level:\s*(\d+)/i))) { ilvl = m[1]; continue; }
    if ((m = l.match(/^Implicits:\s*(\d+)/i))) { implicitCount = Number(m[1]); continue; }
    if (/^(Armour|Evasion Rating|Energy Shield|Spirit|Runic Ward|Physical Damage|Attacks per Second|Critical Hit Chance|Block Chance):\s*[\d.]/i.test(l)) { props.push(l); continue; }
    if (/^Corrupted$/i.test(l)) { corrupted = true; continue; }
    if (META.test(l) && /:/.test(l)) continue;
    // mod line: strip PoB's {tags} and keep the ones that matter
    let tag = ''; let range = 0.5;
    let text = l.replace(/\{([^}]*)\}/g, (all, inner) => {
      const k = inner.split(':')[0].trim().toLowerCase();
      if (k === 'range') { const r = Number(inner.split(':')[1]); if (Number.isFinite(r)) range = r; }
      if (TAGS[k] && !tag) tag = TAGS[k];
      return '';
    }).trim();
    if (!text) continue;
    // PoB keeps a roll range plus where in it the item rolled: (30-40) at range 0.5 -> 35
    text = text.replace(/\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, (all, a, b) => {
      const lo = Number(a); const hi = Number(b);
      const v = lo + (hi - lo) * range;
      return String(Number.isInteger(lo) && Number.isInteger(hi) ? Math.round(v) : Math.round(v * 100) / 100);
    });
    // PoB counts runes and enchants among its "Implicits: N" lines (they come first)
    if (implicitCount > 0) {
      implicitCount--;
      if (tag === 'rune' || tag === 'enchant') { implicits.push(`${text} (${tag})`); continue; }
      implicits.push(`${text} (implicit)`);
      continue;
    }
    mods.push(tag && tag !== 'implicit' ? `${text} (${tag})` : text);
  }
  const itemClass = itemClassFor(slot, base);
  const blocks = [[`Item Class: ${itemClass}`, `Rarity: ${rarity}`, name, ...(base && base !== name ? [base] : [])].join('\n')];
  if (props.length) blocks.push(props.join('\n'));
  if (ilvl) blocks.push(`Item Level: ${ilvl}`);
  if (implicits.length) blocks.push(implicits.join('\n'));
  if (mods.length) blocks.push(mods.join('\n'));
  if (corrupted) blocks.push('Corrupted');
  return { text: blocks.join('\n--------\n'), hasBase: props.length > 0 };
}

function parsePob(xml) {
  xml = String(xml || '');
  // Path of Building 2 (PoE2) or Path of Building Community (PoE1); anything else would load as an
  // empty character and judge nothing
  const root = /<PathOfBuilding2[\s>]/.test(xml) ? 'PathOfBuilding2' : /<PathOfBuilding[\s>]/.test(xml) ? 'PathOfBuilding' : null;
  if (!root) throw new Error("That isn't a Path of Building build. In Path of Building, use Import/Export Build → Generate, then Copy.");
  if (!new RegExp(`</${root}>\\s*$`).test(xml)) throw new Error("That build looks cut off (the export code wasn't copied whole). Copy it again from Path of Building.");
  const items = {};
  for (const m of xml.matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/g)) {
    const id = attr(m[1], 'id');
    if (id) items[id] = m[2];
  }
  const itemsTag = (xml.match(/<Items\b[^>]*>/) || [''])[0];
  const activeSet = attr(itemsTag, 'activeItemSet');
  let setXml = xml; let setTag = '';
  if (activeSet) {
    // the id comes from the build file: escape it, so a crafted one can't hang the app
    const id = String(activeSet).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sm = xml.match(new RegExp(`(<ItemSet\\b[^>]*\\bid="${id}"[^>]*>)([\\s\\S]*?)<\\/ItemSet>`));
    if (sm) { setTag = sm[1]; setXml = sm[2]; }
  }
  // a build on weapon set II: Path of Building calculates with that set, so it's your Weapon and Offhand
  const swap = attr(setTag || itemsTag, 'useSecondWeaponSet') === 'true';
  const SWAP = { 'Weapon 1': 'Weapon 1 Swap', 'Weapon 2': 'Weapon 2 Swap', 'Weapon 1 Swap': 'Weapon 1', 'Weapon 2 Swap': 'Weapon 2' };
  const slots = {};
  for (const m of setXml.matchAll(/<Slot\b[^>]*>/g)) {
    const name = attr(m[0], 'name'); const itemId = attr(m[0], 'itemId');
    if (!name || !itemId || itemId === '0' || !items[itemId]) continue;
    const ours = SLOT_MAP[swap && SWAP[name] ? SWAP[name] : name];
    // PoE1 flasks aren't judged yet, and its five flask slots aren't PoE2's life and mana flask
    if (root === 'PathOfBuilding' && /^Flask \d/.test(name)) continue;
    if (ours) slots[ours] = items[itemId];
  }
  // jewels socketed in the passive tree
  // (only the active passive tree: PoB keeps alternate trees with their own jewels)
  let treeXml = xml;
  const treeTag = (xml.match(/<Tree\b[^>]*>/) || [''])[0];
  const activeSpec = Number(attr(treeTag, 'activeSpec')) || 1;
  const specs = [...xml.matchAll(/<Spec\b[^>]*>[\s\S]*?<\/Spec>/g)].map((x) => x[0]);
  if (specs.length) treeXml = specs[activeSpec - 1] || specs[0];
  let j = 1;
  for (const m of treeXml.matchAll(/<Socket\b[^>]*>/g)) {
    const itemId = attr(m[0], 'itemId');
    if (itemId && itemId !== '0' && items[itemId] && j <= JEWEL_MAX) slots[`Jewel ${j++}`] = items[itemId];
  }
  // resistances (PoB shows capped values + how far over the cap you are)
  const stats = {};
  for (const m of xml.matchAll(/<PlayerStat\b[^>]*>/g)) stats[attr(m[0], 'stat')] = Number(attr(m[0], 'value'));
  const res = {};
  for (const [k, el] of [['Fire', 'fire'], ['Cold', 'cold'], ['Lightning', 'lightning'], ['Chaos', 'chaos']]) {
    if (Number.isFinite(stats[`${k}Resist`])) res[el] = stats[`${k}Resist`] + (Number.isFinite(stats[`${k}ResistOverCap`]) ? stats[`${k}ResistOverCap`] : 0);
  }
  const buildTag = (xml.match(/<Build\b[^>]*>/) || [''])[0];
  const character = { level: attr(buildTag, 'level'), className: attr(buildTag, 'className'), ascendancy: attr(buildTag, 'ascendClassName') };
  const converted = {};
  let missingBase = 0;
  for (const [slot, raw] of Object.entries(slots)) {
    const c = convertItem(raw, slot);
    converted[slot] = c.text;
    if (!c.hasBase && ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Offhand', 'Weapon'].includes(slot)) missingBase++;
  }
  return { items: converted, resists: Object.keys(res).length ? res : null, character, missingBase };
}

// pobb.in links -> the raw code URL
function pobbinRawUrl(input) {
  const m = String(input || '').trim().match(/^https?:\/\/(?:www\.)?pobb\.in\/(?:u\/[^/]+\/)?([A-Za-z0-9_-]+)\/?$/);
  return m ? `https://pobb.in/${m[1]}/raw` : null;
}

// The main skill list on the Character page. A build can hold a skill twice, like your socketed gem and
// the copy an ascendancy passive grants, each with its own damage. Picking one sets it by name and slot,
// and Path of Building takes the first match (setMain in pob/server.lua), so a later copy with the same
// name and slot can't be reached: it's left out, and only the copy really in use is the selected one.
// list: [{ name, slot, main, ... }], pick: { name, slot } | null -> { list, pickIndex (-1: none) }
function mainSkillOptions(list, pick) {
  const out = []; const seen = new Map();
  for (const c of list || []) {
    const key = `${c.name}|${c.slot || ''}`;
    if (!seen.has(key)) { seen.set(key, out.length); out.push({ ...c }); } else if (c.main) out[seen.get(key)].main = true; // PoB's main skill still gets named
  }
  let pickIndex = -1;
  if (pick && pick.name) {
    pickIndex = out.findIndex((c) => c.name === pick.name && (!pick.slot || c.slot === pick.slot));
    if (pickIndex < 0) pickIndex = out.findIndex((c) => c.name === pick.name);
  }
  return { list: out, pickIndex };
}

module.exports = { decodeCode, parsePob, convertItem, pobbinRawUrl, SLOT_MAP, mainSkillOptions };
