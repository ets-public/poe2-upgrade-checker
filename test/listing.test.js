'use strict';

const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/core/listing');
const { currencyRatesInExalts } = require('../src/core/rates');

const RESULT = {
  id: 'abc123',
  listing: {
    indexed: '2026-10-20T08:00:00Z',
    whisper: '@Seller Hi, I would like to buy your Grim Grasp Sorcerer Gloves listed for 3 divine in Forbidden Rites',
    account: { name: 'SellerAcc', lastCharacterName: 'SellerChar', online: { league: 'Forbidden Rites' } },
    price: { type: '~price', amount: 3, currency: 'divine' },
  },
  item: {
    rarity: 'Rare', name: 'Grim Grasp', typeLine: 'Sorcerer Gloves', ilvl: 81,
    properties: [
      { name: 'Quality', values: [['+20%', 1]] },
      { name: '[EnergyShield|Energy Shield]', values: [['250', 1]] },
    ],
    runeMods: ['+12% to [Resistances|Cold Resistance]'],
    explicitMods: ['+80 to maximum [Life|Life]', '+40% to [Fire|Fire] [Resistances|Resistance]', '52% increased [EnergyShield|Energy Shield]'],
  },
};

test('listing -> item with markup cleaned and tags kept', () => {
  const it = L.listingToItem(RESULT, 'Gloves');
  assert.equal(it.slot, 'Gloves');
  assert.equal(it.name, 'Grim Grasp');
  assert.equal(it.baseType, 'Sorcerer Gloves');
  assert.equal(it.itemLevel, 81);
  assert.equal(it.stats['[Base] Energy Shield'], 250);
  assert.equal(it.stats['# to maximum Life'], 80);
  assert.equal(it.stats['#% to Fire Resistance'], 40);
  assert.equal(it.stats['#% to Cold Resistance'], 12);
  assert.equal(it.lines.find((l) => /Cold/.test(l.text)).tag, 'rune');
});

test('summary: price, seller, whisper', () => {
  const rates = { divine: 700, exalted: 1, chaos: 10 };
  const s = L.summarise(RESULT, 'Gloves', rates);
  assert.equal(s.priceText, '3 div');
  assert.equal(s.priceEx, 2100);
  assert.equal(s.seller, 'SellerChar');
  assert.equal(s.online, true);
  assert.equal(s.instant, false);
  assert.match(s.whisper, /^@Seller/);
  const merchant = L.summarise({ ...RESULT, listing: { ...RESULT.listing, whisper: undefined, price: { amount: 50, currency: 'exalted' } } }, 'Gloves', rates);
  assert.equal(merchant.instant, true);
  assert.equal(merchant.priceEx, 50);
  assert.equal(L.priceInEx({ amount: 2, currency: 'mystery' }, rates), null);
});

test('currency rates from poe.ninja', () => {
  const r = currencyRatesInExalts({ core: { primary: 'exalted' }, lines: [{ id: 'divine', primaryValue: 700 }, { id: 'chaos', primaryValue: 12.5 }] });
  assert.deepEqual(r, { exalted: 1, divine: 700, chaos: 12.5 });
  const r2 = currencyRatesInExalts({ lines: [{ id: 'divine', primaryValue: 30 }, { id: 'exalted', primaryValue: 0.2 }] });
  assert.equal(r2.divine, 150);
});

test('mods sent as objects ({ description }) are read', () => {
  const r = { id: 'x', listing: { price: { amount: 1, currency: 'divine' }, account: { name: 'A' } }, item: {
    rarity: 'Rare', name: 'Empyrean Knot', typeLine: 'Iron Ring', ilvl: 82,
    implicitMods: [{ description: 'Adds 1 to 4 [Physical|Physical] Damage to Attacks', hash: 'implicit.stat_3032590688' }],
    explicitMods: [{ description: '+56 to maximum [Mana|Mana]' }, { description: "Minions deal 21% increased Damage if you've Hit Recently" }],
  } };
  const s = L.summarise(r, 'Rings', { divine: 700 });
  assert.strictEqual(s.item.stats['# to maximum Mana'], 56);
  assert.ok(s.item.lines.some((l) => l.tag === 'implicit' && /Adds 1 to 4 Physical Damage/.test(l.text)));
  assert.ok(!s.item.listingText.includes('[object Object]'));
});

test('multi-line mod strings, odd mod fields and bad prices', () => {
  const it = L.listingToItem({ item: { typeLine: 'Ruby Ring', explicitMods: ['+10% to Fire Resistance\n+10% to Cold Resistance', 5, null], implicitMods: 'nope', properties: 'x' } }, 'Rings');
  assert.equal(it.stats['#% to Fire Resistance'], 10);
  assert.equal(it.stats['#% to Cold Resistance'], 10);
  assert.equal(Object.keys(it.stats).length, 2);
  for (const amount of ['', null, undefined, 'abc', 0]) {
    const s = L.summarise({ item: { typeLine: 'Ruby Ring' }, listing: { price: { amount, currency: 'divine' } } }, 'Rings', { divine: 300 });
    assert.equal(s.priceText, 'no price', String(amount));
    assert.equal(s.priceEx, null);
    assert.equal(s.price, null);
  }
  assert.equal(L.formatPrice({ amount: 2, currency: 'Divine' }), '2 div');
});

test('sameItem: your own listing of the item you checked is found, a similar item is not', () => {
  const { parseItem } = require('../src/core/parser');
  const { sameItem } = require('../src/core/listing');
  const mine = parseItem('Item Class: Rings\nRarity: Rare\nChimeric Hold\nRuby Ring\n--------\nItem Level: 81\n--------\n{ Implicit Modifier }\n+25(20-30)% to Fire Resistance\n--------\n{ Prefix Modifier "Manipulator\'s" }\nMinions deal 26(25-27)% increased Damage\n{ Prefix Modifier "Fleet" (Tier: 6) }\n+67(52-79) to Evasion Rating\n{ Suffix Modifier "of the Lightning" (Tier: 2) }\n+36(36-40)% to Lightning Resistance\n--------\nCorrupted\n--------\nNote: ~b/o 200 divine');
  const listed = parseItem('Item Class: Rings\nRarity: Rare\nChimeric Hold\nRuby Ring\n--------\nItem Level: 81\n--------\n+25% to Fire Resistance (implicit)\n--------\n+67 to Evasion Rating\n+36% to Lightning Resistance\nMinions deal 26% increased Damage\n--------\nCorrupted');
  const other = parseItem('Item Class: Rings\nRarity: Rare\nDoom Loop\nRuby Ring\n--------\nItem Level: 81\n--------\n+25% to Fire Resistance (implicit)\n--------\n+68 to Evasion Rating\n+36% to Lightning Resistance\nMinions deal 26% increased Damage\n--------\nCorrupted');
  assert.strictEqual(sameItem(mine, listed), true);
  assert.strictEqual(sameItem(mine, other), false); // one roll differs: someone else's ring
  const two = parseItem('Item Class: Rings\nRarity: Magic\nRuby Ring of Fire\nRuby Ring\n--------\nItem Level: 81\n--------\n+25% to Fire Resistance (implicit)\n--------\n+30% to Cold Resistance');
  assert.strictEqual(sameItem(two, two), false); // too few rolled mods to tell
});
