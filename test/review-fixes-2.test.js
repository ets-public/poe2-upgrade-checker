'use strict';

// Fixes from the November 2026 review: the filter editor, the search string builder and packaging.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const F = require('../src/core/filterfile');
const folders = require('../src/core/gamefolders');
const { testSafe } = require('../src/core/regextest');

test('tiers by price keep an edit made while the prices were on their way', () => {
  // the file as it is when the prices arrive: you hid Chaos Orb meanwhile, and an old price tier is there
  const now = [
    { baseType: 'Chaos Orb', show: false, note: 'Chaos Orb: hidden' },
    { baseType: 'Divine Orb', show: true, auto: 'S', style: {} },
  ];
  const edits = F.withPriceTiers(now, [{ name: 'Chaos Orb', div: 0.01 }, { name: 'Exalted Orb', div: 0.3 }]);
  const chaos = edits.filter((e) => e.baseType === 'Chaos Orb');
  assert.strictEqual(chaos.length, 1);
  assert.strictEqual(chaos[0].show, false, 'your edit wins over the price tier');
  assert.ok(edits.some((e) => e.baseType === 'Exalted Orb' && e.auto === 'A'));
  assert.ok(!edits.some((e) => e.baseType === 'Divine Orb'), 'old price tiers are replaced');
});

test('search string test: a normal search still works in the worker', async () => {
  const item = 'Item Class: Waystones\nRarity: Rare\nX\nWaystone (Tier 15)\n--------\nWaystone Tier: 15\nMonster Pack Size: +32%\n--------\nMonsters reflect 10% of Physical Damage';
  const r = await testSafe('"ck size: \\+(3[0-9])" "!reflect"', item);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.groups.map((g) => g.hit), [true, true]);
  const r2 = await testSafe('"ck size: \\+3"', item);
  assert.strictEqual(r2.ok, true);
});

test('search string test: a regex that would hang is stopped, and the app keeps going', async () => {
  const t0 = Date.now();
  const r = await testSafe('"(a|aa)+$"', 'Item Class: Rings\n' + 'a'.repeat(60) + 'b', { timeoutMs: 300 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.timedOut, true);
  assert.ok(Date.now() - t0 < 3000, 'gave up in time');
});

test('Linux: the game\'s filters are looked for in Steam\'s Proton folder, in every library', () => {
  const home = '/home/p';
  const root = path.join(home, '.local', 'share', 'Steam');
  const vdf = `"libraryfolders"\n{\n "0" { "path" "${root}" }\n "1" { "path" "/mnt/games/SteamLibrary" }\n}`;
  const exists = (f) => f === root;
  const read = (f) => { if (f === path.join(root, 'steamapps', 'libraryfolders.vdf')) return vdf; throw new Error('no'); };
  const dirs = folders.documentsFolders('poe2', { platform: 'linux', home, documents: path.join(home, 'Documents'), exists, read });
  assert.ok(dirs.includes(path.join('/mnt/games/SteamLibrary', 'steamapps', 'compatdata', '2694490', 'pfx', 'drive_c', 'users', 'steamuser', 'Documents', 'My Games', 'Path of Exile 2')));
  assert.strictEqual(dirs[dirs.length - 1], path.join(home, 'Documents', 'My Games', 'Path of Exile 2'), 'your own Documents last');
  // nothing there yet: the most likely folder is your own Documents
  assert.strictEqual(folders.gameFolder('poe2', { platform: 'linux', home, documents: path.join(home, 'Documents'), exists: () => false, read }), path.join(home, 'Documents', 'My Games', 'Path of Exile 2'));
  // a folder you picked always wins
  assert.strictEqual(folders.gameFolder('poe1', { picked: '/x/filters', platform: 'linux', home, exists, read }), '/x/filters');
  // Client.txt in the game's install folder of each library
  assert.ok(folders.linuxLogPaths('poe1', { home, exists, read }).includes(path.join('/mnt/games/SteamLibrary', 'steamapps', 'common', 'Path of Exile', 'logs', 'Client.txt')));
  // Windows: just your Documents
  assert.deepStrictEqual(folders.documentsFolders('poe2', { platform: 'win32', documents: 'C:\\Users\\A\\Documents' }), [path.join('C:\\Users\\A\\Documents', 'My Games', 'Path of Exile 2')]);
});

test('packaging: the built app encrypts its cookies (your pathofexile.com sign-in) and can\'t be run as plain Node', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const f = pkg.build.electronFuses || {};
  assert.strictEqual(f.enableCookieEncryption, true);
  assert.strictEqual(f.runAsNode, false);
  assert.strictEqual(f.enableNodeOptionsEnvironmentVariable, false);
  assert.strictEqual(f.enableNodeCliInspectArguments, false);
});
