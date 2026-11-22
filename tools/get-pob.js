#!/usr/bin/env node
'use strict';
// Fetches the pinned Path of Building versions: PoE2's into vendor/pob, PoE1's (Path of Building
// Community) into vendor/pob1, and builds the host both run in:
// pobhost.exe on Windows; on Linux, LuaJIT and the lua-utf8 module built from pinned sources
// (needs git, gcc and make) into vendor/pob/runtime/linux.
// Only the parts the calculations need are downloaded (Lua + data, no images): about 50 MB for
// PoE2; for PoE1 the passive trees from 3.27 on and the Legion timeless jewels' tables, about 130 MB.
// Run by test-build.bat, build-exe.bat and the release build. Safe to run again: it skips
// the download when the right version is already there.
//
//   node tools/get-pob.js            fetch if needed, build the host
//   node tools/get-pob.js --force    fetch again

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// update a tag together with a test run against a real build (npm test runs PoB1's own test builds)
const TARGETS = [
  {
    name: 'Path of Building (PoE2)', repo: 'https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git', tag: 'v0.23.1', commit: '7d6f530cbdab20389ff8bc6ba97a37ac27f74e41',
    dest: path.join(ROOT, 'vendor', 'pob'),
    paths: ['/src/**/*.lua', '/src/**/*.json', '!/src/Export/',
      '/runtime/lua/', '/runtime/lua51.dll', '/runtime/lua-utf8.dll', '/runtime/zlib1.dll', '/runtime/vcruntime140.dll', '/LICENSE.md', '/manifest.xml'],
  },
  {
    // PoE1. Runs in the same host and LuaJIT as PoE2's (vendor/pob/runtime). Passive trees older than
    // 3.27 are left out (a build made on one is moved to the newest tree when it loads). The Legion
    // timeless jewels' lookup tables come along (33 MB of zips: without them a build with one of those
    // jewels calculates without it); the Abyss ones (140 MB more) don't, and are taken out of the build.
    name: 'Path of Building Community (PoE1)', repo: 'https://github.com/PathOfBuildingCommunity/PathOfBuilding.git', tag: 'v2.68.1', commit: 'a41fec6c20f822a658ae5df1273e8c69d5969bac',
    dest: path.join(ROOT, 'vendor', 'pob1'),
    paths: ['/src/**/*.lua', '/src/**/*.json', '/src/**/*.jsonc', '!/src/Export/**', '!/src/TreeData/**', '/src/TreeData/*.lua',
      '/src/TreeData/3_30*/*.lua', '/src/TreeData/3_29*/*.lua', '/src/TreeData/3_28*/*.lua', '/src/TreeData/3_27*/*.lua', '/src/TreeData/3_19/Assets.lua', '/src/TreeData/legion/*', '!/src/TreeData/legion/*.png',
      '/src/Data/TimelessJewelData/BrutalRestraint.zip', '/src/Data/TimelessJewelData/ElegantHubris.zip', '/src/Data/TimelessJewelData/GloriousVanity.zip.part*',
      '/src/Data/TimelessJewelData/HeroicTragedy.zip', '/src/Data/TimelessJewelData/LethalPride.zip', '/src/Data/TimelessJewelData/MilitantFaith.zip',
      '/runtime/lua/', '/LICENSE.md', '/manifest.xml'],
  },
];
const DEST = TARGETS[0].dest; // the host and LuaJIT live with PoE2's copy

