'use strict';

// The UI's look (DESIGN.md): one line icon set, no emoji-style symbols, no gradients or glow.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const UI = path.join(__dirname, '..', 'src', 'ui');
const read = (f) => fs.readFileSync(path.join(UI, f), 'utf8');
const files = (ext) => fs.readdirSync(UI).filter((f) => f.endsWith(ext));
const cssFiles = fs.readdirSync(path.join(UI, 'css')).map((f) => path.join('css', f));

test('every window loads icons.js before its other scripts', () => {
  for (const f of files('.html')) {
    const html = read(f);
    const first = html.match(/<script src="([^"]+)"/);
    assert.ok(first, `${f} has no scripts`);
    assert.strictEqual(first[1], 'icons.js', `${f} loads ${first[1]} before icons.js`);
  }
});

test('every data-icon and ICON.x used in the UI exists in icons.js', () => {
  const icons = read('icons.js');
  const used = new Set();
  for (const f of [...files('.html'), ...files('.js')].filter((x) => x !== 'icons.js')) {
    const s = read(f);
    for (const m of s.matchAll(/data-icon="([a-z]+)"/g)) used.add(m[1]);
    for (const m of s.matchAll(/window\.ICON\.([a-z]+)\b/g)) if (!['svg', 'el'].includes(m[1])) used.add(m[1]);
  }
  for (const name of used) assert.ok(new RegExp(`\\n\\s+${name}: '`).test(icons), `icon "${name}" isn't defined`);
});

test('no symbol characters that Windows draws as colour emoji', () => {
  // ⚠ ☠ ⚔ ⚙ ⚑ ◀ ▶ ☆ ★ ✎ ⊘ ◈ ✦ ↻: use ICON.* instead
  const bad = /[⚠☠⚔⚙⚑◀▶☆★✎⊘◈✦↻]/;
  for (const f of [...files('.html'), ...files('.js'), ...cssFiles]) {
    const lines = read(f).split('\n');
    lines.forEach((l, i) => assert.ok(!bad.test(l) || /^\s*\/\//.test(l), `${f}:${i + 1} uses a symbol: ${l.trim().slice(0, 80)}`));
  }
});

test('no gradients, glows or gradient text in the CSS', () => {
  for (const f of cssFiles) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/gradient\(/.test(css), `${f} has a gradient`);
    assert.ok(!/background-clip:\s*text/.test(css), `${f} has gradient text`);
    assert.ok(!/(box-shadow|drop-shadow)[^;]*(:|,|\()\s*0 0 \d+px rgba/.test(css), `${f} has a glow`);
    assert.ok(!/text-transform:\s*uppercase/.test(css), `${f} has uppercase labels`);
  }
});
