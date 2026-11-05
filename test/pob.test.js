'use strict';

const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const P = require('../src/core/pob');
const { parseItem } = require('../src/core/parser');

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="92" className="Sorceress" ascendClassName="Disciple of Varashta">
    <PlayerStat stat="FireResist" value="75"/>
    <PlayerStat stat="FireResistOverCap" value="18"/>
    <PlayerStat stat="ColdResist" value="62"/>
    <PlayerStat stat="LightningResist" value="75"/>
    <PlayerStat stat="LightningResistOverCap" value="4"/>
    <PlayerStat stat="ChaosResist" value="-10"/>
  </Build>
  <Tree><Spec><Sockets><Socket nodeId="1" itemId="0"/><Socket nodeId="2" itemId="4"/></Sockets></Spec></Tree>
  <Items activeItemSet="2">
    <Item id="1">Rarity: RARE
Doom Vise
Sorcerer Gloves
Unique ID: abc
Item Level: 81
Quality: 20
Sockets: S S
LevelReq: 65
Implicits: 0
{tags:resistance}+39% to Lightning Resistance
{crafted}{range:0.5}+33 to maximum Life
{rune}+12% to Cold Resistance
75% increased Energy Shield</Item>
    <Item id="2">Rarity: UNIQUE
Mageblood
Utility Belt
Implicits: 1
+20 to Strength
Has 3 Charm Slots</Item>
    <Item id="3">Rarity: RARE
Victory Star
Omen Sceptre
Item Level: 82
Implicits: 0
+4 to Level of all Minion Skills
Allies in your Presence deal 81% increased Damage</Item>
    <Item id="4">Rarity: RARE
Grim Hope
Sapphire
Implicits: 0
Minions deal 12% increased Damage</Item>
    <ItemSet id="1"><Slot name="Gloves" itemId="0"/></ItemSet>
    <ItemSet id="2">
      <Slot name="Gloves" itemId="1"/>
      <Slot name="Belt" itemId="2"/>
      <Slot name="Weapon 1" itemId="3"/>
      <Slot name="Helmet" itemId="0"/>
    </ItemSet>
  </Items>
