'use strict';

// The price check's accuracy: each test is a market shape the trade site really shows.
const test = require('node:test');
const assert = require('node:assert');
const { parseItem } = require('../src/core/parser');
const trade = require('../src/core/trade');
const comparables = require('../src/core/comparables');
const { priceStats } = require('../src/core/price');

const statIndex = trade.buildStatIndex({ result: [{ id: 'explicit', entries: [
  { id: 'explicit.stat_3032590688', text: 'Adds # to # Physical Damage to Attacks', type: 'explicit' },
  { id: 'explicit.stat_681332047', text: '#% increased Attack Speed', type: 'explicit' },
  { id: 'explicit.stat_3291658075', text: '#% increased Cold Damage', type: 'explicit' },
  { id: 'explicit.stat_3299347043', text: '# to maximum Life', type: 'explicit' },
] }] });
const NOW = Date.parse('2026-10-27T12:00:00Z');
const ring = (mods) => parseItem(`Item Class: Rings\nRarity: Rare\nX\nPrismatic Ring\n--------\nItem Level: 82\n--------\n+9% to all Elemental Resistances (implicit)\n--------\n${mods.join('\n')}`);
// Adam's Rapture Circle: 60 total res, 17 str, T1 added physical, and little else that sells
const RAPTURE = ring(['+12 to maximum Life', 'Adds 18 to 30 Physical Damage to Attacks', '+17 to Strength', '16.1 Life Regeneration per second', '+11% to all Elemental Resistances']);
let n = 0;
const L = (ex, item) => ({ id: 'l' + (++n), account: 'a' + n, price: { amount: ex, currency: 'exalted' }, priceEx: ex, indexed: '2026-10-26T12:00:00Z', item });

test('price: listings with more than your item are left out of its price', () => {
  const alike = [L(40, ring(['Adds 17 to 29 Physical Damage to Attacks', '+18 to Strength', '+12% to all Elemental Resistances'])),
    L(55, ring(['Adds 18 to 31 Physical Damage to Attacks', '+16 to Strength', '+10% to all Elemental Resistances', '+15 to maximum Life'])),
    L(70, ring(['Adds 19 to 30 Physical Damage to Attacks', '+17 to Strength', '+11% to all Elemental Resistances', '10 Life Regeneration per second']))];
  const better = Array.from({ length: 12 }, (_, i) => L(1400 + i * 250, ring(['Adds 18 to 30 Physical Damage to Attacks', '+17 to Strength', '+11% to all Elemental Resistances', '+85 to maximum Life', '14% increased Attack Speed'])));
  const all = [...alike, ...better];
  // without it the cheapest five sellers include two of the better rings
  assert.ok(priceStats(all, { now: NOW }).highEx > 1000);
  const g = comparables.pick(RAPTURE, all, { statIndex }, 3);
  assert.strictEqual(g.group, 'alike');
  assert.strictEqual(g.listings.length, 3);
  assert.ok(priceStats(g.listings, { now: NOW }).typicalEx < 100);
  assert.ok(better[0].diff.extra.some((x) => /life/i.test(x)), JSON.stringify(better[0].diff));
});

test('price: too few alike, then close, then everything (and it says so)', () => {
  const close = [L(100, ring(['Adds 18 to 30 Physical Damage to Attacks', '+17 to Strength', '+11% to all Elemental Resistances', '20% increased Cold Damage'])),
    L(120, ring(['Adds 18 to 30 Physical Damage to Attacks', '+17 to Strength', '+11% to all Elemental Resistances', '21% increased Cold Damage'])),
    L(150, ring(['Adds 18 to 30 Physical Damage to Attacks', '+17 to Strength', '+11% to all Elemental Resistances', '22% increased Cold Damage']))];
  assert.strictEqual(comparables.pick(RAPTURE, close, { statIndex }, 3).group, 'close');
  const far = close.map((x) => L(x.priceEx, ring(['Adds 18 to 30 Physical Damage to Attacks', '+17 to Strength', '+11% to all Elemental Resistances', '+90 to maximum Life', '22% increased Cold Damage'])));
  assert.strictEqual(comparables.pick(RAPTURE, far, { statIndex }, 3).group, 'all');
});

test('price: a stat well above yours counts as more; one well under as missing', () => {
  const big = L(500, ring(['Adds 30 to 50 Physical Damage to Attacks', '+17 to Strength', '+11% to all Elemental Resistances']));
  const small = L(20, ring(['Adds 5 to 9 Physical Damage to Attacks', '+17 to Strength', '+11% to all Elemental Resistances']));
  comparables.pick(RAPTURE, [big, small], { statIndex }, 3);
  assert.ok(big.diff.extra.length === 1 && !big.diff.missing.length, JSON.stringify(big.diff));
  assert.ok(small.diff.missing.length === 1 && !small.diff.extra.length, JSON.stringify(small.diff));
});

