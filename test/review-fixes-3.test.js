'use strict';

// Fixes from the November 2026 outside review: usage statistics, the key helper and trade search failures.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const trade = require('../src/core/trade');
const { PS_SCRIPT, PY_SCRIPT, KeySender, CS_SOURCE, CS_MAIN } = require('../src/keysender');

function withElectron(fake, fn) {
  const load = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? fake : load.call(this, req, ...rest); };
  try { return fn(); } finally { Module._load = load; }
}

test('trade failures: sorted into kinds, never the message', () => {
  assert.strictEqual(trade.failReason([{ status: 403, msg: 'HTTP 403' }]), 'blocked');
  assert.strictEqual(trade.failReason([{ msg: 'HTTP 403' }]), 'blocked');
  assert.strictEqual(trade.failReason([{ status: 400, msg: 'Unknown stat provided' }]), 'refused');
  assert.strictEqual(trade.failReason([{ status: 400, msg: 'Query is too complex.' }]), 'complex');
  assert.strictEqual(trade.failReason([{ msg: 'timed out' }]), 'timeout');
  assert.strictEqual(trade.failReason([{ msg: 'page load timed out' }]), 'timeout');
  assert.strictEqual(trade.failReason([{ msg: 'net::ERR_INTERNET_DISCONNECTED' }]), 'net');
  assert.strictEqual(trade.failReason([{ status: 503, msg: 'HTTP 503' }]), 'server');
  assert.strictEqual(trade.failReason([{ msg: 'something odd' }]), 'other');
  assert.strictEqual(trade.failReason([]), 'other');
  // signed in: the page timed out, then the app's own request was blocked: blocked is the telling one
  assert.strictEqual(trade.failReason([{ msg: 'timed out' }, { status: 403, msg: 'HTTP 403' }]), 'blocked');
});

test('usage statistics: starting the app is not playing a game', () => {
  const saved = [];
  const C = { store: { settings: {}, data: {}, equipped: {}, activeGame: () => 'poe2', save: () => saved.push(1) }, log: () => {} };
  const stats = withElectron({ app: { isPackaged: false, getVersion: () => '0.5.7' }, net: {} }, () => {
    delete require.cache[require.resolve('../src/features/stats')];
    return require('../src/features/stats')(C);
  });
  const realSet = global.setTimeout; const realInt = global.setInterval;
  global.setTimeout = () => 0; global.setInterval = () => 0;
  try {
    stats.start();
    const d = C.store.data.statsDay;
    assert.ok(!d || (!d.poe1 && !d.poe2), 'start marked a game as played');
    stats.count('searches');
    assert.strictEqual(C.store.data.statsDay.poe2, true, 'a trade search is playing the game you are on');
    assert.strictEqual(C.store.data.statsDay.poe1, false);
    stats.problem('trade', 'blocked'); stats.problem('trade', 'nonsense');
    assert.strictEqual(C.store.data.statsDay.e.trade, 2);
    assert.deepStrictEqual(C.store.data.statsDay.t, { blocked: 1, other: 1 });
  } finally { global.setTimeout = realSet; global.setInterval = realInt; }
});

test('key helper: Ctrl+C only when the game is in front (or the mouse is over it)', () => {
  // the C# check shared by poekeys.exe and the PowerShell fallback
  const m = CS_MAIN.match(/Regex\.IsMatch\(t, "([^"]+)"\) \|\| t\.StartsWith\("([^"]+)"\)/);
  assert.ok(m, 'IsGameTarget has the expected shape');
  const re = new RegExp(m[1]);
  const ps = (t) => re.test(t) || t.startsWith(m[2]);
  assert.ok(ps('fg=PathOfExileSteam;over=PathOfExileSteam'));
  assert.ok(ps('fg=PathOfExile_x64;over=explorer;refocused'));
  assert.ok(ps('fg=?;over=PathOfExileSteam'));
  assert.ok(!ps('fg=?;over=?'), 'an unnamed window with the mouse elsewhere is not the game');
  assert.ok(!ps('fg=?;over=WindowsTerminal'));
  assert.ok(!ps('fg=WindowsTerminal;over=PathOfExile'));
  assert.ok(PS_SCRIPT.includes('[PoeKeysMain]::IsGameTarget($target)'), 'PowerShell uses the same check');
  assert.ok(PS_SCRIPT.includes(CS_SOURCE) && PS_SCRIPT.includes(CS_MAIN));
  assert.ok(!/\$/.test(CS_SOURCE + CS_MAIN), 'no $ in the C#: PowerShell would expand it in the here-string');
  const py = PY_SCRIPT.split('\n').find((l) => l.includes('copy(parts[0]'));
  assert.ok(py.includes("startswith('fg=?;over=PathOfExile')") && !/startswith\('fg=\?;'\)/.test(py));
});

