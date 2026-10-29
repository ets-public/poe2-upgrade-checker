'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { parseItem } = require('../src/core/parser');
const { compare, score } = require('../src/core/scorer');
const { Store, DEFAULT_WEIGHTS } = require('../src/core/store');

const HELMET_NEW = `Item Class: Helmets
Rarity: Rare
Doom Visage
Expert Visored Helm
--------
Quality: +20% (augmented)
Armour: 312 (augmented)
--------
Requirements:
Level: 65
Str: 101
--------
Sockets: S
--------
Item Level: 79
--------
+12% to Cold Resistance (rune)
--------
+89 to maximum Life
+32% to Fire Resistance
+11% to all Elemental Resistances
+14 to Strength
12% reduced Attribute Requirements`;

const HELMET_OLD = `Item Class: Helmets\r
Rarity: Rare\r
Grim Crown\r
Visored Helm\r
--------\r
Armour: 180\r
--------\r
Item Level: 50\r
--------\r
+55 to maximum Life\r
+20% to Fire Resistance\r
+18% to Lightning Resistance`;

const ADVANCED_RING = `Item Class: Rings
Rarity: Rare
Storm Loop
Sapphire Ring
--------
Requirements:
Level: 40
--------
Item Level: 75
--------
{ Implicit Modifier }
+24(20-30)% to Cold Resistance (implicit)
--------
{ Prefix Modifier "Hale" (Tier: 4) — Life }
+62(55-69) to maximum Life
{ Suffix Modifier "of the Squall" (Tier: 3) — Elemental, Lightning, Resistance }
+30(26-30)% to Lightning Resistance
{ Suffix Modifier "of the Fox" — Attribute }
+12(9-15) to Strength and Dexterity`;

const WEAPON_2H = `Item Class: Two Hand Maces
Rarity: Rare
Brute Knell
Forge Maul
--------
Physical Damage: 100-160 (augmented)
Fire Damage: 20-40 (augmented)
Critical Hit Chance: 5.00%
Attacks per Second: 1.10
--------
Item Level: 70
--------
120% increased Physical Damage
Adds 20 to 40 Fire Damage
+40 to Strength`;

test('parses header, slot and properties', () => {
  const it = parseItem(HELMET_NEW);
  assert.equal(it.itemClass, 'Helmets');
  assert.equal(it.slot, 'Helmet');
  assert.equal(it.name, 'Doom Visage');
  assert.equal(it.baseType, 'Expert Visored Helm');
  assert.equal(it.itemLevel, 79);
  assert.equal(it.requiredLevel, 65);
  assert.equal(it.stats['[Base] Armour'], 312);
  assert.equal(it.stats['# to maximum Life'], 89);
});

test('expands all-res and sums rune + explicit', () => {
  const it = parseItem(HELMET_NEW);
  assert.equal(it.stats['#% to Fire Resistance'], 43);
  assert.equal(it.stats['#% to Cold Resistance'], 23);
  assert.equal(it.stats['#% to Lightning Resistance'], 11);
  assert.equal(it.stats['#% to all Elemental Resistances'], undefined);
  assert.equal(it.stats['#% increased Attribute Requirements'], -12);
});

test('handles CRLF and advanced (Ctrl+Alt+C) text', () => {
  assert.equal(parseItem(HELMET_OLD).stats['# to maximum Life'], 55);
  const ring = parseItem(ADVANCED_RING);
  assert.equal(ring.slot, 'Ring');
  assert.equal(ring.stats['# to maximum Life'], 62);
  assert.equal(ring.stats['#% to Cold Resistance'], 24);
  assert.equal(ring.stats['#% to Lightning Resistance'], 30);
  assert.equal(ring.stats['# to Strength'], 12);
  assert.equal(ring.stats['# to Dexterity'], 12);
});

test('weapon DPS and two-handed detection', () => {
  const w = parseItem(WEAPON_2H);
  assert.equal(w.slot, 'Weapon');
  assert.equal(w.twoHanded, true);
  assert.equal(w.stats['[Weapon] Physical DPS'], 143);
  assert.equal(w.stats['[Weapon] Elemental DPS'], 33);
  assert.equal(w.stats['[Weapon] Total DPS'], 176);
  assert.equal(w.stats['Adds # to # Fire Damage'], 30);
});

