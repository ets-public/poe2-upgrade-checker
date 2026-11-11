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
const { expand } = require('./parser');

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

// The pseudo stat ids here are the trade site's own; if it ever drops or renames one, a search that
// asks for it is rejected as a whole. So an id the loaded stat list lacks is not searched on, but
// only when the list has others of its kind (pseudo_total_..., pseudo_map_...): a list with none of
// that kind isn't the site's full list (a list that failed to load in part, or a test's few stats),
// and the id is used as before.
const pseudoIdSets = new WeakMap();
function pseudoMissing(id, statIndex) {
  if (!statIndex || !Array.isArray(statIndex.all) || !statIndex.all.length) return false;
  let ids = pseudoIdSets.get(statIndex);
  if (!ids) { ids = new Set(statIndex.all.filter((e) => /^pseudo\./.test(e.id || '')).map((e) => e.id)); pseudoIdSets.set(statIndex, ids); }
  if (ids.has(id)) return false;
  const kind = (String(id).match(/^pseudo\.pseudo_(?:total|increased|number_of|map)_/) || [])[0];
  return !!kind && [...ids].some((x) => x.startsWith(kind));
}

// ---------- PoE1 cluster jewels ----------
// A cluster jewel sells on its size, how many passives it adds, what its small passives grant (the
// enchant) and its notables, none of which are ordinary mods: searched as the base type, the passive
// count, the grant's option and one filter per notable, all matched by their text on the trade
// site's stat list. A plain or magic one without notables is a crafting base: its item level bracket
// decides which notables it can roll.
const CLUSTER_ILVL = [84, 75, 68, 50, 1];
const CLUSTER_LABELS = [
  'the same passives, small passive bonus and all its notables, listed in the last 3 days',
  'the same passives, small passive bonus and all its notables, listed in the last week',
  'the same passives and small passive bonus, one notable missing at most, listed in the last week',
  'the same passives and small passive bonus, any notables, listed in the last 2 weeks',
];
function clusterBase(item) {
  if (!item) return null;
  const m = String(`${item.baseType || ''} ${item.name || ''}`).match(/\b(Small|Medium|Large) Cluster Jewel\b/);
  if (m) return `${m[1]} Cluster Jewel`;
  const size = item.cluster && item.cluster.size;
  return size ? `${size.charAt(0).toUpperCase()}${size.slice(1)} Cluster Jewel` : null;
}
const isCluster = (item) => !!item && !isUnique(item) && (!!item.cluster || /^jewels$/i.test(String(item.itemClass || '').trim())) && !!clusterBase(item);
const optNorm = (t) => String(t || '').split(/\r?\n/).map((x) => x.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
// the enchant's small passive bonus: the "grant:" lines ("also grant:" lines are rolled mods)
function clusterGrant(item) {
  const out = [];
  for (const l of item.lines || []) {
    const m = String(l.text || '').replace(/\s*\(enchant\)\s*$/i, '').match(/^Added Small Passive Skills grant: (.+)$/i);
    if (m) out.push(m[1].trim());
  }
  return out;
}
// what a cluster jewel is searched and compared on, matched on the trade site's stat list
function clusterParts(item, statIndex) {
  const c = item.cluster || {};
  const skipped = [];
  let passives = null;
  if (c.passives > 0) {
    const m = trade.matchStat('Adds # Passive Skills', statIndex, { type: 'enchant' });
    if (m && m.kind === 'stat') passives = { id: m.id, value: c.passives };
    else skipped.push(`Adds ${c.passives} Passive Skills (not on the trade site)`);
  }
  let grant = null;
  const g = clusterGrant(item);
  if (g.length) {
    const m = trade.matchStat('Added Small Passive Skills grant: #', statIndex, { type: 'enchant' });
    // an option can be several lines ("...Axe Attacks...\n...Sword Attacks..."): the same lines, any order
    const want = optNorm(g.join('\n')).sort().join('\n');
    const opt = m && m.kind === 'stat' && (m.options || []).find((o) => o && o.id != null && optNorm(o.text).sort().join('\n') === want);
    if (opt) grant = { id: m.id, option: opt.id, label: g.join(' / ') };
    else skipped.push(`Small passives grant: ${g.join(' / ')} (${m && m.kind === 'stat' ? 'no such option on the trade site' : 'not on the trade site'})`);
  }
  const notables = [];
  for (const name of c.notables || []) {
    const m = trade.matchStat(`1 Added Passive Skill is ${name}`, statIndex, { type: 'explicit' });
    if (m && m.kind === 'stat') { if (!notables.some((x) => x.id === m.id)) notables.push({ id: m.id, name }); } else skipped.push(`${name} (notable not on the trade site)`);
  }
  return { base: clusterBase(item), passives, grant, notables, skipped };
}
// for comparables.js: the passive count (fewer small passives is the better jewel: more of them
// dilute the notables) and each notable
function clusterStats(item, opts) {
  const c = item.cluster || {};
  const stats = [];
  const p = clusterParts(item, opts.statIndex);
  if (c.passives > 0) stats.push({ id: p.passives ? p.passives.id : 'cluster.passives', value: c.passives, label: 'Passive skills', kind: 'cluster', fewer: true });
  for (const name of c.notables || []) {
    const n = p.notables.find((x) => x.name === name);
    const id = n ? n.id : `cluster.notable.${String(name).toLowerCase()}`;
    if (!stats.some((x) => x.id === id)) stats.push({ id, value: 1, label: name, kind: 'notable' });
  }
  return { stats, equip: [], skipped: p.skipped };
}
function clusterQueryAt(item, opts, lv) {
  const L = LEVELS[lv];
  const last = lv === LEVELS.length - 1;
  const p = clusterParts(item, opts.statIndex);
  const base = [];
  if (p.passives) base.push({ id: p.passives.id, value: { min: p.passives.value, max: p.passives.value }, disabled: false });
  if (p.grant) base.push({ id: p.grant.id, value: { option: p.grant.option }, disabled: false });
  const nf = last ? [] : p.notables.map((n) => ({ id: n.id, disabled: false }));
  // all its notables first (the closest searches), then one may be missing (never fewer than one)
  const nNeed = lv <= 1 || nf.length < 2 ? nf.length : nf.length - 1;
  const groups = [];
  if (nNeed === nf.length) { if (base.length + nf.length) groups.push({ type: 'and', filters: base.concat(nf) }); } else {
    if (base.length) groups.push({ type: 'and', filters: base });
    groups.push({ type: 'count', value: { min: nNeed }, filters: nf });
  }
  const qf = { type_filters: { filters: {} } };
  const cat = trade.categoryFor(item.itemClass || 'Jewels', opts.filtersData);
  if (cat) qf.type_filters.filters.category = { option: cat };
  const rar = String(item.rarity || '').toLowerCase();
  if (['rare', 'magic', 'normal'].includes(rar)) qf.type_filters.filters.rarity = { option: rar };
  qf.misc_filters = { filters: { corrupted: { option: item.corrupted ? 'true' : 'false' } } };
  const labels = [p.base];
  if (p.passives) labels.push(`${p.passives.value} passives`);
  if (p.grant) labels.push(p.grant.label);
  for (const f of nf) labels.push(p.notables.find((n) => n.id === f.id).name);
  // a crafting base (no notables yet): its item level bracket decides what it can roll
  if (['normal', 'magic'].includes(rar) && !(item.cluster && item.cluster.notables && item.cluster.notables.length) && item.itemLevel > 0) {
    const b = CLUSTER_ILVL.find((x) => item.itemLevel >= x);
    if (b) { qf.misc_filters.filters.ilvl = { min: b }; labels.push(`item level ${b}+`); }
  }
  qf.trade_filters = { filters: { indexed: { option: L.indexed } } };
  const query = { status: { option: 'available' }, type: p.base, stats: groups, filters: qf };
  return {
    body: { query, sort: { price: 'asc' } }, need: base.length + nNeed, total: base.length + p.notables.length, level: lv, levels: LEVELS.length,
    levelLabel: CLUSTER_LABELS[lv] || L.label, labels, skipped: p.skipped, drivers: false,
  };
}
function buildClusterQuery(item, opts, lv) {
  const q = clusterQueryAt(item, opts, lv);
  // a step that would search exactly as the one before it (no notables to leave out) is skipped
  if (lv > 0 && LEVELS[lv - 1].indexed === LEVELS[lv].indexed
    && JSON.stringify(clusterQueryAt(item, opts, lv - 1).body.query.stats) === JSON.stringify(q.body.query.stats)) return { skip: true, level: lv, levels: LEVELS.length, levelLabel: q.levelLabel, drivers: false };
  return q;
}

// PoE1 wands, sceptres, daggers and staves all have attack damage, but most are caster weapons sold
// on their spell mods: their DPS only counts when a mod adds to it
const POE1_CASTER_CLASS = /^(wands|sceptres|daggers|rune daggers|staves)$/i;
const POE1_PHYS_LOCAL = /^(#% increased Physical Damage|Adds # to # Physical Damage)$/i;
const POE1_ELE_LOCAL = /^Adds # to # (Fire|Cold|Lightning) Damage$/i;

// a PoE1 magic flask's base, from its name ("Alchemist's Quicksilver Flask of the Cheetah")
function poe1FlaskBase(item) {
  if (!item || item.baseType || !/flask/i.test(String(item.itemClass || ''))) return null;
  const n = String(item.name || '');
  const m = n.match(/\b(Quicksilver|Bismuth|Stibnite|Amethyst|Ruby|Sapphire|Topaz|Granite|Jade|Quartz|Sulphur|Basalt|Aquamarine|Silver|Diamond|Gold|Corundum|Iron) Flask\b/)
    || n.match(/\b(Small|Medium|Large|Greater|Grand|Giant|Colossal|Sacred|Hallowed|Sanctified|Divine|Eternal) (Life|Mana|Hybrid) Flask\b/);
  return m ? m[0] : null;
}

// the mods an item sells on: null without tiers (a plain copy); else the keys of its T1-T2 mods and
// of the mods without a tier in an advanced copy (special mods: desecrated, corrupted, essence...)
function driverKeys(item) {
  const lines = ((item && item.lines) || []).filter((l) => l.tag === 'explicit' && l.key);
  if (!lines.some((l) => l.tier != null)) return null;
  return new Set(lines.filter((l) => l.tier == null || l.tier <= 2).map((l) => l.key));
}

// the stats this item is priced on: [{ id, value, label, kind }]
function priceStats(item, opts = {}) {
  if (opts.game === 'poe1' && isCluster(item)) return clusterStats(item, opts);
  const sources = trade.statSources(item);
  const poe1 = opts.game === 'poe1';
  // PoE1: a fractured mod is its own stat on the trade site (fractured.*), not the explicit one
  const fracturedKeys = new Set();
  if (poe1) for (const l of item.lines || []) if (l.tag === 'fractured' && l.key && l.value != null) for (const [k] of expand(l.key, l.value)) fracturedKeys.add(k);
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
    // (a total the trade site's list doesn't have: the mod on its own, as any other)
    const p = PSEUDO.find((x) => x.re.test(s.key));
    if (p && !pseudoMissing(p.id, opts.statIndex)) { add(p.id, p.label, s.value); continue; }
    if (/^# to maximum Energy Shield$/i.test(s.key) && !local && !pseudoMissing(PSEUDO_ES.id, opts.statIndex)) { add(PSEUDO_ES.id, PSEUDO_ES.label, s.value); continue; }
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
    const m = trade.matchStat(s.key, opts.statIndex, { preferLocal: false, type: fracturedKeys.has(s.key) ? 'fractured' : 'explicit' }) || trade.matchStat(s.key, opts.statIndex, {});
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
  let pd = base['[Weapon] Physical DPS'] || 0; let ed = base['[Weapon] Elemental DPS'] || 0;
  if (poe1 && POE1_CASTER_CLASS.test(String(item.itemClass || '').trim())) {
    // a mod of its own (not the implicit, not a bench craft) that adds to the weapon's damage
    const own = (re) => sources.some((s) => s.source === 'mod' && re.test(s.key));
    if (!own(POE1_PHYS_LOCAL)) { if (pd > 0) skipped.push('Physical DPS (no physical damage mod: a caster weapon)'); pd = 0; }
    if (!own(POE1_ELE_LOCAL)) { if (ed > 0) skipped.push('Elemental DPS (no added elemental damage mod: a caster weapon)'); ed = 0; }
  }
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
  if (opts.game === 'poe1' && isCluster(item)) return buildClusterQuery(item, opts, lv);
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
  // PoE1: a magic flask has no base type line, and "any flask with these mods" isn't its market
  const flaskBase = opts.game === 'poe1' ? poe1FlaskBase(item) : null;
  if (flaskBase) query.type = flaskBase;
  return {
    body: { query, sort: { price: 'asc' } }, need, total: n, level: lv, levels: LEVELS.length, levelLabel: L.label, skipped, drivers: !!L.drivers,
    labels: stats.map((s) => s.label).concat(equip.map((e) => ({ ar: 'Armour', ev: 'Evasion', es: 'Energy Shield', spirit: 'Spirit', pdps: 'Physical DPS', edps: 'Elemental DPS' })[e.f])),
  };
}

// rare / magic gear and jewels get this search, and PoE1 cluster jewels of any rarity but unique
// (a plain one is a crafting base); uniques, gems, maps and the rest keep the old one
const usesPriceQuery = (item) => !!item && !isUnique(item) && (/^(rare|magic)$/i.test(item.rarity || '') || (/^normal$/i.test(item.rarity || '') && !!item.cluster && !!clusterBase(item)));

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
  poe1: [[/^(?:Item Quantity|Atlas Drops):\s*\+?(\d+)%/i, 'map_iiq', ['map_atlas_drops']], [/^Item Rarity:\s*\+?(\d+)%/i, 'map_iir'], [/^Monster Pack Size:\s*\+?(\d+)%/i, 'map_packsize']],
};
// PoE1 map numbers the trade site has as stats rather than map filters: an Originator map's "More
// Scarabs: +40%", and the kind of map quality ("Quality (Currency): +20%").
// 3.30 renamed two things on maps: Item Quantity became Atlas Drops and Scarabs became Threads. Both
// wordings are read. The third entry of a row is other ids the trade site may file the number under;
// mapId() below takes whichever one the site's own lists have, so a renamed id needs no app update.
const MAP_PSEUDO = {
  poe1: [[/^More Maps:\s*\+?(\d+)%/i, 'pseudo.pseudo_map_more_map_drops'], [/^More (?:Scarabs|Threads):\s*\+?(\d+)%/i, 'pseudo.pseudo_map_more_scarab_drops', ['pseudo.pseudo_map_more_thread_drops']],
    [/^More Currency:\s*\+?(\d+)%/i, 'pseudo.pseudo_map_more_currency_drops'], [/^More Divination Cards:\s*\+?(\d+)%/i, 'pseudo.pseudo_map_more_card_drops'],
    [/^Quality \(Rarity\):\s*\+?(\d+)%/i, 'pseudo.pseudo_map_quality_rarity'], [/^Quality \(Pack Size\):\s*\+?(\d+)%/i, 'pseudo.pseudo_map_quality_pack_size'],
    [/^Quality \(Divination Cards\):\s*\+?(\d+)%/i, 'pseudo.pseudo_map_quality_cards'], [/^Quality \((?:Scarabs|Threads)\):\s*\+?(\d+)%/i, 'pseudo.pseudo_map_quality_scarabs', ['pseudo.pseudo_map_quality_threads']],
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
  for (const [re, id, alt] of [...MAP_PROPS[game], ...MAP_PSEUDO[game]]) {
    const line = lines.find((x) => re.test(x));
    const v = line ? Number(line.match(re)[1]) : 0;
    if (v > 0) out.push({ id, alt: alt || [], value: v, label: line.replace(/\s*\(augmented\)/i, '').replace(/:.*$/, '') });
  }
  return out;
}
// the id to search a map number under: the one the trade site's own lists have (its stat list for a
// pseudo stat, its map filters for the others). null = the site has none of them, so it's left out
// of the search rather than sent as a filter the site would refuse. A list that isn't loaded (or a
// test's few entries) can't tell, and the usual id is used.
function mapId(x, opts) {
  const ids = [x.id, ...(x.alt || [])];
  if (/^pseudo\./.test(x.id)) {
    const all = opts.statIndex && Array.isArray(opts.statIndex.all) ? opts.statIndex.all : [];
    return ids.find((i) => all.some((e) => e.id === i)) || (pseudoMissing(x.id, opts.statIndex) ? null : x.id);
  }
  const group = ((opts.filtersData && opts.filtersData.result) || []).find((g) => g && g.id === 'map_filters');
  const known = ((group && group.filters) || []).map((f) => f && f.id).filter(Boolean);
  if (!known.length) return x.id;
  return ids.find((i) => known.includes(i)) || null;
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
  const noPseudo = []; // not searched: the trade site's stat list lacks its pseudo stat
  let need = 0; let total = 0;
  if (unique && item.name) { query.name = item.name; if (item.baseType && item.baseType !== item.name) query.type = item.baseType; }
  if (tablet) {
    const base = tabletBase(item);
    if (base && !unique) { query.type = base; labels.push(base); }
    const uses = (String(item.raw || '').match(/(\d+) uses? remaining/i) || [])[1];
    if (uses && pseudoMissing('pseudo.pseudo_number_of_uses_remaining', opts.statIndex)) noPseudo.push(`${uses} uses (not on the trade site's stat list)`);
    else if (uses) { query.stats.push({ type: 'and', filters: [{ id: 'pseudo.pseudo_number_of_uses_remaining', value: { min: Number(uses) }, disabled: false }] }); labels.push(`${uses} uses`); }
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
      if (n > 1 && pseudoMissing('pseudo.pseudo_number_of_affix_mods', opts.statIndex)) noPseudo.push(`${n} mods (not on the trade site's stat list)`);
      else if (n > 1) { query.stats.push({ type: 'and', filters: [{ id: 'pseudo.pseudo_number_of_affix_mods', value: { min: Math.max(1, n - L.count) }, disabled: false }] }); labels.push(`${n - L.count}+ mods`); }
      if (L.props) {
        const pf = [];
        for (const x0 of mapNumbers(item, game)) {
          const x = { ...x0, id: mapId(x0, opts) };
          if (!x.id) { noPseudo.push(`${x.label} ${x.value}% (not on the trade site's ${/^pseudo\./.test(x0.id) ? 'stat' : 'filter'} list)`); continue; }
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
  unmatched = noPseudo.concat(unmatched);
  return { body: { query, sort: { price: 'asc' } }, need, total, level: lv, levels: LV.length, levelLabel: L.label, labels, ...(unmatched.length ? { unmatched } : {}) };
}

module.exports = { buildPriceQuery, buildMapPriceQuery, mapStats, mapTier, isCluster, poe1FlaskBase, TABLET_LEVELS, priceStats, usesPriceQuery, usesMapPriceQuery, isTablet, LEVELS, MAP_LEVELS, ENOUGH, MIN, FILLER };
