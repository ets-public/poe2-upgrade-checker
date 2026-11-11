'use strict';

// PoE1 price checks: cluster jewels, caster weapons, fractured mods, magic flasks, tier 17 maps and
// the pseudo stat guard. Small fake stat lists in the trade site's shape (no network).

const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/trade');
const PQ = require('../src/core/pricequery');
const CMP = require('../src/core/comparables');
const { parseItem } = require('../src/core/parser');
const { listingToItem } = require('../src/core/listing');
const all = (q) => q.body.query.stats.flatMap((g) => g.filters);
const P1 = { game: 'poe1' };

const GRANT_OPTIONS = [
  { id: 1, text: '12% increased Physical Damage' },
  { id: 2, text: 'Axe Attacks deal 12% increased Damage with Hits and Ailments\nSword Attacks deal 12% increased Damage with Hits and Ailments' },
  { id: 3, text: '10% increased Fire Damage' },
  { id: 4, text: '12% increased Lightning Damage' },
];
const clusterIdx = T.buildStatIndex({ result: [
  { id: 'enchant', entries: [
    { id: 'enchant.stat_3086156145', text: 'Adds # Passive Skills', type: 'enchant' },
    { id: 'enchant.stat_3948993189', text: 'Added Small Passive Skills grant: #', type: 'enchant', option: { options: GRANT_OPTIONS } },
    { id: 'enchant.stat_4079888060', text: '# Added Passive Skills are Jewel Sockets', type: 'enchant' },
  ] },
  { id: 'explicit', entries: [
    { id: 'explicit.stat_furious', text: '1 Added Passive Skill is Furious Assault', type: 'explicit' },
    { id: 'explicit.stat_iron', text: '1 Added Passive Skill is Iron Breaker', type: 'explicit' },
    { id: 'explicit.stat_mtf', text: '1 Added Passive Skill is Master the Fundamentals', type: 'explicit' },
    { id: 'explicit.stat_feed', text: '1 Added Passive Skill is Feed the Fury', type: 'explicit' },
    { id: 'explicit.stat_int', text: '+# to Intelligence', type: 'explicit' },
  ] },
] });

const CLUSTER = `Item Class: Jewels
Rarity: Rare
Soul Cut
Large Cluster Jewel
--------
Requirements:
Level: 40
--------
Item Level: 81
--------
Adds 8 Passive Skills (enchant)
2 Added Passive Skills are Jewel Sockets (enchant)
Added Small Passive Skills grant: 12% increased Physical Damage (enchant)
--------
Added Small Passive Skills also grant: +3 to Intelligence
1 Added Passive Skill is Furious Assault
1 Added Passive Skill is Iron Breaker
1 Added Passive Skill is Master the Fundamentals
--------
Place into an allocated Large Jewel Socket on the Passive Skill Tree. Added passives do not interact with jewel radiuses. Right click to remove from the Socket.`;

const MAGIC_CLUSTER = `Item Class: Jewels
Rarity: Magic
Blunt Large Cluster Jewel of Potency
--------
Requirements:
Level: 54
--------
Item Level: 84
--------
Adds 8 Passive Skills (enchant)
2 Added Passive Skills are Jewel Sockets (enchant)
Added Small Passive Skills grant: 10% increased Fire Damage (enchant)
--------
Added Small Passive Skills also grant: +5 to Strength
--------
Place into an allocated Large Jewel Socket on the Passive Skill Tree. Added passives do not interact with jewel radiuses. Right click to remove from the Socket.`;

const NORMAL_CLUSTER = `Item Class: Jewels
Rarity: Normal
Medium Cluster Jewel
--------
Requirements:
Level: 54
--------
Item Level: 77
--------
Adds 4 Passive Skills (enchant)
1 Added Passive Skill is a Jewel Socket (enchant)
Added Small Passive Skills grant: Axe Attacks deal 12% increased Damage with Hits and Ailments (enchant)
Added Small Passive Skills grant: Sword Attacks deal 12% increased Damage with Hits and Ailments (enchant)
--------
Place into an allocated Medium or Large Jewel Socket on the Passive Skill Tree. Added passives do not interact with jewel radiuses. Right click to remove from the Socket.`;

