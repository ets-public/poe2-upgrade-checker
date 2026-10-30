'use strict';

// Your build: importing it from Path of Building (or a guide's .build file), following its file,
// guide skills, and the Character page's sheet.
const path = require('path');
const fs = require('fs');
const { app, ipcMain, net } = require('electron');
const gamesLib = require('../core/games');
const planner = require('../core/buildplanner');
const { parseItem } = require('../core/parser');
const resLib = require('../core/resists');
const pobVerdict = require('../core/pobverdict');
const gearLib = require('../core/gearscore');

module.exports = function (C) {
  // ---------- Path of Building import ----------
  const pobLib = require('../core/pob');
  // opts.source: where the build came from, kept so it can be read again later
  // ({ type: 'pobbin', url } or { type: 'file', path }); opts.sync: an update of the same build
  async function importBuild(input, opts = {}) {
    try {
      let code = String(input || '').trim();
      if (!code) return { ok: false, error: 'Paste a PoB code or a pobb.in link first.' };
      const raw = pobLib.pobbinRawUrl(code);
      let source = opts.source || null;
      if (raw) {
        if (!source) source = { type: 'pobbin', url: code };
        const res = await net.fetch(raw, { headers: { 'User-Agent': C.UA } });
        if (!res.ok) return { ok: false, error: `pobb.in said ${res.status} – check the link.` };
        code = (await res.text()).trim();
        if (code.length > 10 * 1024 * 1024) return { ok: false, error: "That pobb.in page is too big to be a build." };
      } else if (/^https?:/i.test(code)) {
        return { ok: false, error: 'Only pobb.in links can be read directly – for other sites, copy the export code instead.' };
      }
      // a Build Planner file (.build, from a guide): turned into a Path of Building build at the stage
      // you picked (or your level), keeping the slots you've copied your own items into
      let plan = null;
      if (planner.isBuildFile(code)) {
        const b = planner.parse(code);
        const stages = planner.stages(b);
        const lvSet = C.store.settings.leveling;
        const follow = (source && source.stage === 'level') || (!source || source.stage == null) && lvSet && lvSet.on;
        const level = follow && lvSet && Number(lvSet.level) > 0 ? Number(lvSet.level) : source && Number(source.stage) > 0 ? Number(source.stage) : 100;
        const have = {};
        for (const [slot, it] of Object.entries(C.store.equipped || {})) if (it && !it.fromPob) have[slot] = true;
        plan = planner.toPob(b, { level, have, skills: source && source.skills });
        plan.stages = stages;
        // the .build itself is kept next to the PoB build (once we know which character it's for), so a
        // pasted guide can change stage or skills too
        plan.code = code;
        code = plan.xml;
        if (!source) source = { type: 'build' };
        source = { ...source, planner: true, stages: stages.map((x) => ({ from: x.from, to: x.to, label: x.label })), stage: source.stage != null ? source.stage : follow ? 'level' : 100, title: plan.report.name, skillList: plan.report.skills, uniques: (plan.report.uniques || []).slice(0, 20) };
      }
      const xml = pobLib.decodeCode(code);
      const r = pobLib.parsePob(xml);
      // the build says which game this character is for. A build for the other game goes into a new
      // character, unless this one is still empty.
      const bg = gamesLib.gameFromPobXml(xml);
      if (opts.sync && bg && bg !== C.tg()) return { ok: false, error: `That build is now for ${C.G(bg).short}: import it again to make a new character for it.` };
      // checked before anything changes: a build without gear mustn't leave you on a new, empty character
      if (!Object.keys(r.items).length && !plan) return { ok: false, error: 'No equipped items found in that build. Put your gear on the character in Path of Building (Items tab), export it again and paste it here.' };
      let newChar = null;
      if (bg && bg !== C.tg()) {
        const empty = !Object.values(C.store.equipped || {}).some(Boolean) && !C.pobXml();
        const cls = r.character.ascendancy || r.character.className;
        const who0 = cls ? `${cls} ${C.G(bg).short}` : `My ${C.G(bg).short} character`;
        if (empty) C.store.setProfileGame(C.store.data.activeProfile, bg);
        else { C.store.createProfile(who0 || `${C.G(bg).short} character`, false, bg); newChar = C.store.listProfiles().find((p) => p.active).name; }
        if (bg === 'poe1') C.store.setSetting('build', 'off'); // the gear score profiles are for PoE2: PoE1 is judged by Path of Building
        C.store.data.lastGame = bg;
        C.stopOtherEngines(bg);
        C.gameChanged();
        C.log(`pob import: a ${C.G(bg).short} build${newChar ? `, new character "${newChar}"` : ''}`);
      }
      const slots = Object.keys(r.items);
      let kept = 0;
      // a guide's gear from an earlier import (another stage) that this one doesn't have: taken off
      // and items from an earlier Path of Building import that this build doesn't have (a two-hander
      // build after a sword-and-shield one): taken off too, so the old shield isn't your offhand. Items
      // you copied from the game stay.
      for (const [slot, it] of Object.entries(C.store.equipped || {})) if (it && (it.fromGuide || it.fromPob) && !r.items[slot]) C.store.setEquipped(slot, null);
      for (const [slot, text] of Object.entries(r.items)) {
        const item = parseItem(text);
        if (!item) continue;
        item.fromPob = true;
        if (plan) item.fromGuide = true;
        const cur = C.store.equipped[slot];
        // a copy from the game has base Armour/ES values PoB doesn't store: keep it if it's the same item
        if (cur && cur.name === item.name && !cur.fromPob) { kept++; continue; }
        C.store.setEquipped(slot, item);
        C.store.noteStats(item);
      }
      // numbers you typed from your character sheet beat PoB's
      const typed = C.store.settings.resists && C.store.settings.resists.source === 'game';
      if (r.resists && !typed) C.store.setSetting('resists', resLib.snapshot({ ...r.resists, cap: (C.store.settings.resists && C.store.settings.resists.cap) || 75 }, C.store.equipped, 'pob', C.store.settings.resists));
      // keep the build itself for the Path of Building engine
      try { fs.mkdirSync(path.dirname(C.pobFile()), { recursive: true }); fs.writeFileSync(C.pobFile(), xml); } catch (err) { C.log('pob: could not save the build: ' + err.message); }
      if (plan) try { fs.writeFileSync(C.guideFile(), plan.code); } catch (err) { C.log('guide: could not keep the .build: ' + err.message); }
      C.pobSync();
      C.refreshAll();
      const who = [r.character.ascendancy || r.character.className, r.character.level ? `level ${r.character.level}` : ''].filter(Boolean).join(', ');
      let message = `Imported ${slots.length} item${slots.length === 1 ? '' : 's'}${who ? ` (${who})` : ''}${r.resists ? ' and your resistances' : ''}.`;
      if (newChar) message = `New ${C.G(bg).short} character "${newChar}": ` + message.charAt(0).toLowerCase() + message.slice(1);
      if (kept) message += ` Kept ${kept} you'd already copied from the game (same item, more detail).`;
      if (plan) {
        const rp = plan.report;
        const stageTxt = plan.stages.length > 1 ? ` at ${rp.stage.label.toLowerCase()}` : '';
        message = `From the guide "${rp.name}"${rp.author ? ` by ${rp.author}` : ''}${stageTxt}: ${planner.summary(rp)}.`
          + (newChar ? ` New ${C.G(bg).short} character "${newChar}".` : '')
          + (Object.values(C.store.equipped || {}).some((it) => it && !it.fromPob) ? ' Your own copied items are used in their slots.' : ' Copy your own items (F2 on each) so they\'re judged against what you really wear.')
          + (rp.missing.length ? ` Not placed: ${rp.missing.join('; ')}.` : '')
          + (rp.notes.length ? ` ${rp.notes.join(' ')}` : '');
      }
      if (r.missingBase && C.tg() === 'poe2') message += ` PoB doesn't store base Armour/Energy Shield, so ${r.missingBase} armour piece${r.missingBase === 1 ? '' : 's'} score a bit low until you copy them in game once.`;
      C.log('pob import: ' + message);
      let engine = null;
      if (C.pobOn()) {
        try {
          const info = await C.pobEngine().ensureLoaded();
          fixPobWeapons(info);
          engine = pobSummary(info);
          // the gear score (used when PoB can't judge something) gets a profile that fits this build
          if (!C.store.settings.buildPicked && engine && C.tg() === 'poe2') {
            const fit = fitOf(info, engine);
            if (fit !== C.store.settings.build) { C.store.setSetting('build', fit); C.log(`gear score profile set to ${fit} from the PoB build`); }
          }
          if (engine.mismatch.length) message += ` Note: ${engine.mismatch.join('; ')}.`;
        } catch (err) { engine = { ok: false, error: err.message }; C.log('pob: ' + err.message); }
      }
      if (newChar) { C.notifySettings('settings:changed'); C.buildTrayMenu(); }
      // an update of a linked build that you unlinked while it ran: stays unlinked
      if (!(opts.sync && !C.store.buildSource())) C.store.setBuildSource(source ? { ...source, at: Date.now() } : null);
      watchBuildFile();
      return { ok: true, message, slots, engine, newCharacter: newChar };
    } catch (err) {
      C.log('pob import failed: ' + (err.stack || err));
      return { ok: false, error: err.message || String(err) };
    }
  }
  ipcMain.handle('pob:import', (_e, input) => importBuild(input));

  // ---------- keeping the build up to date ----------
  // A pobb.in link can be read again with one click. A build file you save from Path of Building
  // (your own file, picked by you) is watched: when PoB saves it, the app imports it again.
  const MAX_BUILD_FILE = 20 * 1024 * 1024;
  function readBuildFile(file) {
    const st = fs.statSync(file);
    if (!st.isFile()) throw new Error("That isn't a file.");
    if (st.size > MAX_BUILD_FILE) throw new Error('That file is too big to be a Path of Building build.');
    const xml = fs.readFileSync(file, 'utf8');
    if (planner.isBuildFile(xml)) { planner.parse(xml); return xml; } // a Build Planner file: checked here, converted on import
    if (!/<PathOfBuilding2?[\s>]/.test(xml)) throw new Error("That file isn't a Path of Building build or a Build Planner (.build) file.");
    return xml;
  }
  let buildWatch = null; let buildWatchTimer = null; let levelSyncTimer = null;
  function watchBuildFile() {
    if (buildWatch) { try { buildWatch.close(); } catch (_) { /* ignore */ } buildWatch = null; }
    const src = C.store.buildSource();
    if (!src || src.type !== 'file' || !src.path) return;
    const file = src.path;
    try {
      // the folder is watched, not the file: PoB saves by replacing it
      buildWatch = fs.watch(path.dirname(file), (_ev, name) => {
        if (name && path.basename(String(name)) !== path.basename(file)) return;
        clearTimeout(buildWatchTimer);
        buildWatchTimer = setTimeout(() => syncBuild('file changed').catch((err) => C.log('build sync: ' + err.message)), 1500);
      });
      buildWatch.on('error', (err) => C.log('build file watch: ' + err.message));
    } catch (err) { C.log('build file watch: ' + err.message); }
  }
  async function syncBuild(why) {
    const src = C.store.buildSource();
    if (!src) return { ok: false, error: 'This character has no linked build.' };
    const profile = C.store.data.activeProfile;
    let input;
    if (src.type === 'file') {
      let xml;
      try { xml = readBuildFile(src.path); } catch (err) { return { ok: false, error: `Couldn't read ${path.basename(src.path)}: ${err.code === 'ENOENT' ? 'the file is gone' : err.message}` }; }
      const sum = require('crypto').createHash('sha1').update(xml).digest('hex');
      if (planner.isBuildFile(xml) ? sum === src.sum && why !== 'stage' && why !== 'skills' : xml.trim() === (C.pobXml() || '').trim()) return { ok: true, same: true, message: 'Your build is already up to date.' };
      input = xml;
    } else if (src.type === 'pobbin') input = src.url;
    else if (src.type === 'build' && src.planner) {
      try { input = fs.readFileSync(C.guideFile(), 'utf8'); } catch (_) { return { ok: false, error: 'Import the .build file again to change it (this one was imported before the app kept a copy).' }; }
    } else return { ok: false, error: 'This character has no linked build.' };
    const r = await importBuild(input, { source: src, sync: true });
    if (r.ok && src.type === 'file') { const cur = C.store.buildSource(); if (cur) C.store.setBuildSource({ ...cur, sum: require('crypto').createHash('sha1').update(input).digest('hex') }); }
    if (C.store.data.activeProfile !== profile) return r;
    C.log(`build sync (${why}): ${r.ok ? r.message : r.error}`);
    if (r.ok) C.notifySettings('settings:changed');
    return r;
  }
  ipcMain.handle('pob:sync', () => syncBuild('asked'));
  ipcMain.handle('pob:source', () => {
    const s = C.store.buildSource();
    if (!s) return null;
    const lv = C.store.settings.leveling;
    return { type: s.type, name: s.type === 'file' ? path.basename(s.path) : s.url || s.title || 'a guide', at: s.at || null, planner: !!s.planner, title: s.title || null,
      stages: s.stages || null, stage: s.stage == null ? 100 : s.stage, skillList: s.planner ? s.skillList || null : null, skills: s.planner ? s.skills || null : null, levelNow: lv && lv.on && Number(lv.level) > 0 ? Number(lv.level) : null };
  });
  // a guide's stage: a level (its stage is used), or 'level' to follow your levelling level
  ipcMain.handle('pob:stage', async (_e, stage) => {
    const s = C.store.buildSource();
    if (!s || !s.planner) return { ok: false, error: 'This character has no guide build.' };
    const v = stage === 'level' ? 'level' : Math.max(1, Math.min(100, Number(stage) || 100));
    C.store.setBuildSource({ ...s, stage: v });
    return syncBuild('stage');
  });
  // a guide's skills: gem levels and quality (all, or one gem apart), the main skill and which others
  // count in the total DPS. cfg: { level, quality, gems: { id: { level, quality } }, main, full: { id: true } }
  ipcMain.handle('pob:skills', async (_e, cfg) => {
    const s = C.store.buildSource();
    if (!s || !s.planner) return { ok: false, error: 'This character has no guide build.' };
    const c = cfg && typeof cfg === 'object' ? cfg : {};
    const n = (v, hi) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(hi, Math.round(Number(v)))));
    const gems = {};
    for (const [id, g] of Object.entries(c.gems || {}).slice(0, 60)) {
      if (typeof id !== 'string' || !g) continue;
      const lv = n(g.level, 40); const q = n(g.quality, 23);
      if (lv || q != null) gems[id] = { ...(lv ? { level: lv } : {}), ...(q != null ? { quality: q } : {}) };
    }
    const full = {};
    for (const [id, on] of Object.entries(c.full || {}).slice(0, 60)) if (on && typeof id === 'string') full[id] = true;
    const skills = { level: c.level === 'max' ? 'max' : n(c.level, 40) || 'stage', quality: n(c.quality, 23) || 0, gems, main: typeof c.main === 'string' ? c.main : null, full };
    C.store.setBuildSource({ ...s, skills });
    return syncBuild('skills');
  });
  // each guide skill's damage when it's the main one (Path of Building), to pick the right main skill
  ipcMain.handle('pob:skillDps', async () => {
    const s = C.store.buildSource();
    if (!s || !s.planner || !C.pobOn()) return { ok: false, error: 'Path of Building isn\'t on for this character.' };
    try {
      await C.pobEngine().ensureLoaded();
      const r = await C.pobEngine().skillDps();
      const list = s.skillList || [];
      // PoB labels a group by its gems ("Spark, Lightning Penetration"); match on the skill's own name
      const out = {};
      for (const sk of list) {
        const hit = r.skills.find((g) => g.gemId === sk.id) || r.skills.find((g) => String(g.gemName || '').toLowerCase() === String(sk.name).toLowerCase());
        if (hit && hit.dps != null) out[sk.id] = { dps: Math.round(hit.dps), minion: !!hit.minion };
      }
      const best = Object.entries(out).sort((a, b) => b[1].dps - a[1].dps)[0];
      return { ok: true, dps: out, best: best && best[1].dps > 0 ? best[0] : null };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('pob:unlink', () => { C.store.setBuildSource(null); watchBuildFile(); return true; });
  ipcMain.handle('pob:linkFile', async () => {
    const { dialog } = require('electron');
    // the game's Build Planner folder (guides' .build files) when it's there, else Path of Building's builds
    const planner2 = path.join(app.getPath('documents'), 'My Games', 'Path of Exile 2', 'BuildPlanner');
    const docs = path.join(app.getPath('documents'), 'Path of Building', 'Builds');
    const start = C.tg() === 'poe2' && fs.existsSync(planner2) ? planner2 : fs.existsSync(docs) ? docs : app.getPath('documents');
    const pick = await dialog.showOpenDialog(C.settingsWin && !C.settingsWin.isDestroyed() ? C.settingsWin : undefined, {
      title: 'Pick a build file: Path of Building (.xml) or a guide\'s Build Planner file (.build)', defaultPath: start,
      filters: [{ name: 'Build files', extensions: ['xml', 'build'] }, { name: 'Path of Building build', extensions: ['xml'] }, { name: 'Build Planner file (PoE2)', extensions: ['build'] }], properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths.length) return { ok: false, canceled: true };
    const file = pick.filePaths[0];
    let xml;
    try { xml = readBuildFile(file); } catch (err) { return { ok: false, error: err.message }; }
    const r = await importBuild(xml, { source: { type: 'file', path: file } });
    if (r.ok) { const cur = C.store.buildSource(); if (cur) C.store.setBuildSource({ ...cur, sum: require('crypto').createHash('sha1').update(xml).digest('hex') }); }
    return r;
  });

  // PoE1: a PoB export doesn't say what kind of weapon an item is; PoB itself knows
  const POE1_WEAPON_CLASS = {
    'Two Handed Axe': 'Two Hand Axes', 'Two Handed Mace': 'Two Hand Maces', 'Two Handed Sword': 'Two Hand Swords',
    'One Handed Axe': 'One Hand Axes', 'One Handed Mace': 'One Hand Maces', 'One Handed Sword': 'One Hand Swords',
    Bow: 'Bows', Claw: 'Claws', Dagger: 'Daggers', Wand: 'Wands', Sceptre: 'Sceptres', Staff: 'Staves',
    Shield: 'Shields', Quiver: 'Quivers', 'Fishing Rod': 'Fishing Rods',
  };
  const POE2_WEAPON_CLASS = {
    'One Hand Mace': 'One Hand Maces', 'Two Hand Mace': 'Two Hand Maces', 'One Hand Sword': 'One Hand Swords', 'Two Hand Sword': 'Two Hand Swords',
    'One Hand Axe': 'One Hand Axes', 'Two Hand Axe': 'Two Hand Axes', Sceptre: 'Sceptres', Wand: 'Wands', Staff: 'Staves', Bow: 'Bows',
    Crossbow: 'Crossbows', Spear: 'Spears', Flail: 'Flails', Dagger: 'Daggers', Claw: 'Claws', Talisman: 'Talismans', Focus: 'Foci',
    Quiver: 'Quivers', Shield: 'Shields', 'Fishing Rod': 'Fishing Rods',
  };
  // the item class of each imported weapon and offhand, from what Path of Building says it is (the
  // import guesses from the base's name: a PoE2 Smithing Hammer or Morning Star would be a sceptre)
  function fixPobWeapons(info) {
    if (!info || !info.gearTypes) return;
    const poe1 = C.tg() === 'poe1';
    const ours = { 'Weapon 1': 'Weapon', 'Weapon 2': 'Offhand', 'Weapon 1 Swap': 'Weapon 2', 'Weapon 2 Swap': 'Offhand 2' };
    const { isTwoHanded } = require('../core/slots');
    const swapped = { 'Weapon 1': 'Weapon 2', 'Weapon 2': 'Offhand 2', 'Weapon 1 Swap': 'Weapon', 'Weapon 2 Swap': 'Offhand' }; // a build on weapon set II
    for (const [ps, t] of Object.entries(info.gearTypes)) {
      let slot = ours[ps];
      const named = (sl) => { const x = C.store.equipped[sl]; return x && t && t.name && x.name === t.name; };
      if (!named(slot) && named(swapped[ps])) slot = swapped[ps];
      const it = C.store.equipped[slot];
      if (!it || !it.fromPob || !t || !t.type) continue;
      let cls = (poe1 ? POE1_WEAPON_CLASS : POE2_WEAPON_CLASS)[t.type];
      if (poe1 && t.type === 'One Handed Sword' && /thrust/i.test(t.subType || '')) cls = 'Thrusting One Hand Swords';
      if (poe1 && t.type === 'Dagger' && /rune/i.test(t.subType || '')) cls = 'Rune Daggers';
      if (t.type === 'Staff' && /warstaff/i.test(t.subType || '')) cls = poe1 ? 'Warstaves' : 'Quarterstaves';
      if (!poe1 && cls === 'Shields' && it.itemClass === 'Bucklers') continue; // PoB calls bucklers shields
      if (!cls || cls === it.itemClass) continue;
      it.itemClass = cls; it.twoHanded = isTwoHanded(cls);
      if (it.raw) it.raw = it.raw.replace(/^Item Class:.*$/m, `Item Class: ${cls}`);
      C.store.setEquipped(slot, it);
    }
  }

  // what the engine says about your build, plus where it disagrees with your character sheet
  // the gear score profile that fits the Path of Building build: what its main skill does and its defences
  function fitOf(info, engine) {
    const st = info.stats || {};
    const w = info.gearTypes && info.gearTypes['Weapon 1'];
    return gearLib.fitProfile({ dpsKey: engine ? engine.dpsKey : pobVerdict.dpsKey(st), kind: info.kind, weapon: w && w.type, life: st.Life, es: st.EnergyShield, armour: st.Armour, evasion: st.Evasion });
  }
  // "Match my Path of Building build" on Build & stats: picks it again, and PoB imports keep it matched
  ipcMain.handle('gear:fitProfile', async () => {
    if (!C.pobOn() || C.tg() !== 'poe2') return { ok: false, error: 'Load your Path of Building build first (My gear).' };
    try {
      const info = await C.pobEngine().ensureLoaded();
      if (!info) return { ok: false, error: 'Load your Path of Building build first (My gear).' };
      const fit = fitOf(info);
      C.store.setSetting('build', fit); C.store.setSetting('buildPicked', false);
      C.log(`gear score profile matched to the PoB build: ${fit}`);
      if (C.refreshAll) C.refreshAll();
      C.notifySettings('settings:changed');
      return { ok: true, id: fit, name: (gearLib.buildInfo(fit) || {}).name };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  function pobSummary(info) {
    if (!info) return null;
    const st = info.stats || {};
    const rs = C.liveResists();
    const mismatch = [];
    if (rs && rs.source === 'game') {
      for (const [El, el] of Object.entries(C.RES_EL)) {
        const typedV = rs[el]; const pobV = st[`${El}ResistTotal`];
        if (typedV != null && pobV != null && Math.abs(typedV - pobV) >= 5) mismatch.push(`PoB has ${El.toLowerCase()} res at ${Math.round(pobV)}%, your character sheet ${typedV}% – check PoB's Configuration (${C.tg() === 'poe1' ? 'flasks' : 'charms'}, buffs) and gear`);
      }
    }
    const dk = pobVerdict.dpsKey(st);
    const tv = (v) => String(v).replace(/_/g, '.').replace(/\.(ruthless|alternate)$/i, ' $1');
    if (info.treeConverted && info.treeConverted.newer) mismatch.push(`your build was made with a newer Path of Building (passive tree ${tv(info.treeConverted.from)}) than the one in this app (${tv(info.treeConverted.to)}), so new passives may be missing from the verdicts – the app's Path of Building is updated with the app`);
    else if (info.treeConverted) mismatch.push(`your build is on an old passive tree (${tv(info.treeConverted.from)}); it was moved to ${tv(info.treeConverted.to)}, which can drop passives – update the build in Path of Building and import it again`);
    if (info.timelessRemoved) mismatch.push(`${info.timelessRemoved === 1 ? 'your timeless jewel was' : `your ${info.timelessRemoved} timeless jewels were`} left out of the calculations (the data it needs doesn't come with the app), so verdicts don't include ${info.timelessRemoved === 1 ? 'its' : 'their'} passive changes`);
    if (!(pobVerdict.dpsOf(st, dk) > 0)) mismatch.push(`your main skill in Path of Building${info.mainSkill ? ` (${info.mainSkill})` : ''} deals no damage, so damage changes can't be judged – pick your damage skill as the main skill on the Character page (or in PoB, or tick "Include in Full DPS" on your damage skills there and import again)`);
    return {
      ok: true, className: info.className, ascendancy: info.ascendancy, level: info.level, mainSkill: info.mainSkill,
      dps: pobVerdict.dpsOf(st, dk), dpsKey: dk, ehp: st.TotalEHP, es: st.EnergyShield, life: st.Life, spirit: st.Spirit, spiritFree: st.SpiritUnreserved,
      res: Object.keys(C.RES_EL).map((El) => ({ el: El, value: st[`${El}Resist`], total: st[`${El}ResistTotal`] })),
      gear: info.gear || {}, overridden: info.equipped || [], mismatch,
      ci: pobVerdict.hasCI(st),
    };
  }
  // Character page: which skill is the main one (judged for damage). The list has every active skill
  // of the build, the weapon's default attack too, each with its damage as the main skill.
  const mainSkillCache = new Map();
  ipcMain.handle('pob:mainSkills', async () => {
    if (!C.pobOn()) return { ok: false, error: 'Load your Path of Building build first (My gear).' };
    const key = `${C.store.data.activeProfile}|${C.pobSheetGen()}`;
    if (mainSkillCache.has(key)) return mainSkillCache.get(key);
    try {
      const info = await C.pobEngine().ensureLoaded();
      const list = await C.pobEngine().skills(true);
      const pick = C.store.pobMain();
      const r = { ok: true, pick, missing: !!(pick && info && info.mainPickMissing), list: list.map((c) => ({ name: c.name, slot: c.slot || null, default: !!c.default, main: !!c.main, dps: c.dps == null ? null : c.dps, minion: !!c.minion })) };
      mainSkillCache.clear(); mainSkillCache.set(key, r);
      return r;
    } catch (err) { return { ok: false, error: err.message }; }
  });
  // pick: { name, slot } or null (Path of Building's own main skill)
  ipcMain.handle('pob:setMainSkill', async (_e, pick) => {
    if (!C.pobOn()) return { ok: false, error: 'Load your Path of Building build first (My gear).' };
    C.store.setPobMain(pick && typeof pick === 'object' ? pick : null);
    C.log(`pob: main skill ${pick && pick.name ? `set to ${pick.name}` : 'back to Path of Building\'s'}`);
    C.pobSync();
    if (C.refreshAll) C.refreshAll();
    C.notifySettings('settings:changed');
    try { const info = await C.pobEngine().ensureLoaded(); return { ok: true, mainSkill: info && info.mainSkill, missing: !!(info && info.mainPickMissing) }; } catch (err) { return { ok: false, error: err.message }; }
  });

  const pobLastSummary = new Map();
  // Character page: everything Path of Building calculates for your character (with the gear you
  // copied in game), plus what the app itself knows. Kept per character so it shows instantly next time.
  const pobLastSheet = new Map();
  ipcMain.handle('pob:sheet', async (_e, refresh) => {
    const key = C.store.data.activeProfile;
    const out = { on: C.pobOn(), hasBuild: !!C.pobXml(), available: C.pobEngine().available(), enabled: C.store.settings.usePob !== false, resists: C.liveResists() || null };
    if (!out.on) return out;
    if (!refresh && pobLastSheet.has(key) && pobLastSheet.get(key).gen === C.pobSheetGen()) return { ...out, sheet: pobLastSheet.get(key).sheet, at: pobLastSheet.get(key).at };
    try {
      if (refresh) C.pobEngine().resetFailure(); // you pressed Refresh: try again now
      await C.pobEngine().ensureLoaded();
      const sheet = await C.pobEngine().sheet();
      sheet.overridden = (C.pobEngine().info() || {}).equipped || [];
      pobLastSheet.set(key, { sheet, at: Date.now(), gen: C.pobSheetGen() });
      return { ...out, sheet, at: Date.now() };
    } catch (err) {
      C.log('pob sheet: ' + (err.message || err));
      const last = pobLastSheet.get(key);
      return { ...out, error: err.message || String(err), sheet: last ? last.sheet : null, at: last ? last.at : null };
    }
  });
  // search strings to paste into the game's search box (stash, vendor, map device)

  return {
    get levelSyncTimer() { return levelSyncTimer; }, set levelSyncTimer(v) { levelSyncTimer = v; },
    watchBuildFile,
    syncBuild,
    pobSummary,
    pobLastSummary,
  };
};
