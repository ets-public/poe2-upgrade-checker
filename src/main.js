'use strict';

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, Tray, Menu, screen, globalShortcut, nativeImage, shell,
} = require('electron');
const trade = require('./core/trade');
const ignoreLib = require('./core/ignore');
const listingLib = require('./core/listing');
const gearLib = require('./core/gearscore');
const { Store } = require('./core/store');
const { KeySender } = require('./keysender');

let store;
const lastWorth = new Map(); // item id -> typical price (ex) from "What's it worth?"
let tray;
let popup;
let settingsWin;
let lastClip = '';
let lastItem = null;
// Every copied item gets an id so buttons in the popup act on THAT item, even
// if you've copied something else (or tested an item in Settings) since.
let itemSeq = 0;
const recentItems = new Map();
function remember(item) {
  item.id = `c${Date.now().toString(36)}${(++itemSeq).toString(36)}`;
  if (!item.game && store) item.game = store.activeGame();
  item.copiedAt = Date.now();
  recentItems.set(item.id, item);
  while (recentItems.size > 30) recentItems.delete(recentItems.keys().next().value);
  lastItem = item;
  return item;
}
// trade listings get their own list, so they don't push out what you copied (or become "last item")
const listingItems = new Map();
function rememberListing(item) {
  item.id = `l${Date.now().toString(36)}${(++itemSeq).toString(36)}`;
  listingItems.set(item.id, item);
  while (listingItems.size > 200) listingItems.delete(listingItems.keys().next().value);
  return item;
}
const itemById = (id) => recentItems.get(id) || listingItems.get(id) || null;
let hideTimer = null;
let popupHovered = false;

const ICON = path.join(__dirname, '..', 'assets', 'icon.png');

// ---------- log file (Tray -> Open log) ----------
let logFile = null;
let logSize = -1; // known size of the log, so each line doesn't need to ask the disk
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (!logFile) logFile = path.join(app.getPath('userData'), 'poe2-upgrade-checker.log');
    if (logSize < 0) { try { logSize = fs.statSync(logFile).size; } catch (_) { logSize = 0; } }
    // over 1 MB: the old log is kept as .log.1 (the last one before a problem is often what's needed)
    if (logSize > 1024 * 1024) { try { fs.renameSync(logFile, logFile + '.1'); } catch (_) { fs.writeFileSync(logFile, ''); } logSize = 0; }
    fs.appendFileSync(logFile, line);
    logSize += Buffer.byteLength(line);
  } catch (_) { /* ignore */ }
}
const preload = path.join(__dirname, 'preload.js');

function ignoreRules() { return ignoreLib.cleanRules(store.settings.ignoreStats); }
function gearOpts() {
  const rules = ignoreRules();
  const tweaks = { ...(store.settings.buildTweaks || {}) };
  // "cap resistances first" also counts for the gear score (unless you've tuned resistances yourself)
  // – only for resistances you're actually short of
  const pr = C.pobPriorities();
  if (C.pobCI() && tweaks['Chaos res'] == null) tweaks['Chaos res'] = 0; // Chaos Inoculation
  const rs = pr.resFirst ? C.liveResists() : null;
  if (rs) {
    for (const [El, el] of Object.entries(RES_EL)) {
      if (el === 'chaos' && (!pr.chaos || C.pobCI())) continue;
      const cap = (rs.caps && rs.caps[el]) || rs.cap || 75;
      if (rs[el] != null && rs[el] < cap && tweaks[`${El} res`] == null) tweaks[`${El} res`] = 2;
    }
  }
  return { build: store.settings.build || gearLib.DEFAULT_BUILD, ignore: (k) => ignoreLib.isIgnored(rules, k), tweaks };
}

// resistance names in the gear score's tweaks -> in the resistances
const RES_EL = { Fire: 'fire', Cold: 'cold', Lightning: 'lightning', Chaos: 'chaos' };
const resLib = require('./core/resists');

