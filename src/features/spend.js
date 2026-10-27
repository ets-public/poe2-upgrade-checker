'use strict';

// Where to spend: every slot searched in your price range and checked with your build, ranked
// per divine; pairs of listings that cap your resistances together.
// Moved out of main.js: it reaches the app's shared state and helpers through C (see main.js).
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

module.exports = function (C) {
  // For every slot: Path of Building's weighted search within your budget, the first listings
  // checked with your build, and the best one's gain per divine. Then, if resistances are short,
  // pairs of items that cap them together. One run takes a few minutes (the trade site allows only a
  // few searches a minute); the last run per game is kept.
  const SPEND_SLOTS = ['Weapon', 'Offhand', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring', 'Belt'];
  const spendRuns = {}; // character -> { at, rows, pairs, ... } (each character's own build and gear)
  const prevRuns = {}; // character -> the run before that (for "cheaper than last time")
  const runKey = () => C.store.data.activeProfile || C.tg();
  // each character's last two runs are kept on disk for a week, so they're still there after a
  // restart (with enough of each slot's search to show its listings or set an alert again)
  const KEEP = 7 * 24 * 3600 * 1000;
  const runsFile = () => path.join(app.getPath('userData'), 'spend-runs.json');
  let loaded = false;
  function loadRuns() {
    if (loaded) return; loaded = true;
    try {
      const all = JSON.parse(fs.readFileSync(runsFile(), 'utf8'));
      for (const [k, v] of Object.entries(all || {})) {
        if (!v || !v.run || !(Date.now() - v.run.at < KEEP) || !Array.isArray(v.run.rows)) continue;
        spendRuns[k] = v.run;
        if (v.prev && Date.now() - v.prev.at < KEEP) prevRuns[k] = v.prev;
      }
    } catch (_) { /* none yet */ }
  }
  // a slot's search, without the listings: enough to search again or set an alert
  const keepSearch = (sr) => {
    if (!sr || !sr.r) return null;
    const { r, ctx } = sr;
    return { r: { ok: true, total: r.total, url: r.url, league: r.league, game: r.game, searchId: r.searchId, ids: (r.ids || []).slice(0, 100), body: r.body }, ctx: ctx ? { mode: ctx.mode, title: ctx.title, note: ctx.note, body: ctx.body, searchKey: ctx.searchKey, item: ctx.item ? { name: ctx.item.name, itemClass: ctx.item.itemClass, slot: ctx.item.slot, baseType: ctx.item.baseType, rarity: ctx.item.rarity } : null } : null };
  };
  function saveRuns() {
    try {
      const out = {};
      for (const k of Object.keys(spendRuns)) {
        const run = spendRuns[k];
        out[k] = { run: { ...run, rows: run.rows.map((x) => ({ ...x, search: keepSearch(x.search) })) }, prev: prevRuns[k] ? slimRun(prevRuns[k]) : null };
      }
      const tmp = runsFile() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, runsFile());
    } catch (err) { C.log('spend: could not save the last run: ' + err.message); }
  }
  const slimRun = (run) => ({ ...run, rows: run.rows.map(({ search, ...x }) => x) });
  // for the page: the run, the slots whose gear you've changed since, and each slot's best last time
  function forPage(run) {
    if (!run) return null;
    const key = runKey();
    const prev = prevRuns[key];
    const prevBest = {};
    if (prev) for (const x of prev.rows || []) if (x.best) prevBest[x.slot] = { perDiv: x.best.perDiv, gain: x.best.gain, price: x.best.price, priceDiv: x.best.priceDiv };
    const changed = run.rows.filter((x) => { const it = C.resolveItem(x.slot); return (it ? it.name : null) !== (x.current || null); }).map((x) => x.slot);
    return JSON.parse(JSON.stringify({ ...slimRun(run), prevBest, prevAt: prev ? prev.at : null, changed }));
  }
  let spendBusy = null;
  const spendProgress = (p) => C.notifySettings('spend:progress', p);
  function shortResists() {
    const st = ((C.pobEngine().info() || {}).stats) || {};
    const pr = C.pobPriorities();
    return ['Fire', 'Cold', 'Lightning', ...(pr.chaos && !C.pobCI() ? ['Chaos'] : [])].filter((El) => {
      const v = Number(st[`${El}Resist`]); const tot = Number(st[`${El}ResistTotal`]);
      const max = Number(st[`${El}ResistMax`]) || 75;
      return Number.isFinite(v) && v < max - 0.5 && !(tot > v + 0.5);
    });
  }
  ipcMain.handle('spend:get', () => { loadRuns(); return forPage(spendRuns[runKey()]); });
  // listingId: one listing from the table (its name was clicked): it comes first in the results window
  ipcMain.handle('spend:open', C.inGame(async (_e, slot, listingId) => {
    loadRuns();
    const run = spendRuns[runKey()];
    const row = run && run.rows.find((x) => x.slot === slot);
    if (!row || !row.search) return { ok: false, error: 'Run "Where to spend" again first.' };
    let r = row.search.r;
    // a run from earlier (or before a restart): the trade site forgets searches, so search again
    if (Date.now() - run.at > 20 * 60000 || !r.ids || !r.ids.length) {
      const body = (row.search.ctx && row.search.ctx.body) || r.body;
      if (!body) return { ok: false, error: 'Run "Where to spend" again first.' };
      const fresh = await C.runSearch(run.league, body, `spend ${slot} again`);
      if (!fresh || !fresh.ok) return { ok: false, error: (fresh && fresh.error) || 'The search failed.' };
      r = fresh; row.search = { r, ctx: row.search.ctx };
    }
    let ctx = row.search.ctx;
    if (typeof listingId === 'string' && listingId) {
      const ids = r.ids || [];
      const pick = [row.best, row.biggest, ...(row.candidates || [])].find((c) => c && c.listingId === listingId);
      const name = pick ? pick.name : 'That listing';
      if (ids.includes(listingId)) {
        r = { ...r, ids: [listingId, ...ids.filter((x) => x !== listingId)] };
        ctx = { ...ctx, note: `${name} first (the one you clicked), then the rest of the search.`, focusId: listingId };
      } else ctx = { ...ctx, note: `${name} isn't listed any more (sold or taken down): here's the same search now.` };
    }
    const shown = await C.showResults(r, ctx);
    return shown === true ? { ok: true, inApp: true } : shown ? { ok: false, error: 'Another search took its place.' } : { ok: false, error: 'Could not show the listings.' };
  }));
  // a build-value alert from a slot: "tell me when a Gloves listing is +X% for my build under Y div".
  // It's a saved search (this slot's search, priced up to Y div) whose new listings are checked with
  // your build when alerts run; only the ones that clear +X% are notified.
  ipcMain.handle('spend:alert', C.inGame((_e, slot, minGain, maxPrice) => {
    loadRuns();
    const run = spendRuns[runKey()];
    const row = run && run.rows.find((x) => x.slot === slot);
    if (!row || !row.search || !row.search.ctx || !row.search.ctx.body) return { ok: false, error: 'Run "Where to spend" again first.' };
    const g = Number(minGain); const m = Number(maxPrice);
    // PoE1 prices in chaos, PoE2 in divines
    const unit = C.G(C.tg()).id === 'poe1' ? 'chaos' : 'div';
    if (!(g > 0) || g > 1000) return { ok: false, error: run.mode === 'gear' ? 'Enter how many gear score points better it must be.' : 'Enter how many points better for your build it must be.' };
    if (!(m > 0) || m > 1000000) return { ok: false, error: `Enter the most you would pay, in ${unit === 'chaos' ? 'chaos' : 'divines'}.` };
    const body = JSON.parse(JSON.stringify(row.search.ctx.body));
    C.trade.applyBudget(body, C.budgetNow({ currency: unit === 'chaos' ? 'chaos' : 'divine', max: m }), C.tg());
    const list = C.savedList();
    const name = `${slot}: ${run.mode === 'gear' ? `+${g} gear score` : `+${g} pts`} for at most ${m} ${unit}`;
    const old = list.findIndex((x) => x.value && x.value.slot === slot && (x.game || 'poe2') === C.tg());
    if (old >= 0) list.splice(old, 1); // one alert per slot: the new one replaces it
    list.unshift({
      id: 'v' + Date.now().toString(36), name, league: run.league, game: C.tg(), body, searchKey: C.searchKey(body),
      mode: row.search.ctx.mode, itemClass: row.search.ctx.item && row.search.ctx.item.itemClass, itemName: row.search.ctx.item && row.search.ctx.item.name,
      lastTotal: row.total || 0, lastRun: Date.now(), created: Date.now(), lastIds: (row.search.r.ids || []).slice(0, 100), alert: true,
      value: { slot, pobSlot: row.pobSlot, minGain: g, max: m, unit, mode: run.mode },
    });
    if (!Number(C.store.settings.alertEvery)) C.store.settings.alertEvery = 10;
    C.store.save();
    C.notifySettings('saved:changed');
    return { ok: true, name, every: C.store.settings.alertEvery };
  }));
  // the last run is reused for 30 minutes (same league, price range and way of judging) unless you
  // ask again; each slot is shown as soon as its search is done
  const REUSE = 30 * 60000;
  const slim = (run) => JSON.parse(JSON.stringify({ ...run, rows: run.rows.map(({ search, ...x }) => x) }));
  ipcMain.handle('spend:run', C.inGame(async (_e, force) => {
    if (spendBusy) return { ok: false, error: 'Already looking – see the progress above.' };
    loadRuns();
    const last = spendRuns[runKey()];
    const want = { mode: C.pobOn() ? 'pob' : C.gearScoreOn() ? 'gear' : null, budget: C.trade.budgetLabel(C.budgetNow(), C.tg()), league: C.shownLeague() || null };
    if (!force && last && Date.now() - last.at < REUSE && last.mode === want.mode && last.budget === want.budget && (!want.league || last.league === want.league)) {
      return { ok: true, reused: true, ...forPage(last) };
    }
    // Path of Building when your build is loaded; otherwise (PoE2) the gear score
    const mode = C.pobOn() ? 'pob' : C.gearScoreOn() ? 'gear' : null;
    if (!mode) return { ok: false, error: C.tg() === 'poe1' ? 'Load your Path of Building build on My gear first: PoE1 items are judged by Path of Building.' : 'Load your Path of Building build on My gear, or pick a build for the gear score (Build & stats), first.' };
    spendBusy = true;
    const game = C.tg(); const key = runKey();
    try {
      let d;
      try { d = await C.loadTradeData(false); } catch (err) { return { ok: false, error: 'Could not load trade site data: ' + (err.message || err) }; }
      await C.refreshDivineRate(false);
      if (!C.sameGame()) return C.SWITCHED();
      const league = C.pickLeague(d);
      const budget = C.budgetNow();
      const div = C.store.settings.divineRate > 0 ? C.store.settings.divineRate : null;
      const rates = { ...(C.store.settings.currencyRates || {}), ...(div ? { divine: div } : {}) };
      if (mode === 'pob') await C.pobEngine().ensureLoaded();
      const w = C.store.equipped.Weapon; const off = C.store.equipped.Offhand;
      const slots = SPEND_SLOTS.filter((sl) => !(sl === 'Offhand' && w && w.twoHanded && !(off && /quiver/i.test(off.itemClass || ''))));
      // jewels: when your tree has jewel sockets, Path of Building's jewel search (each listing is tried
      // in every socket). Empty sockets first: a jewel there is pure gain.
      const sockets = mode === 'pob' ? ((C.pobEngine().info() || {}).sockets || []).filter((x) => !x.cluster) : [];
      if (sockets.length) slots.push('Jewel');
      const rows = [];
      let stopped = null;
      // each slot to the page as soon as it's done (whichever way its turn ended)
      let sent = 0;
      const sendRows = () => { while (sent < rows.length) { const { search, ...shown } = rows[sent++]; spendProgress({ row: JSON.parse(JSON.stringify(shown)), mode, total: slots.length }); } };
      for (let i = 0; i < slots.length; i++) {
        sendRows();
        const target = slots[i];
        spendProgress({ slot: target, done: i, total: slots.length });
        const item = C.resolveItem(target);
        const pobSlot = target === 'Ring' ? (item && C.resolveSlotOf(item)) || 'Ring 1' : target;
        if (!C.pobVerdict.SLOT_TO_POB[pobSlot] && target !== 'Jewel') continue;
        const row = { slot: target, pobSlot, current: item ? item.name : null };
        if (target === 'Jewel') {
          const empty = sockets.filter((x) => !x.jewel).length;
          row.current = empty ? `${empty} empty socket${empty === 1 ? '' : 's'} of ${sockets.length}` : `weakest: ${item ? item.name : 'one of yours'}`;
          row.emptySockets = empty;
        }
        rows.push(row);
        if (mode === 'gear' && !item) { row.error = 'Nothing saved for this slot: copy what you wear (F2) so it has something to beat.'; continue; }
        try {
          const opts = { statIndex: d.index, filtersData: d.filters, preferLocal: !['Amulet', 'Ring', 'Belt'].includes(target), status: C.store.settings.status, ignoreRules: C.ignoreRules(), game, noOpen: true };
          const sr = mode === 'pob' ? await C.pobSearch(item || { slot: target, itemClass: target === 'Jewel' ? 'Jewels' : null }, pobSlot, league, budget, opts) : await spendGearSearch(item, pobSlot, league, budget, opts);
          if (!sr) { row.soft = true; row.error = mode === 'pob' ? 'No stat in this slot changes your build in Path of Building (check your main skill is set there, then import again).' : 'Your build profile has no stats to search for in this slot.'; continue; }
          if (!sr.ok) { row.error = sr.error || 'The search failed.'; if (sr && (sr.rateLimited || sr.switched)) { stopped = sr.error; break; } continue; }
          const r = sr.r;
          row.total = r.total || 0; row.url = r.url;
          row.search = { r, ctx: sr.ctx }; row.searched = true; // also for "Alert me" when nothing is listed yet
          if (!r.ids || !r.ids.length) { row.none = true; continue; }
          const raw = await C.fetchListings(league, r.searchId, r.ids.slice(0, 10), game);
          const list = raw.map((x) => C.listingLib.summarise(x, item && item.itemClass, rates, C.G(game).base)).map((x) => { if (x.item) C.rememberListing(x.item); return C.scoreListing(x); });
          if (mode === 'pob') await C.pobListings(list);
          // the gain: Path of Building's % for your build, or gear score points
          const gainOf = (x) => (mode === 'pob' ? x.compare.pob && x.compare.pob.score : x.compare.scoreMode === 'gear' ? x.compare.delta : null);
          // only listings for this slot (a search can turn up other item kinds)
          const forSlot = (x) => (target === 'Ring' ? /^Ring/.test(x.compare.targetSlot || '') : target === 'Jewel' ? (x.item && x.item.slot === 'Jewel') : x.compare.targetSlot === target);
          const good = list.filter((x) => x.compare && forSlot(x) && x.priceEx > 0 && !['resloss', 'dmgloss', 'downgrade'].includes(x.compare.verdict) && gainOf(x) > 0);
          const priceDiv = (x) => (div ? x.priceEx / div : null);
          const cand = good.map((x) => ({
            name: x.item.name, base: x.item.baseType, price: x.priceText, priceEx: x.priceEx, priceDiv: priceDiv(x),
            gain: gainOf(x), verdict: x.compare.verdict, risks: (mode === 'pob' ? x.compare.pob.breaks : x.compare.risks) || [], resGain: mode === 'pob' ? x.compare.pob.resGain || 0 : 0,
            perDiv: div ? gainOf(x) / Math.max(priceDiv(x), 0.05) : null, listingId: x.id, text: x.item.raw || x.item.listingText || null, itemSlot: x.compare.targetSlot,
            socket: target === 'Jewel' && x.compare.pob && x.compare.pob.socket ? { label: x.compare.pob.socket.label, replacing: x.compare.pob.socket.replacing || null } : null,
          }));
          cand.sort((a, b) => (b.perDiv || 0) - (a.perDiv || 0) || b.gain - a.gain);
          row.best = cand[0] || null;
          row.biggest = cand.slice().sort((a, b) => b.gain - a.gain)[0] || null;
          row.candidates = cand.slice(0, 6);
          if (!row.best) row.noneBetter = true;
        } catch (err) { row.error = err.message || String(err); C.log('spend: ' + target + ': ' + row.error); }
        if (!C.sameGame()) { stopped = C.SWITCHED().error; break; }
      }
      sendRows();
      spendProgress({ slot: null, done: slots.length, total: slots.length, pairs: true });
      // resistances short: two items that cap them together
      const short = shortResists();
      let pairs = [];
      if (mode === 'pob' && short.length && !stopped) {
        try { pairs = await resistPairs(rows, short); } catch (err) { C.log('spend pairs: ' + err.message); }
      }
      rows.sort((a, b) => ((b.best && b.best.perDiv) || -1) - ((a.best && a.best.perDiv) || -1));
      const run = { at: Date.now(), mode, league, budget: C.trade.budgetLabel(budget, game), unit: C.G(game).baseShort, divineRate: div, rows, pairs, short: mode === 'pob' ? short : [], stopped };
      if (spendRuns[key] && !spendRuns[key].partial) prevRuns[key] = slimRun(spendRuns[key]);
      spendRuns[key] = run;
      saveRuns();
      spendProgress({ done: slots.length, total: slots.length, finished: true });
      C.log(`spend: ${rows.filter((x) => x.best).length} of ${rows.length} slots have an upgrade; ${pairs.length} resistance pairs`);
      return { ok: true, ...forPage(run) };
    } finally { spendBusy = null; }
  }));
  // without Path of Building (PoE2): the gear-score search of Find upgrades, one search per slot
  async function spendGearSearch(item, slot, league, budget, opts) {
    const go = C.gearOpts();
    const weights = C.gearLib.searchWeights(item.slot, { ...go, resNeed: C.resNeedFor(slot) });
    if (!weights.length) return null;
    const sizeKey = (await C.signedIn()) ? 'signed' : 'anon';
    const SIZES = C.trade.GEAR_SEARCH_SIZES;
    let size = Math.min((C.store.settings.gearSearchSize || {})[sizeKey] || 0, SIZES.length - 1);
    for (;;) {
      const q = C.trade.buildGearQuery(item, { ...opts, weights, share: 1.06, baseShare: 0.9, ...SIZES[size] });
      if (!q.filters) return null;
      C.trade.applyBudget(q.body, budget, C.tg());
      const r = await C.runSearch(league, q.body, `spend gear ${slot}${size ? ` size${size}` : ''}`);
      if (!(r && r.tooComplex) || size >= SIZES.length - 1) {
        if (!r || !r.ok) return r;
        return { ok: true, r, body: q.body, ctx: { item, mode: 'gear', body: q.body, searchKey: C.searchKey(q.body), title: `Better for your build than ${item.name}`, note: 'Listings your gear score rates above what you wear, best for your build first.' } };
      }
      size++;
    }
  }

  // pairs of listings from two slots that together cap the resistances you're short of
  async function resistPairs(rows, short) {
    const per = rows.filter((x) => x.slot !== 'Jewel' && x.candidates && x.candidates.length).map((x) => ({ row: x, list: x.candidates.filter((c) => c.text && c.resGain > 0).sort((a, b) => b.resGain - a.resGain).slice(0, 2) })).filter((x) => x.list.length);
    if (per.length < 2) return [];
    const pobSlotOf = (row, c) => C.pobVerdict.SLOT_TO_POB[row.pobSlot] || C.pobVerdict.SLOT_TO_POB[c.itemSlot];
    const req = []; const idx = [];
    for (let i = 0; i < per.length; i++) for (const a of per[i].list) {
      const bs = []; const bi = [];
      for (let j = i + 1; j < per.length; j++) for (const b of per[j].list) { bs.push({ slot: pobSlotOf(per[j].row, b), text: b.text }); bi.push([per[j].row, b]); }
      if (bs.length) { req.push({ a: { slot: pobSlotOf(per[i].row, a), text: a.text }, bs }); idx.push([per[i].row, a, bi]); }
    }
    if (!req.length) return [];
    const t0 = Date.now();
    const res = await C.pobEngine().evalPairs(req);
    const out = [];
    res.forEach((p, k) => {
      if (!p || !p.ok) return;
      const [rowA, a, bi] = idx[k];
      p.results.forEach((x, m) => {
        if (!x || !x.ok) return;
        const j = C.pobVerdict.judge(p.before, x.after, C.pobWeights());
        if (!j || j.resLoss.length || j.dmgLoss) return;
        const capped = short.filter((El) => (j.res || []).some((row) => row.el === El && row.capped));
        if (!capped.length) return;
        const [rowB, b] = bi[m];
        const priceDiv = a.priceDiv != null && b.priceDiv != null ? a.priceDiv + b.priceDiv : null;
        out.push({ a: { slot: rowA.slot, name: a.name, price: a.price, listingId: a.listingId }, b: { slot: rowB.slot, name: b.name, price: b.price, listingId: b.listingId },
          capped, all: capped.length === short.length, gain: j.score, priceDiv, perDiv: priceDiv ? j.score / Math.max(priceDiv, 0.05) : null });
      });
    });
    C.log(`spend: tried ${res.reduce((n, p) => n + ((p && p.results) || []).length, 0)} pairs in ${Date.now() - t0} ms`);
    // the ones that cap everything first, then the most capped, then the best value
    return out.sort((x, y) => (y.capped.length - x.capped.length) || ((y.perDiv || 0) - (x.perDiv || 0))).slice(0, 5);
  }
  return { spendRuns };
};
