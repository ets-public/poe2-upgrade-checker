'use strict';

// Search string builder: an overlay window over the game that builds the text for the game's search
// box (Ctrl+F in your stash, at a vendor or the map device): maps and waystones by quantity, rarity,
// pack size, tier and the mods you want or don't want, or any item by its mods and numbers.
// The string goes on the clipboard (Copy) or into your saved strings, which the search strings
// hotkey copies in game. The app still sends nothing to the game but its Ctrl+C.
const path = require('path');
const { ipcMain, BrowserWindow, globalShortcut, screen } = require('electron');
const R = require('../core/regexbuild');
const { testSafe } = require('../core/regextest');
const mods = require('../core/regexmods');
const mapLib = require('../core/mapcheck');
const searchStr = require('../core/searchstr');

module.exports = function (C) {
  const game = () => (C.tg() === 'poe1' ? 'poe1' : 'poe2');
  // mods you've seen: the ones you marked on map checks, and the last map you copied
  function seenMods() {
    const marks = ((C.store.settings.mapMarks || {})[game()]) || {};
    const out = Object.keys(marks);
    const it = C.lastItem;
    if (it && (!it.game || it.game === game()) && mapLib.isMap && mapLib.isMap(it)) for (const m of mapLib.modsOf(it)) out.push(mapLib.keyOf(m));
    return [...new Set(out)];
  }
  function dangerMarks() {
    const marks = ((C.store.settings.mapMarks || {})[game()]) || {};
    return Object.keys(marks).filter((k) => marks[k] === 'd');
  }
  function data() {
    const g = game();
    const groups = mods.MAP_MODS[g];
    const known = new Set(Object.values(groups).flat().map(R.norm));
    const seen = seenMods().filter((m) => !known.has(R.norm(m)));
    return {
      game: g, limit: R.LIMIT,
      props: R.PROPS[g], flags: R.FLAGS[g],
      modGroups: { ...groups, ...(seen.length ? { 'Seen on your maps': seen } : {}) },
      danger: dangerMarks(),
      presets: mods.ITEM_PRESETS[g],
      state: ((C.store.settings.regexBuilder || {})[g]) || null,
      saved: ((C.store.settings.customStrings || {})[g] || []).filter((x) => x && x.text),
      hotkey: C.store.settings.stringsHotkey || null,
    };
  }
  const allMods = () => [...mods.flat(game()), ...seenMods()];

  function build(kind, spec) {
    if (kind === 'item') return R.buildItem(spec);
    return R.buildMap({ ...(spec || {}), game: game() }, allMods());
  }
  // the item you copied last (Ctrl+C, F2 or F3 in game), to see if a string lights it up
  // (in a worker thread with a time limit: a regex you typed can't freeze the app, see core/regextest.js)
  async function testCopied(text) {
    const it = C.lastItem;
    if (!it || !it.raw) return { ok: false, none: true };
    const r = await testSafe(text, it.raw);
    if (r.timedOut) C.log('search string builder: a test took too long and was stopped');
    return { ...r, name: it.name || it.baseType || 'the item', itemClass: it.itemClass || '' };
  }
  function saveState(st) {
    const all = { ...(C.store.settings.regexBuilder || {}) };
    all[game()] = st && typeof st === 'object' ? st : null;
    C.store.setSetting('regexBuilder', all);
    return true;
  }
  function save(name, text) {
    const t = String(text || '').trim().slice(0, searchStr.LIMIT);
    if (!t) return { ok: false, error: 'Nothing to save yet.' };
    const list = ((C.store.settings.customStrings || {})[game()] || []).filter((x) => x && x.text);
    const n = String(name || '').trim().slice(0, 40) || 'Saved string';
    const i = list.findIndex((x) => x.name === n);
    if (i >= 0) list[i] = { name: n, text: t }; else list.push({ name: n, text: t });
    if (list.length > 20) return { ok: false, error: 'You have 20 saved strings: remove one first (Character page, Search strings).' };
    C.store.setSetting('customStrings', { ...(C.store.settings.customStrings || {}), [game()]: list });
    return { ok: true, saved: list };
  }
  function removeSaved(i) {
    const list = ((C.store.settings.customStrings || {})[game()] || []).filter((x) => x && x.text);
    list.splice(Number(i), 1);
    C.store.setSetting('customStrings', { ...(C.store.settings.customStrings || {}), [game()]: list });
    return { ok: true, saved: list };
  }

  // ---------- the window ----------
  let win = null;
  function openWindow() {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); win.webContents.send('rx:refresh'); return; }
    const area = screen.getPrimaryDisplay().workArea;
    const b = C.store.settings.regexBuilderBounds || { width: 760, height: 720, x: area.x + Math.round((area.width - 760) / 2), y: area.y + 60 };
    win = new BrowserWindow({
      ...b, minWidth: 560, minHeight: 420, show: false, frame: false, alwaysOnTop: true, skipTaskbar: false, title: 'Search string builder', backgroundColor: '#0e0c0a', icon: C.ICON,
      webPreferences: { preload: C.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(__dirname, '..', 'ui', 'regex-builder.html'));
    win.once('ready-to-show', () => win && win.show());
    let t = null;
    const remember = () => { clearTimeout(t); t = setTimeout(() => { if (win && !win.isDestroyed()) C.store.setSetting('regexBuilderBounds', win.getBounds()); }, 400); };
    win.on('move', remember); win.on('resize', remember);
    win.on('closed', () => { win = null; });
  }
  function toggleWindow() { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); else openWindow(); }
  let hk = null;
  function registerHotkey() {
    if (hk) { try { globalShortcut.unregister(hk); } catch (_) { /* ignore */ } hk = null; }
    const want = C.store.settings.regexHotkey || '';
    if (!want) return { ok: true, accelerator: null };
    let ok = false;
    try { ok = globalShortcut.register(want, toggleWindow); } catch (_) { ok = false; }
    if (ok) hk = want;
    C.log(`search string builder hotkey ${want}: ${ok ? 'registered' : 'FAILED'}`);
    return ok ? { ok, accelerator: want } : { ok, error: `${want} is already used by another program. Pick a different key.` };
  }

  const wrap = (fn) => async (_e, ...a) => { try { return await fn(...a); } catch (err) { C.log('search string builder: ' + (err.stack || err)); return { ok: false, error: err.message || String(err) }; } };
  ipcMain.handle('rx:data', wrap(() => data()));
  ipcMain.handle('rx:build', wrap((kind, spec) => build(kind, spec)));
  ipcMain.handle('rx:test', wrap((text) => testCopied(text)));
  ipcMain.handle('rx:state', wrap((st) => saveState(st)));
  ipcMain.handle('rx:save', wrap((name, text) => save(name, text)));
  ipcMain.handle('rx:remove', wrap((i) => removeSaved(i)));
  ipcMain.handle('rx:copy', wrap((text) => { const t = String(text || ''); C.lastClip = t; C.clipWrite(t); C.log('search string builder: copied'); return { ok: true }; }));
  ipcMain.handle('hotkey:setRegex', wrap((accel) => {
    const prev = C.store.settings.regexHotkey || '';
    const want = typeof accel === 'string' ? accel.trim().slice(0, 40) : '';
    C.store.setSetting('regexHotkey', want);
    const st = registerHotkey();
    if (!st.ok) { C.store.setSetting('regexHotkey', prev); registerHotkey(); }
    return { ...st, accelerator: st.ok ? want : prev };
  }));
  ipcMain.on('rx:window', () => openWindow());
  ipcMain.on('rx:hide', () => { if (win && !win.isDestroyed()) win.hide(); });

  return { openWindow, toggleWindow, registerHotkey, active: () => hk, data, build, testCopied, save };
};