test('non-items and unsupported items', () => {
  assert.equal(parseItem('hello'), null);
  const cur = parseItem('Item Class: Stackable Currency\nRarity: Currency\nDivine Orb\n--------\nStack Size: 1/20');
  assert.equal(compare(cur, {}, DEFAULT_WEIGHTS).ok, false);
  const flask = parseItem('Item Class: Life Flasks\nRarity: Magic\nFlask\n--------\nItem Level: 10');
  assert.equal(flask.slot, 'Life Flask');
  const jewel = parseItem('Item Class: Jewels\nRarity: Rare\nA\nSapphire\n--------\nMinions deal 10% increased Damage');
  const r = compare(jewel, { 'Jewel 1': parseItem('Item Class: Jewels\nRarity: Rare\nB\nSapphire\n--------\nMinions deal 5% increased Damage') }, DEFAULT_WEIGHTS);
  // jewels: compared with your weakest one (the app has room for 40, so an empty slot means nothing)
  assert.equal(r.targetSlot, 'Jewel 1');
  assert.notEqual(r.verdict, 'new');
  assert.equal(compare(jewel, {}, DEFAULT_WEIGHTS).targetSlot, 'Jewel 1'); // no jewels yet: a new one
});

test('compare helmet: upgrade', () => {
  const eq = { Helmet: parseItem(HELMET_OLD) };
  const r = compare(parseItem(HELMET_NEW), eq, DEFAULT_WEIGHTS);
  assert.equal(r.ok, true);
  assert.notEqual(r.verdict, 'new');
  assert.ok(r.delta > 0);
  const life = r.rows.find((x) => x.key === '# to maximum Life');
  assert.equal(life.diff, 34);
  // reverse is a downgrade
  const back = compare(parseItem(HELMET_OLD), { Helmet: parseItem(HELMET_NEW) }, DEFAULT_WEIGHTS);
  assert.equal(back.verdict, 'downgrade');
});

test('ring replaces the weaker ring / fills empty ring', () => {
  const ring = parseItem(ADVANCED_RING);
  const weak = parseItem('Item Class: Rings\nRarity: Magic\nWeak Ring\n--------\n+10 to maximum Life');
  const strong = parseItem('Item Class: Rings\nRarity: Rare\nStrong\nRing\n--------\n+200 to maximum Life');
  const r = compare(ring, { 'Ring 1': strong, 'Ring 2': weak }, DEFAULT_WEIGHTS);
  assert.equal(r.targetSlot, 'Ring 2');
  assert.notEqual(r.verdict, 'new');
  const r2 = compare(ring, { 'Ring 1': strong }, DEFAULT_WEIGHTS);
  assert.equal(r2.targetSlot, 'Ring 2');
  assert.equal(r2.verdict, 'new');
});

test('two-hander compared against weapon + offhand', () => {
  const oneH = parseItem('Item Class: One Hand Maces\nRarity: Rare\nA\nB\n--------\nPhysical Damage: 10-20\nAttacks per Second: 1.50\n--------\n+30 to maximum Life');
  const shield = parseItem('Item Class: Shields\nRarity: Rare\nS\nT\n--------\nArmour: 200\n--------\n+50 to maximum Life');
  const r = compare(parseItem(WEAPON_2H), { Weapon: oneH, Offhand: shield }, DEFAULT_WEIGHTS);
  assert.deepEqual(r.replacing, ['A', 'S']);
  const life = r.rows.find((x) => x.key === '# to maximum Life');
  assert.equal(life.oldValue, 80);
  assert.ok(r.notes.some((n) => /Two-handed/.test(n)));
});

test('store persists and round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2uc-'));
  const s = new Store(dir);
  s.setWeight('# to maximum Life', 2);
  s.setWeight('#% to Chaos Resistance', 0);
  s.setEquipped('Helmet', parseItem(HELMET_OLD));
  const s2 = new Store(dir);
  assert.equal(s2.weights['# to maximum Life'], 2);
  assert.equal(s2.weights['#% to Chaos Resistance'], undefined);
  assert.equal(s2.equipped.Helmet.name, 'Grim Crown');
  assert.equal(score(s2.equipped.Helmet, { '# to maximum Life': 2 }), 110);
});

