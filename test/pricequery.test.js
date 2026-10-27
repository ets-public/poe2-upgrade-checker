'use strict';

const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/trade');
const PQ = require('../src/core/pricequery');
const { parseItem } = require('../src/core/parser');
const all = (q) => q.body.query.stats.flatMap((g) => g.filters);

const idx = T.buildStatIndex({ result: [
  { id: 'pseudo', entries: [
    { id: 'pseudo.pseudo_total_elemental_resistance', text: '+#% total Elemental Resistance', type: 'pseudo' },
    { id: 'pseudo.pseudo_total_life', text: '+# total maximum Life', type: 'pseudo' },
  ] },
  { id: 'explicit', entries: [
    { id: 'explicit.stat_life', text: '+# to maximum Life', type: 'explicit' },
    { id: 'explicit.stat_fire', text: '+#% to Fire Resistance', type: 'explicit' },
    { id: 'explicit.stat_cold', text: '+#% to Cold Resistance', type: 'explicit' },
    { id: 'explicit.stat_light', text: '+#% to Lightning Resistance', type: 'explicit' },
    { id: 'explicit.stat_ms', text: '#% increased Movement Speed', type: 'explicit' },
    { id: 'explicit.stat_stun', text: '+# to Stun Threshold', type: 'explicit' },
    { id: 'explicit.stat_ev_local', text: '#% increased Evasion Rating (Local)', type: 'explicit' },
    { id: 'explicit.stat_spirit', text: '+# to Spirit', type: 'explicit' },
    { id: 'explicit.stat_skills', text: '+# to Level of all Minion Skills', type: 'explicit' },
  ] },
] });

const BOOTS = `Item Class: Boots
Rarity: Rare
Dread Track
Lizardscale Boots
--------
Evasion Rating: 412 (augmented)
--------
Requirements:
Level: 70
--------
Item Level: 81
--------
30% increased Movement Speed
+85 to maximum Life
+38% to Fire Resistance
+31% to Cold Resistance
+22% to Lightning Resistance
+120 to Stun Threshold
64% increased Evasion Rating`;

test('price query: totals buyers search, the item own defence, no filler, recent listings', () => {
  const item = parseItem(BOOTS);
  const q = PQ.buildPriceQuery(item, { statIndex: idx, preferLocal: true, level: 0 });
  const f = all(q);
  const ids = f.map((x) => x.id);
  assert.ok(ids.includes('pseudo.pseudo_total_elemental_resistance'), ids.join());
  const res = f.find((x) => x.id === 'pseudo.pseudo_total_elemental_resistance').value;
  assert.deepStrictEqual(res, { min: 81, max: 128 }); // 91 total: 90% to 140%
  assert.ok(ids.includes('pseudo.pseudo_total_life'));
  assert.ok(!ids.some((x) => /stun|ev_local|stat_fire|stat_cold/.test(x)), ids.join());
  assert.ok(q.body.query.filters.equipment_filters.filters.ev.min > 0);
  assert.strictEqual(q.body.query.filters.trade_filters.filters.indexed.option, '3days');
  assert.strictEqual(q.body.query.status.option, 'available');
  assert.strictEqual(q.body.query.filters.type_filters.filters.rarity.option, 'rare');
});

test('price query: each level is looser and older', () => {
  const item = parseItem(BOOTS);
  // (level 1, the search on the mods that make it valuable, needs tiers: a plain copy skips it)
  assert.strictEqual(PQ.buildPriceQuery(item, { statIndex: idx, preferLocal: true, level: 1 }).skip, true);
  const qs = [0, 2, 3].map((level) => PQ.buildPriceQuery(item, { statIndex: idx, preferLocal: true, level }));
  const lifeMin = qs.map((q) => all(q).find((x) => x.id === 'pseudo.pseudo_total_life').value.min);
  assert.ok(lifeMin[0] > lifeMin[1] && lifeMin[1] > lifeMin[2], lifeMin.join());
  assert.ok(all(qs[2]).every((x) => x.value.max >= x.value.min * 3)); // the last step: a wide range, never an open one
  // movement speed on boots is never the stat a looser search drops
  for (const q of qs) assert.deepStrictEqual(q.body.query.stats[0], { type: 'and', filters: [all(q).find((x) => x.id === 'pseudo.pseudo_increased_movement_speed')] });
  assert.deepStrictEqual(qs.map((q) => q.body.query.filters.trade_filters.filters.indexed.option), ['3days', '1week', '2weeks']);
});

