'use strict';

// Fixes from the November 2026 bug and security audit.
const test = require('node:test');
const assert = require('node:assert');
const K = require('../src/core/keys');
const F = require('../src/core/filterfile');
const R = require('../src/core/regexbuild');
const M = require('../src/core/regexmods');

test('hotkeys: the same key written another way is the same key', () => {
  assert.ok(K.sameKey('Ctrl+Shift+X', 'Shift+Ctrl+X'));
  assert.ok(K.sameKey('CommandOrControl+Shift+X', 'ctrl+shift+x'));
  assert.ok(K.sameKey('Control+F5', 'CmdOrCtrl+F5'));
  assert.ok(K.sameKey('Ctrl+Plus', 'Ctrl++'));
  assert.ok(!K.sameKey('Ctrl+Shift+X', 'Ctrl+X'));
  assert.ok(!K.sameKey('F2', 'F3'));
  assert.ok(!K.sameKey('', ''), 'no key is not a clash');
});

test('hotkeys: a clash names the app key, never the one being set', () => {
  const keys = [{ id: 'copy', what: 'Check item', key: 'F2' }, { id: 'filter', what: 'Loot filter editor', key: 'Ctrl+Shift+F' }];
  assert.strictEqual(K.clash('Shift+Ctrl+F', keys, 'regex').what, 'Loot filter editor');
  assert.strictEqual(K.clash('Ctrl+Shift+F', keys, 'filter'), null);
  assert.strictEqual(K.clash('F4', keys, 'regex'), null);
  assert.strictEqual(K.clash('', keys, 'regex'), null);
});

test('loot filter: a line break in a name cannot write lines of its own', () => {
  const edits = F.setEdit([], 'Foo\nHide\nShow', { show: true, style: { SetFontSize: ['40'] } });
  const sec = F.section(edits);
  const lines = sec.split('\n');
  assert.ok(!lines.some((l) => /^(Hide|Show")$/.test(l.trim())), sec);
  const base = lines.filter((l) => l.includes('BaseType =='));
  assert.strictEqual(base.length, 1);
  // a poe.ninja name goes in as it is (priceEdits), and is cleaned when written
  const auto = F.section(F.priceEdits([{ name: 'Bar\r\nHide', div: 2 }]));
  assert.ok(auto.split('\n').filter((l) => /BaseType ==/.test(l)).every((l) => !/[\r]/.test(l) && /"BarHide"/.test(l)), auto);
  assert.ok(!auto.split('\n').some((l) => l.trim() === 'Hide'), auto);
});

test('search strings: a max that is not a number adds no "null" group', () => {
  for (const max of ['-1', 'abc']) {
    const r = R.buildMap({ game: 'poe2', maxs: { tier: max } }, M.flat('poe2'));
    assert.ok(!/null/.test(r.text), `${max}: ${r.text}`);
  }
});

test('settings: every key a page sets is one setting:set takes, and paths or hotkeys are not', () => {
  const fs = require('fs'); const path = require('path');
  const { settable } = require('../src/core/settable');
  const dir = path.join(__dirname, '..', 'src', 'ui');
  const used = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of t.matchAll(/setSetting\(\s*'([A-Za-z]+)'/g)) used.add(m[1]);
    for (const m of t.matchAll(/\[([^\]]*)\]\.forEach\(\(k\) => [^\n]*\n[^\n]*\n\s*await window\.api\.setSetting\(k,/g)) for (const k of m[1].matchAll(/'([A-Za-z]+)'/g)) used.add(k[1]);
  }
  assert.ok(used.size > 20, 'found the keys');
  assert.deepStrictEqual([...used].filter((k) => !settable(k)), []);
  for (const k of ['hotkey', 'filterFolders', 'filterEditorFile', 'route', '__proto__', 'constructor', 7]) assert.ok(!settable(k), String(k));
});

test('backup: a shared backup keeps this PC folders and Client.txt paths', () => {
  const B = require('../src/core/backup');
  const theirs = B.pack({ settings: { filterFolders: { poe2: 'C:\\Theirs' }, route: { follow: true, logPath: { poe2: 'C:\\Theirs\\Client.txt' } }, league: 'Std' } }, {});
  assert.strictEqual(theirs.data.settings.filterFolders, undefined);
  assert.strictEqual(theirs.data.settings.route.logPath, undefined);
  // an older or hand-made file that still has them
  const file = { app: B.APP, format: 1, data: { settings: { filterFolders: { poe2: 'C:\\Theirs' }, route: { follow: true, logPath: { poe2: 'C:\\Theirs\\Client.txt' } } } } };
  const mine = { settings: { route: { logPath: { poe2: 'D:\\Mine\\Client.txt' } } } };
  const r = B.unpack(JSON.stringify(file), mine);
  assert.ok(r.ok);
  assert.strictEqual(r.data.settings.filterFolders, undefined);
  assert.deepStrictEqual(r.data.settings.route, { follow: true, logPath: { poe2: 'D:\\Mine\\Client.txt' } });
});