test('advanced-copy quirks: unscalable note, runic ward, fractured line', () => {
  const it = parseItem(`Item Class: Boots
Rarity: Rare
Oblivion Trail
Sorcerer Boots
--------
Energy Shield: 414 (augmented)
Runic Ward: 217 (augmented)
--------
+60(48-60) to maximum Energy Shield
35% increased Movement Speed
60% increased effect of Socketed Augment Items — Unscalable Value
Fractured Item`);
  assert.equal(it.stats['#% increased effect of Socketed Augment Items'], 60);
  assert.equal(it.stats['[Base] Runic Ward'], 217);
  assert.equal(it.stats['# to maximum Energy Shield'], 60);
  assert.equal(Object.keys(it.stats).some((k) => /Fractured/.test(k)), false);
});

test('copied item that is already equipped is flagged', () => {
  const h = parseItem(HELMET_OLD);
  const r = compare(parseItem(HELMET_OLD), { Helmet: h }, DEFAULT_WEIGHTS);
  assert.equal(r.isEquipped, true);
  assert.equal(r.verdict, 'equipped');
  const r2 = compare(parseItem(HELMET_NEW), { Helmet: h }, DEFAULT_WEIGHTS);
  assert.equal(r2.isEquipped, false);
});

test('suggested weights favour stats your gear stacks', () => {
  const { suggestWeights } = require('../src/core/autoweights');
  const eq = {
    Helmet: parseItem('Item Class: Helmets\nRarity: Rare\nA\nB\n--------\nEnergy Shield: 400\n--------\n+2 to Level of all Minion Skills\n+30 to Intelligence\n+10% to Fire Resistance (rune)'),
    Gloves: parseItem('Item Class: Gloves\nRarity: Rare\nC\nD\n--------\nEnergy Shield: 200\n--------\n+30 to Intelligence\n+40 to maximum Life'),
  };
  const s = suggestWeights(eq);
  const get = (k) => (s.find((x) => x.key === k) || {}).weight;
  assert.equal(get('# to Intelligence'), 1.5);       // 2 slots: 45 pts / 30
  assert.equal(get('# to maximum Life'), 0.75);      // 1 slot: 30 / 40
  assert.equal(get('# to Level of all Minion Skills'), 15);
  assert.equal(get('[Base] Energy Shield'), 0.13);   // 40 / 300 avg
  assert.equal(get('#% increased Energy Shield'), undefined);
  assert.equal(get('#% to Fire Resistance'), undefined); // rune only -> skipped
  const ig = suggestWeights(eq, (k) => k === '# to maximum Life');
  assert.equal(ig.find((x) => x.key === '# to maximum Life'), undefined);
});

test('gear score rates items for the Djinn Disciple build', () => {
  const { gearScore } = require('../src/core/gearscore');
  const helm = parseItem(`Item Class: Helmets
Rarity: Rare
Great Crown
Ancestral Tiara
--------
Energy Shield: 520
--------
+3 to Level of all Minion Skills
+42% to Cold Resistance
+40% to Fire Resistance
+90 to maximum Life
+30% to Chaos Resistance
80% increased Energy Shield`);
  const g = gearScore(helm, { build: 'djinn-varashta' });
  assert.ok(g.score >= 85, `great helm should be S, got ${g.score}`);
  assert.equal(g.grade, 'S');
  assert.deepEqual(g.wasted, []); // local ES% is part of the base, not wasted
  const junk = parseItem(`Item Class: Helmets
Rarity: Rare
Bad Hat
Ancestral Tiara
--------
Energy Shield: 150
--------
Adds 1 to 4 Physical Damage to Attacks
+10 to Strength
12% increased Stun Threshold`);
  const j = gearScore(junk, { build: 'djinn-varashta' });
  assert.ok(j.score < 30, `junk helm should be low, got ${j.score}`);
  assert.ok(j.missing.includes('Minion skill levels'));
  assert.equal(j.wasted.length, 2);
  // if you ignore resistances, a helm whose mods are mostly resistances is worth less to you
  const noRes = gearScore(helm, { build: 'djinn-varashta', ignore: (k) => /Resistance/.test(k) });
  assert.ok(noRes.score < g.score && noRes.score > 60, String(noRes.score));
  const boots = parseItem('Item Class: Boots\nRarity: Rare\nX\nY\n--------\nEnergy Shield: 100\n--------\n+30 to maximum Life');
  const b = gearScore(boots, { build: 'djinn-varashta' });
  assert.equal(b.missing[0], 'Movement speed');
  assert.equal(gearScore(parseItem('Item Class: Belts\nRarity: Unique\nMageblood\nHeavy Belt\n--------\n+50 to maximum Life')).unique, true);
});