test('poe1 cluster jewel (rare): base type, passive count, the grant option and every notable', () => {
  const item = parseItem(CLUSTER);
  assert.ok(PQ.usesPriceQuery(item));
  const q = PQ.buildPriceQuery(item, { ...P1, statIndex: clusterIdx, level: 0 });
  const query = q.body.query;
  assert.strictEqual(query.type, 'Large Cluster Jewel');
  assert.strictEqual(query.filters.type_filters.filters.category.option, 'jewel');
  assert.strictEqual(query.filters.type_filters.filters.rarity.option, 'rare');
  assert.strictEqual(query.filters.misc_filters.filters.corrupted.option, 'false');
  assert.ok(!query.filters.misc_filters.filters.ilvl); // a rare one sells on its notables, not its item level
  assert.deepStrictEqual(query.stats, [{ type: 'and', filters: [
    { id: 'enchant.stat_3086156145', value: { min: 8, max: 8 }, disabled: false },
    { id: 'enchant.stat_3948993189', value: { option: 1 }, disabled: false },
    { id: 'explicit.stat_furious', disabled: false },
    { id: 'explicit.stat_iron', disabled: false },
    { id: 'explicit.stat_mtf', disabled: false },
  ] }]);
  assert.strictEqual(q.need, 5);
  assert.strictEqual(q.total, 5);
  assert.strictEqual(q.drivers, false);
  assert.strictEqual(q.levels, PQ.LEVELS.length);
  assert.deepStrictEqual(q.skipped, []);
  assert.ok(q.labels.includes('Furious Assault') && q.labels.includes('8 passives'), q.labels.join());
  // ("also grant: +3 to Intelligence" is a rolled mod, not the enchant)
  assert.ok(!all(q).some((f) => f.id === 'explicit.stat_int'));
  // looser: all notables but a week; then one may be missing; then type, passives and grant only
  const qs = [1, 2, 3].map((level) => PQ.buildPriceQuery(item, { ...P1, statIndex: clusterIdx, level }));
  assert.ok(qs.every((x) => !x.skip && x.body.query.type === 'Large Cluster Jewel'));
  assert.deepStrictEqual(qs[0].body.query.stats, query.stats);
  assert.strictEqual(qs[0].body.query.filters.trade_filters.filters.indexed.option, '1week');
  const count = qs[1].body.query.stats.find((g) => g.type === 'count');
  assert.deepStrictEqual(count.value, { min: 2 });
  assert.strictEqual(count.filters.length, 3);
  assert.strictEqual(qs[1].need, 4);
  assert.deepStrictEqual(all(qs[2]).map((f) => f.id), ['enchant.stat_3086156145', 'enchant.stat_3948993189']);
  assert.strictEqual(qs[2].body.query.filters.trade_filters.filters.indexed.option, '2weeks');
  // PoE2 never builds this search (and the item has no stats: it is never "any rare jewel")
  for (const x of [q, ...qs]) assert.ok(all(x).length >= 2);
});

test('poe1 cluster jewel: two notables, the looser step still needs one', () => {
  const two = parseItem(CLUSTER.replace('1 Added Passive Skill is Master the Fundamentals\n', ''));
  const q = PQ.buildPriceQuery(two, { ...P1, statIndex: clusterIdx, level: 2 });
  assert.deepStrictEqual(q.body.query.stats.find((g) => g.type === 'count').value, { min: 1 });
});