test('waystone: priced on listings with numbers at least close to yours (the Grim Course case)', () => {
  const pq = require('../src/core/pricequery');
  const way = (p, mods, extra = '') => parseItem(`Item Class: Waystones\nRarity: Rare\nX\nWaystone (Tier 15)\n--------\nWaystone Tier: 15\nItem Rarity: +${p[0]}%\nPack Size: +${p[1]}%\nMonster Rarity: +${p[2]}%\nMonster Effectiveness: +${p[3]}%\nWaystone Drop Chance: +${p[4]}%\n--------\nItem Level: 81\n--------\n${Array.from({ length: mods }, (_, i) => `Monsters have ${90 + i}% increased Stun Buildup`).join('\n')}${extra}\n--------\nCorrupted`);
  const GRIM = way([12, 18, 78, 13, 120], 8);
  assert.strictEqual(pq.mapStats(GRIM, { game: 'poe2' }).get('mods').value, 8);
  // four cheap waystones with much weaker numbers, then the real market at 4-11 div
  const weak = [[8, 12, 54, 9, 84], [9, 13, 60, 10, 90], [10, 14, 58, 9, 86], [8, 12, 55, 9, 85]].map((p) => L(67, way(p, 8)));
  const real = [[12, 18, 80, 13, 122], [13, 19, 79, 14, 125], [12, 18, 82, 13, 120], [14, 20, 85, 15, 130], [12, 19, 78, 13, 121]].map((p, i) => L([2800, 3400, 4600, 5200, 7300][i], way(p, 8)));
  const all = [...weak, ...real];
  assert.strictEqual(priceStats(all, { now: NOW }).typicalEx, 67); // what it said before
  const g = comparables.pick(GRIM, all, { kind: 'map', game: 'poe2' }, 3);
  assert.strictEqual(g.group, 'alike');
  assert.strictEqual(priceStats(g.listings, { now: NOW }).typicalEx, 4600);
  assert.ok(weak[0].diff.missing.length >= 4, JSON.stringify(weak[0].diff));
});

test('waystone: mods are counted as affixes, not lines (the Barren Compass case)', () => {
  const pq = require('../src/core/pricequery');
  const listing = require('../src/core/listing');
  // a hybrid prefix: one mod, two lines
  const ours = parseItem('Item Class: Waystones\nRarity: Rare\nBarren Compass\nWaystone (Tier 15)\n--------\nItem Rarity: +30% (augmented)\n--------\nItem Level: 82\n--------\n{ Prefix Modifier "Destructive" (Tier: 1) }\nMonsters have 222(200-240)% increased Critical Hit Chance\nMonsters have +24(21-25)% Critical Damage Bonus\n{ Suffix Modifier "of Exposure" (Tier: 1) }\n-7(-8--6)% maximum Player Resistances\n--------\nCorrupted');
  assert.strictEqual(pq.mapStats(ours, { game: 'poe2' }).get('mods').value, 2);
  assert.strictEqual(pq.buildMapPriceQuery(ours, { game: 'poe2' }).body.query.stats[0].filters[0].value.min, 2);
  // a listing: the trade site names each line's affix
  const it = listing.listingToItem({ item: { rarity: 'Rare', typeLine: 'Waystone (Tier 15)', name: 'X', corrupted: true,
    explicitMods: [{ description: 'Monsters have 222% increased Critical Hit Chance', mods: [{ name: 'Destructive', tier: 'P1' }] },
      { description: 'Monsters have +24% Critical Damage Bonus', mods: [{ name: 'Destructive', tier: 'P1' }] },
      { description: '-7% maximum Player Resistances', mods: [{ name: 'of Exposure', tier: 'S1' }] }] } }, 'Waystones');
  assert.strictEqual(it.affixCount, 2);
});

test('waystone: never priced on weaker waystones', () => {
  const way = (p) => parseItem(`Item Class: Waystones\nRarity: Rare\nX\nWaystone (Tier 15)\n--------\nItem Rarity: +${p[0]}%\nPack Size: +${p[1]}%\nWaystone Drop Chance: +${p[2]}%\n--------\nItem Level: 81\n--------\nMonsters are Armoured\n--------\nCorrupted`);
  const ours = way([30, 28, 140]);
  const weaker = [[26, 23, 100], [25, 24, 115], [24, 22, 110], [22, 21, 105], [26, 25, 120]].map((p, i) => L([67, 67, 203, 224, 244][i], way(p)));
  assert.strictEqual(comparables.pick(ours, weaker, { kind: 'map', game: 'poe2' }, 3).group, 'weaker');
  const better = [[31, 30, 150], [35, 29, 145], [32, 31, 160]].map((p, i) => L([2000, 2500, 3000][i], way(p)));
  const g = comparables.pick(ours, [...weaker, ...better], { kind: 'map', game: 'poe2' }, 3);
  assert.ok(['alike', 'better'].includes(g.group), g.group);
  assert.ok(priceStats(g.listings, { now: NOW }).typicalEx >= 2000);
});

test('price: loose matches far apart give a range, not one made-up number (the Chimeric Hold case)', () => {
  const { tooWide } = require('../src/core/price');
  // rings found only on some of your stats, asking 60 div to 400 div: no one price
  const wide = priceStats([3290, 39474, 131580, 219081, 263160].map((ex) => L(ex)), { now: NOW }); // its listings, yours left out
  assert.strictEqual(tooWide(wide), true);
  // loose matches that agree (2x apart) still give a price
  assert.strictEqual(tooWide(priceStats([335, 400, 520, 684].map((ex) => L(ex)), { now: NOW })), false);
});
