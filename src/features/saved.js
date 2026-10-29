'use strict';

// Saved searches and their new-listing alerts (both games; the other game's with its own rates).
// Moved out of main.js: it reaches the app's shared state and helpers through C (see main.js).
const { ipcMain, shell, Notification } = require('electron');

module.exports = function (C) {
  function savedList() { return C.store.data.savedSearches || (C.store.data.savedSearches = []); }

  ipcMain.handle('saved:add', (_e, name) => {
    if (!C.resultsState) return { ok: false };
    const { ctx, r } = C.resultsState;
    const list = savedList();
    if (list.find((x) => x.searchKey === ctx.searchKey)) return { ok: true, already: true };
    list.unshift({
      id: 's' + Date.now().toString(36), name: name || ctx.title, league: r.league, game: r.game || C.tg(), body: ctx.body, searchKey: ctx.searchKey,
      mode: ctx.mode, itemClass: ctx.item && ctx.item.itemClass, itemName: ctx.item && ctx.item.name,
      lastTotal: r.total, lastRun: Date.now(), created: Date.now(), lastIds: (r.ids || []).slice(0, 100), alert: false,
    });
    C.store.save();
    C.notifySettings('saved:changed');
    return { ok: true };
  });
  // the game you're playing's saved searches (the other game's are kept for when you play it)
  ipcMain.handle('saved:list', () => JSON.parse(JSON.stringify(savedList().filter((x) => (x.game || 'poe2') === C.tg()).map(({ body, lastIds, ...x }) => x))));
  ipcMain.handle('saved:delete', (_e, id) => {
    C.store.data.savedSearches = savedList().filter((x) => x.id !== id);
    C.store.save();
    return true;
  });
  ipcMain.handle('saved:run', C.inGame(async (_e, id) => {
    const s = savedList().find((x) => x.id === id);
    if (!s) return { ok: false, error: 'Saved search not found.' };
    await C.refreshDivineRate(false);
    const body = JSON.parse(JSON.stringify(s.body));
    const r = await C.runSearch(s.league, body, `saved ${s.name}`, { game: s.game || 'poe2' });
    if (!r.ok) return r;
    const prev = s.lastTotal;
    s.lastTotal = r.total; s.lastRun = Date.now(); s.lastIds = (r.ids || []).slice(0, 100); C.store.save();
    const item = { itemClass: s.itemClass, name: s.itemName, slot: require('../core/slots').slotForClass(s.itemClass) };
    await C.openIfAny(r, { item, mode: s.mode, title: s.name, body, searchKey: s.searchKey,
      note: prev != null && r.total != null ? `${r.total} listings now (${r.total - prev >= 0 ? '+' : ''}${r.total - prev} since last time).` : null });
    return { ...r, prev, ids: undefined, body: undefined };
  }));

  let alertsRunning = false;
  let lastAlertRun = 0;
  ipcMain.handle('saved:alert', (_e, id, on) => {
    const s = savedList().find((x) => x.id === id);
    if (s) { s.alert = !!on; C.store.save(); }
    return !!(s && s.alert);
  });
  ipcMain.handle('alerts:status', () => ({ every: C.store.settings.alertEvery || 0, lastRun: lastAlertRun, running: alertsRunning }));

  // keep notifications alive until they're used, or Windows may drop their click handlers
  const liveNotes = new Set();
  function keepNotification(n) {
    liveNotes.add(n);
    const done = () => liveNotes.delete(n);
    n.on('close', done); n.on('click', () => setTimeout(done, 1000));
    setTimeout(done, 10 * 60000);
  }
  async function runAlerts(force) {
    const every = Number(C.store.settings.alertEvery) || 0;
    if (alertsRunning || (!force && (!every || Date.now() - lastAlertRun < every * 60000))) return;
    const list = savedList().filter((x) => x.alert);
    if (!list.length) return;
    alertsRunning = true; lastAlertRun = Date.now();
    try {
      await C.refreshDivineRate(false);
      for (const s of list) {
        if (C.searchWait() > 0 || C.searchLog.filter((t) => Date.now() - t < 60000).length > 6) { C.log('alerts: leaving the searches to you for now'); break; }
        // alerts run for both games; the other game's use that game's saved rates
        const sg = s.game || 'poe2';
        const here = sg === C.store.activeGame();
        // this game's rates, copied now: switching game swaps the settings object's contents
        const gs0 = here ? C.store.settings : (((C.store.data.gameSettings || {})[sg]) || {});
        const gs = { divineRate: gs0.divineRate, currencyRates: { ...(gs0.currencyRates || {}) } };
        const r = await C.runSearch(s.league, JSON.parse(JSON.stringify(s.body)), `alert ${s.name}`, { maxWait: 0, game: sg, anyGame: true, background: true });
        if (!r.ok) { C.log(`alert ${s.name}: ${r.error}`); if (r.rateLimited) break; continue; }
        if (!Array.isArray(r.ids)) { C.log(`alert ${s.name}: the trade site search couldn't be read in the app`); continue; }
        const prev = Array.isArray(s.lastIds) ? s.lastIds : null;
        const fresh = prev ? r.ids.filter((x) => !prev.includes(x)) : [];
        s.lastIds = r.ids.slice(0, 100); s.lastTotal = r.total; s.lastRun = Date.now();
        C.store.save();
        // a build-value alert: only new listings that clear your +X% under Y div (checked with this
        // game's build, so only while you play that game)
        let worth = null;
        if (fresh.length && s.value) {
          // judged with this game's build, so only while you're on that game; otherwise (or when it
          // can't be judged now) the new listings are kept for the next round
          if (here && sg === C.store.activeGame()) {
            try { worth = await C.gameCtx.run({ game: sg }, () => valueHits(s, r, fresh, gs)); } catch (err) { worth = null; C.log(`alert ${s.name}: ${err.message}`); }
            if (sg !== C.store.activeGame()) worth = null; // you changed game meanwhile
          }
          if (!worth) { C.log(`alert ${s.name}: ${fresh.length} new, checked when they can be judged with your ${C.G(sg).short} build`); s.lastIds = prev; C.store.save(); worth = []; }
          else if (!worth.length) C.log(`alert ${s.name}: ${fresh.length} new, none clear it`);
        }
        if (fresh.length && (!worth || worth.length)) {
          let detail = worth ? `Best: ${worth[0].name}, ${worth[0].gainText} for ${worth[0].price}` : '';
          if (!worth) try {
            const raw = await C.fetchListings(s.league, r.searchId, fresh.slice(0, 3), sg);
            const rates = { ...(gs.currencyRates || {}), ...(gs.divineRate ? { divine: gs.divineRate } : {}) };
            const best = raw.map((x) => C.listingLib.summarise(x, s.itemClass, rates, C.G(sg).base)).sort((a, b) => (a.priceEx || 1e15) - (b.priceEx || 1e15))[0];
            if (best) {
              const g = best.item && here ? C.gearOf(best.item) : null;
              detail = `Cheapest new: ${best.priceText}${g && g.score != null ? ` · gear score ${g.score} ${g.grade}` : ''}`;
            }
          } catch (err) { C.log('alert fetch: ' + err.message); }
          C.log(`alert ${s.name}: ${fresh.length} new`);
          if (Notification.isSupported()) {
            const n = new Notification({ title: worth ? `${worth.length} upgrade${worth.length === 1 ? '' : 's'} for your build: ${s.name}` : `${fresh.length} new listing${fresh.length === 1 ? '' : 's'}${here ? '' : ` (${C.G(sg).short})`}: ${s.name}`, body: detail || 'Click to see them.', icon: C.ICON });
            n.on('click', async () => {
              // the other game's listings would be judged against this game's character: open the trade site instead
              if (sg !== C.store.activeGame()) { if (r.url) shell.openExternal(r.url); return; }
              const rr = await C.runSearch(s.league, JSON.parse(JSON.stringify(s.body)), `alert open ${s.name}`, { game: sg });
              if (rr.ok) await C.openIfAny(rr, { item: { itemClass: s.itemClass, name: s.itemName, slot: require('../core/slots').slotForClass(s.itemClass) }, mode: s.mode, title: s.name, body: s.body, searchKey: s.searchKey, note: `${fresh.length} new since the last check.` });
            });
            keepNotification(n);
            n.show();
          }
          C.notifySettings('saved:changed');
        }
        if (r.near) { C.log('alerts: near the trade site rate limit, stopping this round'); break; }
        await new Promise((res) => setTimeout(res, 3000)); // go easy on the trade site
      }
    } finally { alertsRunning = false; }
  }
  // the new listings of a build-value alert that are +X% for your build under Y div, best first
  async function valueHits(s, r, fresh, gs) {
    const v = s.value;
    const div = gs.divineRate > 0 ? gs.divineRate : null;
    const rates = { ...(gs.currencyRates || {}), ...(div ? { divine: div } : {}) };
    const raw = await C.fetchListings(s.league, r.searchId, fresh.slice(0, 10), s.game || 'poe2');
    const list = raw.map((x) => C.listingLib.summarise(x, s.itemClass, rates, C.G(s.game || 'poe2').base)).map((x) => { if (x.item) C.rememberListing(x.item); return C.scoreListing(x); });
    const pob = v.mode === 'pob';
    if (pob) { if (!C.pobOn()) return null; await C.pobListings(list); }
    const gainOf = (x) => (pob ? x.compare && x.compare.pob && x.compare.pob.score : x.compare && x.compare.scoreMode === 'gear' ? x.compare.delta : null);
    // the most you'd pay, in the base currency (chaos / ex); older alerts were in divines
    const maxEx = v.unit === 'chaos' ? v.max : div ? (v.max != null ? v.max : v.maxDiv) * div : null;
    return list.filter((x) => x.compare && x.priceEx > 0 && !['resloss', 'dmgloss', 'downgrade'].includes(x.compare.verdict) && gainOf(x) >= v.minGain && (maxEx == null || x.priceEx <= maxEx * 1.0001))
      .map((x) => ({ name: x.item.name, price: x.priceText, gain: gainOf(x), gainText: pob ? `+${Math.round(gainOf(x) * 10) / 10} pts` : `+${Math.round(gainOf(x))} gear score` }))
      .sort((a, b) => b.gain - a.gain);
  }
  ipcMain.handle('alerts:run', async () => { await runAlerts(true); return { lastRun: lastAlertRun }; });

  // ---------- search history: the last searches you ran, to run again or save ----------
  const HISTORY_MAX = 30;
  function historyList() { return C.store.data.searchHistory || (C.store.data.searchHistory = []); }
  function record(r, ctx) {
    if (!r || !r.ok || !ctx || !ctx.body || !ctx.searchKey) return;
    const game = r.game || C.tg();
    const list = historyList().filter((x) => !(x.searchKey === ctx.searchKey && x.game === game));
    list.unshift({ id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: String(ctx.title || 'Search').replace(/^Custom search: /, ''),
      mode: ctx.mode, league: r.league, game, body: ctx.body, searchKey: ctx.searchKey,
      itemClass: ctx.item && ctx.item.itemClass, itemName: ctx.item && ctx.item.name, total: r.total, at: Date.now() });
    // keep the newest HISTORY_MAX for each game
    const seen = {};
    C.store.data.searchHistory = list.filter((x) => (seen[x.game] = (seen[x.game] || 0) + 1) <= HISTORY_MAX);
    C.store.save();
    C.notifySettings('history:changed');
  }
  ipcMain.handle('history:list', () => JSON.parse(JSON.stringify(historyList().filter((x) => x.game === C.tg()).map(({ body, ...x }) => ({ ...x, saved: savedList().some((s) => s.searchKey === x.searchKey) })))));
  ipcMain.handle('history:clear', () => { C.store.data.searchHistory = historyList().filter((x) => x.game !== C.tg()); C.store.save(); return true; });
  ipcMain.handle('history:save', (_e, id) => {
    const h = historyList().find((x) => x.id === id);
    if (!h) return { ok: false };
    if (savedList().find((x) => x.searchKey === h.searchKey)) return { ok: true, already: true };
    savedList().unshift({ id: 's' + Date.now().toString(36), name: h.title, league: h.league, game: h.game, body: h.body, searchKey: h.searchKey,
      mode: h.mode, itemClass: h.itemClass, itemName: h.itemName, lastTotal: h.total, lastRun: h.at, created: Date.now(), lastIds: [], alert: false });
    C.store.save();
    C.notifySettings('saved:changed');
    return { ok: true };
  });
  ipcMain.handle('history:run', C.inGame(async (_e, id) => {
    const h = historyList().find((x) => x.id === id);
    if (!h) return { ok: false, error: 'That search is no longer in the history.' };
    if (h.game !== C.tg()) return { ok: false, error: 'That search is for the other game.' };
    await C.refreshDivineRate(false);
    const body = JSON.parse(JSON.stringify(h.body));
    const r = await C.runSearch(h.league, body, `history ${h.title}`, { game: h.game });
    if (!r.ok) return r;
    const prev = h.total;
    const item = { itemClass: h.itemClass, name: h.itemName, slot: require('../core/slots').slotForClass(h.itemClass) };
    await C.openIfAny(r, { item, mode: h.mode, title: h.title, body, searchKey: h.searchKey });
    return { ok: true, total: r.total, prev, inApp: r.inApp };
  }));

  return { savedList, runAlerts, keepNotification, record };
};