test('price query: other mods stay, as ranges; uniques keep the old search', () => {
  const item = parseItem(`Item Class: Amulets
Rarity: Rare
Grim Charm
Gold Amulet
--------
Item Level: 82
--------
+2 to Level of all Minion Skills
+30 to Spirit
+12 to Stun Threshold`);
  const q = PQ.buildPriceQuery(item, { statIndex: idx, level: 0 });
  const f = all(q);
  assert.deepStrictEqual(f.map((x) => x.id).sort(), ['explicit.stat_skills', 'explicit.stat_spirit']);
  assert.deepStrictEqual(f.find((x) => x.id === 'explicit.stat_skills').value, { min: 1.8, max: 3 });
  assert.strictEqual(q.need, 2);
  assert.ok(PQ.usesPriceQuery(item));
  assert.ok(!PQ.usesPriceQuery({ rarity: 'Unique' }));
});

const WAYSTONE = `Item Class: Waystones
Rarity: Rare
Dire Solitude
Waystone (Tier 16)
--------
Waystone Tier: 16
Revives Available: 0
Item Rarity: +30% (augmented)
Pack Size: +26% (augmented)
Monster Rarity: +18% (augmented)
Waystone Drop Chance: +110% (augmented)
--------
Item Level: 81
--------
-7% maximum Player Resistances
Monsters deal 16% of Damage as Extra Cold
--------
Corrupted`;

test('waystone price: same tier, corruption and mod count, its numbers as ranges (its mods are in its numbers)', () => {
  const item = parseItem(WAYSTONE);
  assert.ok(PQ.usesMapPriceQuery(item));
  const q = PQ.buildMapPriceQuery(item, { game: 'poe2', level: 0 }).body.query;
  const f = q.filters;
  assert.strictEqual(f.type_filters.filters.category.option, 'map.waystone');
  assert.strictEqual(f.type_filters.filters.rarity.option, 'rare');
  assert.strictEqual(f.misc_filters.filters.corrupted.option, 'true');
  assert.deepStrictEqual(f.map_filters.filters.map_tier, { min: 16, max: 16 });
  assert.deepStrictEqual(f.map_filters.filters.map_iir, { min: 27, max: 45 });
  assert.deepStrictEqual(f.map_filters.filters.map_bonus, { min: 99, max: 165 });
  assert.ok(f.map_filters.filters.map_packsize && f.map_filters.filters.map_rare_monsters);
  assert.deepStrictEqual(q.stats, [{ type: 'and', filters: [{ id: 'pseudo.pseudo_number_of_affix_mods', value: { min: 2 }, disabled: false }] }]);
  // looser: longer ago and one mod fewer, never far under your numbers (85% at most)
  const q2 = PQ.buildMapPriceQuery(item, { game: 'poe2', level: 2 }).body.query;
  assert.deepStrictEqual(q2.filters.map_filters.filters.map_iir, { min: 27 });
  assert.strictEqual(q2.stats[0].filters[0].value.min, 1);
  const q3 = PQ.buildMapPriceQuery(item, { game: 'poe2', level: 3 }).body.query;
  assert.deepStrictEqual(q3.filters.map_filters.filters.map_iir, { min: 25 });
  assert.strictEqual(q3.filters.trade_filters.filters.indexed.option, '1month');
});

