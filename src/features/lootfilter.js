'use strict';

// A loot filter section from your build, saved as a copy of your own filter:
//  - the guide's uniques you don't have yet, and the best runes for your sockets (Best runes)
//  - identified rares with the mods your build values most (PoE1: affix names)
//  - better bases of the kinds you wear (Path of Building's base data), and your own bases
// The app remembers the file it wrote for each character, says when your gear or build has changed
// since, and can make it again in place (your own filter is read again, so its updates come along).
// Moved out of main.js: it reaches the app's shared state and helpers through C (see main.js).
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

module.exports = function (C) {
  const filterLib = require('../core/lootfilter');
  function filterFolder() {
    const docs = app.getPath('documents');
    const dir = path.join(docs, 'My Games', C.tg() === 'poe1' ? 'Path of Exile' : 'Path of Exile 2');
    return fs.existsSync(dir) ? dir : docs;
  }
  const SLOTS = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring 1', 'Ring 2', 'Belt', 'Weapon', 'Offhand'];
  const myLevel = () => {
    const lv = C.store.settings.leveling;
    if (lv && lv.on && Number(lv.level) > 0) return Number(lv.level);
    const info = C.pobEngine().info();
    return (info && Number(info.level)) || 100;
  };

  // what goes in the section; withMods: also the PoE1 mod highlights (a few engine calls per slot)
  async function makePlan(withMods) {
    const game = C.tg();
    const eng = C.pobEngine();
    await eng.ensureLoaded();
    const level = myLevel();
    const plan = [];
    for (const slot of SLOTS) {
      const it = C.store.equipped[slot];
      const own = it && !/unique/i.test(it.rarity || '') && it.baseType ? it.baseType : null;
      const p = { slot: slot.replace(/ \d$/, ''), cls: it && it.itemClass, bases: own ? [own] : [], better: [], affixes: [] };
      // the mods your build values most for this slot, by affix name: every slot with a non-unique item
      // (weapons and offhands too), with the tags its own base rolls with
      if (withMods && own && !(slot === 'Ring 2' && plan.some((x) => x.slot === 'Ring' && x.affixes.length))) {
        try {
          const qy = await C.pobQueryFor(slot, it);
          const ids = (qy.modWeights || []).filter((m) => /^explicit\./.test(m.id) && m.weight > 0).slice(0, 8).map((m) => m.id);
          const names = ids.length ? await eng.affixes({ ids, tags: filterLib.tagsFor(slot, it) || [], base: it.baseType, tiers: 3 }) : {};
          p.affixes = ids.flatMap((id) => (names[id] || []).filter((m, i) => i === 0 || m.level >= 20).map((m) => m.affix));
        } catch (err) { C.log(`filter: ${slot}: ${err.message}`); }
      }
      if (!C.sameGame()) return null;
      plan.push(p);
    }
    // better bases of the kinds you wear, that you can use now or within 5 levels
    const ask = plan.map((p) => p.bases[0] && { slot: p.slot, base: p.bases[0] }).filter(Boolean);
    if (ask.length) {
      try {
        const r = await eng.betterBases({ level, ahead: 5, slots: ask });
        for (const s of r.slots || []) { const p = plan.find((x) => x.slot === s.slot && x.bases[0] === s.base); if (p) p.better = (s.better || []).slice(0, 3).map((b) => b.name); }
      } catch (err) { C.log('filter: better bases: ' + err.message); }
    }
    // the guide's uniques you don't wear yet
    const src = C.store.buildSource();
    const worn = new Set(Object.values(C.store.equipped || {}).filter((x) => x && !x.fromGuide).map((x) => x.name));
    const uniques = ((src && src.uniques) || []).filter((u) => !worn.has(u.name));
    const runes = C.runePicks ? C.runePicks() : [];
    const prof = C.store.listProfiles().find((x) => x.active);
    return { plan, opts: { game, name: prof && prof.name, level, uniques, runes } };
  }
  const sigOf = (made) => filterLib.signature(made.plan.map((p) => ({ ...p, affixes: [] })), made.opts);
  const messageOf = (file, section) => {
    const bits = [];
    if (section.uniques) bits.push(`${section.uniques} unique${section.uniques === 1 ? '' : 's'} your build uses`);
    if (section.runes) bits.push(`${section.runes} rune${section.runes === 1 ? '' : 's'} for your sockets`);
    if (section.modBlocks) bits.push(`${section.modBlocks} slot${section.modBlocks === 1 ? '' : 's'} of mod highlights`);
    if (section.better) bits.push(`${section.better} better base${section.better === 1 ? '' : 's'}`);
    if (section.bases) bits.push(`your ${section.bases} base${section.bases === 1 ? '' : 's'} (item level ${section.minIlvl}+)`);
    return `Saved "${path.basename(file)}" with ${bits.join(', ')}.`;
  };
  async function writeFilter(file, source, made) {
    const section = filterLib.build(made.plan, made.opts);
    if (!section.blocks) return { ok: false, error: 'Nothing to put in a filter yet: save your gear on My gear first.' };
    let existing = '';
    if (source) { try { existing = fs.readFileSync(source, 'utf8'); } catch (err) { return { ok: false, error: `Couldn't read your filter ${path.basename(source)}: ${err.message}` }; } }
    let out = existing ? filterLib.merge(section, existing) : section.text;
    // edits made in the loot filter editor on this file stay on top when it's made again
    try { const was = fs.existsSync(file) ? require('../core/filterfile').readEdits(fs.readFileSync(file, 'utf8')) : []; if (was.length) out = require('../core/filterfile').apply(out, was); } catch (_) { /* no edits */ }
    try { fs.writeFileSync(file, out); } catch (err) { return { ok: false, error: `Couldn't save it: ${err.message}` }; }
    C.store.setLootFilter({ file, source: source || null, at: Date.now(), sig: sigOf(made), game: made.opts.game });
    C.log(`filter: saved ${file} (${section.blocks} blocks)`);
    return { ok: true, file, section };
  }

  ipcMain.handle('filter:make', C.inGame(async () => {
    if (!C.pobOn()) return { ok: false, error: 'Load your Path of Building build first: the filter is made from what your build needs.' };
    const made = await makePlan(true);
    if (!made) return C.SWITCHED();
    if (!filterLib.build(made.plan, made.opts).blocks) return { ok: false, error: 'Nothing to put in a filter yet: save your gear on My gear first.' };
    const { dialog } = require('electron');
    const win = C.settingsWin && !C.settingsWin.isDestroyed() ? C.settingsWin : undefined;
    const prev = C.store.lootFilter();
    const pick = await dialog.showOpenDialog(win, {
      title: 'Pick the loot filter you use now (Cancel: save this section on its own)', defaultPath: (prev && prev.source) || filterFolder(), properties: ['openFile'], filters: [{ name: 'Loot filters', extensions: ['filter'] }],
    });
    const source = !pick.canceled && pick.filePaths && pick.filePaths[0] ? pick.filePaths[0] : null;
    const base = source ? path.basename(source, '.filter').replace(/ \+ upgrades$/i, '') + ' + upgrades' : `${C.G(made.opts.game).short} upgrades`;
    const dir = source ? path.dirname(source) : filterFolder();
    const save = await dialog.showSaveDialog(win, { title: 'Save the loot filter', defaultPath: (prev && prev.file) || path.join(dir, base + '.filter'), filters: [{ name: 'Loot filters', extensions: ['filter'] }] });
    if (save.canceled || !save.filePath) return { ok: false, error: 'Not saved.' };
    if (source && path.resolve(save.filePath) === path.resolve(source)) return { ok: false, error: 'Save it under a new name: your own filter stays as it is.' };
    const r = await writeFilter(save.filePath, source, made);
    if (!r.ok) return r;
    return { ok: true, file: r.file, message: `${messageOf(r.file, r.section)} In the game: Options → Game → Item Filter, pick it, then reload. The app tells you here when your gear or build changes, so you can make it again in one click.` };
  }));

  // the filter you made: still matching your gear and build?
  ipcMain.handle('filter:status', async () => {
    const lf = C.store.lootFilter();
    if (!lf || lf.game !== C.tg()) return null;
    const out = { file: path.basename(lf.file), at: lf.at, exists: fs.existsSync(lf.file), source: lf.source ? path.basename(lf.source) : null };
    if (!C.pobOn()) return out;
    try { const made = await makePlan(false); if (made) out.upToDate = sigOf(made) === lf.sig; } catch (err) { C.log('filter status: ' + err.message); }
    return out;
  });
  // the same file again, with your filter read again (no dialogs)
  ipcMain.handle('filter:remake', C.inGame(() => remake()));
  async function remake() {
    const lf = C.store.lootFilter();
    if (!lf) return { ok: false, error: 'Make a loot filter first.' };
    if (!C.pobOn()) return { ok: false, error: 'Load your Path of Building build first.' };
    if (!fs.existsSync(path.dirname(lf.file))) return { ok: false, error: `The folder of ${path.basename(lf.file)} is gone: make the filter again.` };
    const made = await makePlan(true);
    if (!made) return C.SWITCHED();
    const r = await writeFilter(lf.file, lf.source && fs.existsSync(lf.source) ? lf.source : null, made);
    if (!r.ok) return r;
    return { ok: true, file: r.file, message: `${messageOf(r.file, r.section)} Reload it in the game (Options → Game → Item Filter → reload).` };
  }
  // your gear or build changed and the filter you made no longer matches: one notification per change,
  // click to make it again in place
  let lastGen = null; let checking = false;
  async function watchStale() {
    if (checking) return;
    const lf = C.store.lootFilter();
    if (!lf || lf.game !== C.tg() || !C.pobOn() || !fs.existsSync(lf.file)) return;
    const gen = C.pobSheetGen();
    if (gen === lastGen) return;
    checking = true;
    try {
      const made = await makePlan(false);
      lastGen = gen;
      if (!made) return;
      const sig = sigOf(made);
      if (sig === lf.sig || sig === lf.toldFor) return;
      C.store.setLootFilter({ ...lf, toldFor: sig });
      C.notifySettings('settings:changed');
      const { Notification } = require('electron');
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: `Your loot filter is out of date`, body: `${path.basename(lf.file)} was made for your old gear or build. Click to make it again.`, icon: C.ICON });
      n.on('click', async () => {
        const r = await remake();
        if (Notification.isSupported()) { const m = new Notification({ title: r.ok ? 'Loot filter made again' : 'Loot filter not made', body: r.ok ? `${path.basename(r.file)}: reload it in the game (Options → Game → Item Filter).` : r.error, icon: C.ICON }); C.keepNotification(m); m.show(); }
        C.notifySettings('settings:changed');
      });
      C.keepNotification(n);
      n.show();
    } catch (err) { C.log('filter watch: ' + err.message); } finally { checking = false; }
  }
  const timer = setInterval(() => { watchStale().catch(() => {}); }, 90 * 1000);
  if (timer.unref) timer.unref();
  return { filterFolder, watchStale };
};