test('poe1 cluster jewel (magic): detected from its name, item level bracket for a crafting base', () => {
  const item = parseItem(MAGIC_CLUSTER);
  assert.strictEqual(item.baseType, 'Large Cluster Jewel');
  assert.deepStrictEqual(item.cluster, { size: 'large', passives: 8, jewelSockets: 2, smallGrants: ['10% increased Fire Damage', '+5 to Strength'], notables: [] });
  assert.deepStrictEqual(item.stats, {});
  assert.ok(PQ.usesPriceQuery(item));
  const q = PQ.buildPriceQuery(item, { ...P1, statIndex: clusterIdx, level: 0 }).body.query;
  assert.strictEqual(q.type, 'Large Cluster Jewel');
  assert.strictEqual(q.filters.type_filters.filters.rarity.option, 'magic');
  assert.deepStrictEqual(q.filters.misc_filters.filters.ilvl, { min: 84 });
  assert.deepStrictEqual(q.stats, [{ type: 'and', filters: [
    { id: 'enchant.stat_3086156145', value: { min: 8, max: 8 }, disabled: false },
    { id: 'enchant.stat_3948993189', value: { option: 3 }, disabled: false },
  ] }]);
  // no notables to leave out: the step that would search the same again is skipped
  const l2 = PQ.buildPriceQuery(item, { ...P1, statIndex: clusterIdx, level: 2 });
  assert.strictEqual(l2.skip, true);
  assert.ok(!PQ.buildPriceQuery(item, { ...P1, statIndex: clusterIdx, level: 3 }).skip);
});

test('poe1 cluster jewel (normal): two-line grant matched to one option, item level 77 -> 75+', () => {
  const item = parseItem(NORMAL_CLUSTER);
  assert.strictEqual(item.baseType, 'Medium Cluster Jewel');
  assert.ok(item.cluster);
  assert.ok(PQ.usesPriceQuery(item));
  assert.ok(!PQ.usesPriceQuery(parseItem('Item Class: Jewels\nRarity: Normal\nCrimson Jewel\n--------\nItem Level: 80')));
  const q = PQ.buildPriceQuery(item, { ...P1, statIndex: clusterIdx, level: 0 }).body.query;
  assert.strictEqual(q.type, 'Medium Cluster Jewel');
  assert.strictEqual(q.filters.type_filters.filters.rarity.option, 'normal');
  assert.deepStrictEqual(q.filters.misc_filters.filters.ilvl, { min: 75 });
  assert.deepStrictEqual(all({ body: { query: q } }).find((f) => f.id === 'enchant.stat_3948993189').value, { option: 2 });
  assert.deepStrictEqual(all({ body: { query: q } }).find((f) => f.id === 'enchant.stat_3086156145').value, { min: 4, max: 4 });
});

test('poe1 cluster jewel: a stat list without the cluster stats still searches the base type', () => {
  const bare = T.buildStatIndex({ result: [{ id: 'explicit', entries: [{ id: 'explicit.stat_life', text: '+# to maximum Life', type: 'explicit' }] }] });
  const q = PQ.buildPriceQuery(parseItem(CLUSTER), { ...P1, statIndex: bare, level: 0 });
  assert.strictEqual(q.body.query.type, 'Large Cluster Jewel');
  assert.deepStrictEqual(q.body.query.stats, []);
  assert.strictEqual(q.skipped.length, 5, q.skipped.join('; '));
  assert.ok(q.skipped.some((x) => /Furious Assault/.test(x)) && q.skipped.some((x) => /grant/.test(x)) && q.skipped.some((x) => /Adds 8 Passive/.test(x)));
  // the grant stat without an option for this bonus: left out, said why
  const noOpt = T.buildStatIndex({ result: [{ id: 'enchant', entries: [{ id: 'enchant.stat_3948993189', text: 'Added Small Passive Skills grant: #', type: 'enchant', option: { options: [{ id: 9, text: '10% increased Cold Damage' }] } }] }] });
  const q2 = PQ.buildPriceQuery(parseItem(CLUSTER), { ...P1, statIndex: noOpt, level: 0 });
  assert.ok(q2.skipped.some((x) => /no such option/.test(x)), q2.skipped.join('; '));
  assert.strictEqual(q2.body.query.type, 'Large Cluster Jewel');
});

