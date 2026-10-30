'use strict';

// Runs Path of Building's calculations in a child process (pob/server.lua inside PoB's own
// LuaJIT, hosted by pobhost.exe on Windows; on Linux the bundled LuaJIT runs it directly) and asks it what an item would change on your build.
//
//   const eng = createEngine({ log, appPath, resourcesPath, packaged })
//   await eng.loadBuild(xml)            -> { className, ascendancy, level, mainSkill, stats }
//   await eng.evalItems([{ slot, text }]) -> [{ ok, slot, before, after } | { ok:false, error }]
//
// The process starts on first use, is restarted if it dies, and is stopped after a while
// without requests to give the memory back.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// game: 'poe2' (Path of Building 2, in pob/) or 'poe1' (Path of Building Community, in pob1/).
// Both run in the same host and LuaJIT, which live with PoE2's copy (pob/runtime).
function createEngine({ log = () => {}, appPath, resourcesPath, packaged, game = 'poe2', onFail = () => {} }) {
  const dir = game === 'poe1' ? 'pob1' : 'pob';
  const base = packaged ? path.join(resourcesPath, dir) : path.join(appPath, 'vendor', dir);
  const serverLua = packaged ? path.join(resourcesPath, 'pob', 'server.lua') : path.join(appPath, 'pob', 'server.lua');
  const srcDir = path.join(base, 'src');
  const runtimeDir = packaged ? path.join(resourcesPath, 'pob', 'runtime') : path.join(appPath, 'vendor', 'pob', 'runtime'); // the host
  const luaDir = path.join(base, 'runtime', 'lua'); // this PoB's own Lua libraries
  const tag = game === 'poe1' ? 'pob1' : 'pob';
  log = ((l) => (m) => l(String(m).replace(/^pob:/, tag + ':')))(log);

  let proc = null; let ready = null; let buf = ''; let nextId = 1;
  const waiting = new Map();
  let buildXml = null; let buildInfo = null; let loading = null;
  let idleTimer = null;
  let lastError = null;

  function hostCommand() {
    // paths relative to PoB's src folder (the working directory): Lua opens files with ANSI paths,
    // which breaks on Windows user names outside the system code page
    const script = path.relative(srcDir, serverLua);
    if (process.env.POB_LUAJIT) return { cmd: process.env.POB_LUAJIT, args: [script] }; // dev/test on Linux
    if (process.platform === 'win32') return { cmd: path.join(runtimeDir, 'pobhost.exe'), args: [script] };
    if (process.platform === 'linux') return { cmd: path.join(runtimeDir, 'linux', 'luajit'), args: [script], moduleDir: path.join(runtimeDir, 'linux') };
    return null;
  }

  // (asked before every judgement: once the files are there, they stay)
  let isAvailable = false;
  function available() {
    if (isAvailable) return true;
    const h = hostCommand();
    isAvailable = !!(h && fs.existsSync(h.cmd) && fs.existsSync(path.join(srcDir, 'HeadlessWrapper.lua')) && fs.existsSync(serverLua) && fs.existsSync(path.join(path.dirname(serverLua), 'server-checks.lua')));
    return isAvailable;
  }

  function failAll(err) {
    for (const [, w] of waiting) { clearTimeout(w.timer); w.reject(err); }
    waiting.clear();
  }

  let failedAt = 0;
  function start() {
    if (ready) return ready;
    // don't keep trying (and waiting) when it just failed to start
    if (failedAt && Date.now() - failedAt < 10 * 60000) return Promise.reject(new Error('Path of Building failed to start: ' + (lastError || 'unknown error')));
    const h = hostCommand();
    if (!available()) return Promise.reject(new Error('The Path of Building engine is not installed with this copy of the app.'));
    ready = new Promise((resolve, reject) => {
      const t0 = Date.now();
      log('pob: starting the Path of Building engine');
      const me = spawn(h.cmd, h.args, {
        cwd: srcDir, windowsHide: true,
        env: (() => { const rt = path.relative(srcDir, runtimeDir); const ld = path.relative(srcDir, luaDir); return { ...process.env, POB_GAME: game, POBHOST_DIR: process.env.POBHOST_DIR || (h.moduleDir ? path.relative(srcDir, h.moduleDir) : rt), POB_LUA_PATH: [path.join(ld, '?.lua'), path.join(ld, '?', 'init.lua')].join(';') }; })(),
      });
      proc = me;
      proc.stdin.on('error', (err) => log('pob: ' + err.message));
      let started = false;
      const startTimer = setTimeout(() => { if (!started) { lastError = 'Path of Building took too long to start' + (errTail ? ': ' + errTail.trim().split('\n').slice(-4).join(' | ') : ''); log('pob: ' + lastError); reject(new Error(lastError)); if (proc === me) stop(); else try { me.kill(); } catch (_) {} } }, 90000);
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        if (proc !== me) return;
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
          if (!line.startsWith('@@')) continue;
          let msg; try { msg = JSON.parse(line.slice(2)); } catch (_) { continue; }
          if (msg.ready === false) { lastError = String(msg.error || 'unknown error').split('\n').filter(Boolean).slice(0, 4).join(' | '); log('pob: Path of Building could not start: ' + lastError); clearTimeout(startTimer); reject(new Error('Path of Building could not start: ' + lastError)); continue; }
          if (msg.ready) { started = true; clearTimeout(startTimer); log(`pob: engine ready (PoB ${msg.version || '?'}, ${Date.now() - t0} ms)`); resolve(msg); continue; }
          const w = waiting.get(msg.id);
          if (w) { waiting.delete(msg.id); clearTimeout(w.timer); w.resolve(msg); }
        }
      });
      let errTail = '';
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d) => { errTail = (errTail + d).slice(-2000); });
      proc.on('error', (err) => { lastError = err.message; log('pob: could not start: ' + err.message); if (!started) reject(err); });
      proc.on('exit', (code, signal) => {
        clearTimeout(startTimer);
        log(`pob: engine stopped (${code == null ? signal : code})${code || !started ? ': ' + errTail.trim().split('\n').slice(-6).join(' | ') : ''}`);
        // before it said it was ready, any exit is a failed start (a crash or a kill has no exit code)
        if (!started) { lastError = errTail.trim().split('\n').slice(-1)[0] || `exit ${code == null ? signal : code}`; reject(new Error('Path of Building failed to start: ' + lastError)); }
        if (proc !== me) return; // an engine we already stopped; a new one may be running
        failAll(new Error('The Path of Building engine stopped.'));
        proc = null; ready = null; buf = ''; buildInfo = null;
      });
    });
    const mine = ready;
    // only this start's failure counts: a newer engine may be running by the time it comes
    mine.catch(() => { failedAt = Date.now(); if (ready === mine) ready = null; try { onFail('start'); } catch (_) { /* only counted */ } });
    return mine;
  }

  // forget the engine straight away, so a request right after starts a new one instead of
  // writing to one that's quitting
  function stop() {
    if (!proc) return;
    const p = proc;
    proc = null; ready = null; buf = ''; buildInfo = null;
    failAll(new Error('The Path of Building engine stopped.'));
    try { p.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n'); } catch (_) {}
    setTimeout(() => { try { p.kill(); } catch (_) {} }, 1500);
  }
  // a new build or a manual retry gets a fresh start instead of the 10-minute wait after a failure
  function resetFailure() { failedAt = 0; }

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { log('pob: idle, stopping the engine'); stop(); }, 20 * 60000);
    if (idleTimer.unref) idleTimer.unref();
  }

  async function request(obj, timeoutMs = 60000) {
    await start();
    touch();
    // after a restart or a gear/build change: (re)load first, until the loaded build is the current one
    if (obj.cmd !== 'load' && obj.cmd !== 'equip' && obj.cmd !== 'setmain') {
      for (let i = 0; i < 3 && buildXml && (!buildInfo || infoGen !== gen); i++) await (loading || loadBuild(buildXml));
    }
    if (!proc) throw new Error('The Path of Building engine stopped.');
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('Path of Building did not answer in time.'));
        // it's still busy with that request and answers one at a time, so everything after it would
        // wait (and time out) too: start a fresh engine for the next one instead
        log(`pob: no answer to ${obj.cmd} in ${Math.round(timeoutMs / 1000)} s, restarting the engine`);
        stop();
      }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ ...obj, id }) + '\n');
    });
  }

  // overrides: [{ slot, text }] items you copied in game, put into PoB's build after loading it
  let overrides = [];
  // the skill you picked as the main one ({ name, slot }), made main after each load; null: as in PoB
  let mainPick = null;
  let gen = 0; let infoGen = -1; // which build/gear version is loaded
  function loadBuild(xml, over) {
    if (xml !== buildXml) failedAt = 0;
    if (xml !== buildXml || over) gen++;
    buildXml = xml;
    if (over) overrides = over;
    buildInfo = null;
    const myGen = gen;
    const p = request({ cmd: 'load', xml }, 120000).then(async (r) => {
      if (!r.ok) { try { onFail('load'); } catch (_) { /* only counted */ } throw new Error(r.error || 'Path of Building could not load the build.'); }
      r.pobGear = r.gear;
      if (overrides.length) {
        const e = await request({ cmd: 'equip', items: overrides }, 60000);
        if (e.ok) { e.pobGear = r.gear; e.pobStats = r.stats; r = e; }
      }
      if (mainPick) {
        const m = await request({ cmd: 'setmain', pick: mainPick }, 60000);
        if (m.ok) { m.pobGear = r.pobGear; m.pobStats = r.pobStats || r.stats; m.equipped = r.equipped; m.treeConverted = r.treeConverted; m.timelessRemoved = r.timelessRemoved; r = m; }
      }
      if (myGen === gen) { buildInfo = r; infoGen = myGen; } // a newer build came in meanwhile: that one wins
      return r;
    }).finally(() => { if (loading === p) loading = null; });
    loading = p;
    return p;
  }
  // remember a build without starting the engine yet (it loads on first use)
  function setBuild(xml, over, main) { if (xml !== buildXml) failedAt = 0; buildXml = xml; overrides = over || []; mainPick = main && main.name ? { name: String(main.name), slot: main.slot || null } : null; buildInfo = null; gen++; }
  // the skills that can be the main one: [{ group, skill, name, default, item, slot, main, full }]
  async function skills(dps) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'skills', dps: !!dps }, 150000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not list the skills.');
    return r.skills || [];
  }
  function kill() { if (proc) { try { proc.kill(); } catch (_) {} } }

  async function evalItems(items) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'eval', items }, 30000 + items.length * 3000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not compare the items.');
    return r.results;
  }

  // two items together: pairs [{ a: {slot, text}, bs: [{slot, text}] }] -> [{ ok, before, results: [{ ok, after }] }]
  async function evalPairs(pairs) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const n = pairs.reduce((k, p) => k + 2 + (p.bs || []).length, 0);
    const r = await request({ cmd: 'pairs', pairs }, 30000 + n * 3000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not compare the items.');
    return r.results;
  }
  // a copied gem at its level and quality in place of the same gem in the build
  async function gemCheck(req) {
    const r = await request({ cmd: 'gemcheck', ...req }, 60000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not check the gem.');
    return r;
  }
  // every notable that can be anointed / instilled on your amulet, tried in place of its current one
  async function anointCheck(req) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'anoints', seconds: 40, ...(req || {}) }, 120000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not check anoints.');
    return r;
  }
  // PoE1: how many hits of each Path of Building boss preset you can take (Pinnacle and Uber)
  async function bossCheck(req) {
    const r = await request({ cmd: 'bosscheck', ...(req || {}) }, 120000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not run the boss check.');
    return r;
  }
  // PoE1 affix names of the top tiers of trade stats: { ids, tags, tiers } -> { [id]: [{ affix, level, type }] }
  async function affixes(req) {
    const r = await request({ cmd: 'affixes', ...req }, 60000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not read the affixes.');
    return r.affixes || {};
  }
  // what map or waystone mods do to your character: mods ["text", ...] -> { ok, before, results: [{ text, after | error }] }
  async function mapCheck(mods, enemy) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'mapcheck', mods, enemy: enemy || [] }, 30000 + mods.length * 3000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not check the map.');
    return r;
  }

  // each skill group's damage when it's the main skill -> { main, skills: [{ index, label, dps, key, minion }] }
  async function skillDps() {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'skilldps' }, 120000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not compare the skills.');
    return r;
  }

  // runes and soul cores for each socket on your gear (PoE2) -> { before, level, slots: [...] }
  async function runeCheck(req) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'runes', seconds: 50, ...(req || {}) }, 150000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not try the runes.');
    return r;
  }
  // several rune picks together: picks [{ slot, socket, rune }] -> { before, after }
  async function runeApply(picks) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'runeapply', picks }, 60000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not try the runes together.');
    return r;
  }

  // better bases of the same kind as yours: slots [{ slot, base }] -> { level, slots: [{ slot, base, score, better }] }
  async function betterBases(req) {
    const r = await request({ cmd: 'bases', ...(req || {}) }, 60000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not list the bases.');
    return r;
  }

  // every unique from PoB's item database that fits a slot, tried in your build
  async function bestUniques(opts) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'uniques', ...opts }, 180000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not try the uniques.');
    return r;
  }
  // PoB's own weighted trade search for a slot
  async function makeQuery(opts) {
    if (!buildXml) throw new Error('No Path of Building build loaded.');
    const r = await request({ cmd: 'query', ...opts }, 180000);
    if (!r.ok) throw new Error(r.error || 'Path of Building could not build a search.');
    return r;
  }

  return {
    available, start, stop, resetFailure, loadBuild, setBuild, skills, mainPick: () => mainPick, evalItems, evalPairs, mapCheck, affixes, gemCheck, bossCheck, anointCheck, makeQuery, bestUniques, skillDps, runeCheck, runeApply, betterBases,
    kill, sheet: async () => { if (!buildXml) return null; const r = await request({ cmd: "sheet" }, 60000); if (!r.ok) throw new Error(r.error || "Path of Building could not read the character."); return r; },
    ensureLoaded: async () => {
      if (!buildXml) return null;
      for (let i = 0; i < 3 && (!buildInfo || infoGen !== gen); i++) await (loading || loadBuild(buildXml));
      return buildInfo;
    },
    hasBuild: () => !!buildXml,
    info: () => buildInfo,
    lastError: () => lastError,
    game, paths: { base, srcDir, runtimeDir, luaDir, serverLua },
  };
}

module.exports = { createEngine };