test('character profiles keep gear, weights and build apart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2uc-prof-'));
  const s = new Store(dir);
  s.setEquipped('Helmet', parseItem(HELMET_OLD));
  s.setWeight('# to maximum Life', 5);
  s.setSetting('build', 'djinn-varashta');
  assert.equal(s.listProfiles().length, 1);
  const alt = s.createProfile('Alt witch');
  assert.equal(Object.keys(s.equipped).length, 0);
  assert.equal(s.weights['# to maximum Life'], 1); // defaults for a new character
  s.setEquipped('Gloves', parseItem(HELMET_OLD.replace('Helmets', 'Gloves')));
  s.switchProfile('main');
  assert.ok(s.equipped.Helmet && !s.equipped.Gloves);
  assert.equal(s.weights['# to maximum Life'], 5);
  const s2 = new Store(dir); // persisted
  assert.equal(s2.listProfiles().length, 2);
  s2.switchProfile(alt);
  assert.ok(s2.equipped.Gloves && !s2.equipped.Helmet);
  assert.equal(s2.deleteProfile(alt), true);
  assert.ok(s2.equipped.Helmet);
});

test('advanced copy: open prefixes / suffixes for crafting', () => {
  const it = parseItem(`Item Class: Gloves
Rarity: Rare
Doom Vise
Sorcerer Gloves
--------
Energy Shield: 280
--------
{ Prefix Modifier "Hale" (Tier: 3) — Life }
+33(33-41) to maximum Life
{ Prefix Modifier "Shining" (Tier: 2) — Defences, Energy Shield }
75(68-79)% increased Energy Shield
+20(18-22) to maximum Energy Shield
{ Suffix Modifier "of the Squall" (Tier: 3) — Elemental, Lightning, Resistance }
+39(36-40)% to Lightning Resistance`);
  assert.deepEqual(it.affixes, { known: true, prefixes: 2, suffixes: 1, openPrefix: 1, openSuffix: 2 });
  assert.equal(it.stats['# to maximum Energy Shield'], 20); // hybrid lines still read
  assert.equal(parseItem(HELMET_OLD).affixes.known, false);
});

test('advanced copy: { Implicit Modifier } lines are implicits', () => {
  const it = parseItem('Item Class: Rings\nRarity: Rare\nEmpyrean Gyre\nIron Ring\n--------\nItem Level: 81\n--------\n{ Implicit Modifier }\nAdds 1 to 4 Physical Damage to Attacks\n--------\n{ Prefix Modifier "Sapphire" (Tier: 2) — Mana }\n+56(55-64) to maximum Mana\n{ Suffix Modifier "of the Sage" (Tier: 1) — Attribute }\n+31(31-33) to Intelligence');
  assert.strictEqual(it.lines.find((l) => /Physical/.test(l.text)).tag, 'implicit');
  assert.strictEqual(it.lines.find((l) => /Mana/.test(l.text)).tag, 'explicit');
});

test('Mageblood Legacies become stats, with the duplicate bonus', () => {
  const { parseItem } = require('../src/core/parser');
  const base = "Item Class: Belts\nRarity: Unique\nMageblood\nUtility Belt\n--------\nItem Level: 80\n--------\nHas 3 Charm Slots\n20% of Flask Recovery applied Instantly\n--------\nLegacy of Bismuth\nLegacy of Sulphur\nLegacy of Quicksilver\nLegacy of Jade\nAll Mage's Legacies have 50% increased effect per duplicate Mage's Legacy you have\n--------\nRivers of power coursed through their veins.";
  const a = parseItem(base);
  assert.strictEqual(a.stats['#% to Cold Resistance'], 45);
  assert.strictEqual(a.stats['#% increased Movement Speed'], 30);
  assert.ok(a.lines.some((l) => l.text === 'Legacy of Jade'));
  const b = parseItem(base.replace('Legacy of Jade', 'Legacy of Ruby').replace('Legacy of Sulphur', 'Legacy of Ruby'));
  assert.strictEqual(b.legacies.duplicates, 1);
  assert.strictEqual(b.stats['#% to Fire Resistance'], 45 * 1.5 + 60 * 1.5);
  assert.strictEqual(b.stats['#% to Maximum Fire Resistance'], 7.5);
});

