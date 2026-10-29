'use strict';

// League start: the campaign route for the game you're on, a checklist in the League start tab and a
// small overlay over the game showing the current step.
//
// Following your zones is OFF until you switch it on: then the game's own log (Client.txt) is read,
// only the lines that say which area you entered and your level (see core/route.js). Nothing is
// sent anywhere, nothing is sent to the game: GGG allows reading the log "as long as the user is
// aware of what you are doing with that data", so the tab says exactly that.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, globalShortcut, screen, dialog } = require('electron');
const routeLib = require('../core/route');
const gemLib = require('../core/gemroute');
const ROOT = path.join(__dirname, '..'); // src

const DEFAULT_OVERLAY_HOTKEY = 'Ctrl+Shift+L';
const POLL = 1000; // how often the log is checked for new lines
const TAIL = 256 * 1024; // when following starts: the end of the log, for the area you're in now

module.exports = function (C) {
  const game = () => (C.tg() === 'poe1' ? 'poe1' : 'poe2');
  const opts = () => ({ follow: false, logPath: {}, overlay: false, hotkey: DEFAULT_OVERLAY_HOTKEY, optional: true, rush: false, ...(C.store.settings.route || {}) });
  const mode = () => { const o = opts(); return { optional: o.optional !== false, rush: !!o.rush }; };
  const setOpts = (patch) => C.store.setSetting('route', { ...opts(), ...patch });
  // progress, per game: { current (step index), area, areaLevel, character, level, at }
  const progressAll = () => C.store.settings.routeProgress || {};
  const progress = (g = game()) => ({ current: 0, ...(progressAll()[g] || {}) });
  const setProgress = (g, patch) => C.store.setSetting('routeProgress', { ...progressAll(), [g]: { ...progress(g), ...patch, at: Date.now() } });

  // ---------- the route's trace (route-run.jsonl next to the log) ----------
  // Every zone and level line read, what the route did with it and why, and every step you moved by
  // hand: enough to see afterwards where following went wrong (a manual Back right after an automatic
  // move means it moved wrongly; a manual Step done means it didn't move). Only area ids, levels and
  // your character's name and level: it stays on your PC. `node tools/route-report.js` summarises it.
  const traceFile = () => path.join(app.getPath('userData'), 'route-run.jsonl');
  let lastAreaAt = 0;
  function trace(ev, data) {
    try {
      const file = traceFile();
      let size = 0; try { size = fs.statSync(file).size; } catch (_) { /* new */ }
      if (size > 5 * 1024 * 1024) { try { fs.renameSync(file, file.replace(/\.jsonl$/, '.1.jsonl')); } catch (_) { /* keep going */ } }
      fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ev, game: game(), ...data }) + '\n');
    } catch (err) { C.log('route trace: ' + err.message); }
  }
  const stepInfo = (steps, i) => (steps[i] ? { i, act: steps[i].actName, n: steps[i].i + 1, t: String(steps[i].t).slice(0, 90), in: steps[i].in, to: steps[i].to, zone: steps[i].zone } : { i, t: '(campaign done)' });

  const onRoute = (route, steps, area) => {
    if (!area || routeLib.isTown(route, area)) return false;
    const x = String(area).toLowerCase();
    return steps.some((st) => String(st.in || '').toLowerCase() === x || String(st.to || '').toLowerCase() === x);
  };
  // ---------- the act timer ----------
  // the run going on (the route's character since the last Start over) and the earlier ones, per game
  const runsAll = () => C.store.settings.routeRuns || {};
  function runs(g) { const r = runsAll()[g] || {}; return { current: r.current || null, past: Array.isArray(r.past) ? r.past : [] }; }
  function saveRuns(g, r) { C.store.setSetting('routeRuns', { ...runsAll(), [g]: { current: r.current, past: r.past.slice(0, 10) } }); }
  function tickRun(g, act, how) {
    const r = runs(g);
    if (!r.current) { if (how !== 'zone') return; r.current = routeLib.newRun(Date.now(), progress(g).character); } // a click doesn't start a run: a zone does
    routeLib.runTick(r.current, Date.now(), act, how, opts().rush);
    if (!r.current.character && progress(g).character) r.current.character = progress(g).character;
    saveRuns(g, r);
  }
  // someone else is playing (or the game restarted): the clock stops at this moment
  function pauseRun(g) {
    const r = runs(g);
    if (!r.current || !r.current.lastAt) return;
    routeLib.runTick(r.current, Date.now(), r.current.act || 0, 'manual', opts().rush);
    r.current.lastAt = null;
    saveRuns(g, r);
  }
  // Start over: this run goes to the earlier ones (if any time was counted) and a new one starts
  function newRunFor(g) {
    const r = runs(g);
    if (r.current && (r.current.acts || []).some((a) => a && a.ms > 0)) r.past.unshift(r.current);
    r.current = null;
    saveRuns(g, r);
  }
  const actOf = (route, steps, i) => (i < steps.length ? steps[i].act : route.acts.length);
  function timerView(g) {
    const r = runs(g);
    const run = r.current;
    const rush = !!opts().rush;
    const last = r.past[0] || null;
    return {
      acts: run ? (run.acts || []).map((a) => (a ? { ms: a.ms || 0, done: !!a.done } : null)) : [],
      act: run ? run.act || 0 : 0, lastAt: run ? run.lastAt || null : null, idle: routeLib.IDLE, startedAt: run ? run.startedAt : null,
      best: routeLib.bestTimes(r.past, rush), last: last ? (last.acts || []).map((a) => (a && a.done ? a.ms : null)) : [],
    };
  }

  // ---------- PoE1: the quest gems for your build ----------
  let gemCache = { key: null, plan: null };
  function gemLines(g, steps) {
    if (g !== 'poe1' || C.store.activeGame() !== 'poe1') return null;
    let xml = null; try { xml = C.pobXml(); } catch (_) { /* no build */ }
    if (!xml) return null;
    const m = mode();
    const key = `${xml.length}|${xml.slice(-200)}|${m.rush}|${m.optional}`;
    if (gemCache.key !== key) {
      const build = gemLib.buildGems(xml);
      const plan = gemLib.plan(steps, build, (s) => routeLib.shown(s, m));
      gemCache = { key, plan, className: build && build.className };
    }
    return gemCache;
  }

  function view(g = game()) {
    const route = routeLib.load(g);
    const steps = routeLib.flatten(route);
    const p = progress(g);
    const cur = Math.min(p.current || 0, steps.length);
    const o = opts();
    const areaLevel = onRoute(route, steps, p.area) ? p.areaLevel || null : null;
    const gems = gemLines(g, steps);
    return {
      game: g, for: route.for, checked: route.checked, note: route.note, sources: route.sources, totalsOf: route.totals,
      acts: route.acts.map((a) => ({ name: a.name, levels: a.levels || null, count: a.steps.length })),
      steps: steps.map((s, idx) => ({ t: s.t, h: s.h, r: s.r, p: s.p, k: s.k, l: s.l, o: s.o, f: s.f, act: s.act, i: s.i, hide: !routeLib.shown(s, mode()), gems: gems && gems.plan.has(idx) ? gemLib.line(gems.plan.get(idx)) : undefined })),
      gemsFor: gems ? gems.className || null : null,
      endgame: route.endgame, current: cur, done: cur >= steps.length,
      totals: routeLib.totals(steps, cur),
      // the area level only for a zone of the route: a town's or hideout's level says nothing about the
      // campaign, and a hideout or map at level 65 is usually another character of yours
      area: p.area || null, areaLevel, character: p.character || null, level: p.level || null,
      xp: routeLib.xpPenalty(g, p.level, areaLevel), timer: timerView(g), now: Date.now(),
      className: p.character ? p.className || null : null, session: session(g),
      seen: Object.entries((C.store.settings.routeChars || {})[g] || {}).map(([name, x]) => ({ name, className: x.className || null, level: x.level || null })),
      follow: !!o.follow, readsLog: readsLog(), autoSwitch: !!C.store.settings.autoSwitchChar,
      appChars: C.store.listProfiles().filter((x) => x.game === g).map((x) => ({ id: x.id, name: x.name, gameChar: x.gameChar, active: x.active })),
      logPath: (o.logPath || {})[g] || null, found: findLog(g), status: status[g] || null,
      overlay: !!o.overlay, hotkey: o.hotkey || '', hotkeyOk, optional: o.optional !== false, rush: !!o.rush,
    };
  }

  // ---------- the game's log ----------
  function findLog(g) {
    const own = (opts().logPath || {})[g];
    if (own) return fs.existsSync(own) ? own : null;
    return routeLib.defaultLogPaths(g).find((f) => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } }) || null;
  }
  const status = {}; // per game: what the log follower is doing, in words (shown in the tab)
  let tail = null; // { game, file, pos }
  let timer = null;

  function readFrom(file, from, to) {
    const len = Math.max(0, to - from);
    if (!len) return '';
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, from); return buf.toString('utf8'); } finally { fs.closeSync(fd); }
  }

  // ---------- who is playing ----------
  // The route follows one character (progress.character: its name, class and level, from the log). The
  // log never names the character you log in with, so every login (game start, connecting to the
  // login server, a disconnect) makes it "not sure" until the log shows who it is: that character
  // levelling up or getting a quest reward (by name), or an area only that character would be in (a
  // zone of the route near its step, at its level). Maps, a zone far from the step, an area far above
  // its level, or another name levelling up: another character is playing, and the route doesn't move.
  // session: { who: 'owner' | 'other' | 'unknown', by: 'name' | 'area' | 'login' | 'you' | 'reset', name, area, areaLevel, why, at }
  const session = (g = game()) => progress(g).session || { who: 'unknown', by: 'start' };
  function setSession(g, next, replay) {
    if (!replay && next.who !== 'owner') pauseRun(g);
    const was = session(g);
    const s = { ...next, at: Date.now() };
    setProgress(g, { session: s });
    if (was.who !== s.who || was.by !== s.by || was.name !== s.name) {
      if (!replay) trace('session', { who: s.who, by: s.by, name: s.name || undefined, area: s.area || undefined, areaLevel: s.areaLevel || undefined, why: s.why || undefined, character: progress(g).character || null, was: was.who });
      C.log(`route ${g}: ${s.who === 'owner' ? `playing ${progress(g).character || 'the route character'}` : s.who === 'other' ? `another character (${s.name || s.area || '?'})` : 'not sure who is playing'} (${s.by}${s.why ? `: ${s.why}` : ''})`);
    }
  }
  // every character the log has named, for picking the route's one: { name: { className, level, at } }
  function noteSeen(g, e) {
    const all = C.store.settings.routeChars || {};
    const mine = { ...(all[g] || {}) };
    const prev = mine[e.character] || {};
    mine[e.character] = { className: e.className || prev.className || null, level: e.level || prev.level || null, at: Date.now() };
    const names = Object.keys(mine).sort((a, b) => mine[b].at - mine[a].at).slice(0, 20);
    C.store.setSetting('routeChars', { ...all, [g]: Object.fromEntries(names.map((n) => [n, mine[n]])) });
  }

  // the log is read while following your zones, or to switch the app's character for you
  const readsLog = () => !!opts().follow || !!C.store.settings.autoSwitchChar;
  // a line named the character playing (levelled up, got a quest reward): the app's character for it
  function named(g, name, why, replay, notName) { if (!replay && C.characterFromLog) { try { C.characterFromLog(g, name, why, notName); } catch (err) { C.log('characters: ' + err.message); } } }

  function onLines(g, text, replay) {
    const route = routeLib.load(g);
    const steps = routeLib.flatten(route);
    const following = !!opts().follow;
    let changed = false;
    let lastArea = null;
    for (const line of text.split(/\r?\n/)) {
      const e = routeLib.parseLine(line);
      // a new game process: the game was restarted, whoever logs in next
      const pid = e || /Client \d+\]/.test(line) ? routeLib.pidOf(line) : null;
      if (pid && pid !== progress(g).pid) {
        const had = progress(g).pid;
        setProgress(g, { pid });
        if (had && (!e || e.kind !== 'login')) { setSession(g, { who: 'unknown', by: 'login', why: 'game restarted' }, replay); changed = true; }
      }
      if (!e) continue;
      if (!following) {
        // only reading the log to switch the app's character: the names, nothing about the route
        if (e.kind === 'level' || (e.kind === 'named' && e.how === 'reward')) { noteSeen(g, e); named(g, e.character, e.kind === 'level' ? `level ${e.level}` : e.how, replay); changed = true; }
        continue;
      }
      if (e.kind === 'login') { setSession(g, { who: 'unknown', by: 'login', why: e.why }, replay); changed = true; continue; }
      if (e.kind === 'level' || e.kind === 'named') {
        noteSeen(g, e);
        const p = progress(g);
        const owner = p.character;
        const sure = e.kind === 'level' || e.how === 'reward'; // a death can be a party member's
        if (!owner && sure && session(g).who === 'owner') { // (owner by the area: you're in a zone of the route)
          // a new route (Start over): the first character to level up in the campaign is its one
          setProgress(g, { character: e.character, className: e.className || null, level: e.level || null });
          if (!replay) trace('character', { character: e.character, className: e.className || null, level: e.level || null, how: 'first in the campaign' });
          C.log(`route ${g}: following ${e.character}`);
        }
        if (progress(g).character === e.character) {
          if (e.kind === 'level') setProgress(g, { level: e.level, className: e.className });
          setSession(g, { who: 'owner', by: 'name', name: e.character, why: e.kind === 'level' ? `level ${e.level}` : e.how }, replay);
          if (!replay && e.kind === 'level') trace('level', { character: e.character, className: e.className, level: e.level, step: progress(g).current });
          if (!replay) tickRun(g, actOf(route, steps, progress(g).current), 'zone');
        } else if (sure && progress(g).character) {
          setSession(g, { who: 'other', by: 'name', name: e.character, areaLevel: null, why: e.kind === 'level' ? `${e.character} level ${e.level}` : `${e.character} ${e.how}` }, replay);
          if (!replay && e.kind === 'level') trace('other-level', { character: e.character, className: e.className, level: e.level });
        }
        if (sure) named(g, e.character, e.kind === 'level' ? `level ${e.level}` : e.how, replay);
        changed = true;
        continue;
      }
      // an area
      const p = progress(g);
      const verdict = routeLib.judgeArea(route, steps, p.current, e.area, e.areaLevel, { level: p.level });
      const was = session(g);
      if (verdict === 'other' && !(was.who === 'other' && was.by === 'name')) {
        setSession(g, { who: 'other', by: 'area', area: e.area, areaLevel: e.areaLevel, why: 'not where the route character would be' }, replay);
        // someone else than the route's character: if only one other character is linked, that one
        if (was.who !== 'other') named(g, null, `area level ${e.areaLevel || '?'}`, replay, progress(g).character);
      }
      else if (verdict === 'owner' && !(was.who === 'other' && was.by === 'name')) {
        setSession(g, { who: 'owner', by: 'area', area: e.area, why: 'a zone of the route' }, replay);
        // back on the route's character: the app's character for it too
        if (was.who !== 'owner' && progress(g).character) named(g, progress(g).character, 'a zone of the route', replay);
      }
      const who = session(g).who;
      if (who !== 'owner') {
        // another character (or not sure yet): the route stays where it is, and the character's area isn't changed
        if (!replay) { trace('area', { area: e.area, areaLevel: e.areaLevel, ignored: true, who, verdict, from: stepInfo(steps, p.current), line: line.slice(0, 200) }); lastAreaAt = Date.now(); }
        changed = true;
        continue;
      }
      // catching up on the end of the log: where you are now, not every area you went through
      const d = replay ? { index: p.current, why: 'catch-up' } : routeLib.decide(route, steps, p.current, e.area, p.area);
      // a step the rush (or Show optional steps off) hides is passed, unless you went into its area
      const next = replay || d.index === p.current ? d.index : routeLib.settle(steps, d.index, mode(), e.area);
      if (next !== p.current) C.log(`route ${g}: entered ${e.area}, step ${p.current} -> ${next} (${d.why})`);
      if (!replay) {
        const now = Date.now();
        trace('area', {
          area: e.area, areaLevel: e.areaLevel, prev: p.area || null, town: routeLib.isTown(route, e.area), why: d.why, verdict, matched: d.at != null ? stepInfo(steps, d.at) : undefined,
          from: stepInfo(steps, p.current), to: next !== p.current ? stepInfo(steps, next) : undefined, moved: next - p.current,
          msInPrev: lastAreaAt ? now - lastAreaAt : null, charLevel: p.level || null, line: line.slice(0, 200),
        });
        lastAreaAt = now;
      } else lastArea = { area: e.area, areaLevel: e.areaLevel };
      setProgress(g, { current: next, area: e.area, areaLevel: e.areaLevel });
      if (!replay) tickRun(g, actOf(route, steps, next), 'zone');
      changed = true;
    }
    if (replay) trace('catch-up', { area: lastArea && lastArea.area, areaLevel: lastArea && lastArea.areaLevel, step: stepInfo(steps, progress(g).current), level: progress(g).level || null, character: progress(g).character || null, session: session(g) });
    if (changed) push();
  }

  function poll() {
    const o = opts();
    const g = game();
    if (!readsLog()) { stopFollowing(); return; }
    const file = findLog(g);
    if (!file) {
      if (status[g] !== 'Client.txt not found: pick it below.') trace('log-missing', { own: (o.logPath || {})[g] || null, looked: routeLib.defaultLogPaths(g) });
      status[g] = 'Client.txt not found: pick it below.'; if (tail) tail = null; return;
    }
    let size = 0;
    try { size = fs.statSync(file).size; } catch (err) { status[g] = `Can't read ${file}: ${err.message}`; return; }
    if (!tail || tail.game !== g || tail.file !== file) {
      // start at the end: only the last bit, for where you are and your level now
      tail = { game: g, file, pos: size };
      try { onLines(g, readFrom(file, Math.max(0, size - TAIL), size), true); } catch (err) { C.log('route: ' + err.message); }
      status[g] = `Following ${file}`;
      C.log(`route ${g}: following ${file}`);
      trace('follow-start', { file, size, own: !!(o.logPath || {})[g] });
      push();
      return;
    }
    if (size < tail.pos) { trace('log-restarted', { file, size, was: tail.pos }); tail.pos = 0; } // the game started a new log
    if (size > tail.pos) {
      try {
        // only whole lines: the game may be halfway through writing the last one
        const buf = readFrom(file, tail.pos, size);
        const end = buf.lastIndexOf('\n');
        if (end >= 0) { const text = buf.slice(0, end + 1); tail.pos += Buffer.byteLength(text, 'utf8'); onLines(g, text, false); }
      } catch (err) { C.log('route: ' + err.message); }
    }
  }
  function startFollowing() { if (!timer) timer = setInterval(() => { try { poll(); } catch (err) { C.log('route: ' + err.message); } }, POLL); poll(); }
  function stopFollowing() { if (timer) { clearInterval(timer); timer = null; } tail = null; }

  // ---------- the overlay ----------
  let overlay = null;
  function overlayBounds() {
    const saved = C.store.settings.routeOverlayBounds;
    const area = screen.getPrimaryDisplay().workArea;
    const w = 380; const h = 200;
    if (saved && Number.isFinite(saved.x) && screen.getAllDisplays().some((d) => saved.x >= d.bounds.x && saved.x < d.bounds.x + d.bounds.width && saved.y >= d.bounds.y && saved.y < d.bounds.y + d.bounds.height)) return { x: saved.x, y: saved.y, width: w, height: h };
    return { x: area.x + area.width - w - 16, y: area.y + 16, width: w, height: h };
  }
  function showOverlay() {
    if (overlay && !overlay.isDestroyed()) { overlay.showInactive(); return; }
    overlay = new BrowserWindow({
      ...overlayBounds(), show: false, frame: false, resizable: false, transparent: true, backgroundColor: '#00000000',
      alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false, roundedCorners: false,
      webPreferences: { preload: C.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.loadFile(path.join(ROOT, 'ui', 'route-overlay.html'));
    overlay.once('ready-to-show', () => { if (overlay) overlay.showInactive(); });
    let mt = null;
    overlay.on('move', () => { clearTimeout(mt); mt = setTimeout(() => { if (overlay && !overlay.isDestroyed()) { const b = overlay.getBounds(); C.store.setSetting('routeOverlayBounds', { x: b.x, y: b.y }); } }, 300); });
    overlay.on('closed', () => { overlay = null; });
  }
  function hideOverlay() { if (overlay && !overlay.isDestroyed()) overlay.close(); overlay = null; }
  function setOverlay(on, source) { setOpts({ overlay: !!on }); if (on) showOverlay(); else hideOverlay(); trace('overlay', { on: !!on, source: source || null }); push(); }

  let hotkeyOk = true; let hotkeyNow = null;
  function registerHotkey() {
    if (hotkeyNow) { try { globalShortcut.unregister(hotkeyNow); } catch (_) { /* ignore */ } hotkeyNow = null; }
    const want = opts().hotkey;
    hotkeyOk = true;
    if (!want) return true;
    try { hotkeyOk = globalShortcut.register(want, () => setOverlay(!(overlay && !overlay.isDestroyed()), 'hotkey')); } catch (_) { hotkeyOk = false; }
    if (hotkeyOk) hotkeyNow = want; else { C.log(`route: overlay hotkey ${want} could not be registered (another app has it?)`); trace('hotkey-failed', { hotkey: want }); }
    return hotkeyOk;
  }

  function push() {
    let v = null;
    try { v = view(); } catch (err) { C.log('route: ' + err.message); return; }
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('route:update', v);
    C.notifySettings('route:update', v);
  }

  // ---------- the tab and the overlay ask ----------
  ipcMain.handle('route:get', () => view());
  ipcMain.handle('route:set', (_e, patch) => {
    const p = patch && typeof patch === 'object' ? patch : {};
    if ('follow' in p) {
      setOpts({ follow: !!p.follow });
      C.log(`route: following the game's log ${p.follow ? 'on' : 'off'}`);
      trace('follow', { on: !!p.follow, file: findLog(game()) });
      if (readsLog()) startFollowing(); else stopFollowing();
    }
    if ('character' in p && typeof p.character === 'string') {
      // you picked the character the route follows (one the log has named)
      const g = game();
      const x = ((C.store.settings.routeChars || {})[g] || {})[p.character];
      if (x) {
        setProgress(g, { character: p.character, className: x.className || null, level: x.level || null });
        trace('character', { character: p.character, className: x.className || null, level: x.level || null, how: 'picked' });
        C.log(`route ${g}: following ${p.character} (picked)`);
        setSession(g, { who: 'owner', by: 'you', name: p.character, why: 'picked' });
      }
    }
    if (p.playing === true) setSession(game(), { who: 'owner', by: 'you', name: progress().character || undefined, why: 'you said so' });
    if ('optional' in p) { setOpts({ optional: !!p.optional }); trace('optional', { on: !!p.optional }); }
    if ('rush' in p) {
      setOpts({ rush: !!p.rush });
      trace('rush', { on: !!p.rush });
      C.log(`route: endgame rush ${p.rush ? 'on' : 'off'}`);
      // on a step the rush hides: on to the next one it shows
      const g = game(); const steps = routeLib.flatten(routeLib.load(g)); const cur = progress(g).current || 0;
      const to = routeLib.settle(steps, cur, mode(), null);
      if (to !== cur) setProgress(g, { current: to });
    }
    if ('overlay' in p) setOverlay(!!p.overlay, 'tab');
    if ('hotkey' in p) { setOpts({ hotkey: typeof p.hotkey === 'string' ? p.hotkey.slice(0, 40) : '' }); registerHotkey(); }
    push();
    return view();
  });
  // a step clicked in the checklist: it becomes the current one (the ones before it count as done)
  ipcMain.handle('route:jump', (_e, index) => {
    const g = game();
    const steps = routeLib.flatten(routeLib.load(g));
    const n = steps.length;
    const i = Math.max(0, Math.min(n, Math.floor(Number(index) || 0)));
    trace('manual', { how: 'jump', from: stepInfo(steps, progress(g).current), to: stepInfo(steps, i), moved: i - (progress(g).current || 0), area: progress(g).area || null, sinceArea: lastAreaAt ? Date.now() - lastAreaAt : null });
    setProgress(g, { current: i });
    tickRun(g, actOf(routeLib.load(g), steps, i), 'manual');
    push();
    return view();
  });
  ipcMain.handle('route:step', (_e, delta, source) => {
    const g = game();
    const steps = routeLib.flatten(routeLib.load(g));
    const n = steps.length;
    const was = progress(g).current || 0;
    const to = routeLib.stepBy(steps, Math.min(was, n), Number(delta) > 0 ? 1 : -1, mode()); // passing steps that aren't shown
    trace('manual', { how: Number(delta) > 0 ? 'next' : 'back', source: source === 'overlay' ? 'overlay' : 'tab', from: stepInfo(steps, was), to: stepInfo(steps, to), area: progress(g).area || null, sinceArea: lastAreaAt ? Date.now() - lastAreaAt : null });
    setProgress(g, { current: to });
    tickRun(g, actOf(routeLib.load(g), steps, to), 'manual');
    push();
    return view();
  });
  // back to the first step (Start over, or a new character)
  function reset(why) {
    const g = game();
    trace('reset', { from: progress(g).current || 0, level: progress(g).level || null, why: why || 'start over' });
    setProgress(g, { current: 0, area: null, areaLevel: null, character: null, className: null, level: null, session: { who: 'unknown', by: 'reset', at: Date.now() } });
    newRunFor(g);
    C.log(`route ${g}: reset${why ? ` (${why})` : ''}`);
    push();
  }
  ipcMain.handle('route:reset', () => { reset(); return view(); });
  ipcMain.handle('route:browse', async () => {
    const g = game();
    const win = C.settingsWin && !C.settingsWin.isDestroyed() ? C.settingsWin : undefined;
    const pick = await dialog.showOpenDialog(win, { title: `Find ${g === 'poe1' ? 'Path of Exile' : 'Path of Exile 2'}'s Client.txt (in the game folder, logs)`, properties: ['openFile'], filters: [{ name: 'Client.txt', extensions: ['txt'] }] });
    if (pick.canceled || !pick.filePaths[0]) return view();
    setOpts({ logPath: { ...(opts().logPath || {}), [g]: pick.filePaths[0] } });
    trace('log-picked', { file: pick.filePaths[0] });
    tail = null;
    if (readsLog()) startFollowing();
    push();
    return view();
  });
  ipcMain.on('route:overlay-close', () => setOverlay(false, 'overlay ×'));
  // the overlay is exactly as tall as what it shows: a see-through part would still catch your
  // clicks in the game
  ipcMain.on('route:overlay-size', (_e, h) => {
    const height = Math.max(60, Math.min(400, Math.ceil(Number(h) || 0)));
    if (!overlay || overlay.isDestroyed() || !Number.isFinite(height)) return;
    const b = overlay.getBounds();
    if (b.height !== height) overlay.setBounds({ ...b, height });
  });

  // the game you're on changes (you switched in the app): the trace says so
  let lastGame = null;
  setInterval(() => { try { const g = game(); if (lastGame && g !== lastGame) trace('game', { from: lastGame, to: g }); lastGame = g; } catch (_) { /* store not ready */ } }, 5000);

  function start() {
    lastGame = game();
    const r = routeLib.load(lastGame);
    trace('app-start', { version: app.getVersion(), route: r.for, steps: routeLib.flatten(r).length, step: progress().current || 0, follow: opts().follow, overlay: opts().overlay, hotkey: opts().hotkey, file: findLog(lastGame) });
    registerHotkey();
    if (readsLog()) startFollowing();
    if (opts().overlay) showOverlay();
  }

  // the switch to read the log for the app's character went on or off
  function logNeedChanged() { if (readsLog()) startFollowing(); else stopFollowing(); push(); }

  return { start, view, reset, logNeedChanged, push, DEFAULT_OVERLAY_HOTKEY };
};
