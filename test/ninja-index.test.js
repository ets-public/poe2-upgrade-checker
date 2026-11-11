'use strict';

// poe.ninja exchange lists are indexed once per answer (they're cached for 20 minutes and not changed).
const test = require('node:test');
const assert = require('node:assert');
const N = require('../src/core/ninja');

function makeAnswer() {
  return {
    core: { primary: 'divine', rates: { exalted: 400 }, items: [{ id: 'divine', name: 'Divine Orb' }] },
    items: [{ id: 'gcp', name: "Gemcutter's Prism", category: 'Currency' }],
    lines: [{ id: 'gcp', primaryValue: 0.0025, volumePrimaryValue: 12 }],
  };
}

test('ninja index: the same answer object returns the same Map', () => {
  const a = makeAnswer();
  assert.strictEqual(N.exchangeIndex(a), N.exchangeIndex(a));
});

test('ninja index: different answers with equal content get their own Maps', () => {
  const ma = N.exchangeIndex(makeAnswer());
  const mb = N.exchangeIndex(makeAnswer());
  assert.notStrictEqual(ma, mb);
  assert.deepStrictEqual([...ma], [...mb]);
});

test('ninja index: bad input gives a new empty Map each time', () => {
  for (const bad of [null, undefined, 'nope', {}]) {
    const m1 = N.exchangeIndex(bad);
    const m2 = N.exchangeIndex(bad);
    assert.ok(m1 instanceof Map);
    assert.strictEqual(m1.size, 0);
    assert.notStrictEqual(m1, m2);
  }
});

test('ninja index: lookup by lower-cased name', () => {
  const entry = N.exchangeIndex(makeAnswer()).get("gemcutter's prism");
  assert.ok(entry);
  assert.strictEqual(entry.value, 0.0025);
  assert.strictEqual(entry.volume, 12);
  assert.strictEqual(entry.category, 'Currency');
});
