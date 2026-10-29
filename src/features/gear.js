'use strict';

// Your gear, weights, settings, characters and resistances (IPC for the settings window).
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const ignoreLib = require('../core/ignore');
const catalogLib = require('../core/catalog');
const { suggestWeights } = require('../core/autoweights');
const { parseItem } = require('../core/parser');
const { SLOTS, SLOT_GROUPS, WEAKEST_OF } = require('../core/slots');
const resLib = require('../core/resists');

module.exports = function (C) {
  // ---------- shared IPC ----------

  function notifySettings(channel, payload) {
    if (C.settingsWin && !C.settingsWin.isDestroyed()) C.settingsWin.webContents.send(channel, payload);
  }

  function resolveItem(target) {
    if (target && typeof target === 'object' && target.itemId) return C.itemById(target.itemId);
    // the item you copied last, unless it's from the other game (its stat ids and league differ)
    if (target === '__last') return C.lastItem && (!C.lastItem.game || C.lastItem.game === C.tg()) ? C.lastItem : null;
    if (WEAKEST_OF.includes(target)) {
      // your weakest ring / charm / jewel (by gear score, or weights if the build is off)
      const items = SLOT_GROUPS[target].map((sl) => C.store.equipped[sl]).filter(Boolean);
      // no jewels saved, but PoB has your tree's: search from the jewel you just copied
      if (!items.length) return target === 'Jewel' && C.pobOn() && C.lastItem && C.lastItem.slot === 'Jewel' ? C.lastItem : null;
      const val = (it) => { const g = C.gearOf(it); if (g && g.score != null) return g.score; return require('../core/scorer').score(it, C.store.weights); };
      return items.slice().sort((a, b) => val(a) - val(b))[0];
    }
    return C.store.equipped[target] || null;
  }

  function resolveSlotOf(item) {
    for (const [sl, it] of Object.entries(C.store.equipped || {})) if (it === item || (it && item && it.id && it.id === item.id)) return sl;
    return null;
  }

  function refreshAll() {
    // a price card (currency, gems...) or map check isn't a comparison: it stays as it is
    if (C.popupItem && C.popupItem.slot && C.popup && C.popup.isVisible() && !(C.popupResult && C.popupResult.kind === 'quickprice')) {
      const r = C.evaluate(C.popupItem);
      const seq = ++C.popupSeq;
      // the unique's poe.ninja price stays (it doesn't depend on your settings)
      if (C.popupResult && C.popupResult.item && r && r.item && C.popupResult.item.id === r.item.id) { r.ninja = C.popupResult.ninja; r.sellNote = C.popupResult.sellNote; }
      C.popupResult = r;
      const withPob = r && r.ok && !r.isEquipped && C.pobOn() && C.pobCanJudge(C.popupItem, r.targetSlot);
      if (withPob) r.pobPending = true;
      C.popup.webContents.send('popup:result', C.serialise({ ...r, keepState: true }));
      // and Path of Building again (settings like priorities change its verdict)
      if (withPob) {
        const item = C.popupItem;
        C.pobJudge([{ item, slot: r.targetSlot }]).then((res) => {
          const j = res[0];
          r.pobPending = false;
          if (j) C.applyPob(r, j); else r.pobError = C.pobErrorOf(res, 0);
        }).catch((err) => { r.pobPending = false; r.pobError = err.message; C.log('pob: ' + err.message); })
          .then(() => { if (seq === C.popupSeq && C.popupItem === item && C.popup && !C.popup.isDestroyed() && C.popup.isVisible()) C.popup.webContents.send('popup:result', C.serialise({ ...r, keepState: true })); });
      }
    }
    if (C.settingsWin && !C.settingsWin.isDestroyed()) C.settingsWin.webContents.send('settings:changed');
    if (C.resultsWin && !C.resultsWin.isDestroyed()) C.resultsWin.webContents.send('settings:changed');
  }

  ipcMain.handle('equip', (_e, slot, ref) => {
    let item = null;
    if (ref && typeof ref === 'object' && ref.itemId) item = C.itemById(ref.itemId);
    else if (typeof ref === 'string' && ref) item = parseItem(ref);
    else item = C.lastItem;
    if (!item || !SLOTS.includes(slot)) return false;
    C.log(`equip ${slot}: "${item.name}"`);
    const before = C.store.equipped[slot];
    if (C.store.settings.resists) C.store.setSetting('resists', resLib.rebase(C.store.settings.resists, before, item));
    C.store.setEquipped(slot, item);
    C.store.noteStats(item);
    // Path of Building gets the new gear before the popup is judged again (it was a tick later, so the
    // refreshed verdict was still against your old item)
    C.pobSync();
    refreshAll();
    return true;
  });

  ipcMain.handle('weights:set', (_e, key, value) => { C.store.setWeight(key, value); refreshAll(); return true; });
  ipcMain.handle('weights:replace', (_e, obj) => { C.store.replaceWeights(obj); refreshAll(); return true; });
  ipcMain.handle('weights:suggest', () => {
    const rules = C.ignoreRules();
    return suggestWeights(C.store.equipped, (k) => ignoreLib.isIgnored(rules, k));
  });
  ipcMain.handle('weights:reset', () => { C.store.resetWeights(); refreshAll(); return true; });
  ipcMain.handle('slot:clear', (_e, slot) => { C.store.setEquipped(slot, null); C.pobSync(); refreshAll(); return true; });
  ipcMain.handle('setting:set', (_e, key, value) => {
    C.store.setSetting(key, value);
    if (key === 'build') C.store.setSetting('buildPicked', true); // you chose it: PoB imports won't change it
    if (key === 'startWithWindows') C.applyLoginItem();
    if (key === 'build' || key === 'colorblind' || key === 'popupDetail' || key === 'buildTweaks' || key === 'pobDamageWeight') { if (key === 'pobDamageWeight') C.pobQueries.clear(); refreshAll(); }
    if (key === 'resultsHotkey') C.registerResultsHotkey();
    if (key === 'autoSwitchChar') { C.log(`characters: switch by the game's log ${value ? 'on' : 'off'}`); if (C.routeLogNeedChanged) C.routeLogNeedChanged(); }
    // a guide build that follows your levelling level: its stage moves with it (a moment later, once typing stops)
    if (key === 'leveling') {
      const src = C.store.buildSource();
      if (src && src.planner && src.type === 'file' && (src.stage === 'level' || src.stage == null)) {
        clearTimeout(C.levelSyncTimer);
        C.levelSyncTimer = setTimeout(() => C.syncBuild('stage').catch((err) => C.log('build sync: ' + err.message)), 1500);
      }
    }
    if (key === 'autoUpdate' && C.updates.updater()) C.updates.updater().autoDownload = value !== false;
    if (key === 'betaUpdates') C.updates.setBetas();
    if ((key === 'wizardDone' || key === 'usageStats') && value) setTimeout(() => C.usage.send(), 5000);
    if (key === 'uiScale') { [C.settingsWin, C.resultsWin].forEach((w) => { try { if (w && !w.isDestroyed()) w.webContents.setZoomFactor(C.uiScale()); } catch (_) { /* ignore */ } }); }
    C.buildTrayMenu();
    return true;
  });

  // Stat database for the picker (trade site stat list + what you've seen per class).
  ipcMain.handle('stats:catalog', async () => {
    try {
      const d = await C.loadTradeData(false);
      return { ok: true, ...catalogLib.buildCatalog(d.index, C.store.data.seenByClass) };
    } catch (err) {
      return { ok: false, error: 'Could not load the trade site stat list: ' + (err.message || err) };
    }
  });

  // ---------- characters ----------
  ipcMain.handle('profiles:list', () => C.store.listProfiles());
  ipcMain.handle('profiles:switch', (_e, id) => { const ok = C.store.switchProfile(id); C.log(`switched to character ${id}`); C.gameChanged(); return ok; });
  // a character's Path of Building build (and guide) files, by character id
  const buildFiles = (id) => [C.pobFile(id), C.pobFile(id).replace(/\.xml$/, '.build')];
  function copyBuildFiles(from, to) {
    const [a, b] = [buildFiles(from), buildFiles(to)];
    a.forEach((f, i) => { try { if (fs.existsSync(f)) fs.copyFileSync(f, b[i]); } catch (err) { C.log(`characters: could not copy ${path.basename(f)}: ${err.message}`); } });
  }
  function removeBuildFiles(id) {
    for (const f of buildFiles(id)) { try { fs.rmSync(f, { force: true }); } catch (err) { C.log(`characters: could not remove ${path.basename(f)}: ${err.message}`); } }
  }
  ipcMain.handle('profiles:create', (_e, name, copy) => {
    const from = C.store.data.activeProfile;
    const id = C.store.createProfile(name, !!copy);
    if (copy) copyBuildFiles(from, id);
    else if (C.routeReset) C.routeReset('new character'); // a new character starts the campaign
    C.log(`characters: new character ${id}${copy ? `, a copy of ${from}` : ', empty'}`);
    C.gameChanged();
    return id;
  });
  // the character you're on, from nothing again (same name): gear, build, weights, tweaks, resistances, route
  ipcMain.handle('profiles:reset', (_e, id) => {
    const r = C.store.resetProfile(id);
    if (!r) return null;
    removeBuildFiles(r.old);
    if (r.id === C.store.data.activeProfile && C.routeReset) C.routeReset('character reset');
    C.log(`characters: ${r.old} started again as ${r.id}`);
    C.gameChanged();
    return r.id;
  });
  // the in-game name of one of your characters (the game's log), so the app can switch to it by itself
  ipcMain.handle('profiles:link', (_e, id, name) => {
    const ok = C.store.linkProfile(id, name);
    if (ok) C.log(`characters: ${id} is ${name ? `"${String(name).slice(0, 40)}" in game` : 'not linked to an in-game name'}`);
    C.notifySettings('route:update', C.routeView ? C.routeView() : null);
    return ok;
  });
  // The game's log named the character playing (levelled up, got a quest reward, entered a zone only
  // the route's character would be in). With "switch by itself" on, the app's character linked to
  // that name becomes the one you're on. name null: "someone other than notName", which is used only
  // when exactly one other character of the game is linked.
  let lastLogSwitch = 0;
  function characterFromLog(game, name, why, notName) {
    if (!C.store.settings.autoSwitchChar || game !== C.store.activeGame()) return false;
    let id = null;
    if (name) id = C.store.profileForGameChar(game, name);
    else {
      const others = C.store.listProfiles().filter((p) => p.game === game && p.gameChar && (!notName || p.gameChar.toLowerCase() !== String(notName).toLowerCase()));
      if (others.length === 1) id = others[0].id;
    }
    if (!id || id === C.store.data.activeProfile) return false;
    // not in the middle of a price check or item check: the next log line does it
    if (C.hotkeyBusy) return false;
    // not twice in a few seconds (a zone and a level-up line together)
    if (Date.now() - lastLogSwitch < 3000) return false;
    lastLogSwitch = Date.now();
    C.store.switchProfile(id);
    const p = C.store.profileOf(id);
    C.log(`characters: switched to "${p.name}" (${p.gameChar} in game, ${why || 'the game\'s log'})`);
    C.gameChanged();
    C.notifySettings('game:changed', { game, from: game, character: id });
    return true;
  }
  ipcMain.handle('profiles:rename', (_e, id, name) => { C.store.renameProfile(id, name); C.buildTrayMenu(); return true; });
  ipcMain.handle('profiles:delete', (_e, id) => {
    const ok = C.store.deleteProfile(id);
    if (ok) { removeBuildFiles(id); C.log(`characters: deleted ${id}`); }
    C.gameChanged();
    return ok;
  });

  // ---------- resistances ----------
  ipcMain.handle('resists:set', (_e, r) => {
    const clean = {};
    for (const k of ['fire', 'cold', 'lightning', 'chaos', 'cap', 'buffer']) {
      const v = r && r[k] !== '' && r[k] != null ? Number(r[k]) : null;
      if (Number.isFinite(v)) clean[k] = v;
    }
    const prev = C.store.settings.resists;
    const hasRes = ['fire', 'cold', 'lightning', 'chaos'].some((k) => k in clean);
    // typed in = read off the character sheet with the gear you're wearing now
    const changedRes = !prev || ['fire', 'cold', 'lightning', 'chaos'].some((k) => clean[k] !== (resLib.live(prev, C.store.equipped) || {})[k]);
    if (!hasRes) C.store.setSetting('resists', null);
    else if (changedRes) C.store.setSetting('resists', resLib.snapshot(clean, C.store.equipped, 'game', prev));
    else C.store.setSetting('resists', { ...prev, cap: clean.cap || prev.cap, ...(clean.buffer != null ? { buffer: clean.buffer, bufferSet: true } : {}) });
    refreshAll();
    return C.store.settings.resists;
  });

  return {
    characterFromLog,
    notifySettings,
    resolveItem,
    resolveSlotOf,
    refreshAll,
  };
};