test('key helper: poekeys.exe is built and packaged, PowerShell is the fallback', () => {
  const pkg = require('../package.json');
  assert.ok(JSON.stringify(pkg.build.win.extraResources).includes('runtime/poekeys.exe'));
  const getPob = fs.readFileSync(path.join(__dirname, '..', 'tools', 'get-pob.js'), 'utf8');
  assert.ok(/buildKeys\(\);/.test(getPob));
  const k = new KeySender(() => {});
  if (process.platform !== 'win32') assert.strictEqual(k.exe, null);
  // a native helper that stops before it's ready hands over to PowerShell
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'keysender.js'), 'utf8');
  assert.ok(/mode === 'native' && !wasReady/.test(src));
});

test('Path of Building: a build file cannot run programs or load native code', () => {
  const lua = fs.readFileSync(path.join(__dirname, '..', 'pob', 'server.lua'), 'utf8');
  const boot = lua.indexOf('dofile("HeadlessWrapper.lua")');
  const lock = lua.indexOf('os.execute, io.popen, os.remove, os.rename, os.tmpname = blocked(');
  const firstRequest = lua.indexOf('io.read("*l")');
  assert.ok(boot > 0 && lock > boot && lock < firstRequest, 'locked after PoB starts, before any build is read');
  assert.ok(lua.includes('package.loadlib = blocked(') && lua.includes('package.preload.ffi = blocked('));
});

test('key helper: a press that never reached the helper does not take the next answer', async () => {
  const k = new KeySender(() => {});
  k.supported = true; k.mode = 'powershell'; k.ready = true;
  let fail = true;
  k.proc = { stdin: { write: () => { if (fail) throw new Error('EPIPE'); } } };
  assert.strictEqual(await k.copy(false), false);
  assert.strictEqual(k.waiters.length, 0);
});

test('stats page: the newest release is the newest of two on the same day', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'site-worker.js'), 'utf8');
  assert.ok(/at: String\(r\.published_at/.test(src), 'releases keep the publish time');
  assert.ok(!/a\.day < b\.day \? 1 : -1/.test(src), 'the old sort is gone');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'migrations', 'stats', '0003_trade_fails.sql')));
});

test('stats page: the key goes in a form or header, not the address', async () => {
  const had = globalThis.caches;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  try {
    const w = (await import(require('url').pathToFileURL(path.join(__dirname, '..', 'worker', 'site-worker.js')).href)).default;
    const db = { prepare: (sql) => ({ first: async () => (/stats_key/.test(sql) ? { v: 'sekret' } : null), bind() { return this; }, all: async () => ({ results: [] }), run: async () => ({}) }) };
    const env = { STATS: db, RL_STATS: { limit: async () => ({ success: true }) } };
    const go = (url, init) => w.fetch(new Request('https://poe2upgrade.com' + url, init), env, { waitUntil() {} });
    let r = await go('/api/stats');
    assert.strictEqual(r.status, 200); assert.ok((await r.text()).includes('type="password"'));
    r = await go('/api/stats', { method: 'POST', body: new URLSearchParams({ key: 'nope' }) });
    assert.strictEqual(r.status, 401);
    r = await go('/api/stats', { method: 'POST', body: new URLSearchParams({ key: 'sekret' }) });
    assert.strictEqual(r.status, 303); assert.strictEqual(r.headers.get('location'), '/api/stats');
    const cookie = r.headers.get('set-cookie');
    assert.ok(/HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Strict/.test(cookie) && !cookie.includes('sekret'));
    r = await go('/api/stats?format=json', { headers: { Cookie: cookie.split(';')[0] } });
    assert.strictEqual(r.status, 200);
    r = await go('/api/stats?format=json', { headers: { Authorization: 'Bearer sekret' } });
    assert.strictEqual(r.status, 200);
    // an old bookmark sets the cookie and drops the key from the address
    r = await go('/api/stats?key=sekret');
    assert.strictEqual(r.status, 303); assert.strictEqual(r.headers.get('location'), '/api/stats');
  } finally { globalThis.caches = had; }
});

test('poe.ninja relay: no longer open to other websites', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'site-worker.js'), 'utf8');
  assert.ok(!src.includes('Access-Control-Allow-Origin'));
});