test('re-copying the same item does not move your resistance totals', () => {
  const R = require('../src/core/resists');
  const old = { name: 'Mageblood', baseType: 'Utility Belt', stats: {} };
  const neu = { name: 'Mageblood', baseType: 'Utility Belt', stats: { '#% to Cold Resistance': 45 } };
  let rec = R.snapshot({ cold: 112 }, { Belt: old }, 'pob');
  rec = R.rebase(rec, old, neu);
  assert.strictEqual(R.live(rec, { Belt: neu }).cold, 112);
  const ruby = { name: 'X', stats: { '#% to Maximum Fire Resistance': 5 } };
  assert.strictEqual(R.live(R.snapshot({ fire: 80 }, {}, 'game'), { Belt: ruby }).caps.fire, 80);
});

test('reminder text and unique flavour text are not stats', () => {
  const adv = parseItem(['Item Class: Body Armours', 'Rarity: Rare', 'Grim Coat', "Expert Hexer's Robe", '--------', 'Energy Shield: 300', '--------',
    '{ Suffix Modifier "of the Ice" (Tier: 1) }', '+2% to Maximum Cold Resistance', '(Maximum Resistances cannot be raised above 90%)',
    '{ Prefix Modifier "Tough" }', '+40 to maximum Life', '(reminder text that runs', 'over 2 lines)'].join('\n'));
  assert.deepEqual(Object.keys(adv.stats).sort(), ['# to maximum Life', '#% to Maximum Cold Resistance', '[Base] Energy Shield']);
  const helm = parseItem(['Item Class: Helmets', 'Rarity: Unique', 'Crown of Eyes', 'Velvet Cap', '--------', 'Energy Shield: 60', '--------', '+20 to maximum Mana',
    'Increases and Reductions to Spell damage also apply to Attacks', '--------', 'An eye for an eye', 'and 1000 more for the rest', '--------', 'Corrupted'].join('\n'));
  assert.deepEqual(Object.keys(helm.stats).sort(), ['# to maximum Mana', '[Base] Energy Shield']);
  assert.equal(helm.corrupted, true);
  // a unique's last mod block (no flavour, e.g. from the trade site) is kept
  const amu = parseItem(['Item Class: Amulets', 'Rarity: Unique', 'X', 'Gold Amulet', '--------', '+15 to Dexterity (implicit)', '--------', '+100 to maximum Life', 'Cannot be Frozen'].join('\n'));
  assert.equal(amu.stats['# to maximum Life'], 100);
  // Mageblood with flavour text still gets its Legacies
  const mb = parseItem(['Item Class: Belts', 'Rarity: Unique', 'Mageblood', 'Rawhide Belt', '--------', 'Has 3 Charm Slots (implicit)', '--------', 'Legacy of Ruby', '--------', 'Rivers of power flow', 'through the veins of the ancient Vaal.'].join('\n'));
  assert.equal(mb.stats['#% to Fire Resistance'], 60);
});

test('gear score: a downside on a wanted stat costs points', () => {
  const { gearScore } = require('../src/core/gearscore');
  const mk = (chaos) => parseItem(['Item Class: Body Armours', 'Rarity: Rare', 'A', 'B', '--------', 'Armour: 500', '--------', '+80 to maximum Life', '+30% to Fire Resistance', ...(chaos ? [chaos] : [])].join('\n'));
  const none = gearScore(mk(null), {}); const neg = gearScore(mk('-20% to Chaos Resistance'), {});
  assert.ok(neg.score < none.score, `${neg.score} < ${none.score}`);
  assert.equal(neg.penalties[0].label, 'Chaos res');
  assert.ok(neg.penalties[0].points < 0);
  assert.ok(gearScore(mk('-500% to Chaos Resistance'), {}).score >= 0);
});

