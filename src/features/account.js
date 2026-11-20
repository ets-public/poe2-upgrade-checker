'use strict';

// Your pathofexile.com account (optional): signing in, opening a listing, travelling to a hideout.
const { BrowserWindow, ipcMain, shell } = require('electron');
const trade = require('../core/trade');

module.exports = function (C) {
  // ---------- saved searches ----------

  // ---------- saved-search alerts ----------
  const { session } = require('electron');
  // ---------- pathofexile.com account (optional) ----------
  // pathofexile.com gives every visitor a POESESSID cookie, signed in or not, so the cookie alone
  // proves nothing (that made the sign-in window close at once). Ask the site itself: the account
  // page answers normally when you're signed in and redirects to /login when you're not.
  // (backup check: a signed-in page has a log-out link)
  const CHECK_JS = `(async () => {
  try {
    const r = await fetch('/my-account', { redirect: 'manual', credentials: 'include' });
    if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) return { type: 'opaqueredirect', status: r.status };
    if (r.status === 200 && !/\\/login/.test(r.url)) return { type: r.type, status: 200, url: r.url };
    const h = await fetch('/', { credentials: 'include' }).then((x) => x.text());
    return /href="[^"]*\\/logout/i.test(h) ? { type: 'basic', status: 200, url: '/' } : { type: 'none', status: r.status };
  } catch (e) { return { error: String(e) }; }
})()`;
  async function checkIn(wc) {
    try {
      const r = await Promise.race([wc.executeJavaScript(CHECK_JS, true), new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 10000))]);
      return !!r && !r.error && r.type !== 'opaqueredirect' && r.status === 200 && !/\/login/.test(r.url || '');
    } catch (_) { return false; }
  }
  let signedCache = { at: 0, v: false };
  async function signedIn(force) {
    try {
      const c = await session.fromPartition(C.POE_PARTITION).cookies.get({ url: trade.BASE, name: 'POESESSID' });
      if (!c.length) { signedCache = { at: Date.now(), v: false }; return false; }
    } catch (_) { return false; }
    if (!force && Date.now() - signedCache.at < 10 * 60000) return signedCache.v;
    try {
      signedCache = { at: Date.now(), v: await checkIn(await C.tradePage(`${trade.BASE}/${C.G().trade.page}`)) };
    } catch (err) { C.log('sign-in check: ' + (err.message || err)); signedCache = { at: Date.now(), v: false }; }
    return signedCache.v;
  }
  ipcMain.handle('account:status', async () => ({ signedIn: await signedIn(true) }));
  ipcMain.handle('account:signin', async () => {
    const w = new BrowserWindow({ width: 980, height: 820, title: 'Sign in to pathofexile.com', icon: C.ICON, autoHideMenuBar: true, webPreferences: { partition: C.POE_PARTITION, sandbox: true, contextIsolation: true } });
    w.loadURL(`${trade.BASE}/login`);
    return new Promise((resolve) => {
      let busy = false; let done = false;
      const finish = async (v) => { if (done) return; done = true; clearInterval(t); signedCache = { at: Date.now(), v }; if (v) C.log('signed in to pathofexile.com'); C.notifySettings('settings:changed'); resolve({ signedIn: v }); };
      // only check once you've left the login page (after submitting it), and keep the window open until it's real
      const t = setInterval(async () => {
        if (busy || w.isDestroyed()) return;
        const url = w.webContents.getURL();
        if (!url.startsWith(trade.BASE) || /\/login/i.test(url) || w.webContents.isLoading()) return;
        busy = true;
        const ok = await checkIn(w.webContents);
        busy = false;
        if (ok) { await finish(true); if (!w.isDestroyed()) w.close(); }
      }, 1500);
      w.on('closed', async () => { if (!done) await finish(await signedIn(true)); });
    });
  });
  ipcMain.handle('account:signout', async () => {
    await session.fromPartition(C.POE_PARTITION).clearStorageData();
    signedCache = { at: Date.now(), v: false };
    C.log('signed out of pathofexile.com');
    return { signedIn: false };
  });
  // Open the trade site on this one listing: same search, narrowed to the seller's account,
  // so it's at the top of the page with the site's own Travel to Hideout / whisper buttons.
  function listingUrl(l) {
    const st = C.resultsState;
    if (!st || !st.r) return null;
    if (!l || !l.account || !st.r.body) return st.r.url;
    const body = JSON.parse(JSON.stringify(st.r.body));
    const q = body.query || (body.query = {});
    q.filters = q.filters || {};
    const tf = q.filters.trade_filters || (q.filters.trade_filters = { filters: {} });
    tf.filters = tf.filters || {};
    tf.filters.account = { input: l.account };
    return trade.prefilledUrl(st.r.league, body, st.r.game);
  }
  ipcMain.handle('trade:openListing', (_e, listingId) => {
    const l = C.resultsState && C.resultsState.listings.find((x) => x.id === listingId);
    const url = listingUrl(l);
    if (!url) return { ok: false };
    shell.openExternal(url);
    return { ok: true, exact: !!(l && l.account) };
  });
  // Instant Buyout: ask the trade site to take you to the seller's hideout (needs sign-in).
  ipcMain.handle('trade:hideout', async (_e, listingId) => {
    const l = C.resultsState && C.resultsState.listings.find((x) => x.id === listingId);
    if (!l || !l.instant) return { ok: false, error: 'This seller takes whispers, not instant buyouts: use Copy whisper.' };
    if (!(await signedIn())) return { ok: false, needSignIn: true, error: 'Sign in to pathofexile.com first – it only takes you to hideouts for a signed-in account.' };
    try {
      // the trade site only hands out the hideout token to a signed-in account: listings fetched by the app
      // don't have it, so fetch this one listing again through your signed-in trade page (as the site does)
      if (!l.hideoutToken) {
        const got = await C.fetchViaPage(C.resultsState.r.league, C.resultsState.r.searchId, [l.id], C.resultsState.r.game);
        const tok = got && got[0] && got[0].listing && got[0].listing.hideout_token;
        if (!tok) return { ok: false, error: 'The trade site didn\'t offer a hideout trip for this listing (it may be sold). Try "on trade site".' };
        l.hideoutToken = tok;
      }
      const wc = await C.tradePage(trade.pageUrl(C.resultsState.r.game, C.resultsState.r.league));
      const js = `fetch('/api/${C.G(C.resultsState.r.game).trade.api}/whisper', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: ${JSON.stringify(JSON.stringify({ token: l.hideoutToken }))} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }))`;
      const r = await C.withTimeout(wc.executeJavaScript(js, true), 20000, 'the trade site');
      C.log(`hideout travel: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      if (r.status === 200 && !(r.json && r.json.error)) return { ok: true };
      return { ok: false, error: (r.json && r.json.error && r.json.error.message) || `The trade site said ${r.status}.` };
    } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });

  return {
    signedIn,
  };
};
