'use strict';

// The results window: fetching listings, judging each one, and loading more.
const path = require('path');
const { BrowserWindow, screen, ipcMain, globalShortcut, net } = require('electron');
const trade = require('../core/trade');
const listingLib = require('../core/listing');
const ROOT = path.join(__dirname, '..'); // src

module.exports = function (C) {
  // ---------- listings (in-app results) ----------

  // listing fetches are paced too: a short gap between them, longer when the trade site says we're
  // close to its limit, and when it says "too many requests" we wait as long as it asks (and don't
  // try again through the page, which would only be another request)
  let fetchNextAt = 0;
  async function fetchViaApp(league, searchId, ids, game) {
    const url = trade.fetchUrl(ids, searchId, game);
    const res = await net.fetch(url, { headers: { 'User-Agent': C.UA, Accept: 'application/json' } });
    const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
    if (res.status === 429) {
      fetchNextAt = Date.now() + (ra > 0 ? ra * 1000 : 10000);
      const e = new Error(`The trade site says too many requests – wait ${Math.ceil((fetchNextAt - Date.now()) / 1000)} seconds.`); e.rateLimited = true; throw e;
    }
    try { fetchNextAt = Date.now() + (res.headers && C.nearRateLimit(res.headers) ? 2500 : 350); } catch (_) { fetchNextAt = Date.now() + 350; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(json.result)) throw new Error((json.error && json.error.message) || `HTTP ${res.status}`);
    return json.result;
  }
  async function fetchViaPage(league, searchId, ids, game) {
    if (!C.tradeWin || C.tradeWin.isDestroyed()) {
      C.tradeWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, partition: C.POE_PARTITION } });
    }
    if (!C.tradeWin.webContents.getURL().startsWith(trade.BASE)) {
      await Promise.race([C.tradeWin.loadURL(trade.pageUrl(game, league)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('page load timed out')), 15000))]);
    }
    const url = trade.fetchUrl(ids, searchId, game);
    const r = await C.withTimeout(C.tradeWin.webContents.executeJavaScript(`fetch(${JSON.stringify(url)}, { credentials: 'include', headers: { Accept: 'application/json' } }).then(async (x) => ({ status: x.status, ra: x.headers.get('retry-after'), json: await x.json().catch(() => ({})) }))`, true), 20000, 'the trade page');
    if (r && r.status === 429) {
      const ra = Number(r.ra);
      fetchNextAt = Date.now() + (ra > 0 ? ra * 1000 : 10000);
      const e = new Error(`The trade site says too many requests – wait ${Math.ceil((fetchNextAt - Date.now()) / 1000)} seconds.`); e.rateLimited = true; throw e;
    }
    fetchNextAt = Math.max(fetchNextAt, Date.now() + 350);
    if (!r || r.status !== 200 || !Array.isArray(r.json.result)) throw new Error(`HTTP ${r && r.status}`);
    return r.json.result;
  }
  // one listing fetch at a time across the whole app (a price check, "Load more", alerts and Where to
  // spend can all be fetching at once): each waits its turn and the gap after the one before
  let fetchChain = Promise.resolve();
  function fetchTurn(task) {
    const run = fetchChain.then(async () => {
      const wait = fetchNextAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 60000)));
      return task();
    });
    fetchChain = run.catch(() => {});
    return run;
  }
  let loggedSample = false;
  // opts.partial: if a later chunk fails after some were read, return what was read (out.failed = how many
  // ids were not read) instead of throwing it all away
  async function fetchListings(league, searchId, ids, game = C.tg(), opts = {}) {
    const out = [];
    let failed = 0;
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      let got = null; let lastErr = null;
      // through your signed-in page only when you've signed in (see runSearch)
      const ways = (await C.signedIn()) ? [fetchViaApp, fetchViaPage] : [fetchViaApp];
      await fetchTurn(async () => {
        for (const fn of ways) {
          try { got = await fn(league, searchId, chunk, game); break; } catch (err) { lastErr = err; C.log(`fetch via ${fn.name} failed: ${err.message || err}`); if (err.rateLimited) break; }
        }
      });
      if (!got) {
        if (opts.partial && i > 0) { failed = ids.length - i; C.log(`fetch: stopped after ${i} of ${ids.length} listings: ${(lastErr && lastErr.message) || lastErr || 'failed'}`); break; }
        throw lastErr || new Error('fetch failed');
      }
      if (!loggedSample && got[0]) { loggedSample = true; C.log('fetch sample: ' + JSON.stringify({ item: got[0].item, price: got[0].listing && got[0].listing.price }).slice(0, 1500)); } // not the seller's account or character
      out.push(...got.filter(Boolean));
    }
    Object.defineProperty(out, 'failed', { value: failed, enumerable: false, writable: true, configurable: true });
    return out;
  }

  let resultsWin = null;
  let resultsState = null; // { r, ctx, listings: [...], next }

  function createResultsWindow() {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const w = 600; const h = Math.min(860, area.height - 40);
    const saved = C.store.settings.resultsBounds;
    const onScreen = saved && screen.getAllDisplays().some((d) => {
      const a = d.workArea; return saved.x >= a.x - 50 && saved.y >= a.y - 50 && saved.x < a.x + a.width - 100 && saved.y < a.y + a.height - 100;
    });
    const b = onScreen ? saved : { width: w, height: h, x: area.x + area.width - w - 20, y: area.y + 20 };
    resultsWin = new BrowserWindow({
      width: b.width, height: b.height, x: b.x, y: b.y,
      title: 'Trade results', icon: C.ICON, autoHideMenuBar: true, backgroundColor: '#14110f', alwaysOnTop: true,
      webPreferences: { preload: C.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    resultsWin.setAlwaysOnTop(true, 'floating');
    resultsWin.loadFile(path.join(ROOT, 'ui', 'results.html'));
    resultsWin.on('closed', () => { resultsWin = null; });
    let t = null;
    const remember = () => { clearTimeout(t); t = setTimeout(() => { if (resultsWin && !resultsWin.isDestroyed()) C.store.setSetting('resultsBounds', resultsWin.getBounds()); }, 500); };
    resultsWin.on('move', remember); resultsWin.on('resize', remember);
    try { resultsWin.webContents.setZoomFactor(C.uiScale()); } catch (_) { /* ignore */ }
  }

  function scoreListing(s) {
    if (!s.item) return { ...s, compare: null };
    if (C.tg() === 'poe1' && C.isFlaskClass(s.item)) s.item.slot = 'Flask';
    const r = C.evaluate(s.item);
    const c = r && r.ok ? {
      verdict: r.verdict, delta: r.delta, pct: r.pct, targetSlot: r.targetSlot, replacing: r.replacing, scoreMode: r.scoreMode,
      rows: r.rows.slice(0, 16).map((x) => ({ key: x.key, diff: x.diff, weight: x.weight, impact: x.impact, useful: x.useful })),
      character: r.character || null, risks: r.risks || null, resRank: r.resRank || 0,
    } : null;
    const dr = (resultsState && resultsState.divineRate) || C.store.settings.divineRate;
    const value = c && s.priceEx && c.delta != null && dr > 0 ? (c.delta / Math.max(s.priceEx, 1)) * dr : null; // score per divine
    const g = C.gearOf(s.item, c && c.targetSlot);
    const ge = c && C.store.equipped[c.targetSlot] ? C.gearOf(C.store.equipped[c.targetSlot], c.targetSlot) : null;
    const slim = (x) => ({ score: x.score, grade: x.grade, missing: x.missing, unique: x.unique, ideal: x.ideal, wasted: x.wasted, resNote: x.resNote,
      contributions: (x.contributions || []).map((k) => ({ label: k.label, points: k.points, quality: k.quality, source: k.source })) });
    return { ...s, compare: c, valuePerDiv: value, gear: g ? slim(g) : null, gearEquipped: ge ? ge.score : null, gearEquippedDetail: ge ? slim(ge) : null };
  }

  async function pobListings(list) {
    const fresh = list.filter((x) => x.item && x.compare);
    if (!fresh.length || !C.pobOn()) return;
    try {
      const t0 = Date.now();
      const js = await C.pobJudge(fresh.map((x) => ({ item: x.item, slot: x.compare.targetSlot })));
      fresh.forEach((x, i) => {
        if (!js[i]) return;
        C.applyPob(x.compare, js[i]);
        const dr = (resultsState && resultsState.divineRate) || C.store.settings.divineRate;
        x.valuePerDiv = x.priceEx && js[i].score > 0 && dr > 0 ? (js[i].score / Math.max(x.priceEx, 1)) * dr : null;
      });
      C.log(`pob: judged ${js.filter(Boolean).length} of ${fresh.length} listings in ${Date.now() - t0} ms`);
    } catch (err) { C.log('pob: listings: ' + err.message); }
  }

  function resultsPayload() {
    const { r, ctx, listings } = resultsState;
    return JSON.parse(JSON.stringify({
      title: ctx.title || 'Trade results', mode: ctx.mode, league: r.league, total: r.total, url: r.url,
      itemName: ctx.item && ctx.item.name, itemClass: ctx.item && ctx.item.itemClass,
      note: ctx.note || null, priceSummary: ctx.priceSummary || null, focusId: ctx.focusId || null,
      shown: listings.length, more: resultsState.next < r.ids.length,
      divineRate: resultsState.divineRate, chaosRate: r.game === 'poe2' ? C.chaosRate() : null, unit: C.G(r.game).baseShort, game: r.game || C.tg(), gameBeta: !!C.G(r.game).beta, gameShort: C.G(r.game).short,
      otherGame: r.game && r.game !== C.tg() ? `These are ${C.G(r.game).name} results, kept as they were. Press F2 in ${C.G(r.game).short} (or pick your ${C.G(r.game).short} character) to check them with that character again.` : null,
      listings: listings.map((x) => ({ ...x, item: x.item ? { name: x.item.name, baseType: x.item.baseType, rarity: x.item.rarity, itemLevel: x.item.itemLevel, corrupted: !!x.item.corrupted, lines: x.item.lines, id: x.item.id } : null })),
      saved: !!(C.store.data.savedSearches || []).find((x) => x.searchKey === ctx.searchKey),
      signedIn: !!resultsState.signedIn,
      resFirst: !!C.pobPriorities().resFirst,
      resultsHotkey: resultsHotkey || null,
      pobOn: C.pobOn(),
    }));
  }

  async function loadMoreListings(count, st = resultsState) {
    const ids = st.r.ids.slice(st.next, st.next + count);
    if (!ids.length) return;
    const raw = await fetchListings(st.r.league, st.r.searchId, ids, st.r.game, { partial: true });
    st.next += ids.length - (raw.failed || 0); // the ones not read are fetched again by the next "Load more"
    if (st.r.game && st.r.game !== C.store.activeGame()) throw new Error('you changed game'); // never judged against the other game's character
    const rates = st.rates;
    for (const res of raw) {
      const s = listingLib.summarise(res, st.ctx.item && st.ctx.item.itemClass, rates, C.G(st.r.game).base);
      s.pos = st.r.ids.indexOf(res.id) + 1; // where it sits on the trade site page
      if (s.item) C.rememberListing(s.item);
      st.listings.push(scoreListing(s));
    }
    // judge the new ones with Path of Building (one request for all of them)
    if (raw.length) await pobListings(st.listings.slice(-raw.length));
  }

  // Show the results window where you'll see it: a minimised one is restored (showInactive alone
  // leaves it in the taskbar, so a search looked like it did nothing). Searching from the app window
  // brings it to the front, and onto that window's monitor if it was left on one that's gone or far off;
  // searching from the popup over the game doesn't take focus away from the game.
  function bringUpResults() {
    if (!resultsWin || resultsWin.isDestroyed()) return;
    if (resultsWin.isMinimized()) resultsWin.restore();
    const fromApp = C.settingsWin && !C.settingsWin.isDestroyed() && C.settingsWin.isFocused();
    if (fromApp) {
      const rb = resultsWin.getBounds();
      const onScreen = screen.getAllDisplays().some((d) => { const a = d.workArea; return rb.x + 100 > a.x && rb.x < a.x + a.width - 100 && rb.y >= a.y - 50 && rb.y < a.y + a.height - 100; });
      if (!onScreen) {
        const a = screen.getDisplayMatching(C.settingsWin.getBounds()).workArea;
        resultsWin.setBounds({ width: rb.width, height: Math.min(rb.height, a.height - 40), x: a.x + a.width - rb.width - 20, y: a.y + 20 });
      }
      resultsWin.show(); resultsWin.moveTop(); resultsWin.focus();
    } else {
      resultsWin.showInactive(); resultsWin.moveTop();
    }
  }

  let pendingResults = null; // a search whose listings are still loading
  // true: shown; false: the listings couldn't be loaded (the caller opens the browser instead);
  // 'superseded': you changed game or searched again meanwhile, so nothing is shown and nothing opens
  async function showResults(r, ctx) {
    // the search's own game and rates: an open window keeps them when you change game
    r.game = r.game || C.tg();
    if (r.game !== C.store.activeGame()) return 'superseded'; // you changed game: these aren't for this character
    const rates = { ...(C.store.settings.currencyRates || {}), ...(C.store.settings.divineRate ? { divine: C.store.settings.divineRate } : {}) };
    // the window keeps showing (and acting on) the last search until this one's listings are in
    const st = { r, ctx, listings: [], next: 0, signedIn: await C.signedIn(), rates, divineRate: C.store.settings.divineRate || null };
    pendingResults = st;
    try {
      await loadMoreListings(ctx.mode === 'price' ? 40 : 20, st); // a price needs more than one page
    } catch (err) {
      if (r.game !== C.store.activeGame() || pendingResults !== st) return 'superseded';
      C.log('could not load listings, opening the browser instead: ' + (err.message || err));
      // an open results window still shows the last search: say this one failed, don't leave it looking current
      if (resultsWin && !resultsWin.isDestroyed()) resultsWin.webContents.send('results:data', { ...resultsPayload(), listings: [], error: `Couldn't load the listings (${err.message || err}) – opened the search in your browser instead.` });
      return false;
    }
    if (r.game !== C.store.activeGame() || pendingResults !== st) return 'superseded'; // changed game (or searched again) while it loaded
    resultsState = st; pendingResults = null;
    if (!resultsWin || resultsWin.isDestroyed()) createResultsWindow();
    const send = () => resultsWin.webContents.send('results:data', resultsPayload());
    if (resultsWin.webContents.isLoading()) resultsWin.webContents.once('did-finish-load', send); else send();
    bringUpResults();
    C.buildTrayMenu();
    return true;
  }

  const resultsOtherGame = () => !!(resultsState && resultsState.r.game && resultsState.r.game !== C.tg());
  ipcMain.handle('results:more', async () => {
    if (!resultsState) return null;
    if (resultsOtherGame()) return { ...resultsPayload(), error: `Switch back to ${C.G(resultsState.r.game).short} to load more of these.` };
    try { await loadMoreListings(10); } catch (err) { return { error: err.message || String(err) }; }
    if (resultsState.ctx.mode === 'price') resultsState.ctx.priceSummary = C.priceSummary(resultsState.listings, resultsState.ctx.priceLeague, resultsState.ctx.priceLevel || 0, resultsState.ctx.priceCompare || null);
    return resultsPayload();
  });
  ipcMain.handle('results:rescore', async () => {
    if (!resultsState) return null;
    if (resultsOtherGame()) return resultsPayload(); // never judged against the other game's character
    resultsState.listings = resultsState.listings.map((x) => scoreListing(x));
    await pobListings(resultsState.listings);
    return resultsPayload();
  });
  ipcMain.on('results:hide', () => { if (resultsWin && !resultsWin.isDestroyed()) resultsWin.hide(); });
  function toggleResults() {
    if (resultsWin && !resultsWin.isDestroyed()) {
      if (resultsWin.isVisible() && !resultsWin.isMinimized()) resultsWin.hide(); else bringUpResults();
    } else if (resultsState) {
      createResultsWindow();
      resultsWin.webContents.once('did-finish-load', () => resultsWin.webContents.send('results:data', resultsPayload()));
      resultsWin.showInactive();
    }
  }
  let resultsHotkey = null;
  function registerResultsHotkey() {
    const want = C.store.settings.resultsHotkey || 'Ctrl+Shift+D';
    if (C.sameKey(want, C.hotkeyStatus.accelerator || C.store.settings.hotkey || C.DEFAULT_HOTKEY)) { C.log(`results hotkey ${want}: same as the copy hotkey, not registered`); if (resultsHotkey) { try { globalShortcut.unregister(resultsHotkey); } catch (_) { /* ignore */ } } resultsHotkey = null; return; }
    if (resultsHotkey) { try { globalShortcut.unregister(resultsHotkey); } catch (_) { /* ignore */ } resultsHotkey = null; }
    try { if (globalShortcut.register(want, toggleResults)) resultsHotkey = want; } catch (_) { /* ignore */ }
    C.log(`results hotkey ${want}: ${resultsHotkey ? 'registered' : 'FAILED'}`);
  }
  ipcMain.on('clipboard:write', (_e, text) => {
    if (typeof text !== 'string' || !text) return;
    C.lastClip = text; C.clipWrite(text);
  });

  return {
    fetchViaPage,
    fetchListings,
    get resultsWin() { return resultsWin; },
    get resultsState() { return resultsState; },
    scoreListing,
    pobListings,
    resultsPayload,
    showResults,
    toggleResults,
    get resultsHotkey() { return resultsHotkey; },
    registerResultsHotkey,
  };
};
