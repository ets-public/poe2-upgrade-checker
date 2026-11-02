'use strict';

const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/core/backup');
const CL = require('../src/core/changelog');

test('backup: packs data and builds, leaves out the install number and window places', () => {
  const data = { installId: 'abc', activeProfile: 'main', profiles: { main: {}, alt: {} }, settings: { hotkey: 'F2', settingsBounds: { x: 1 } } };
  const b = B.pack(data, { 'main.xml': '<x/>', '../evil.xml': 'no', 'notes.txt': 'no' }, { version: '0.5.4' });
  assert.strictEqual(b.app, 'poe-upgrade-checker');
  assert.strictEqual(b.data.installId, undefined);
  assert.strictEqual(b.data.settings.settingsBounds, undefined);
  assert.deepStrictEqual(Object.keys(b.pob), ['main.xml']);
  const u = B.unpack(JSON.stringify(b), { installId: 'here', settings: { settingsBounds: { x: 9 } } });
  assert.strictEqual(u.ok, true);
  assert.strictEqual(u.data.installId, 'here');
  assert.deepStrictEqual(u.data.settings.settingsBounds, { x: 9 });
  assert.strictEqual(u.data.settings.hotkey, 'F2');
  assert.strictEqual(u.summary.characters, 2);
});

test('backup: refuses other files and newer formats', () => {
  assert.strictEqual(B.unpack('not json').ok, false);
  assert.strictEqual(B.unpack('{"app":"other","data":{}}').ok, false);
  assert.match(B.unpack(JSON.stringify({ app: B.APP, format: 99, data: {} })).error, /newer version/);
});

const MD = '# Changelog\n\n## Unreleased\n- **Next thing:** soon.\n\n## 0.5.3 - 2026-10-30\n- **What sold:** about 3 hours *after* a check.\n- A plain fix.\n\n## 0.5.2 - 2026-10-28\n- **Older:** x.\n\n## 0.5.1 - 2026-10-26\n- **Oldest:** y.\n';

test('changelog: a version\'s notes, betas read Unreleased, everything since the last seen', () => {
  const n = CL.notesFor(MD, '0.5.3');
  assert.deepStrictEqual(n.entries[0], { title: 'What sold', text: 'about 3 hours after a check.' });
  assert.deepStrictEqual(n.entries[1], { title: null, text: 'A plain fix.' });
  assert.strictEqual(CL.notesFor(MD, '0.5.4-beta.1').entries[0].title, 'Next thing');
  assert.deepStrictEqual(CL.since(MD, '0.5.1', '0.5.3').map((s) => s.version), ['0.5.3', '0.5.2']);
  assert.ok(CL.cmp('0.5.10', '0.5.9') > 0 && CL.cmp('0.5.4-beta.1', '0.5.4') < 0 && CL.cmp('0.5.4', '0.5.4') === 0);
});