// Linux: the same LuaJIT 2.1 Path of Building ships for Windows, and lua-utf8 (its one native module)
const LUAJIT_REPO = 'https://github.com/LuaJIT/LuaJIT.git';
const LUAJIT_COMMIT = '95f931cb1ee7ab14f249d61fb3734803429025f8'; // v2.1 branch, tested with PoB 0.23.1
const LUAUTF8_REPO = 'https://github.com/starwing/luautf8.git';
const LUAUTF8_COMMIT = '1bb70d45208d4033dcc75efee968be70534dd3ab'; // tag 0.1.6 (a commit: a tag can be moved)
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function fetchPob(t) {
  const STAMP = path.join(t.dest, '.pob-version');
  const DEST = t.dest; const POB_TAG = t.tag; const POB_REPO = t.repo;
  const rel = path.relative(ROOT, DEST).replace(/\\/g, '/');
  // the stamp names the version and which of its files were fetched, so a copy fetched before the
  // file list grew (timeless jewel tables, more passive trees) is fetched again
  const WANT = `${POB_TAG} ${require('crypto').createHash('sha1').update(t.paths.join('\n')).digest('hex').slice(0, 10)}`;
  if (!process.argv.includes('--force') && fs.existsSync(STAMP) && fs.readFileSync(STAMP, 'utf8').trim() === WANT) {
    console.log(`${t.name} ${POB_TAG} is already in ${rel}.`);
    return;
  }
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (_) {
    console.error(process.platform === 'win32' ? 'Git is needed to download Path of Building: https://git-scm.com/download/win'
      : process.platform === 'darwin' ? 'Git is needed to download Path of Building: run xcode-select --install (or see https://git-scm.com/download/mac).'
        : 'Git is needed to download Path of Building: install it with your package manager (e.g. sudo apt install git).');
    process.exit(1);
  }
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  console.log(`Downloading ${t.name} ${POB_TAG} (Lua and data only)...`);
  run('git', ['clone', '--quiet', '--depth', '1', '--branch', POB_TAG, '--filter=blob:none', '--no-checkout', POB_REPO, DEST]);
  run('git', ['-C', DEST, 'sparse-checkout', 'set', '--no-cone', ...t.paths]);
  run('git', ['-C', DEST, 'checkout', '--quiet']);
  // a tag can be moved: the release only ships the exact commit that was tested (update both together)
  const head = execFileSync('git', ['-C', DEST, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (t.commit && head !== t.commit) {
    fs.rmSync(DEST, { recursive: true, force: true });
    console.error(`${t.name} ${POB_TAG} is commit ${head} on GitHub, not the tested ${t.commit}. Nothing was installed: check the tag before releasing.`);
    process.exit(1);
  }
  fs.rmSync(path.join(DEST, '.git'), { recursive: true, force: true });
  fs.writeFileSync(STAMP, WANT + '\n');
}

// pobhost.exe: compiled with the C# compiler that comes with Windows (.NET Framework 4)
function buildHost() {
  if (process.platform !== 'win32') return;
  const out = path.join(DEST, 'runtime', 'pobhost.exe');
  const src = path.join(ROOT, 'pob', 'pobhost.cs');
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs) { console.log('pobhost.exe is up to date.'); return; }
  const win = process.env.WINDIR || 'C:\\Windows';
  const csc = [path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find((p) => fs.existsSync(p));
  if (!csc) { console.error('The C# compiler that ships with Windows (.NET Framework 4) was not found, so the Path of Building engine is left out.'); process.exit(1); }
  run(csc, ['/nologo', '/optimize+', '/platform:x64', '/target:exe', `/out:${out}`, src]);
  console.log('Built pobhost.exe.');
}

// poekeys.exe: the Windows key helper (src/keysender.js), prebuilt so the app doesn't start PowerShell
// and compile it on every launch. Same compiler; the C# comes from keysender.js so there's one copy.
function buildKeys() {
  if (process.platform !== 'win32') return;
  const out = path.join(DEST, 'runtime', 'poekeys.exe');
  const from = path.join(ROOT, 'src', 'keysender.js');
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(from).mtimeMs) { console.log('poekeys.exe is up to date.'); return; }
  const win = process.env.WINDIR || 'C:\\Windows';
  const csc = [path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find((p) => fs.existsSync(p));
  if (!csc) { console.error('The C# compiler that ships with Windows (.NET Framework 4) was not found, so poekeys.exe is left out (the app uses PowerShell instead).'); return; }
  const { CS_SOURCE, CS_MAIN } = require('../src/keysender');
  const src = path.join(DEST, 'runtime', 'poekeys.cs');
  fs.writeFileSync(src, CS_SOURCE + '\n' + CS_MAIN);
  run(csc, ['/nologo', '/optimize+', '/platform:anycpu', '/target:exe', `/out:${out}`, src]);
  fs.rmSync(src, { force: true });
  console.log('Built poekeys.exe.');
}

// vendor/pob/runtime/linux/luajit and lua-utf8.so
function buildLinuxRuntime() {
  if (process.platform !== 'linux') return;
  const out = path.join(DEST, 'runtime', 'linux');
  const stamp = path.join(out, '.version');
  const want = `${LUAJIT_COMMIT} ${LUAUTF8_COMMIT}`;
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === want && fs.existsSync(path.join(out, 'luajit'))) { console.log('LuaJIT for Linux is up to date.'); return; }
  for (const tool of ['git', 'gcc', 'make']) {
    try { execFileSync(tool, ['--version'], { stdio: 'ignore' }); } catch (_) { console.error(`${tool} is needed to build the Path of Building engine on Linux (e.g. sudo apt install build-essential git).`); process.exit(1); }
  }
  const tmp = path.join(ROOT, 'vendor', 'build');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const lj = path.join(tmp, 'LuaJIT');
  console.log('Building LuaJIT...');
  run('git', ['init', '--quiet', lj]);
  run('git', ['-C', lj, 'fetch', '--quiet', '--depth', '1', LUAJIT_REPO, LUAJIT_COMMIT]);
  run('git', ['-C', lj, 'checkout', '--quiet', 'FETCH_HEAD']);
  // static, no shared libluajit: one file that runs on any x64 Linux of the same age or newer
  run('make', ['-C', lj, '-j4', 'BUILDMODE=static'], { stdio: ['ignore', 'ignore', 'inherit'] });
  const lu = path.join(tmp, 'luautf8');
  run('git', ['init', '--quiet', lu]);
  run('git', ['-C', lu, 'fetch', '--quiet', '--depth', '1', LUAUTF8_REPO, LUAUTF8_COMMIT]);
  run('git', ['-C', lu, 'checkout', '--quiet', 'FETCH_HEAD']);
  fs.mkdirSync(out, { recursive: true });
  run('gcc', ['-O2', '-shared', '-fPIC', '-I', path.join(lj, 'src'), path.join(lu, 'lutf8lib.c'), '-o', path.join(out, 'lua-utf8.so')]);
  fs.copyFileSync(path.join(lj, 'src', 'luajit'), path.join(out, 'luajit'));
  fs.chmodSync(path.join(out, 'luajit'), 0o755);
  fs.writeFileSync(stamp, want + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Built LuaJIT and lua-utf8 for Linux.');
}

module.exports = { TARGETS };
if (require.main === module) {
  for (const t of TARGETS) fetchPob(t);
  buildHost();
  buildKeys();
  buildLinuxRuntime();
}
