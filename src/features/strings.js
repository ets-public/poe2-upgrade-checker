'use strict';

// Search strings in game: one hotkey copies a search string for the game's search box (Ctrl+F at a
// vendor, in your stash or at the map device). The first press copies the one you used last; each
// press within a few seconds moves on to the next: things worth a look at vendors (movement speed and
// the resistances you're short of), maps or waystones without your dangerous mods, then your own saved
// strings. The app only puts it on the clipboard: you paste it (Ctrl+F, Ctrl+V), so nothing more is
// sent to the game than before.
const { ipcMain, globalShortcut } = require('electron');
const searchStr = require('../core/searchstr');

module.exports = function (C) {
  const custom = () => ((C.store.settings.customStrings || {})[C.tg()] || []).filter((x) => x && x.text);
  function resShort() {
    const rs = C.liveResists();
    if (!rs) return [];
    return ['fire', 'cold', 'lightning'].filter((el) => rs[el] != null && rs[el] < ((rs.caps && rs.caps[el]) || rs.cap || 75));
  }
  function list() {
    const marks = ((C.store.settings.mapMarks || {})[C.tg()]) || {};
    const avoid = Object.keys(marks).filter((k) => marks[k] === 'd');
    const out = [];
    const v = searchStr.vendor({ move: true, res: resShort(), game: C.tg() });
    if (v.text) out.push({ name: 'Vendors & stash', text: v.text });
    const m = searchStr.mapAvoid(avoid);
    if (m.text) out.push({ name: `${C.tg() === 'poe1' ? 'Maps' : 'Waystones'} without your dangerous mods`, text: m.text });
    for (const c of custom()) out.push({ name: c.name || 'Saved string', text: c.text });
    return out;
  }
  let last = 0; let lastAt = 0;
  function onPress() {
    const all = list();
    if (!all.length) { C.showResult({ ok: false, reason: 'No search strings yet: mark dangerous map mods or save your own on the Character page.' }); return; }
    const i = Date.now() - lastAt < 4000 ? (last + 1) % all.length : Math.min(last, all.length - 1);
    last = i; lastAt = Date.now();
    C.lastClip = all[i].text; C.clipWrite(all[i].text);
    C.log(`strings hotkey: copied "${all[i].name}"`);
    C.showResult({ ok: false, reason: `Copied: ${all[i].name} (${i + 1} of ${all.length}). Ctrl+F, then Ctrl+V to paste it.${all.length > 1 ? ' Press again for the next one.' : ''}  ${all[i].text}` });
  }
  let now = null;
  function register() {
    if (now) { try { globalShortcut.unregister(now); } catch (_) { /* ignore */ } now = null; }
    const want = C.store.settings.stringsHotkey || '';
    if (!want) return { ok: true, accelerator: null };
    const others = [C.hotkeyStatus.accelerator || C.store.settings.hotkey || 'F2', C.store.settings.resultsHotkey || 'Ctrl+Shift+D', C.store.settings.priceHotkey === undefined ? 'F3' : C.store.settings.priceHotkey, C.store.settings.equipHotkey];
    if (others.some((k) => k && C.sameKey(want, k))) return { ok: false, error: `${want} is already one of the app's other keys.` };
    let ok = false;
    try { ok = globalShortcut.register(want, () => { if (!C.store.settings.paused) onPress(); }); } catch (_) { ok = false; }
    if (ok) now = want;
    C.log(`strings hotkey ${want}: ${ok ? 'registered' : 'FAILED'}`);
    return ok ? { ok, accelerator: want } : { ok, error: `${want} is already used by another program. Pick a different key.` };
  }
  ipcMain.handle('hotkey:setStrings', (_e, accel) => {
    const prev = C.store.settings.stringsHotkey || '';
    const want = typeof accel === 'string' ? accel.trim().slice(0, 40) : '';
    C.store.setSetting('stringsHotkey', want);
    const st = register();
    if (!st.ok) { C.store.setSetting('stringsHotkey', prev); register(); }
    return { ...st, accelerator: st.ok ? want : prev };
  });
  ipcMain.handle('strings:custom', () => custom());
  ipcMain.handle('strings:customSet', (_e, items) => {
    const clean = (Array.isArray(items) ? items : []).slice(0, 20).map((x) => ({ name: String((x && x.name) || '').slice(0, 40), text: String((x && x.text) || '').slice(0, searchStr.LIMIT) })).filter((x) => x.text);
    C.store.setSetting('customStrings', { ...(C.store.settings.customStrings || {}), [C.tg()]: clean });
    return clean;
  });
  return { register, active: () => now };
};