test('tablet price: its kind, uses left and mods', () => {
  const tidx = T.buildStatIndex({ result: [{ id: 'explicit', entries: [
    { id: 'explicit.stat_logbooks', text: '#% increased Quantity of Expedition Logbooks dropped by Runic Monsters in Map', type: 'explicit' },
    { id: 'explicit.stat_eff', text: 'Monsters have #% increased Effectiveness', type: 'explicit' },
  ] }] });
  const item = parseItem(`Item Class: Tablet
Rarity: Magic
Challenger's Expedition Tablet of Knowledge
--------
Item Level: 65
--------
Adds a Kalguuran Expedition to a Map (implicit)
10 uses remaining (implicit)
--------
24% increased Quantity of Expedition Logbooks dropped by Runic Monsters in Map
Monsters have 14% increased Effectiveness`);
  assert.ok(PQ.usesMapPriceQuery(item) && PQ.isTablet(item));
  const q = PQ.buildMapPriceQuery(item, { game: 'poe2', statIndex: tidx, level: 0 }).body.query;
  assert.strictEqual(q.type, 'Expedition Tablet');
  assert.strictEqual(q.filters.type_filters.filters.category.option, 'map.tablet');
  assert.deepStrictEqual(q.stats[0], { type: 'and', filters: [{ id: 'pseudo.pseudo_number_of_uses_remaining', value: { min: 10 }, disabled: false }] });
  assert.deepStrictEqual(q.stats[1].filters.map((x) => x.id), ['explicit.stat_logbooks', 'explicit.stat_eff']);
});

test('price query: level 1 searches only the mods that make it valuable (top tiers and special mods)', () => {
  const ix = T.buildStatIndex({ result: [{ id: 'explicit', entries: [
    { id: 'explicit.minion_dmg', text: 'Minions deal #% increased Damage', type: 'explicit' },
    { id: 'explicit.minion_life', text: 'Minions have #% increased maximum Life', type: 'explicit' },
    { id: 'explicit.evasion', text: '+# to Evasion Rating', type: 'explicit' },
    { id: 'explicit.mana_regen', text: '#% increased Mana Regeneration Rate', type: 'explicit' },
    { id: 'explicit.stat_light', text: '+#% to Lightning Resistance', type: 'explicit' },
  ] }, { id: 'pseudo', entries: [{ id: 'pseudo.pseudo_total_elemental_resistance', text: '+#% total Elemental Resistance', type: 'pseudo' }] }] });
  // Adam's Chimeric Hold, as the advanced copy gives it
  const ring = parseItem(`Item Class: Rings
Rarity: Rare
Chimeric Hold
Ruby Ring
--------
Item Level: 81
--------
{ Implicit Modifier }
+25(20-30)% to Fire Resistance
--------
{ Prefix Modifier "Manipulator's" }
Minions deal 26(25-27)% increased Damage
{ Prefix Modifier "Fleet" (Tier: 6) }
+67(52-79) to Evasion Rating
{ Prefix Modifier "Bolstering" }
Minions have 25(23-26)% increased maximum Life
{ Suffix Modifier "of the Lightning" (Tier: 2) }
+36(36-40)% to Lightning Resistance
{ Suffix Modifier "of Bliss" (Tier: 3) }
43(40-49)% increased Mana Regeneration Rate
--------
Corrupted`);
  const q = PQ.buildPriceQuery(ring, { statIndex: ix, level: 1 });
  assert.ok(!q.skip);
  const ids = all(q).map((f) => f.id).sort();
  // minion damage and life (no tier: they don't roll on rings), the 61% total resistance; not the T6 evasion
  assert.deepStrictEqual(ids, ['explicit.minion_dmg', 'explicit.minion_life', 'pseudo.pseudo_total_elemental_resistance']);
  assert.ok(q.body.query.stats.every((g) => g.type === 'and' || g.value.min === g.filters.length)); // all of them
  assert.strictEqual(q.body.query.filters.trade_filters.filters.indexed.option, '1week');
});
