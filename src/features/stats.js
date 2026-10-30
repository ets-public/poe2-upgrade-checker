'use strict';

// Anonymous usage statistics: how many people use the app each day, in which game, which parts of
// it, and what went wrong. Once at start and every few hours the app sends poe2upgrade.com/api/ping:
//   { id: a random number made on this PC, v: app version, p: win32/linux, beta: true/false,
//     poe1/poe2: whether you used that game today,
//     n: how many times today: { checks: F2 and Ctrl+C item checks, prices: F3 price checks,
//        searches: trade searches, route: League start steps moved on },
//     s: how far you've set it up (yes/no): { guide: first-run guide done, build: a Path of Building
//        build loaded, gear: gear saved, checked: ever checked an item },
//     e: problems today (counts): { hotkey: the check hotkey isn't registered, pob: Path of Building
//        failed to start or load, trade: trade searches that failed } }
// Only numbers and yes/no: no account, character, items, builds, searches or what you searched
// for; the site doesn't keep IP addresses. Settings → "Send anonymous usage statistics" turns it
// off (nothing is sent then).
const crypto = require('crypto');
const { app, net } = require('electron');

const URL = 'https://poe2upgrade.com/api/ping';
const EVERY = 3 * 3600 * 1000;

module.exports = function (C) {
  const on = () => C.store.settings.usageStats !== false;
  const today = () => new Date().toISOString().slice(0, 10);
  function installId() {
    let id = C.store.data.installId;
    if (!/^[0-9a-f]{32}$/.test(id || '')) { id = crypto.randomBytes(16).toString('hex'); C.store.data.installId = id; C.store.save(); }
    return id;
  }
  // which games you used today (a copied item, or the game the app is on at start)
  function day() {
    const d = C.store.data.statsDay;
    if (!d || d.day !== today()) C.store.data.statsDay = { day: today(), poe1: false, poe2: false, sent: null, n: {}, e: {} };
    const x = C.store.data.statsDay;
    if (!x.n) x.n = {};
    if (!x.e) x.e = {};
    return x;
  }
  // today's counts: what was used, and problems (saved with the rest, sent with the next ping)
  const COUNTS = ['checks', 'prices', 'searches', 'route'];
  const PROBLEMS = ['hotkey', 'pob', 'trade'];
  let saveSoon = null;
  function bump(group, key) {
    const d = day();
    d[group][key] = Math.min(9999, (d[group][key] || 0) + 1);
    clearTimeout(saveSoon); saveSoon = setTimeout(() => { try { C.store.save(); } catch (_) { /* next time */ } }, 5000);
  }
  function count(what) { if (COUNTS.includes(what)) { bump('n', what); if (what === 'checks' && !C.store.data.statsChecked) { C.store.data.statsChecked = true; } } }
  function problem(what) { if (PROBLEMS.includes(what)) bump('e', what); }
  // how far it's set up (yes/no), as it is now
  function setup() {
    let build = false; try { build = !!C.pobXml(); } catch (_) { /* no build */ }
    return { guide: C.store.settings.wizardDone === true, build, gear: Object.keys(C.store.equipped || {}).length > 0, checked: !!C.store.data.statsChecked };
  }
  let timer = null;
  function used(game) {
    if (!['poe1', 'poe2'].includes(game)) return;
    const d = day();
    if (d[game]) return;
    d[game] = true; C.store.save();
    // a new game today: say so soon (once), not straight away on every copy
    clearTimeout(timer); timer = setTimeout(send, 60000);
  }
  let last = 0;
  async function send() {
    if (!on() || !app.isPackaged && !process.env.POE_STATS_DEV) return false;
    // a first run: nothing until you've been through the first-run guide, which has the opt-out
    if (C.store.settings.wizardDone !== true && !Object.keys(C.store.equipped || {}).length) return false;
    const d = day();
    // the check hotkey not registered right now counts as today's problem (once)
    if (C.hotkeyStatus && C.hotkeyStatus.ok === false && !d.e.hotkey) d.e.hotkey = 1;
    const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, Math.max(0, Math.min(9999, Number(o[k]) || 0))]));
    const body = { id: installId(), v: app.getVersion(), p: process.platform, beta: /-/.test(app.getVersion()), poe1: !!d.poe1, poe2: !!d.poe2,
      n: pick(d.n, COUNTS), s: setup(), e: pick(d.e, PROBLEMS) };
    const sig = JSON.stringify(body);
    if (d.sent === sig && Date.now() - last < EVERY - 60000) return false; // nothing new
    try {
      const res = await net.fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': C.UA }, body: sig });
      if (res.ok) { d.sent = sig; last = Date.now(); C.store.save(); return true; }
      C.log(`usage ping: HTTP ${res.status}`);
    } catch (err) { C.log('usage ping: ' + (err.message || err)); }
    return false;
  }
  function start() {
    used(C.store.activeGame());
    setTimeout(send, 30000);
    setInterval(send, EVERY);
  }
  return { used, send, start, count, problem };
};