</PathOfBuilding2>`;

const code = zlib.deflateSync(Buffer.from(XML)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

test('decodes a PoB code and reads the active item set', () => {
  const xml = P.decodeCode(code);
  const r = P.parsePob(xml);
  assert.deepEqual(Object.keys(r.items).sort(), ['Belt', 'Gloves', 'Jewel 1', 'Weapon']);
  assert.deepEqual(r.resists, { fire: 93, cold: 62, lightning: 79, chaos: -10 });
  assert.equal(r.character.ascendancy, 'Disciple of Varashta');
  const gloves = parseItem(r.items.Gloves);
  assert.equal(gloves.slot, 'Gloves');
  assert.equal(gloves.name, 'Doom Vise');
  assert.equal(gloves.itemLevel, 81);
  assert.equal(gloves.stats['# to maximum Life'], 33);
  assert.equal(gloves.lines.find((l) => /Life/.test(l.text)).tag, 'crafted');
  assert.equal(gloves.lines.find((l) => /Cold/.test(l.text)).tag, 'rune');
  const belt = parseItem(r.items.Belt);
  assert.equal(belt.rarity, 'Unique');
  assert.equal(belt.lines.find((l) => /Strength/.test(l.text)).tag, 'implicit');
  const wpn = parseItem(r.items.Weapon);
  assert.equal(wpn.itemClass, 'Sceptres');
  assert.equal(wpn.stats['# to Level of all Minion Skills'], 4);
  assert.equal(parseItem(r.items['Jewel 1']).slot, 'Jewel');
  assert.equal(r.missingBase, 2); // gloves + weapon have no base values in PoB text
});

test('raw XML and pobb.in links', () => {
  assert.equal(Object.keys(P.parsePob(P.decodeCode(XML)).items).length, 4);
  assert.equal(P.pobbinRawUrl('https://pobb.in/AbC_12-x'), 'https://pobb.in/AbC_12-x/raw');
  assert.equal(P.pobbinRawUrl('https://pobb.in/u/someone/AbC'), 'https://pobb.in/AbC/raw');
  assert.equal(P.pobbinRawUrl('eNrtxyz'), null);
  assert.throws(() => P.decodeCode('not a code!!'));
});

test('a crafted item-set id can\'t hang the import, and a zip bomb is refused', () => {
  const P = require('../src/core/pob');
  const zlib = require('zlib');
  const evil = '<PathOfBuilding2><Build level="1"/><Items activeItemSet="(.*)*(.*)*(.*)*(.*)*Z"><ItemSet id="1">' + 'a'.repeat(40) + '</ItemSet></Items></PathOfBuilding2>';
  const t = Date.now();
  try { P.parsePob(evil); } catch (_) { /* may refuse, must not hang */ }
  assert.ok(Date.now() - t < 1000, 'took ' + (Date.now() - t) + ' ms');
  const bomb = zlib.deflateSync(Buffer.alloc(25 * 1024 * 1024, 32)).toString('base64');
  assert.throws(() => P.decodeCode(bomb), /too big/);
});

test('a unique with variants keeps only the selected variant', () => {
  const { convertItem } = require('../src/core/pob');
  const raw = 'Rarity: UNIQUE\nKaom\'s Heart\nGlorious Plate\nVariant: Pre 3.0.0\nVariant: Current\nSelected Variant: 2\nImplicits: 0\n{variant:1}+20% to Fire Resistance\n{variant:2}+500 to maximum Life\n{variant:1}+(800-1000) to maximum Life';
  const t = convertItem(raw, 'Body Armour').text;
  assert.match(t, /\+500 to maximum Life/);
  assert.doesNotMatch(t, /Fire Resistance|900/);
  // no "Selected Variant": PoB uses the last one
  assert.doesNotMatch(convertItem(raw.replace('Selected Variant: 2\n', ''), 'Body Armour').text, /Fire Resistance/);
});

test('main skill list: a skill the build holds twice is listed once, as the copy really used', () => {
  // your socketed Kelari, the copy an ascendancy passive grants, and one granted by a weapon
  const list = [
    { name: 'Kelari', slot: null, dps: 104239, minion: true },
    { name: 'Skeletal Warrior', slot: null, dps: 4015, minion: true },
    { name: 'Kelari', slot: null, dps: 950, minion: true },
    { name: 'Skeletal Warrior', slot: 'Weapon 1', dps: 4015, minion: true },
  ];
  const r = P.mainSkillOptions(list, { name: 'Kelari', slot: null });
  assert.deepStrictEqual(r.list.map((c) => [c.name, c.slot, c.dps]), [['Kelari', null, 104239], ['Skeletal Warrior', null, 4015], ['Skeletal Warrior', 'Weapon 1', 4015]]);
  assert.strictEqual(r.pickIndex, 0);
  assert.strictEqual(list.length, 4); // the list passed in is left as it was
  // same choices as setMain in pob/server.lua: the slot if it's given, else the first with that name
  assert.strictEqual(P.mainSkillOptions(list, { name: 'Skeletal Warrior', slot: 'Weapon 1' }).pickIndex, 2);
  assert.strictEqual(P.mainSkillOptions(list, { name: 'Skeletal Warrior', slot: null }).pickIndex, 1);
  assert.strictEqual(P.mainSkillOptions(list, { name: 'Kelari', slot: 'Weapon 2' }).pickIndex, 0);
  assert.strictEqual(P.mainSkillOptions(list, { name: 'Gone', slot: null }).pickIndex, -1);
  assert.strictEqual(P.mainSkillOptions(list, null).pickIndex, -1);
});

test('main skill list: Path of Building\'s main skill keeps its mark when it was the left-out copy', () => {
  const r = P.mainSkillOptions([{ name: 'Kelari', slot: null }, { name: 'Kelari', slot: null, main: true }], null);
  assert.strictEqual(r.list.length, 1);
  assert.strictEqual(r.list[0].main, true);
});
