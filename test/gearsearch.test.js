'use strict';

const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/core/trade');
const { parseItem } = require('../src/core/parser');
const gear = require('../src/core/gearscore');

test('gear search sizes shrink step by step and end in the count-only search a logged-out trade site accepts', () => {
  const texts = ['Minions deal #% increased Damage', '# to maximum Energy Shield', '# to maximum Life', '# to maximum Mana', '#% to Fire Resistance', '#% to Cold Resistance', '#% to Lightning Resistance', '#% to Chaos Resistance', '# to Intelligence', 'Minions have #% increased Critical Hit Chance', '# to Strength', '# to Dexterity'];
  const ix = T.buildStatIndex({ result: ['explicit', 'implicit'].map((type) => ({ id: type, entries: texts.map((text, i) => ({ id: `${type}.s${i}`, text, type })) })) });
  const ring = parseItem('Item Class: Rings\nRarity: Rare\nPlague Circle\nIron Ring\n--------\nItem Level: 80\n--------\nMinions deal 27% increased Damage\n+40 to maximum Life\n+30% to Fire Resistance\n+30% to Cold Resistance');
  const weights = gear.searchWeights('Ring', { build: 'djinn-varashta' });
  const shape = (s) => T.buildGearQuery(ring, { weights, statIndex: ix, ...s }).body.query.stats.map((g) => `${g.type}:${g.filters.length}:${g.filters.every((f) => f.id.startsWith('explicit.')) ? 'explicit' : 'mixed'}`).join(' ');
  assert.deepStrictEqual(T.GEAR_SEARCH_SIZES.map(shape), ['weight:24:mixed count:10:mixed', 'weight:12:explicit count:5:explicit', 'weight:10:explicit', 'weight:6:explicit', 'count:5:explicit']);
});

test('gear search sizes: the smallest stays at 6 filters when the slot has no key stats to count', () => {
  const texts = ['Minions deal #% increased Damage', '# to maximum Energy Shield', '# to maximum Life', '# to maximum Mana', '#% to Fire Resistance', '#% to Cold Resistance', '#% to Lightning Resistance', '# to Intelligence'];
  const ix = T.buildStatIndex({ result: ['explicit', 'implicit'].map((type) => ({ id: type, entries: texts.map((text, i) => ({ id: `${type}.s${i}`, text, type })) })) });
  const ring = parseItem('Item Class: Rings\nRarity: Rare\nPlague Circle\nIron Ring\n--------\nItem Level: 80\n--------\nMinions deal 27% increased Damage');
  const minor = gear.searchWeights('Ring', { build: 'djinn-varashta' }).map((w) => ({ ...w, imp: 1 }));
  const smallest = T.GEAR_SEARCH_SIZES[T.GEAR_SEARCH_SIZES.length - 1];
  const q = T.buildGearQuery(ring, { weights: minor, statIndex: ix, ...smallest });
  assert.strictEqual(q.countOnly, false);
  assert.deepStrictEqual(q.body.query.stats[0].filters.map((f) => f.id.split('.')[0]), Array(6).fill('explicit'));
});
