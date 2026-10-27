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
const { BrowserWindow, ipcMain, globalShortcut, screen, dialog } = require('electron');
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
    for (const line of text.split(/\r?\n/)) {
      const e = routeLib.parseLine(line);
      if (!e) continue;
      if (e.kind === 'level') { setProgress(g, { character: e.character, level: e.level }); changed = true; continue; }
      const p = progress(g);
      // catching up on the end of the log: where you are now, not every area you went through
      const next = replay ? p.current : routeLib.advance(route, steps, p.current, e.area, p.area);
      if (next !== p.current) C.log(`route ${g}: entered ${e.area}, step ${p.current} -> ${next}`);
      setProgress(g, { current: next, area: e.area, areaLevel: e.areaLevel });
      changed = true;
    }
    if (changed) push();
  }

  function poll() {
    const o = opts();
    const g = game();
    if (!o.follow) { stopFollowing(); return; }
    const file = findLog(g);
    if (!file) { status[g] = 'Client.txt not found: pick it below.'; if (tail) tail = null; return; }
    let size = 0;
    try { size = fs.statSync(file).size; } catch (err) { status[g] = `Can't read ${file}: ${err.message}`; return; }
    if (!tail || tail.game !== g || tail.file !== file) {
      // start at the end: only the last bit, for where you are and your level now
      tail = { game: g, file, pos: size };
      try { onLines(g, readFrom(file, Math.max(0, size - TAIL), size), true); } catch (err) { C.log('route: ' + err.message); }
      status[g] = `Following ${file}`;
      C.log(`route ${g}: following ${file}`);
      push();
      return;
    }
    if (size < tail.pos) tail.pos = 0; // the game started a new log
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
  function setOverlay(on) { setOpts({ overlay: !!on }); if (on) showOverlay(); else hideOverlay(); push(); }

  let hotkeyOk = true; let hotkeyNow = null;
  function registerHotkey() {
    if (hotkeyNow) { try { globalShortcut.unregister(hotkeyNow); } catch (_) { /* ignore */ } hotkeyNow = null; }
    const want = opts().hotkey;
    hotkeyOk = true;
    if (!want) return true;
    try { hotkeyOk = globalShortcut.register(want, () => setOverlay(!(overlay && !overlay.isDestroyed()))); } catch (_) { hotkeyOk = false; }
    if (hotkeyOk) hotkeyNow = want; else C.log(`route: overlay hotkey ${want} could not be registered (another app has it?)`);
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
      if (p.follow) startFollowing(); else stopFollowing();
    }
    if ('optional' in p) setOpts({ optional: !!p.optional });
    if ('overlay' in p) setOverlay(!!p.overlay);
    if ('hotkey' in p) { setOpts({ hotkey: typeof p.hotkey === 'string' ? p.hotkey.slice(0, 40) : '' }); registerHotkey(); }
    push();
    return view();
  });
  // a step clicked in the checklist: it becomes the current one (the ones before it count as done)
  ipcMain.handle('route:jump', (_e, index) => {
    const g = game();
    const n = routeLib.flatten(routeLib.load(g)).length;
    const i = Math.max(0, Math.min(n, Math.floor(Number(index) || 0)));
    setProgress(g, { current: i });
    push();
    return view();
  });
  ipcMain.handle('route:step', (_e, delta) => {
    const g = game();
    const n = routeLib.flatten(routeLib.load(g)).length;
    setProgress(g, { current: Math.max(0, Math.min(n, (progress(g).current || 0) + (Number(delta) > 0 ? 1 : -1))) });
    push();
    return view();
  });
  ipcMain.handle('route:reset', () => { const g = game(); setProgress(g, { current: 0, area: null, areaLevel: null, level: null }); C.log(`route ${g}: reset`); push(); return view(); });
  ipcMain.handle('route:browse', async () => {
    const g = game();
    const win = C.settingsWin && !C.settingsWin.isDestroyed() ? C.settingsWin : undefined;
    const pick = await dialog.showOpenDialog(win, { title: `Find ${g === 'poe1' ? 'Path of Exile' : 'Path of Exile 2'}'s Client.txt (in the game folder, logs)`, properties: ['openFile'], filters: [{ name: 'Client.txt', extensions: ['txt'] }] });
    if (pick.canceled || !pick.filePaths[0]) return view();
    setOpts({ logPath: { ...(opts().logPath || {}), [g]: pick.filePaths[0] } });
    tail = null;
    if (opts().follow) startFollowing();
    push();
    return view();
  });
  ipcMain.on('route:overlay-close', () => setOverlay(false));
  // the overlay is exactly as tall as what it shows: a see-through part would still catch your
  // clicks in the game
  ipcMain.on('route:overlay-size', (_e, h) => {
    const height = Math.max(60, Math.min(400, Math.ceil(Number(h) || 0)));
    if (!overlay || overlay.isDestroyed() || !Number.isFinite(height)) return;
    const b = overlay.getBounds();
    if (b.height !== height) overlay.setBounds({ ...b, height });
  });

  function start() {
    registerHotkey();
    if (opts().follow) startFollowing();
    if (opts().overlay) showOverlay();
  }

  return { start, view, DEFAULT_OVERLAY_HOTKEY };
};
