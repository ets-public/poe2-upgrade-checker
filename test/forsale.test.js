'use strict';

const test = require('node:test');
const assert = require('node:assert');
const FS = require('../src/core/forsale');
const { parseItem } = require('../src/core/parser');

const RING = 'Item Class: Rings\nRarity: Rare\nGale Loop\nRuby Ring\n--------\nItem Level: 80\n--------\n+30% to Fire Resistance\n+40 to maximum Life\n+12% to Cold Resistance\n';
const mine = parseItem(RING);
const other = parseItem(RING.replace('+40 to', '+50 to'));
const L = (item, ex, text) => ({ item, priceEx: ex, priceText: text, account: 'acc' });

test('for sale: your listing found, with how many like it are cheaper', () => {
  const st = FS.status(mine, [L(other, 100, '100 ex'), L(mine, 300, '300 ex'), L(other, 500, '500 ex')]);
  assert.strictEqual(st.found, true);
  assert.strictEqual(st.cheaper, 1);
  assert.strictEqual(st.cheapest.text, '100 ex');
  assert.match(FS.text(st, false), /Still listed at 300 ex\. 1 like it is cheaper \(from 100 ex\)/);
});

test('for sale: gone after it was seen means sold or taken down', () => {
  const st = FS.status(mine, [L(other, 100, '100 ex')]);
  assert.strictEqual(st.found, false);
  assert.match(FS.text(st, true), /sold, or taken down/);
  assert.match(FS.text(st, false), /Not found/);
});
