'use strict';

// "What's it worth?" for rare and magic gear: a trade search for items that would sell like this one.
//
// The old search asked for every stat at your value or higher. Only items at least as good on every
// line match that, so the few listings it found were the dearest end of the market (an item priced
// at hundreds of divines when it sells for 20). This one searches the way players price an item, and
// the way PoE Overlay does:
//   - what buyers search for: total elemental resistance, chaos resistance, life, mana, attributes and
//     movement speed as the trade site's own totals; the item's Armour / Evasion / Energy Shield /
//     Spirit, or a weapon's physical and elemental DPS, instead of the mods that make them; then the
//     item's other mods, minus the filler nobody pays for (light radius, stun threshold, thorns...)
//   - a range around each value (90% to 140% at first), so much better items don't set the price
//   - recent listings only (up to 3 days, then a week, then 2 weeks), from sellers who are online:
//     items that have sat unsold for weeks are what didn't sell, not what things sell for
//   - looser in steps until there are enough listings to judge

const trade = require('./trade');

// three steps, each a search: how close the values must be, how many stats may be missing, and how
// recent the listings must be
const LEVELS = [
  { lo: 0.9, hi: 1.4, miss: (n) => (n >= 5 ? 1 : 0), indexed: '3days', label: 'similar values, listed in the last 3 days' },
  // what the item sells on, nothing else: its top-tier mods (T1-T2), the special ones that don't
  // normally roll on it (no tier: minion mods on a ring), key stats and big totals. Filler (a T6
  // evasion roll) and middling mods are left out, so the rings that share what makes yours valuable
  // are found instead of any ring with some of its stats (needs the advanced copy, with tiers)
  { drivers: true, lo: 0.85, hi: 2, indexed: '1week', label: 'the mods that make it valuable (top tiers and special mods), listed in the last week' },
  { lo: 0.8, hi: 1.8, miss: (n) => (n >= 2 ? 1 : 0), indexed: '1week', label: 'close values, listed in the last week' },
  { lo: 0.75, hi: 2.5, miss: (n) => (n >= 6 ? 2 : n >= 2 ? 1 : 0), indexed: '2weeks', label: 'the main stats, listed in the last 2 weeks' },
];
// the closest search with at least MIN listings is used; a looser one only when the closer ones have
// fewer (looser matches are different, usually cheaper, items). Under ENOUGH sellers the price says so.
const ENOUGH = 5;
const MIN = 3;

