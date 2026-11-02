'use strict';

// Auto-update: the installed app and the AppImage update themselves from GitHub releases (betas: pre-releases).
// Moved out of main.js: it reaches the app's shared state and helpers through C (see main.js).
const { app, ipcMain, Notification } = require('electron');

module.exports = function (C) {
  const upd = { state: 'idle', version: null, error: null, progress: null, checked: null };
  let autoUpdater = null;
  // the installed app and the AppImage update themselves; the portable .exe and other Linux builds don't
  function updaterAvailable() { return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR && (process.platform !== 'linux' || !!process.env.APPIMAGE); }
  // betas (pre-releases on GitHub) when you ask for them in Settings, or when you already run one
  // (0.5.0-beta.1 gets the next betas and then the release). Turning it off on a beta keeps that beta
  // until the next full release is newer.
  const wantBetas = () => C.store.settings.betaUpdates === true || /-/.test(app.getVersion());
  function setBetas() {
    if (!autoUpdater) return;
    autoUpdater.allowPrerelease = wantBetas();
    autoUpdater.checkForUpdates().catch((err) => C.log('update check: ' + err.message));
  }
  function setupUpdater() {
    if (!updaterAvailable()) { upd.state = app.isPackaged ? 'portable' : 'dev'; return; }
    try { ({ autoUpdater } = require('electron-updater')); } catch (err) { upd.state = 'unavailable'; C.log('updater: ' + err.message); return; }
    autoUpdater.autoDownload = C.store.settings.autoUpdate !== false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = wantBetas();
    autoUpdater.logger = { info: (m) => C.log('updater: ' + m), warn: (m) => C.log('updater warn: ' + m), error: (m) => C.log('updater error: ' + m), debug: () => {} };
    const changed = () => { C.notifySettings('update:changed'); C.buildTrayMenu(); };
    autoUpdater.on('checking-for-update', () => { upd.state = 'checking'; upd.error = null; changed(); });
    autoUpdater.on('update-not-available', () => { upd.state = 'latest'; upd.checked = Date.now(); changed(); });
    autoUpdater.on('update-available', (i) => { upd.state = autoUpdater.autoDownload ? 'downloading' : 'available'; upd.version = i.version; upd.checked = Date.now(); changed(); });
    autoUpdater.on('download-progress', (p) => { upd.progress = Math.round(p.percent); C.notifySettings('update:changed'); });
    // an AppImage update can land under a new file name: point "start when I log in" at it
    autoUpdater.on('appimage-filename-updated', (p) => { if (p) { process.env.APPIMAGE = p; C.applyLinuxAutostart(); } });
    autoUpdater.on('error', (err) => { upd.state = 'error'; upd.error = String(err && err.message || err).split('\n')[0]; changed(); });
    autoUpdater.on('update-downloaded', (i) => {
      upd.state = 'ready'; upd.version = i.version; changed();
      C.log(`update ${i.version} downloaded; installs on restart`);
      try {
        const n = new Notification({ title: `PoE Upgrade Checker ${i.version} is ready`, body: 'Click to restart and update now, or it installs next time you quit.', icon: C.ICON });
        n.on('click', () => autoUpdater.quitAndInstall(true, true));
        C.keepNotification(n);
        n.show();
      } catch (_) { /* ignore */ }
    });
    const check = () => autoUpdater.checkForUpdates().catch((err) => C.log('update check: ' + err.message));
    setTimeout(check, 15000);
    setInterval(check, 6 * C.HOUR);
  }
  // ---------- What's new: the release notes, once, after an update ----------
  const changelog = require('../core/changelog');
  let changelogText = null;
  function readChangelog() {
    if (changelogText != null) return changelogText;
    try { changelogText = require('fs').readFileSync(require('path').join(app.getAppPath(), 'CHANGELOG.md'), 'utf8'); } catch (_) { changelogText = ''; }
    return changelogText;
  }
  // the versions to show: newer than the one you last saw, up to this one (none on a first install)
  function whatsNew() {
    const cur = app.getVersion();
    const seen = C.store.settings.seenVersion;
    const md = readChangelog();
    // someone updating from before this was remembered: only this version's notes
    const from = seen || (C.store.settings.wizardDone ? null : cur);
    const pending = from !== cur && (!from || changelog.cmp(cur, from) > 0);
    const list = pending ? (from ? changelog.since(md, from, cur) : [changelog.notesFor(md, cur)].filter(Boolean)) : [changelog.notesFor(md, cur)].filter(Boolean);
    return { current: cur, pending: pending && list.length > 0, sections: list.slice(0, 5) };
  }
  function announceWhatsNew() {
    const w = whatsNew();
    if (!C.store.settings.seenVersion && !w.pending) { C.store.setSetting('seenVersion', w.current); return; } // a first install: nothing to announce
    if (!w.pending) return;
    try {
      const count = w.sections.reduce((t, s) => t + s.entries.length, 0);
      const n = new Notification({ title: `Updated to ${w.current}`, body: `${count} new thing${count === 1 ? '' : 's'} and fixes. Click to see what's new.`, icon: C.ICON });
      n.on('click', () => C.openSettings());
      C.keepNotification(n);
      n.show();
    } catch (_) { /* ignore */ }
  }
  ipcMain.handle('whatsnew:get', () => whatsNew());
  ipcMain.handle('whatsnew:seen', () => { C.store.setSetting('seenVersion', app.getVersion()); return true; });

  ipcMain.handle('update:status', () => ({ ...upd, current: app.getVersion() }));
  ipcMain.handle('update:check', async () => {
    if (!autoUpdater) return { ...upd, current: app.getVersion() };
    try { await autoUpdater.checkForUpdates(); } catch (err) { upd.state = 'error'; upd.error = err.message; }
    return { ...upd, current: app.getVersion() };
  });
  ipcMain.handle('update:download', async () => { if (autoUpdater) { upd.state = 'downloading'; autoUpdater.downloadUpdate().catch((e) => C.log('update download: ' + e.message)); } return upd; });
  ipcMain.on('update:install', () => { if (autoUpdater && upd.state === 'ready') autoUpdater.quitAndInstall(true, true); });
  ipcMain.handle('update:info', () => ({ current: app.getVersion(), beta: /-/.test(app.getVersion()), betas: wantBetas() }));
  return { upd, announceWhatsNew, whatsNew, setupUpdater, updaterAvailable, setBetas, updater: () => autoUpdater };
};
