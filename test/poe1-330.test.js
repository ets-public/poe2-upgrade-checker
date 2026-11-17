'use strict';

// PoE1 3.30 (Covens of Umbra) map changes that other overlays picked up after launch, done our way:
// Twice Corrupted, rare-only map mods, 9-mod corrupted maps, Delirious maps and Atlas Drops on the
// trade site. Fake stat lists in the trade site's shape (no network).

const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/trade');
const PQ = require('../src/core/pricequery');
const MC = require('../src/core/mapcheck');
const M330 = require('../src/core/maps330');
const RB = require('../src/core/regexbuild');
const RM = require('../src/core/regexmods');
const { parseItem } = require('../src/core/parser');
const all = (q) => q.body.query.stats.flatMap((g) => g.filters);
const P1 = { game: 'poe1' };

// a corrupted rare map with 9 mods, copied with Ctrl+Alt+C: 4 prefixes, 4 suffixes and a rare-only mod
const NINE = `Item Class: Maps
Rarity: Rare
Doom Mire
Academy Map
--------
Map Tier: 16
Atlas Drops: +112% (augmented)
Item Rarity: +64% (augmented)
Monster Pack Size: +38% (augmented)
--------
Item Level: 83
--------
{ Prefix Modifier "Antagonist's" (Tier: 1) }
Rare Monsters each have 2 additional Modifiers
{ Prefix Modifier "Fleet" (Tier: 1) }
30(30-35)% increased Monster Movement Speed
32(30-35)% increased Monster Attack Speed
{ Prefix Modifier "Savage" (Tier: 1) }
40(35-40)% increased Monster Damage
{ Prefix Modifier "Burning" (Tier: 1) }
Monsters deal 110(90-110)% extra Physical Damage as Fire
{ Suffix Modifier "of Stasis" (Tier: 1) }
Players cannot Regenerate Life, Mana or Energy Shield
{ Suffix Modifier "of Exposure" (Tier: 1) }
Players have -12(-12--9)% to all maximum Resistances
{ Suffix Modifier "of Toughness" (Tier: 1) }
Monsters take 40(36-40)% reduced Extra Damage from Critical Strikes
{ Suffix Modifier "of Congealment" (Tier: 1) }
Cannot Leech Life from Monsters
{ Rare-only Modifier "of the Mirage" }
Area contains a Mirage
--------
Twice Corrupted`;

test('3.30: Twice Corrupted is corrupted too, and a rare-only mod is a ninth mod', () => {
  const it = parseItem(NINE);
  assert.strictEqual(it.corrupted, true);
  assert.strictEqual(it.twiceCorrupted, true);
  assert.deepStrictEqual({ p: it.affixes.prefixes, s: it.affixes.suffixes, r: it.affixes.rareOnly }, { p: 4, s: 4, r: 1 });
  const ro = it.lines.find((l) => /Mirage/.test(l.text));
  assert.ok(ro && ro.rareOnly, 'the line under a { Rare-only } header is marked');
  // a plain Ctrl+C: no headers, the mod is known by its text
  const plain = parseItem(NINE.replace(/^\{.*\}\n/gm, '').replace(/\((-?\d+)-(-?\d+)\)/g, ''));
  assert.strictEqual(plain.twiceCorrupted, true);
  assert.deepStrictEqual(M330.rareOnlyMods(plain).map((x) => x.text), ['Area contains a Mirage']);
  // once corrupted stays once corrupted
  const once = parseItem(NINE.replace('Twice Corrupted', 'Corrupted'));
  assert.strictEqual(once.corrupted, true);
  assert.ok(!once.twiceCorrupted);
});