// totals the trade site adds up itself (mods and implicits together)
const PSEUDO = [
  { re: /^#% to (Fire|Cold|Lightning) Resistance$/i, id: 'pseudo.pseudo_total_elemental_resistance', label: 'Total elemental resistance' },
  { re: /^#% to Chaos Resistance$/i, id: 'pseudo.pseudo_total_chaos_resistance', label: 'Total chaos resistance' },
  { re: /^# to maximum Life$/i, id: 'pseudo.pseudo_total_life', label: 'Total life' },
  { re: /^# to maximum Mana$/i, id: 'pseudo.pseudo_total_mana', label: 'Total mana' },
  { re: /^# to Strength$/i, id: 'pseudo.pseudo_total_strength', label: 'Total strength' },
  { re: /^# to Dexterity$/i, id: 'pseudo.pseudo_total_dexterity', label: 'Total dexterity' },
  { re: /^# to Intelligence$/i, id: 'pseudo.pseudo_total_intelligence', label: 'Total intelligence' },
  { re: /^#% increased Movement Speed$/i, id: 'pseudo.pseudo_increased_movement_speed', label: 'Movement speed' },
];
// flat Energy Shield off armour (rings, amulets, belts, foci count it in the item's ES on armour)
const PSEUDO_ES = { id: 'pseudo.pseudo_total_energy_shield', label: 'Total energy shield' };
// small totals nobody prices on (a stray +8 strength)
const PSEUDO_MIN = {
  'pseudo.pseudo_total_elemental_resistance': 15, 'pseudo.pseudo_total_chaos_resistance': 7, 'pseudo.pseudo_total_life': 25, 'pseudo.pseudo_total_mana': 25,
  'pseudo.pseudo_total_strength': 15, 'pseudo.pseudo_total_dexterity': 15, 'pseudo.pseudo_total_intelligence': 15, 'pseudo.pseudo_total_energy_shield': 15,
};

// mods that rarely move a price: left out so they don't narrow the search
const FILLER = new RegExp([
  'Light Radius', 'Stun Threshold', 'Stun Recovery', 'Block Recovery', 'Thorns', 'Attribute Requirements', 'Accuracy Rating',
  'Life Regeneration', 'Mana Regeneration', 'Life per second', 'Mana per second', 'Life on Kill', 'Mana on Kill', 'gained on Kill',
  'when you Block', 'Ailment Threshold', 'Freeze Threshold', 'Duration of (Bleeding|Ignite|Poison|Chill|Freeze|Shock)',
  '(Bleeding|Poison|Ignite|Chill|Freeze|Shock) Duration on You', 'Critical (Hit|Strike) Chance against you', '\\bPin\\b', 'Knockback',
  'Charm Charges', 'Flask Charges', 'Flask Effect Duration', 'Rarity of Items', 'Gold', 'reflected',
].join('|'), 'i');

// stats that decide what kind of item it is: never the one a looser search leaves out
// (boots without movement speed, or an amulet without its +skill levels, are different items)
const KEY = /Movement Speed|Level of all .*Skills|Level of all .*Gems|\bSpirit\b|Physical DPS|Elemental DPS|Allies in your Presence deal/i;

const isUnique = (item) => /unique/i.test(item.rarity || '');

// the mods an item sells on: null without tiers (a plain copy); else the keys of its T1-T2 mods and
// of the mods without a tier in an advanced copy (special mods: desecrated, corrupted, essence...)
function driverKeys(item) {
  const lines = ((item && item.lines) || []).filter((l) => l.tag === 'explicit' && l.key);
  if (!lines.some((l) => l.tier != null)) return null;
  return new Set(lines.filter((l) => l.tier == null || l.tier <= 2).map((l) => l.key));
}

// the stats this item is priced on: [{ id, value, label, kind }]
function priceStats(item, opts = {}) {
  const sources = trade.statSources(item);
  const armourOrWeapon = !!opts.preferLocal;
  const totals = new Map();
  const mods = [];
  const skipped = []; // what the price isn't searched on, and why (for the log)
  const add = (id, label, v) => { const t = totals.get(id) || { id, label, value: 0 }; t.value += v; totals.set(id, t); };
  const base = {};
  for (const s of sources) {
    if (s.source === 'base') { base[s.key] = s.value; continue; }
    if (s.source === 'socket') { skipped.push(`${s.key} (socketed)`); continue; } // runes and soul cores: anyone can add them
    const local = trade.localFor(s.key, item.itemClass, armourOrWeapon);
    const p = PSEUDO.find((x) => x.re.test(s.key));
    if (p) { add(p.id, p.label, s.value); continue; }
    if (/^# to maximum Energy Shield$/i.test(s.key) && !local) { add(PSEUDO_ES.id, PSEUDO_ES.label, s.value); continue; }
    if (local) { skipped.push(`${s.key} (local: in the item's defences or DPS)`); continue; } // in the item's defences or DPS, searched as those
    if (s.source === 'implicit') { skipped.push(`${s.key} (implicit)`); continue; } // comes with the base
    if (FILLER.test(s.key)) { skipped.push(`${s.key} (filler)`); continue; }
    // a downside isn't what the item is priced on, but "40% reduced Freeze Duration on you" or
    // "reduced Mana Cost" (read as a negative "increased") is a real mod: kept when the trade site
    // has it in that wording (matchStat's invert)
    if (!(s.value > 0) || trade.LOWER_BETTER.test(s.key)) { if (s.value < 0) mods.push(s); else skipped.push(`${s.key} (lower is better)`); continue; }
    mods.push(s);
  }
  const stats = [];
  const drivers = driverKeys(item);
  for (const t of totals.values()) {
    // a total is something buyers price on when it's big (twice the least that counts)
    if (t.value >= (PSEUDO_MIN[t.id] || 1)) stats.push({ id: t.id, value: t.value, label: t.label, kind: 'pseudo', driver: !!drivers && t.value >= 2 * (PSEUDO_MIN[t.id] || 1) });
    else skipped.push(`${t.label} ${t.value} (under ${PSEUDO_MIN[t.id]}: too small to price on)`);
  }
  for (const s of mods) {
    const m = trade.matchStat(s.key, opts.statIndex, { preferLocal: false, type: 'explicit' }) || trade.matchStat(s.key, opts.statIndex, {});
    if (!m || m.kind !== 'stat') { skipped.push(`${s.key} (not on the trade site)`); continue; }
    const value = m.invert ? -s.value : s.value;
    if (!(value > 0)) { skipped.push(`${s.key} ${s.value} (a downside)`); continue; } // a downside, or a "reduced" mod the trade site counts as negative
    if (stats.some((x) => x.id === m.id)) continue;
    stats.push({ id: m.id, value, label: s.key, kind: 'mod', driver: !!drivers && (drivers.has(s.key) || KEY.test(s.key)) });
  }
  // the item's own numbers: defences on armour, DPS on weapons
  const equip = [];
  const defences = [['[Base] Armour', 'ar'], ['[Base] Evasion Rating', 'ev'], ['[Base] Energy Shield', 'es'], ['[Base] Spirit', 'spirit']];
  for (const [k, f] of defences) {
    const v = base[k] != null ? trade.baseWithoutSockets(k, base[k], sources) : 0;
    if (v > 0) equip.push({ f, value: v });
  }
  const pd = base['[Weapon] Physical DPS'] || 0; const ed = base['[Weapon] Elemental DPS'] || 0;
  if (pd + ed > 0) {
    if (pd >= 0.2 * (pd + ed)) equip.push({ f: 'pdps', value: pd });
    if (ed >= 0.2 * (pd + ed)) equip.push({ f: 'edps', value: ed });
  }
  return { stats, equip, skipped };
}

const round = (x) => (x >= 10 ? Math.floor(x) : Math.round(x * 10) / 10);

// the search at one level (0..2): { body, need, total, labels, level, levelLabel }
function buildPriceQuery(item, opts = {}) {
  const lv = Math.max(0, Math.min(LEVELS.length - 1, opts.level || 0));
  const L = LEVELS[lv];
  const all = priceStats(item, opts);
  const { equip, skipped } = all;
  let stats = all.stats;
  if (L.drivers) {
    // only worth a search of its own when it leaves something out and still has two things to go on
    // (or one key stat: a +2 melee skills amulet sells on that)
    const d = stats.filter((s) => s.driver);
    if ((d.length < 2 && !d.some((s) => KEY.test(s.label))) || d.length === stats.length) return { skip: true, level: lv, levels: LEVELS.length, levelLabel: L.label, drivers: true };
    stats = d;
  }
  const filters = stats.map((s) => {
    const value = { min: round(s.value * L.lo) };
    if (L.hi) value.max = Math.ceil(s.value * L.hi);
    if (s.value >= 1 && value.min < 1) value.min = 1;
    return { id: s.id, value, disabled: false };
  });
  // key stats must all be there; the rest go in a group where a few may be missing
  const keyF = filters.filter((f, i) => KEY.test(stats[i].label));
  const restF = filters.filter((f, i) => !KEY.test(stats[i].label));
  const n = filters.length;
  const r = restF.length;
  const restNeed = r ? (L.drivers ? r : Math.max(keyF.length ? 0 : 1, r - L.miss(n))) : 0;
  const need = keyF.length + restNeed;
  const qf = {};
  const cat = trade.categoryFor(item.itemClass, opts.filtersData);
  qf.type_filters = { filters: {} };
  if (cat) qf.type_filters.filters.category = { option: cat };
  const rar = String(item.rarity || '').toLowerCase();
  if (['rare', 'magic', 'normal'].includes(rar)) qf.type_filters.filters.rarity = { option: rar };
  if (equip.length) {
    const eq = {};
    // the item's defences / DPS decide most of an armour piece's or weapon's price: a range too
    for (const e of equip) { eq[e.f] = { min: Math.floor(e.value * Math.max(L.lo, 0.85)) }; if (L.hi) eq[e.f].max = Math.ceil(e.value * L.hi); }
    qf.equipment_filters = { filters: eq };
  }
  qf.misc_filters = { filters: { corrupted: { option: item.corrupted ? 'true' : 'false' } } };
  if (opts.game === 'poe1') {
    if (item.links >= 5) qf.socket_filters = { filters: { links: { min: item.links } } };
    for (const inf of item.influences || []) {
      const id = `${String(inf).toLowerCase()}_item`;
      if (/^(shaper|elder|crusader|redeemer|hunter|warlord)_item$/.test(id)) qf.misc_filters.filters[id] = { option: 'true' };
    }
    if (item.fractured) qf.misc_filters.filters.fractured_item = { option: 'true' };
    if (item.synthesised) qf.misc_filters.filters.synthesised_item = { option: 'true' };
  }
  qf.trade_filters = { filters: { indexed: { option: L.indexed } } };
  const groups = [];
  if (keyF.length) groups.push({ type: 'and', filters: keyF });
  if (r && restNeed > 0) groups.push({ type: 'count', value: { min: restNeed }, filters: restF });
  const query = { status: { option: 'available' }, stats: groups, filters: qf };
  return {
    body: { query, sort: { price: 'asc' } }, need, total: n, level: lv, levels: LEVELS.length, levelLabel: L.label, skipped, drivers: !!L.drivers,
    labels: stats.map((s) => s.label).concat(equip.map((e) => ({ ar: 'Armour', ev: 'Evasion', es: 'Energy Shield', spirit: 'Spirit', pdps: 'Physical DPS', edps: 'Elemental DPS' })[e.f])),
  };
}

// rare / magic gear and jewels get this search; uniques, gems, maps and the rest keep the old one
const usesPriceQuery = (item) => !!item && !isUnique(item) && /^(rare|magic)$/i.test(item.rarity || '');

// ---------- maps, waystones and precursor tablets ----------
// A waystone (or PoE1 map) sells on its tier, its numbers (item rarity, pack size, monster rarity,
// waystone drop chance...) and how many mods it has. The numbers come from its mods, so searching
// for its exact mods as well finds nothing (the Grim Course waystone: 0 listings, then a loose search
// of much weaker waystones priced it at 67 ex instead of ~6 div). So: the tier, the mod count and
// the numbers close to yours; then only the listings whose numbers are at least close to yours are
// priced on (comparables.js, mapStats below), and never listings weaker than yours.
// A tablet sells on its kind (Abyss, Breach, Ritual...), its uses left and its mods (they are the
// tablet): every mod is searched, all at close values first, then most, then half by name.
// Never below your numbers by much: a looser search on them only finds weaker, cheaper waystones
// (Barren Compass: 3,039 of them, priced at 224 ex instead of ~3 div). The steps widen the time
// listed and the mod count instead.
const MAP_LEVELS = [
  { lo: 0.9, hi: 1.5, props: true, count: 0, indexed: '3days', label: 'the same tier and mod count, numbers close to yours, listed in the last 3 days' },
  { lo: 0.9, hi: null, props: true, count: 0, indexed: '1week', label: 'the same tier and mod count, numbers at least 90% of yours, listed in the last week' },
  { lo: 0.9, hi: null, props: true, count: 1, indexed: '2weeks', label: 'the same tier, one mod fewer at most, numbers at least 90% of yours, listed in the last 2 weeks' },
  { lo: 0.85, hi: null, props: true, count: 1, indexed: '1month', label: 'the same tier, one mod fewer at most, numbers at least 85% of yours, listed in the last month' },
];
const TABLET_LEVELS = [
  { lo: 0.85, hi: 1.3, mods: (n) => n, values: true, indexed: '3days', label: 'the same kind, uses and mods at close values, listed in the last 3 days' },
  { lo: 0.7, hi: null, mods: (n) => n - Math.ceil(n / 3), values: true, indexed: '1week', label: 'the same kind and uses, most of the same mods, listed in the last week' },
  { lo: 0, hi: null, mods: (n) => Math.ceil(n / 2), values: false, indexed: '2weeks', label: 'the same kind and uses, half the same mods, listed in the last 2 weeks' },
  { lo: 0, hi: null, mods: () => 0, values: false, indexed: '2weeks', label: 'the same kind, listed in the last 2 weeks' },
];
// item text property -> trade map filter (PoE2 waystones, PoE1 maps). The PoE2 names are the ones
// on the item ("Monster Rarity: +55%"); the trade site files Monster Rarity under rare monsters and
// Monster Effectiveness under magic monsters
const MAP_PROPS = {
  poe2: [[/^Item Rarity:\s*\+?(\d+)%/i, 'map_iir'], [/^(?:Monster )?Pack Size:\s*\+?(\d+)%/i, 'map_packsize'], [/^Waystone Drop Chance:\s*\+?(\d+)%/i, 'map_bonus'],
    [/^Monster Rarity:\s*\+?(\d+)%/i, 'map_rare_monsters'], [/^Monster Effectiveness:\s*\+?(\d+)%/i, 'map_magic_monsters'],
    [/^(?:Waystone )?Gold(?: Found)?:\s*\+?(\d+)%/i, 'map_gold'], [/^(?:Waystone )?Experience(?: Gained)?:\s*\+?(\d+)%/i, 'map_experience']],
  poe1: [[/^Item Quantity:\s*\+?(\d+)%/i, 'map_iiq'], [/^Item Rarity:\s*\+?(\d+)%/i, 'map_iir'], [/^Monster Pack Size:\s*\+?(\d+)%/i, 'map_packsize']],
};
// PoE1 map numbers the trade site has as stats rather than map filters: an Originator map's "More
// Scarabs: +40%", and the kind of map quality ("Quality (Currency): +20%")
const MAP_PSEUDO = {
  poe1: [[/^More Maps:\s*\+?(\d+)%/i, 'pseudo.pseudo_map_more_map_drops'], [/^More Scarabs:\s*\+?(\d+)%/i, 'pseudo.pseudo_map_more_scarab_drops'],
    [/^More Currency:\s*\+?(\d+)%/i, 'pseudo.pseudo_map_more_currency_drops'], [/^More Divination Cards:\s*\+?(\d+)%/i, 'pseudo.pseudo_map_more_card_drops'],
    [/^Quality \(Rarity\):\s*\+?(\d+)%/i, 'pseudo.pseudo_map_quality_rarity'], [/^Quality \(Pack Size\):\s*\+?(\d+)%/i, 'pseudo.pseudo_map_quality_pack_size'],
    [/^Quality \(Divination Cards\):\s*\+?(\d+)%/i, 'pseudo.pseudo_map_quality_cards'], [/^Quality \(Scarabs\):\s*\+?(\d+)%/i, 'pseudo.pseudo_map_quality_scarabs'],
    [/^Quality \(Currency\):\s*\+?(\d+)%/i, 'pseudo.pseudo_map_quality_currency']],
  poe2: [],
};
const isTablet = (item) => !!item && /tablet/i.test(String(item.itemClass || ''));
const isMapLike = (item) => !!item && /^(maps|waystones)$/i.test(String(item.itemClass || '').trim());
const usesMapPriceQuery = (item) => isMapLike(item) || isTablet(item);

function mapTier(item) {
  const raw = String(item.raw || '');
  const m = raw.match(/^(?:Map|Waystone) Tier:\s*(\d+)/im) || String(item.baseType || item.name || '').match(/\(Tier (\d+)\)/i);
  return m ? Number(m[1]) : null;
}
// "Challenger's Expedition Tablet of Knowledge" -> "Expedition Tablet"
const tabletBase = (item) => { const m = `${item.baseType || ''} ${item.name || ''}`.match(/\b([A-Z][a-z]+) Tablet\b/); return m ? `${m[1]} Tablet` : null; };

// every mod on a waystone or tablet, as trade filters: [{ id, tv (the value the trade site counts,
// or null for a mod without one), label }], and the ones the trade site doesn't have
function mapMods(item, statIndex) {
  const out = []; const unmatched = [];
  for (const l of item.lines || []) {
    if (!['explicit', 'implicit', 'enchant', 'desecrated', 'fractured', 'crafted'].includes(l.tag)) continue;
    const key = l.key || l.kw;
    if (!key || /uses? remaining/i.test(key)) continue; // a tablet's uses: a filter of its own
    if (!l.key && /^(Adds .+ to a Map|Empowers the Map Boss of a Map)$/i.test(key)) continue; // a tablet's kind: its base type
    const want = l.tag === 'implicit' ? 'implicit' : 'explicit';
    const m = trade.matchStat(key, statIndex, { type: want }) || trade.matchStat(key, statIndex, {});
    if (!m || m.kind !== 'stat') { unmatched.push(key); continue; }
    if (out.some((x) => x.id === m.id)) continue;
    const v = typeof l.value === 'number' ? (m.invert ? -l.value : l.value) : null;
    out.push({ id: m.id, tv: v, label: key });
  }
  return { mods: out, unmatched };
}

// a waystone's or map's numbers, read from its text: { id: value } (map filter ids and the PoE1
// pseudo stats), and its mod count
function mapNumbers(item, game) {
  const lines = String(item.raw || item.listingText || '').split(/\r?\n/).map((x) => x.trim());
  const out = [];
  for (const [re, id] of [...MAP_PROPS[game], ...MAP_PSEUDO[game]]) {
    const line = lines.find((x) => re.test(x));
    const v = line ? Number(line.match(re)[1]) : 0;
    if (v > 0) out.push({ id, value: v, label: line.replace(/\s*\(augmented\)/i, '').replace(/:.*$/, '') });
  }
  return out;
}
// how many mods it has, as the trade site counts them: affixes, not lines (a hybrid affix has two
// lines; the Barren Compass waystone's 8 mods have 9 lines and was searched as "9+ mods")
function modCount(item) {
  if (item.affixCount != null) return item.affixCount; // a listing: from the trade site
  if (item.affixes && item.affixes.known) return item.affixes.prefixes + item.affixes.suffixes; // copied with Ctrl+Alt+C
  return (item.lines || []).filter((l) => l.tag === 'explicit' && (l.key || l.kw) && !/uses? remaining/i.test(l.key || l.kw || '')).length;
}
// for comparables.js: what a waystone or map is priced on, the same way for yours and each listing
function mapStats(item, opts = {}) {
  const game = opts.game === 'poe1' ? 'poe1' : 'poe2';
  const m = new Map();
  for (const x of mapNumbers(item, game)) m.set(x.id, { value: x.value, label: x.label });
  const n = modCount(item);
  if (n) m.set('mods', { value: n, label: 'Modifiers' });
  return m;
}

function buildMapPriceQuery(item, opts = {}) {
  const tablet = isTablet(item);
  const LV = tablet ? TABLET_LEVELS : MAP_LEVELS;
  const lv = Math.max(0, Math.min(LV.length - 1, opts.level || 0));
  const L = LV[lv];
  const game = opts.game === 'poe1' ? 'poe1' : 'poe2';
  const rar = String(item.rarity || '').toLowerCase();
  const unique = rar === 'unique';
  const qf = { type_filters: { filters: {} }, misc_filters: { filters: { corrupted: { option: item.corrupted ? 'true' : 'false' } } }, trade_filters: { filters: { indexed: { option: L.indexed } } } };
  const cat = tablet ? 'map.tablet' : game === 'poe2' ? 'map.waystone' : 'map';
  qf.type_filters.filters.category = { option: cat };
  if (['rare', 'magic', 'normal'].includes(rar)) qf.type_filters.filters.rarity = { option: rar };
  const query = { status: { option: 'available' }, stats: [], filters: qf };
  const labels = [];
  let unmatched = [];
  let need = 0; let total = 0;
  if (unique && item.name) { query.name = item.name; if (item.baseType && item.baseType !== item.name) query.type = item.baseType; }
  if (tablet) {
    const base = tabletBase(item);
    if (base && !unique) { query.type = base; labels.push(base); }
    const uses = (String(item.raw || '').match(/(\d+) uses? remaining/i) || [])[1];
    if (uses) { query.stats.push({ type: 'and', filters: [{ id: 'pseudo.pseudo_number_of_uses_remaining', value: { min: Number(uses) }, disabled: false }] }); labels.push(`${uses} uses`); }
    need = total = labels.length;
    // a tablet's mods are what it is: every one the trade site knows
    if (!unique) {
      const r = mapMods(item, opts.statIndex);
      unmatched = r.unmatched;
      const n = r.mods.length;
      total += n;
      const k = Math.max(0, Math.min(n, L.mods(n)));
      if (n && k) {
        const filters = r.mods.map((m) => {
          const f = { id: m.id, disabled: false };
          if (L.values && m.tv > 0) { f.value = { min: round(m.tv * L.lo) || 1 }; if (L.hi) f.value.max = Math.ceil(m.tv * L.hi); }
          return f;
        });
        query.stats.push(k === n ? { type: 'and', filters } : { type: 'count', value: { min: k }, filters });
        need += k;
      }
      for (const m of r.mods) labels.push(m.label);
    }
  } else {
    const tier = mapTier(item);
    const mfl = {};
    if (tier) { mfl.map_tier = { min: tier, max: tier }; labels.push(`tier ${tier}`); }
    // PoE1: a blighted or blight-ravaged map is its own market, and so is a plain one
    if (game === 'poe1' && !unique) {
      const b = `${item.baseType || ''} ${item.name || ''}`;
      const ravaged = /\bBlight-ravaged\b/i.test(b); const blighted = !ravaged && /\bBlighted\b/i.test(b);
      mfl.map_blighted = { option: blighted ? 'true' : 'false' };
      mfl.map_uberblighted = { option: ravaged ? 'true' : 'false' };
      if (blighted || ravaged) labels.push(ravaged ? 'blight-ravaged' : 'blighted');
    }
    if (!unique) {
      // how many mods (an 8-mod corrupted waystone is another item than a 6-mod one): at least
      // as many as yours, one fewer in the looser steps
      const n = modCount(item);
      if (n > 1) { query.stats.push({ type: 'and', filters: [{ id: 'pseudo.pseudo_number_of_affix_mods', value: { min: Math.max(1, n - L.count) }, disabled: false }] }); labels.push(`${n - L.count}+ mods`); }
      if (L.props) {
        const pf = [];
        for (const x of mapNumbers(item, game)) {
          const range = { min: Math.floor(x.value * L.lo) || 1 };
          if (L.hi) range.max = Math.ceil(x.value * L.hi);
          if (/^pseudo\./.test(x.id)) pf.push({ id: x.id, value: range, disabled: false }); else mfl[x.id] = range;
          labels.push(`${x.label} ${x.value}%`);
        }
        if (pf.length) query.stats.push({ type: 'and', filters: pf });
      }
    }
    if (Object.keys(mfl).length) qf.map_filters = { filters: mfl };
    need = total = labels.length;
    // its mods are in its numbers; they're logged, not searched
    if (!unique) { const r = mapMods(item, opts.statIndex); unmatched = r.unmatched; }
  }
  return { body: { query, sort: { price: 'asc' } }, need, total, level: lv, levels: LV.length, levelLabel: L.label, labels, ...(unmatched.length ? { unmatched } : {}) };
}

module.exports = { buildPriceQuery, buildMapPriceQuery, mapStats, TABLET_LEVELS, priceStats, usesPriceQuery, usesMapPriceQuery, isTablet, LEVELS, MAP_LEVELS, ENOUGH, MIN, FILLER };