test('gear score: the resistance you still need caps the total, not each line', () => {
  const { gearScore } = require('../src/core/gearscore');
  const mk = (mods) => parseItem(['Item Class: Rings', 'Rarity: Rare', 'A', 'Ruby Ring', '--------', 'Item Level: 80', '--------', ...mods].join('\n'));
  const resNeed = { Fire: 20, Cold: 50, Lightning: 50, Chaos: 30 };
  const split = gearScore(mk(['+25% to Fire Resistance (implicit)', '--------', '+30% to Fire Resistance']), { resNeed });
  const one = gearScore(mk(['+55% to Fire Resistance']), { resNeed });
  assert.equal(one.score, 8);
  assert.equal(one.resNote, "Fire res: you only need 20 more to cap – the rest doesn't count.");
  assert.equal(split.score, one.score);
  assert.equal(split.resNote, one.resNote);
});

test('gear score: a resistance rune does not lower the score when a mod already fills the need', () => {
  const { gearScore } = require('../src/core/gearscore');
  const mk = (rune) => parseItem(['Item Class: Helmets', 'Rarity: Rare', 'A', 'Iron Cap', '--------', 'Armour: 100', '--------', ...rune, '+30% to Fire Resistance'].join('\n'));
  const resNeed = { Fire: 20, Cold: 50, Lightning: 50, Chaos: 30 };
  const plain = gearScore(mk([]), { resNeed });
  const runed = gearScore(mk(['+12% to Fire Resistance (rune)']), { resNeed });
  assert.equal(plain.score, 8);
  assert.equal(runed.score, plain.score);
});

test('gear score: resistance at or below what you still need counts in full, with no note', () => {
  const { gearScore } = require('../src/core/gearscore');
  const mk = (fire) => parseItem(['Item Class: Rings', 'Rarity: Rare', 'A', 'Ruby Ring', '--------', 'Item Level: 80', '--------', fire].join('\n'));
  const resNeed = { Fire: 20, Cold: 50, Lightning: 50, Chaos: 30 };
  const below = gearScore(mk('+10% to Fire Resistance'), { resNeed });
  const exact = gearScore(mk('+20% to Fire Resistance'), { resNeed });
  assert.equal(below.score, 4);
  assert.equal(below.resNote, null);
  assert.equal(exact.score, 8);
  assert.equal(exact.resNote, null);
});

test('advanced copy: each mod line gets its tier, affix name and roll', () => {
  const { parseItem } = require('../src/core/parser');
  const it = parseItem('Item Class: Rings\nRarity: Rare\nGale Loop\nTwo-Stone Ring\n--------\nItem Level: 84\n--------\n{ Prefix Modifier "Virile" (Tier: 3) — Life }\n+68(60-69) to maximum Life\n{ Suffix Modifier "of the Furnace" (Tier: 2) — Elemental, Fire, Resistance }\n+42(42-45)% to Fire Resistance');
  const life = it.lines.find((l) => /maximum Life/.test(l.text));
  assert.deepStrictEqual([life.tier, life.affix, life.roll], [3, 'Virile', 89]);
  assert.strictEqual(it.lines.find((l) => /Fire Resistance/.test(l.text)).tier, 2);
  assert.ok(!Object.prototype.hasOwnProperty.call(it.lines, 'push'));
});

test('trade listings: tiers from the trade site', () => {
  const L = require('../src/core/listing');
  const it = L.listingToItem({ item: { rarity: 'Rare', name: 'Rift Band', typeLine: 'Two-Stone Ring', ilvl: 84, frameType: 2, explicitMods: ['+68 to maximum Life'],
    extended: { mods: { explicit: [{ name: 'Virile', tier: 'P3' }] }, hashes: { explicit: [['explicit.stat_3299347043', [0]]] } } } }, 'Rings');
  assert.strictEqual(it.lines.find((l) => /maximum Life/.test(l.text)).tier, 3);
});

test('store keeps a linked build per character', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2uc-'));
  const s = new Store(dir);
  s.setBuildSource({ type: 'pobbin', url: 'https://pobb.in/abc' });
  const first = s.data.activeProfile;
  s.createProfile('Second', false);
  assert.equal(s.buildSource(), null);
  s.switchProfile(first);
  assert.equal(s.buildSource().url, 'https://pobb.in/abc');
  const s2 = new Store(dir);
  assert.equal(s2.buildSource().type, 'pobbin');
  s2.setBuildSource(null);
  assert.equal(new Store(dir).buildSource(), null);
});