// ---------- the app's parts ----------
// main.js keeps the shared state (store, windows, the log) and starts everything. Each part of the app
// is a module in src/app or src/features that reaches the rest through C: getters, so it always sees
// the current value (and setters where another part changes it).
const M = {};
const C = {
  get applyLinuxAutostart() { return applyLinuxAutostart; },
  get applyLoginItem() { return applyLoginItem; },
  get applyPob() { return M.pob.applyPob; },
  get budgetNow() { return M.budget.budgetNow; },
  get buildTrayMenu() { return buildTrayMenu; },
  get chaosRate() { return M.worth.chaosRate; },
  get clipRead() { return M.items.clipRead; },
  get clipReady() { return M.items.clipReady; }, set clipReady(v) { M.items.clipReady = v; },
  get clipWrite() { return M.items.clipWrite; },
  get createPopup() { return M.popup.createPopup; },
  get DEFAULT_HOTKEY() { return M.hotkeys.DEFAULT_HOTKEY; },
  get evaluate() { return M.evaluate.evaluate; },
  get fetchListings() { return M.results.fetchListings; },
  get fetchViaPage() { return M.results.fetchViaPage; },
  get G() { return M.pob.G; },
  get gameChanged() { return M.items.gameChanged; },
  get gameCtx() { return M.pob.gameCtx; },
  get gearLib() { return gearLib; },
  get gearOf() { return M.evaluate.gearOf; },
  get gearOpts() { return gearOpts; },
  get gearScoreOn() { return M.evaluate.gearScoreOn; },
  get getJson() { return M.search.getJson; },
  get guideFile() { return M.pob.guideFile; },
  get hideTimer() { return hideTimer; }, set hideTimer(v) { hideTimer = v; },
  get hotkeyBusy() { return M.items.hotkeyBusy; },
  get hotkeyStatus() { return M.items.hotkeyStatus; }, set hotkeyStatus(v) { M.items.hotkeyStatus = v; },
  get HOUR() { return M.budget.HOUR; },
  get ICON() { return ICON; },
  get ignoreRules() { return ignoreRules; },
  get inGame() { return M.pob.inGame; },
  get isFlaskClass() { return M.pob.isFlaskClass; },
  get itemById() { return itemById; },
  get keepNotification() { return keepNotification; },
  get keys() { return M.items.keys; }, set keys(v) { M.items.keys = v; },
  get lastClip() { return lastClip; }, set lastClip(v) { lastClip = v; },
  get lastItem() { return lastItem; },
  get lastWorth() { return lastWorth; },
  get leagueOk() { return M.search.leagueOk; },
  get levelSyncTimer() { return M.build.levelSyncTimer; }, set levelSyncTimer(v) { M.build.levelSyncTimer = v; },
  get listingLib() { return listingLib; },
  get liveResists() { return M.pob.liveResists; },
  get loadTradeData() { return M.search.loadTradeData; },
  get log() { return log; },
  get logFile() { return logFile; },
  get nearRateLimit() { return M.search.nearRateLimit; },
  get ninjaLeague() { return M.budget.ninjaLeague; },
  get ninjaLib() { return ninjaLib; },
  get ninjaPrice() { return ninjaPrice; },
  get notifySettings() { return M.gear.notifySettings; },
  get onHotkey() { return M.items.onHotkey; },
  get openIfAny() { return M.search.openIfAny; },
  get openSettings() { return openSettings; },
  get pickLeague() { return M.search.pickLeague; },
  get pobCanJudge() { return M.pob.pobCanJudge; },
  get pobCI() { return M.pob.pobCI; },
  get pobEngine() { return M.pob.pobEngine; },
  get pobEngs() { return M.pob.pobEngs; },
  get pobErrorOf() { return M.pob.pobErrorOf; },
  get pobFile() { return M.pob.pobFile; },
  get routeReset() { return routeFeature.reset; },
  get pobJudge() { return M.pob.pobJudge; },
  get pobLastSummary() { return M.build.pobLastSummary; },
  get pobListings() { return M.results.pobListings; },
  get pobOn() { return M.pob.pobOn; },
  get pobPriorities() { return M.pob.pobPriorities; },
  get pobQueries() { return M.pob.pobQueries; },
  get pobQueryFor() { return M.pob.pobQueryFor; },
  get pobSearch() { return M.pob.pobSearch; },
  get pobSheetGen() { return () => M.pob.pobSheetGen; },
  get pobSummary() { return M.build.pobSummary; },
  get pobSync() { return M.pob.pobSync; },
  get pobVerdict() { return require('./core/pobverdict'); },
  get pobWeights() { return M.pob.pobWeights; },
  get pobXml() { return M.pob.pobXml; },
  get POE_PARTITION() { return M.search.POE_PARTITION; },
  get poe1Unjudged() { return M.pob.poe1Unjudged; },
  get pollClipboard() { return M.items.pollClipboard; },
  get popup() { return popup; }, set popup(v) { popup = v; },
  get popupHovered() { return popupHovered; }, set popupHovered(v) { popupHovered = v; },
  get popupItem() { return M.popup.popupItem; }, set popupItem(v) { M.popup.popupItem = v; },
  get popupResult() { return M.popup.popupResult; }, set popupResult(v) { M.popup.popupResult = v; },
  get popupSeq() { return M.popup.popupSeq; }, set popupSeq(v) { M.popup.popupSeq = v; },
  get preload() { return preload; },
  get prices() { return prices; },
  get priceSummary() { return M.worth.priceSummary; },
  get recentItems() { return recentItems; },
  get refreshAll() { return M.gear.refreshAll; },
  get refreshDivineRate() { return M.budget.refreshDivineRate; },
  get registerHotkey() { return M.hotkeys.registerHotkey; },
  get registerPriceHotkey() { return M.hotkeys.registerPriceHotkey; },
  get registerResultsHotkey() { return M.results.registerResultsHotkey; },
  get remember() { return remember; },
  get rememberListing() { return rememberListing; },
  get RES_EL() { return RES_EL; },
  get resNeedFor() { return M.pob.resNeedFor; },
  get resolveItem() { return M.gear.resolveItem; },
  get resolveSlotOf() { return M.gear.resolveSlotOf; },
  get resultsHotkey() { return M.results.resultsHotkey; },
  get resultsPayload() { return M.results.resultsPayload; },
  get resultsState() { return M.results.resultsState; },
  get resultsWin() { return M.results.resultsWin; },
  get runSearch() { return M.search.runSearch; },
  get sameGame() { return M.pob.sameGame; },
  get sameKey() { return M.hotkeys.sameKey; },
  get savedFeature() { return savedFeature; },
  get savedList() { return savedList; },
  get scoreListing() { return M.results.scoreListing; },
  get searchKey() { return M.search.searchKey; },
  get searchLog() { return M.search.searchLog; },
  get searchWait() { return M.search.searchWait; },
  get serialise() { return M.popup.serialise; },
  get setGameSetting() { return M.pob.setGameSetting; },
  get settingsWin() { return settingsWin; },
  get showMapCard() { return showMapCard; },
  get shownGame() { return M.items.shownGame; }, set shownGame(v) { M.items.shownGame = v; },
  get shownLeague() { return M.popup.shownLeague; },
  get showPriceCard() { return showPriceCard; },
  get showQuickPrice() { return M.hotkeys.showQuickPrice; },
  get showResult() { return M.popup.showResult; },
  get showResults() { return M.results.showResults; },
  get signedIn() { return M.account.signedIn; },
  get stopOtherEngines() { return M.pob.stopOtherEngines; },
  get store() { return store; },
  get SWITCHED() { return M.pob.SWITCHED; },
  get syncBuild() { return M.build.syncBuild; },
  get tg() { return M.pob.tg; },
  get toggleResults() { return M.results.toggleResults; },
  get trade() { return trade; },
  get tradeDataBy() { return M.search.tradeDataBy; },
  get tradePrice() { return M.worth.tradePrice; },
  get tradeWin() { return M.search.tradeWin; }, set tradeWin(v) { M.search.tradeWin = v; },
  get UA() { return M.search.UA; },
  get uiScale() { return M.popup.uiScale; },
  get updates() { return updates; },
  get usage() { return usage; },
  get watchBuildFile() { return M.build.watchBuildFile; },
  get watchCursor() { return M.popup.watchCursor; },
  get withTimeout() { return M.guard.withTimeout; },
};
M.guard = require('./app/guard')(C);
M.pob = require('./features/pob')(C);
M.evaluate = require('./features/evaluate')(C);
M.popup = require('./features/popup')(C);
M.items = require('./features/items')(C);
M.hotkeys = require('./features/hotkeys')(C);
M.gear = require('./features/gear')(C);
M.build = require('./features/build')(C);
M.pages = require('./features/pages')(C);
M.search = require('./features/search')(C);
M.results = require('./features/results')(C);
M.budget = require('./features/budget')(C);
M.worth = require('./features/worth')(C);
M.account = require('./features/account')(C);

