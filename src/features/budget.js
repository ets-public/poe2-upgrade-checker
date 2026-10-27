'use strict';

// The divine -> exalted rate, your budget, and Find upgrades (trade:quick).
const { ipcMain } = require('electron');
const trade = require('../core/trade');
const rates = require('../core/rates');
const gearLib = require('../core/gearscore');
const { SLOT_GROUPS, WEAKEST_OF } = require('../core/slots');
const pobVerdict = require('../core/pobverdict');

module.exports = function (C) {
  // ---------- divine -> exalted rate (poe.ninja) ----------

  const HOUR = 3600 * 1000;
  const rateFetches = {}; // one poe.ninja fetch in flight per game

  // Budget with the auto rate filled in (uses the last fetched rate).
  // leveling mode (Find upgrades): only items you can wear at your level, for every upgrade search
  function levelCap() {
    const lv = C.store.settings.leveling;
    return lv && lv.on && Number(lv.level) > 0 ? Math.min(100, Math.round(Number(lv.level))) : null;
  }
  function budgetNow(b) {
    const base = b === undefined ? C.store.settings.budget : b;
    const cap = levelCap();
    const noC = C.store.settings.noCorrupted === true;
    const budget = cap || noC ? { ...(base || {}), ...(cap ? { maxLevel: cap } : {}), ...(noC ? { noCorrupted: true } : {}) } : base;
    if (!budget) return budget;
    if (budget.currency === 'divine' && C.store.settings.autoRate !== false && C.store.settings.divineRate > 0) {
      return { ...budget, divineRate: C.store.settings.divineRate };
    }
    return budget;
  }

  async function ninjaLeague() {
    // the league searches use (a chosen league that has ended, or another game's, isn't used)
    try { const d = await C.loadTradeData(false); return C.pickLeague(d); } catch (_) { /* fall through */ }
    if (C.store.settings.league) return C.store.settings.league;
    try {
      const l = await C.getJson(`https://poe.ninja/${C.G().ninja}/api/economy/leagues`);
      const first = Array.isArray(l) ? l[0] : (l && (l.economyLeagues || l.leagues || [])[0]);
      if (first) return first.name || first.id;
    } catch (_) { /* ignore */ }
    return 'Standard';
  }

  async function refreshDivineRate(force) {
    if (C.store.settings.autoRate === false) return { ok: true, auto: false, rate: C.store.settings.divineRate || null };
    let fresh = C.store.settings.divineRateAt && Date.now() - C.store.settings.divineRateAt < HOUR;
    // a rate from another league (e.g. Standard while you play the new one) is far off: fetch again
    if (fresh && C.store.settings.divineRateLeague) { try { fresh = C.store.settings.divineRateLeague === await ninjaLeague(); } catch (_) { /* keep it */ } }
    if (!force && fresh && C.store.settings.divineRate) {
      return { ok: true, auto: true, rate: C.store.settings.divineRate, at: C.store.settings.divineRateAt, league: C.store.settings.divineRateLeague };
    }
    const game = C.tg(); const base = C.G(game).base;
    if (rateFetches[game]) return rateFetches[game];
    const p = rateFetches[game] = (async () => {
      const league = await ninjaLeague();
      if (game !== C.store.activeGame()) return { ok: false, auto: true, error: 'game changed' };
      let lastErr = 'no data';
      for (const url of rates.ninjaUrls(league, game)) {
        try {
          const data = await C.getJson(url);
          const rate = rates.divineInExalts(data, base);
          const all = rates.currencyRatesInExalts(data, base);
          if (game !== C.store.activeGame()) return { ok: false, auto: true, error: 'game changed' }; // you switched game meanwhile
          // a near-empty answer (a league poe.ninja doesn't track) mustn't replace good saved rates
          if (all && Object.keys(all).length >= 3) C.store.setSetting('currencyRates', { ...all, divine: rate || all.divine });
          if (rate) {
            C.store.setSetting('divineRate', rate);
            C.store.setSetting('divineRateAt', Date.now());
            C.store.setSetting('divineRateLeague', league);
            C.log(`divine rate ${rate} ${C.G(game).baseShort} (${C.G(game).short} ${league}) from ${url}`);
            return { ok: true, auto: true, rate, at: Date.now(), league };
          }
          lastErr = `Divine/${base} price not found in poe.ninja data`;
        } catch (err) { lastErr = err.message || String(err); }
      }
      C.log('divine rate fetch failed: ' + lastErr);
      return { ok: false, auto: true, rate: C.store.settings.divineRate || null, at: C.store.settings.divineRateAt, league, error: lastErr };
    })();
    try { return await p; } finally { if (rateFetches[game] === p) delete rateFetches[game]; }
  }

  ipcMain.handle('rate:get', (_e, force) => refreshDivineRate(!!force));

  // One click searches. target: a slot, 'Ring' (your weaker ring), '__last' or
  // { itemId } (a copied item). mode 'similar' (default) = same stats or better,
  // loosened step by step until something is listed; 'weights' = beats your
  // item by your stat weights.
  ipcMain.handle('trade:quick', C.inGame(async (_e, target, mode, extra) => {
    const item = C.resolveItem(target);
    if (!item) return { ok: false, error: `Nothing saved for ${typeof target === 'string' ? target : 'that item'} yet.` };
    let d;
    try { d = await C.loadTradeData(false); } catch (err) {
      return { ok: false, error: 'Could not load trade site data: ' + (err.message || err) };
    }
    if (!C.sameGame()) return C.SWITCHED();
    if (extra && extra.league && C.leagueOk(d, extra.league)) C.setGameSetting('league', extra.league);
    if (extra && extra.status) C.store.setSetting('status', extra.status);
    const league = C.pickLeague(d, extra && extra.league);
    const armourOrWeapon = ['Weapon', 'Offhand', 'Helmet', 'Body Armour', 'Gloves', 'Boots'].includes(item.slot);
    const opts = {
      statIndex: d.index, filtersData: d.filters, preferLocal: armourOrWeapon,
      minGainPct: C.store.settings.minGainPct || 0, status: C.store.settings.status,
      ignoreRules: C.ignoreRules(), game: C.tg(),
    };
    await refreshDivineRate(false);
    const budget = budgetNow();
    const base = { item: item.name, itemClass: item.itemClass, budget: trade.budgetLabel(budget, C.tg()) };

    if (mode === 'craft') {
      if (C.tg() === 'poe1') return { ok: false, error: "Craftable bases isn't available for PoE1 yet (it uses the PoE2 gear score)." };
      const go = C.gearOpts();
      const top = gearLib.topStats(item.slot, 2, go);
      if (!top.length) return { ok: false, error: 'Pick a build (Build & stats) so the app knows which stats matter on this slot.' };
      const q = trade.buildCraftQuery(item, { ...opts, top });
      trade.applyBudget(q.body, budget, C.tg());
      const r = await C.openIfAny(await C.runSearch(league, q.body, 'craft'), {
        item, mode: 'craft', body: q.body, searchKey: C.searchKey(q.body),
        title: `Craftable ${item.itemClass || 'bases'}: ${q.keyStats.join(' + ')} + an open affix`,
        note: `Rare, not corrupted, at least one open prefix or suffix, with ${q.keyStats.join(' and ')} already on it. Cheapest first.`,
      });
      return { ...base, ...r, mode: 'craft', keyStats: q.keyStats, unmatched: q.unmatched };
    }

    // default "Find upgrades": Path of Building's weighted search when your build is loaded,
    // otherwise better for your build by gear score
    const pobSlot = (() => {
      if (item.slot === 'Jewel') return 'Jewel'; // PoB picks the socket (pobJewelSocket)
      const sl = WEAKEST_OF.includes(item.slot) ? (C.resolveSlotOf(item) || (SLOT_GROUPS[item.slot] || [])[0]) : item.slot; return pobVerdict.SLOT_TO_POB[sl] ? sl : null;
    })();
    if (mode === 'upgrade' && C.pobOn() && pobSlot) mode = 'pob';
    if (mode === 'upgrade') mode = !C.gearScoreOn() || /unique/i.test(item.rarity || '') ? 'similar' : 'gear';
    if (mode === 'pob') {
      try {
        const r = await C.pobSearch(item, pobSlot, league, budget, opts);
        if (r) return { ...base, ...r };
      } catch (err) { C.log('pob search: ' + (err.stack || err)); }
      mode = !C.gearScoreOn() || /unique/i.test(item.rarity || '') ? 'similar' : 'gear'; // fall back
    }
    if (mode === 'gear') {
      const go = C.gearOpts();
      const slot = WEAKEST_OF.includes(item.slot) ? (C.resolveSlotOf(item) || SLOT_GROUPS[item.slot][0]) : item.slot;
      const weights = gearLib.searchWeights(item.slot, { ...go, resNeed: C.resNeedFor(slot) });
      if (!weights.length) return { ok: false, error: 'Your build has no weighted stats for this slot.' };
      const g = C.gearOf(item, slot);
      let r = null; let q = null; let level = 0;
      const LEVELS = [{ share: 1.06, baseShare: 0.9, label: 'clearly better than yours' }, { share: 1, baseShare: 0.85, label: 'a little better than yours' }, { share: 0.9, baseShare: 0.75, label: 'within 10% of yours' }];
      // if the trade site says "too complex", shrink the search step by step (logged out it
      // allows only a handful of filters); the results are still scored by your gear score
      const SIZES = trade.GEAR_SEARCH_SIZES;
      // start at the size the trade site accepted last time, so we don't spend searches on ones it rejects
      const sizeKey = (await C.signedIn()) ? 'signed' : 'anon';
      const learnedSize = (C.store.settings.gearSearchSize || {})[sizeKey] || 0;
      let size = Math.min(learnedSize, SIZES.length - 1); let shrunk = size > 0;
      for (; level < LEVELS.length; level++) {
        for (;;) {
          q = trade.buildGearQuery(item, { ...opts, weights, ...LEVELS[level], ...SIZES[size] });
          if (!q.filters) return { ok: false, error: 'None of your build\'s stats for this slot could be matched on the trade site.' };
          trade.applyBudget(q.body, budget, C.tg());
          r = await C.runSearch(league, q.body, `gear L${level}${size ? ` size${size}` : ''}`);
          if (!(r && r.tooComplex) || size >= SIZES.length - 1) break;
          size++; shrunk = true;
          C.setGameSetting('gearSearchSize', { ...(C.store.settings.gearSearchSize || {}), [sizeKey]: Math.max(size, (C.store.settings.gearSearchSize || {})[sizeKey] || 0) });
        }
        if (r && r.tooComplex) return { ok: false, error: `The trade site says this search has too many filters even at its smallest.${(await C.signedIn()) ? '' : ' Signing in to pathofexile.com (Settings → Trade site account) raises the limit.'}` };
        if (!r.ok || r.total == null || r.total > 0) break;
        if (q.countOnly) break; // the simplest form doesn't get looser
        if (r.near) break;
        await new Promise((res) => setTimeout(res, 700));
      }
      if (level >= LEVELS.length) level = LEVELS.length - 1;
      if (r && r.ok) {
        await C.openIfAny(r, {
          item, mode: 'gear', body: q.body, searchKey: C.searchKey(q.body),
          title: `Better for your build than ${item.name}${g && g.score != null ? ` (gear score ${g.score})` : ''}`,
          note: q.countOnly ? `The trade site only allowed a simple search${(await C.signedIn()) ? '' : ' (sign in under Settings for better ones)'}: items with ${q.body.query.stats[0].value.min}+ of ${q.keyStats.join(', ')} at a good roll, cheapest first. Use Upgrades only / Best gear score to see which beat yours.`
            : shrunk && level === 0 ? `Scored with your build's main weights (the trade site limits filters${(await C.signedIn()) ? '' : ' – signing in under Settings allows more'}). Best for your build first.`
            : level === 1 ? 'No clear upgrade is listed right now, so these are the ones a little better than yours.'
            : level > 1 ? `Nothing beats it yet, so these come close (${LEVELS[level].label}). Sorted cheapest first; sort by Best gear score to compare.`
            : `Scored with your build's weights (${q.parts.slice(0, 5).join(', ')}${q.parts.length > 5 ? '…' : ''})${q.needCore ? `, with at least ${q.needCore} of: ${q.keyStats.join(', ')}` : ''}. Best for your build first.`,
        });
      }
      return { ...base, ...r, mode: 'gear', level, levelLabel: LEVELS[level].label, score: g && g.score, filters: q.filters, excluded: q.excluded };
    }

    if (mode === 'weights') {
      const q = trade.buildUpgradeQuery(item, C.store.weights, opts);
      if (!(q.currentScore > 0)) {
        return { ok: false, error: `None of your stat weights are on this ${item.itemClass ? item.itemClass.toLowerCase().replace(/s$/, '') : 'item'}, so "By my weights" would match almost anything. Use Find upgrades, or set weights for its stats (Build & stats).` };
      }
      if (!q.body.query.stats.length && !q.body.query.filters.equipment_filters) {
        return { ok: false, error: 'None of your weighted stats could be matched on the trade site. Set weights for your build\'s stats first.' };
      }
      trade.applyBudget(q.body, budget, C.tg());
      const r = await C.openIfAny(await C.runSearch(league, q.body, 'weights'),
        { item, mode: 'weights', title: `Beats your ${item.name} by your weights`, body: q.body, searchKey: C.searchKey(q.body) });
      return { ...base, ...r, mode: 'weights', unmatched: q.unmatched, beat: q.groupMin, excluded: q.excluded };
    }

    let r = null; let q = null;
    for (let level = 0; level < trade.RELAX.length; level++) {
      q = trade.buildSimilarQuery(item, { ...opts, level });
      if (!q.body.query.stats.length && !q.body.query.filters.equipment_filters && !q.body.query.name) {
        return { ok: false, error: 'None of this item\'s stats could be matched on the trade site.' };
      }
      trade.applyBudget(q.body, budget, C.tg());
      r = await C.runSearch(league, q.body, `similar L${level}`);
      if (!r.ok || r.total == null || r.total > 0) break;
      if (r.near) { C.log('close to the trade site rate limit, not loosening further'); break; }
      await new Promise((res) => setTimeout(res, 700)); // go easy on the trade site
    }
    if (r && r.ok) {
      await C.openIfAny(r, {
        item, mode: 'similar', body: q.body, searchKey: C.searchKey(q.body),
        title: `Same stats or better than ${item.name}`,
        note: q.level > 0 ? `Nothing matched your exact values, so this shows ${q.levelLabel} (${q.need} of ${q.total} stats).` : null,
      });
    }
    return {
      ...base, ...r, mode: 'similar', need: q.need, of: q.total, level: q.level, levels: q.levels,
      levelLabel: q.levelLabel, unique: q.unique, unmatched: q.unmatched, skipped: q.skipped,
      ignored: q.ignored, excluded: q.excluded,
    };
  }));

  return {
    HOUR,
    budgetNow,
    ninjaLeague,
    refreshDivineRate,
  };
};
