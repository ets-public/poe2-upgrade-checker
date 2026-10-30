'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseItem } = require('../src/core/parser');
const { gearScore } = require('../src/core/gearscore');

const FAST_MACE = `Item Class: Two Hand Maces
Rarity: Rare
Brute Knell
Forge Maul
--------
Physical Damage: 100-160 (augmented)
Fire Damage: 20-40 (augmented)
Attacks per Second: 1.32 (augmented)
--------
Item Level: 70
--------
120% increased Physical Damage
Adds 20 to 40 Fire Damage
20% increased Attack Speed`;

test('gear score counts weapon attack speed only through the weapon DPS', () => {
  const g = gearScore(parseItem(FAST_MACE), { build: 'life-res' });
  assert.deepStrictEqual(g.contributions.map((c) => c.key), ['[Weapon] Total DPS']);
});

test('gear score still counts attack speed on gloves', () => {
  const gloves = parseItem('Item Class: Gloves\nRarity: Rare\nX\nY\n--------\nArmour: 100\n--------\n10% increased Attack Speed');
  const g = gearScore(gloves, { build: 'life-res' });
  assert.deepStrictEqual(g.contributions.map((c) => [c.key, c.points]), [['[Base] Armour', 1.8], ['#% increased Attack Speed', 1.5]]);
});

test('gear score calls weapon damage mods wasted for a build that does not use weapon DPS', () => {
  const g = gearScore(parseItem(FAST_MACE), { build: 'es-caster' });
  assert.deepStrictEqual(g.wasted, ['#% increased Physical Damage', 'Adds # to # Fire Damage', '#% increased Attack Speed']);
});

test('gear score counts weapon attack speed when weapon DPS is tweaked off', () => {
  const g = gearScore(parseItem(FAST_MACE), { build: 'life-res', tweaks: { 'Weapon DPS': 0 } });
  assert.deepStrictEqual(g.contributions.map((c) => c.key), ['#% increased Attack Speed']);
});

test('gear score counts weapon attack speed when weapon DPS is ignored', () => {
  const g = gearScore(parseItem(FAST_MACE), { build: 'life-res', ignore: (k) => k === '[Weapon] Total DPS' });
  assert.deepStrictEqual(g.contributions.map((c) => c.key), ['#% increased Attack Speed']);
});

test('gear score calls global attack mods on a weapon wasted', () => {
  const mace = FAST_MACE.replace(/120%[^]*$/, 'Allies in your Presence have 10% increased Attack Speed\n12% increased Attack Speed with Quarterstaves\nAdds 2 to 4 Physical Damage to Attacks');
  const g = gearScore(parseItem(mace), { build: 'life-res' });
  assert.deepStrictEqual(g.wasted, ['Allies in your Presence have #% increased Attack Speed', '#% increased Attack Speed with Quarterstaves', 'Adds # to # Physical Damage to Attacks']);
});

test('gear score does not call weapon damage mods wasted', () => {
  const g = gearScore(parseItem(FAST_MACE), { build: 'life-res' });
  assert.deepStrictEqual(g.wasted, []);
});

const G = require('../src/core/gearscore');

test('profiles: every damage x defence pair works, the three old ones keep their ids', () => {
  const { off, def } = G.buildParts();
  assert.strictEqual(off.length, 5); assert.strictEqual(def.length, 7);
  for (const o of off) for (const d of def) {
    const id = G.pairId(o.id, d.id);
    const b = G.getBuild(id);
    assert.ok(b && b.stats.length > 10, id);
    assert.deepStrictEqual(G.pairOf(id), [o.id, d.id]);
  }
  assert.strictEqual(G.pairId('minion', 'es'), 'djinn-varashta');
  assert.strictEqual(G.pairId('spell', 'es'), 'es-caster');
  assert.strictEqual(G.pairId('any', 'life'), 'life-res');
  assert.strictEqual(G.getBuild('spell/es'), G.BUILDS['es-caster']);
  assert.strictEqual(G.getBuild('nope/life'), undefined);
  assert.strictEqual(G.buildInfo('melee/life-ar').name, 'Melee attacks · Life & Armour');
});

test('profiles: a melee armour build wants armour gloves with attack speed, an ES caster does not', () => {
  const gloves = parseItem('Item Class: Gloves\nRarity: Rare\nX\nY\n--------\nArmour: 300\n--------\nItem Level: 80\n--------\n14% increased Attack Speed\n+30% to Fire Resistance\nAdds 15 to 28 Physical Damage to Attacks');
  const melee = gearScore(gloves, { build: 'melee/life-ar' });
  const caster = gearScore(gloves, { build: 'es-caster' });
  assert.ok(melee.score > caster.score + 20, `${melee.score} vs ${caster.score}`);
  assert.deepStrictEqual(melee.wasted, []);
});

test('profiles: picked from a Path of Building build', () => {
  assert.strictEqual(G.fitProfile({ dpsKey: 'MinionDPS', life: 900, es: 9000, evasion: 2000 }), 'djinn-varashta');
  assert.strictEqual(G.fitProfile({ kind: { minion: true }, life: 4000, armour: 12000 }), 'minion/life-ar');
  assert.strictEqual(G.fitProfile({ kind: { attack: true, melee: true }, life: 4000, armour: 15000, evasion: 800 }), 'melee/life-ar');
  assert.strictEqual(G.fitProfile({ kind: { attack: true, projectile: true }, life: 3000, evasion: 20000 }), 'ranged/life-ev');
  assert.strictEqual(G.fitProfile({ kind: { attack: true }, weapon: 'Crossbow', life: 3000, armour: 9000, evasion: 8000 }), 'ranged/life-arev');
  assert.strictEqual(G.fitProfile({ kind: { spell: true }, life: 800, es: 7000, evasion: 5000 }), 'spell/ev-es');
  assert.strictEqual(G.fitProfile({ kind: { spell: true }, life: 1000, es: 6000 }), 'es-caster');
  assert.strictEqual(G.fitProfile({}), 'life-res');
});