test('stat index keeps a stat option list', () => {
  const e = clusterIdx.all.find((x) => x.id === 'enchant.stat_3948993189');
  assert.deepStrictEqual(e.options, GRANT_OPTIONS);
  assert.strictEqual(clusterIdx.all.find((x) => x.id === 'explicit.stat_iron').options, undefined);
  assert.deepStrictEqual(Object.keys(clusterIdx.all.find((x) => x.id === 'explicit.stat_iron')).sort(), ['id', 'local', 'text', 'type']);
});

// a trade site listing of a cluster jewel, as listing.js reads it
function clusterListing(id, { passives = 8, notables, price = 10, account }) {
  const item = listingToItem({ item: {
    name: 'Brood Clasp', typeLine: 'Large Cluster Jewel', frameType: 2, ilvl: 84,
    enchantMods: [`Adds ${passives} Passive Skills`, '2 Added Passive Skills are Jewel Sockets', 'Added Small Passive Skills grant: 12% increased Physical Damage'],
    explicitMods: notables.map((n) => `1 Added Passive Skill is ${n}`),
  } }, 'Jewels');
  return { id, item, priceEx: price, account: account || id };
}

test('poe1 cluster jewel comparables: notables and passive count', () => {
  const ours = parseItem(CLUSTER);
  const opts = { ...P1, statIndex: clusterIdx };
  const same = ['Furious Assault', 'Iron Breaker', 'Master the Fundamentals'];
  const ls = [
    clusterListing('a', { notables: same }), clusterListing('b', { notables: same }), clusterListing('c', { notables: same }),
    clusterListing('d', { notables: ['Furious Assault', 'Iron Breaker', 'Feed the Fury'] }),
    clusterListing('e', { notables: same, passives: 12 }),
  ];
  assert.deepStrictEqual(ls[0].item.cluster.notables, same);
  const r = CMP.pick(ours, ls, opts, 3);
  assert.strictEqual(r.group, 'alike');
  assert.deepStrictEqual(r.listings.map((x) => x.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(ls[3].diff, { extra: ['Feed the Fury 1'], missing: ['Master the Fundamentals'] });
  assert.deepStrictEqual(ls[4].diff, { extra: [], missing: ['Passive skills 12 (yours 8)'] }); // more small passives: a worse jewel
  // fewer small passives than yours: the better jewel
  const ten = parseItem(CLUSTER.replace('Adds 8 Passive', 'Adds 10 Passive'));
  CMP.pick(ten, [ls[0]], opts, 3);
  assert.deepStrictEqual(ls[0].diff, { extra: ['Passive skills 8 (yours 10)'], missing: [] });
  // priceStats reports the same stats for comparables
  const s = PQ.priceStats(ours, opts).stats;
  assert.deepStrictEqual(s.map((x) => [x.id, x.value]), [['enchant.stat_3086156145', 8], ['explicit.stat_furious', 1], ['explicit.stat_iron', 1], ['explicit.stat_mtf', 1]]);
});

// ---------- caster weapons ----------
const weaponIdx = T.buildStatIndex({ result: [
  { id: 'pseudo', entries: [{ id: 'pseudo.pseudo_total_mana', text: '+# total maximum Mana', type: 'pseudo' }] },
  { id: 'explicit', entries: [
    { id: 'explicit.stat_minion_gems', text: '+# to Level of all Minion Skill Gems', type: 'explicit' },
    { id: 'explicit.stat_minion_dmg', text: 'Minions deal #% increased Damage', type: 'explicit' },
    { id: 'explicit.stat_minion_ms', text: 'Minions have #% increased Movement Speed', type: 'explicit' },
    { id: 'explicit.stat_phys_local', text: '#% increased Physical Damage (Local)', type: 'explicit' },
    { id: 'explicit.stat_as_local', text: '#% increased Attack Speed (Local)', type: 'explicit' },
    { id: 'explicit.stat_crit_multi', text: '+#% to Global Critical Strike Multiplier', type: 'explicit' },
  ] },
] });

const CASTER_WAND = `Item Class: Wands
Rarity: Rare
Doom Bite
Convoking Wand
--------
Wand
Quality: +20% (augmented)
Physical Damage: 29-54
Critical Strike Chance: 8.00%
Attacks per Second: 1.40
--------
Requirements:
Level: 72
Int: 242
--------
Item Level: 84
--------
Can roll Minion Modifiers (implicit)
--------
+1 to Level of all Minion Skill Gems
Minions deal 35% increased Damage
Minions have 20% increased Movement Speed
+60 to maximum Mana`;

const PHYS_SWORD = `Item Class: One Hand Swords
Rarity: Rare
Brood Edge
Jewelled Foil
--------
One Handed Sword
Quality: +20% (augmented)
Physical Damage: 70-130 (augmented)
Critical Strike Chance: 5.50%
Attacks per Second: 1.85 (augmented)
--------
Item Level: 84
--------
+25% to Global Critical Strike Multiplier (implicit)
--------
150% increased Physical Damage
14% increased Attack Speed
+60 to maximum Mana`;

test('poe1 caster wand: no DPS filter without a damage mod of its own; a physical sword keeps it', () => {
  const wand = parseItem(CASTER_WAND);
  const opts = { ...P1, statIndex: weaponIdx, preferLocal: true, level: 0 };
  const body = T.adaptQuery(PQ.buildPriceQuery(wand, opts).body, 'poe1');
  assert.ok(!body.query.filters.weapon_filters, JSON.stringify(body.query.filters));
  assert.ok(!body.query.filters.equipment_filters);
  assert.ok(all({ body }).some((f) => f.id === 'explicit.stat_minion_gems'));
  assert.ok(PQ.priceStats(wand, opts).skipped.some((x) => /Physical DPS.*caster/.test(x)));
  // PoE2 is as before
  assert.ok(PQ.buildPriceQuery(wand, { ...opts, game: 'poe2' }).body.query.filters.equipment_filters.filters.pdps);
  // a wand with a physical damage mod is an attack wand: its DPS counts
  const attackWand = parseItem(CASTER_WAND.replace('Minions deal 35% increased Damage', '120% increased Physical Damage'));
  const b2 = T.adaptQuery(PQ.buildPriceQuery(attackWand, opts).body, 'poe1');
  assert.ok(b2.query.filters.weapon_filters.filters.pdps.min > 0);
  // a physical sword: Physical DPS kept
  const sword = parseItem(PHYS_SWORD);
  const b3 = T.adaptQuery(PQ.buildPriceQuery(sword, opts).body, 'poe1');
  assert.ok(b3.query.filters.weapon_filters.filters.pdps.min > 0);
  // listings are compared the same way (comparables passes the same opts): no Physical DPS on the wand
  assert.ok(!CMP.statMap(wand, opts).has('equip.pdps'));
  assert.ok(CMP.statMap(sword, opts).has('equip.pdps'));
});

// ---------- fractured mods ----------
const FRACTURED_JEWEL = `Item Class: Jewels
Rarity: Rare
Entropy Shard
Crimson Jewel
--------
Item Level: 81
--------
20% increased Damage with Bleeding (fractured)
+12% to Global Critical Strike Multiplier
7% increased maximum Life
--------
Place into an allocated Jewel Socket on the Passive Skill Tree. Right click to remove from the Socket.`;

test('poe1 fractured mod: its own fractured stat in PoE1, the explicit one in PoE2', () => {
  const idx = T.buildStatIndex({ result: [
    { id: 'explicit', entries: [
      { id: 'explicit.stat_bleed', text: '#% increased Damage with Bleeding', type: 'explicit' },
      { id: 'explicit.stat_crit_multi', text: '+#% to Global Critical Strike Multiplier', type: 'explicit' },
      { id: 'explicit.stat_life_pct', text: '#% increased maximum Life', type: 'explicit' },
    ] },
    { id: 'fractured', entries: [
      { id: 'fractured.stat_bleed', text: '#% increased Damage with Bleeding', type: 'fractured' },
      { id: 'fractured.stat_life_pct', text: '#% increased maximum Life', type: 'fractured' },
    ] },
  ] });
  const item = parseItem(FRACTURED_JEWEL);
  const ids1 = PQ.priceStats(item, { ...P1, statIndex: idx }).stats.map((s) => s.id).sort();
  assert.deepStrictEqual(ids1, ['explicit.stat_crit_multi', 'explicit.stat_life_pct', 'fractured.stat_bleed']);
  const ids2 = PQ.priceStats(item, { game: 'poe2', statIndex: idx }).stats.map((s) => s.id).sort();
  assert.deepStrictEqual(ids2, ['explicit.stat_bleed', 'explicit.stat_crit_multi', 'explicit.stat_life_pct']);
  // no fractured version on the list: the explicit one
  const noFr = T.buildStatIndex({ result: [{ id: 'explicit', entries: [{ id: 'explicit.stat_bleed', text: '#% increased Damage with Bleeding', type: 'explicit' }] }] });
  assert.deepStrictEqual(PQ.priceStats(item, { ...P1, statIndex: noFr }).stats.map((s) => s.id), ['explicit.stat_bleed']);
  // and the item is searched as a fractured item
  assert.deepStrictEqual(PQ.buildPriceQuery(item, { ...P1, statIndex: idx }).body.query.filters.misc_filters.filters.fractured_item, { option: 'true' });
});

// ---------- flasks ----------
const QUICKSILVER = `Item Class: Utility Flasks
Rarity: Magic
Alchemist's Quicksilver Flask of the Cheetah
--------
Lasts 4.00 Seconds
Consumes 20 of 50 Charges on use
Currently has 50 Charges
40% increased Movement Speed
--------
Requirements:
Level: 4
--------
Item Level: 82
--------
25% increased effect
40% reduced Duration
14% increased Movement Speed during Flask effect
--------
Right click to drink. Can only hold charges while in belt. Refills as you kill monsters.`;

test('poe1 magic flask: searched as its base, from its name', () => {
  const item = parseItem(QUICKSILVER);
  assert.strictEqual(item.baseType, null);
  assert.strictEqual(PQ.buildPriceQuery(item, { ...P1, level: 0 }).body.query.type, 'Quicksilver Flask');
  assert.strictEqual(PQ.buildPriceQuery(item, { game: 'poe2', level: 0 }).body.query.type, undefined);
  const life = parseItem('Item Class: Life Flasks\nRarity: Magic\nBubbling Divine Life Flask of Staunching\n--------\nRecovers 1440 Life over 3.00 Seconds\nConsumes 15 of 45 Charges on use\nCurrently has 45 Charges\n--------\nItem Level: 84\n--------\n135% increased Recovery rate');
  assert.strictEqual(PQ.buildPriceQuery(life, { ...P1, level: 0 }).body.query.type, 'Divine Life Flask');
  // a rare/other item, or a flask with a base type line, is left as it was
  const ring = parseItem('Item Class: Rings\nRarity: Magic\nHale Gold Ring of the Whelpling\n--------\nItem Level: 80\n--------\n+40 to maximum Life');
  assert.strictEqual(PQ.buildPriceQuery(ring, { ...P1, level: 0 }).body.query.type, undefined);
});

// ---------- tier 17 maps ----------
const t17 = (base, name = 'Grim Halls') => `Item Class: Maps
Rarity: Rare
${name}
${base}
--------
Map Tier: 17
Item Quantity: +100% (augmented)
Item Rarity: +60% (augmented)
Monster Pack Size: +35% (augmented)
--------
Item Level: 84
--------
Monster Level: 84
--------
Monsters reflect 18% of Elemental Damage
Rare Monsters each have 2 additional Modifiers
Monsters are Hexproof
Monsters have 60% increased Critical Strike Chance
--------
Travel to this Map by using it in a personal Map Device. Maps can only be used once.`;

test('poe1 tier 17 map comparables: another base is a different map', () => {
  const ours = parseItem(t17('Fortress Map'));
  const L = (id, base) => ({ id, item: parseItem(t17(base, 'Other Name')), priceEx: 100, account: id });
  const ls = [L('a', 'Fortress Map'), L('b', 'Fortress Map'), L('c', 'Citadel Map'), L('d', 'Citadel Map'), L('e', 'Fortress Map')];
  const r = CMP.pick(ours, ls, { ...P1, kind: 'map' }, 3);
  assert.strictEqual(r.group, 'alike');
  assert.deepStrictEqual(r.listings.map((x) => x.id), ['a', 'b', 'e']);
  assert.deepStrictEqual(ls[2].diff.missing, ['different map (Citadel Map)']);
  // under tier 17 the base doesn't decide the price: not compared
  const t16 = (base) => parseItem(t17(base).replace('Map Tier: 17', 'Map Tier: 16'));
  const ls16 = [{ id: 'x', item: t16('Strand Map'), priceEx: 5, account: 'x' }];
  CMP.pick(t16('Tower Map'), ls16, { ...P1, kind: 'map' }, 3);
  assert.deepStrictEqual(ls16[0].diff.missing, []);
  // the search itself is by tier only
  assert.strictEqual(PQ.buildMapPriceQuery(ours, { ...P1, level: 0 }).body.query.type, undefined);
});

// ---------- the pseudo stat guard ----------
test('pseudo guard: a pseudo id the loaded list lacks (while it has others of its kind) is not searched', () => {
  const idx = T.buildStatIndex({ result: [
    { id: 'pseudo', entries: [
      { id: 'pseudo.pseudo_total_life', text: '+# total maximum Life', type: 'pseudo' },
      { id: 'pseudo.pseudo_total_elemental_resistance', text: '+#% total Elemental Resistance', type: 'pseudo' },
      { id: 'pseudo.pseudo_number_of_empty_prefix_mods', text: '# Empty Prefix Modifiers', type: 'pseudo' },
      { id: 'pseudo.pseudo_map_more_map_drops', text: 'More Maps: #%', type: 'pseudo' },
    ] },
    { id: 'explicit', entries: [
      { id: 'explicit.stat_str', text: '+# to Strength', type: 'explicit' },
      { id: 'explicit.stat_life', text: '+# to maximum Life', type: 'explicit' },
    ] },
  ] });
  const ring = parseItem('Item Class: Rings\nRarity: Rare\nDoom Loop\nGold Ring\n--------\nItem Level: 84\n--------\n+40 to Strength\n+70 to maximum Life');
  const ids = all(PQ.buildPriceQuery(ring, { ...P1, statIndex: idx, level: 0 })).map((f) => f.id).sort();
  // no total strength on the list: the strength mod itself; total life is there and used
  assert.deepStrictEqual(ids, ['explicit.stat_str', 'pseudo.pseudo_total_life']);
  // a map: no affix count and no scarab/currency filters (not on the list), said in unmatched
  const map = parseItem(`Item Class: Maps
Rarity: Rare
Grim Halls
Strand Map
--------
Map Tier: 16
Item Quantity: +80% (augmented)
More Scarabs: +40% (augmented)
--------
Item Level: 83
--------
Monsters reflect 18% of Elemental Damage
Monsters are Hexproof`);
  const q = PQ.buildMapPriceQuery(map, { ...P1, statIndex: idx, level: 0 });
  assert.deepStrictEqual(q.body.query.stats, []);
  assert.ok(q.unmatched.some((x) => /2 mods/.test(x)) && q.unmatched.some((x) => /More Scarabs/.test(x)), JSON.stringify(q.unmatched));
  assert.ok(!q.labels.some((x) => /mods|Scarabs/.test(x)), q.labels.join());
  assert.strictEqual(q.need, q.labels.length);
  // a list with no pseudo stats of that kind (a partial list): used as before
  const partial = T.buildStatIndex({ result: [{ id: 'explicit', entries: [{ id: 'explicit.stat_str', text: '+# to Strength', type: 'explicit' }] }] });
  const ids2 = PQ.buildMapPriceQuery(map, { ...P1, statIndex: partial, level: 0 }).body.query.stats.flatMap((g) => g.filters.map((f) => f.id));
  assert.deepStrictEqual(ids2, ['pseudo.pseudo_number_of_affix_mods', 'pseudo.pseudo_map_more_scarab_drops']);
});

// ---------- 3.30: Atlas Drops replaced Item Quantity on maps, Threads replaced Scarabs ----------
test('PoE1 3.30 map: Atlas Drops and More Threads are searched under whichever id the trade site has', () => {
  const map = parseItem(`Item Class: Maps
Rarity: Rare
Grim Halls
Strand Map
--------
Map Tier: 16
Atlas Drops: +80% (augmented)
Item Rarity: +40% (augmented)
More Threads: +40% (augmented)
--------
Item Level: 83
--------
Monsters reflect 18% of Elemental Damage
Monsters are Hexproof`);
  const idx = (ids) => T.buildStatIndex({ result: [{ id: 'pseudo', entries: ids.map((id) => ({ id, text: id, type: 'pseudo' })) }] });
  const filters = (ids) => ({ result: [{ id: 'map_filters', filters: ids.map((id) => ({ id })) }] });
  const run = (statIds, filterIds) => PQ.buildMapPriceQuery(map, { ...P1, statIndex: idx(statIds), filtersData: filterIds && filters(filterIds), level: 0 });
  const mapFilters = (q) => Object.keys((q.body.query.filters.map_filters || { filters: {} }).filters).sort();
  // the site kept its old ids
  let q = run(['pseudo.pseudo_number_of_affix_mods', 'pseudo.pseudo_map_more_scarab_drops'], ['map_tier', 'map_iiq', 'map_iir']);
  assert.ok(mapFilters(q).includes('map_iiq') && mapFilters(q).includes('map_iir'), mapFilters(q).join());
  assert.ok(all(q).some((f) => f.id === 'pseudo.pseudo_map_more_scarab_drops'));
  assert.ok(q.labels.some((x) => /Atlas Drops 80%/.test(x)) && q.labels.some((x) => /More Threads 40%/.test(x)), q.labels.join());
  // the site renamed them
  q = run(['pseudo.pseudo_number_of_affix_mods', 'pseudo.pseudo_map_more_thread_drops'], ['map_tier', 'map_atlas_drops', 'map_iir']);
  assert.ok(mapFilters(q).includes('map_atlas_drops') && !mapFilters(q).includes('map_iiq'), mapFilters(q).join());
  assert.ok(all(q).some((f) => f.id === 'pseudo.pseudo_map_more_thread_drops') && !all(q).some((f) => /scarab/.test(f.id)));
  // the site has neither: left out and said so, never sent as a filter it would refuse
  q = run(['pseudo.pseudo_number_of_affix_mods', 'pseudo.pseudo_map_more_map_drops'], ['map_tier', 'map_iir']);
  assert.ok(mapFilters(q).includes('map_iir') && !mapFilters(q).some((x) => /iiq|atlas/.test(x)), mapFilters(q).join());
  assert.ok(!all(q).some((f) => /scarab|thread/.test(f.id)));
  assert.ok(q.unmatched.some((x) => /Atlas Drops 80% \(not on the trade site's filter list\)/.test(x)) && q.unmatched.some((x) => /More Threads/.test(x)), JSON.stringify(q.unmatched));
  assert.strictEqual(q.need, q.labels.length);
  // no filter list loaded: the usual id
  q = run(['pseudo.pseudo_number_of_affix_mods', 'pseudo.pseudo_map_more_scarab_drops'], null);
  assert.ok(mapFilters(q).includes('map_iiq'));
});

test('PoE1 3.30: Threads and Soul Cores are looked up on poe.ninja, and an Item Tier line is not a mod', () => {
  const ninja = require('../src/core/ninja');
  assert.ok(ninja.EXCHANGE_TYPES.poe1.includes('Thread') && ninja.EXCHANGE_TYPES.poe1.includes('SoulCore'));
  const ring = parseItem('Item Class: Rings\nRarity: Rare\nDoom Loop\nSteel Ring\n--------\nItem Level: 84\nItem Tier: 3\n--------\n+70 to maximum Life');
  assert.ok(!ring.lines.some((l) => /Item Tier/.test(l.text)), JSON.stringify(ring.lines));
});
