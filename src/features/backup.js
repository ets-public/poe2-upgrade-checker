'use strict';

// Settings → Back up / restore: everything the app keeps for you in one file (core/backup.js).
const fs = require('fs');
const path = require('path');
const { app, dialog, ipcMain } = require('electron');
const backup = require('../core/backup');

module.exports = function (C) {
  const pobDir = () => path.join(app.getPath('userData'), 'pob');
  function readPob() {
    const out = {};
    try { for (const f of fs.readdirSync(pobDir())) if (/\.(xml|build)$/.test(f)) out[f] = fs.readFileSync(path.join(pobDir(), f), 'utf8'); } catch (_) { /* no builds yet */ }
    return out;
  }
  const day = () => new Date().toISOString().slice(0, 10);

  ipcMain.handle('backup:export', async () => {
    C.store.save();
    const r = await dialog.showSaveDialog(C.settingsWin && !C.settingsWin.isDestroyed() ? C.settingsWin : undefined, {
      title: 'Back up settings, characters and builds', defaultPath: path.join(app.getPath('documents'), `PoE-Upgrade-Checker-backup-${day()}.json`),
      filters: [{ name: 'Backup', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    const b = backup.pack(C.store.data, readPob(), { version: app.getVersion() });
    try { fs.writeFileSync(r.filePath, JSON.stringify(b)); } catch (err) { return { ok: false, error: `Couldn't save it: ${err.message}` }; }
    C.log(`backup: saved to ${r.filePath} (${Object.keys(b.pob).length} build files)`);
    return { ok: true, file: r.filePath, characters: Object.keys(b.data.profiles || {}).length, builds: Object.keys(b.pob).length };
  });

  ipcMain.handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(C.settingsWin && !C.settingsWin.isDestroyed() ? C.settingsWin : undefined, {
      title: 'Restore from a backup', properties: ['openFile'], filters: [{ name: 'Backup', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    let text;
    try { text = fs.readFileSync(r.filePaths[0], 'utf8'); } catch (err) { return { ok: false, error: `Couldn't read it: ${err.message}` }; }
    const u = backup.unpack(text, C.store.data);
    if (!u.ok) return u;
    const ok = await dialog.showMessageBox(C.settingsWin && !C.settingsWin.isDestroyed() ? C.settingsWin : undefined, {
      type: 'question', buttons: ['Restore and restart', 'Cancel'], defaultId: 0, cancelId: 1, title: 'Restore from a backup',
      message: `Replace your settings, characters and builds with the backup${u.summary.made ? ` from ${u.summary.made.slice(0, 10)}` : ''}?`,
      detail: `${u.summary.characters} character${u.summary.characters === 1 ? '' : 's'}, ${u.summary.builds} Path of Building file${u.summary.builds === 1 ? '' : 's'}. What you have now is kept next to it as a copy, and the app restarts.`,
    });
    if (ok.response !== 0) return { ok: false, canceled: true };
    // what you had: kept aside, never just overwritten
    const stamp = Date.now();
    try { if (fs.existsSync(C.store.file)) fs.copyFileSync(C.store.file, `${C.store.file}.before-restore-${stamp}`); } catch (err) { C.log('backup: keeping the old settings failed: ' + err.message); }
    try {
      fs.mkdirSync(pobDir(), { recursive: true });
      for (const f of fs.readdirSync(pobDir())) if (/\.(xml|build)$/.test(f)) fs.renameSync(path.join(pobDir(), f), path.join(pobDir(), `${f}.before-restore-${stamp}`));
      for (const [f, t] of Object.entries(u.pob)) fs.writeFileSync(path.join(pobDir(), f), t);
    } catch (err) { return { ok: false, error: `Couldn't restore the builds: ${err.message}` }; }
    C.store.data = u.data;
    C.store.save();
    C.log(`backup: restored from ${r.filePaths[0]}; restarting`);
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });

  return {};
};