test('jewel slots: more than 6, and only the needed ones are shown', () => {
  const { SLOT_GROUPS, JEWEL_MAX, visibleJewels, groupOf } = require('../src/core/slots');
  assert.equal(SLOT_GROUPS.Jewel.length, JEWEL_MAX);
  assert.equal(groupOf('Jewel 14'), 'Jewel');
  assert.deepEqual(visibleJewels({}), ['Jewel 1', 'Jewel 2', 'Jewel 3', 'Jewel 4', 'Jewel 5', 'Jewel 6']);
  assert.equal(visibleJewels({ 'Jewel 9': {} }).length, 10);
});

test('a new empty character has nothing of the one you were on; Start again clears one in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2uc-fresh-'));
  const s = new Store(dir);
  s.setEquipped('Helmet', parseItem(HELMET_OLD));
  s.setWeight('# to maximum Life', 5);
  s.setSetting('build', 'djinn-varashta');
  s.setSetting('resists', { fire: 80, cold: 80, lightning: 80, cap: 75, source: 'pob' });
  s.setSetting('ignoreStats', ['# to Accuracy Rating']);
  s.setBuildSource({ type: 'pobbin', url: 'https://pobb.in/abc' });
  s.setSetting('pobCI', { main: true });
  const fresh = s.createProfile('League starter', false);
  assert.deepStrictEqual(s.equipped, {});
  assert.equal(s.weights['# to maximum Life'], 1);
  assert.equal(s.settings.build, 'life-res'); // the default gear score profile, not the old character's
  assert.equal(s.settings.resists, null);
  assert.deepStrictEqual(s.settings.ignoreStats, []);
  assert.equal(s.buildSource(), null);
  assert.ok(!(fresh in s.settings.pobCI));
  // a copy takes everything, the linked build too
  s.switchProfile('main');
  const copy = s.createProfile('Copy', true);
  assert.ok(s.equipped.Helmet);
  assert.equal(s.settings.build, 'djinn-varashta');
  assert.equal(s.buildSource().url, 'https://pobb.in/abc');
  assert.equal(s.settings.pobCI[copy], true);
  // Start again: same name and place, a new id, nothing kept
  const names = s.listProfiles().map((p) => p.name);
  const r = s.resetProfile(copy);
  assert.equal(r.old, copy);
  assert.notEqual(r.id, copy);
  assert.equal(s.data.activeProfile, r.id);
  assert.deepStrictEqual(s.listProfiles().map((p) => p.name), names);
  assert.deepStrictEqual(s.equipped, {});
  assert.equal(s.settings.resists, null);
  assert.equal(s.buildSource(), null);
  assert.ok(!s.profileOf(copy) && !(copy in s.settings.pobCI));
  // resetting another character keeps you where you are
  s.resetProfile(fresh);
  assert.equal(s.data.activeProfile, r.id);
  s.switchProfile('main');
  assert.ok(s.equipped.Helmet); // the original is untouched
  const s2 = new Store(dir);
  assert.equal(s2.listProfiles().length, 3);
  s2.deleteProfile('main');
  assert.ok(!('main' in (s2.settings.pobCI || {})));
});

test('store: a character linked to its in-game name, one name per game', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2uc-'));
  const s = new Store(dir);
  const main = s.data.activeProfile;
  const lev = s.createProfile('Leveller', false);
  assert.ok(s.linkProfile(main, '  MainGuy '));
  assert.ok(s.linkProfile(lev, 'LeagueMerc'));
  assert.equal(s.profileForGameChar(s.activeGame(), 'mainguy'), main);
  assert.equal(s.profileForGameChar(s.activeGame(), 'LeagueMerc'), lev);
  assert.equal(s.profileForGameChar('poe1', 'LeagueMerc'), null);
  // the same name on another character: it moves there
  s.linkProfile(main, 'LeagueMerc');
  assert.equal(s.profileForGameChar(s.activeGame(), 'LeagueMerc'), main);
  assert.equal(s.listProfiles().find((p) => p.id === lev).gameChar, null);
  // kept when switching and saved
  s.switchProfile(main); s.switchProfile(lev);
  const s2 = new Store(dir);
  assert.equal(s2.listProfiles().find((p) => p.id === main).gameChar, 'LeagueMerc');
  s2.linkProfile(main, '');
  assert.equal(s2.profileForGameChar(s2.activeGame(), 'LeagueMerc'), null);
});
