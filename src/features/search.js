'use strict';

// The trade site: its data (stats, items, leagues), searching it within its rate limits, and opening
// the results.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const trade = require('../core/trade');
const ninjaLib = require('../core/ninja');

module.exports = function (C) {
  // ---------- trade search ----------

  // an identifiable User-Agent, as GGG and poe.ninja ask of tools
  const UA = `PoE-Upgrade-Checker/${app.getVersion()} (contact: support@poe2upgrade.com)`;
  // pathofexile.com pages the app opens (search fallback, sign-in) share this
  // cookie store, so if you sign in, searches and "Travel to hideout" use it.
  const POE_PARTITION = 'persist:poe';

  async function getJson(url) {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
    return res.json();
  }

  const tradeDataBy = {};
  // one load per game at a time: at start-up the warm-up, the settings window and an early F2 can all
  // ask before the first has finished (each would parse the multi-MB cache, or download it all again)
  const tradeLoads = {};
  function loadTradeData(force) {
    const key = C.tg() + (force ? ':force' : '');
    if (tradeLoads[key]) return tradeLoads[key];
    const p = loadTradeDataNow(force).finally(() => { if (tradeLoads[key] === p) delete tradeLoads[key]; });
    tradeLoads[key] = p;
    return p;
  }
  async function loadTradeDataNow(force) {
    const game = C.tg();
    let tradeData = tradeDataBy[game];
    const cacheFile = path.join(app.getPath('userData'), game === 'poe2' ? 'trade-cache.json' : `trade-cache-${game}.json`);
    const DAY = 24 * 3600 * 1000;
    if (!force && !tradeData) {
      try { tradeData = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) { tradeData = null; }
    }
    // leagues change at a league start: check them every hour, not once a day with the stats
    if (!force && tradeData && tradeData.stats && Date.now() - tradeData.fetchedAt <= DAY && Date.now() - (tradeData.leaguesAt || tradeData.fetchedAt) > 3600 * 1000) {
      try {
        const leagues = await getJson(trade.apiUrl(game, 'data/leagues'));
        if (leagues && Array.isArray(leagues.result) && leagues.result.length) { tradeData.leagues = leagues; tradeData.leaguesAt = Date.now(); try { fs.writeFileSync(cacheFile, JSON.stringify({ ...tradeData, index: undefined, indexOf: undefined })); } catch (_) { /* ignore */ } }
      } catch (_) { tradeData.leaguesAt = Date.now(); /* offline: try again in an hour */ }
    }
    if (force || !tradeData || Date.now() - tradeData.fetchedAt > DAY) {
      try {
        const [stats, filters, leagues] = await Promise.all([
          getJson(trade.apiUrl(game, 'data/stats')),
          getJson(trade.apiUrl(game, 'data/filters')).catch(() => null),
          getJson(trade.apiUrl(game, 'data/leagues')).catch(() => null),
        ]);
        tradeData = { stats, filters, leagues, fetchedAt: Date.now() };
        try { fs.writeFileSync(cacheFile, JSON.stringify(tradeData)); } catch (_) { /* ignore */ }
      } catch (err) {
        // Offline or the site is down: keep using an older cache if we have one.
        if (!tradeData || !tradeData.stats) throw err;
      }
    }
    if (!tradeData.index || tradeData.indexOf !== tradeData.stats) { tradeData.index = trade.buildStatIndex(tradeData.stats); tradeData.indexOf = tradeData.stats; }
    tradeDataBy[game] = tradeData;
    return tradeData;
  }

  ipcMain.handle('trade:data', async (_e, force) => {
    try {
      const d = await loadTradeData(force);
      const leagues = ((d.leagues && d.leagues.result) || [])
        .filter(leagueOfGame)
        .map((l) => l.id);
      const statTexts = Array.from(new Set(d.index.all.map((e) => e.text)));
      return { ok: true, leagues, statTexts, lastItem: C.lastItem };
    } catch (err) {
      return { ok: false, error: String(err.message || err), lastItem: C.lastItem };
    }
  });

  ipcMain.handle('find:rows', (_e, target) => {
    const item = C.resolveItem(target);
    return item ? { item: JSON.parse(JSON.stringify(item)), rows: trade.statSources(item) } : { item: null, rows: [] };
  });

  ipcMain.handle('items:recent', () => Array.from(C.recentItems.values()).filter((i) => !i.game || i.game === C.tg()).reverse().slice(0, 8)
    .map((i) => ({ id: i.id, name: i.name, itemClass: i.itemClass, copiedAt: i.copiedAt })));

  ipcMain.on('open:url', (_e, url) => {
    // build sites, for "Find a league starter" on Build & stats
    const buildSite = typeof url === 'string' && /^https:\/\/(poe\.ninja\/poe2\/builds|mobalytics\.gg\/poe-2\/tier-list)$/.test(url);
    if (trade.isTradePage(url) || ninjaLib.isInfoPage(url) || buildSite) shell.openExternal(url);
  });

  // ---------- poe.ninja prices (currency, gems, maps, divination cards, uniques...) ----------
  // ---------- map / waystone check ----------
  ipcMain.handle('trade:search', C.inGame(async (_e, req) => {
    const item = C.resolveItem(req.target || req.slot);
    if (!item) return { ok: false, error: 'No item for that slot.' };
    let d;
    try { d = await loadTradeData(false); } catch (err) {
      return { ok: false, error: 'Could not load trade site data: ' + (err.message || err) };
    }
    const armourOrWeapon = ['Weapon', 'Offhand', 'Helmet', 'Body Armour', 'Gloves', 'Boots'].includes(item.slot);
    const { body, unmatched, excluded } = trade.buildQuery(req.picks || [], {
      itemClass: item.itemClass, baseType: item.baseType, matchBase: !!req.matchBase,
      status: req.status || C.store.settings.status, statIndex: d.index, filtersData: d.filters,
      ignoreRules: C.ignoreRules(),
      preferLocal: armourOrWeapon,
    });
    if (!C.sameGame()) return C.SWITCHED();
    if (req.league && leagueOk(d, req.league)) C.setGameSetting('league', req.league);
    if (req.status) C.store.setSetting('status', req.status);
    if (req.budget !== undefined) C.setGameSetting('budget', req.budget);
    await C.refreshDivineRate(false);
    const budget = C.budgetNow(req.budget !== undefined ? req.budget : C.store.settings.budget);
    trade.applyBudget(body, budget, C.tg());
    const r = await runSearch(pickLeague(d, req.league), body, 'custom');
    if (r.ok) await openIfAny(r, { item, mode: 'custom', title: `Custom search: ${item.name}`, body, searchKey: searchKey(body) });
    return { ...r, unmatched, excluded, budget: trade.budgetLabel(budget, C.tg()), item: item.name };
  }));

  // PoE2's leagues are realm "poe2"; PoE1's (on its own trade API) "pc", or none
  function leagueOfGame(l) { const realm = C.G().trade.realm; return realm ? (!l.realm || l.realm === realm) : (!l.realm || l.realm === 'pc'); }
  const leagueIds = (d) => ((d && d.leagues && d.leagues.result) || []).filter(leagueOfGame).map((l) => l.id);
  // private leagues ("Name (PL12345)") are never in the trade site's public list
  const isPrivateLeague = (l) => /\(PL\d+\)\s*$/.test(String(l || ''));
  // a league that belongs to this game (or we can't tell): the other game's never is
  function leagueOk(d, l) { const ids = leagueIds(d); return !!l && (!ids.length || ids.includes(l) || isPrivateLeague(l)); }
  function pickLeague(d, wanted) {
    const ids = leagueIds(d);
    if (wanted && leagueOk(d, wanted)) return wanted;
    if (C.store.settings.league && leagueOk(d, C.store.settings.league)) return C.store.settings.league;
    // Usually the current challenge league comes first; skip hardcore/standard if possible.
    return ids.find((id) => !/hardcore|standard|ssf|solo/i.test(id)) || ids[0] || 'Standard';
  }

  // Rate limits the trade site reports, e.g. "5:10:60,15:60:300" (hits:seconds:ban)
  // with the current state "1:10:0,1:60:0". Returns true if we're close to a limit.
  function nearRateLimit(headers) {
    try {
      const rules = String(headers.get('x-rate-limit-ip') || '').split(',').filter(Boolean);
      const state = String(headers.get('x-rate-limit-ip-state') || '').split(',').filter(Boolean);
      return rules.some((r, i) => {
        const max = Number(r.split(':')[0]); const used = Number((state[i] || '0').split(':')[0]);
        return max && used >= max - 1;
      });
    } catch (_) { return false; }
  }

  // ---------- search rate limiting ----------
  // The trade site allows only a few searches per 10 s / 60 s / 300 s (it says how many in the
  // x-rate-limit headers) and bans you for a minute when you go over. Every search waits for a
  // free slot instead, keeping one spare, and a 429 blocks searching until the site says so.
  const searchLog = [];
  let searchRules = [[5, 10], [15, 60], [30, 300]]; // safe guesses until the site tells us
  let searchBlockedUntil = 0;
  function learnLimits(get) {
    try {
      const parse = (v) => String(v || '').split(',').filter(Boolean).map((r) => r.split(':').map(Number)).filter((x) => x[0] > 0 && x[1] > 0).map((x) => [x[0], x[1]]);
      const rules = [...parse(get('x-rate-limit-ip')), ...parse(get('x-rate-limit-account'))];
      if (rules.length) searchRules = rules;
      // the site's own count ("3:10:0" = 3 searches in the last 10 s): it includes searches made
      // in your browser and before the app started, which the app's log doesn't know about, so the
      // log is topped up to match (counted from now: a little more careful than the site)
      const now = Date.now();
      for (const [ruleH, stateH] of [['x-rate-limit-ip', 'x-rate-limit-ip-state'], ['x-rate-limit-account', 'x-rate-limit-account-state']]) {
        const rs = parse(get(ruleH));
        const st = String(get(stateH) || '').split(',').filter(Boolean).map((x) => x.split(':').map(Number));
        rs.forEach(([, sec], i) => {
          const [used, , penalty] = st[i] || [];
          if (penalty > 0) searchBlockedUntil = Math.max(searchBlockedUntil, now + penalty * 1000);
          const recent = searchLog.filter((t) => now - t < sec * 1000).length;
          for (let k = recent; k < (used || 0); k++) searchLog.push(now);
        });
      }
      searchLog.sort((x, y) => x - y);
      while (searchLog.length > 200) searchLog.shift();
      const ra = Number(get('retry-after'));
      if (ra > 0) searchBlockedUntil = Math.max(searchBlockedUntil, Date.now() + ra * 1000);
    } catch (_) { /* keep the old rules */ }
  }
  function searchWait() {
    const now = Date.now();
    let wait = Math.max(0, searchBlockedUntil - now);
    for (const [hits, sec] of searchRules) {
      const recent = searchLog.filter((t) => now - t < sec * 1000);
      const room = Math.max(1, hits - 1); // keep one spare for safety
      if (recent.length >= room) wait = Math.max(wait, recent[recent.length - room] + sec * 1000 - now + 250);
    }
    return wait;
  }
  // waits for a slot (up to maxWait ms); false if it would take longer
  async function searchSlot(maxWait = 30000) {
    for (let i = 0; i < 20; i++) {
      const w = searchWait();
      if (!w) {
        searchLog.push(Date.now());
        while (searchLog.length > 200) searchLog.shift();
        return true;
      }
      if (w > maxWait) return false;
      if (w > 1500) C.log(`search: waiting ${Math.round(w / 1000)} s for the trade site rate limit`);
      await new Promise((r) => setTimeout(r, w));
    }
    return false;
  }

  async function postSearch(league, body, game) {
    const res = await net.fetch(trade.searchUrl(league, game), {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    learnLimits((h) => res.headers.get(h));
    if (res.status === 429) {
      const wait = res.headers.get('retry-after');
      const err = new Error(`The trade site says too many searches – wait ${wait || 'a minute'} seconds and try again.`);
      err.rateLimited = true; throw err;
    }
    if (!res.ok || !json.id) throw new Error((json.error && json.error.message) || `HTTP ${res.status}`);
    json._near = nearRateLimit(res.headers);
    return json;
  }

  // Same search, but sent from inside a (hidden) page on pathofexile.com, like the
  // trade site itself does. Only used when you've signed in to pathofexile.com in the app.
  let tradeWin = null;
  async function postSearchViaPage(league, body, game) {
    if (!tradeWin || tradeWin.isDestroyed()) {
      tradeWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, partition: POE_PARTITION } });
    }
    const page = trade.pageUrl(game, league);
    if (!tradeWin.webContents.getURL().startsWith(trade.BASE)) {
      await Promise.race([tradeWin.loadURL(page), new Promise((_, rej) => setTimeout(() => rej(new Error('page load timed out')), 15000))]);
    }
    const js = `fetch(${JSON.stringify(trade.searchUrl(league, game))}, { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})),
      h: Object.fromEntries(['x-rate-limit-ip', 'x-rate-limit-ip-state', 'x-rate-limit-account', 'x-rate-limit-account-state', 'retry-after'].map((k) => [k, r.headers.get(k)])) }))`;
    const r = await Promise.race([
      tradeWin.webContents.executeJavaScript(js, true),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 15000)),
    ]);
    if (r && r.h) learnLimits((k) => r.h[k]);
    if (r && r.status === 429) {
      const wait = r.h && r.h['retry-after'];
      const err = new Error(`The trade site says too many searches – wait ${wait || 'a minute'} seconds and try again.`);
      err.rateLimited = true; throw err;
    }
    if (r && r.json && r.json.id && r.h) r.json._near = nearRateLimit({ get: (k) => r.h[k] });
    if (!r || r.status !== 200 || !r.json || !r.json.id) {
      throw new Error((r && r.json && r.json.error && r.json.error.message) || `HTTP ${r && r.status}`);
    }
    return r.json;
  }

  // Runs a search and returns { ok, total, url }. Doesn't open the browser:
  // callers decide (so a search with 0 results can be loosened first).
  const statusBroken = {}; // per game: set if that trade site rejects 'available'
  // o.game: which game's trade site (default: the game you're playing; a saved search keeps its own)
  // when a search last went out (the follow-ups wait until you've stopped searching for a while)
  let lastSearchAt = 0;
  const searchIdleMs = () => Date.now() - lastSearchAt;
  async function runSearch(league, body, label, o = {}) {
    const game = o.game || C.tg();
    if (!o.background) lastSearchAt = Date.now();
    // a search for the game you just left (alerts excepted: they run for both games)
    if (!o.anyGame && game !== C.store.activeGame()) { C.log(`search ${label || ''}: stopped, you changed game`); return C.SWITCHED(); }
    trade.adaptQuery(body, game);
    if (statusBroken[game] && body.query.status && body.query.status.option === 'available') body.query.status.option = 'online';
    C.log(`search ${label || ''} ${C.G(game).short} league=${league} body=${JSON.stringify(body)}`);
    const errors = []; let complex = 0;
    // signed in, the trade site allows bigger searches: send it from your signed-in page first. Not signed
    // in, only the app's own request: when the trade site refuses it, that's its answer (we don't retry the
    // same request through a hidden page to get around it)
    const order = (await C.signedIn()) ? [['page', postSearchViaPage], ['app', postSearch]] : [['app', postSearch]];
    for (const [name, fn] of order) {
      if (!(await searchSlot(o.maxWait == null ? 30000 : o.maxWait))) {
        const w = Math.ceil(searchWait() / 1000);
        return { ok: false, league, rateLimited: true, error: `The trade site allows only a few searches a minute – try again in ${w} seconds.` };
      }
      try {
        const json = await fn(league, body, game);
        C.log(`search via ${name}: id=${json.id} total=${json.total}`);
        if (!o.background && C.usage) C.usage.count('searches');
        return {
          ok: true, league, game, total: json.total, url: trade.resultsUrl(league, json.id, game), near: !!json._near,
          searchId: json.id, ids: Array.isArray(json.result) ? json.result.slice(0, 100) : [], body,
        };
      } catch (err) {
        const msg = err.message || String(err);
        C.log(`search via ${name} failed: ${msg}`);
        if (err.rateLimited) return { ok: false, league, error: msg, rateLimited: true };
        if (/status/i.test(msg) && body.query.status && body.query.status.option !== 'online') {
          statusBroken[game] = true;
          C.log('trade site rejected the listing status; retrying with "online"');
          return runSearch(league, { ...body, query: { ...body.query, status: { option: 'online' } } }, label, o);
        }
        errors.push(`${name}: ${msg}`);
        // the other route would get the same answer and cost another search
        if (/too complex/i.test(msg)) { complex++; break; }
        if (/rate limit/i.test(msg)) { searchBlockedUntil = Math.max(searchBlockedUntil, Date.now() + 60000); return { ok: false, league, error: msg, rateLimited: true }; }
      }
    }
    if (!o.background && C.usage) C.usage.problem('trade');
    // the browser link would fail the same way: let the caller make the search smaller
    if (complex) return { ok: false, league, tooComplex: true, error: 'The trade site says this search has too many filters.' };
    // Last resort: a pre-filled search link (we can't know how many results).
    return { ok: true, league, game, total: null, url: trade.prefilledUrl(league, body, game), fallback: errors.join('; ') };
  }

  // Show the results: in the app's results window (default) or the browser.
  // ctx: { item, mode, title } - the item searched for (its class is needed to
  // read the listings, and listings are scored against your equipped gear).
  async function deliver(r, ctx) {
    if (!r.url || (r.total != null && r.total <= 0)) return r;
    if (r.game && r.game !== C.store.activeGame()) return C.SWITCHED(); // finished after you changed game
    // the trade site didn't answer: offer the pre-filled link, never open a browser over the game by itself
    if (r.fallback) return r;
    try { C.savedFeature.record(r, ctx); } catch (err) { C.log('history: ' + err.message); }
    const inApp = r.searchId && r.ids && r.ids.length;
    if (inApp) {
      const shown = await C.showResults(r, ctx || {});
      if (shown === true) { r.inApp = true; r.opened = true; return r; }
      if (shown === 'superseded') return r; // a newer search (or the other game) took its place
    }
    await shell.openExternal(r.url); r.opened = true;
    return r;
  }
  async function openIfAny(r, ctx) { return deliver(r, ctx); }
  function searchKey(body) {
    return require('crypto').createHash('sha1').update(JSON.stringify(body.query)).digest('hex').slice(0, 16);
  }

  return {
    searchIdleMs,
    UA,
    POE_PARTITION,
    getJson,
    tradeDataBy,
    loadTradeData,
    leagueOk,
    pickLeague,
    nearRateLimit,
    searchLog,
    searchWait,
    get tradeWin() { return tradeWin; }, set tradeWin(v) { tradeWin = v; },
    runSearch,
    openIfAny,
    searchKey,
  };
};
