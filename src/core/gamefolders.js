'use strict';

// Where the game keeps its files: the Documents folder with loot filters (My Games/Path of Exile 2)
// and the install folder with logs/Client.txt.
//
// On Windows that's your own Documents. On Linux the game runs in Steam's Proton, which gives it a
// Windows drive of its own inside Steam's library (compatdata/<app id>/pfx/drive_c/...), so the
// Documents folder the game uses isn't ~/Documents at all.
const fs = require('fs');
const path = require('path');
const os = require('os');

const STEAM_APP = { poe1: '238960', poe2: '2694490' };
const DIR = { poe1: 'Path of Exile', poe2: 'Path of Exile 2' };
const gameKey = (g) => (g === 'poe1' ? 'poe1' : 'poe2');

// Steam's own folders (native, the Debian/Ubuntu ~/.steam link and the Flatpak one)
function steamRoots(home = os.homedir()) {
  return [
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.steam', 'steam'),
    path.join(home, '.steam', 'root'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
  ];
}

// every Steam library: the Steam folder itself plus the ones listed in libraryfolders.vdf
// ("path"  "/mnt/games/SteamLibrary")
function parseLibraryFolders(vdf) {
  const out = [];
  for (const m of String(vdf || '').matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) out.push(m[1].replace(/\\\\/g, '\\'));
  return out;
}
function steamLibraries({ home, exists = fs.existsSync, read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const libs = [];
  for (const root of steamRoots(home)) {
    if (!exists(root)) continue;
    libs.push(root);
    try { libs.push(...parseLibraryFolders(read(path.join(root, 'steamapps', 'libraryfolders.vdf')))); } catch (_) { /* no list */ }
  }
  // the same library through ~/.steam/steam and ~/.local/share/Steam is one library
  const seen = new Set(); const out = [];
  for (const l of libs) { let k = l; try { k = fs.realpathSync(l); } catch (_) { /* keep as is */ } if (!seen.has(k)) { seen.add(k); out.push(l); } }
  return out;
}

// the folders the game's Documents/My Games/<game> may be in, most likely first
function documentsFolders(game, { platform = process.platform, documents, home = os.homedir(), exists, read } = {}) {
  const g = gameKey(game);
  const own = documents ? [path.join(documents, 'My Games', DIR[g])] : [];
  if (platform !== 'linux') return own;
  const proton = steamLibraries({ home, exists, read }).map((lib) => path.join(lib, 'steamapps', 'compatdata', STEAM_APP[g], 'pfx', 'drive_c', 'users', 'steamuser', 'Documents', 'My Games', DIR[g]));
  return [...proton, ...own];
}

// the game's Client.txt in each Steam library (Linux); Windows' usual places are in core/route.js
function linuxLogPaths(game, opts = {}) {
  const g = gameKey(game);
  return steamLibraries(opts).map((lib) => path.join(lib, 'steamapps', 'common', DIR[g], 'logs', 'Client.txt'));
}

// the folder to use: the one you picked, else the first that's there, else the most likely one
function gameFolder(game, { picked, exists = fs.existsSync, ...opts } = {}) {
  if (picked) return picked;
  const all = documentsFolders(game, { exists, ...opts });
  return all.find((d) => exists(d)) || all[all.length - 1] || null;
}

module.exports = { STEAM_APP, steamRoots, parseLibraryFolders, steamLibraries, documentsFolders, linuxLogPaths, gameFolder };
