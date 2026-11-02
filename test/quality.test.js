'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseItem } = require('../src/core/parser');
const Q = require('../src/core/quality');

const BODY = 'Item Class: Body Armours\nRarity: Rare\nDoom Shell\nSacrificial Regalia\n--------\nQuality: +8% (augmented)\nEnergy Shield: 150 (augmented)\n--------\nItem Level: 80\n--------\n+80 to maximum Energy Shield\n+30% to Fire Resistance\n';
const RING = 'Item Class: Rings\nRarity: Rare\nGale Loop\nRuby Ring\n--------\nItem Level: 80\n--------\n+30% to Fire Resistance\n';

test('quality: armour below 20% can be raised; the Quality line is set to 20%', () => {
  const it = parseItem(BODY);
  assert.strictEqual(Q.canRaise(it), true);
  assert.strictEqual(Q.currentQuality(it.raw), 8);
  const t = Q.withQuality(it.raw);
  assert.match(t, /^Quality: \+20% \(augmented\)$/m);
  assert.doesNotMatch(t, /\+8%/);
});

test('quality: an item without a Quality line gets one under the header', () => {
  const raw = BODY.replace('Quality: +8% (augmented)\n', '');
  const t = Q.withQuality(raw);
  assert.strictEqual(Q.currentQuality(t), 20);
  assert.match(t, /Sacrificial Regalia\n--------\nQuality: \+20% \(augmented\)\nEnergy Shield/);
});

test('quality: jewellery, corrupted and 20% items are left alone', () => {
  assert.strictEqual(Q.canRaise(parseItem(RING)), false);
  assert.strictEqual(Q.canRaise(parseItem(BODY + '--------\nCorrupted\n')), false);
  assert.strictEqual(Q.canRaise(parseItem(BODY.replace('+8%', '+20%'))), false);
});

test('quality: a line only when 20% quality changes the verdict noticeably', () => {
  assert.strictEqual(Q.summarise({ score: 2 }, { score: 2.1, verdict: 'small' }, 8), null);
  assert.deepStrictEqual(Q.summarise({ score: 2 }, { score: 4.5, verdict: 'upgrade' }, 8), { quality: 20, from: 8, score: 4.5, verdict: 'upgrade', gain: 2.5 });
});
