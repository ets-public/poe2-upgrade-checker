'use strict';

const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/core/filterfile');

const FILTER = `#=== NeverSink-ish ===
# $type->currency $tier->t1
Show # $type->currency $tier->t1
\tClass == "Stackable Currency"
\tBaseType == "Divine Orb" "Mirror of Kalandra"
\tSetFontSize 45
\tSetTextColor 255 0 0 255
\tSetBackgroundColor 255 255 255 255
\tPlayEffect Red

Show # $type->currency $tier->t3
\tClass == "Stackable Currency"
\tBaseType == "Chaos Orb" "Exalted Orb"
\tSetFontSize 40
\tSetTextColor 0 0 0 255

Show
\tRarity Rare
\tItemLevel >= 75
\tSetBorderColor 255 255 0
\tContinue

Hide # $type->currency $tier->hidden
\tClass == "Stackable Currency"
\tBaseType "Transmutation"
`;

test('filter: blocks, labels, base types', () => {
  const p = F.parse(FILTER);
  assert.strictEqual(p.blocks.length, 4);
  assert.strictEqual(p.blocks[0].label, 'currency · t1');
  assert.strictEqual(p.blocks[2].cont, true);
  assert.deepStrictEqual(F.baseTypes(p), ['Chaos Orb', 'Divine Orb', 'Exalted Orb', 'Mirror of Kalandra', 'Transmutation']);
  assert.deepStrictEqual(F.tiers(p).map((t) => t.label), ['currency · t1', 'currency · t3']);
});

test('filter: the block that shows an item (== exact, plain match by part of the name)', () => {
  const p = F.parse(FILTER);
  assert.strictEqual(F.findBlock(p, { baseType: 'Exalted Orb', itemClass: 'Stackable Currency' }).block.label, 'currency · t3');
  const hid = F.findBlock(p, { baseType: 'Orb of Transmutation', itemClass: 'Stackable Currency' });
  assert.strictEqual(hid.block.action, 'Hide');
  assert.strictEqual(F.findBlock(p, { baseType: 'Regal Orb', itemClass: 'Stackable Currency' }), null);
});

test('filter: edits go in one section on top, are read back, and replace each other', () => {
  let edits = F.setEdit([], 'Chaos Orb', { show: true, style: { SetFontSize: ['45'], PlayEffect: ['Red'] }, note: 'Chaos' });
  edits = F.setEdit(edits, 'Transmutation', { show: false });
  const text = F.apply(FILTER, edits);
  assert.ok(text.startsWith(F.START));
  assert.deepStrictEqual(F.readEdits(text).map((e) => e.baseType), ['Transmutation', 'Chaos Orb']);
  // the filter you started from is untouched below the section
  assert.strictEqual(F.withoutEdits(text), FILTER);
  // the first block now decides: the edit
  const p = F.parse(text);
  const chaos = F.findBlock(p, { baseType: 'Chaos Orb', itemClass: 'Stackable Currency' });
  assert.deepStrictEqual(chaos.styles.PlayEffect, ['Red']);
  assert.strictEqual(F.findBlock(p, { baseType: 'Transmutation' }).block.action, 'Hide');
  // applied again: still one section
  const again = F.apply(text, F.setEdit(F.readEdits(text), 'Chaos Orb', null));
  assert.strictEqual(again.split(F.START).length, 2);
  assert.deepStrictEqual(F.readEdits(again).map((e) => e.baseType), ['Transmutation']);
  assert.strictEqual(F.apply(again, []), FILTER);
});

test('filter: tiers by price keep the edits you made by hand', () => {
  const own = [{ baseType: 'Divine Orb', show: true, style: {} }];
  const e = F.priceEdits([{ name: 'Divine Orb', div: 1 }, { name: 'Chaos Orb', div: 0.3 }, { name: 'Wisdom', div: 0.0001 }, { name: 'Mirror', div: 300 }], own);
  assert.deepStrictEqual(e.map((x) => [x.baseType, x.auto]), [['Mirror', 'S'], ['Chaos Orb', 'A']]);
});

test('filter: style lines are written safely', () => {
  assert.deepStrictEqual(F.styleLines({ SetFontSize: ['40'], CustomAlertSound: ['my "sound".mp3', '300'], Bogus: ['x'] }), ['\tSetFontSize 40', '\tCustomAlertSound "my sound.mp3" 300']);
});