const ninjaLib = require('./core/ninja');
const prices = require('./features/prices')(C);
const mapFeature = require('./features/mapcheck')(C);
require('./features/lootfilter')(C);
require('./features/spend')(C);
const routeFeature = require('./features/route')(C);
require('./features/runes')(C);
function ninjaPrice(item) {
  // with the same price in chaos orbs (PoE2), for the price card
  return prices.ninjaPrice(item).then((p) => { const c = C.chaosRate(); if (p && c) { const ch = (v) => (v == null ? null : Math.round((v / c) * 10) / 10); p.eachChaos = ch(p.each); p.totalChaos = ch(p.total); } return p; });
}
function showPriceCard(item) { return prices.showPriceCard(item); }
function showMapCard(item) { return mapFeature.showMapCard(item); }
const updates = require('./features/updates')(C);
const usage = require('./features/stats')(C);
const savedFeature = require('./features/saved')(C);
function savedList() { return savedFeature.savedList(); }
function runAlerts(force) { return savedFeature.runAlerts(force); }
function keepNotification(n) { return savedFeature.keepNotification(n); }
// ---------- start with Windows (or with your Linux desktop) ----------

function applyLoginItem() {
  if (process.platform === 'linux') return applyLinuxAutostart();
  try {
    const openAtLogin = !!store.settings.startWithWindows;
    const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
    // the portable .exe runs from a temporary copy: start the real file instead
    const portable = process.env.PORTABLE_EXECUTABLE_FILE;
    app.setLoginItemSettings({ openAtLogin, path: portable || process.execPath, args });
  } catch (err) { log('login item: ' + err.message); }
}

