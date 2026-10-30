'use strict';

// The rest of the settings window's requests: search strings, boss and anoint checks, Path of
// Building's status and priorities, ignored stats, the window's state, and opening pages.
const { app, ipcMain } = require('electron');
const trade = require('../core/trade');
const ignoreLib = require('../core/ignore');
const gamesLib = require('../core/games');
const gearLib = require('../core/gearscore');
const { parseItem } = require('../core/parser');
const { SLOTS, MAIN_SLOTS } = require('../core/slots');
const pobVerdict = require('../core/pobverdict');

module.exports = function (C) {
  const searchStr = require('../core/searchstr');
  function resShort() {
    const rs = C.liveResists();
    if (!rs) return [];
    return ['fire', 'cold', 'lightning'].filter((el) => rs[el] != null && rs[el] < ((rs.caps && rs.caps[el]) || rs.cap || 75));
  }
  function avoidKeys(extra) {
    const marks = ((C.store.settings.mapMarks || {})[C.tg()]) || {};
    return [...(Array.isArray(extra) ? extra.filter((k) => typeof k === 'string').slice(0, 30) : []), ...Object.keys(marks).filter((k) => marks[k] === 'd')];
  }
  ipcMain.handle('strings:get', () => ({ game: C.tg(), resShort: resShort(), mapAvoid: searchStr.mapAvoid(avoidKeys()), limit: searchStr.LIMIT,
    marked: avoidKeys().length }));
  ipcMain.handle('strings:vendor', (_e, opts) => searchStr.vendor({ ...(opts || {}), game: C.tg() }));
  ipcMain.handle('strings:mapAvoid', (_e, keys) => {
    const r = searchStr.mapAvoid(avoidKeys(keys));
    if (r.text) { C.lastClip = r.text; C.clipWrite(r.text); }
    return r;
  });
  // PoE1: how many hits of each Path of Building boss preset your character takes (Pinnacle and Uber)
  ipcMain.handle('pob:bosscheck', async () => {
    if (C.tg() !== 'poe1') return { ok: false, error: 'The boss check is for Path of Exile 1.' };
    if (!C.pobOn()) return { ok: false, error: 'Add your Path of Building build on My gear first.' };
    try {
      await C.pobEngine().ensureLoaded();
      const r = await C.pobEngine().bossCheck({});
      return { ok: true, skills: (r.skills || []).filter((x) => x.damageType !== 'DamageOverTime') };
    } catch (err) { C.log('boss check: ' + (err.message || err)); return { ok: false, error: err.message || String(err) }; }
  });
  // the best notables to anoint (PoE1, with oils) or instil (PoE2, with distilled emotions) on your amulet
  ipcMain.handle('pob:anoints', async () => {
    if (!C.pobOn()) return { ok: false, error: 'Add your Path of Building build on My gear first.' };
    try {
      await C.pobEngine().ensureLoaded();
      const r = await C.pobEngine().anointCheck({});
      const now = new Set((r.now || []).map((x) => String(x).toLowerCase()));
      const list = (r.results || []).map((x) => {
        const j = pobVerdict.judge(r.before, x.after, C.pobWeights());
        return j && { name: x.name, stats: (x.stats || []).slice(0, 6).map(String), recipe: (x.recipe || []).map(String), current: now.has(String(x.name).toLowerCase()),
          score: j.score, verdict: j.verdict, dps: j.dps && j.dps.pct, ehp: j.ehp && j.ehp.pct, dpsKey: j.dpsKey, res: j.resGain, breaks: j.breaks };
      }).filter(Boolean).sort((a, b) => (a.breaks.length - b.breaks.length) || (b.score - a.score));
      const current = list.filter((x) => x.current);
      return { ok: true, game: C.tg(), now: r.now || [], noAmulet: !!r.noAmulet, current, top: list.slice(0, 12), checked: r.checked, total: r.total };
    } catch (err) { C.log('anoint check: ' + (err.message || err)); return { ok: false, error: err.message || String(err) }; }
  });
  ipcMain.handle('pob:status', async (_e, load) => {
    const eng = C.pobEngine();
    const out = { available: eng.available(), hasBuild: !!C.pobXml(), on: C.pobOn(), enabled: C.store.settings.usePob !== false };
    if (load && C.pobOn()) {
      eng.resetFailure();
      try { out.summary = C.pobSummary(await eng.ensureLoaded()); } catch (err) { out.error = err.message; }
    } else if (eng.info()) out.summary = C.pobSummary(eng.info());
    // keep showing the last good summary while the engine reloads after a gear change
    const key = C.store.data.activeProfile;
    if (out.summary) C.pobLastSummary.set(key, out.summary);
    else if (C.pobOn() && C.pobLastSummary.has(key)) out.summary = C.pobLastSummary.get(key);
    return out;
  });
  ipcMain.handle('priorities:set', (_e, p) => {
    const clean = {};
    for (const k of Object.keys(pobVerdict.DEFAULT_PRIORITIES)) if (p && typeof p[k] === 'boolean') clean[k] = p[k];
    C.store.setSetting('priorities', { ...C.pobPriorities(), ...clean });
    C.pobQueries.clear();
    C.refreshAll();
    return C.pobPriorities();
  });
  ipcMain.handle('pob:enable', (_e, on) => { C.store.setSetting('usePob', !!on); if (on) { C.pobEngine().resetFailure(); C.pobSync(); } C.refreshAll(); return C.pobOn(); });

  ipcMain.handle('ignore:set', (_e, rules) => {
    C.store.setSetting('ignoreStats', ignoreLib.cleanRules(rules));
    C.log('ignored stats: ' + JSON.stringify(C.store.settings.ignoreStats));
    C.refreshAll();
    return C.store.settings.ignoreStats;
  });

  ipcMain.handle('state:get', () => JSON.parse(JSON.stringify({
    platform: process.platform, dataDir: app.getPath('userData'), loadError: C.store.loadError || null,
    game: C.store.activeGame(), lastGame: C.store.data.lastGame || null,
    defaultBuild: gearLib.DEFAULT_BUILD,
    pobOn: C.pobOn(),
    resultsHotkeyOk: !!C.resultsHotkey,
    priorities: C.pobPriorities(),
    profiles: C.store.listProfiles(),
    buildStats: gearLib.buildStats(C.store.settings.build),
    builds: gearLib.buildList(),
    buildParts: gearLib.buildParts(),
    buildNow: C.store.settings.build === 'off'
      ? { ...(gearLib.buildInfo(C.store.settings.buildLast) || gearLib.buildInfo(gearLib.DEFAULT_BUILD)), id: 'off', custom: true, name: 'Custom (my own stat weights)' }
      : gearLib.buildInfo(C.store.settings.build),
    gearScores: Object.fromEntries(Object.entries(C.store.equipped).map(([slot, it]) => [slot, C.gearOf(it, slot)])),
    mainSlots: MAIN_SLOTS,
    ignorePresets: Object.entries(ignoreLib.PRESETS).map(([id, p]) => ({ id, label: p.label })),
    budgetLabel: trade.budgetLabel(C.budgetNow(), C.tg()),
    charLevel: C.pobOn() ? ((C.pobEngine().info() || {}).level || null) : null,
    weights: C.store.weights,
    equipped: C.store.equipped,
    seenStats: Object.keys(C.store.data.seenStats),
    settings: C.store.settings,
    liveResists: C.liveResists(),
    slots: SLOTS,
    lastItem: C.lastItem,
    hotkeyStatus: C.hotkeyStatus,
  })));

  ipcMain.handle('evaluate:text', (_e, text) => {
    const item = parseItem(text);
    if (!item) return { ok: false, reason: 'That doesn\'t look like Path of Exile item text. In game, hover an item and press Ctrl+C.' };
    // an item from the other game is judged against that game's character, as F2 would
    const ig = gamesLib.gameFromItemText(text);
    if (ig && ig !== C.store.activeGame() && !C.store.profileForGame(ig)) return { ok: false, reason: `That's a ${C.G(ig).name} item, and you have no ${C.G(ig).short} character yet. Press F2 on an item in ${C.G(ig).short}, or import a ${C.G(ig).short} build on My gear, to make one.` };
    if (ig && ig !== C.store.activeGame()) { C.store.switchProfile(C.store.profileForGame(ig)); C.popupItem = null; C.gameChanged(); }
    C.store.noteStats(item);
    C.remember(item);
    C.notifySettings('item:copied', { id: item.id, name: item.name });
    const r = C.evaluate(item);
    // the same Path of Building verdict the popup gives, so "Check an item" agrees with it
    if (!(r && r.ok && !r.isEquipped && C.pobOn() && C.pobCanJudge(item, r.targetSlot))) return C.serialise(r);
    return C.pobJudge([{ item, slot: r.targetSlot }]).then((res) => { if (res[0]) C.applyPob(r, res[0]); else r.pobError = C.pobErrorOf(res, 0); })
      .catch((err) => { r.pobError = err.message; C.log('pob: ' + err.message); })
      .then(() => C.serialise(r));
  });

  ipcMain.on('open:settings', () => C.openSettings());
  ipcMain.on('open:tab', (_e, tab) => openTab(tab));
  function openTab(tab) {
    const fresh = !(C.settingsWin && !C.settingsWin.isDestroyed());
    C.openSettings();
    const send = () => C.settingsWin.webContents.send('settings:tab', tab);
    if (fresh) C.settingsWin.webContents.once('did-finish-load', send); else send();
  }

  ipcMain.on('find:open', (_e, slot) => {
    const fresh = !(C.settingsWin && !C.settingsWin.isDestroyed());
    C.openSettings();
    const send = () => C.settingsWin.webContents.send('find:slot', slot);
    if (fresh) C.settingsWin.webContents.once('did-finish-load', send); else send();
  });

  return {};
};
