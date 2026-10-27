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
const ROOT = path.join(__dirname, '..'); // src

const DEFAULT_OVERLAY_HOTKEY = 'Ctrl+Shift+L';
const POLL = 1000; // how often the log is checked for new lines
const TAIL = 256 * 1024; // when following starts: the end of the log, for the area you're in now

module.exports = function (C) {
  const game = () => (C.tg() === 'poe1' ? 'poe1' : 'poe2');
  const opts = () => ({ follow: false, logPath: {}, overlay: false, hotkey: DEFAULT_OVERLAY_HOTKEY, optional: true, ...(C.store.settings.route || {}) });
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

  function view(g = game()) {
    const route = routeLib.load(g);
    const steps = routeLib.flatten(route);
    const p = progress(g);
    const cur = Math.min(p.current || 0, steps.length);
    const o = opts();
    return {
      game: g, for: route.for, checked: route.checked, note: route.note, sources: route.sources, totalsOf: route.totals,
      acts: route.acts.map((a) => ({ name: a.name, levels: a.levels || null, count: a.steps.length })),
      steps: steps.map(({ t, h, r, p: pts, k, l, o: opt, act, i }) => ({ t, h, r, p: pts, k, l, o: opt, act, i })),
      endgame: route.endgame, current: cur, done: cur >= steps.length,
      totals: routeLib.totals(steps, cur),
      area: p.area || null, areaLevel: p.areaLevel || null, character: p.character || null, level: p.level || null,
      follow: !!o.follow, logPath: (o.logPath || {})[g] || null, found: findLog(g), status: status[g] || null,
      overlay: !!o.overlay, hotkey: o.hotkey || '', hotkeyOk, optional: o.optional !== false,
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

  function onLines(g, text, replay) {
    const route = routeLib.load(g);
    const steps = routeLib.flatten(route);
    let changed = false;
    let lastArea = null;
    for (const line of text.split(/\r?\n/)) {
      const e = routeLib.parseLine(line);
      if (!e) continue;
      if (e.kind === 'level') {
        setProgress(g, { character: e.character, level: e.level }); changed = true;
        if (!replay) trace('level', { character: e.character, className: e.className, level: e.level, step: progress(g).current });
        continue;
      }
      const p = progress(g);
      // catching up on the end of the log: where you are now, not every area you went through
      const d = replay ? { index: p.current, why: 'catch-up' } : routeLib.decide(route, steps, p.current, e.area, p.area);
      const next = d.index;
      if (next !== p.current) C.log(`route ${g}: entered ${e.area}, step ${p.current} -> ${next} (${d.why})`);
      if (!replay) {
        const now = Date.now();
        trace('area', {
          area: e.area, areaLevel: e.areaLevel, prev: p.area || null, town: routeLib.isTown(route, e.area), why: d.why, matched: d.at != null ? stepInfo(steps, d.at) : undefined,
          from: stepInfo(steps, p.current), to: next !== p.current ? stepInfo(steps, next) : undefined, moved: next - p.current,
          msInPrev: lastAreaAt ? now - lastAreaAt : null, charLevel: p.level || null, line: line.slice(0, 200),
        });
        lastAreaAt = now;
      } else lastArea = { area: e.area, areaLevel: e.areaLevel };
      setProgress(g, { current: next, area: e.area, areaLevel: e.areaLevel });
      changed = true;
    }
    if (replay && lastArea) trace('catch-up', { area: lastArea.area, areaLevel: lastArea.areaLevel, step: stepInfo(steps, progress(g).current), level: progress(g).level || null });
    if (changed) push();
  }

  function poll() {
    const o = opts();
    const g = game();
    if (!o.follow) { stopFollowing(); return; }
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
      if (p.follow) startFollowing(); else stopFollowing();
    }
    if ('optional' in p) { setOpts({ optional: !!p.optional }); trace('optional', { on: !!p.optional }); }
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
    push();
    return view();
  });
  ipcMain.handle('route:step', (_e, delta, source) => {
    const g = game();
    const steps = routeLib.flatten(routeLib.load(g));
    const n = steps.length;
    const was = progress(g).current || 0;
    const to = Math.max(0, Math.min(n, was + (Number(delta) > 0 ? 1 : -1)));
    trace('manual', { how: Number(delta) > 0 ? 'next' : 'back', source: source === 'overlay' ? 'overlay' : 'tab', from: stepInfo(steps, was), to: stepInfo(steps, to), area: progress(g).area || null, sinceArea: lastAreaAt ? Date.now() - lastAreaAt : null });
    setProgress(g, { current: to });
    push();
    return view();
  });
  // back to the first step (Start over, or a new character)
  function reset(why) {
    const g = game();
    trace('reset', { from: progress(g).current || 0, level: progress(g).level || null, why: why || 'start over' });
    setProgress(g, { current: 0, area: null, areaLevel: null, character: null, level: null });
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
    if (opts().follow) startFollowing();
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
    if (opts().follow) startFollowing();
    if (opts().overlay) showOverlay();
  }

  return { start, view, reset, DEFAULT_OVERLAY_HOTKEY };
};
