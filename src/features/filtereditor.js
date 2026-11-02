'use strict';

// Loot filter editor: an overlay window over the game to change how items look in your filter.
//  - Your local filters (Documents/My Games/Path of Exile 2) and the online ones the game keeps a copy
//    of (its OnlineFilters folder). An online filter is never changed: the editor makes a local copy and
//    edits that, so the online one stays as your backup and keeps updating from FilterBlade.
//  - Pick an item (search, or the item you last copied in game): it shows which block of the filter
//    styles it and how it looks, and you can hide it, show it, give it another tier's look or your own
//    colours, size, sound, beam and minimap icon.
//  - Tiers by today's prices: currency, omens, runes, essences... put in tiers S/A/B/C by poe.ninja's
//    price (refreshed when you ask), with your own edits left as they are.
// Every change is an override block in one section at the top of the file (core/filterfile.js); the
// first time a file is edited, a copy of it is kept next to it.
// The game reads a filter only when you pick it or reload it: the editor copies the chat command
// (/itemfilter name) for you to paste, so the app still sends nothing to the game but its Ctrl+C.
const fs = require('fs');
const path = require('path');
const { app, ipcMain, BrowserWindow, globalShortcut, screen, shell } = require('electron');
const F = require('../core/filterfile');

module.exports = function (C) {
  function gameFolder(game = C.tg()) {
    return path.join(app.getPath('documents'), 'My Games', game === 'poe1' ? 'Path of Exile' : 'Path of Exile 2');
  }
  const onlineFolder = (game) => path.join(gameFolder(game), 'OnlineFilters');
  // a file the editor may touch: a .filter file right in the game's folder (no other folder, no other kind)
  function localPath(file) {
    const f = path.resolve(String(file || ''));
    if (path.dirname(f) !== path.resolve(gameFolder()) || !/\.filter$/i.test(f)) return null;
    return f;
  }
  function onlinePath(id) {
    const name = String(id || '');
    if (!/^[\w.\- ]{1,120}$/.test(name)) return null;
    return path.join(onlineFolder(), name);
  }
  // an online filter's name: its "#name:" line, or FilterBlade/NeverSink's title, else its file name
  function onlineName(text, id) {
    const head = String(text || '').slice(0, 4000);
    const m = head.match(/^#\s*name:\s*(.+)$/im) || head.match(/^#\s*(?:filter|title)\s*:\s*(.+)$/im) || head.match(/^#\s*(NeverSink.*?filter.*?)$/im);
    return (m ? m[1] : id).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Online filter';
  }

  function list() {
    const out = { folder: gameFolder(), game: C.tg(), local: [], online: [] };
    try {
      for (const f of fs.readdirSync(gameFolder())) {
        if (!/\.filter$/i.test(f)) continue;
        const full = path.join(gameFolder(), f);
        const st = fs.statSync(full);
        let edited = 0;
        try { edited = F.readEdits(fs.readFileSync(full, 'utf8').slice(0, 200000)).length; } catch (_) { /* unreadable */ }
        out.local.push({ file: full, name: f.replace(/\.filter$/i, ''), at: st.mtimeMs, size: st.size, edited });
      }
    } catch (_) { /* no folder yet */ }
    try {
      for (const f of fs.readdirSync(onlineFolder())) {
        const full = path.join(onlineFolder(), f);
        const st = fs.statSync(full);
        if (!st.isFile() || st.size < 100) continue;
        let head = '';
        try { const fd = fs.openSync(full, 'r'); const b = Buffer.alloc(4000); const n = fs.readSync(fd, b, 0, 4000, 0); fs.closeSync(fd); head = b.slice(0, n).toString('utf8'); } catch (_) { /* unreadable */ }
        if (!/^\s*(Show|Hide|Minimal)\b/m.test(head) && !/#/.test(head)) continue;
        out.online.push({ id: f, name: onlineName(head, f), at: st.mtimeMs, size: st.size });
      }
    } catch (_) { /* no online filters */ }
    out.local.sort((a, b) => b.at - a.at);
    out.online.sort((a, b) => b.at - a.at);
    return out;
  }

  // an online filter, copied to a local file you can edit (the online one stays as it is)
  function copyOnline(id) {
    const src = onlinePath(id);
    if (!src || !fs.existsSync(src)) return { ok: false, error: 'That online filter isn\'t there any more: pick it in the game once so the game downloads it.' };
    const text = fs.readFileSync(src, 'utf8');
    const base = `${onlineName(text, id)} (local copy)`;
    let file = path.join(gameFolder(), `${base}.filter`);
    for (let n = 2; fs.existsSync(file) && n < 50; n++) file = path.join(gameFolder(), `${base} ${n}.filter`);
    fs.writeFileSync(file, F.markOnline(text, id));
    C.log(`filter editor: copied online filter ${id} to ${path.basename(file)}`);
    return { ok: true, file, name: path.basename(file, '.filter') };
  }

  // the online filter a local copy came from: the id on its first line, or (copies made before that)
  // the online filter whose name the copy's name starts with
  function onlineSourceOf(f, text) {
    const id = F.onlineSource(text);
    if (id && onlinePath(id) && fs.existsSync(onlinePath(id))) return { id, name: onlineName(fs.readFileSync(onlinePath(id), 'utf8').slice(0, 4000), id) };
    const base = F.copyBaseName(path.basename(f, '.filter'));
    if (!base) return null;
    const hit = list().online.find((o) => o.name === base);
    return hit ? { id: hit.id, name: hit.name } : null;
  }
  // the local copy made the online filter again, as it is now: your edits are dropped, the file as it
  // was is kept next to it (.before-reset.bak)
  function resetOnline(file) {
    const f = localPath(file);
    if (!f || !fs.existsSync(f)) return { ok: false, error: 'Pick one of your filters.' };
    const cur = fs.readFileSync(f, 'utf8');
    const src = onlineSourceOf(f, cur);
    if (!src) return { ok: false, error: 'Can\'t find the online filter this is a copy of. Pick it in the game once so the game downloads it.' };
    const dropped = F.readEdits(cur).length;
    try { fs.writeFileSync(f.replace(/\.filter$/i, '.before-reset.bak'), cur); } catch (err) { C.log('filter editor: backup before reset failed: ' + err.message); }
    fs.writeFileSync(f, F.markOnline(fs.readFileSync(onlinePath(src.id), 'utf8'), src.id));
    cache.delete(f);
    C.log(`filter editor: ${path.basename(f)}: reset to online filter ${src.id} (${dropped} edits dropped)`);
    return { ok: true, dropped, online: src.name };
  }

  // parsed files, kept while unchanged on disk
  const cache = new Map(); // file -> { mtime, text, parsed }
  function read(file) {
    const st = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtime === st.mtimeMs) return hit;
    const text = fs.readFileSync(file, 'utf8');
    const v = { mtime: st.mtimeMs, text, parsed: F.parse(text) };
    cache.set(file, v);
    if (cache.size > 6) cache.delete(cache.keys().next().value);
    return v;
  }

  function open(file) {
    const f = localPath(file);
    if (!f || !fs.existsSync(f)) return { ok: false, error: 'Pick one of your filters.' };
    const r = read(f);
    const edits = F.readEdits(r.text);
    const names = new Set(F.baseTypes(r.parsed));
    for (const e of edits) names.add(e.baseType);
    return { ok: true, file: f, name: path.basename(f, '.filter'), items: [...names].sort((a, b) => a.localeCompare(b)), tiers: F.tiers(F.parse(F.withoutEdits(r.text))), edits,
      autoTiers: edits.filter((e) => e.auto).length, blocks: r.parsed.blocks.length, online: onlineSourceOf(f, r.text) };
  }

  // how an item looks now: the block that decides it, in the filter with your edits and without them
  function itemInfo(file, q) {
    const f = localPath(file);
    if (!f) return { ok: false, error: 'Pick one of your filters.' };
    const r = read(f);
    const item = { baseType: String(q.baseType || ''), itemClass: q.itemClass || null, rarity: q.rarity || null, itemLevel: q.itemLevel || null, areaLevel: q.areaLevel || null, stack: q.stack || null };
    const now = F.findBlock(r.parsed, item);
    const orig = F.findBlock(F.parse(F.withoutEdits(r.text)), item);
    const edit = F.readEdits(r.text).find((e) => e.baseType.toLowerCase() === item.baseType.toLowerCase()) || null;
    const view = (m) => (m ? { action: m.block.action, label: m.block.label || `block at line ${m.block.line + 1}`, line: m.block.line + 1, styles: m.styles, unsure: [...new Set(m.unsure)] } : null);
    return { ok: true, item, now: view(now), original: view(orig), edit };
  }

  function writeEdits(f, edits) {
    const r = read(f);
    // the first edit of a file: a copy of it as it was, next to it
    const backup = f.replace(/\.filter$/i, '.before-edits.bak');
    if (!F.readEdits(r.text).length && !fs.existsSync(backup)) { try { fs.writeFileSync(backup, r.text); } catch (err) { C.log('filter editor: backup failed: ' + err.message); } }
    fs.writeFileSync(f, F.apply(r.text, edits));
    cache.delete(f);
  }
  function setEdit(file, baseType, edit) {
    const f = localPath(file);
    if (!f || !fs.existsSync(f)) return { ok: false, error: 'Pick one of your filters.' };
    const name = String(baseType || '').trim().slice(0, 80);
    if (!name) return { ok: false, error: 'Pick an item.' };
    const clean = edit ? { show: edit.show !== false, style: edit.show === false ? null : (edit.style || null), rarity: /^(<=|>=|<|>|=|==)?\s*(Normal|Magic|Rare|Unique)$/.test(edit.rarity || '') ? edit.rarity : undefined,
      note: String(edit.note || `${name}: your edit`).slice(0, 60) } : null;
    const edits = F.setEdit(F.readEdits(read(f).text), name, clean);
    writeEdits(f, edits);
    C.log(`filter editor: ${path.basename(f)}: ${clean ? (clean.show ? 'styled' : 'hid') : 'took the edit off'} ${name}`);
    return { ok: true, ...itemInfo(f, { baseType: name }) };
  }

  // tiers by today's prices (poe.ninja, every exchange list of the league in one answer)
  async function autoTiers(file, on) {
    const f = localPath(file);
    if (!f || !fs.existsSync(f)) return { ok: false, error: 'Pick one of your filters.' };
    const mine = F.readEdits(read(f).text).filter((e) => !e.auto);
    if (!on) { writeEdits(f, mine); return { ok: true, count: 0 }; }
    const league = await C.ninjaLeague();
    const all = await C.ninjaGet([C.ninjaLib.allExchangeUrl(league, C.tg())]);
    const prices = [];
    for (const d of Object.values((all && all.types) || {})) {
      const idx = C.ninjaLib.exchangeIndex(d);
      const rate = d && d.core && d.core.rates && Number(d.core.rates.divine);
      for (const e of idx.values()) {
        const div = d.core && d.core.primary === 'divine' ? e.value : rate > 0 ? e.value * rate : null;
        if (div != null) prices.push({ name: e.name, div });
      }
    }
    if (!prices.length) return { ok: false, error: `poe.ninja has no prices for ${league} right now.` };
    const auto = F.priceEdits(prices, mine);
    writeEdits(f, [...mine, ...auto]);
    const by = {}; for (const e of auto) by[e.auto] = (by[e.auto] || 0) + 1;
    C.log(`filter editor: ${path.basename(f)}: tiers by price for ${auto.length} items (${league})`);
    return { ok: true, count: auto.length, by, league };
  }

  function copiedItem() {
    const it = C.lastItem;
    if (!it || (it.game && it.game !== C.tg())) return null;
    const unique = /unique/i.test(it.rarity || '');
    return { baseType: unique ? it.baseType || it.name : it.baseType || it.name, name: it.name, itemClass: it.itemClass || null, rarity: it.rarity || null, itemLevel: it.itemLevel || null };
  }

  // ---------- the window ----------
  let win = null;
  function openWindow() {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
    const area = screen.getPrimaryDisplay().workArea;
    const b = C.store.settings.filterEditorBounds || { width: 900, height: 720, x: area.x + Math.round((area.width - 900) / 2), y: area.y + 60 };
    win = new BrowserWindow({
      ...b, minWidth: 640, minHeight: 420, show: false, frame: false, alwaysOnTop: true, skipTaskbar: false, title: 'Loot filter editor', backgroundColor: '#0e0c0a', icon: C.ICON,
      webPreferences: { preload: C.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(__dirname, '..', 'ui', 'filter-editor.html'));
    win.once('ready-to-show', () => win && win.show());
    let t = null;
    const remember = () => { clearTimeout(t); t = setTimeout(() => { if (win && !win.isDestroyed()) C.store.setSetting('filterEditorBounds', win.getBounds()); }, 400); };
    win.on('move', remember); win.on('resize', remember);
    win.on('closed', () => { win = null; });
  }
  function toggleWindow() { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); else openWindow(); }
  let hk = null;
  function registerHotkey() {
    if (hk) { try { globalShortcut.unregister(hk); } catch (_) { /* ignore */ } hk = null; }
    const want = C.store.settings.filterHotkey || '';
    if (!want) return { ok: true, accelerator: null };
    let ok = false;
    try { ok = globalShortcut.register(want, toggleWindow); } catch (_) { ok = false; }
    if (ok) hk = want;
    C.log(`filter editor hotkey ${want}: ${ok ? 'registered' : 'FAILED'}`);
    return ok ? { ok, accelerator: want } : { ok, error: `${want} is already used by another program. Pick a different key.` };
  }

  const wrap = (fn) => async (_e, ...a) => { try { return await fn(...a); } catch (err) { C.log('filter editor: ' + (err.stack || err)); return { ok: false, error: err.message || String(err) }; } };
  ipcMain.handle('lf:list', wrap(() => list()));
  ipcMain.handle('lf:copyOnline', wrap((id) => copyOnline(id)));
  ipcMain.handle('lf:resetOnline', wrap((file) => resetOnline(file)));
  ipcMain.handle('lf:open', wrap((file) => { C.store.setSetting('filterEditorFile', file); return open(file); }));
  ipcMain.handle('lf:last', wrap(() => C.store.settings.filterEditorFile || null));
  ipcMain.handle('lf:item', wrap((file, q) => itemInfo(file, q || {})));
  ipcMain.handle('lf:setEdit', wrap((file, baseType, edit) => setEdit(file, baseType, edit)));
  ipcMain.handle('lf:autoTiers', wrap((file, on) => autoTiers(file, !!on)));
  ipcMain.handle('lf:copied', wrap(() => copiedItem()));
  ipcMain.handle('lf:reload', wrap((file) => {
    const f = localPath(file);
    if (!f) return { ok: false, error: 'Pick one of your filters.' };
    const cmd = `/itemfilter ${path.basename(f, '.filter')}`;
    C.lastClip = cmd; C.clipWrite(cmd);
    return { ok: true, cmd };
  }));
  ipcMain.handle('lf:folder', wrap(() => { shell.openPath(gameFolder()); return true; }));
  ipcMain.handle('hotkey:setFilter', wrap((accel) => {
    const prev = C.store.settings.filterHotkey || '';
    const want = typeof accel === 'string' ? accel.trim().slice(0, 40) : '';
    C.store.setSetting('filterHotkey', want);
    const st = registerHotkey();
    if (!st.ok) { C.store.setSetting('filterHotkey', prev); registerHotkey(); }
    return { ...st, accelerator: st.ok ? want : prev };
  }));
  ipcMain.on('lf:window', () => openWindow());
  ipcMain.on('lf:hide', () => { if (win && !win.isDestroyed()) win.hide(); });

  return { openWindow, toggleWindow, registerHotkey, active: () => hk, list, open, itemInfo, setEdit, copyOnline, resetOnline };
};