test('3.30: the map price check searches 9 mods, the rare-only mod, Atlas Drops and twice corrupted', () => {
  const it = parseItem(NINE);
  const statIndex = T.buildStatIndex({ result: [
    { id: 'pseudo', entries: [{ id: 'pseudo.pseudo_number_of_affix_mods', text: '# Modifiers', type: 'pseudo' }] },
    { id: 'explicit', entries: [{ id: 'explicit.stat_mirage', text: 'Area contains a Mirage', type: 'explicit' }] },
  ] });
  const filtersData = { result: [
    { id: 'map_filters', filters: [{ id: 'map_tier' }, { id: 'map_iiq' }, { id: 'map_bonus' }, { id: 'map_iir' }, { id: 'map_packsize' }] },
    { id: 'misc_filters', filters: [{ id: 'corrupted' }, { id: 'twice_corrupted' }] },
  ] };
  const q = PQ.buildMapPriceQuery(it, { ...P1, statIndex, filtersData, level: 0 });
  const f = q.body.query.filters;
  assert.deepStrictEqual(f.misc_filters.filters, { corrupted: { option: 'true' }, twice_corrupted: { option: 'true' } });
  assert.ok(f.map_filters.filters.map_bonus && !f.map_filters.filters.map_iiq, 'Atlas Drops under map_bonus');
  assert.ok(all(q).some((x) => x.id === 'pseudo.pseudo_number_of_affix_mods' && x.value.min === 9), '9 mods');
  assert.ok(all(q).some((x) => x.id === 'explicit.stat_mirage'), 'the rare-only mod is required');
  assert.ok(q.labels.includes('Area contains a Mirage'));
  assert.strictEqual(q.need, q.labels.length);
  // a once-corrupted map is kept apart from twice corrupted ones
  const once = parseItem(NINE.replace('Twice Corrupted', 'Corrupted'));
  const q2 = PQ.buildMapPriceQuery(once, { ...P1, statIndex, filtersData, level: 0 });
  assert.deepStrictEqual(q2.body.query.filters.misc_filters.filters.twice_corrupted, { option: 'false' });
  // a site without the filter: only corrupted, as before; a rare-only mod it doesn't know is said
  const q3 = PQ.buildMapPriceQuery(it, { ...P1, statIndex: T.buildStatIndex({ result: [] }), filtersData: { result: [filtersData.result[0]] }, level: 0 });
  assert.deepStrictEqual(Object.keys(q3.body.query.filters.misc_filters.filters), ['corrupted']);
  assert.ok((q3.unmatched || []).some((x) => /Area contains a Mirage \(not on the trade site's stat list\)/.test(x)), JSON.stringify(q3.unmatched));
});

test('3.30: twice corrupted gear is searched as twice corrupted when the site has the filter', () => {
  const ring = parseItem(`Item Class: Rings
Rarity: Rare
Doom Loop
Amethyst Ring
--------
Item Level: 84
--------
+17% to Chaos Resistance (implicit)
--------
+70 to maximum Life
+40% to Fire Resistance
--------
Twice Corrupted`);
  assert.ok(ring.corrupted && ring.twiceCorrupted);
  assert.deepStrictEqual(PQ.corruptionFilters(ring, { filtersData: { result: [{ id: 'misc_filters', filters: [{ id: 'twice_corrupted' }] }] } }), { corrupted: { option: 'true' }, twice_corrupted: { option: 'true' } });
  assert.deepStrictEqual(PQ.corruptionFilters({ corrupted: false }, { filtersData: { result: [{ id: 'misc_filters', filters: [{ id: 'twice_corrupted' }] }] } }), { corrupted: { option: 'false' } });
});

test('3.30: the map check shows rare-only mods, the Delirious rewards and the mod count', () => {
  const delirious = parseItem(`Item Class: Maps
Rarity: Rare
Dread Halls
Academy Map
--------
Map Tier: 16
Atlas Drops: +80% (augmented)
--------
Item Level: 83
--------
Players in Area are 60% Delirious
Delirium Reward Type: Currency
Area contains a Mirror of Delirium
Monsters have 30% increased Area of Effect`);
  const c = MC.check(delirious, null, {});
  const ro = c.rows.find((r) => /Mirror of Delirium/.test(r.text));
  assert.strictEqual(ro.cat, 'rareonly');
  assert.match(ro.note, /rare-only mod/);
  assert.strictEqual(c.rareOnly, 1);
  const dl = c.rows.find((r) => /Delirious/.test(r.text));
  assert.strictEqual(dl.cat, 'content');
  assert.match(dl.note, /3 more Currency rewards/);
  assert.ok(c.reward.includes('60% Delirious: +3 Currency rewards'), c.reward.join(' | '));
  assert.ok(!c.rows.some((r) => /Reward Type/.test(r.text)), 'the reward type line is not a mod');
  assert.ok(c.groups.some((g) => g.label === 'Rare-only (worth more)'));
  const nine = MC.check(parseItem(NINE), null, {});
  assert.strictEqual(nine.modCount, 9);
  assert.strictEqual(nine.twiceCorrupted, true);
  assert.deepStrictEqual(M330.delirium({ raw: 'Players in Area are 100% Delirious' }), { pct: 100, type: null, extra: 5 });
});

test('3.30: the search string builder has twice corrupted and the rare-only mods', () => {
  assert.ok(RB.FLAGS.poe1.some((f) => f.id === 'twice' && f.rx === 'twice corrupted'));
  const ro = RM.MAP_MODS.poe1['Rare-only (3.30)'];
  assert.strictEqual(ro.length, 9);
  for (const t of ro) assert.ok(M330.rareOnlyNote(t), t);
});