// Linux desktops start what's in ~/.config/autostart (the AppImage, quietly in the tray)
function applyLinuxAutostart() {
  try {
    const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config'), 'autostart');
    const file = path.join(dir, 'poe2-upgrade-checker.desktop');
    if (!store.settings.startWithWindows) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
    const exe = process.env.APPIMAGE || process.execPath;
    const q = (s) => `"${String(s).replace(/(["\\`$])/g, '\\$1')}"`;
    const exec = app.isPackaged ? `${q(exe)} --hidden` : `${q(exe)} ${q(app.getAppPath())} --hidden`;
    fs.mkdirSync(dir, { recursive: true });
    // .desktop Exec: quoted args escape " ` $ \ with a backslash, then the value's own escaping doubles backslashes; % is %%
    const execLine = exec.replace(/\\/g, '\\\\').replace(/%/g, '%%');
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=PoE Upgrade Checker\nExec=${execLine}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`);
  } catch (err) { log('autostart: ' + err.message); }
}

// ---------- settings window & tray ----------

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  // reopen where you left it (e.g. maximized on your second monitor)
  const saved = store.settings.settingsBounds;
  const onScreen = saved && screen.getAllDisplays().some((d) => {
    const a = d.workArea; return saved.x >= a.x - 50 && saved.y >= a.y - 50 && saved.x < a.x + a.width - 100 && saved.y < a.y + a.height - 100;
  });
  settingsWin = new BrowserWindow({
    width: onScreen ? saved.width : 1240, height: onScreen ? saved.height : 860, ...(onScreen ? { x: saved.x, y: saved.y } : {}),
    minWidth: 640, minHeight: 480,
    title: 'PoE Upgrade Checker', icon: ICON, autoHideMenuBar: true,
    backgroundColor: '#14110f',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (onScreen && store.settings.settingsMaximized) settingsWin.maximize();
  let bt = null;
  const remember = () => {
    clearTimeout(bt);
    bt = setTimeout(() => {
      if (!settingsWin || settingsWin.isDestroyed()) return;
      const max = settingsWin.isMaximized();
      store.setSetting('settingsMaximized', max);
      if (!max && !settingsWin.isMinimized()) store.setSetting('settingsBounds', settingsWin.getBounds());
    }, 400);
  };
  settingsWin.on('move', remember); settingsWin.on('resize', remember); settingsWin.on('maximize', remember); settingsWin.on('unmaximize', remember);
  settingsWin.loadFile(path.join(__dirname, 'ui', 'settings.html'));
}

// ---------- auto-update (installed app only; releases on GitHub) ----------
function buildTrayMenu() {
  const paused = !!store.settings.paused;
  tray.setToolTip(paused ? 'PoE Upgrade Checker (paused)' : 'PoE Upgrade Checker');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: C.hotkeyStatus.ok ? `Hotkey: ${C.hotkeyStatus.accelerator}` : 'Hotkey not set (see Settings)', enabled: false },
    { label: `${C.G(store.activeGame()).short}${C.G(store.activeGame()).beta ? ' (beta)' : ''} · Character: ${(store.listProfiles().find((p) => p.active) || {}).name || '—'}`, enabled: false },
    { label: `Show / hide results${C.resultsHotkey ? ` (${C.resultsHotkey})` : ''}`, click: C.toggleResults, enabled: !!C.resultsState },
    ...(updates.upd.state === 'ready' ? [{ label: `Restart to update to ${updates.upd.version}`, click: () => updates.updater() && updates.updater().quitAndInstall(true, true) }] : []),
    { label: 'Settings && gear…', click: openSettings },
    { label: 'Open log', click: () => { log('log opened'); shell.openPath(logFile); } },
    { label: paused ? 'Resume watching' : 'Pause watching', click: () => { store.setSetting('paused', !paused); buildTrayMenu(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

app.on('second-instance', openSettings);

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  C.shownGame = store.activeGame();
  store.onError = (err) => log('could not save settings: ' + err.message);
  if (store.loadError) setTimeout(() => log(`settings file couldn't be read (${store.loadError}); a copy was kept as poe2-upgrade-checker.json.unreadable-*`), 0);
  // Don't pop up for whatever happened to be on the clipboard at launch.
  C.clipRead().then((t) => { lastClip = t; C.clipReady = true; });

  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.on('click', openSettings);
  buildTrayMenu();
  C.createPopup();
  log(`started v${app.getVersion()} on ${process.platform}`);
  C.keys = new KeySender(log, app.getPath('userData'));
  C.keys.start();
  // one-time: old letter defaults clash with WASD movement -> F-keys
  if (!store.settings.hotkeyMigrated) {
    if (!store.settings.hotkey || store.settings.hotkey === 'Ctrl+D') { store.setSetting('hotkey', C.DEFAULT_HOTKEY); log('hotkey: moved from Ctrl+D to F2 (D is a movement key)'); }
    store.setSetting('hotkeyMigrated', true);
  }
  // older resistance records: pin them to the gear worn now so later swaps move the totals
  if (store.settings.resists && !store.settings.resists.gear) {
    store.setSetting('resists', { ...store.settings.resists, gear: resLib.gearRes(store.equipped), source: store.settings.resists.source || 'pob' });
  }
  // the gear-score profile used to default to the Djinn summoner: keep it for people already using it
  if (!store.settings.build) store.setSetting('build', store.settings.wizardDone || Object.keys(store.equipped || {}).length ? 'djinn-varashta' : gearLib.DEFAULT_BUILD);
  C.pobSync();
  C.watchBuildFile();
  // start Path of Building for the game you're on a little after launch, so the first F2 doesn't
  // wait for it to load (it still stops by itself after a while unused)
  if (store.settings.warmPob !== false) setTimeout(() => { if (C.pobOn()) C.pobEngine().ensureLoaded().then(() => log('pob: ready before the first F2')).catch((err) => log('pob warm-up: ' + err.message)); }, 6000);
  process.on('uncaughtException', (err) => log('error: ' + (err && err.stack || err)));
  process.on('unhandledRejection', (err) => log('error (promise): ' + (err && err.stack || err)));
  C.registerHotkey();
  C.registerResultsHotkey();
  C.registerPriceHotkey();
  routeFeature.start();
  buildTrayMenu();
  setInterval(C.pollClipboard, 250);
  setInterval(C.watchCursor, 200);
  setInterval(() => runAlerts(false).catch((e) => log('alerts: ' + e.message)), 60000);
  try { app.setAppUserModelId('local.poe2.upgradechecker'); } catch (_) { /* ignore */ }
  C.refreshDivineRate(false).catch(() => {});
  setInterval(() => C.refreshDivineRate(false).catch(() => {}), C.HOUR);
  // the trade site's stat list, read before the first F2 / F3 needs it (it's cached on disk for a day)
  setTimeout(() => C.gameCtx.run({ game: store.activeGame() }, () => C.loadTradeData(false)).then(() => log('trade data ready')).catch((err) => log('trade data warm-up: ' + (err.message || err))), 4000);
  applyLoginItem();
  updates.setupUpdater();
  usage.start();
  const hidden = process.argv.includes('--hidden') || store.settings.openSettingsOnStart === false;
  if (!hidden) openSettings();
});

app.on('window-all-closed', (e) => { /* keep running in the tray */ });
app.on('will-quit', () => { if (store && store.soonTimer) store.save(); globalShortcut.unregisterAll(); if (C.keys) C.keys.stop(); for (const e of Object.values(C.pobEngs)) e.kill(); });
