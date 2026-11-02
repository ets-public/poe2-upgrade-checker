'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/core/regexbuild');
const M = require('../src/core/regexmods');

const WAYSTONE = `Item Class: Waystones
Rarity: Rare
Grim Haven
Waystone (Tier 15)
--------
Waystone Tier: 15
Revives Available: 0
Monster Pack Size: +32%
Magic Monsters: +45%
Rare Monsters: +28%
Item Rarity: +61%
Waystone Drop Chance: +120%
--------
Item Level: 79
--------
Monsters deal 28% of Damage as Extra Cold
Players are Cursed with Temporal Chains
Monsters have 40% increased Critical Hit Chance
+30% to Monster Critical Damage Bonus
Area has patches of Burning Ground
Rare Monsters have 1 additional Modifier
--------
Corrupted`;

const MAP1 = `Item Class: Maps
Rarity: Rare
Dread Spires
Strand Map
--------
Map Tier: 16
Item Quantity: +84%
Item Rarity: +41%
Monster Pack Size: +27%
--------
Item Level: 83
--------
Monsters reflect 18% of Elemental Damage
Players have 40% less Recovery Rate of Life and Energy Shield
Monsters have 70% increased Area of Effect
Area is inhabited by Undead`;

test('at least n: every number from 0 to 1200, at the start of a value and at its end', () => {
  for (let n = 1; n <= 300; n++) {
    const start = new RegExp(`^x: ${R.atLeast(n)}`);
    const end = new RegExp(`${R.atLeast(n)}% inc`);
    for (let v = 0; v <= 1200; v++) {
      assert.equal(start.test(`x: ${v}`), v >= n, `${n} vs ${v} (start)`);
      assert.equal(end.test(`+${v}% inc`), v >= n, `${n} vs ${v} (end)`);
    }
  }
});

test('at least n: short forms', () => {
  assert.equal(R.atLeast(30), '([3-9]\\d|\\d\\d\\d)');
  assert.equal(R.atLeast(42), '(4[2-9]|[5-9]\\d|\\d\\d\\d)');
  assert.equal(R.atLeast(0), '\\d');
});

test('at most n, after a label', () => {
  for (let n = 0; n <= 120; n++) {
    const re = new RegExp(`^tier: ${R.atMost(n)}`, 'm');
    for (let v = 0; v <= 400; v++) assert.equal(re.test(`tier: ${v}`), v <= n, `${n} vs ${v}`);
  }
});

test('waystone: minimums are ANDed, each its own group, and light up the right waystone', () => {
  const r = R.buildMap({ game: 'poe2', mins: { pack: 30, rarity: 50 } }, M.flat('poe2'));
  assert.equal(r.groups, 2);
  assert.ok(R.test(r.text, WAYSTONE).ok);
  assert.ok(!R.test(R.buildMap({ game: 'poe2', mins: { pack: 40 } }, M.flat('poe2')).text, WAYSTONE).ok);
  // "any one is enough": one group
  const any = R.buildMap({ game: 'poe2', mins: { pack: 40, rarity: 60 }, anyProp: true }, M.flat('poe2'));
  assert.equal(any.groups, 1);
  assert.ok(R.test(any.text, WAYSTONE).ok);
});

test('waystone: a tier range', () => {
  const r = R.buildMap({ game: 'poe2', mins: { tier: 14 }, maxs: { tier: 15 } }, M.flat('poe2'));
  assert.ok(R.test(r.text, WAYSTONE).ok);
  assert.ok(!R.test(r.text, WAYSTONE.replace('Waystone Tier: 15', 'Waystone Tier: 16')).ok);
  assert.ok(!R.test(r.text, WAYSTONE.replace('Waystone Tier: 15', 'Waystone Tier: 13')).ok);
});

test('waystone: avoided mods go dark, other mods do not', () => {
  const pick = (avoid) => R.buildMap({ game: 'poe2', avoid }, M.flat('poe2'));
  assert.ok(!R.test(pick(['Players are Cursed with Temporal Chains']).text, WAYSTONE).ok);
  assert.ok(R.test(pick(['Players are Cursed with Enfeeble', 'Monsters have #% increased Freeze Buildup']).text, WAYSTONE).ok);
});

test('fragments: every listed mod gets one that matches it and no other listed mod', () => {
  for (const game of ['poe1', 'poe2']) {
    const all = M.flat(game);
    for (const m of all) {
      const r = R.fragmentsFor([m], all);
      if (r.clash.length) continue; // reported to the player as "also hides..."
      const re = new RegExp(R.escapeRx(r.parts[0].frag), 'i');
      assert.ok(re.test(m.replace(/#/g, '12')), `${game}: ${r.parts[0].frag} vs ${m}`);
      for (const o of all) if (R.norm(o) !== R.norm(m)) assert.ok(!re.test(o.replace(/#/g, '12')), `${game}: ${r.parts[0].frag} also matches ${o}`);
    }
  }
});

test('PoE1 map: no reflect / no recovery, quantity 80+', () => {
  const r = R.buildMap({ game: 'poe1', mins: { quant: 80 }, avoid: ['Monsters reflect #% of Physical Damage', 'Monsters reflect #% of Elemental Damage'] }, M.flat('poe1'));
  assert.ok(!R.test(r.text, MAP1).ok);
  assert.ok(R.test(r.text, MAP1.replace(/Monsters reflect.*\n/, '')).ok);
  assert.ok(r.length <= R.LIMIT);
});

test('flags: corrupted yes / no', () => {
  assert.ok(R.test(R.buildMap({ game: 'poe2', flags: { corrupted: 'yes' } }, []).text, WAYSTONE).ok);
  assert.ok(!R.test(R.buildMap({ game: 'poe2', flags: { corrupted: 'no' } }, []).text, WAYSTONE).ok);
  assert.ok(R.test(R.buildMap({ game: 'poe2', flags: { norevive: 'yes' } }, []).text, WAYSTONE).ok);
});

test('any item: number rows, text rows, not rows', () => {
  const boots = 'Item Class: Boots\nRarity: Rare\nDoom Tread\nRidge Boots\n--------\n30% increased Movement Speed\n+38% to Fire Resistance\n+12% to Cold Resistance';
  const all = R.buildItem({ rows: [{ kind: 'num', template: '#% increased movement speed', min: 25 }, { kind: 'num', template: '+#% to fire resistance', min: 30 }] });
  assert.equal(all.groups, 2);
  assert.ok(R.test(all.text, boots).ok);
  assert.ok(!R.test(R.buildItem({ rows: [{ kind: 'num', template: '+#% to cold resistance', min: 20 }] }).text, boots).ok);
  const any = R.buildItem({ mode: 'any', rows: [{ kind: 'num', template: '+#% to cold resistance', min: 20 }, { kind: 'text', text: 'ridge boots' }] });
  assert.ok(R.test(any.text, boots).ok);
  assert.ok(!R.test(R.buildItem({ rows: [{ kind: 'text', text: 'boots' }, { kind: 'text', text: 'ridge', not: true }] }).text, boots).ok);
});

test('reading a search: quoted groups, bare words, !', () => {
  assert.deepEqual(R.parse('"a|b" "!c d" word'), [{ rx: 'a|b', not: false }, { rx: 'c d', not: true }, { rx: 'word', not: false }]);
  assert.equal(R.test('"(bad"', 'x').ok, false);
});

test('over the limit is said', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ kind: 'text', text: `a fairly long piece of text number ${i}` }));
  const r = R.buildItem({ rows });
  assert.ok(r.over);
  assert.ok(r.notes.some((n) => /over/.test(n)));
});
